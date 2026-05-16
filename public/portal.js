// ── Auth Guard ────────────────────────────────────────────────────────────────
(function() {
  const token = localStorage.getItem('ct_token');
  if (!token) { window.location.href = '/customer-login'; return; }
  try {
    const p = JSON.parse(atob(token.split('.')[1]));
    if (p.exp && p.exp * 1000 < Date.now()) throw new Error('expired');
  } catch {
    localStorage.removeItem('ct_token');
    localStorage.removeItem('ct_display_name');
    localStorage.removeItem('ct_customer_name');
    window.location.href = '/customer-login';
  }
})();

// ── Globals ───────────────────────────────────────────────────────────────────
const CT_DISPLAY = localStorage.getItem('ct_display_name') || 'Customer';
const CT_CUSTOMER = localStorage.getItem('ct_customer_name') || '';

let _products = [];
let _selectedProduct = null;
let _selectedMethod = 'bank_transfer';
let _fieldValues = {};

// ── Helpers ───────────────────────────────────────────────────────────────────
function ctHeaders() {
  return { 'Authorization': 'Bearer ' + localStorage.getItem('ct_token'), 'Content-Type': 'application/json' };
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-MY', { day:'2-digit', month:'short', year:'numeric' });
}

function fmtMoney(n) {
  return 'RM ' + parseFloat(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function showAlert(id, msg, type = 'error') {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = 'alert alert-' + type;
  el.style.display = 'block';
  if (type === 'success') setTimeout(() => { el.style.display = 'none'; }, 4000);
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('p-user-badge').textContent = CT_DISPLAY;

  // Sidebar nav
  document.querySelectorAll('.p-nav-item[data-ptab]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      activatePortalTab(el.dataset.ptab);
    });
  });

  // Logout
  document.getElementById('portal-logout-btn').addEventListener('click', () => {
    localStorage.removeItem('ct_token');
    localStorage.removeItem('ct_display_name');
    localStorage.removeItem('ct_customer_name');
    window.location.href = '/customer-login';
  });

  // Dark mode icon sync
  const h = document.documentElement;
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = h.getAttribute('data-theme') === 'dark' ? '☀' : '☾';

  // Load initial tab
  loadProducts();
});

// ── Sidebar ───────────────────────────────────────────────────────────────────
function toggleSidebar() {
  document.getElementById('p-sidebar').classList.toggle('open');
  document.getElementById('p-sidebar-backdrop').classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('p-sidebar').classList.remove('open');
  document.getElementById('p-sidebar-backdrop').classList.remove('open');
}

// ── Tab switching ─────────────────────────────────────────────────────────────
const TAB_TITLES = { quote: 'Products', cart: 'My Cart', quotations: 'My Purchase Order', orders: 'My Orders', payment: 'Make Payment', account: 'My Account' };

function activatePortalTab(name) {
  document.querySelectorAll('.tab-content').forEach(t => { t.classList.remove('active'); t.style.display = 'none'; });
  document.querySelectorAll('.p-nav-item[data-ptab]').forEach(n => n.classList.remove('active'));

  const tab = document.getElementById('tab-' + name);
  if (tab) { tab.classList.add('active'); tab.style.display = 'block'; }
  document.querySelector(`.p-nav-item[data-ptab="${name}"]`)?.classList.add('active');
  document.getElementById('p-page-title').textContent = TAB_TITLES[name] || name;

  closeSidebar();

  if (name === 'quote')       loadProducts();
  if (name === 'cart')        loadCart();
  if (name === 'quotations')  loadQuotations();
  if (name === 'orders')      loadOrders();
  if (name === 'payment')     { loadPaymentSOs(); loadPayments(); loadCreditBalance(); }
  if (name === 'account')     loadAccount();
}

// init tab display
document.querySelectorAll('.tab-content').forEach(t => { if (!t.classList.contains('active')) t.style.display = 'none'; });

// ── QUOTE REQUEST ─────────────────────────────────────────────────────────────
async function loadProducts() {
  const grid = document.getElementById('product-grid');
  grid.innerHTML = '<div class="loading">Loading products…</div>';
  try {
    const res = await fetch('/api/customer-portal/products', { headers: ctHeaders() });
    _products = await res.json();
    if (!Array.isArray(_products) || !_products.length) {
      grid.innerHTML = '<div class="empty-state"><div class="empty-icon">🛋️</div><div class="empty-text">No products available yet. Check back soon!</div></div>';
      return;
    }
    grid.innerHTML = _products.map(p => `
      <div class="product-card" id="pcard-${p.id}" onclick="selectProduct('${p.id}')">
        <div class="product-card-icon">${p.image_url
          ? `<img src="${p.image_url}" style="width:56px;height:56px;object-fit:cover;border-radius:8px">`
          : '🪵'}</div>
        <div class="product-card-name">${esc(p.name)}</div>
        <div class="product-card-desc">${esc(p.description || '')}</div>
        <div class="product-card-price">From ${fmtMoney(p.base_price)}</div>
      </div>
    `).join('');
  } catch {
    grid.innerHTML = '<div class="empty-state"><div class="empty-text">Failed to load products. Please refresh.</div></div>';
  }
}

