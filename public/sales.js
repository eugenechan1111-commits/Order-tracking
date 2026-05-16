const token = localStorage.getItem('ao_token');
const userRole = localStorage.getItem('ao_role');
const userName = localStorage.getItem('ao_display_name') || localStorage.getItem('ao_username') || '';
if (!token) window.location.href = '/login';

document.getElementById('header-user').textContent = userName;
document.getElementById('logout-btn').addEventListener('click', () => { localStorage.clear(); window.location.href = '/login'; });

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

// ── Tab navigation ──
document.querySelectorAll('.tab-nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => { t.classList.add('hidden'); t.classList.remove('active'); });
    btn.classList.add('active');
    const tab = document.getElementById(`tab-${btn.dataset.tab}`);
    tab.classList.remove('hidden');
    tab.classList.add('active');
    if (btn.dataset.tab === 'tasks') loadTaskQueue();
    if (btn.dataset.tab === 'so') loadSalesOrders();
    if (btn.dataset.tab === 'invoices') loadInvoices();
    if (btn.dataset.tab === 'payments') loadPortalPaymentsSales();
  });
});

function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

let allCustomers = [];
let allSOs = [];
let allInvoices = [];
let currentSOFilter = '';
let currentInvFilter = '';
let invLineItems = [];

const soStatusColor = {
  draft: 'gray', deposit_pending: 'yellow', confirmed: 'blue',
  in_production: 'blue', ready: 'green', delivered: 'green',
  invoiced: 'yellow', paid: 'green', cancelled: 'red'
};
const soStatusLabel = {
  deposit_pending: 'Payment Pending',
  in_production: 'In Production'
};
function soLabel(status) { return soStatusLabel[status] || capitalize(status); }

// ─────────────────────────────────────────────
// TASK QUEUE
// ─────────────────────────────────────────────
async function loadTaskQueue() {
  document.getElementById('task-list').innerHTML = '<div class="loading"><div class="spinner"></div> Loading…</div>';
  const entity = typeof getEntity === 'function' ? getEntity() : 'AOSB';
  const res = await fetch(`/api/sales-orders/task-queue?entity=${entity}`, { headers: authHeaders() });
  if (res.status === 401) { localStorage.clear(); window.location.href = '/login'; return; }
  const tasks = await res.json();
  renderTaskQueue(tasks);
}

function renderTaskQueue(tasks) {
  document.getElementById('task-count').textContent = `— ${tasks.length} item${tasks.length !== 1 ? 's' : ''}`;
  if (!tasks.length) {
    document.getElementById('task-list').innerHTML = '<div class="empty-state" style="color:var(--green)">✓ All caught up! No overdue actions.</div>';
    return;
  }
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('task-list').innerHTML = tasks.map(t => {
    const due = t.next_action_due || '';
    const daysOverdue = due ? Math.floor((new Date(today) - new Date(due)) / 86400000) : 0;
    const urgency = daysOverdue > 2 ? 'task-card-urgent' : daysOverdue > 0 ? 'task-card-warning' : '';
    return `
      <div class="task-card ${urgency}">
        <div class="task-card-main">
          <span class="task-so-no">${t.so_no}</span>
          <span class="task-customer">${t.customers?.company_name || '—'}</span>
          <span class="task-action">${t.next_action}</span>
          <span class="status-pill pill-${soStatusColor[t.status] || 'gray'}">${soLabel(t.status)}</span>
        </div>
        <div class="task-card-sub">
          <span class="${daysOverdue > 0 ? 'overdue' : ''}">${daysOverdue > 0 ? `${daysOverdue}d overdue` : `Due: ${fmtDate(due)}`}</span>
          <span>RM ${Number(t.total_amount || 0).toLocaleString('en-MY', { minimumFractionDigits: 2 })}</span>
        </div>
        <div class="task-card-actions">
          <button class="btn btn-primary btn-sm" onclick="openSODetails('${t.id}')">View Order</button>
        </div>
      </div>`;
  }).join('');
}

// ─────────────────────────────────────────────
// SALES ORDERS
// ─────────────────────────────────────────────
async function loadSalesOrders() {
  document.getElementById('so-table-wrap').innerHTML = '<div class="loading"><div class="spinner"></div> Loading…</div>';
  const entity = typeof getEntity === 'function' ? getEntity() : 'AOSB';
  const params = new URLSearchParams({ entity });
  if (currentSOFilter) params.set('status', currentSOFilter);
  const res = await fetch(`/api/sales-orders?${params}`, { headers: authHeaders() });
  if (res.status === 401) { localStorage.clear(); window.location.href = '/login'; return; }
  allSOs = await res.json();
  renderSalesOrders(allSOs);
}

