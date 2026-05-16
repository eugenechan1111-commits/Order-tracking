// ── Auth guard ──
const ctToken = localStorage.getItem('ct_token');
if (!ctToken) { window.location.href = '/customer-login'; }
else {
  try {
    const p = JSON.parse(atob(ctToken.split('.')[1]));
    if (p.exp && p.exp * 1000 < Date.now()) {
      localStorage.removeItem('ct_token');
      localStorage.removeItem('ct_display_name');
      localStorage.removeItem('ct_customer_name');
      window.location.href = '/customer-login';
    }
  } catch(e) {
    localStorage.removeItem('ct_token');
    window.location.href = '/customer-login';
  }
}

const ctDisplayName = localStorage.getItem('ct_display_name') || 'Customer';
const welcomeBadge = document.getElementById('welcome-badge');
if (welcomeBadge) welcomeBadge.textContent = '👤 ' + ctDisplayName;

function ctHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ctToken };
}

function doLogout() {
  localStorage.removeItem('ct_token');
  localStorage.removeItem('ct_display_name');
  localStorage.removeItem('ct_customer_name');
  window.location.href = '/customer-login';
}

// ── Search ──
document.getElementById('order-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') doSearch();
});

function doSearch() {
  const val = document.getElementById('order-input').value.trim();
  loadOrders(val || null);
}

function clearSearch() {
  document.getElementById('order-input').value = '';
  loadOrders(null);
}

// ── Load orders ──
async function loadOrders(orderNo) {
  showLoading();
  try {
    const url = orderNo ? `/api/track?order_no=${encodeURIComponent(orderNo)}` : '/api/track';
    const res = await fetch(url, { headers: ctHeaders() });
    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem('ct_token');
      window.location.href = '/customer-login';
      return;
    }
    const json = await res.json();
    if (!res.ok) { showError(json.error || 'No orders found.'); return; }
    renderOrders(Array.isArray(json) ? json : [json]);
  } catch(e) {
    showError('Connection error. Please try again.');
  }
}

function showLoading() {
  document.getElementById('content').innerHTML =
    '<div class="loading-state"><div class="spinner-lg"></div></div>';
}
function showError(msg) {
  document.getElementById('content').innerHTML =
    `<div class="msg-box error"><div class="icon">⚠️</div>${msg}</div>`;
}

// ── Render ──
function renderOrders(orders) {
  if (!orders.length) {
    document.getElementById('content').innerHTML =
      '<div class="msg-box"><div class="icon">🔍</div>No orders found.</div>';
    return;
  }
  document.getElementById('content').innerHTML = orders.map(renderCard).join('');
}

function renderCard(o) {
  const dueDate   = o.due_date || '—';
  const isOverdue = o.due_date && new Date(o.due_date) < new Date() && o.status !== 'done';
  const doneCount = o.stations.filter(s => s.status === 'completed').length;
  const total     = o.stations.length;
  const pct       = total > 0 ? Math.round(doneCount / total * 100) : 0;

  const items = (o.items && o.items.length > 0) ? o.items : [{ product: o.product || '—', quantity: '' }];
  const firstItem = items[0];
  const extraCount = items.length - 1;
  const extraRows = items.slice(1).map(it => `
    <div class="product-row product-extra">
      <span>${esc(it.product || it.name || '—')}</span>
      <span class="product-qty">${it.quantity || it.qty || ''} ${it.quantity ? 'units' : ''}</span>
    </div>`).join('');
  const uid = 'p-' + o.order_no.replace(/[^a-z0-9]/gi, '');
  const productsHTML = `
    <div class="product-row">
      <span>${esc(firstItem.product || firstItem.name || '—')}</span>
      <span class="product-qty">${firstItem.quantity || firstItem.qty || ''} ${firstItem.quantity ? 'units' : ''}</span>
    </div>
    ${extraCount > 0 ? `
      <div id="${uid}-extra" class="product-extra-wrap" style="display:none">${extraRows}</div>
      <button class="expand-btn" onclick="toggleExtra('${uid}')">
        <span id="${uid}-label">▸ Show ${extraCount} more item${extraCount > 1 ? 's' : ''}</span>
      </button>` : ''}`;


  return `
  <div class="order-card">
    <div class="order-card-header">
      <div>
        <div class="order-no">${esc(o.order_no)}</div>
        <div class="order-customer">${esc(o.customer)}</div>
      </div>
      <div class="order-badges">
        ${o.urgent ? '<span class="badge badge-urgent">🔴 URGENT</span>' : ''}
        ${buildStatusBadge(o)}
      </div>
    </div>

    <div class="order-meta">
      <div class="order-meta-item">
        <span class="meta-label">Due Date</span>
        <span class="meta-value ${isOverdue ? 'overdue' : ''}">${dueDate}${isOverdue ? ' ⚠️' : ''}</span>
      </div>
      <div class="order-meta-item">
        <span class="meta-label">Stations Done</span>
        <span class="meta-value">${doneCount} / ${total}</span>
      </div>
    </div>

    ${o.items && o.items.length > 0 ? `
    <div class="order-products">
      <div class="products-label">Products</div>
      ${productsHTML}
    </div>` : ''}

    <div class="overall-progress">
      <div class="progress-label"><span>Overall Progress</span><span>${pct}%</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
    </div>

  </div>`;
}

function buildStatusBadge(o) {
  if (o.status === 'done')              return '<span class="badge badge-done">✓ Delivered</span>';
  if (o.status === 'pickup_delivery')   return '<span class="badge badge-ready">📦 Ready for Pickup / Delivery</span>';
  if (o.status === 'ready')             return '<span class="badge badge-ready">✓ Ready</span>';
  if (o.production_status === 'Production Complete') return '<span class="badge badge-prodcomplete">✓ Production Complete</span>';
  if (o.production_status === 'In Production')       return '<span class="badge badge-inprod">⚙️ In Production</span>';
  if (o.production_status === 'On Hold')             return '<span class="badge badge-onhold">⏸ On Hold</span>';
  return '<span class="badge badge-pending">Pending</span>';
}

function dotClass(s) {
  return { completed: 'done', in_progress: 'active', paused: 'paused' }[s] || 'pending';
}
function dotIcon(s) {
  if (s === 'completed')   return '✓';
  if (s === 'in_progress') return '<span class="spinner-sm"></span>';
  if (s === 'paused')      return '⏸';
  return '';
}
function stationLabel(s) {
  return { completed: 'Completed', in_progress: 'In Progress', paused: 'On Hold', pending: 'Pending' }[s] || s;
}
function toggleExtra(uid) {
  const wrap  = document.getElementById(uid + '-extra');
  const label = document.getElementById(uid + '-label');
  if (!wrap) return;
  const open = wrap.style.display !== 'none';
  wrap.style.display = open ? 'none' : '';
  const count = wrap.querySelectorAll('.product-extra').length;
  label.textContent = open
    ? `▸ Show ${count} more item${count > 1 ? 's' : ''}`
    : `▾ Hide ${count} item${count > 1 ? 's' : ''}`;
}

function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Auto-load on page open + refresh every 2 minutes
loadOrders(null);
setInterval(() => loadOrders(document.getElementById('order-input').value.trim() || null), 120000);
