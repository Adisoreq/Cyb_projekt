// Nadaje kontu ADMIN nowe hasło jednorazowe (np. po jego utracie). Uruchom: npm run reset-admin
const db = require('../src/db');
const { generateOneTimePassword, storePassword } = require('../src/security');

(async () => {
  await db.init();
  const admin = await db.get(`SELECT id FROM users WHERE login = 'ADMIN'`);
  if (!admin) {
    console.error('Konto ADMIN nie istnieje – uruchom najpierw serwer.');
    process.exit(1);
  }
  const password = generateOneTimePassword();
  await storePassword(admin.id, password, { oneTime: true });
  await db.run('DELETE FROM sessions WHERE user_id = ?', admin.id);
  console.log(`Nowe hasło jednorazowe dla ADMIN (ważne 12h): ${password}`);
})();