function renderSalesOrders(list) {
  if (!list.length) {
    document.getElementById('so-table-wrap').innerHTML = '<div class="empty-state">No sales orders found</div>';
    return;
  }
  document.getElementById('so-table-wrap').innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>SO No</th><th>Customer</th><th>Total</th><th>Payment</th><th>Delivery</th><th>Status</th><th>Next Action</th><th>Actions</th>
      </tr></thead>
      <tbody>${list.map(so => `
        <tr>
          <td><strong>${so.so_no}</strong></td>
          <td>${so.customers?.company_name || '—'}</td>
          <td>RM ${Number(so.total_amount || 0).toLocaleString('en-MY', { minimumFractionDigits: 2 })}</td>
          <td>${fmtPaymentTerm(so.payment_term)}</td>
          <td>${so.delivery_date ? fmtDate(so.delivery_date) : '—'}</td>
          <td><span class="status-pill pill-${soStatusColor[so.status] || 'gray'}">${soLabel(so.status)}</span></td>
          <td style="font-size:12px;color:${so.next_action_due && so.next_action_due <= new Date().toISOString().split('T')[0] ? 'var(--red)' : 'var(--gray-600)'}">
            ${so.next_action || '—'}${so.next_action_due ? ` (${fmtDate(so.next_action_due)})` : ''}
          </td>
          <td>
            <button class="btn btn-outline btn-sm" onclick="openSODetails('${so.id}')">Manage</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

document.querySelectorAll('.so-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.so-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentSOFilter = btn.dataset.status;
    loadSalesOrders();
  });
});

let soItems = [];

function openSOForm(id) {
  soItems = [{ product: '', qty: 1, unit_price: 0, supplier: 'ADSB' }];
  document.getElementById('so-id').value = '';
  document.getElementById('so-customer').value = '';
  document.getElementById('so-payment-term').value = 'cash';
  document.getElementById('so-delivery-type').value = 'delivery';
  document.getElementById('so-delivery-address').value = '';
  document.getElementById('so-delivery-date').value = '';
  document.getElementById('so-subtotal').value = '';
  document.getElementById('so-discount').value = '0';
  document.getElementById('so-total').value = '';
  document.getElementById('so-notes').value = '';
  document.getElementById('so-modal-title').textContent = 'New Sales Order';

  populateCustomerSelectSales('so-customer');

  if (id) {
    const so = allSOs.find(x => x.id === id);
    if (so) {
      document.getElementById('so-id').value = so.id;
      document.getElementById('so-customer').value = so.customer_id || '';
      document.getElementById('so-payment-term').value = so.payment_term || 'cash';
      document.getElementById('so-delivery-type').value = so.delivery_type || 'delivery';
      document.getElementById('so-delivery-address').value = so.delivery_address || '';
      document.getElementById('so-delivery-date').value = so.delivery_date || '';
      document.getElementById('so-subtotal').value = so.subtotal || '';
      document.getElementById('so-discount').value = so.discount || '0';
      document.getElementById('so-total').value = so.total_amount || '';
      document.getElementById('so-notes').value = so.notes || '';
      document.getElementById('so-modal-title').textContent = `Edit ${so.so_no}`;
      // Normalise items — handle legacy 'description' field from portal SO creation
      soItems = so.items && so.items.length
        ? so.items.map(i => ({ ...i, product: i.product || i.description || '' }))
        : [{ product: '', qty: 1, unit_price: 0, supplier: 'ADSB' }];
    }
  }
  renderSOItems();
  document.getElementById('so-modal').classList.remove('hidden');
}

function renderSOItems() {
  document.getElementById('so-items-list').innerHTML = soItems.map((item, i) => `
    <div style="display:grid;grid-template-columns:2fr 70px 100px 100px 30px;gap:8px;margin-bottom:6px;align-items:center">
      <input type="text" class="form-input" placeholder="Product" value="${item.product || ''}"
        oninput="soItems[${i}].product=this.value">
      <input type="number" class="form-input" placeholder="Qty" value="${item.qty || 1}" min="1"
        oninput="soItems[${i}].qty=parseInt(this.value)||1;calcSOItemSubtotal()">
      <input type="number" class="form-input" placeholder="Unit price" value="${item.unit_price || ''}" step="0.01" min="0"
        oninput="soItems[${i}].unit_price=parseFloat(this.value)||0;calcSOItemSubtotal()">
      <select class="form-input" onchange="soItems[${i}].supplier=this.value">
        <option value="ADSB" ${(item.supplier||'ADSB')==='ADSB'?'selected':''}>ADSB (Mfg)</option>
        <option value="external" ${item.supplier==='external'?'selected':''}>External</option>
      </select>
      <button class="btn btn-danger btn-sm" onclick="removeSOItem(${i})" style="padding:4px 8px">✕</button>
    </div>`).join('');
}

function addSOItem() {
  soItems.push({ product: '', qty: 1, unit_price: 0, supplier: 'ADSB' });
  renderSOItems();
}

function removeSOItem(i) {
  soItems.splice(i, 1);
  if (!soItems.length) soItems.push({ product: '', qty: 1, unit_price: 0, supplier: 'ADSB' });
  renderSOItems();
}

function calcSOItemSubtotal() {
  const subtotal = soItems.reduce((s, i) => s + (i.qty * i.unit_price), 0);
  document.getElementById('so-subtotal').value = subtotal.toFixed(2);
  calcSOTotal();
}

function calcSOTotal() {
  const sub = parseFloat(document.getElementById('so-subtotal').value) || 0;
  const disc = parseFloat(document.getElementById('so-discount').value) || 0;
  document.getElementById('so-total').value = Math.max(0, sub - disc).toFixed(2);
}

async function saveSO() {
  const id = document.getElementById('so-id').value;
  const customer_id = document.getElementById('so-customer').value;
  if (!customer_id) { alert('Please select a customer'); return; }
  const body = {
    customer_id,
    entity: typeof getEntity === 'function' ? getEntity() : 'AOSB',
    items: soItems.filter(i => i.product),
    subtotal: parseFloat(document.getElementById('so-subtotal').value) || 0,
    discount: parseFloat(document.getElementById('so-discount').value) || 0,
    total_amount: parseFloat(document.getElementById('so-total').value) || 0,
    payment_term: document.getElementById('so-payment-term').value,
    delivery_date: document.getElementById('so-delivery-date').value || null,
    delivery_type: document.getElementById('so-delivery-type').value,
    delivery_address: document.getElementById('so-delivery-address').value,
    notes: document.getElementById('so-notes').value,
  };
  const url = id ? `/api/sales-orders/${id}` : '/api/sales-orders';
  const method = id ? 'PATCH' : 'POST';
  const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) { const e = await res.json(); alert(e.error || 'Failed to save'); return; }
  closeModal('so-modal');
  loadSalesOrders();
  loadTaskQueue();
}

// ── SO Details / Actions ──
let pendingSOId = null;
let pendingSOAction = null;

function openSODetails(id) {
  const so = allSOs.find(x => x.id === id);
  if (!so) return;
  pendingSOId = id;

  const statusFlow = ['draft', 'deposit_pending', 'confirmed', 'in_production', 'ready', 'delivered', 'invoiced', 'paid'];
  const currentIdx = statusFlow.indexOf(so.status);
  const nextStatus = statusFlow[currentIdx + 1];

  const depositNeeded = so.payment_term !== 'cash' && !so.deposit_paid_at && so.status === 'deposit_pending';

  let body = `
    <div style="margin-bottom:16px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:14px">
        <div><strong>SO No:</strong> ${so.so_no}</div>
        <div><strong>Customer:</strong> ${so.customers?.company_name || '—'}</div>
        <div><strong>Total:</strong> RM ${Number(so.total_amount || 0).toLocaleString('en-MY', { minimumFractionDigits: 2 })}</div>
        <div><strong>Status:</strong> <span class="status-pill pill-${soStatusColor[so.status] || 'gray'}">${soLabel(so.status)}</span></div>
        <div><strong>Payment:</strong> ${fmtPaymentTerm(so.payment_term)}</div>
        <div><strong>Delivery:</strong> ${so.delivery_date ? fmtDate(so.delivery_date) : '—'}</div>
        ${so.next_action ? `<div style="grid-column:span 2"><strong>Next Action:</strong> ${so.next_action}</div>` : ''}
      </div>
    </div>`;

  const actions = [];

  if (depositNeeded) {
    actions.push(`<button class="btn btn-warning" onclick="openDepositModal('${id}')">Record Deposit</button>`);
  }
  if (nextStatus && !depositNeeded) {
    const labels = {
      confirmed: 'Confirm Order',
      in_production: 'Mark In Production',
      ready: 'Mark Ready',
      delivered: 'Mark Delivered',
      invoiced: 'Create Invoice',
      paid: 'Mark Paid',
    };
    actions.push(`<button class="btn btn-primary" onclick="advanceSOStatus('${id}', '${nextStatus}')">${labels[nextStatus] || `→ ${capitalize(nextStatus)}`}</button>`);
  }
  if (so.status === 'confirmed' && !so.job_order_id) {
    actions.push(`<button class="btn btn-outline" onclick="createJobOrder('${id}')">Create Job Order</button>`);
  }
  if (nextStatus === 'invoiced') {
    actions.push(`<button class="btn btn-success" onclick="openInvoiceFormForSO('${id}')">Create Invoice</button>`);
  }
  actions.push(`<button class="btn btn-outline" onclick="openSOForm('${id}');closeModal('so-action-modal')">Edit</button>`);

  body += `<div style="display:flex;gap:8px;flex-wrap:wrap">${actions.join('')}</div>`;

  document.getElementById('so-action-title').textContent = `${so.so_no} — ${so.customers?.company_name || ''}`;
  document.getElementById('so-action-body').innerHTML = body;
  document.getElementById('so-action-confirm').style.display = 'none';
  document.getElementById('so-action-modal').classList.remove('hidden');
}

async function advanceSOStatus(id, status) {
  const res = await fetch(`/api/sales-orders/${id}`, {
    method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ status })
  });
  if (!res.ok) { const e = await res.json(); alert(e.error || 'Failed'); return; }
  closeModal('so-action-modal');
  loadSalesOrders();
  loadTaskQueue();
}

async function createJobOrder(id) {
  const res = await fetch(`/api/sales-orders/${id}/create-job-order`, { method: 'POST', headers: authHeaders() });
  if (!res.ok) { const e = await res.json(); alert(e.error || 'Failed'); return; }
  alert('Job Order created!');
  closeModal('so-action-modal');
  loadSalesOrders();
}

function openDepositModal(id) {
  closeModal('so-action-modal');
  pendingSOId = id;
  pendingSOAction = 'deposit';
  const so = allSOs.find(x => x.id === id);
  document.getElementById('so-action-title').textContent = 'Record Deposit';
  document.getElementById('so-action-body').innerHTML = `
    <p style="margin-bottom:12px;color:var(--gray-600)">
      ${so?.so_no} — Deposit: RM ${Number(so?.deposit_amount || 0).toLocaleString('en-MY', { minimumFractionDigits: 2 })}
    </p>
    <div class="form-group">
      <label class="form-label">Amount Received (RM)</label>
      <input type="number" id="deposit-amount" class="form-input" value="${so?.deposit_amount || ''}" step="0.01" min="0">
    </div>
    <div class="form-group">
      <label class="form-label">Note</label>
      <input type="text" id="deposit-note" class="form-input" placeholder="e.g. Bank transfer">
    </div>`;
  document.getElementById('so-action-confirm').style.display = '';
  document.getElementById('so-action-modal').classList.remove('hidden');
}

async function confirmSOAction() {
  if (pendingSOAction === 'deposit') {
    const amount = parseFloat(document.getElementById('deposit-amount').value);
    const note = document.getElementById('deposit-note').value;
    if (!amount || amount <= 0) { alert('Enter a valid amount'); return; }
    const res = await fetch(`/api/sales-orders/${pendingSOId}/deposit`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ amount, note })
    });
    if (!res.ok) { const e = await res.json(); alert(e.error || 'Failed'); return; }
    closeModal('so-action-modal');
    loadSalesOrders();
    loadTaskQueue();
  }
}

// ─────────────────────────────────────────────
// INVOICES
// ─────────────────────────────────────────────
async function loadInvoices() {
  document.getElementById('inv-table-wrap').innerHTML = '<div class="loading"><div class="spinner"></div> Loading…</div>';
  const entity = typeof getEntity === 'function' ? getEntity() : 'AOSB';
  const params = new URLSearchParams({ entity });
  if (currentInvFilter) params.set('status', currentInvFilter);
  const res = await fetch(`/api/invoices?${params}`, { headers: authHeaders() });
  if (res.status === 401) { localStorage.clear(); window.location.href = '/login'; return; }
  allInvoices = await res.json();
  renderInvoices(allInvoices);
}

function renderInvoices(list) {
  if (!list.length) {
    document.getElementById('inv-table-wrap').innerHTML = '<div class="empty-state">No invoices found</div>';
    return;
  }
  const invColor = { draft: 'gray', sent: 'blue', partial: 'yellow', overdue: 'red', paid: 'green' };
  const lhdnBadge = inv => {
    if (inv.lhdn_status === 'valid') return '<span class="status-pill pill-green" title="LHDN Validated">✓ LHDN</span>';
    if (inv.lhdn_status === 'invalid') return '<span class="status-pill pill-red">✗ LHDN</span>';
    if (inv.lhdn_status === 'cancelled') return '<span class="status-pill pill-gray">Cancelled</span>';
    if (inv.sql_synced_at) return '<span class="status-pill pill-yellow" title="Synced to SQL Account">Synced</span>';
    return '';
  };
  document.getElementById('inv-table-wrap').innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>Invoice No</th><th>Entity</th><th>Customer</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Due</th><th>Status</th><th>LHDN</th><th>Actions</th>
      </tr></thead>
      <tbody>${list.map(inv => {
        const balance = (inv.amount || 0) - (inv.amount_paid || 0);
        return `
          <tr>
            <td><strong>${inv.invoice_no}</strong></td>
            <td><span style="font-size:11px;padding:2px 6px;border-radius:4px;background:var(--indigo-light,#e0e7ff);color:var(--indigo)">${inv.entity || 'AOSB'}</span></td>
            <td>${inv.customers?.company_name || '—'}</td>
            <td>RM ${Number(inv.amount || 0).toLocaleString('en-MY', { minimumFractionDigits: 2 })}</td>
            <td>RM ${Number(inv.amount_paid || 0).toLocaleString('en-MY', { minimumFractionDigits: 2 })}</td>
            <td style="${balance > 0 ? 'color:var(--red);font-weight:600' : ''}">
              RM ${Number(balance).toLocaleString('en-MY', { minimumFractionDigits: 2 })}
            </td>
            <td>${inv.due_date ? fmtDate(inv.due_date) : '—'}</td>
            <td><span class="status-pill pill-${invColor[inv.status] || 'gray'}">${capitalize(inv.status)}</span></td>
            <td>
              ${lhdnBadge(inv)}
              ${inv.sql_synced_at && !inv.lhdn_uuid ? `<button class="btn btn-outline btn-sm" style="font-size:11px;padding:2px 6px;margin-top:2px" onclick="openLHDNModal('${inv.id}')">Enter LHDN</button>` : ''}
            </td>
            <td style="white-space:nowrap">
              <a href="/api/invoice-pdf/${inv.id}" target="_blank" class="btn btn-outline btn-sm" title="View PDF">PDF</a>
              ${inv.status !== 'paid' ? `<button class="btn btn-success btn-sm" onclick="openPaymentModal('${inv.id}')">Pay</button>` : ''}
              <button class="btn btn-outline btn-sm" onclick="openInvoiceForm('${inv.id}')">Edit</button>
            </td>
          </tr>`;
      }).join('')}
      </tbody>
    </table>`;
}

document.querySelectorAll('.inv-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.inv-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentInvFilter = btn.dataset.status;
    loadInvoices();
  });
});

