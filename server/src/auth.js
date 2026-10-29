const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { getSettings, saveSetting } = require('./security');
const { can, permissionsFor } = require('./permissions');

const TOKEN_LIFETIME = '12h';
let jwtSecret;

async function initSecret() {
  if (process.env.JWT_SECRET) {
    jwtSecret = process.env.JWT_SECRET;
    return;
  }
  const row = await db.get(`SELECT value FROM settings WHERE key = 'jwt_secret'`);
  if (row) {
    jwtSecret = row.value;
  } else {
    jwtSecret = crypto.randomBytes(48).toString('hex');
    await saveSetting('jwt_secret', jwtSecret);
  }
}

async function createSession(userId) {
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.run('INSERT INTO sessions (id, user_id, created_at, last_activity) VALUES (?, ?, ?, ?)', id, userId, now, now);
  const token = jwt.sign({ sub: String(userId), sid: id }, jwtSecret, { algorithm: 'HS256', expiresIn: TOKEN_LIFETIME });
  return token;
}

function isPasswordExpired(user, settings) {
  const days = settings.passwordValidityDays;
  return days > 0 && Date.now() - user.password_changed_at > days * 24 * 60 * 60 * 1000;
}

function mustChangePassword(user, settings) {
  return Boolean(user.must_change_password) || isPasswordExpired(user, settings);
}

function publicUser(user, settings) {
  const days = settings.passwordValidityDays;
  return {
    id: user.id,
    login: user.login,
    firstName: user.first_name,
    lastName: user.last_name,
    role: user.role,
    blocked: Boolean(user.blocked),
    mustChangePassword: mustChangePassword(user, settings),
    oneTimePasswordExpires: user.one_time_expires || null,
    passwordExpiresAt: days > 0 ? user.password_changed_at + days * 24 * 60 * 60 * 1000 : null,
    permissions: permissionsFor(user.role),
  };
}

const unauthorized = (res, code, message) => res.status(401).json({ code, message });

// Uwierzytelnia JWT, pilnuje bezczynności sesji i wymuszonej zmiany hasła.
function authenticate({ allowPasswordChange = false } = {}) {
  return async (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return unauthorized(res, 'UNAUTHENTICATED', 'Wymagane logowanie.');

    let payload;
    try {
      payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
    } catch {
      return unauthorized(res, 'UNAUTHENTICATED', 'Sesja jest nieprawidłowa lub wygasła.');
    }

    const session = await db.get('SELECT * FROM sessions WHERE id = ?', payload.sid);
    if (!session) return unauthorized(res, 'UNAUTHENTICATED', 'Sesja została zakończona.');

    const settings = await getSettings();
    const now = Date.now();
    if (now - session.last_activity > settings.sessionTimeoutMinutes * 60 * 1000) {
      await db.run('DELETE FROM sessions WHERE id = ?', session.id);
      return unauthorized(res, 'SESSION_EXPIRED', 'Sesja wygasła z powodu bezczynności.');
    }

    const user = await db.get('SELECT * FROM users WHERE id = ?', session.user_id);
    if (!user || user.blocked) {
      await db.run('DELETE FROM sessions WHERE id = ?', session.id);
      return unauthorized(res, 'UNAUTHENTICATED', 'Konto jest niedostępne.');
    }

    await db.run('UPDATE sessions SET last_activity = ? WHERE id = ?', now, session.id);

    req.user = user;
    req.session = session;
    req.settings = settings;
    if (!allowPasswordChange && mustChangePassword(user, settings)) {
      return res.status(403).json({ code: 'PASSWORD_CHANGE_REQUIRED', message: 'Wymagana zmiana hasła.' });
    }
    next();
  };
}

const requirePermission = (permission) => (req, res, next) => {
  if (!can(req.user.role, permission)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Brak uprawnień do wykonania tej operacji.' });
  }
  next();
};

module.exports = { initSecret, createSession, authenticate, requirePermission, publicUser, mustChangePassword };
