const fs = require('fs');
const path = require('path');
const db = require('./db');
const { ROLES } = require('./permissions');
const { generateOneTimePassword, storePassword } = require('./security');

// Tworzy użytkownika; zwraca id. Hasło jest zapisywane jako hash z solą i trafia do historii.
async function createUser({ login, firstName, lastName, role, password, oneTime }) {
  const [row] = await db.all(
    `INSERT INTO users (id, login, first_name, last_name, role, password_hash, salt, must_change_password, password_changed_at, created_at)
     VALUES (nextval('users_seq'), ?, ?, ?, ?, '', '', FALSE, ?, ?) RETURNING id`,
    login,
    firstName,
    lastName,
    role,
    Date.now(),
    Date.now()
  );
  await storePassword(row.id, password, { oneTime });
  return row.id;
}

const TEST_PASSWORD = 'Test-Haslo#2026';

const TEST_USERS = [
  { login: 'jkowalski', firstName: 'Jan', lastName: 'Kowalski', role: ROLES.MANAGER },
  { login: 'anowak', firstName: 'Anna', lastName: 'Nowak', role: ROLES.MANAGER },
  { login: 'pwisniewski', firstName: 'Piotr', lastName: 'Wiśniewski', role: ROLES.EMPLOYEE },
  { login: 'mzielinska', firstName: 'Marta', lastName: 'Zielińska', role: ROLES.EMPLOYEE },
  { login: 'kmazur', firstName: 'Karol', lastName: 'Mazur', role: ROLES.GUEST },
  { login: 'ewojcik', firstName: 'Ewa', lastName: 'Wójcik', role: ROLES.GUEST, oneTime: true },
];

const SAMPLE_RESOURCES = [
  ['documents', { title: 'Umowa o świadczenie usług', category: 'Umowa', author: 'Jan Kowalski', status: 'Zatwierdzony', content: 'Umowa ramowa z dostawcą usług chmurowych.' }],
  ['documents', { title: 'Procedura reagowania na incydenty', category: 'Procedura', author: 'Anna Nowak', status: 'Szkic', content: 'Kroki postępowania po wykryciu incydentu bezpieczeństwa.' }],
  ['documents', { title: 'Raport kwartalny Q3', category: 'Raport', author: 'Piotr Wiśniewski', status: 'Archiwalny', content: '' }],
  ['projects', { name: 'Migracja do chmury', lead: 'Jan Kowalski', budget: 250000, startDate: '2026-01-15', endDate: '2026-09-30', status: 'W toku' }],
  ['projects', { name: 'Audyt bezpieczeństwa', lead: 'Anna Nowak', budget: 80000, startDate: '2026-03-01', endDate: '', status: 'Planowany' }],
  ['devices', { name: 'Laptop Dell Latitude 5440', deviceType: 'Laptop', serialNumber: 'DL5440-0012', location: 'Biuro, pok. 12', condition: 'Sprawny' }],
  ['devices', { name: 'Serwer HP ProLiant', deviceType: 'Serwer', serialNumber: 'HP-PL-8841', location: 'Serwerownia', condition: 'W naprawie' }],
  ['devices', { name: 'Drukarka Brother HL', deviceType: 'Drukarka', serialNumber: 'BR-HL-2207', location: 'Recepcja', condition: 'Sprawny' }],
];

async function seed() {
  const count = await db.get('SELECT count(*) AS n FROM users');
  if (count.n > 0) return;

  const adminPassword = generateOneTimePassword();
  await createUser({ login: 'ADMIN', firstName: 'Administrator', lastName: 'Systemu', role: ROLES.ADMIN, password: adminPassword, oneTime: true });

  const credentials = [];
  for (const u of TEST_USERS) {
    const password = u.oneTime ? generateOneTimePassword() : TEST_PASSWORD;
    await createUser({ ...u, password });
    credentials.push({ login: u.login, role: u.role, password, oneTime: Boolean(u.oneTime) });
  }

  const now = Date.now();
  for (const [type, data] of SAMPLE_RESOURCES) {
    await db.run(
      `INSERT INTO resources (id, type, data, created_by, created_at, updated_at) VALUES (nextval('resources_seq'), ?, ?, 'ADMIN', ?, ?)`,
      type,
      JSON.stringify(data),
      now,
      now
    );
  }

  const lines = [`ADMIN  (Administrator)  hasło jednorazowe (12h): ${adminPassword}`];
  for (const c of credentials) {
    lines.push(`${c.login.padEnd(12)} (${c.role})  ${c.oneTime ? 'hasło jednorazowe (12h)' : 'hasło'}: ${c.password}`);
  }
  console.log(`\n=== Utworzono konta początkowe ===\n${lines.join('\n')}\n==================================\n`);

  // Plik trafia do server/data (poza repozytorium), żeby dane startowe nie zginęły w konsoli.
  if (db.file !== ':memory:') {
    const target = path.join(path.dirname(db.file), 'initial-credentials.txt');
    fs.writeFileSync(target, `${lines.join('\n')}\n`);
    console.log(`Dane logowania zapisano w: ${target}`);
  }
}

module.exports = { createUser, seed };
