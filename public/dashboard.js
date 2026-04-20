// ── Auth guard ──
const token = localStorage.getItem('ao_token');
const role = localStorage.getItem('ao_role');
if (!token) { window.location.href = '/login'; }
if (!['admin', 'super_admin'].includes(role)) { window.location.href = '/worker'; }

const displayName = localStorage.getItem('ao_display_name') || localStorage.getItem('ao_username') || '';
document.getElementById('header-user').textContent = displayName;
document.getElementById('logout-btn').addEventListener('click', () => {
  localStorage.clear(); window.location.href = '/login';
});

function authHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
}

// ── Tab navigation ──
let allOrders = [], allUsers = [], currentStatusFilter = 'all', trendChart = null;
let editingUserId = null, currentDays = 7;
const userRole = localStorage.getItem('ao_role') || 'worker';

const PERIOD_LABELS = { 7: '7-Day', 30: '30-Day', 90: 'Quarterly', 365: 'Annual' };
document.querySelectorAll('.period-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentDays = parseInt(btn.dataset.days);
    document.getElementById('trend-title').textContent = `${PERIOD_LABELS[currentDays]} Production Trend`;
    document.getElementById('oee-title').textContent = `${PERIOD_LABELS[currentDays]} OEE Overview`;
    loadDashboard();
  });
});

document.querySelectorAll('.tab-nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
    if (btn.dataset.tab === 'orders') { loadOrders(); if (userRole === 'super_admin') loadDeleteRequests(); }
    if (btn.dataset.tab === 'users') loadUsers();
    if (btn.dataset.tab === 'report') loadReportHistory();
  });
});

// ── Dashboard KPIs ──
async function loadDashboard() {
  try {
    const res = await fetch(`/api/dashboard?days=${currentDays}`, { headers: authHeaders() });
    if (res.status === 401) { window.location.href = '/login'; return; }
    const d = await res.json();

    document.getElementById('kpi-capacity').textContent = d.capacity_rate !== null ? d.capacity_rate + '%' : 'N/A';
    document.getElementById('kpi-capacity-sub').textContent = `Actual ${d.capacity_detail.actual} / Target ${d.capacity_detail.target} units`;
    document.getElementById('kpi-otd').textContent = d.otd_percent !== null ? d.otd_percent + '%' : 'N/A';
    document.getElementById('kpi-otd-sub').textContent = `${d.otd_detail.on_time} / ${d.otd_detail.total_due} orders on time`;
    document.getElementById('kpi-active').textContent = d.active_orders;
    document.getElementById('kpi-shipment').textContent = d.weekly_shipment_orders + ' orders';
    document.getElementById('kpi-shipment-sub').textContent = `Total ${d.weekly_shipment_qty} units`;
    document.getElementById('last-updated').textContent = 'Updated: ' + new Date().toLocaleTimeString();

    renderTrend(d.trend);
    renderOeeMini(d.oee);
    renderOeeTable(d.oee);
  } catch (e) { console.error('Dashboard error:', e); }
}

function renderTrend(trend) {
  const ctx = document.getElementById('trend-chart').getContext('2d');
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: trend.map(t => t.date.slice(5)),
      datasets: [{ label: 'Units Completed', data: trend.map(t => t.qty), borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.08)', borderWidth: 2, pointBackgroundColor: '#2563eb', tension: 0.3, fill: true }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: '#f0f0f0' } }, x: { grid: { display: false } } } }
  });
}

function oeeColor(val) {
  if (val === null) return 'var(--gray-200)';
  if (val >= 65) return 'var(--green)';
  if (val >= 40) return 'var(--yellow)';
  return 'var(--red)';
}

function renderOeeMini(oee) {
  document.getElementById('oee-mini').innerHTML = (oee || []).map(s => `
    <div class="oee-mini-card">
      <div class="oee-mini-ws">${s.workstation}</div>
      <div class="oee-mini-val" style="color:${oeeColor(s.oee)}">${s.oee !== null ? s.oee + '%' : '—'}</div>
      <div class="oee-mini-label">OEE</div>
    </div>`).join('');
}

