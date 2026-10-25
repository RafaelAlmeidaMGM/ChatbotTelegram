CREATE TABLE sessions (
  chat_id INTEGER PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0,
  draft TEXT
);
CREATE TRIGGER session_version BEFORE UPDATE ON sessions
WHEN NEW.version != OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'session_version_conflict');
END;
CREATE TABLE updates (id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL);
CREATE TABLE tickets (
  id INTEGER PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  username TEXT,
  department TEXT NOT NULL CHECK(department IN ('suporte', 'financeiro')),
  customer_name TEXT NOT NULL,
  company TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivery_status TEXT NOT NULL DEFAULT 'pending'
);
CREATE TABLE outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  update_id INTEGER NOT NULL REFERENCES updates(id),
  position INTEGER NOT NULL,
  action TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  success INTEGER,
  lease_until INTEGER NOT NULL DEFAULT 0,
  UNIQUE(update_id, position)
);
CREATE INDEX outbox_update ON outbox(update_id, position);