function openInvoiceForm(id) {
  invLineItems = [{ description: '', qty: 1, unit_price: 0, tax_code: 'NA' }];
  document.getElementById('inv-id').value = '';
  document.getElementById('inv-entity').value = typeof getEntity === 'function' ? getEntity() : 'AOSB';
  document.getElementById('inv-notes').value = '';
  document.getElementById('inv-payment-term').value = 'net30';
  document.getElementById('inv-status').value = 'draft';
  document.getElementById('inv-subtotal').value = '0.00';
  document.getElementById('inv-tax-amount').value = '0.00';
  document.getElementById('inv-total').value = '0.00';
  document.getElementById('invoice-modal-title').textContent = id ? 'Edit Invoice' : 'New Invoice';

  const d = new Date(); d.setDate(d.getDate() + 30);
  document.getElementById('inv-due-date').value = d.toISOString().split('T')[0];

  populateCustomerSelectSales('inv-customer');
  populateSOSelect();

  if (id) {
    const inv = allInvoices.find(x => x.id === id);
    if (inv) {
      document.getElementById('inv-id').value = inv.id;
      document.getElementById('inv-customer').value = inv.customer_id || '';
      document.getElementById('inv-so').value = inv.sales_order_id || '';
      document.getElementById('inv-entity').value = inv.entity || 'AOSB';
      document.getElementById('inv-payment-term').value = inv.payment_term || 'net30';
      document.getElementById('inv-due-date').value = inv.due_date || '';
      document.getElementById('inv-status').value = inv.status || 'draft';
      document.getElementById('inv-notes').value = inv.notes || '';
      invLineItems = inv.line_items && inv.line_items.length
        ? inv.line_items
        : [{ description: inv.notes || '', qty: 1, unit_price: inv.amount || 0, tax_code: inv.tax_code || 'NA' }];
    }
  }
  renderInvItems();
  calcInvTotals();
  document.getElementById('invoice-modal').classList.remove('hidden');
}

