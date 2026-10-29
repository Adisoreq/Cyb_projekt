const express = require('express');
const db = require('../db');
const { getSettings, verifyPassword, hashPassword, checkPolicy, isPasswordReused, storePassword } = require('../security');
const { createSession, authenticate, publicUser } = require('../auth');

const router = express.Router();

const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const failedAttempts = new Map();

const attemptKey = (req, login) => `${req.ip}|${String(login).toLowerCase()}`;

function isThrottled(key) {
  const recent = (failedAttempts.get(key) || []).filter((t) => Date.now() - t < ATTEMPT_WINDOW_MS);
  failedAttempts.set(key, recent);
  return recent.length >= MAX_ATTEMPTS;
}

function recordFailure(key) {
  failedAttempts.set(key, [...(failedAttempts.get(key) || []), Date.now()]);
}

// Hash używany do wyrównania czasu odpowiedzi, gdy login nie istnieje.
let dummyCredentials;
hashPassword('dummy-password').then((c) => (dummyCredentials = c));

router.post('/login', async (req, res) => {
  const { login, password } = req.body || {};
  if (typeof login !== 'string' || typeof password !== 'string' || !login || !password) {
    return res.status(400).json({ message: 'Podaj login i hasło.' });
  }

  const key = attemptKey(req, login);
  if (isThrottled(key)) {
    return res.status(429).json({ message: 'Zbyt wiele nieudanych prób logowania. Spróbuj ponownie za kilka minut.' });
  }

  const user = await db.get('SELECT * FROM users WHERE lower(login) = lower(?)', login);
  let valid = false;
  if (user) {
    valid = await verifyPassword(password, user.salt, user.password_hash);
  } else if (dummyCredentials) {
    await verifyPassword(password, dummyCredentials.salt, dummyCredentials.hash);
  }
  if (!valid) {
    recordFailure(key);
    return res.status(401).json({ message: 'Login lub hasło niepoprawne' });
  }

  if (user.blocked) return res.status(403).json({ message: 'Konto zostało zablokowane. Skontaktuj się z administratorem.' });
  if (user.one_time_expires && Date.now() > user.one_time_expires) {
    return res.status(403).json({ message: 'Hasło jednorazowe wygasło. Poproś administratora o nowe.' });
  }

  failedAttempts.delete(key);
  const settings = await getSettings();
  await db.run('DELETE FROM sessions WHERE last_activity < ?', Date.now() - settings.sessionTimeoutMinutes * 60 * 1000);
  const token = await createSession(user.id);
  const pub = publicUser(user, settings);
  res.json({ token, user: pub, mustChangePassword: pub.mustChangePassword, sessionTimeoutMinutes: settings.sessionTimeoutMinutes });
});

router.post('/logout', authenticate({ allowPasswordChange: true }), async (req, res) => {
  await db.run('DELETE FROM sessions WHERE id = ?', req.session.id);
  res.json({ ok: true });
});

router.get('/me', authenticate({ allowPasswordChange: true }), (req, res) => {
  res.json({ user: publicUser(req.user, req.settings), sessionTimeoutMinutes: req.settings.sessionTimeoutMinutes });
});

// Odświeża aktywność sesji (samo przejście przez middleware aktualizuje last_activity).
router.post('/ping', authenticate({ allowPasswordChange: true }), (req, res) => {
  res.json({ ok: true });
});

router.get('/password-policy', authenticate({ allowPasswordChange: true }), (req, res) => {
  const { policyEnabled, minLength } = req.settings;
  res.json({ policyEnabled, minLength });
});

router.post('/change-password', authenticate({ allowPasswordChange: true }), async (req, res) => {
  const { oldPassword, newPassword, confirmPassword } = req.body || {};
  if ([oldPassword, newPassword, confirmPassword].some((v) => typeof v !== 'string' || !v)) {
    return res.status(400).json({ message: 'Wypełnij wszystkie pola.' });
  }
  const user = req.user;
  if (!(await verifyPassword(oldPassword, user.salt, user.password_hash))) {
    return res.status(400).json({ message: 'Obecne hasło jest niepoprawne.' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ message: 'Nowe hasła nie są identyczne.' });
  }
  const errors = checkPolicy(newPassword, user, req.settings);
  if (errors.length) return res.status(400).json({ message: errors.join(' '), errors });
  if (await isPasswordReused(user.id, newPassword)) {
    return res.status(400).json({ message: 'Nowe hasło musi różnić się od poprzednich haseł.' });
  }

  await storePassword(user.id, newPassword, { oneTime: false });
  const updated = await db.get('SELECT * FROM users WHERE id = ?', user.id);
  res.json({ user: publicUser(updated, req.settings) });
});

module.exports = router;
