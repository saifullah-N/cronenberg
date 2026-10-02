-- Copy to seeds/brands.sql (gitignored) and replace with the brands you monitor.
-- keywords: lowercase substrings matched against feed URLs. Avoid keywords shorter than
-- 5 characters; the Phase 1 matcher is a naive substring check and short words match everything.
-- legit_domains: the brand's own registrable domains; URLs on these are never tagged.
INSERT INTO brands (slug, name, keywords, legit_domains)
VALUES ('examplebank', 'Example Bank', '["examplebank"]', '["examplebank.com"]')
ON CONFLICT (slug) DO UPDATE SET
  name = excluded.name,
  keywords = excluded.keywords,
  legit_domains = excluded.legit_domains;
