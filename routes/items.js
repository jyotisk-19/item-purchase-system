const router = require('express').Router();
const pool = require('../db');
const { HttpError, wrap, parseId, validDate } = require('../utils');

const LOW_STOCK_LIMIT = 5;


const ITEM_SELECT = `
  SELECT i.id, i.name, it.id AS item_type_id, it.type_name, i.purchase_date,
         i.stock_available, i.active, i.created_at, i.updated_at
    FROM items i JOIN item_types it ON i.item_type_id = it.id`;

function shape(r) {
  const s = r.stock_available;
  return { ...r, active: !!r.active,
    availability: s === 0 ? 'Out of Stock' : s <= LOW_STOCK_LIMIT ? 'Low Stock' : 'In Stock' };
}

async function validateItem(b) {
  if (!b || typeof b !== 'object') throw new HttpError(400, 'Invalid request body');
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) throw new HttpError(400, 'Item name is required');
  if (name.length > 150) throw new HttpError(400, 'Item name is too long (max 150)');

  if (b.item_type_id === undefined || b.item_type_id === null || b.item_type_id === '')
    throw new HttpError(400, 'Item type is required');
  const typeId = Number(b.item_type_id);
  if (!Number.isInteger(typeId) || typeId <= 0) throw new HttpError(400, 'Invalid item type');
  const [t] = await pool.query('SELECT id FROM item_types WHERE id=?', [typeId]);
  if (!t.length) throw new HttpError(400, 'Invalid item type');

  if (!validDate(b.purchase_date)) throw new HttpError(400, 'Purchase date is required and must be a valid date (YYYY-MM-DD)');

  if (b.stock_available === undefined || b.stock_available === null || b.stock_available === '')
    throw new HttpError(400, 'Stock available is required');
  const stock = Number(b.stock_available);
  if (!Number.isFinite(stock)) throw new HttpError(400, 'Stock must be a number');
  if (stock < 0) throw new HttpError(400, 'Stock cannot be negative');
  if (!Number.isInteger(stock)) throw new HttpError(400, 'Stock must be a whole number');

  let active;
  if ([true, 1, '1', 'true'].includes(b.active)) active = 1;
  else if ([false, 0, '0', 'false'].includes(b.active)) active = 0;
  else throw new HttpError(400, 'Status (active) is required: true or false');

  return { name, typeId, date: b.purchase_date, stock, active };
}

async function findItem(id) {
  const [rows] = await pool.query(ITEM_SELECT + ' WHERE i.id = ?', [id]);
  if (!rows.length) throw new HttpError(404, 'Item not found');
  return rows[0];
}

router.get('/', wrap(async (req, res) => {
  let sql = ITEM_SELECT;
  if (req.query.active === '1' || req.query.active === 'true') sql += ' WHERE i.active = 1';
  const [rows] = await pool.query(sql + ' ORDER BY i.id');
  res.json(rows.map(shape));
}));

router.get('/:id', wrap(async (req, res) => {
  const id = parseId(req.params.id, 'item id');
  const item = shape(await findItem(id));
  const [[c]] = await pool.query('SELECT COUNT(*) AS n FROM purchase_items WHERE item_id=?', [id]);
  item.used_in_purchases = c.n;
  res.json(item);
}));

router.post('/', wrap(async (req, res) => {
  const v = await validateItem(req.body);
  const [r] = await pool.query(
    'INSERT INTO items (name, purchase_date, stock_available, item_type_id, active) VALUES (?,?,?,?,?)',
    [v.name, v.date, v.stock, v.typeId, v.active]);
  res.status(201).json(shape(await findItem(r.insertId)));
}));

router.put('/:id', wrap(async (req, res) => {
  const id = parseId(req.params.id, 'item id');
  await findItem(id);
  const v = await validateItem(req.body);
  await pool.query(
    'UPDATE items SET name=?, purchase_date=?, stock_available=?, item_type_id=?, active=? WHERE id=?',
    [v.name, v.date, v.stock, v.typeId, v.active, id]);
  res.json(shape(await findItem(id)));
}));


router.patch('/:id/status', wrap(async (req, res) => {
  const id = parseId(req.params.id, 'item id');
  await findItem(id);
  const a = req.body && req.body.active;
  if (![true, false, 1, 0].includes(a)) throw new HttpError(400, 'Status (active) must be true or false');
  await pool.query('UPDATE items SET active=? WHERE id=?', [a ? 1 : 0, id]);
  res.json(shape(await findItem(id)));
}));


router.delete('/:id', wrap(async (req, res) => {
  const id = parseId(req.params.id, 'item id');
  await findItem(id);
  const [[c]] = await pool.query('SELECT COUNT(*) AS n FROM purchase_items WHERE item_id=?', [id]);
  if (c.n > 0)
    throw new HttpError(409, 'Item is used in purchase history and cannot be deleted. Mark it Inactive instead.');
  await pool.query('DELETE FROM items WHERE id=?', [id]);
  res.json({ message: 'Item deleted' });
}));

module.exports = router;