function renderOeeTable(oee) {
  if (!oee) return;
  document.getElementById('oee-tbody').innerHTML = oee.map(s => {
    const fmt = v => v !== null ? v + '%' : '—';
    const color = oeeColor(s.oee);
    return `<tr>
      <td><strong>${s.workstation}</strong></td>
      <td><span class="oee-badge" style="background:${color}20;color:${color}">${fmt(s.oee)}</span></td>
      <td>${fmt(s.availability)}</td>
      <td>${fmt(s.performance)}</td>
      <td>${fmt(s.quality)}</td>
      <td>${s.total !== undefined ? `${s.completed || 0} / ${s.total}` : '—'}</td>
      <td>${s.actual_qty !== undefined ? `${s.actual_qty} / ${s.target_qty}` : '—'}</td>
      <td>${s.rework_qty !== undefined ? s.rework_qty : '—'}</td>
    </tr>`;
  }).join('');
}

// ── Orders ──
async function loadOrders() {
  document.getElementById('orders-tbody').innerHTML = '<tr><td colspan="9" class="loading">Loading...</td></tr>';
  try {
    const includeHidden = currentStatusFilter === 'hidden';
    const res = await fetch(`/api/orders${includeHidden ? '?include_hidden=true' : ''}`, { headers: authHeaders() });
    allOrders = await res.json();
    const hiddenBtn = document.getElementById('filter-hidden-btn');
    if (hiddenBtn) hiddenBtn.style.display = ['admin', 'super_admin'].includes(userRole) ? '' : 'none';
    renderOrders();
  } catch (e) { document.getElementById('orders-tbody').innerHTML = `<tr><td colspan="9" class="error">Failed: ${e.message}</td></tr>`; }
}

async function loadDeleteRequests() {
  try {
    const res = await fetch('/api/orders/delete-requests', { headers: authHeaders() });
    if (!res.ok) return;
    const requests = await res.json();
    const badge = document.getElementById('delete-req-badge');
    const panel = document.getElementById('delete-requests-panel');
    if (!requests.length) { badge.classList.add('hidden'); panel.classList.add('hidden'); return; }
    badge.textContent = `${requests.length} delete request${requests.length > 1 ? 's' : ''}`;
    badge.classList.remove('hidden');
    panel.classList.remove('hidden');
    panel.innerHTML = `<div class="delete-req-title">⚠ Pending Delete Requests</div>` +
      requests.map(o => `
        <div class="delete-req-row">
          <span><strong>${o.order_no}</strong> — ${o.customer} — ${o.product}</span>
          <div style="display:flex;gap:6px">
            <button class="btn btn-sm btn-danger" onclick="approveDelete('${o.id}','${o.order_no}')">Approve Delete</button>
            <button class="btn btn-sm btn-outline" onclick="rejectDelete('${o.id}')">Reject</button>
          </div>
        </div>`).join('');
  } catch {}
}

