const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => new Date().toISOString().slice(0, 10);

let types = [], items = [], lines = [], editingPurchase = null;

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}
const run = fn => fn().catch(e => toast(e.message, true));

let toastTimer;
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = err ? 'err' : 'ok'; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 4500);
}
const availBadge = a => `<span class="badge ${a === 'In Stock' ? 'ok' : a === 'Low Stock' ? 'warn' : 'bad'}">${a}</span>`;
const statusBadge = a => `<span class="badge ${a ? 'ok' : 'off'}">${a ? 'Active' : 'Inactive'}</span>`;
const emptyRow = (n, t) => `<tr><td class="empty" colspan="${n}">${t}</td></tr>`;


document.querySelectorAll('nav button').forEach(b => b.onclick = () => show(b.dataset.tab));
function activate(t) {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x.dataset.tab === t));
  document.querySelectorAll('section.tab').forEach(s => s.hidden = s.id !== 'tab-' + t);
}
function show(t) {
  activate(t);
  run({ types: loadTypes, items: loadItems, purchase: initPurchase, purchases: loadPurchases, stock: loadStock }[t]);
}
function openModal(html) { $('#modal-content').innerHTML = html; $('#modal').hidden = false; }
function closeModal() { $('#modal').hidden = true; }


async function loadTypes() {
  types = await api('/item-types');
  $('#types-body').innerHTML = types.length ? types.map(t => `<tr><td>${t.id}</td><td>${esc(t.type_name)}</td><td>${t.item_count}</td>
    <td><button class="btn sm" onclick="renameType(${t.id})">Rename</button>
    <button class="btn sm danger" onclick="deleteType(${t.id})">Delete</button></td></tr>`).join('') : emptyRow(4, 'No item types yet');
}
$('#type-form').onsubmit = e => { e.preventDefault(); run(async () => {
  await api('/item-types', { method: 'POST', body: { type_name: $('#type-name').value } });
  $('#type-name').value = ''; toast('Item type added'); await loadTypes();
}); };
function renameType(id) { run(async () => {
  const cur = types.find(t => t.id === id); const name = prompt('New name:', cur.type_name);
  if (name === null) return;
  await api('/item-types/' + id, { method: 'PUT', body: { type_name: name } }); toast('Item type updated'); await loadTypes();
}); }
function deleteType(id) { if (!confirm('Delete this item type?')) return; run(async () => {
  await api('/item-types/' + id, { method: 'DELETE' }); toast('Item type deleted'); await loadTypes();
}); }

async function loadItems() {
  [types, items] = await Promise.all([api('/item-types'), api('/items')]);
  const cur = $('#item-type').value;
  $('#item-type').innerHTML = '<option value="">-- select --</option>' + types.map(t => `<option value="${t.id}">${esc(t.type_name)}</option>`).join('');
  $('#item-type').value = cur;
  if (!$('#item-id').value && !$('#item-date').value) $('#item-date').value = today();
  $('#items-body').innerHTML = items.length ? items.map(i => `<tr><td>${i.id}</td><td>${esc(i.name)}</td><td>${esc(i.type_name)}</td>
    <td>${i.purchase_date}</td><td>${i.stock_available}</td><td>${availBadge(i.availability)}</td><td>${statusBadge(i.active)}</td>
    <td><button class="btn sm" onclick="viewItem(${i.id})">View</button>
    <button class="btn sm" onclick="editItem(${i.id})">Edit</button>
    <button class="btn sm" onclick="toggleItem(${i.id},${!i.active})">${i.active ? 'Deactivate' : 'Activate'}</button>
    <button class="btn sm danger" onclick="deleteItem(${i.id})">Delete</button></td></tr>`).join('') : emptyRow(8, 'No items yet');
}
function resetItemForm() {
  $('#item-form').reset(); $('#item-id').value = ''; $('#item-date').value = today();
  $('#item-submit').textContent = 'Create Item'; $('#item-cancel').hidden = true;
}
$('#item-cancel').onclick = resetItemForm;
$('#item-form').onsubmit = e => { e.preventDefault(); run(async () => {
  const id = $('#item-id').value;
  const body = { name: $('#item-name').value, item_type_id: $('#item-type').value, purchase_date: $('#item-date').value,
    stock_available: $('#item-stock').value, active: $('#item-active').value === '1' };
  await api(id ? '/items/' + id : '/items', { method: id ? 'PUT' : 'POST', body });
  toast(id ? 'Item updated' : 'Item created'); resetItemForm(); await loadItems();
}); };
function editItem(id) {
  const i = items.find(x => x.id === id);
  $('#item-id').value = i.id; $('#item-name').value = i.name; $('#item-type').value = i.item_type_id;
  $('#item-date').value = i.purchase_date; $('#item-stock').value = i.stock_available; $('#item-active').value = i.active ? '1' : '0';
  $('#item-submit').textContent = 'Update Item'; $('#item-cancel').hidden = false; window.scrollTo({ top: 0, behavior: 'smooth' });
}
function viewItem(id) { run(async () => {
  const i = await api('/items/' + id);
  openModal(`<h3>Item Details</h3><dl><dt>ID</dt><dd>${i.id}</dd><dt>Name</dt><dd>${esc(i.name)}</dd><dt>Type</dt><dd>${esc(i.type_name)}</dd>
   <dt>Purchase Date</dt><dd>${i.purchase_date}</dd><dt>Current Stock</dt><dd>${i.stock_available}</dd>
   <dt>Availability</dt><dd>${availBadge(i.availability)}</dd><dt>Status</dt><dd>${statusBadge(i.active)}</dd>
   <dt>Used in purchases</dt><dd>${i.used_in_purchases}</dd><dt>Created</dt><dd>${i.created_at}</dd><dt>Updated</dt><dd>${i.updated_at}</dd></dl>`);
}); }
function toggleItem(id, active) { run(async () => {
  await api(`/items/${id}/status`, { method: 'PATCH', body: { active } }); toast(active ? 'Item activated' : 'Item deactivated'); await loadItems();
}); }
function deleteItem(id) { if (!confirm('Delete this item?')) return; run(async () => {
  await api('/items/' + id, { method: 'DELETE' }); toast('Item deleted'); await loadItems();
}); }


