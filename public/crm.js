const token = localStorage.getItem('ao_token');
const userRole = localStorage.getItem('ao_role');
const userName = localStorage.getItem('ao_display_name') || localStorage.getItem('ao_username') || '';
if (!token) window.location.href = '/login';

document.getElementById('header-user').textContent = userName;
document.getElementById('logout-btn').addEventListener('click', () => { localStorage.clear(); window.location.href = '/login'; });

// Hide new customer button for non-admin
if (userRole !== 'admin' && userRole !== 'super_admin') {
  const btn = document.getElementById('new-customer-btn');
  if (btn) btn.style.display = 'none';
}

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

// ── Tab navigation ──
document.querySelectorAll('.tab-nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
    btn.classList.add('active');
    const tab = document.getElementById(`tab-${btn.dataset.tab}`);
    tab.classList.remove('hidden');
    tab.classList.add('active');
    if (btn.dataset.tab === 'leads') loadLeads();
    if (btn.dataset.tab === 'customers') loadCustomers();
    if (btn.dataset.tab === 'quotations') loadQuotations();
  });
});

function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// ── Cached data ──
let allCustomers = [];
let allLeads = [];
let allQuotes = [];
let currentLeadFilter = '';
let currentQuoteFilter = '';

// ─────────────────────────────────────────────
// LEADS
// ─────────────────────────────────────────────
async function loadLeads() {
  document.getElementById('leads-table-wrap').innerHTML = '<div class="loading"><div class="spinner"></div> Loading…</div>';
  const url = currentLeadFilter ? `/api/leads?status=${currentLeadFilter}` : '/api/leads';
  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 401) { localStorage.clear(); window.location.href = '/login'; return; }
  allLeads = await res.json();
  renderLeads(allLeads);
}

