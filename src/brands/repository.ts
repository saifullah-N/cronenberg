export interface Brand {
  id: number;
  slug: string;
  name: string;
  keywords: string[];
  legitDomains: string[];
}

interface BrandRow {
  id: number;
  slug: string;
  name: string;
  keywords: string;
  legit_domains: string;
}

function parseStringArray(json: string, field: string, slug: string): string[] {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new Error(`brand ${slug}: ${field} must be a JSON array of strings`);
  }
  // Drop blank entries: an empty keyword would substring-match every URL.
  return value.map((v) => v.trim().toLowerCase()).filter((v) => v.length > 0);
}

export async function loadBrands(db: D1Database): Promise<Brand[]> {
  const { results } = await db
    .prepare("SELECT id, slug, name, keywords, legit_domains FROM brands ORDER BY id")
    .all<BrandRow>();
  return results.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    keywords: parseStringArray(row.keywords, "keywords", row.slug),
    legitDomains: parseStringArray(row.legit_domains, "legit_domains", row.slug),
  }));
}
