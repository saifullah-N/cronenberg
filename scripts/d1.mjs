import { execFileSync } from "node:child_process";

export const DB_NAME = "cronenberg";
export const LABELS = ["id_harvest", "credential", "payment", "other", "benign", "unknown"];

export function targetFlag(argv) {
  return argv.includes("--local") ? "--local" : "--remote";
}

// Runs a SQL command (or file) through wrangler and returns the result rows of the last statement.
export function d1(flag, { command, file }) {
  const args = ["wrangler", "d1", "execute", DB_NAME, flag, "--json"];
  if (command) args.push("--command", command);
  if (file) args.push("--file", file);
  const out = execFileSync("npx", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const parsed = JSON.parse(out);
  return parsed.at(-1)?.results ?? [];
}

export function toCsv(rows, columns) {
  const cell = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  return [columns.map(cell).join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}

// Minimal RFC 4180 parser: quoted fields, escaped quotes, commas/newlines inside quotes.
export function parseCsv(text) {
  // Spreadsheet apps often prepend a UTF-8 BOM when re-saving CSVs.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);

  const [header = [], ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}
