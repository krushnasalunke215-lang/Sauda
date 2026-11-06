import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

/** Opens (or creates) the SQLite database and its tables. Pass ':memory:' in tests. */
export function openDb(file: string): Db {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS deals (
      id TEXT PRIMARY KEY,
      maker_token TEXT,
      buyer_token TEXT,
      invoice_id TEXT,
      state TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS deals_invoice_id ON deals (invoice_id);
    CREATE TABLE IF NOT EXISTS webhook_events (
      event_id TEXT PRIMARY KEY,
      received_at TEXT,
      event_type TEXT,
      invoice_id TEXT,
      verified INTEGER
    );
    CREATE TABLE IF NOT EXISTS ai_usage (
      day TEXT PRIMARY KEY,
      calls INTEGER
    );
  `);
  return db;
}
