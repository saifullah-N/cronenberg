// Exports a random sample of unlabeled, brand-matched feed entries to labels/sample.csv.
// Usage: npm run label:export -- [--local] [--limit 150] [--force]
// Label from existing urlscan.io results. Do NOT open the phishing URLs directly.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { d1, targetFlag, toCsv } from "./d1.mjs";

const argv = process.argv.slice(2);
const limitArg = argv.indexOf("--limit");
const limit = limitArg >= 0 ? Number.parseInt(argv[limitArg + 1] ?? "", 10) : 150;
if (!Number.isInteger(limit) || limit <= 0) throw new Error("--limit must be a positive integer");

const out = "labels/sample.csv";
if (existsSync(out) && !argv.includes("--force")) {
  console.error(`${out} already exists (it may contain your labels). Import it first or pass --force.`);
  process.exit(1);
}

const rows = d1(targetFlag(argv), {
  command: `SELECT fe.id, b.slug AS brand, fe.url, fe.hostname, fe.registrable_domain, fe.first_seen_at
            FROM feed_entries fe
            JOIN brands b ON b.id = fe.brand_id
            LEFT JOIN labels l ON l.feed_entry_id = fe.id
            WHERE l.feed_entry_id IS NULL
            ORDER BY random()
            LIMIT ${limit}`,
});

const withLinks = rows.map((r) => ({
  ...r,
  // IP-hosted entries have no registrable domain; fall back to the host itself.
  urlscan: `https://urlscan.io/search/#domain:${r.registrable_domain ?? r.hostname}`,
  label: "",
  notes: "",
}));

mkdirSync("labels", { recursive: true });
writeFileSync(
  out,
  toCsv(withLinks, ["id", "brand", "url", "registrable_domain", "first_seen_at", "urlscan", "label", "notes"]),
);
console.log(`Wrote ${withLinks.length} rows to ${out}.`);
