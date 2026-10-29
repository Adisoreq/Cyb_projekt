const express = require('express');
const db = require('../db');
const { authenticate, requirePermission } = require('../auth');
const { RESOURCE_TYPES, validateResourceData } = require('../resourceTypes');

const router = express.Router();
router.use(authenticate());

const toResource = (row) => ({
  id: row.id,
  type: row.type,
  data: JSON.parse(row.data),
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const notFound = (res) => res.status(404).json({ message: 'Nie znaleziono zasobu.' });

router.get('/types', requirePermission('resources:read'), (req, res) => res.json(RESOURCE_TYPES));

router.get('/', requirePermission('resources:read'), async (req, res) => {
  const { type } = req.query;
  if (type !== undefined && !RESOURCE_TYPES[type]) return res.status(400).json({ message: 'Nieznany typ zasobu.' });
  const rows = type
    ? await db.all('SELECT * FROM resources WHERE type = ? ORDER BY id', type)
    : await db.all('SELECT * FROM resources ORDER BY type, id');
  res.json(rows.map(toResource));
});

router.post('/', requirePermission('resources:create'), async (req, res) => {
  const { type, data: input } = req.body || {};
  const { data, error } = validateResourceData(type, input);
  if (error) return res.status(400).json({ message: error });

  const now = Date.now();
  const [row] = await db.all(
    `INSERT INTO resources (id, type, data, created_by, created_at, updated_at)
     VALUES (nextval('resources_seq'), ?, ?, ?, ?, ?) RETURNING *`,
    type,
    JSON.stringify(data),
    req.user.login,
    now,
    now
  );
  res.status(201).json(toResource(row));
});

router.put('/:id', requirePermission('resources:update'), async (req, res) => {
  const existing = await db.get('SELECT * FROM resources WHERE id = ?', Number(req.params.id));
  if (!existing) return notFound(res);

  const { data, error } = validateResourceData(existing.type, req.body?.data);
  if (error) return res.status(400).json({ message: error });

  await db.run('UPDATE resources SET data = ?, updated_at = ? WHERE id = ?', JSON.stringify(data), Date.now(), existing.id);
  res.json(toResource(await db.get('SELECT * FROM resources WHERE id = ?', existing.id)));
});

router.delete('/:id', requirePermission('resources:delete'), async (req, res) => {
  const existing = await db.get('SELECT * FROM resources WHERE id = ?', Number(req.params.id));
  if (!existing) return notFound(res);
  await db.run('DELETE FROM resources WHERE id = ?', existing.id);
  res.json({ ok: true });
});

module.exports = router;
