// ── Auth guard ──
const token = localStorage.getItem('ao_token');
const workerName = localStorage.getItem('ao_display_name') || localStorage.getItem('ao_username') || 'Worker';
if (!token) { window.location.href = '/login'; }

// Pre-warm: fire a real lightweight query immediately so the serverless function is hot
const savedStation = localStorage.getItem('ao_station');
if (savedStation) {
  fetch(`/api/work-orders?workstation=${encodeURIComponent(savedStation)}&status=pending,in_progress,paused`, {
    headers: { Authorization: `Bearer ${token}` }
  }).catch(() => {});
} else {
  fetch('/api/ping').catch(() => {});
}

document.getElementById('header-worker').textContent = workerName;
document.getElementById('logout-btn').addEventListener('click', () => {
  localStorage.clear(); window.location.href = '/login';
});

function authHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
}

let currentStation = '';
let currentFilter = 'pending,in_progress,paused';
let pendingActionId = null;
let pendingTargetQty = 0;

const $ = id => document.getElementById(id);

// Station selection
document.querySelectorAll('.station-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentStation = btn.dataset.ws;
    localStorage.setItem('ao_station', currentStation);
    enterWorkMode();
  });
});

function enterWorkMode() {
  $('login-section').classList.add('hidden');
  $('work-section').classList.remove('hidden');
  $('ws-badge').textContent = currentStation;
  $('worker-label').textContent = workerName;
  loadWorkOrders();
}

$('change-btn').addEventListener('click', () => {
  $('work-section').classList.add('hidden');
  $('login-section').classList.remove('hidden');
  currentStation = '';
  localStorage.removeItem('ao_station');
});

// Auto-restore station from last session
if (savedStation) {
  currentStation = savedStation;
  enterWorkMode();
}

// Filter tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    loadWorkOrders();
  });
});

async function loadWorkOrders() {
  $('wo-list').innerHTML = '<div class="loading"><div class="spinner"></div> Loading…</div>';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const params = new URLSearchParams({ workstation: currentStation, status: currentFilter });
    const res = await fetch(`/api/work-orders?${params}`, { headers: authHeaders(), signal: controller.signal });
    clearTimeout(timeout);
    if (res.status === 401) { window.location.href = '/login'; return; }
    const list = await res.json();
    renderWorkOrders(list);
  } catch (e) {
    clearTimeout(timeout);
    const msg = e.name === 'AbortError' ? 'Request timed out' : e.message;
    $('wo-list').innerHTML = `<div class="error" style="text-align:center;padding:32px">
      <div style="margin-bottom:12px">⚠️ ${msg}</div>
      <button class="btn btn-primary" onclick="loadWorkOrders()">Retry</button>
    </div>`;
  }
}