function renderLeads(list) {
  if (!list.length) {
    document.getElementById('leads-table-wrap').innerHTML = '<div class="empty-state">No leads found</div>';
    return;
  }
  const statusColor = { new: 'blue', quoted: 'yellow', converted: 'green', lost: 'red' };
  document.getElementById('leads-table-wrap').innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>Customer</th><th>Source</th><th>Status</th><th>Notes</th><th>Created</th><th>Actions</th>
      </tr></thead>
      <tbody>${list.map(l => `
        <tr>
          <td><strong>${l.customers?.company_name || l.customer_name || '—'}</strong></td>
          <td>${capitalize(l.source || '')}</td>
          <td><span class="status-pill pill-${statusColor[l.status] || 'gray'}">${capitalize(l.status)}</span></td>
          <td style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${l.notes || '—'}</td>
          <td>${fmtDate(l.created_at)}</td>
          <td>
            <button class="btn btn-outline btn-sm" onclick="openLeadForm('${l.id}')">Edit</button>
            <button class="btn btn-primary btn-sm" onclick="openQuoteFromLead('${l.id}')">Quote</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

document.querySelectorAll('.lead-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.lead-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentLeadFilter = btn.dataset.status;
    loadLeads();
  });
});

function openLeadForm(id) {
  document.getElementById('lead-id').value = '';
  document.getElementById('lead-customer').value = '';
  document.getElementById('lead-customer-name').value = '';
  document.getElementById('lead-source').value = 'whatsapp';
  document.getElementById('lead-status').value = 'new';
  document.getElementById('lead-notes').value = '';
  document.getElementById('lead-modal-title').textContent = id ? 'Edit Lead' : 'New Lead';

  populateCustomerSelect('lead-customer');

  if (id) {
    const lead = allLeads.find(l => l.id === id);
    if (lead) {
      document.getElementById('lead-id').value = lead.id;
      document.getElementById('lead-customer').value = lead.customer_id || '';
      document.getElementById('lead-customer-name').value = lead.customer_name || '';
      document.getElementById('lead-source').value = lead.source || 'whatsapp';
      document.getElementById('lead-status').value = lead.status || 'new';
      document.getElementById('lead-notes').value = lead.notes || '';
    }
  }
  document.getElementById('lead-modal').classList.remove('hidden');
}

async function saveLead() {
  const id = document.getElementById('lead-id').value;
  const body = {
    customer_id: document.getElementById('lead-customer').value || null,
    customer_name: document.getElementById('lead-customer-name').value,
    source: document.getElementById('lead-source').value,
    status: document.getElementById('lead-status').value,
    notes: document.getElementById('lead-notes').value,
  };
  const url = id ? `/api/leads/${id}` : '/api/leads';
  const method = id ? 'PATCH' : 'POST';
  const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) { const e = await res.json(); alert(e.error || 'Failed to save'); return; }
  closeModal('lead-modal');
  loadLeads();
}

// ─────────────────────────────────────────────
// CUSTOMERS
// ─────────────────────────────────────────────
async function loadCustomers() {
  document.getElementById('customers-table-wrap').innerHTML = '<div class="loading"><div class="spinner"></div> Loading…</div>';
  try {
    const res = await fetch('/api/customers', { headers: authHeaders() });
    if (res.status === 401) { localStorage.clear(); window.location.href = '/login'; return; }
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    allCustomers = await res.json();
    if (!Array.isArray(allCustomers)) throw new Error('Unexpected response');
    renderCustomers(allCustomers);
  } catch (e) {
    document.getElementById('customers-table-wrap').innerHTML =
      `<div class="error" style="text-align:center;padding:32px">
        <div style="margin-bottom:12px">⚠️ Failed to load customers: ${e.message}</div>
        <button class="btn btn-primary" onclick="loadCustomers()">Retry</button>
      </div>`;
  }
}

function filterCustomers() {
  const q = document.getElementById('customer-search').value.toLowerCase();
  const filtered = allCustomers.filter(c =>
    (c.company_name || '').toLowerCase().includes(q) ||
    (c.contact_person || '').toLowerCase().includes(q) ||
    (c.phone || '').includes(q)
  );
  renderCustomers(filtered);
}

function renderCustomers(list) {
  if (!list.length) {
    document.getElementById('customers-table-wrap').innerHTML = '<div class="empty-state">No customers found</div>';
    return;
  }
  const isAdmin = userRole === 'admin' || userRole === 'super_admin';
  document.getElementById('customers-table-wrap').innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>Company</th><th>Contact</th><th>Phone</th><th>Email</th><th>Payment Term</th><th>Credit Limit</th>
        ${isAdmin ? '<th>Actions</th>' : ''}
      </tr></thead>
      <tbody>${list.map(c => `
        <tr>
          <td><strong>${c.company_name}</strong></td>
          <td>${c.contact_person || '—'}</td>
          <td>${c.phone || '—'}</td>
          <td>${c.email || '—'}</td>
          <td>${fmtPaymentTerm(c.payment_term)}</td>
          <td>${c.credit_limit ? `RM ${Number(c.credit_limit).toLocaleString()}` : '—'}</td>
          ${isAdmin ? `<td>
            <button class="btn btn-outline btn-sm" onclick="openCustomerForm('${c.id}')">Edit</button>
          </td>` : ''}
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function openCustomerForm(id) {
  ['cust-company','cust-contact','cust-phone','cust-email','cust-billing-email','cust-address','cust-notes',
   'cust-tin','cust-registration_no','cust-sst_no','cust-sql_account_code','cust-billing_address'].forEach(f => {
    const el = document.getElementById(f);
    if (el) el.value = '';
  });
  document.getElementById('cust-payment-term').value = 'cash';
  document.getElementById('cust-credit-limit').value = '0';
  document.getElementById('customer-id').value = '';
  document.getElementById('customer-modal-title').textContent = id ? 'Edit Customer' : 'New Customer';

  if (id) {
    const c = allCustomers.find(x => x.id === id);
    if (c) {
      document.getElementById('customer-id').value = c.id;
      document.getElementById('cust-company').value = c.company_name || '';
      document.getElementById('cust-contact').value = c.contact_person || '';
      document.getElementById('cust-phone').value = c.phone || '';
      document.getElementById('cust-email').value = c.email || '';
      document.getElementById('cust-billing-email').value = c.billing_email || '';
      document.getElementById('cust-address').value = c.address || '';
      document.getElementById('cust-payment-term').value = c.payment_term || 'cash';
      document.getElementById('cust-credit-limit').value = c.credit_limit || 0;
      document.getElementById('cust-notes').value = c.notes || '';
      // LHDN fields
      const tinEl = document.getElementById('cust-tin');
      const regEl = document.getElementById('cust-registration_no');
      const sstEl = document.getElementById('cust-sst_no');
      const sqlEl = document.getElementById('cust-sql_account_code');
      const bilEl = document.getElementById('cust-billing_address');
      if (tinEl) tinEl.value = c.tin || '';
      if (regEl) regEl.value = c.registration_no || '';
      if (sstEl) sstEl.value = c.sst_no || '';
      if (sqlEl) sqlEl.value = c.sql_account_code || '';
      if (bilEl) bilEl.value = c.billing_address || '';
    }
  }
  document.getElementById('customer-modal').classList.remove('hidden');
}

async function saveCustomer() {
  const id = document.getElementById('customer-id').value;
  const company_name = document.getElementById('cust-company').value.trim();
  if (!company_name) { alert('Company name is required'); return; }
  const body = {
    company_name,
    contact_person: document.getElementById('cust-contact').value,
    phone: document.getElementById('cust-phone').value,
    email: document.getElementById('cust-email').value,
    billing_email: document.getElementById('cust-billing-email').value,
    address: document.getElementById('cust-address').value,
    payment_term: document.getElementById('cust-payment-term').value,
    credit_limit: parseFloat(document.getElementById('cust-credit-limit').value) || 0,
    notes: document.getElementById('cust-notes').value,
    // LHDN / Tax fields
    tin: document.getElementById('cust-tin')?.value || '',
    registration_no: document.getElementById('cust-registration_no')?.value || '',
    sst_no: document.getElementById('cust-sst_no')?.value || '',
    sql_account_code: document.getElementById('cust-sql_account_code')?.value || '',
    billing_address: document.getElementById('cust-billing_address')?.value || '',
  };
  const url = id ? `/api/customers/${id}` : '/api/customers';
  const method = id ? 'PATCH' : 'POST';
  const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) { const e = await res.json(); alert(e.error || 'Failed to save'); return; }
  closeModal('customer-modal');
  loadCustomers();
}

// ─────────────────────────────────────────────
// QUOTATIONS
// ─────────────────────────────────────────────
async function loadQuotations() {
  document.getElementById('quotes-table-wrap').innerHTML = '<div class="loading"><div class="spinner"></div> Loading…</div>';
  const url = currentQuoteFilter ? `/api/quotations?status=${currentQuoteFilter}` : '/api/quotations';
  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 401) { localStorage.clear(); window.location.href = '/login'; return; }
  allQuotes = await res.json();
  renderQuotations(allQuotes);
  // Refresh customers cache for forms
  if (!allCustomers.length) {
    const cr = await fetch('/api/customers', { headers: authHeaders() });
    allCustomers = await cr.json();
  }
}

function renderQuotations(list) {
  if (!list.length) {
    document.getElementById('quotes-table-wrap').innerHTML = '<div class="empty-state">No quotations found</div>';
    return;
  }
  const statusColor = { draft: 'gray', sent: 'blue', accepted: 'green', rejected: 'red', expired: 'yellow', converted: 'green' };
  document.getElementById('quotes-table-wrap').innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>Quote No</th><th>Customer</th><th>Total</th><th>Valid Until</th><th>Status</th><th>Actions</th>
      </tr></thead>
      <tbody>${list.map(q => `
        <tr>
          <td><strong>${q.quote_no}</strong></td>
          <td>${q.customers?.company_name || '—'}</td>
          <td>RM ${Number(q.total_amount || 0).toLocaleString('en-MY', { minimumFractionDigits: 2 })}</td>
          <td>${q.valid_until ? fmtDate(q.valid_until) : '—'}</td>
          <td><span class="status-pill pill-${statusColor[q.status] || 'gray'}">${capitalize(q.status)}</span></td>
          <td>
            <button class="btn btn-outline btn-sm" onclick="openQuoteForm('${q.id}')">Edit</button>
            ${q.status !== 'converted' ? `<button class="btn btn-success btn-sm" onclick="openConvertModal('${q.id}')">→ SO</button>` : '<span style="font-size:12px;color:var(--green)">✓ Converted</span>'}
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

document.querySelectorAll('.quote-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.quote-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentQuoteFilter = btn.dataset.status;
    loadQuotations();
  });
});

let quoteItems = [];

function openQuoteForm(id, prefillLeadId) {
  quoteItems = [{ product: '', qty: 1, unit_price: 0 }];
  document.getElementById('quote-id').value = '';
  document.getElementById('quote-status').value = 'draft';
  document.getElementById('quote-notes').value = '';
  document.getElementById('quote-subtotal').value = '';
  document.getElementById('quote-discount').value = '0';
  document.getElementById('quote-total').value = '';
  document.getElementById('quote-modal-title').textContent = id ? 'Edit Quotation' : 'New Quotation';

  // Set default valid until = today + 14 days
  const d = new Date(); d.setDate(d.getDate() + 14);
  document.getElementById('quote-valid-until').value = d.toISOString().split('T')[0];

  populateCustomerSelect('quote-customer');
  populateLeadSelect();

  if (id) {
    const q = allQuotes.find(x => x.id === id);
    if (q) {
      document.getElementById('quote-id').value = q.id;
      document.getElementById('quote-customer').value = q.customer_id || '';
      document.getElementById('quote-lead').value = q.lead_id || '';
      document.getElementById('quote-valid-until').value = q.valid_until || '';
      document.getElementById('quote-status').value = q.status || 'draft';
      document.getElementById('quote-subtotal').value = q.subtotal || '';
      document.getElementById('quote-discount').value = q.discount || '0';
      document.getElementById('quote-total').value = q.total_amount || '';
      document.getElementById('quote-notes').value = q.notes || '';
      quoteItems = q.items && q.items.length ? q.items : [{ product: '', qty: 1, unit_price: 0 }];
    }
  }
  if (prefillLeadId) document.getElementById('quote-lead').value = prefillLeadId;
  renderQuoteItems();
  document.getElementById('quote-modal').classList.remove('hidden');
}

function openQuoteFromLead(leadId) {
  const lead = allLeads.find(l => l.id === leadId);
  // Switch to quotations tab first
  document.querySelectorAll('.tab-nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => { t.classList.add('hidden'); t.classList.remove('active'); });
  document.querySelector('[data-tab="quotations"]').classList.add('active');
  document.getElementById('tab-quotations').classList.remove('hidden');
  if (!allQuotes.length) loadQuotations();
  setTimeout(() => openQuoteForm(null, leadId), 300);
}

function renderQuoteItems() {
  document.getElementById('quote-items-list').innerHTML = quoteItems.map((item, i) => `
    <div style="display:grid;grid-template-columns:2fr 80px 100px 30px;gap:8px;margin-bottom:6px;align-items:center">
      <input type="text" class="form-input" placeholder="Product / description" value="${item.product || ''}"
        oninput="quoteItems[${i}].product=this.value">
      <input type="number" class="form-input" placeholder="Qty" value="${item.qty || 1}" min="1"
        oninput="quoteItems[${i}].qty=parseInt(this.value)||1;calcItemSubtotal()">
      <input type="number" class="form-input" placeholder="Unit price" value="${item.unit_price || ''}" step="0.01" min="0"
        oninput="quoteItems[${i}].unit_price=parseFloat(this.value)||0;calcItemSubtotal()">
      <button class="btn btn-danger btn-sm" onclick="removeQuoteItem(${i})" style="padding:4px 8px">✕</button>
    </div>`).join('');
}

function addQuoteItem() {
  quoteItems.push({ product: '', qty: 1, unit_price: 0 });
  renderQuoteItems();
}

function removeQuoteItem(i) {
  quoteItems.splice(i, 1);
  if (!quoteItems.length) quoteItems.push({ product: '', qty: 1, unit_price: 0 });
  renderQuoteItems();
}

function calcItemSubtotal() {
  const subtotal = quoteItems.reduce((s, i) => s + (i.qty * i.unit_price), 0);
  document.getElementById('quote-subtotal').value = subtotal.toFixed(2);
  calcQuoteTotal();
}

function calcQuoteTotal() {
  const sub = parseFloat(document.getElementById('quote-subtotal').value) || 0;
  const disc = parseFloat(document.getElementById('quote-discount').value) || 0;
  document.getElementById('quote-total').value = Math.max(0, sub - disc).toFixed(2);
}

async function saveQuote() {
  const id = document.getElementById('quote-id').value;
  const customer_id = document.getElementById('quote-customer').value;
  if (!customer_id) { alert('Please select a customer'); return; }
  const body = {
    customer_id,
    lead_id: document.getElementById('quote-lead').value || null,
    items: quoteItems.filter(i => i.product),
    subtotal: parseFloat(document.getElementById('quote-subtotal').value) || 0,
    discount: parseFloat(document.getElementById('quote-discount').value) || 0,
    total_amount: parseFloat(document.getElementById('quote-total').value) || 0,
    valid_until: document.getElementById('quote-valid-until').value || null,
    status: document.getElementById('quote-status').value,
    notes: document.getElementById('quote-notes').value,
  };
  const url = id ? `/api/quotations/${id}` : '/api/quotations';
  const method = id ? 'PATCH' : 'POST';
  const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) { const e = await res.json(); alert(e.error || 'Failed to save'); return; }
  closeModal('quote-modal');
  loadQuotations();
}

let pendingConvertId = null;
function openConvertModal(id) {
  pendingConvertId = id;
  const q = allQuotes.find(x => x.id === id);
  if (q) {
    document.getElementById('convert-summary').textContent =
      `Convert ${q.quote_no} (${q.customers?.company_name || ''}) — Total: RM ${Number(q.total_amount || 0).toLocaleString('en-MY', { minimumFractionDigits: 2 })}`;
  }
  document.getElementById('convert-modal').classList.remove('hidden');
}

async function confirmConvert() {
  const res = await fetch(`/api/quotations/${pendingConvertId}/convert`, { method: 'POST', headers: authHeaders() });
  if (!res.ok) { const e = await res.json(); alert(e.error || 'Failed to convert'); return; }
  closeModal('convert-modal');
  loadQuotations();
  alert('Sales Order created successfully!');
}

// ── Helpers ──
function populateCustomerSelect(elId) {
  const sel = document.getElementById(elId);
  const current = sel.value;
  sel.innerHTML = '<option value="">— Select customer —</option>' +
    allCustomers.map(c => `<option value="${c.id}">${c.company_name}</option>`).join('');
  if (current) sel.value = current;
}

function populateLeadSelect() {
  const sel = document.getElementById('quote-lead');
  sel.innerHTML = '<option value="">— None —</option>' +
    allLeads.filter(l => l.status !== 'converted').map(l =>
      `<option value="${l.id}">${l.customers?.company_name || l.customer_name || l.id}</option>`
    ).join('');
}

function onQuoteCustomerChange() {
  const custId = document.getElementById('quote-customer').value;
  // Filter leads for this customer
  const filtered = custId ? allLeads.filter(l => l.customer_id === custId) : allLeads;
  const sel = document.getElementById('quote-lead');
  const current = sel.value;
  sel.innerHTML = '<option value="">— None —</option>' +
    filtered.filter(l => l.status !== 'converted').map(l =>
      `<option value="${l.id}">${l.customers?.company_name || l.customer_name || l.id}</option>`
    ).join('');
  if (current) sel.value = current;
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : ''; }
function fmtDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' }); }
function fmtPaymentTerm(t) { return { cash: 'Cash', '50_50': '50/50 Deposit', net30: 'Net 30' }[t] || t || '—'; }
function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// ── Init ──
async function init() {
  try {
    const [cr, lr] = await Promise.all([
      fetch('/api/customers', { headers: authHeaders() }),
      fetch('/api/leads', { headers: authHeaders() })
    ]);
    if (cr.status === 401) { localStorage.clear(); window.location.href = '/login'; return; }
    if (cr.ok) { const d = await cr.json(); if (Array.isArray(d)) allCustomers = d; }
    if (lr.ok) { const d = await lr.json(); if (Array.isArray(d)) allLeads = d; }
    loadLeads();
  } catch (e) {
    console.error('CRM init error:', e);
    loadLeads(); // still try to show what we can
  }
}

init();

// ── Portal Requests ────────────────────────────────────────────────────────
let _prFilter = '';

document.querySelectorAll('.pr-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pr-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _prFilter = btn.dataset.status;
    loadPortalRequests();
  });
});

async function loadPortalRequests() {
  const wrap = document.getElementById('portal-requests-wrap');
  wrap.innerHTML = '<div class="loading"><div class="spinner"></div> Loading…</div>';
  try {
    const url = '/api/customer-portal/admin/requests' + (_prFilter ? `?status=${_prFilter}` : '');
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) { wrap.innerHTML = `<div style="padding:20px;color:var(--red)">Error loading requests</div>`; return; }
    const data = await res.json();

    // Update badge
    const pending = data.filter(r => r.status === 'pending').length;
    const badge = document.getElementById('portal-req-badge2');
    if (badge) { badge.textContent = pending; badge.style.display = pending > 0 ? 'inline' : 'none'; }

    if (!data.length) {
      wrap.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted)">No portal requests yet.</div>';
      return;
    }

    // Store for modal use
    window._portalRequests = data;

    wrap.innerHTML = `<table>
      <thead><tr><th>PO #</th><th>Customer</th><th>Items</th><th>Est. Price</th><th>Remarks</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${data.map(r => {
        const isCart = Array.isArray(r.config_snapshot?.items);
        const poNo = (r.request_no || r.id.slice(0,8)).replace(/^QR-/, 'PO-');

        // Items column — clickable summary
        let itemsCell = '';
        if (isCart) {
          const cartItems = r.config_snapshot.items || [];
          itemsCell = `<span style="color:var(--indigo);cursor:pointer;text-decoration:underline dotted;font-weight:600"
            onclick="showPortalItemsDetail('${r.id}')">${cartItems.length} item(s) — view details</span>`;
        } else {
          const cfgSnap = r.config_snapshot || {};
          const cfg = Object.entries(cfgSnap)
            .filter(([k,v]) => k !== 'items' && v !== null && v !== '' && v !== false)
            .map(([k,v]) => `${k.replace(/_/g,' ')}: ${v}`).join(' · ');
          itemsCell = `<strong>${esc(r.product_name)}</strong>`
            + (cfg ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(cfg)}</div>` : '');
        }

        return `<tr>
          <td><strong>${esc(poNo)}</strong></td>
          <td>${esc(r.customer_name)}</td>
          <td>${itemsCell}</td>
          <td>${r.estimated_price ? 'RM ' + parseFloat(r.estimated_price).toFixed(2) : '—'}</td>
          <td style="max-width:140px;font-size:12px;font-weight:${r.notes?'700':'400'};color:${r.notes?'#dc2626':'inherit'}">${r.notes ? esc(r.notes) : '—'}</td>
          <td>${fmtDate(r.created_at)}</td>
          <td><span class="status-badge status-${r.status}">${capitalize(r.status)}</span></td>
          <td>
            ${r.status === 'pending' ? `
              <button class="btn btn-primary btn-sm" style="white-space:nowrap" onclick="openSOConfirmModal('${r.id}')">✓ Confirm as SO</button>
              <button class="btn btn-outline btn-sm" style="color:var(--red);margin-top:4px;display:block" onclick="rejectPortalRequest('${r.id}')">✕ Reject</button>
            ` : r.status === 'converted' ? `<span style="color:#10b981;font-weight:600">✓ SO Created</span>` : '—'}
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  } catch(e) {
    wrap.innerHTML = `<div style="padding:20px;color:var(--red)">${e.message}</div>`;
  }
}

function showPortalItemsDetail(reqId) {
  const r = (window._portalRequests || []).find(x => x.id === reqId);
  if (!r) return;
  const items = r.config_snapshot?.items || [];
  const poNo = (r.request_no || r.id.slice(0,8)).replace(/^QR-/, 'PO-');

  let lb = document.getElementById('portal-items-lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'portal-items-lightbox';
    lb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:900;display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow-y:auto';
    lb.onclick = e => { if (e.target === lb) lb.remove(); };
    document.body.appendChild(lb);
  }

  lb.innerHTML = `
    <div style="background:var(--white,#fff);border-radius:12px;padding:24px;width:100%;max-width:600px;box-shadow:0 8px 32px rgba(0,0,0,.2);margin:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div>
          <div style="font-size:17px;font-weight:700">${esc(poNo)} — ${esc(r.customer_name)}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:2px">${items.length} item(s) · ${fmtDate(r.created_at)}</div>
        </div>
        <button onclick="document.getElementById('portal-items-lightbox').remove()"
          style="background:none;border:none;font-size:22px;cursor:pointer;color:#6b7280;line-height:1">✕</button>
      </div>
      ${items.map((item, i) => `
        <div style="border:1.5px solid #e5e7eb;border-radius:10px;padding:14px;margin-bottom:10px">
          <div style="font-weight:700;margin-bottom:6px">${i+1}. ${esc(item.product_name)} <span style="color:#6b7280;font-weight:400">×${item.quantity}</span></div>
          ${item.config_lines?.length ? `<div style="font-size:12px;color:#6b7280;margin-bottom:6px">${item.config_lines.map(l=>esc(l)).join(' · ')}</div>` : ''}
          ${item.notes ? `<div style="font-size:13px;font-weight:700;color:#dc2626;margin-bottom:6px">REMARKS: ${esc(item.notes)}</div>` : ''}
          <div style="display:flex;justify-content:space-between;font-size:13px;border-top:1px solid #e5e7eb;padding-top:8px;margin-top:6px">
            <span style="color:#6b7280">${fmtMoney ? fmtMoney(item.unit_price) : 'RM '+parseFloat(item.unit_price||0).toFixed(2)} / unit</span>
            <strong style="color:#4f46e5">RM ${parseFloat(item.subtotal||0).toFixed(2)}</strong>
          </div>
        </div>
      `).join('')}
      ${r.notes ? `<div style="font-size:13px;font-weight:700;color:#dc2626;margin-top:4px">REMARKS: ${esc(r.notes)}</div>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;padding-top:16px;border-top:2px solid #e5e7eb">
        <span style="color:#6b7280">Estimated Total</span>
        <strong style="font-size:20px;color:#4f46e5">RM ${parseFloat(r.estimated_price||0).toFixed(2)}</strong>
      </div>
      <div style="text-align:right;margin-top:12px">
        <button class="btn btn-outline" onclick="document.getElementById('portal-items-lightbox').remove()">Close</button>
      </div>
    </div>`;
}

function openSOConfirmModal(reqId) {
  const r = (window._portalRequests || []).find(x => x.id === reqId);
  if (!r) return;
  const isCart = Array.isArray(r.config_snapshot?.items);
  const poNo = (r.request_no || r.id.slice(0,8)).replace(/^QR-/, 'PO-');

  // Build items list for display
  let itemsHtml = '';
  let soItems = [];
  if (isCart) {
    soItems = (r.config_snapshot.items || []).map(i => ({
      product: i.product_name + (i.config_lines?.length ? ' (' + i.config_lines.join(', ') + ')' : '') + (i.notes ? ' | REMARKS: ' + i.notes : ''),
      qty: i.quantity || 1,
      unit_price: i.unit_price || 0,
      subtotal: i.subtotal || 0,
      supplier: 'ADSB'
    }));
    itemsHtml = soItems.map(i =>
      `<div style="padding:8px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;gap:12px;font-size:13px">
        <span>${esc(i.description)}</span>
        <span style="white-space:nowrap;font-weight:600">×${i.qty} @ RM ${parseFloat(i.unit_price).toFixed(2)}</span>
      </div>`
    ).join('');
  } else {
    const cfgDesc = r.config_snapshot ? Object.entries(r.config_snapshot)
      .filter(([k,v]) => k !== 'items' && v !== null && v !== '' && v !== false)
      .map(([k,v]) => `${k.replace(/_/g,' ')}: ${v}`).join(', ') : '';
    soItems = [{ product: r.product_name + (cfgDesc ? ' (' + cfgDesc + ')' : '') + (r.notes ? ' | REMARKS: ' + r.notes : ''), qty: 1, unit_price: parseFloat(r.estimated_price)||0, subtotal: parseFloat(r.estimated_price)||0, supplier: 'ADSB' }];
    itemsHtml = `<div style="padding:8px 0;font-size:13px">${esc(soItems[0].description)}</div>`;
  }

  // Pre-match customer
  const matchedCustomer = allCustomers.find(c => c.company_name && c.company_name.toLowerCase().includes(r.customer_name.toLowerCase()));
  const customerOptions = allCustomers.map(c =>
    `<option value="${c.id}" ${matchedCustomer?.id === c.id ? 'selected' : ''}>${esc(c.company_name)}</option>`
  ).join('');

  const modal = document.getElementById('so-confirm-modal');
  document.getElementById('so-confirm-req-id').value = reqId;
  document.getElementById('so-confirm-items-json').value = JSON.stringify(soItems);
  document.getElementById('so-confirm-total').value = parseFloat(r.estimated_price) || 0;
  document.getElementById('so-confirm-title').textContent = `Confirm Sales Order — ${poNo}`;
  document.getElementById('so-confirm-customer-name').textContent = r.customer_name;
  document.getElementById('so-confirm-items-preview').innerHTML = itemsHtml;
  document.getElementById('so-confirm-total-display').textContent = 'RM ' + parseFloat(r.estimated_price||0).toFixed(2);
  document.getElementById('so-confirm-customer').innerHTML = `<option value="">— Select Customer —</option>` + customerOptions;
  document.getElementById('so-confirm-notes').value = r.notes || '';
  document.getElementById('so-confirm-delivery-date').value = '';
  document.getElementById('so-confirm-alert').style.display = 'none';
  modal.classList.remove('hidden');
}

async function confirmPortalSO() {
  const reqId    = document.getElementById('so-confirm-req-id').value;
  const custId   = document.getElementById('so-confirm-customer').value;
  const items    = JSON.parse(document.getElementById('so-confirm-items-json').value || '[]');
  const total    = parseFloat(document.getElementById('so-confirm-total').value) || 0;
  const notes    = document.getElementById('so-confirm-notes').value.trim();
  const delivery = document.getElementById('so-confirm-delivery-date').value;
  const alertEl  = document.getElementById('so-confirm-alert');
  alertEl.style.display = 'none';

  if (!custId) { alertEl.className = 'alert alert-error'; alertEl.textContent = 'Please select a customer.'; alertEl.style.display = 'block'; return; }
  if (!items.length) { alertEl.className = 'alert alert-error'; alertEl.textContent = 'No items found.'; alertEl.style.display = 'block'; return; }

  const soItems = items.map(i => ({
    product: i.product,
    qty: i.qty,
    unit_price: i.unit_price,
    subtotal: i.subtotal,
    supplier: i.supplier || 'ADSB'
  }));

  try {
    // 1. Create Sales Order
    const soRes = await fetch('/api/sales-orders', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        customer_id: custId,
        items: soItems,
        subtotal: total,
        total_amount: total,
        notes,
        delivery_date: delivery || null,
        status: 'confirmed'
      })
    });
    const soData = await soRes.json();
    if (!soRes.ok) { alertEl.className = 'alert alert-error'; alertEl.textContent = soData.error || 'Failed to create Sales Order.'; alertEl.style.display = 'block'; return; }

    // 2. Mark portal request as converted
    await fetch(`/api/customer-portal/admin/requests/${reqId}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ status: 'converted' })
    });

    document.getElementById('so-confirm-modal').classList.add('hidden');
    alert(`✓ Sales Order ${soData.so_no} created successfully!`);
    loadPortalRequests();
  } catch(e) {
    alertEl.className = 'alert alert-error'; alertEl.textContent = e.message; alertEl.style.display = 'block';
  }
}

