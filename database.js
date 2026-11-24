import Database from "better-sqlite3";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT NOT NULL UNIQUE,
 display_name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('ADMIN','LEADER')),
 sector TEXT,
 salt TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 must_change_password INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS properties (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 owner_user_id INTEGER NOT NULL REFERENCES users(id),
 agent_name TEXT NOT NULL,
 client_type TEXT NOT NULL CHECK(client_type IN ('مالك','مشتري')),
 client_name TEXT NOT NULL,
 phone TEXT NOT NULL,
 address TEXT NOT NULL,
 price REAL NOT NULL,
 area REAL,
 floor TEXT,
 finishing TEXT,
 utilities TEXT,
 land_share TEXT,
 layout TEXT,
 property_type TEXT NOT NULL CHECK(property_type IN ('شقة','عمارة','برج','منزل','أرض','محل')),
 status TEXT NOT NULL DEFAULT 'موجود' CHECK(status IN ('موجود','اتباع','غير متوفر حاليا')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_properties_owner ON properties(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at BIGINT NOT NULL
);
`;

const postgresSchema = [
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('ADMIN','LEADER')),
    sector TEXT,
    salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS properties (
    id SERIAL PRIMARY KEY,
    owner_user_id INTEGER NOT NULL REFERENCES users(id),
    agent_name TEXT NOT NULL,
    client_type TEXT NOT NULL CHECK(client_type IN ('مالك','مشتري')),
    client_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    price DOUBLE PRECISION NOT NULL,
    area DOUBLE PRECISION,
    floor TEXT,
    finishing TEXT,
    utilities TEXT,
    land_share TEXT,
    layout TEXT,
    property_type TEXT NOT NULL CHECK(property_type IN ('شقة','عمارة','برج','منزل','أرض','محل')),
    status TEXT NOT NULL DEFAULT 'موجود' CHECK(status IN ('موجود','اتباع','غير متوفر حاليا')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_properties_owner ON properties(owner_user_id)",
  "CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status)",
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at BIGINT NOT NULL
  )`
];

function postgresPlaceholders(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

class DatabaseAdapter {
  constructor() {
    this.isPostgres = Boolean(process.env.DATABASE_URL);
    this.sqlite = null;
    this.pool = null;
  }

  async init() {
    if (this.isPostgres) {
      this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
      for (const statement of postgresSchema) await this.pool.query(statement);
      return;
    }

    const dataDir = path.join(__dirname, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    this.sqlite = new Database(path.join(dataDir, "inventory.sqlite"));
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("foreign_keys = ON");
    this.sqlite.exec(sqliteSchema);
  }

  async get(sql, ...params) {
    if (this.isPostgres) {
      const result = await this.pool.query(postgresPlaceholders(sql), params);
      return result.rows[0];
    }
    return this.sqlite.prepare(sql).get(...params);
  }

  async all(sql, ...params) {
    if (this.isPostgres) {
      const result = await this.pool.query(postgresPlaceholders(sql), params);
      return result.rows;
    }
    return this.sqlite.prepare(sql).all(...params);
  }

  async run(sql, ...params) {
    if (this.isPostgres) {
      const result = await this.pool.query(postgresPlaceholders(sql), params);
      return { changes: result.rowCount };
    }
    return this.sqlite.prepare(sql).run(...params);
  }

  async close() {
    if (this.pool) await this.pool.end();
    if (this.sqlite) this.sqlite.close();
  }
}

export const db = new DatabaseAdapter();