function renderWorkOrders(list) {
  if (!list.length) { $('wo-list').innerHTML = '<div class="empty-state">No work orders</div>'; return; }
  // Sort urgent orders to top
  list = [...list].sort((a, b) => {
    const au = a.orders?.urgent ? 1 : 0, bu = b.orders?.urgent ? 1 : 0;
    return bu - au;
  });

  $('wo-list').innerHTML = list.map(wo => {
    const order = wo.orders || {};
    const dueDate = order.due_date || '';
    const isOverdue = dueDate && new Date(dueDate) < new Date() && wo.status !== 'completed';
    const statusLabel = { pending: 'Pending', in_progress: 'In Progress', paused: 'Paused', completed: 'Completed' }[wo.status] || wo.status;

    const target = wo.target_qty || 0;
    const actual = wo.actual_qty || 0;
    const rework = wo.rework_qty || 0;
    const remaining = Math.max(0, target - actual);
    const canComplete = actual >= target;

    // Progress bar percentage
    const pct = target > 0 ? Math.min(Math.round(actual / target * 100), 100) : 0;

    const isUrgent = order.urgent;
    return `
    <div class="wo-card status-${wo.status}${isUrgent ? ' wo-card-urgent' : ''}">
      <div class="wo-card-header">
        <span class="wo-order-no">${order.order_no || '—'}${isUrgent ? ' <span class="urgent-badge">URGENT</span>' : ''}</span>
        <span class="wo-status-badge status-${wo.status}">${statusLabel}</span>
      </div>
      <div class="wo-product">${order.product || '—'}</div>
      <div class="wo-meta">
        <span>Customer: ${order.customer || '—'}</span>
        <span class="${isOverdue ? 'overdue' : ''}">Due: ${dueDate || '—'}${isOverdue ? ' ⚠️' : ''}</span>
        ${(order.attachments || []).length ? `<span class="attach-badge" style="cursor:pointer" onclick='showWorkerAttachments(${JSON.stringify(order.attachments || [])})'>📎 ${order.attachments.length} file${order.attachments.length > 1 ? 's' : ''}</span>` : ''}
      </div>

      <div class="wo-progress-row">
        <div class="wo-progress-bar-wrap">
          <div class="wo-progress-bar" style="width:${pct}%"></div>
        </div>
        <span class="wo-progress-label">${actual} / ${target} units</span>
      </div>

      <div class="wo-qty-detail">
        ${rework > 0 ? `<span class="rework-badge">↩ Rework: ${rework} units</span>` : ''}
        ${remaining > 0 && wo.status === 'in_progress' ? `<span class="remaining-badge">Need ${remaining} more</span>` : ''}
      </div>

      ${wo.worker_name ? `<div class="wo-worker">Worker: ${wo.worker_name}</div>` : ''}

      <div class="wo-actions">
        ${wo.status === 'pending' ? `
          <button class="btn btn-primary btn-lg" style="flex:1" onclick="startWO('${wo.id}')">▶ Start</button>
        ` : ''}
        ${wo.status === 'in_progress' ? `
          <button class="btn btn-outline" onclick="pauseWO('${wo.id}')">⏸ Pause</button>
          <button class="btn btn-danger" onclick="openReject('${wo.id}')">✗ Reject</button>
          ${rework > 0 ? `<button class="btn btn-warning" onclick="resumeWO('${wo.id}')">↩ Rework (${rework})</button>` : ''}
          <button class="btn btn-success btn-lg" onclick="openComplete('${wo.id}', ${target}, ${actual})">✓ Complete</button>
        ` : ''}
        ${wo.status === 'paused' ? `
          <button class="btn btn-primary" onclick="resumeWO('${wo.id}')">▶ Resume</button>
          <button class="btn btn-danger" disabled style="opacity:.4;cursor:not-allowed">✗ Reject</button>
          ${rework > 0 ? `<button class="btn btn-warning" onclick="resumeWO('${wo.id}')">↩ Rework (${rework})</button>` : ''}
          <button class="btn btn-success btn-lg" onclick="openComplete('${wo.id}', ${target}, ${actual})">✓ Complete</button>
        ` : ''}
      </div>
    </div>`;
  }).join('');
}

async function startWO(id) {
  await fetch(`/api/work-orders/${id}/start`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ worker_name: workerName }) });
  loadWorkOrders();
}

async function resumeWO(id) {
  await fetch(`/api/work-orders/${id}/resume`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ worker_name: workerName }) });
  loadWorkOrders();
}

// ── Complete ──
function openComplete(id, targetQty, currentActual) {
  pendingActionId = id;
  pendingTargetQty = targetQty;
  $('actual-qty').value = targetQty;
  $('complete-note').value = '';

  const remaining = Math.max(0, targetQty - currentActual);
  const hint = document.getElementById('complete-qty-hint');
  if (hint) hint.textContent = remaining > 0
    ? `Target: ${targetQty} units. Need at least ${targetQty} total good units to complete.`
    : `Target met. Enter final confirmed quantity.`;

  $('complete-modal').classList.remove('hidden');
}