function renderInvItems() {
  const taxRateMap = { NA: 0, SR6: 0.06, SR8: 0.08 };
  document.getElementById('inv-items-list').innerHTML = invLineItems.map((item, i) => {
    const lineTotal = (item.qty || 1) * (item.unit_price || 0) * (1 + (taxRateMap[item.tax_code || 'NA'] || 0));
    return `
      <div style="display:grid;grid-template-columns:2fr 55px 95px 80px 80px 28px;gap:6px;margin-bottom:6px;align-items:center">
        <input type="text" class="form-input" placeholder="Description" value="${(item.description || '').replace(/"/g,'&quot;')}"
          oninput="invLineItems[${i}].description=this.value">
        <input type="number" class="form-input" placeholder="Qty" value="${item.qty || 1}" min="1"
          oninput="invLineItems[${i}].qty=parseInt(this.value)||1;calcInvTotals()">
        <input type="number" class="form-input" placeholder="Unit price" value="${item.unit_price || ''}" step="0.01" min="0"
          oninput="invLineItems[${i}].unit_price=parseFloat(this.value)||0;calcInvTotals()">
        <select class="form-input" onchange="invLineItems[${i}].tax_code=this.value;calcInvTotals()">
          <option value="NA" ${(item.tax_code||'NA')==='NA'?'selected':''}>NA (0%)</option>
          <option value="SR6" ${item.tax_code==='SR6'?'selected':''}>SR6 (6%)</option>
          <option value="SR8" ${item.tax_code==='SR8'?'selected':''}>SR8 (8%)</option>
        </select>
        <span style="font-size:12px;text-align:right;padding-right:4px;color:var(--text-secondary)">
          ${lineTotal.toFixed(2)}
        </span>
        <button class="btn btn-danger btn-sm" onclick="removeInvItem(${i})" style="padding:3px 6px">✕</button>
      </div>`;
  }).join('');
}

