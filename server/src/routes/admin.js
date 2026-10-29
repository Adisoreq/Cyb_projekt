const express = require('express');
const db = require('../db');
const { authenticate, requirePermission, publicUser } = require('../auth');
const { ROLES, ASSIGNABLE_ROLES } = require('../permissions');
const { getSettings, saveSetting, SETTING_KEYS, generateOneTimePassword, storePassword } = require('../security');
const { createUser } = require('../seed');

const router = express.Router();
router.use(authenticate(), requirePermission('users:manage'));

const LOGIN_RE = /^[A-Za-z0-9._-]{3,32}$/;
const isAdminAccount = (user) => user.role === ROLES.ADMIN;
const bad = (res, message, status = 400) => res.status(status).json({ message });

async function findUser(req, res) {
  const user = await db.get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
  if (!user) bad(res, 'Nie znaleziono użytkownika.', 404);
  return user;
}

function validateProfile({ firstName, lastName, role }) {
  const name = (v) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 64;
  if (!name(firstName)) return 'Podaj imię (maks. 64 znaki).';
  if (!name(lastName)) return 'Podaj nazwisko (maks. 64 znaki).';
  if (!ASSIGNABLE_ROLES.includes(role)) return 'Nieprawidłowa rola.';
  return null;
}

router.get('/users', async (req, res) => {
  const users = await db.all('SELECT * FROM users ORDER BY id');
  res.json(users.map((u) => publicUser(u, req.settings)));
});

router.post('/users', async (req, res) => {
  const { login, firstName, lastName, role } = req.body || {};
  if (typeof login !== 'string' || !LOGIN_RE.test(login)) {
    return bad(res, 'Login: 3–32 znaków (litery, cyfry, . _ -).');
  }
  const profileError = validateProfile({ firstName, lastName, role });
  if (profileError) return bad(res, profileError);
  if (await db.get('SELECT id FROM users WHERE lower(login) = lower(?)', login)) {
    return bad(res, 'Użytkownik o takim loginie już istnieje.', 409);
  }

  const oneTimePassword = generateOneTimePassword();
  const id = await createUser({ login, firstName: firstName.trim(), lastName: lastName.trim(), role, password: oneTimePassword, oneTime: true });
  const user = await db.get('SELECT * FROM users WHERE id = ?', id);
  res.status(201).json({ user: publicUser(user, req.settings), oneTimePassword });
});

router.put('/users/:id', async (req, res) => {
  const user = await findUser(req, res);
  if (!user) return;
  if (isAdminAccount(user)) return bad(res, 'Konta ADMIN nie można edytować.', 403);

  const { firstName, lastName, role } = req.body || {};
  const profileError = validateProfile({ firstName, lastName, role });
  if (profileError) return bad(res, profileError);

  await db.run('UPDATE users SET first_name = ?, last_name = ?, role = ? WHERE id = ?', firstName.trim(), lastName.trim(), role, user.id);
  const updated = await db.get('SELECT * FROM users WHERE id = ?', user.id);
  res.json({ user: publicUser(updated, req.settings) });
});

router.patch('/users/:id/block', async (req, res) => {
  const user = await findUser(req, res);
  if (!user) return;
  if (isAdminAccount(user)) return bad(res, 'Konta ADMIN nie można zablokować.', 403);
  if (typeof req.body?.blocked !== 'boolean') return bad(res, 'Podaj pole blocked (true/false).');

  await db.run('UPDATE users SET blocked = ? WHERE id = ?', req.body.blocked, user.id);
  if (req.body.blocked) await db.run('DELETE FROM sessions WHERE user_id = ?', user.id);
  const updated = await db.get('SELECT * FROM users WHERE id = ?', user.id);
  res.json({ user: publicUser(updated, req.settings) });
});

router.post('/users/:id/reset-password', async (req, res) => {
  const user = await findUser(req, res);
  if (!user) return;
  if (isAdminAccount(user)) return bad(res, 'Hasło konta ADMIN zmienia się w panelu użytkownika.', 403);

  const oneTimePassword = generateOneTimePassword();
  await storePassword(user.id, oneTimePassword, { oneTime: true });
  await db.run('DELETE FROM sessions WHERE user_id = ?', user.id);
  const updated = await db.get('SELECT * FROM users WHERE id = ?', user.id);
  res.json({ user: publicUser(updated, req.settings), oneTimePassword });
});

router.delete('/users/:id', async (req, res) => {
  const user = await findUser(req, res);
  if (!user) return;
  if (isAdminAccount(user)) return bad(res, 'Konta ADMIN nie można usunąć.', 403);

  await db.run('DELETE FROM sessions WHERE user_id = ?', user.id);
  await db.run('DELETE FROM password_history WHERE user_id = ?', user.id);
  await db.run('DELETE FROM users WHERE id = ?', user.id);
  res.json({ ok: true });
});

router.get('/settings', (req, res) => res.json(req.settings));

router.put('/settings', async (req, res) => {
  const { policyEnabled, minLength, passwordValidityDays, sessionTimeoutMinutes } = req.body || {};
  const intIn = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

  if (typeof policyEnabled !== 'boolean') return bad(res, 'Polityka haseł musi być włączona lub wyłączona.');
  if (!intIn(minLength, 1, 128)) return bad(res, 'Minimalna długość hasła: 1–128 znaków.');
  if (!intIn(passwordValidityDays, 0, 3650)) return bad(res, 'Ważność hasła: 0–3650 dni (0 = bezterminowo).');
  if (!intIn(sessionTimeoutMinutes, 1, 1440)) return bad(res, 'Czas bezczynności sesji: 1–1440 minut.');

  await saveSetting(SETTING_KEYS.policyEnabled, policyEnabled);
  await saveSetting(SETTING_KEYS.minLength, minLength);
  await saveSetting(SETTING_KEYS.passwordValidityDays, passwordValidityDays);
  await saveSetting(SETTING_KEYS.sessionTimeoutMinutes, sessionTimeoutMinutes);
  res.json(await getSettings());
});

module.exports = router;