function selectProduct(id) {
  _selectedProduct = _products.find(p => p.id === id);
  if (!_selectedProduct) return;
  _fieldValues = {};

  document.querySelectorAll('.product-card').forEach(c => c.classList.remove('selected'));
  document.getElementById('pcard-' + id)?.classList.add('selected');

  document.getElementById('config-product-name').textContent = _selectedProduct.name;
  renderConfigFields();

  const cfg = document.getElementById('configurator');
  cfg.classList.add('visible');
  cfg.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderConfigFields() {
  if (!_selectedProduct) return;
  const fields = _selectedProduct.fields || [];
  const container = document.getElementById('config-fields');
  container.innerHTML = fields.map(f => {
    const key = f.key;
    if (f.type === 'number') {
      const def = f.default || f.min || 0;
      _fieldValues[key] = def;
      return `<div class="form-group">
        <label class="form-label">${esc(f.label)}</label>
        <input type="number" class="form-input" id="cf-${key}" value="${def}" min="${f.min || 0}" max="${f.max || ''}" step="1"
          oninput="_fieldValues['${key}']=parseFloat(this.value)||0; calcPrice()">
      </div>`;
    }
    if (f.type === 'select') {
      const opts = (f.options || []);
      _fieldValues[key] = opts[0] || '';
      return `<div class="form-group">
        <label class="form-label">${esc(f.label)}</label>
        <select class="form-input" id="cf-${key}" onchange="_fieldValues['${key}']=this.value; calcPrice()">
          ${opts.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
        </select>
      </div>`;
    }
    if (f.type === 'checkbox') {
      const defChecked = f.default === true || f.default === 'true';
      _fieldValues[key] = defChecked;
      return `<div class="form-group" style="display:flex;align-items:center;gap:8px;padding-top:24px">
        <input type="checkbox" id="cf-${key}" ${defChecked ? 'checked' : ''} onchange="_fieldValues['${key}']=this.checked; calcPrice()" style="width:16px;height:16px;cursor:pointer">
        <label for="cf-${key}" style="font-size:13px;cursor:pointer">${esc(f.label)} ${f.price_add ? `(+${fmtMoney(f.price_add)})` : ''}</label>
      </div>`;
    }
    return '';
  }).join('');
  calcPrice();
}

function calcPrice() {
  if (!_selectedProduct) return;
  const p = _selectedProduct;
  const fields = p.fields || [];

  // Build variables for formula
  const vars = { base_price: parseFloat(p.base_price || 0) };
  fields.forEach(f => {
    const val = _fieldValues[f.key];
    if (f.type === 'number')   vars[f.key] = parseFloat(val) || 0;
    if (f.type === 'checkbox') { vars[f.key] = !!val; vars['price_add'] = f.price_add || 0; }
    if (f.type === 'select') {
      vars[f.key] = val;
      const mod = (f.price_mod || {})[val] || 0;
      vars['color_mod'] = mod; // generic alias; formula can also use specific key_mod
      vars[f.key + '_mod'] = mod;
    }
  });

  let price = 0;
  let breakdown = null;
  try {
    if (p.formula) {
      const fn = new Function(...Object.keys(vars), `return (${p.formula})`);
      const result = fn(...Object.values(vars));
      if (result !== null && typeof result === 'object' && result.total !== undefined) {
        price = result.total;
        breakdown = result;
      } else {
        price = parseFloat(result) || 0;
      }
    } else {
      price = vars.base_price;
    }
  } catch (e) {
    console.warn('Formula error:', e.message);
    price = vars.base_price;
  }

  price = Math.max(0, parseFloat(price.toFixed(2)));
  document.getElementById('price-preview-value').textContent = fmtMoney(price);

  // Render breakdown if formula returned detailed object
  const bdEl = document.getElementById('price-breakdown');
  const bdRows = document.getElementById('price-breakdown-rows');
  const bdFooter = document.getElementById('price-breakdown-footer');
  if (breakdown && breakdown.breakdown && bdEl) {
    bdRows.innerHTML = breakdown.breakdown.map(r =>
      `<div style="display:flex;justify-content:space-between;padding:6px 14px;border-bottom:1px solid var(--border)">
        <span style="color:var(--text-secondary)">${esc(r.label)}</span>
        <span style="font-weight:600">${fmtMoney(r.amount)}</span>
      </div>`
    ).join('');
    const qty = breakdown.quantity || 1;
    const qf = breakdown.quantity_factor || 1;
    const perUnit = breakdown.per_unit || 0;
    bdFooter.innerHTML = `
      <span>Qty ${qty} × ${fmtMoney(perUnit)}/unit${qf < 1 ? ` <span style="font-size:11px;opacity:.7">(vol. factor ${qf})</span>` : ''}</span>
      <span>${fmtMoney(price)}</span>`;
    bdEl.style.display = 'block';
  } else if (bdEl) {
    bdEl.style.display = 'none';
  }

  return price;
}

// ── CART ─────────────────────────────────────────────────────────────────────
let _cart = JSON.parse(localStorage.getItem('ao_portal_cart') || '[]');

function saveCart() {
  localStorage.setItem('ao_portal_cart', JSON.stringify(_cart));
  updateCartBadge();
}

function updateCartBadge() {
  const badge = document.getElementById('cart-badge');
  if (!badge) return;
  const count = _cart.reduce((s, i) => s + (i.quantity || 1), 0);
  if (count > 0) { badge.textContent = count; badge.style.display = 'inline'; }
  else { badge.style.display = 'none'; }
}
updateCartBadge();

function addToCart() {
  if (!_selectedProduct) return;
  const price = calcPrice();
  const p = _selectedProduct;
  const fields = p.fields || [];
  // Build a readable config summary
  const snapshot = { ..._fieldValues };
  const configLines = fields.map(f => {
    const v = snapshot[f.key];
    if (v === undefined || v === null || v === '' || v === false) return null;
    if (f.type === 'checkbox') return v ? f.label : null;
    return `${f.label}: ${v}`;
  }).filter(Boolean);

  const notes = (document.getElementById('req-notes')?.value || '').trim();

  _cart.push({
    _id: Date.now() + Math.random(),
    product_id: p.id,
    product_name: p.name,
    config_snapshot: snapshot,
    config_lines: configLines,
    notes: notes,
    unit_price: price,
    quantity: 1,
    image_url: p.image_url || null
  });
  saveCart();

  // Visual feedback
  const alertEl = document.getElementById('req-alert');
  alertEl.className = 'alert alert-success';
  alertEl.textContent = `✓ "${p.name}" added to cart! (${_cart.length} item${_cart.length > 1 ? 's' : ''})`;
  alertEl.style.display = 'block';
  setTimeout(() => alertEl.style.display = 'none', 3000);

  // Reset configurator
  document.querySelectorAll('.product-card').forEach(c => c.classList.remove('selected'));
  document.getElementById('configurator').classList.remove('visible');
  if (document.getElementById('req-notes')) document.getElementById('req-notes').value = '';
  _selectedProduct = null;
}

function removeFromCart(id) {
  _cart = _cart.filter(i => i._id !== id);
  saveCart();
  loadCart();
}

function updateCartQty(id, delta) {
  const item = _cart.find(i => i._id === id);
  if (!item) return;
  item.quantity = Math.max(1, Math.min(999, (item.quantity || 1) + delta));
  saveCart();
  // Update subtotal display inline
  document.querySelector(`[data-cart-id="${id}"] .cart-item-subtotal`).textContent =
    fmtMoney(item.unit_price * item.quantity);
  document.querySelector(`[data-cart-id="${id}"] .qty-val`).value = item.quantity;
  renderCartTotal();
}

function setCartQty(id, val) {
  const item = _cart.find(i => i._id === id);
  if (!item) return;
  item.quantity = Math.max(1, Math.min(999, parseInt(val) || 1));
  saveCart();
  document.querySelector(`[data-cart-id="${id}"] .cart-item-subtotal`).textContent =
    fmtMoney(item.unit_price * item.quantity);
  renderCartTotal();
}

function renderCartTotal() {
  const total = _cart.reduce((s, i) => s + (i.unit_price * (i.quantity || 1)), 0);
  const el = document.getElementById('cart-total');
  if (el) el.textContent = fmtMoney(total);
  return total;
}

function clearCart() {
  if (!_cart.length || !confirm('Clear all items from your cart?')) return;
  _cart = [];
  saveCart();
  loadCart();
}

function loadCart() {
  const wrap = document.getElementById('cart-items-wrap');
  const checkout = document.getElementById('cart-checkout');
  if (!_cart.length) {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">🛒</div><div class="empty-text">Your cart is empty. Configure a product and click "Add to Cart".</div></div>';
    checkout.style.display = 'none';
    return;
  }
  wrap.innerHTML = _cart.map(item => `
    <div class="cart-item" data-cart-id="${item._id}">
      <div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          ${item.image_url ? `<img src="${item.image_url}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;flex-shrink:0">` : ''}
          <div class="cart-item-name">${esc(item.product_name)}</div>
        </div>
        ${item.config_lines && item.config_lines.length
          ? `<div class="cart-item-cfg">${item.config_lines.map(l => esc(l)).join(' &nbsp;·&nbsp; ')}</div>`
          : ''}
        ${item.notes ? `<div style="font-size:13px;color:#dc2626;font-weight:700;margin-bottom:6px">📝 ${esc(item.notes)}</div>` : ''}
        <div class="cart-item-footer">
          <div class="qty-stepper">
            <button onclick="updateCartQty(${item._id}, -1)">−</button>
            <input type="number" class="qty-val" value="${item.quantity}" min="1" max="999"
              onchange="setCartQty(${item._id}, this.value)" onblur="setCartQty(${item._id}, this.value)">
            <button onclick="updateCartQty(${item._id}, 1)">+</button>
          </div>
          <div style="font-size:12px;color:var(--text-muted)">${fmtMoney(item.unit_price)} / unit</div>
          <div class="cart-item-subtotal">${fmtMoney(item.unit_price * item.quantity)}</div>
        </div>
      </div>
      <button class="cart-item-remove" onclick="removeFromCart(${item._id})" title="Remove">✕</button>
    </div>
  `).join('');
  checkout.style.display = 'block';
  renderCartTotal();
}

async function submitCart() {
  if (!_cart.length) return;
  const notes = document.getElementById('cart-notes').value.trim();
  const alertEl = document.getElementById('cart-alert');
  alertEl.style.display = 'none';

  const total = _cart.reduce((s, i) => s + (i.unit_price * (i.quantity || 1)), 0);
  const itemSummary = _cart.map(i =>
    `${i.product_name} ×${i.quantity}${i.config_lines && i.config_lines.length ? ' (' + i.config_lines.join(', ') + ')' : ''}`
  ).join(' | ');

  const body = {
    product_name: `Cart Order — ${_cart.length} item${_cart.length > 1 ? 's' : ''}`,
    product_config_id: null,
    config_snapshot: {
      items: _cart.map(i => ({
        product_id:   i.product_id,
        product_name: i.product_name,
        quantity:     i.quantity,
        unit_price:   i.unit_price,
        subtotal:     Math.round(i.unit_price * i.quantity * 100) / 100,
        config:       i.config_snapshot,
        config_lines: i.config_lines,
        notes:        i.notes || ''
      }))
    },
    estimated_price: Math.round(total * 100) / 100,
    notes: notes || itemSummary
  };

  try {
    const res = await fetch('/api/customer-portal/my-requests', {
      method: 'POST', headers: ctHeaders(), body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      alertEl.className = 'alert alert-error';
      alertEl.textContent = data.error || 'Failed to submit.';
      alertEl.style.display = 'block';
      return;
    }
    // Clear cart on success
    _cart = [];
    saveCart();
    loadCart();
    document.getElementById('cart-notes').value = '';
    alertEl.className = 'alert alert-success';
    alertEl.textContent = `✓ Quote request submitted! Reference: ${data.request_no || data.id?.slice(0,8)}. We'll get back to you shortly.`;
    alertEl.style.display = 'block';
    document.getElementById('cart-checkout').style.display = 'block'; // keep visible for alert
  } catch (e) {
    alertEl.className = 'alert alert-error';
    alertEl.textContent = 'Connection error. Please try again.';
    alertEl.style.display = 'block';
  }
}

async function submitQuoteRequest() {
  const price = calcPrice();
  const notes = document.getElementById('req-notes').value.trim();
  const alertEl = document.getElementById('req-alert');
  alertEl.style.display = 'none';

  if (!_selectedProduct) {
    alertEl.className = 'alert alert-error'; alertEl.textContent = 'Please select a product first.'; alertEl.style.display = 'block'; return;
  }

  try {
    const res = await fetch('/api/customer-portal/my-requests', {
      method: 'POST',
      headers: ctHeaders(),
      body: JSON.stringify({
        product_config_id: _selectedProduct.id,
        product_name: _selectedProduct.name,
        config_snapshot: { ..._fieldValues },
        estimated_price: price,
        notes
      })
    });
    const data = await res.json();
    if (!res.ok) { alertEl.className = 'alert alert-error'; alertEl.textContent = data.error || 'Failed to submit. Please try again.'; alertEl.style.display = 'block'; return; }

    document.getElementById('quote-success-modal').classList.remove('hidden');
    document.getElementById('req-notes').value = '';
    // Reset selection
    document.querySelectorAll('.product-card').forEach(c => c.classList.remove('selected'));
    document.getElementById('configurator').classList.remove('visible');
    _selectedProduct = null;
  } catch {
    alertEl.className = 'alert alert-error'; alertEl.textContent = 'Connection error. Please try again.'; alertEl.style.display = 'block';
  }
}

// ── MY QUOTATIONS ─────────────────────────────────────────────────────────────
const REQ_STATUS_COLOR = { pending: 'orange', quoted: 'blue', converted: 'green', rejected: 'red' };
const REQ_STATUS_LABEL = { pending: '⏳ Pending Review', quoted: '📋 Quoted', converted: '✅ Converted to Order', rejected: '✕ Rejected' };

async function loadQuotations() {
  const wrap = document.getElementById('quotations-wrap');
  wrap.innerHTML = '<div class="loading">Loading…</div>';
  try {
    const [reqRes, quoteRes] = await Promise.all([
      fetch('/api/customer-portal/my-requests',    { headers: ctHeaders() }),
      fetch('/api/customer-portal/my-quotations',  { headers: ctHeaders() })
    ]);
    const requests   = reqRes.ok   ? await reqRes.json()   : [];
    const quotations = quoteRes.ok ? await quoteRes.json() : [];

    // Store requests for detail modal
    window._poRequests = requests;

    let html = '';

    // ── Section 1: Purchase Orders ───────────────────────────────────────────
    if (!requests.length) {
      html += `<div class="empty-state" style="padding:24px;margin-bottom:24px"><div class="empty-icon">📩</div><div class="empty-text">No purchase orders yet. Configure a product and submit.</div></div>`;
    } else {
      html += `<div class="table-wrap" style="margin-bottom:28px"><table>
        <thead><tr><th>PO #</th><th>Product</th><th>Est. Price</th><th>Submitted</th><th>Status</th><th></th></tr></thead>
        <tbody>${requests.map(r => {
          const color = REQ_STATUS_COLOR[r.status] || 'muted';
          const label = REQ_STATUS_LABEL[r.status] || r.status;
          const poNo = (r.request_no || r.id.slice(0,8)).replace(/^QR-/, 'PO-');
          const isCart = Array.isArray(r.config_snapshot?.items);
          const canDelete = ['pending', 'rejected'].includes(r.status);

          // Config display — skip 'items' key (cart orders), skip empty values
          const cfg = !isCart && r.config_snapshot ? Object.entries(r.config_snapshot)
            .filter(([k,v]) => k !== 'items' && v !== null && v !== '' && v !== false)
            .map(([k,v]) => `${k.replace(/_/g,' ')}: ${v}`).join(' · ') : '';

          const productCell = isCart
            ? `<strong style="color:var(--indigo);cursor:pointer;text-decoration:underline dotted"
                onclick="showPODetail('${r.id}')">${esc(r.product_name)}</strong>
               <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${(r.config_snapshot.items||[]).length} item(s) — click to view details</div>`
            : `<strong>${esc(r.product_name)}</strong>
               ${cfg ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(cfg)}</div>` : ''}`;

          return `<tr>
            <td><strong>${esc(poNo)}</strong></td>
            <td>
              ${productCell}
              ${r.notes ? `<div style="font-size:12px;font-weight:700;color:#dc2626;margin-top:4px">REMARKS: ${esc(r.notes)}</div>` : ''}
            </td>
            <td>${r.estimated_price ? fmtMoney(r.estimated_price) : '—'}</td>
            <td>${fmtDate(r.created_at)}</td>
            <td><span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;
              background:var(--${color}-light,var(--indigo-light));color:var(--${color},var(--indigo))">${esc(label)}</span></td>
            <td>${canDelete
              ? `<button class="btn btn-outline btn-sm" style="color:#dc2626;border-color:#dc2626" onclick="deletePO('${r.id}','${esc(poNo)}')">🗑 Delete</button>`
              : ''}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;
    }

    // ── Section 2: Admin Quotations ──────────────────────────────────────────
    html += `<div>
      <div style="font-size:13px;font-weight:700;color:var(--text-muted);letter-spacing:.05em;text-transform:uppercase;margin-bottom:12px">Sales Order from Amber Office</div>`;

    if (!quotations.length) {
      html += `<div class="empty-state" style="padding:24px"><div class="empty-icon">📋</div><div class="empty-text">No formal Sales Order yet. We'll notify you once an order is ready.</div></div>`;
    } else {
      html += `<div class="table-wrap"><table>
        <thead><tr><th>Quote #</th><th>Date</th><th>Valid Until</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${quotations.map(q => `
          <tr>
            <td><strong>${esc(q.quote_no)}</strong></td>
            <td>${fmtDate(q.created_at)}</td>
            <td>${fmtDate(q.valid_until)}</td>
            <td>${fmtMoney(q.total_amount)}</td>
            <td><span class="badge badge-${q.status}">${esc(q.status)}</span></td>
            <td>
              ${q.status === 'sent' ? `
                <button class="btn btn-success btn-sm" onclick="respondQuote('${q.id}','accept')">✓ Accept</button>
                <button class="btn btn-danger btn-sm" onclick="respondQuote('${q.id}','reject')" style="margin-left:4px">✕ Reject</button>
              ` : '—'}
            </td>
          </tr>
        `).join('')}</tbody>
      </table></div>`;
    }
    html += `</div>`;

    wrap.innerHTML = html;
  } catch (e) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-text">Failed to load. ${esc(e.message)}</div></div>`;
  }
}

async function deletePO(id, poNo) {
  const confirmed = confirm(
    `Delete Purchase Order ${poNo}?\n\nThis action cannot be undone. The order will be permanently removed.\n\nClick OK to confirm deletion.`
  );
  if (!confirmed) return;
  try {
    const res = await fetch(`/api/customer-portal/my-requests/${id}`, { method: 'DELETE', headers: ctHeaders() });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Failed to delete. Please try again.'); return; }
    loadQuotations();
  } catch { alert('Connection error. Please try again.'); }
}

function showPODetail(id) {
  const r = (window._poRequests || []).find(x => x.id === id);
  if (!r) return;
  const items = r.config_snapshot?.items || [];
  const poNo = (r.request_no || r.id.slice(0,8)).replace(/^QR-/, 'PO-');

  let modal = document.getElementById('po-detail-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'po-detail-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:800;display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow-y:auto';
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div style="background:var(--surface);border-radius:12px;padding:24px;width:100%;max-width:620px;box-shadow:0 8px 32px rgba(0,0,0,.2);margin:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div>
          <div style="font-size:18px;font-weight:700">${esc(r.product_name)}</div>
          <div style="font-size:13px;color:var(--text-muted)">${esc(poNo)} · ${fmtDate(r.created_at)}</div>
        </div>
        <button onclick="document.getElementById('po-detail-modal').remove()"
          style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--text-muted);line-height:1">✕</button>
      </div>
      ${items.map((item, i) => `
        <div style="border:1.5px solid var(--border);border-radius:10px;padding:14px;margin-bottom:10px">
          <div style="font-weight:700;margin-bottom:6px">${i+1}. ${esc(item.product_name)} <span style="color:var(--text-muted);font-weight:400">×${item.quantity}</span></div>
          ${item.config_lines && item.config_lines.length
            ? `<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">${item.config_lines.map(l => esc(l)).join(' · ')}</div>`
            : ''}
          ${item.notes ? `<div style="font-size:13px;font-weight:700;color:#dc2626;margin-bottom:6px">REMARKS: ${esc(item.notes)}</div>` : ''}
          <div style="display:flex;justify-content:space-between;font-size:13px">
            <span style="color:var(--text-muted)">${fmtMoney(item.unit_price)} / unit</span>
            <strong style="color:var(--indigo)">${fmtMoney(item.subtotal)}</strong>
          </div>
        </div>
      `).join('')}
      ${r.notes ? `<div style="font-size:13px;font-weight:700;color:#dc2626;margin-top:8px">REMARKS: ${esc(r.notes)}</div>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;padding-top:16px;border-top:2px solid var(--border)">
        <span style="font-size:14px;color:var(--text-muted)">Estimated Total</span>
        <strong style="font-size:22px;color:var(--indigo)">${r.estimated_price ? fmtMoney(r.estimated_price) : '—'}</strong>
      </div>
    </div>`;
}

async function respondQuote(id, action) {
  const label = action === 'accept' ? 'accept' : 'reject';
  if (!confirm(`Are you sure you want to ${label} this quotation?`)) return;
  try {
    const res = await fetch(`/api/customer-portal/my-quotations/${id}/${label}`, { method: 'PATCH', headers: ctHeaders() });
    if (res.ok) loadQuotations();
    else { const d = await res.json(); alert(d.error || 'Action failed.'); }
  } catch { alert('Connection error.'); }
}

// ── MY ORDERS ─────────────────────────────────────────────────────────────────
const STATION_ORDER = ['Cut','Edge','Boring','Cut-Curve','Edge-Curve','Assembly','Packing'];

function sanitizeOrder(o) {
  const wos = (o.work_orders || []).sort((a,b) => STATION_ORDER.indexOf(a.workstation) - STATION_ORDER.indexOf(b.workstation));
  const stations = wos.map(wo => ({ name: wo.workstation, status: wo.status, actual_qty: wo.actual_qty||0, target_qty: wo.target_qty||0 }));
  const allDone = stations.length > 0 && stations.every(s => s.status === 'completed');
  const anyDone = stations.some(s => s.status === 'completed');
  const anyActive = stations.some(s => s.status === 'in_progress');
  const anyPaused = stations.some(s => s.status === 'paused');
  let production_status = 'Pending';
  if (allDone)        production_status = 'Production Complete';
  else if (anyActive) production_status = 'In Production';
  else if (anyDone)   production_status = 'In Production';
  else if (anyPaused) production_status = 'On Hold';
  return { ...o, stations, production_status };
}

function statusColor(s) {
  if (s === 'Production Complete') return 'var(--green)';
  if (s === 'In Production') return 'var(--indigo)';
  if (s === 'On Hold') return 'var(--orange)';
  return 'var(--text-muted)';
}

async function loadOrders() {
  const wrap = document.getElementById('orders-wrap');
  wrap.innerHTML = '<div class="loading">Loading…</div>';
  const q = (document.getElementById('order-search')?.value || '').trim();
  try {
    const url = '/api/customer-portal/my-orders' + (q ? `?order_no=${encodeURIComponent(q)}` : '');
    const res = await fetch(url, { headers: ctHeaders() });
    const raw = await res.json();
    if (!res.ok) { wrap.innerHTML = `<div class="empty-state"><div class="empty-text">${esc(raw.error || 'Error')}</div></div>`; return; }
    if (!raw.length) { wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">📦</div><div class="empty-text">No orders found.</div></div>'; return; }

    const orders = raw.map(sanitizeOrder);
    wrap.innerHTML = `<div class="order-cards">${orders.map(o => renderOrderCard(o)).join('')}</div>`;
  } catch {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-text">Failed to load orders. Please refresh.</div></div>';
  }
}

function renderOrderCard(o) {
  const done = o.stations.filter(s => s.status === 'completed').length;
  const total = o.stations.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const items = Array.isArray(o.items) ? o.items : [];
  const first = items[0];
  const extra = items.slice(1);
  const uid = o.order_no.replace(/[^a-z0-9]/gi, '_');

  const itemsHtml = first
    ? `<div class="items-row">
        <span style="font-weight:600">${esc(first.product || first.name || '')}</span>
        ${first.quantity ? ` × ${first.quantity}` : ''}
        ${extra.length ? `<div id="extra-${uid}" style="display:none">${extra.map(i => `<div style="color:var(--text-muted);font-size:12px">${esc(i.product||i.name||'')} × ${i.quantity||''}</div>`).join('')}</div>
        <span class="items-toggle" onclick="toggleExtra('${uid}')">+${extra.length} more</span>` : ''}
      </div>`
    : `<div class="items-row" style="color:var(--text-muted)">${esc(o.product || '—')}</div>`;

  const dueLabel = o.due_date ? `Due ${fmtDate(o.due_date)}` : '';
  const urgentBadge = o.urgent ? '<span style="font-size:10px;font-weight:700;color:var(--red);margin-left:4px">🔴 URGENT</span>' : '';

  return `<div class="order-card">
    <div class="order-card-header">
      <div>
        <div class="order-card-no">${esc(o.order_no)}${urgentBadge}</div>
        <div class="order-card-meta">${dueLabel}</div>
      </div>
      <span style="font-size:12px;font-weight:700;color:${statusColor(o.production_status)}">${esc(o.production_status)}</span>
    </div>
    ${itemsHtml}
    <div style="margin-top:12px">
      <div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
      <div class="progress-label">${done} of ${total} station${total !== 1 ? 's' : ''} complete (${pct}%)</div>
    </div>
  </div>`;
}

function toggleExtra(uid) {
  const el = document.getElementById('extra-' + uid);
  if (!el) return;
  const isHidden = el.style.display === 'none';
  el.style.display = isHidden ? 'block' : 'none';
}

// ── MAKE PAYMENT ──────────────────────────────────────────────────────────────
function selectMethod(method) {
  _selectedMethod = method;
  document.getElementById('method-bank').classList.toggle('selected', method === 'bank_transfer');
  document.getElementById('method-credit').classList.toggle('selected', method === 'credit_limit');
  document.getElementById('bank-fields').style.display = method === 'bank_transfer' ? 'block' : 'none';
}

async function loadCreditBalance() {
  try {
    const res = await fetch('/api/customer-portal/credit-balance', { headers: ctHeaders() });
    const d = await res.json();
    document.getElementById('credit-avail-label').textContent = `Available: ${fmtMoney(d.available)}`;
  } catch {
    document.getElementById('credit-avail-label').textContent = 'Balance unavailable';
  }
}

async function loadPaymentSOs() {
  try {
    const res = await fetch('/api/customer-portal/my-sales-orders', { headers: ctHeaders() });
    const data = await res.json();
    const sel = document.getElementById('pay-so');
    sel.innerHTML = '<option value="">— Select SO (optional) —</option>' +
      (data || []).map(s => `<option value="${s.id}" data-so-no="${esc(s.so_no)}">${esc(s.so_no)} — ${fmtMoney(s.total_amount)}</option>`).join('');
  } catch {}
}

async function loadPayments() {
  const wrap = document.getElementById('payments-wrap');
  wrap.innerHTML = '<div class="loading">Loading…</div>';
  try {
    const res = await fetch('/api/customer-portal/payments', { headers: ctHeaders() });
    const data = await res.json();
    if (!data.length) { wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">💳</div><div class="empty-text">No payment submissions yet.</div></div>'; return; }
    wrap.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>SO</th><th>Method</th><th>Amount</th><th>Status</th><th>Slip</th></tr></thead>
      <tbody>${data.map(p => `
        <tr>
          <td>${fmtDate(p.created_at)}</td>
          <td>${esc(p.so_no || '—')}</td>
          <td>${p.method === 'bank_transfer' ? '🏦 Bank Transfer' : '💳 Credit'}</td>
          <td>${fmtMoney(p.amount)}</td>
          <td><span class="badge badge-${p.status}">${esc(p.status)}</span></td>
          <td>${p.slip_url ? `<a href="${esc(p.slip_url)}" target="_blank" class="btn btn-outline btn-sm">View</a>` : '—'}</td>
        </tr>
      `).join('')}</tbody>
    </table></div>`;
  } catch {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-text">Failed to load.</div></div>';
  }
}

async function submitPayment() {
  const alertEl = document.getElementById('pay-alert');
  alertEl.style.display = 'none';

  const amount = parseFloat(document.getElementById('pay-amount').value);
  if (!amount || amount <= 0) { showAlert('pay-alert', 'Please enter a valid amount.'); return; }
  if (_selectedMethod === 'bank_transfer' && !document.getElementById('pay-slip').files[0]) {
    showAlert('pay-alert', 'Please upload a bank-in slip.'); return;
  }

  const soEl = document.getElementById('pay-so');
  const soId = soEl.value;
  const soNo = soEl.options[soEl.selectedIndex]?.dataset?.soNo || '';

  const fd = new FormData();
  fd.append('method', _selectedMethod);
  fd.append('amount', amount);
  if (soId) { fd.append('sales_order_id', soId); fd.append('so_no', soNo); }
  fd.append('bank_ref', document.getElementById('pay-bank-ref').value);
  fd.append('notes', document.getElementById('pay-notes').value);
  if (_selectedMethod === 'bank_transfer') fd.append('slip', document.getElementById('pay-slip').files[0]);

  try {
    const res = await fetch('/api/customer-portal/payments', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('ct_token') },
      body: fd
    });
    const data = await res.json();
    if (!res.ok) { showAlert('pay-alert', data.error || 'Failed to submit.'); return; }
    showAlert('pay-alert', 'Payment submitted successfully! We\'ll verify it shortly.', 'success');
    document.getElementById('pay-amount').value = '';
    document.getElementById('pay-bank-ref').value = '';
    document.getElementById('pay-notes').value = '';
    document.getElementById('pay-slip').value = '';
    document.getElementById('pay-so').value = '';
    loadPayments();
  } catch {
    showAlert('pay-alert', 'Connection error. Please try again.');
  }
}