function addInvItem() {
  invLineItems.push({ description: '', qty: 1, unit_price: 0, tax_code: 'NA' });
  renderInvItems();
  calcInvTotals();
}

function removeInvItem(i) {
  invLineItems.splice(i, 1);
  if (!invLineItems.length) invLineItems.push({ description: '', qty: 1, unit_price: 0, tax_code: 'NA' });
  renderInvItems();
  calcInvTotals();
}

function calcInvTotals() {
  const taxRateMap = { NA: 0, SR6: 0.06, SR8: 0.08 };
  let subtotal = 0, taxTotal = 0;
  invLineItems.forEach((item, i) => {
    const lineAmt = (item.qty || 1) * (item.unit_price || 0);
    const rate = taxRateMap[item.tax_code || 'NA'] || 0;
    const taxAmt = lineAmt * rate;
    item.tax_amount = Math.round(taxAmt * 100) / 100;
    item.line_total = Math.round((lineAmt + taxAmt) * 100) / 100;
    subtotal += lineAmt;
    taxTotal += taxAmt;
    // Update line total span in-place (5th cell of each row)
    const rows = document.getElementById('inv-items-list').children;
    if (rows[i]) {
      const spans = rows[i].querySelectorAll('span');
      if (spans[0]) spans[0].textContent = item.line_total.toFixed(2);
    }
  });
  document.getElementById('inv-subtotal').value = subtotal.toFixed(2);
  document.getElementById('inv-tax-amount').value = taxTotal.toFixed(2);
  document.getElementById('inv-total').value = (subtotal + taxTotal).toFixed(2);
}

