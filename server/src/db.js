const path = require('path');
const fs = require('fs');
const duckdb = require('duckdb');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'app.duckdb');

if (DB_FILE !== ':memory:') fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const database = new duckdb.Database(DB_FILE);
const connection = database.connect();

// DuckDB zwraca BIGINT jako BigInt, a JSON go nie obsługuje.
const normalize = (row) => {
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = typeof v === 'bigint' ? Number(v) : v;
  return out;
};

function run(sql, ...params) {
  return new Promise((resolve, reject) => {
    connection.run(sql, ...params, (err) => (err ? reject(err) : resolve()));
  });
}

function all(sql, ...params) {
  return new Promise((resolve, reject) => {
    connection.all(sql, ...params, (err, rows) => (err ? reject(err) : resolve(rows.map(normalize))));
  });
}

async function get(sql, ...params) {
  const rows = await all(sql, ...params);
  return rows[0];
}

async function init() {
  await run(`CREATE SEQUENCE IF NOT EXISTS users_seq START 1`);
  await run(`CREATE SEQUENCE IF NOT EXISTS resources_seq START 1`);
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      login VARCHAR NOT NULL,
      first_name VARCHAR NOT NULL,
      last_name VARCHAR NOT NULL,
      role VARCHAR NOT NULL,
      password_hash VARCHAR NOT NULL,
      salt VARCHAR NOT NULL,
      must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
      one_time_expires BIGINT,
      password_changed_at BIGINT NOT NULL,
      blocked BOOLEAN NOT NULL DEFAULT FALSE,
      created_at BIGINT NOT NULL
    )`);
  await run(`
    CREATE TABLE IF NOT EXISTS password_history (
      user_id INTEGER NOT NULL,
      password_hash VARCHAR NOT NULL,
      salt VARCHAR NOT NULL,
      created_at BIGINT NOT NULL
    )`);
  await run(`CREATE TABLE IF NOT EXISTS settings (key VARCHAR PRIMARY KEY, value VARCHAR NOT NULL)`);
  await run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id VARCHAR PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at BIGINT NOT NULL,
      last_activity BIGINT NOT NULL
    )`);
  await run(`
    CREATE TABLE IF NOT EXISTS resources (
      id INTEGER PRIMARY KEY,
      type VARCHAR NOT NULL,
      data VARCHAR NOT NULL,
      created_by VARCHAR NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`);
}

module.exports = { run, all, get, init, file: DB_FILE };