function renderOrders() {
  const filtered = currentStatusFilter === 'all'
    ? allOrders.filter(o => !o.hidden)
    : currentStatusFilter === 'hidden'
    ? allOrders.filter(o => o.hidden)
    : allOrders.filter(o => o.status === currentStatusFilter && !o.hidden);
  if (!filtered.length) { document.getElementById('orders-tbody').innerHTML = '<tr><td colspan="9" class="empty-state">No orders</td></tr>'; return; }

  const STATIONS = ['Cut', 'Edge', 'Boring', 'Cut-Curve', 'Edge-Curve', 'Assembly', 'Packing'];
  const statusLabel = { pending: 'Pending', in_progress: 'In Progress', ready: 'Ready', pickup_delivery: 'Pickup / Delivery', done: 'Done', cancelled: 'Cancelled' };
  const nextStatus = { ready: 'pickup_delivery', pickup_delivery: 'done' };
  const nextLabel  = { ready: 'Dispatch', pickup_delivery: 'Mark Done' };

  document.getElementById('orders-tbody').innerHTML = filtered.map(o => {
    const isDone = ['done','cancelled'].includes(o.status);
    const isOverdue = o.due_date && new Date(o.due_date) < new Date() && !isDone;
    const wos = o.work_orders || [];
    const activeWs = o.workstations || STATIONS;
    const progress = STATIONS.map(ws => {
      if (!activeWs.includes(ws)) return `<span class="ws-dot ws-none ws-skip" title="${ws}: not required">—</span>`;
      const wo = wos.find(w => w.workstation === ws);
      const cls = wo ? wo.status : 'none';
      return `<span class="ws-dot ws-${cls}" title="${ws}: ${wo ? wo.status : 'not created'}">${ws[0]}</span>`;
    }).join('');

    const items = o.items || [];
    const productCell = items.length > 1
      ? `<span title="${items.map(i => `${i.product} ×${i.quantity}`).join('\n')}">${items[0].product} <span class="item-count">+${items.length - 1}</span></span>`
      : o.product || '—';

    const attachments = o.attachments || [];
    const attachJson = encodeURIComponent(JSON.stringify(attachments));
    const badge = attachments.length
      ? `<span class="attach-badge" onclick="showAttachments('${attachJson}')" style="cursor:pointer" title="Click to view files">📎 ${attachments.length}</span>`
      : '';
    const filesCell = `${badge}<button class="btn btn-sm btn-outline upload-btn" title="Upload files" onclick="uploadFilesToOrder('${o.id}')">+</button>`;

    const urgentBadge = o.urgent ? `<span class="urgent-badge">URGENT</span>` : '';
    const deleteReqBadge = o.delete_requested ? `<span class="del-req-badge">Del. Requested</span>` : '';

    // Action buttons
    let actions = '';
    if (!isDone && nextStatus[o.status]) {
      actions += `<button class="btn btn-sm btn-primary" onclick="advanceStatus('${o.id}','${nextStatus[o.status]}')">${nextLabel[o.status]}</button>`;
    }
    if (!isDone) {
      actions += ` <button class="btn btn-sm ${o.urgent ? 'btn-warning' : 'btn-outline'}" onclick="toggleUrgent('${o.id}')" title="Toggle urgent">${o.urgent ? '🔴' : '⚑'}</button>`;
    }
    if (o.status === 'done' && !o.hidden) {
      actions += ` <button class="btn btn-sm btn-outline" onclick="hideOrder('${o.id}')">Hide</button>`;
    }
    if (o.hidden) {
      actions += ` <button class="btn btn-sm btn-outline" onclick="unhideOrder('${o.id}')">Unhide</button>`;
    }
    if (userRole === 'super_admin') {
      actions += ` <button class="btn btn-sm btn-danger" onclick="superAdminDelete('${o.id}','${o.order_no}')">Delete</button>`;
    } else if (!o.delete_requested) {
      actions += ` <button class="btn btn-sm btn-outline" style="color:var(--red);border-color:var(--red)" onclick="requestDelete('${o.id}','${o.order_no}')">Request Delete</button>`;
    }

    return `<tr class="${isOverdue ? 'row-overdue' : ''}${o.urgent ? ' row-urgent' : ''}${o.hidden ? ' row-hidden' : ''}">
      <td><strong>${o.order_no}</strong>${urgentBadge}${deleteReqBadge}</td>
      <td>${o.customer}</td>
      <td>${productCell}</td>
      <td>${o.quantity}</td>
      <td class="${isOverdue ? 'overdue' : ''}">${o.due_date}${isOverdue ? ' ⚠️' : ''}</td>
      <td><span class="status-badge status-${o.status}">${statusLabel[o.status] || o.status}</span></td>
      <td><div class="ws-progress">${progress}</div></td>
      <td>${filesCell}</td>
      <td style="white-space:nowrap">${actions}</td>
    </tr>`;
  }).join('');
}

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); currentStatusFilter = btn.dataset.status; loadOrders();
  });
});

function showAttachments(attachJson) {
  const attachments = JSON.parse(decodeURIComponent(attachJson));
  const list = attachments.map(a =>
    a.url
      ? `<li><a href="${a.url}" target="_blank" rel="noopener">${a.name}</a> <span style="color:var(--gray-400);font-size:11px">(${(a.size/1024).toFixed(1)} KB)</span></li>`
      : `<li>${a.name} <span style="color:var(--gray-400);font-size:11px">(no preview)</span></li>`
  ).join('');
  document.getElementById('attach-modal-list').innerHTML = `<ul style="padding-left:18px;line-height:2">${list}</ul>`;
  document.getElementById('attach-modal').classList.remove('hidden');
}