function openInvoiceFormForSO(soId) {
  closeModal('so-action-modal');
  const so = allSOs.find(x => x.id === soId);
  openInvoiceForm(null);
  setTimeout(() => {
    if (so) {
      document.getElementById('inv-customer').value = so.customer_id || '';
      document.getElementById('inv-so').value = so.id;
      // Pre-fill a single line item from SO
      if (so.items && so.items.length) {
        invLineItems = so.items.map(i => ({
          description: i.product || '',
          qty: i.qty || 1,
          unit_price: i.unit_price || 0,
          tax_code: 'NA'
        }));
      } else {
        invLineItems = [{ description: so.so_no || 'Services', qty: 1, unit_price: so.total_amount || 0, tax_code: 'NA' }];
      }
      renderInvItems();
      calcInvTotals();
    }
  }, 50);
}

// ── SQL Account Export ──
function exportToSQL() {
  const params = new URLSearchParams();
  const fromDate = document.getElementById('sql-from-date')?.value;
  const toDate = document.getElementById('sql-to-date')?.value;
  const unsyncedOnly = document.getElementById('sql-unsynced-only')?.checked;
  if (fromDate) params.set('from_date', fromDate);
  if (toDate) params.set('to_date', toDate);
  if (unsyncedOnly) params.set('unsynced_only', 'true');
  window.open(`/api/bridge/sql-account/export?${params}`, '_blank');
}

