const crypto = require('crypto');
const db = require('./db');

const MAX_PASSWORD_LENGTH = 128;
const ONE_TIME_LENGTH = 16;
const ONE_TIME_VALIDITY_MS = 12 * 60 * 60 * 1000;

const scrypt = (password, salt) =>
  new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key)));
  });

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt)).toString('hex');
  return { salt, hash };
}

async function verifyPassword(password, salt, hash) {
  const candidate = await scrypt(password, salt);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SPECIALS = '!@#$%^&*()-_=+?';

// 16 znaków: litery, cyfry i znaki specjalne (co najmniej po jednym z każdej grupy).
function generateOneTimePassword() {
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = [pick(LETTERS), pick(DIGITS), pick(SPECIALS)];
  const all = LETTERS + DIGITS + SPECIALS;
  while (chars.length < ONE_TIME_LENGTH) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

const DEFAULT_SETTINGS = {
  policy_enabled: 'true',
  min_length: '12',
  password_validity_days: '90',
  session_timeout_minutes: '15',
};

const SETTING_KEYS = {
  policyEnabled: 'policy_enabled',
  minLength: 'min_length',
  passwordValidityDays: 'password_validity_days',
  sessionTimeoutMinutes: 'session_timeout_minutes',
};

async function getSettings() {
  const rows = await db.all('SELECT key, value FROM settings');
  const raw = { ...DEFAULT_SETTINGS };
  for (const r of rows) raw[r.key] = r.value;
  return {
    policyEnabled: raw.policy_enabled === 'true',
    minLength: Number(raw.min_length),
    passwordValidityDays: Number(raw.password_validity_days),
    sessionTimeoutMinutes: Number(raw.session_timeout_minutes),
  };
}

async function saveSetting(key, value) {
  await db.run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    key,
    String(value)
  );
}

// Zwraca listę błędów polityki haseł (pusta = hasło poprawne).
function checkPolicy(password, user, settings) {
  if (!password) return ['Hasło nie może być puste.'];
  const errors = [];
  if (password.length > MAX_PASSWORD_LENGTH) {
    errors.push(`Hasło może mieć maksymalnie ${MAX_PASSWORD_LENGTH} znaków.`);
  }
  if (!settings.policyEnabled) return errors;

  if (password.length < settings.minLength) {
    errors.push(`Hasło musi mieć co najmniej ${settings.minLength} znaków.`);
  }
  const lower = password.toLowerCase();
  const forbidden = [
    ['imienia', user.first_name],
    ['nazwiska', user.last_name],
    ['loginu', user.login],
  ];
  for (const [label, value] of forbidden) {
    if (value && lower.includes(String(value).toLowerCase())) {
      errors.push(`Hasło nie może zawierać ${label} użytkownika.`);
    }
  }
  return errors;
}

// Historia zawiera także aktualne hasło, więc nowe musi różnić się od wszystkich poprzednich.
async function isPasswordReused(userId, password) {
  const rows = await db.all('SELECT password_hash, salt FROM password_history WHERE user_id = ?', userId);
  for (const row of rows) {
    if (await verifyPassword(password, row.salt, row.password_hash)) return true;
  }
  return false;
}

async function storePassword(userId, password, { oneTime = false }) {
  const { salt, hash } = await hashPassword(password);
  const now = Date.now();
  // Wartość NULL wstawiana jest literałem, bo sterownik duckdb nie przyjmuje null jako parametru.
  await db.run(
    `UPDATE users SET password_hash = ?, salt = ?, must_change_password = ?, one_time_expires = ${oneTime ? '?' : 'NULL'}, password_changed_at = ?
     WHERE id = ?`,
    hash,
    salt,
    oneTime,
    ...(oneTime ? [now + ONE_TIME_VALIDITY_MS] : []),
    now,
    userId
  );
  await db.run(
    'INSERT INTO password_history (user_id, password_hash, salt, created_at) VALUES (?, ?, ?, ?)',
    userId,
    hash,
    salt,
    now
  );
}

module.exports = {
  MAX_PASSWORD_LENGTH,
  SETTING_KEYS,
  hashPassword,
  verifyPassword,
  generateOneTimePassword,
  getSettings,
  saveSetting,
  checkPolicy,
  isPasswordReused,
  storePassword,
};
