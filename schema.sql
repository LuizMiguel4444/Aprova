-- Banco D1 do Aprova (rode uma vez)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT,
  created_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_exp ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS state (
  user_id TEXT PRIMARY KEY, rev INTEGER NOT NULL, parts INTEGER NOT NULL,
  size INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
  user_id TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY (user_id, key, n)
);
CREATE TABLE IF NOT EXISTS files (
  user_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT, mime TEXT,
  size INTEGER, parts INTEGER, created INTEGER,
  PRIMARY KEY (user_id, id)
);
