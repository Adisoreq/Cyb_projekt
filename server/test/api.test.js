process.env.DB_FILE = ':memory:';

const test = require('node:test');
const assert = require('node:assert');
const db = require('../src/db');
const { initSecret } = require('../src/auth');
const { seed } = require('../src/seed');
const { createApp } = require('../src/app');
const { storePassword, generateOneTimePassword } = require('../src/security');

const ADMIN_OTP = 'Start-Admin#2026x';
let base;
let server;

async function api(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

const login = (l, p) => api('POST', '/api/auth/login', { body: { login: l, password: p } });

test.before(async () => {
  await db.init();
  await initSecret();
  const log = console.log;
  console.log = () => {};
  await seed();
  console.log = log;
  const admin = await db.get(`SELECT id FROM users WHERE login = 'ADMIN'`);
  await storePassword(admin.id, ADMIN_OTP, { oneTime: true });
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}`;
});

test.after(() => server.close());

test('generated one-time password has 16 chars with letters, digits and specials', () => {
  const p = generateOneTimePassword();
  assert.strictEqual(p.length, 16);
  assert.match(p, /[A-Za-z]/);
  assert.match(p, /\d/);
  assert.match(p, /[^A-Za-z0-9]/);
});

test('wrong credentials give the generic message', async () => {
  const bad1 = await login('ADMIN', 'zle-haslo');
  const bad2 = await login('nieistnieje', 'zle-haslo');
  assert.strictEqual(bad1.status, 401);
  assert.strictEqual(bad1.body.message, 'Login lub hasło niepoprawne');
  assert.deepStrictEqual(bad2.body, bad1.body);
});

test('admin first login forces password change, policy and history are enforced', async () => {
  const res = await login('ADMIN', ADMIN_OTP);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.mustChangePassword, true);
  const token = res.body.token;

  assert.strictEqual((await api('GET', '/api/resources', { token })).status, 403);

  const change = (newPassword, confirmPassword = newPassword) =>
    api('POST', '/api/auth/change-password', { token, body: { oldPassword: ADMIN_OTP, newPassword, confirmPassword } });

  assert.strictEqual((await change('Krotkie1!')).status, 400);
  assert.strictEqual((await change('xxADMINxxxxxxxxxx')).status, 400);
  assert.strictEqual((await change('Dlugie-haslo-1!', 'Inne-haslo-1234!')).status, 400);
  assert.strictEqual((await change(ADMIN_OTP)).status, 400);
  const ok = await change('Nowe-Haslo-Szefa#1');
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.body.user.mustChangePassword, false);
  assert.strictEqual((await api('GET', '/api/resources', { token })).status, 200);

  const again = await api('POST', '/api/auth/change-password', {
    token,
    body: { oldPassword: 'Nowe-Haslo-Szefa#1', newPassword: ADMIN_OTP, confirmPassword: ADMIN_OTP },
  });
  assert.strictEqual(again.status, 400);
});

test('admin manages users; one-time password flow; roles', async () => {
  const adminToken = (await login('ADMIN', 'Nowe-Haslo-Szefa#1')).body.token;

  const created = await api('POST', '/api/admin/users', {
    token: adminToken,
    body: { login: 'tester', firstName: 'Tomasz', lastName: 'Testowy', role: 'Pracownik' },
  });
  assert.strictEqual(created.status, 201);
  const { oneTimePassword, user } = created.body;
  assert.strictEqual(oneTimePassword.length, 16);

  const first = await login('tester', oneTimePassword);
  assert.strictEqual(first.body.mustChangePassword, true);
  const tToken = first.body.token;
  assert.strictEqual((await api('GET', '/api/admin/users', { token: tToken })).status, 403);

  const bad = await api('POST', '/api/auth/change-password', {
    token: tToken,
    body: { oldPassword: oneTimePassword, newPassword: 'Tomasz-super-haslo1', confirmPassword: 'Tomasz-super-haslo1' },
  });
  assert.strictEqual(bad.status, 400);
  const good = await api('POST', '/api/auth/change-password', {
    token: tToken,
    body: { oldPassword: oneTimePassword, newPassword: 'Zupelnie-inne-1!', confirmPassword: 'Zupelnie-inne-1!' },
  });
  assert.strictEqual(good.status, 200);

  const type = 'devices';
  const data = { name: 'Router', deviceType: 'Serwer', serialNumber: 'R-1', location: '', condition: 'Sprawny' };
  const createdRes = await api('POST', '/api/resources', { token: tToken, body: { type, data } });
  assert.strictEqual(createdRes.status, 201);
  assert.strictEqual((await api('DELETE', `/api/resources/${createdRes.body.id}`, { token: tToken })).status, 403);
  assert.strictEqual((await api('POST', '/api/resources', { token: tToken, body: { type, data: { ...data, condition: 'x' } } })).status, 400);

  // blokada zamyka sesję i uniemożliwia logowanie
  await api('PATCH', `/api/admin/users/${user.id}/block`, { token: adminToken, body: { blocked: true } });
  assert.strictEqual((await api('GET', '/api/resources', { token: tToken })).status, 401);
  assert.strictEqual((await login('tester', 'Zupelnie-inne-1!')).status, 403);
  await api('PATCH', `/api/admin/users/${user.id}/block`, { token: adminToken, body: { blocked: false } });

  const reset = await api('POST', `/api/admin/users/${user.id}/reset-password`, { token: adminToken });
  assert.strictEqual((await login('tester', reset.body.oneTimePassword)).body.mustChangePassword, true);

  // ADMIN jest chroniony
  const adminUser = (await api('GET', '/api/admin/users', { token: adminToken })).body.find((u) => u.login === 'ADMIN');
  assert.strictEqual((await api('DELETE', `/api/admin/users/${adminUser.id}`, { token: adminToken })).status, 403);

  assert.strictEqual((await api('DELETE', `/api/admin/users/${user.id}`, { token: adminToken })).status, 200);
});

test('guest can only read; session idle timeout and logout work', async () => {
  const g = await login('kmazur', 'Test-Haslo#2026');
  assert.strictEqual(g.body.mustChangePassword, false);
  const token = g.body.token;
  assert.strictEqual((await api('GET', '/api/resources?type=documents', { token })).status, 200);
  assert.strictEqual((await api('POST', '/api/resources', { token, body: { type: 'documents', data: {} } })).status, 403);

  await db.run('UPDATE sessions SET last_activity = ? WHERE user_id = (SELECT id FROM users WHERE login = ?)', Date.now() - 16 * 60000, 'kmazur');
  const expired = await api('GET', '/api/resources', { token });
  assert.strictEqual(expired.status, 401);
  assert.strictEqual(expired.body.code, 'SESSION_EXPIRED');

  const t2 = (await login('kmazur', 'Test-Haslo#2026')).body.token;
  await api('POST', '/api/auth/logout', { token: t2 });
  assert.strictEqual((await api('GET', '/api/resources', { token: t2 })).status, 401);
});

test('expired one-time password and password validity', async () => {
  const ewa = await db.get(`SELECT id FROM users WHERE login = 'ewojcik'`);
  await storePassword(ewa.id, 'Jednorazowe-1234!', { oneTime: true });
  await db.run(`UPDATE users SET one_time_expires = ? WHERE login = 'ewojcik'`, Date.now() - 1000);
  assert.strictEqual((await login('ewojcik', 'Jednorazowe-1234!')).status, 403);

  await db.run(`UPDATE users SET password_changed_at = ? WHERE login = 'jkowalski'`, Date.now() - 91 * 86400000);
  assert.strictEqual((await login('jkowalski', 'Test-Haslo#2026')).body.mustChangePassword, true);
});

test('admin updates settings with validation', async () => {
  const adminToken = (await login('ADMIN', 'Nowe-Haslo-Szefa#1')).body.token;
  const put = (body) => api('PUT', '/api/admin/settings', { token: adminToken, body });
  assert.strictEqual((await put({ policyEnabled: true, minLength: 0, passwordValidityDays: 90, sessionTimeoutMinutes: 15 })).status, 400);
  const ok = await put({ policyEnabled: false, minLength: 12, passwordValidityDays: 30, sessionTimeoutMinutes: 5 });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.body.sessionTimeoutMinutes, 5);
});
