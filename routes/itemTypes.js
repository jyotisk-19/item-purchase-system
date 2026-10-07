const router = require('express').Router();
const pool = require('../db');
const { HttpError, wrap, parseId } = require('../utils');

function readName(body) {
  const name = body && typeof body.type_name === 'string' ? body.type_name.trim() : '';
  if (!name) throw new HttpError(400, 'Item type name is required');
  if (name.length > 100) throw new HttpError(400, 'Item type name is too long (max 100)');
  return name;
}

router.get('/', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT it.id, it.type_name, COUNT(i.id) AS item_count
       FROM item_types it LEFT JOIN items i ON i.item_type_id = it.id
      GROUP BY it.id, it.type_name ORDER BY it.type_name`);
  res.json(rows);
}));

router.post('/', wrap(async (req, res) => {
  const name = readName(req.body);
  try {
    const [r] = await pool.query('INSERT INTO item_types (type_name) VALUES (?)', [name]);
    res.status(201).json({ id: r.insertId, type_name: name });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'Item type already exists');
    throw e;
  }
}));

router.put('/:id', wrap(async (req, res) => {
  const id = parseId(req.params.id, 'item type id');
  const name = readName(req.body);
  const [ex] = await pool.query('SELECT id FROM item_types WHERE id=?', [id]);
  if (!ex.length) throw new HttpError(404, 'Item type not found');
  try {
    await pool.query('UPDATE item_types SET type_name=? WHERE id=?', [name, id]);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'Item type already exists');
    throw e;
  }
  res.json({ id, type_name: name });
}));

router.delete('/:id', wrap(async (req, res) => {
  const id = parseId(req.params.id, 'item type id');
  const [ex] = await pool.query('SELECT id FROM item_types WHERE id=?', [id]);
  if (!ex.length) throw new HttpError(404, 'Item type not found');
  const [[c]] = await pool.query('SELECT COUNT(*) AS n FROM items WHERE item_type_id=?', [id]);
  if (c.n > 0) throw new HttpError(409, 'Cannot delete: items exist under this item type');
  await pool.query('DELETE FROM item_types WHERE id=?', [id]);
  res.json({ message: 'Item type deleted' });
}));

module.exports = router;