function uploadFilesToOrder(orderId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = '.pdf,.jpg,.jpeg,.png,.gif,.dwg,.dxf,.doc,.docx,.xls,.xlsx';
  input.onchange = async () => {
    if (!input.files.length) return;
    const fd = new FormData();
    for (const f of input.files) fd.append('files', f);
    const res = await fetch(`/api/orders/${orderId}/attachments`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('ao_token')}` }, body: fd });
    if (!res.ok) { const err = await res.json().catch(() => ({})); alert('Upload failed: ' + (err.error || res.status)); return; }
    loadOrders();
  };
  input.click();
}

async function advanceStatus(id, newStatus) {
  const labels = { in_progress: 'Start Production', ready: 'Mark as Ready', pickup_delivery: 'Mark as Dispatched', done: 'Mark as Done' };
  if (!confirm(`${labels[newStatus] || newStatus}?`)) return;
  await fetch(`/api/orders/${id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ status: newStatus }) });
  loadOrders(); loadDashboard();
}

async function toggleUrgent(id) {
  await fetch(`/api/orders/${id}/urgent`, { method: 'POST', headers: authHeaders() });
  loadOrders();
}

async function hideOrder(id) {
  if (!confirm('Hide this order? It will no longer appear on the main view.')) return;
  await fetch(`/api/orders/${id}/hide`, { method: 'POST', headers: authHeaders() });
  loadOrders();
}

async function unhideOrder(id) {
  await fetch(`/api/orders/${id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ hidden: false }) });
  loadOrders();
}

async function requestDelete(id, orderNo) {
  if (!confirm(`Request deletion of ${orderNo}? This will send a request to the Boss for approval.`)) return;
  await fetch(`/api/orders/${id}/request-delete`, { method: 'POST', headers: authHeaders() });
  loadOrders();
}

async function approveDelete(id, orderNo) {
  if (!confirm(`Permanently delete ${orderNo}? This cannot be undone.`)) return;
  await fetch(`/api/orders/${id}`, { method: 'DELETE', headers: authHeaders() });
  loadOrders(); loadDashboard(); loadDeleteRequests();
}

async function rejectDelete(id) {
  await fetch(`/api/orders/${id}/reject-delete`, { method: 'POST', headers: authHeaders() });
  loadOrders(); loadDeleteRequests();
}

async function superAdminDelete(id, orderNo) {
  if (!confirm(`[Boss] Permanently delete ${orderNo}? This cannot be undone.`)) return;
  await fetch(`/api/orders/${id}`, { method: 'DELETE', headers: authHeaders() });
  loadOrders(); loadDashboard(); loadDeleteRequests();
}

// ── Order modal helpers ──
function addItemRow(product = '', quantity = '') {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = `
    <input type="text" class="item-product" placeholder="Product description" value="${product}">
    <input type="number" class="item-qty" placeholder="Qty" min="1" value="${quantity}" style="width:90px">
    <button type="button" class="btn btn-sm btn-danger item-remove" onclick="this.closest('.item-row').remove()">✕</button>`;
  document.getElementById('items-list').appendChild(row);
}

function resetOrderModal() {
  document.getElementById('f-order-no').value = '';
  document.getElementById('f-customer').value = '';
  document.getElementById('f-due').value = '';
  document.getElementById('items-list').innerHTML = '';
  document.getElementById('file-preview').innerHTML = '';
  document.getElementById('f-files').value = '';
  document.querySelectorAll('#ws-checkboxes input[type=checkbox]').forEach(cb => cb.checked = true);
  addItemRow();
}

document.getElementById('add-order-btn').addEventListener('click', () => {
  resetOrderModal();
  document.getElementById('order-modal').classList.remove('hidden');
});

document.getElementById('cancel-order-btn').addEventListener('click', () => document.getElementById('order-modal').classList.add('hidden'));

document.getElementById('add-item-btn').addEventListener('click', () => addItemRow());

document.getElementById('f-files').addEventListener('change', () => {
  const files = Array.from(document.getElementById('f-files').files);
  document.getElementById('file-preview').innerHTML = files.length
    ? files.map(f => `<span class="file-chip">📎 ${f.name} <small>(${(f.size/1024).toFixed(0)} KB)</small></span>`).join('')
    : '';
});

document.getElementById('save-order-btn').addEventListener('click', async () => {
  const order_no = document.getElementById('f-order-no').value.trim();
  const customer = document.getElementById('f-customer').value.trim();
  const due_date = document.getElementById('f-due').value;

  const items = Array.from(document.querySelectorAll('.item-row')).map(row => ({
    product: row.querySelector('.item-product').value.trim(),
    quantity: parseInt(row.querySelector('.item-qty').value) || 0
  })).filter(i => i.product && i.quantity > 0);

  const workstations = Array.from(document.querySelectorAll('#ws-checkboxes input:checked')).map(cb => cb.value);

  if (!order_no || !customer || !due_date) { alert('Please fill in Order #, Customer, and Due Date'); return; }
  if (!items.length) { alert('Please add at least one product with quantity'); return; }
  if (!workstations.length) { alert('Please select at least one workstation'); return; }

  const btn = document.getElementById('save-order-btn');
  btn.disabled = true; btn.textContent = 'Creating...';
  try {
    const res = await fetch('/api/orders', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ order_no, customer, due_date, items, workstations })
    });
    if (!res.ok) { const err = await res.json(); alert('Error: ' + err.error); return; }
    const order = await res.json();

    // Upload attachments if any
    const files = document.getElementById('f-files').files;
    if (files.length) {
      const fd = new FormData();
      Array.from(files).forEach(f => fd.append('files', f));
      await fetch(`/api/orders/${order.id}/attachments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
    }

    document.getElementById('order-modal').classList.add('hidden');
    loadOrders(); loadDashboard();
  } finally { btn.disabled = false; btn.textContent = 'Create Order'; }
});