// ── LHDN Result ──
function openLHDNModal(invId) {
  document.getElementById('lhdn-inv-id').value = invId;
  document.getElementById('lhdn-uuid').value = '';
  document.getElementById('lhdn-qr-url').value = '';
  document.getElementById('lhdn-status').value = 'valid';
  document.getElementById('lhdn-modal').classList.remove('hidden');
}

async function saveLHDNResult() {
  const invId = document.getElementById('lhdn-inv-id').value;
  const lhdn_uuid = document.getElementById('lhdn-uuid').value.trim();
  if (!lhdn_uuid) { alert('UUID is required'); return; }
  const body = {
    lhdn_uuid,
    lhdn_qr_url: document.getElementById('lhdn-qr-url').value.trim() || null,
    lhdn_status: document.getElementById('lhdn-status').value,
  };
  const res = await fetch(`/api/bridge/invoices/${invId}/lhdn`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(body)
  });
  if (!res.ok) { const e = await res.json(); alert(e.error || 'Failed'); return; }
  closeModal('lhdn-modal');
  loadInvoices();
}

async function saveInvoice() {
  const id = document.getElementById('inv-id').value;
  const customer_id = document.getElementById('inv-customer').value;
  if (!customer_id) { alert('Please select a customer'); return; }
  const subtotal = parseFloat(document.getElementById('inv-subtotal').value) || 0;
  const tax_amount = parseFloat(document.getElementById('inv-tax-amount').value) || 0;
  const total = parseFloat(document.getElementById('inv-total').value) || 0;
  if (!total) { alert('Please add at least one line item with a price'); return; }
  const validItems = invLineItems.filter(i => i.description || i.unit_price > 0);
  const body = {
    customer_id,
    sales_order_id: document.getElementById('inv-so').value || null,
    entity: document.getElementById('inv-entity').value || 'AOSB',
    amount: total,
    subtotal,
    tax_amount,
    tax_rate: 0,
    tax_code: 'NA',
    line_items: validItems,
    payment_term: document.getElementById('inv-payment-term').value,
    due_date: document.getElementById('inv-due-date').value || null,
    status: document.getElementById('inv-status').value,
    notes: document.getElementById('inv-notes').value,
  };
  const url = id ? `/api/invoices/${id}` : '/api/invoices';
  const method = id ? 'PATCH' : 'POST';
  const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
  if (!res.ok) { const e = await res.json(); alert(e.error || 'Failed to save'); return; }
  closeModal('invoice-modal');
  loadInvoices();
}

function openPaymentModal(invId) {
  const inv = allInvoices.find(x => x.id === invId);
  document.getElementById('pay-inv-id').value = invId;
  const balance = (inv?.amount || 0) - (inv?.amount_paid || 0);
  document.getElementById('pay-summary').textContent = `${inv?.invoice_no} — Balance: RM ${Number(balance).toLocaleString('en-MY', { minimumFractionDigits: 2 })}`;
  document.getElementById('pay-amount').value = balance.toFixed(2);
  document.getElementById('pay-note').value = '';
  document.getElementById('payment-modal').classList.remove('hidden');
}

async function confirmPayment() {
  const invId = document.getElementById('pay-inv-id').value;
  const amount = parseFloat(document.getElementById('pay-amount').value);
  const note = document.getElementById('pay-note').value;
  if (!amount || amount <= 0) { alert('Enter a valid amount'); return; }
  const res = await fetch(`/api/invoices/${invId}/payment`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ amount, note })
  });
  if (!res.ok) { const e = await res.json(); alert(e.error || 'Failed'); return; }
  closeModal('payment-modal');
  loadInvoices();
  loadTaskQueue();
}

// ── Helpers ──
function populateCustomerSelectSales(elId) {
  const sel = document.getElementById(elId);
  const current = sel.value;
  sel.innerHTML = '<option value="">— Select customer —</option>' +
    allCustomers.map(c => `<option value="${c.id}">${c.company_name}</option>`).join('');
  if (current) sel.value = current;
}

