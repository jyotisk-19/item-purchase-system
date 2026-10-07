const router = require('express').Router();
const crypto = require('crypto');
const pool = require('../db');
const { HttpError, wrap, parseId, validDate } = require('../utils');

function parseLines(items) {
  if (!Array.isArray(items) || items.length === 0)
    throw new HttpError(400, 'Purchase must contain at least one item');
  const seen = new Set();
  return items.map(l => {
    const itemId = Number(l && l.item_id);
    const qty = Number(l && l.quantity);
    if (!Number.isInteger(itemId) || itemId <= 0) throw new HttpError(400, 'Invalid item id in purchase line');
    if (!Number.isFinite(qty) || qty <= 0) throw new HttpError(400, 'Quantity must be greater than zero');
    if (!Number.isInteger(qty)) throw new HttpError(400, 'Quantity must be a whole number');
    if (seen.has(itemId)) throw new HttpError(400, 'Duplicate item in the same order. Combine quantities into one line');
    seen.add(itemId);
    return { item_id: itemId, quantity: qty };
  });
}

async function lockItems(conn, ids) {
  const [rows] = await conn.query(
    'SELECT id, name, stock_available, active FROM items WHERE id IN (?) ORDER BY id FOR UPDATE', [ids]);
  return new Map(rows.map(r => [r.id, r]));
}

function checkDeduct(item, itemId, need) {
  if (!item) throw new HttpError(404, `Item not found (id ${itemId})`);
  if (!item.active) throw new HttpError(409, `Item is inactive and cannot be purchased: ${item.name}`);
  if (need > item.stock_available)
    throw new HttpError(409, `Insufficient stock for ${item.name}; available: ${item.stock_available}, requested: ${need}`,
      { item_id: itemId, available: item.stock_available, requested: need });
}


async function fetchPurchase(db, key) {
  const col = /^\d+$/.test(String(key)) ? 'p.id' : 'p.order_id';
  const [head] = await db.query(
    `SELECT p.id, p.order_id, p.purchase_date, p.created_at, p.updated_at FROM purchases p WHERE ${col} = ?`, [key]);
  if (!head.length) return null;
  const [rows] = await db.query(
    `SELECT p.order_id, p.purchase_date, pi.id AS line_id, i.id AS item_id, i.name AS item_name,
            it.type_name, pi.quantity, i.stock_available, i.active
       FROM purchases p
       JOIN purchase_items pi ON p.id = pi.purchase_id
       JOIN items i ON pi.item_id = i.id
       JOIN item_types it ON i.item_type_id = it.id
      WHERE p.id = ? ORDER BY pi.id`, [head[0].id]);
  const items = rows.map(r => ({
    line_id: r.line_id, item_id: r.item_id, item_name: r.item_name, type_name: r.type_name,
    quantity: r.quantity, current_stock: r.stock_available, item_active: !!r.active,
    availability: r.stock_available === 0 ? 'Out of Stock' : r.stock_available <= 5 ? 'Low Stock' : 'In Stock'
  }));
  return { ...head[0], total_quantity: items.reduce((s, x) => s + x.quantity, 0), items };
}