// ── AI Report ──
document.getElementById('gen-report-btn').addEventListener('click', async () => {
  const btn = document.getElementById('gen-report-btn');
  btn.disabled = true; btn.textContent = 'Generating...';
  document.getElementById('report-content').innerHTML = '<div class="loading">AI is analyzing data, please wait...</div>';
  try {
    const res = await fetch('/api/ai/weekly-report', { method: 'POST', headers: authHeaders() });
    if (!res.ok) { const err = await res.json(); document.getElementById('report-content').innerHTML = `<div class="error">Failed: ${err.error}</div>`; return; }
    const report = await res.json();
    renderReport(report); loadReportHistory();
  } finally { btn.disabled = false; btn.textContent = 'Generate This Week\'s Report'; }
});

function renderReport(r) {
  const html = r.content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
  document.getElementById('report-content').innerHTML =
    `<div class="report-meta">${r.week_start} to ${r.week_end} &nbsp;·&nbsp; Generated ${new Date(r.generated_at).toLocaleString()}</div><div class="report-body">${html}</div>`;
}

async function loadReportHistory() {
  const res = await fetch('/api/reports', { headers: authHeaders() });
  const reports = await res.json();
  if (!reports.length) return;
  document.getElementById('history-list').innerHTML = reports.map(r =>
    `<div class="history-item" onclick="expandReport(this)">
      <span>${r.week_start} ~ ${r.week_end}</span>
      <span class="history-date">${new Date(r.generated_at).toLocaleDateString()}</span>
    </div>
    <div class="history-body hidden" data-content="${encodeURIComponent(r.content)}"></div>`
  ).join('');
}

function expandReport(el) {
  const body = el.nextElementSibling;
  body.classList.toggle('hidden');
  if (!body.classList.contains('hidden') && !body.innerHTML) {
    const html = decodeURIComponent(body.dataset.content).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
    body.innerHTML = `<div class="report-body" style="padding:12px 0">${html}</div>`;
  }
}

document.getElementById('toggle-history').addEventListener('click', () => {
  const list = document.getElementById('history-list');
  const btn = document.getElementById('toggle-history');
  list.classList.toggle('hidden');
  btn.textContent = list.classList.contains('hidden') ? 'Show' : 'Hide';
});

