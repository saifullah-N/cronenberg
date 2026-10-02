// Imports labels from labels/sample.csv into D1 and prints the label distribution per brand.
// Usage: npm run label:import -- [--local]
// Rows with an empty `label` are skipped so a sample can be labeled in several sittings.
import { readFileSync, writeFileSync } from "node:fs";
import { LABELS, d1, parseCsv, targetFlag } from "./d1.mjs";

const flag = targetFlag(process.argv.slice(2));
const rows = parseCsv(readFileSync("labels/sample.csv", "utf8"));

const sqlString = (v) => (v ? `'${v.replaceAll("'", "''")}'` : "NULL");
const labeledAt = new Date().toISOString();
const statements = [];
const errors = [];
const expectedUrls = new Map();

for (const [i, row] of rows.entries()) {
  // Row numbers count data rows; a quoted multi-line note spans several physical lines.
  const where = `row ${i + 1}`;
  const label = (row.label ?? "").trim().toLowerCase();
  if (!label) continue;
  const idText = (row.id ?? "").trim();
  const id = Number(idText);
  if (!idText || !Number.isInteger(id) || id <= 0) errors.push(`${where}: bad id "${row.id ?? ""}"`);
  else if (!LABELS.includes(label)) errors.push(`${where}: unknown label "${label}" (use ${LABELS.join(", ")})`);
  else {
    expectedUrls.set(id, { where, url: (row.url ?? "").trim() });
    statements.push(
      `INSERT INTO labels (feed_entry_id, label, notes, labeled_at) VALUES (${id}, '${label}', ${sqlString((row.notes ?? "").trim())}, '${labeledAt}')
       ON CONFLICT (feed_entry_id) DO UPDATE SET label = excluded.label, notes = excluded.notes, labeled_at = excluded.labeled_at;`,
    );
  }
}

// Ids are per-database: a sample exported with --local must not be imported into remote (or vice versa).
if (!errors.length && expectedUrls.size) {
  const found = d1(flag, {
    command: `SELECT id, url FROM feed_entries WHERE id IN (${[...expectedUrls.keys()].join(",")})`,
  });
  const actual = new Map(found.map((r) => [r.id, r.url]));
  for (const [id, { where, url }] of expectedUrls) {
    if (actual.get(id) !== url) {
      errors.push(`${where}: id ${id} is ${actual.has(id) ? "a different URL" : "missing"} in this database (wrong --local/--remote target?)`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
if (!statements.length) {
  console.log("No labeled rows found; fill in the `label` column first.");
  process.exit(0);
}

writeFileSync("labels/import.sql", statements.join("\n") + "\n");
d1(flag, { file: "labels/import.sql" });
console.log(`Imported ${statements.length} labels.`);

const dist = d1(flag, {
  command: `SELECT b.slug AS brand, l.label, COUNT(*) AS n
            FROM labels l
            JOIN feed_entries fe ON fe.id = l.feed_entry_id
            LEFT JOIN brands b ON b.id = fe.brand_id
            GROUP BY b.slug, l.label
            ORDER BY b.slug, n DESC`,
});
console.table(dist);