$('confirm-complete').addEventListener('click', async () => {
  const qty = parseInt($('actual-qty').value);
  if (isNaN(qty) || qty < 0) { alert('Please enter a valid quantity'); return; }

  if (qty < pendingTargetQty) {
    const shortfall = pendingTargetQty - qty;
    alert(`Cannot complete: quantity ${qty} is less than target ${pendingTargetQty}.\nNeed ${shortfall} more units.\n\nTip: Use "Reject" to log defective units.`);
    return;
  }

  const note = $('complete-note').value.trim();
  $('complete-modal').classList.add('hidden');

  const res = await fetch(`/api/work-orders/${pendingActionId}/complete`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ worker_name: workerName, actual_qty: qty, note })
  });

  if (!res.ok) {
    const err = await res.json();
    alert(err.error || 'Could not complete work order');
    return;
  }
  loadWorkOrders();
});

$('cancel-complete').addEventListener('click', () => $('complete-modal').classList.add('hidden'));

// ── Pause ──
let pauseReason = '';

function pauseWO(id) {
  pendingActionId = id;
  pauseReason = '';
  $('pause-qty').value = '';
  $('pause-note').value = '';
  document.querySelectorAll('.reason-btn').forEach(b => b.classList.remove('active'));
  $('pause-modal').classList.remove('hidden');
}

document.querySelectorAll('.reason-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.reason-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    pauseReason = btn.dataset.reason;
  });
});

$('confirm-pause').addEventListener('click', async () => {
  const qty = $('pause-qty').value !== '' ? parseInt($('pause-qty').value) : null;
  const extra = $('pause-note').value.trim();
  const note = [pauseReason, extra].filter(Boolean).join(' — ');
  $('pause-modal').classList.add('hidden');
  await fetch(`/api/work-orders/${pendingActionId}/pause`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ worker_name: workerName, note, actual_qty: qty })
  });
  loadWorkOrders();
});

$('cancel-pause').addEventListener('click', () => $('pause-modal').classList.add('hidden'));

// ── Reject ──
function openReject(id) {
  pendingActionId = id;
  $('reject-qty').value = '';
  $('reject-note').value = '';
  $('reject-modal').classList.remove('hidden');
}

$('confirm-reject').addEventListener('click', async () => {
  const qty = parseInt($('reject-qty').value);
  const note = $('reject-note').value.trim();
  if (isNaN(qty) || qty <= 0) { alert('Please enter rejected quantity'); return; }
  if (!note) { alert('Please enter a reason'); return; }
  $('reject-modal').classList.add('hidden');
  const res = await fetch(`/api/work-orders/${pendingActionId}/rework`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ worker_name: workerName, rework_qty: qty, note })
  });
  if (!res.ok) { const err = await res.json(); alert(err.error || 'Could not log rejection'); return; }
  loadWorkOrders();
});

$('cancel-reject').addEventListener('click', () => $('reject-modal').classList.add('hidden'));

// ── Rework (fix rejected units) ──
function openRework(id) {
  pendingActionId = id;
  $('rework-qty').value = '';
  $('rework-note').value = '';
  $('rework-modal').classList.remove('hidden');
}

$('confirm-rework').addEventListener('click', async () => {
  const qty = parseInt($('rework-qty').value);
  const note = $('rework-note').value.trim();
  if (isNaN(qty) || qty <= 0) { alert('Please enter reworked quantity'); return; }
  $('rework-modal').classList.add('hidden');
  const res = await fetch(`/api/work-orders/${pendingActionId}/rework-done`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ worker_name: workerName, qty, note })
  });
  if (!res.ok) { const err = await res.json(); alert(err.error || 'Could not log rework'); return; }
  loadWorkOrders();
});

$('cancel-rework').addEventListener('click', () => $('rework-modal').classList.add('hidden'));

// Auto-refresh every 60s
setInterval(() => { if (currentStation) loadWorkOrders(); }, 60000);

function showWorkerAttachments(attachments) {
  const list = attachments.map(a =>
    a.url
      ? `<li><a href="${a.url}" target="_blank" rel="noopener" style="color:var(--blue);word-break:break-all">${a.name}</a> <span style="color:#888;font-size:12px">(${(a.size/1024).toFixed(1)} KB)</span></li>`
      : `<li>${a.name}</li>`
  ).join('');
  $('worker-attach-list').innerHTML = `<ul style="padding-left:20px;line-height:2.2;font-size:15px">${list}</ul>`;
  $('worker-attach-modal').classList.remove('hidden');
}