// ── Users ──
async function loadUsers() {
  document.getElementById('users-tbody').innerHTML = '<tr><td colspan="5" class="loading">Loading...</td></tr>';
  const res = await fetch('/api/auth/users', { headers: authHeaders() });
  if (!res.ok) { document.getElementById('users-tbody').innerHTML = '<tr><td colspan="5" class="error">Failed to load users</td></tr>'; return; }
  allUsers = await res.json();
  const isSuperAdmin = userRole === 'super_admin';
  document.getElementById('users-tbody').innerHTML = allUsers.map(u => {
    const isProtected = u.role === 'super_admin' && !isSuperAdmin;
    const deleteBtn = isProtected
      ? `<button class="btn btn-sm btn-danger" disabled style="opacity:.4;cursor:not-allowed" title="Only Boss can delete Super Admin">Delete</button>`
      : `<button class="btn btn-sm btn-danger" onclick="deleteUser('${u.id}','${u.username}')">Delete</button>`;
    const editBtn = isProtected
      ? `<button class="btn btn-sm btn-outline" disabled style="opacity:.4;cursor:not-allowed" title="Only Boss can edit Super Admin">Edit</button>`
      : `<button class="btn btn-sm btn-outline" onclick="openEditUser('${u.id}')">Edit</button>`;
    return `<tr>
      <td><strong>${u.username}</strong></td>
      <td>${u.display_name || '—'}</td>
      <td><span class="status-badge ${u.role === 'admin' ? 'status-in_progress' : 'status-pending'}">${u.role}</span></td>
      <td>${new Date(u.created_at).toLocaleDateString()}</td>
      <td>${editBtn} ${deleteBtn}</td>
    </tr>`;
  }).join('');
}

function updateRoleDropdown() {
  const opt = document.querySelector('#u-role option[value="super_admin"]');
  if (opt) opt.style.display = userRole === 'super_admin' ? '' : 'none';
}

document.getElementById('add-user-btn').addEventListener('click', () => {
  editingUserId = null;
  document.getElementById('user-modal-title').textContent = 'Add User';
  document.getElementById('u-username').value = '';
  document.getElementById('u-display').value = '';
  document.getElementById('u-role').value = 'worker';
  document.getElementById('u-password').value = '';
  document.getElementById('u-pwd-label').textContent = 'Password *';
  document.getElementById('u-username').disabled = false;
  updateRoleDropdown();
  document.getElementById('user-modal').classList.remove('hidden');
});

function openEditUser(id) {
  const u = allUsers.find(x => x.id === id);
  if (!u) return;
  editingUserId = id;
  document.getElementById('user-modal-title').textContent = 'Edit User';
  document.getElementById('u-username').value = u.username;
  document.getElementById('u-username').disabled = true;
  document.getElementById('u-display').value = u.display_name || '';
  document.getElementById('u-role').value = u.role;
  document.getElementById('u-password').value = '';
  document.getElementById('u-pwd-label').textContent = 'New Password (leave blank to keep)';
  updateRoleDropdown();
  document.getElementById('user-modal').classList.remove('hidden');
}

document.getElementById('cancel-user-btn').addEventListener('click', () => document.getElementById('user-modal').classList.add('hidden'));

document.getElementById('save-user-btn').addEventListener('click', async () => {
  const username = document.getElementById('u-username').value.trim();
  const display_name = document.getElementById('u-display').value.trim();
  const role = document.getElementById('u-role').value;
  const password = document.getElementById('u-password').value;

  const btn = document.getElementById('save-user-btn');
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    let res;
    if (editingUserId) {
      const body = { display_name, role };
      if (password) body.password = password;
      res = await fetch(`/api/auth/users/${editingUserId}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(body) });
    } else {
      if (!username || !password) { alert('Username and password are required'); return; }
      res = await fetch('/api/auth/users', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ username, password, role, display_name: display_name || username }) });
    }
    if (!res.ok) { const err = await res.json(); alert('Error: ' + err.error); return; }
    document.getElementById('user-modal').classList.add('hidden');
    loadUsers();
  } finally { btn.disabled = false; btn.textContent = 'Save'; }
});

async function deleteUser(id, username) {
  if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
  const res = await fetch(`/api/auth/users/${id}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) { const err = await res.json(); alert('Error: ' + err.error); return; }
  loadUsers();
}

// ── Init ──
loadDashboard();
setInterval(loadDashboard, 120000);
