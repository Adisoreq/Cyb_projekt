// Wypisuje zawartość bazy w konsoli (tylko do odczytu).
// Użycie: npm run show-db [-- <tabela|all>] [-- --json]
// Przykłady: npm run show-db -- users | npm run show-db -- resources --json
// DuckDB pozwala na dostęp z jednego procesu – zatrzymaj serwer przed uruchomieniem.
const path = require('path');
const fs = require('fs');
const duckdb = require('duckdb');

const TABLES = ['users', 'password_history', 'sessions', 'resources', 'settings'];
const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'app.duckdb');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const target = args.find((a) => !a.startsWith('--')) || 'all';

if (target !== 'all' && !TABLES.includes(target)) {
  console.error(`Nieznana tabela "${target}". Dostępne: ${TABLES.join(', ')}, all.`);
  process.exit(1);
}
if (!fs.existsSync(DB_FILE)) {
  console.error(`Nie znaleziono bazy: ${DB_FILE}. Uruchom najpierw serwer.`);
  process.exit(1);
}

const normalize = (row) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]));

// Kolumny z czasem (epoch ms) pokazujemy jako czytelne daty.
const TIME_COLUMNS = new Set(['created_at', 'updated_at', 'password_changed_at', 'one_time_expires', 'last_activity']);
const humanize = (row) =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, TIME_COLUMNS.has(k) && typeof v === 'number' ? new Date(v).toLocaleString('pl-PL') : v])
  );

const database = new duckdb.Database(DB_FILE, duckdb.OPEN_READONLY, (err) => {
  if (err) {
    console.error(`Nie można otworzyć bazy (czy serwer jest uruchomiony?): ${err.message}`);
    process.exit(1);
  }
});
const connection = database.connect();

const query = (sql) =>
  new Promise((resolve, reject) => {
    connection.all(sql, (err, rows) => (err ? reject(err) : resolve(rows.map(normalize))));
  });

(async () => {
  const tables = target === 'all' ? TABLES : [target];
  for (const table of tables) {
    const rows = await query(`SELECT * FROM ${table}`);
    console.log(`\n=== ${table} (${rows.length}) ===`);
    if (asJson) console.log(JSON.stringify(rows, null, 2));
    else if (rows.length) console.table(rows.map(humanize));
    else console.log('(pusta)');
  }
})()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => database.close());
