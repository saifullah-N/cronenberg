-- Brands we monitor. keywords/legit_domains are JSON arrays of lowercase strings.
CREATE TABLE brands (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  keywords TEXT NOT NULL,
  legit_domains TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Ground truth from public phishing feeds. Timestamps are ISO-8601 UTC.
CREATE TABLE feed_entries (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('openphish', 'phishtank')),
  url TEXT NOT NULL,                   -- normalized url
  hostname TEXT NOT NULL,
  registrable_domain TEXT,             -- NULL for IPs / unparseable hosts
  brand_id INTEGER REFERENCES brands(id),
  source_first_seen_at TEXT,           -- PhishTank submission_time; NULL for OpenPhish
  source_target TEXT,                  -- PhishTank `target`
  first_seen_at TEXT NOT NULL,         -- our poll time
  last_seen_at TEXT NOT NULL,
  UNIQUE (source, url)
);
CREATE INDEX idx_feed_entries_domain ON feed_entries(registrable_domain);
CREATE INDEX idx_feed_entries_source_seen ON feed_entries(source, first_seen_at);
CREATE INDEX idx_feed_entries_brand ON feed_entries(brand_id, first_seen_at);

CREATE TABLE labels (
  feed_entry_id INTEGER PRIMARY KEY REFERENCES feed_entries(id),
  label TEXT NOT NULL CHECK (label IN ('id_harvest', 'credential', 'payment', 'other', 'benign', 'unknown')),
  notes TEXT,
  labeled_at TEXT NOT NULL
);

CREATE TABLE ingest_runs (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  fetched INTEGER,
  new_rows INTEGER,
  error TEXT
);