async function rejectPortalRequest(id) {
  if (!confirm('Mark this request as rejected?')) return;
  try {
    await fetch(`/api/customer-portal/admin/requests/${id}`, {
      method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ status: 'rejected' })
    });
    loadPortalRequests();
  } catch(e) { alert(e.message); }
}

function createQuoteFromRequest(reqId, customerName, productName, estimatedPrice) {
  // Find customer in allCustomers by company_name match
  const customer = allCustomers.find(c => c.company_name && c.company_name.toLowerCase() === customerName.toLowerCase());

  // Open quote modal pre-filled
  openQuoteForm();
  if (customer) {
    document.getElementById('quote-customer').value = customer.id;
    onQuoteCustomerChange();
  }
  document.getElementById('quote-notes').value = `Portal request for: ${productName}`;
  document.getElementById('quote-subtotal').value = estimatedPrice || '';
  document.getElementById('quote-total').value = estimatedPrice || '';
  // Store reqId to link after save
  document.getElementById('quote-modal')._portalReqId = reqId;
}

// Patch saveQuote to link portal request after creating quote
const _origSaveQuote = typeof saveQuote === 'function' ? saveQuote : null;
if (typeof saveQuote === 'function') {
  const _wrappedSaveQuote = async function() {
    const reqId = document.getElementById('quote-modal')._portalReqId;
    await saveQuote();
    if (reqId) {
      // After save, link the latest quote to this request
      try {
        const res = await fetch('/api/quotations?customer_id=', { headers: authHeaders() });
        // Simple approach: mark the request as 'quoted'
        await fetch(`/api/customer-portal/admin/requests/${reqId}`, {
          method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ status: 'quoted' })
        });
        document.getElementById('quote-modal')._portalReqId = null;
        loadPortalRequests();
      } catch {}
    }
  };
}
