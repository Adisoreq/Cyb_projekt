const express = require('express');
const cors = require('cors');
const db = require('./db');
const { initSecret } = require('./auth');
const { seed } = require('./seed');

function createApp() {
  const app = express();
  app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:3000' }));
  app.use(express.json({ limit: '100kb' }));

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/resources', require('./routes/resources'));

  app.use((req, res) => res.status(404).json({ message: 'Nie znaleziono.' }));
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Nieprawidłowy JSON.' });
    console.error(err);
    res.status(500).json({ message: 'Wystąpił błąd serwera.' });
  });
  return app;
}

async function start() {
  await db.init();
  await initSecret();
  await seed();
  const port = Number(process.env.PORT) || 4000;
  createApp().listen(port, () => console.log(`Serwer nasłuchuje na http://localhost:${port}`));
}

module.exports = { createApp, start };