async function initPurchase() {
  items = await api('/items?active=1');
  resetPurchaseForm();
}
function resetPurchaseForm() {
  editingPurchase = null; lines = [];
  $('#purchase-title').textContent = 'Create Purchase';
  $('#p-order').value = ''; $('#p-order').disabled = false; $('#p-date').value = today(); $('#p-qty').value = 1;
  $('#p-submit').textContent = 'Submit Purchase';
  fillItemSelect(); renderLines();
}
function fillItemSelect() {
  $('#p-item').innerHTML = '<option value="">-- select active item --</option>' + items.map(i =>
    `<option value="${i.id}" ${i.stock_available === 0 ? 'disabled' : ''}>${esc(i.name)} (${esc(i.type_name)}) - stock ${i.stock_available}</option>`).join('');
}
function renderLines() {
  $('#p-lines').innerHTML = lines.length ? lines.map((l, k) => `<tr><td>${esc(l.name)}</td><td>${l.quantity}</td>
    <td><button class="btn sm danger" onclick="removeLine(${k})">Remove</button></td></tr>`).join('') : emptyRow(3, 'No items added to this order');
}
$('#p-add').onclick = () => {
  const id = Number($('#p-item').value), qty = Number($('#p-qty').value);
  if (!id) return toast('Select an item', true);
  if (!Number.isInteger(qty) || qty <= 0) return toast('Quantity must be greater than zero', true);
  const existing = lines.find(l => l.item_id === id);
  if (existing) existing.quantity += qty;           // duplicates are merged into one line
  else lines.push({ item_id: id, name: items.find(i => i.id === id)?.name || ('Item ' + id), quantity: qty });
  $('#p-qty').value = 1; renderLines();
};
function removeLine(k) { lines.splice(k, 1); renderLines(); }
$('#p-reset').onclick = () => run(initPurchase);
$('#p-submit').onclick = () => run(async () => {
  const body = { purchase_date: $('#p-date').value, items: lines.map(l => ({ item_id: l.item_id, quantity: l.quantity })) };
  let p;
  if (editingPurchase) p = await api('/purchases/' + editingPurchase, { method: 'PUT', body });
  else { body.order_id = $('#p-order').value; p = await api('/purchases', { method: 'POST', body }); }
  toast(editingPurchase ? 'Purchase updated' : 'Purchase created: ' + p.order_id);
  activate('purchases'); await loadPurchases(); showPurchase(p.id);
});


async function loadPurchases() {
  const list = await api('/purchases');
  $('#purchases-body').innerHTML = list.length ? list.map(p => `<tr><td>${esc(p.order_id)}</td><td>${p.purchase_date}</td>
    <td>${p.line_count}</td><td>${p.total_quantity}</td>
    <td><button class="btn sm" onclick="showPurchase(${p.id})">View Details</button>
    <button class="btn sm" onclick="editPurchase(${p.id})">Update</button></td></tr>`).join('') : emptyRow(5, 'No purchases yet');
}
function showPurchase(id) { run(async () => {
  const p = await api('/purchases/' + id);
  openModal(`<h3>Purchase Details</h3><dl><dt>Order ID</dt><dd>${esc(p.order_id)}</dd><dt>Purchase Date</dt><dd>${p.purchase_date}</dd>
   <dt>Total Quantity</dt><dd>${p.total_quantity}</dd></dl>
   <div class="table-wrap"><table><thead><tr><th>Item</th><th>Type</th><th>Qty</th><th>Current Stock</th><th>Availability</th><th>Item Status</th></tr></thead><tbody>
   ${p.items.map(i => `<tr><td>${esc(i.item_name)}</td><td>${esc(i.type_name)}</td><td>${i.quantity}</td><td>${i.current_stock}</td>
   <td>${availBadge(i.availability)}</td><td>${statusBadge(i.item_active)}</td></tr>`).join('')}</tbody></table></div>`);
}); }
function editPurchase(id) { run(async () => {
  const [p] = await Promise.all([api('/purchases/' + id), initPurchase()]);
  activate('purchase'); editingPurchase = p.id;
  $('#purchase-title').textContent = 'Update Purchase ' + p.order_id;
  $('#p-order').value = p.order_id; $('#p-order').disabled = true; $('#p-date').value = p.purchase_date;
  lines = p.items.map(i => ({ item_id: i.item_id, name: i.item_name, quantity: i.quantity }));
  $('#p-submit').textContent = 'Save Changes'; renderLines();
}); }


async function loadStock() {
  items = await api('/items');
  const f = $('#stock-filter').value;
  const n = a => items.filter(i => i.availability === a).length;
  $('#stock-summary').innerHTML = `<div>In Stock: ${n('In Stock')}</div><div>Low Stock: ${n('Low Stock')}</div><div>Out of Stock: ${n('Out of Stock')}</div>`;
  const rows = items.filter(i => !f || i.availability === f);
  $('#stock-body').innerHTML = rows.length ? rows.map(i => `<tr><td>${i.id}</td><td>${esc(i.name)}</td><td>${esc(i.type_name)}</td>
    <td>${i.stock_available}</td><td>${availBadge(i.availability)}</td><td>${statusBadge(i.active)}</td></tr>`).join('') : emptyRow(6, 'No items');
}
$('#stock-filter').onchange = () => run(loadStock);

show('items');
