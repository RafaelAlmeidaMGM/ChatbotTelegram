-- Preserve existing tickets while allowing department keys configured in config.json.
CREATE TABLE tickets_new (
  id INTEGER PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  username TEXT,
  department TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  company TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivery_status TEXT NOT NULL DEFAULT 'pending'
);
INSERT INTO tickets_new SELECT * FROM tickets;
DROP TABLE tickets;
ALTER TABLE tickets_new RENAME TO tickets;