router.get('/', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.id, p.order_id, p.purchase_date, p.created_at,
            COUNT(pi.id) AS line_count, COALESCE(SUM(pi.quantity),0) AS total_quantity
       FROM purchases p LEFT JOIN purchase_items pi ON p.id = pi.purchase_id
      GROUP BY p.id, p.order_id, p.purchase_date, p.created_at
      ORDER BY p.id DESC`);
  res.json(rows);
}));

router.get('/:id', wrap(async (req, res) => {
  const key = String(req.params.id).trim();
  if (!key || key.length > 50) throw new HttpError(400, 'Invalid purchase id');
  const p = await fetchPurchase(pool, key);
  if (!p) throw new HttpError(404, 'Purchase not found');
  res.json(p);
}));

router.post('/', wrap(async (req, res) => {
  const b = req.body || {};
  if (!validDate(b.purchase_date)) throw new HttpError(400, 'Purchase date is required and must be a valid date (YYYY-MM-DD)');
  const lines = parseLines(b.items);
  let orderId = null;
  if (b.order_id !== undefined && b.order_id !== null && String(b.order_id).trim() !== '') {
    orderId = String(b.order_id).trim();
    if (orderId.length > 50) throw new HttpError(400, 'Order ID is too long (max 50)');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();                                   // BEGIN
    const map = await lockItems(conn, lines.map(l => l.item_id));
    for (const l of lines) checkDeduct(map.get(l.item_id), l.item_id, l.quantity); // validate all items + stock

    let purchaseId;
    try {                                                            // insert purchase
      const [r] = await conn.query('INSERT INTO purchases (order_id, purchase_date) VALUES (?,?)',
        [orderId || `TMP-${crypto.randomUUID()}`, b.purchase_date]);
      purchaseId = r.insertId;
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'Order ID already exists');
      throw e;
    }
    if (!orderId) {
      orderId = `PO-${String(purchaseId).padStart(5, '0')}`;
      await conn.query('UPDATE purchases SET order_id=? WHERE id=?', [orderId, purchaseId]);
    }
    await conn.query('INSERT INTO purchase_items (purchase_id, item_id, quantity) VALUES ?',   // insert lines
      [lines.map(l => [purchaseId, l.item_id, l.quantity])]);
    for (const l of lines) {                                         // deduct stock
      const [u] = await conn.query(
        'UPDATE items SET stock_available = stock_available - ? WHERE id=? AND stock_available >= ?',
        [l.quantity, l.item_id, l.quantity]);
      if (u.affectedRows !== 1) throw new HttpError(409, 'Insufficient stock');
    }
    await conn.commit();                                             // COMMIT
    res.status(201).json(await fetchPurchase(pool, purchaseId));
  } catch (e) {
    await conn.rollback().catch(() => {});                           // ROLLBACK on any failure
    throw e;
  } finally {
    conn.release();
  }
}));


router.put('/:id', wrap(async (req, res) => {
  const id = parseId(req.params.id, 'purchase id');
  const b = req.body || {};
  if (!validDate(b.purchase_date)) throw new HttpError(400, 'Purchase date is required and must be a valid date (YYYY-MM-DD)');
  const lines = parseLines(b.items);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [p] = await conn.query('SELECT id FROM purchases WHERE id=? FOR UPDATE', [id]);
    if (!p.length) throw new HttpError(404, 'Purchase not found');

    const [oldRows] = await conn.query('SELECT item_id, quantity FROM purchase_items WHERE purchase_id=?', [id]);
    const oldQty = new Map(oldRows.map(r => [r.item_id, r.quantity]));
    const newQty = new Map(lines.map(l => [l.item_id, l.quantity]));
    const allIds = [...new Set([...oldQty.keys(), ...newQty.keys()])];
    const map = await lockItems(conn, allIds);

    
    const diffs = [];
    for (const itemId of allIds) {
      const diff = (newQty.get(itemId) || 0) - (oldQty.get(itemId) || 0);
      if (diff > 0) checkDeduct(map.get(itemId), itemId, diff);
      if (diff !== 0) diffs.push({ itemId, diff });
    }
    for (const { itemId, diff } of diffs) {
      const [u] = await conn.query(
        'UPDATE items SET stock_available = stock_available - ? WHERE id=? AND stock_available - ? >= 0',
        [diff, itemId, diff]);
      if (u.affectedRows !== 1) throw new HttpError(409, 'Insufficient stock');
    }
    await conn.query('DELETE FROM purchase_items WHERE purchase_id=?', [id]); // lines only; purchase itself is never deleted
    await conn.query('INSERT INTO purchase_items (purchase_id, item_id, quantity) VALUES ?',
      [lines.map(l => [id, l.item_id, l.quantity])]);
    await conn.query('UPDATE purchases SET purchase_date=? WHERE id=?', [b.purchase_date, id]);
    await conn.commit();
    res.json(await fetchPurchase(pool, id));
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}));


module.exports = router;