function populateSOSelect() {
  const sel = document.getElementById('inv-so');
  const current = sel.value;
  const billable = allSOs.filter(so => ['delivered', 'in_production', 'ready'].includes(so.status));
  sel.innerHTML = '<option value="">— None —</option>' +
    billable.map(so => `<option value="${so.id}">${so.so_no} — ${so.customers?.company_name || ''}</option>`).join('');
  if (current) sel.value = current;
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : ''; }
function fmtDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' }); }
function fmtPaymentTerm(t) { return { cash: 'Cash', '50_50': '50/50 Deposit', net30: 'Net 30' }[t] || t || '—'; }

// ── Init ──
async function init() {
  const entity = typeof getEntity === 'function' ? getEntity() : 'AOSB';
  const [cr, sor] = await Promise.all([
    fetch('/api/customers', { headers: authHeaders() }),
    fetch(`/api/sales-orders?entity=${entity}`, { headers: authHeaders() })
  ]);
  if (cr.status === 401) { localStorage.clear(); window.location.href = '/login'; return; }
  allCustomers = await cr.json();
  allSOs = await sor.json();
  loadTaskQueue();
}

// Reload data when company is switched
window.addEventListener('entitychange', () => {
  loadSalesOrders();
  loadInvoices();
  loadTaskQueue();
});

// ── Portal Payments (under Sales Orders) ──────────────────────────────────
let _spFilter = '';

document.querySelectorAll('.sp-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sp-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _spFilter = btn.dataset.st;
    loadPortalPaymentsSales();
  });
});

function fmtDate2(d) { return d ? new Date(d).toLocaleDateString('en-MY', { day:'2-digit', month:'short', year:'numeric' }) : '—'; }
function fmtMoney2(n) { return 'RM ' + parseFloat(n||0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

async function loadPortalPaymentsSales() {
  const wrap = document.getElementById('portal-payments-sales-wrap');
  wrap.innerHTML = '<div class="loading"><div class="spinner"></div> Loading…</div>';
  try {
    const url = '/api/customer-portal/admin/payments' + (_spFilter ? `?status=${_spFilter}` : '');
    const res = await fetch(url, { headers: authHeaders() });
    if (res.status === 401) { localStorage.clear(); window.location.href = '/login'; return; }
    const data = await res.json();
    if (!data.length) { wrap.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted)">No payment submissions yet.</div>'; return; }
    wrap.innerHTML = `<table>
      <thead><tr><th>Date</th><th>Customer</th><th>SO</th><th>Method</th><th>Amount</th><th>Bank Ref</th><th>Status</th><th>Slip</th><th>Actions</th></tr></thead>
      <tbody>${data.map(p => `<tr>
        <td style="font-size:12px">${fmtDate2(p.created_at)}</td>
        <td><strong>${p.customer_name || '—'}</strong></td>
        <td>${p.so_no || '—'}</td>
        <td>${p.method === 'bank_transfer' ? '🏦 Bank' : '💳 Credit'}</td>
        <td><strong>${fmtMoney2(p.amount)}</strong></td>
        <td style="font-size:12px">${p.bank_ref || '—'}</td>
        <td><span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;
          background:${p.status==='verified'?'#dcfce7':p.status==='rejected'?'#fee2e2':'#fef3c7'};
          color:${p.status==='verified'?'#14532d':p.status==='rejected'?'#7f1d1d':'#92400e'}">${p.status}</span></td>
        <td>${p.slip_url ? `<a href="${p.slip_url}" target="_blank" class="btn btn-outline btn-sm">View</a>` : '—'}</td>
        <td style="white-space:nowrap">
          ${p.status === 'pending' ? `
            <button class="btn btn-outline btn-sm" style="color:#16a34a" onclick="reviewPortalPayment('${p.id}','verified')">✓ Verify</button>
            <button class="btn btn-outline btn-sm" style="color:#dc2626;margin-left:4px" onclick="reviewPortalPayment('${p.id}','rejected')">✕ Reject</button>
          ` : p.status === 'verified' ? '<span style="color:#16a34a">✓ Verified</span>' : '<span style="color:#dc2626">✗ Rejected</span>'}
        </td>
      </tr>`).join('')}</tbody>
    </table>`;
  } catch(e) {
    wrap.innerHTML = `<div style="padding:20px;color:#dc2626">${e.message}</div>`;
  }
}

async function reviewPortalPayment(id, status) {
  if (!confirm(`${status === 'verified' ? 'Verify' : 'Reject'} this payment?`)) return;
  try {
    const res = await fetch(`/api/customer-portal/admin/payments/${id}`, {
      method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ status })
    });
    if (res.ok) loadPortalPaymentsSales();
    else { const d = await res.json(); alert(d.error || 'Action failed'); }
  } catch(e) { alert(e.message); }
}

init();