// ── MY ACCOUNT ────────────────────────────────────────────────────────────────
async function loadAccount() {
  const wrap = document.getElementById('account-info-wrap');
  wrap.innerHTML = '<div class="loading">Loading…</div>';
  try {
    const res = await fetch('/api/customer-portal/my-account', { headers: ctHeaders() });
    const d = await res.json();

    document.getElementById('acct-display-name').value = d.display_name || '';

    const lc = d.linked_customer;
    wrap.innerHTML = `<div class="account-info">
      <div class="info-item"><div class="info-label">Username</div><div class="info-value">${esc(d.username)}</div></div>
      <div class="info-item"><div class="info-label">Display Name</div><div class="info-value">${esc(d.display_name || '—')}</div></div>
      <div class="info-item"><div class="info-label">Customer Name</div><div class="info-value">${esc(d.customer_name || '—')}</div></div>
      ${lc ? `
        <div class="info-item"><div class="info-label">Company</div><div class="info-value">${esc(lc.company_name)}</div></div>
        <div class="info-item"><div class="info-label">Payment Term</div><div class="info-value">${esc(lc.payment_term || '—')}</div></div>
        <div class="info-item"><div class="info-label">Credit Limit</div><div class="info-value">${fmtMoney(lc.credit_limit)}</div></div>
      ` : ''}
    </div>`;
  } catch {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-text">Failed to load account info.</div></div>';
  }
}

async function saveAccount() {
  const alertEl = document.getElementById('acct-alert');
  alertEl.style.display = 'none';
  const display_name = document.getElementById('acct-display-name').value.trim();
  const new_password = document.getElementById('acct-new-pwd').value;
  const current_password = document.getElementById('acct-cur-pwd').value;

  if (new_password && !current_password) { showAlert('acct-alert', 'Please enter your current password to change it.'); return; }

  try {
    const res = await fetch('/api/customer-portal/my-account', {
      method: 'PATCH',
      headers: ctHeaders(),
      body: JSON.stringify({ display_name, ...(new_password ? { current_password, new_password } : {}) })
    });
    const d = await res.json();
    if (!res.ok) { showAlert('acct-alert', d.error || 'Save failed.'); return; }
    showAlert('acct-alert', 'Profile updated successfully!', 'success');
    document.getElementById('acct-cur-pwd').value = '';
    document.getElementById('acct-new-pwd').value = '';
    if (d.display_name) {
      localStorage.setItem('ct_display_name', d.display_name);
      document.getElementById('p-user-badge').textContent = d.display_name;
    }
    loadAccount();
  } catch {
    showAlert('acct-alert', 'Connection error. Please try again.');
  }
}
