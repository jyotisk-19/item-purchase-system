class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}


const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function parseId(v, label = 'ID') {
  if (!/^\d+$/.test(String(v)) || Number(v) <= 0) throw new HttpError(400, `Invalid ${label}`);
  return Number(v);
}

function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON request body' });
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Duplicate value: record already exists' });
  if (err.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ error: 'Record is referenced by other data and cannot be removed' });
  console.error(err);                                   // log full error on server only
  res.status(500).json({ error: 'Internal server error' }); // safe message for client
}

module.exports = { HttpError, wrap, parseId, validDate, errorHandler };
