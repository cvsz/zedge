-- Link and click attribution schema for Cloudflare D1 (SQLite).
-- Clicks never store IP addresses or user agents. Links are never deleted, only disabled, so history stays attributable.
CREATE TABLE IF NOT EXISTS links (
  slug         TEXT PRIMARY KEY,
  destination  TEXT NOT NULL,
  provider     TEXT NOT NULL DEFAULT 'generic',
  campaign_id  TEXT,
  content_id   TEXT,
  creative_id  TEXT,
  platform     TEXT NOT NULL DEFAULT 'other',
  disclosure   TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1,
  expires_at   INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS clicks (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  slug      TEXT NOT NULL,
  ts        INTEGER NOT NULL,
  day       TEXT NOT NULL,
  platform  TEXT NOT NULL,
  country   TEXT,
  is_bot    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS clicks_slug_day ON clicks (slug, day);
CREATE INDEX IF NOT EXISTS links_campaign ON links (campaign_id);
