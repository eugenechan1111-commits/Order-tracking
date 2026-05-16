const TOKEN = localStorage.getItem('ao_token');
if (!TOKEN) window.location.href = '/login';

const api = async (method, path, body) => {
  const r = await fetch('/api' + path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
};

// ── MODAL HELPERS ──
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }

// ── MATERIALS ──
let allMaterials = [];
let matFilter = { filter: '', cat: '' };

async function loadMaterials() {
  try {
    allMaterials = await api('GET', '/materials');
    renderMaterials();
    checkLowStock();
  } catch (e) {
    document.getElementById('mat-table-wrap').innerHTML = `<div class="empty-state">${e.message}</div>`;
  }
}

function renderMaterials() {
  let data = allMaterials;
  if (matFilter.filter === 'low_stock') {
    data = data.filter(m => {
      const inv = m.inventory?.[0];
      return inv && inv.reorder_point > 0 && parseFloat(inv.qty_on_hand) <= parseFloat(inv.reorder_point);
    });
  }
  if (matFilter.cat) data = data.filter(m => m.category === matFilter.cat);

  if (!data.length) {
    document.getElementById('mat-table-wrap').innerHTML = '<div class="empty-state">No materials found.</div>';
    return;
  }

  const catColor = { panel: '#6366f1', hardware: '#f97316', fabric: '#ec4899', metal: '#64748b', other: '#10b981' };

  document.getElementById('mat-table-wrap').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Code</th><th>Name</th><th>Category</th><th>Unit</th>
          <th>On Hand</th><th>Reorder</th><th>Unit Cost</th><th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${data.map(m => {
          const inv = m.inventory?.[0] || {};
          const onHand = parseFloat(inv.qty_on_hand || 0);
          const reorder = parseFloat(inv.reorder_point || 0);
          const isLow = reorder > 0 && onHand <= reorder;
          const rowStyle = isLow ? 'background:rgba(239,68,68,0.06)' : '';
          const qtyStyle = isLow ? 'color:#ef4444;font-weight:600' : 'color:var(--text-primary)';
          const c = catColor[m.category] || '#64748b';
          return `
            <tr style="${rowStyle}">
              <td style="font-family:monospace;font-size:13px">${m.code}</td>
              <td style="font-weight:500">${m.name}${isLow ? ' <span style="color:#ef4444;font-size:11px">⚠ Low</span>' : ''}</td>
              <td><span class="status-badge" style="background:${c}20;color:${c}">${m.category}</span></td>
              <td>${m.unit}</td>
              <td style="${qtyStyle}">${onHand.toFixed(2)}</td>
              <td style="color:var(--text-muted)">${reorder > 0 ? reorder.toFixed(2) : '—'}</td>
              <td>RM ${parseFloat(m.unit_cost || 0).toFixed(2)}</td>
              <td>
                <button class="btn btn-outline btn-sm" onclick="openStockIn('${m.id}','${m.name}')">+ Stock</button>
                <button class="btn btn-outline btn-sm" onclick="openAdjust('${m.id}','${m.name}',${onHand})">Adjust</button>
                <button class="btn btn-outline btn-sm" onclick="viewLogs('${m.id}','${m.name}')">Logs</button>
                <button class="btn btn-outline btn-sm" onclick="openMaterialForm('${m.id}')">Edit</button>
                <button class="btn btn-outline btn-sm" style="color:#ef4444" onclick="deleteMaterial('${m.id}','${m.name}')">Del</button>
              </td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function checkLowStock() {
  const low = allMaterials.filter(m => {
    const inv = m.inventory?.[0];
    return inv && inv.reorder_point > 0 && parseFloat(inv.qty_on_hand) <= parseFloat(inv.reorder_point);
  });
  const badge = document.getElementById('low-stock-badge');
  if (low.length > 0) {
    badge.textContent = `⚠ ${low.length} low stock`;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

document.querySelectorAll('.mat-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mat-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (btn.dataset.filter !== undefined) {
      matFilter.filter = btn.dataset.filter;
      matFilter.cat = '';
    } else {
      matFilter.cat = btn.dataset.cat;
      matFilter.filter = '';
    }
    renderMaterials();
  });
});

function openMaterialForm(id) {
  document.getElementById('mat-id').value = id || '';
  document.getElementById('mat-modal-title').textContent = id ? 'Edit Material' : 'Add Material';
  if (id) {
    const m = allMaterials.find(x => x.id === id);
    if (m) {
      document.getElementById('mat-code').value = m.code;
      document.getElementById('mat-name').value = m.name;
      document.getElementById('mat-category').value = m.category;
      document.getElementById('mat-unit').value = m.unit;
      document.getElementById('mat-cost').value = m.unit_cost || 0;
      document.getElementById('mat-notes').value = m.notes || '';
      const inv = m.inventory?.[0] || {};
      document.getElementById('mat-qty').value = inv.qty_on_hand || 0;
      document.getElementById('mat-reorder').value = inv.reorder_point || 0;
    }
  } else {
    document.getElementById('mat-code').value = '';
    document.getElementById('mat-name').value = '';
    document.getElementById('mat-category').value = 'panel';
    document.getElementById('mat-unit').value = 'sheet';
    document.getElementById('mat-cost').value = 0;
    document.getElementById('mat-notes').value = '';
    document.getElementById('mat-qty').value = 0;
    document.getElementById('mat-reorder').value = 0;
  }
  openModal('mat-modal');
}

async function saveMaterial() {
  const id = document.getElementById('mat-id').value;
  const payload = {
    code: document.getElementById('mat-code').value.trim(),
    name: document.getElementById('mat-name').value.trim(),
    category: document.getElementById('mat-category').value,
    unit: document.getElementById('mat-unit').value,
    unit_cost: parseFloat(document.getElementById('mat-cost').value) || 0,
    notes: document.getElementById('mat-notes').value.trim(),
    qty_on_hand: parseFloat(document.getElementById('mat-qty').value) || 0,
    reorder_point: parseFloat(document.getElementById('mat-reorder').value) || 0
  };
  if (!payload.code || !payload.name) return alert('Code and Name are required.');
  try {
    if (id) await api('PATCH', '/materials/' + id, payload);
    else await api('POST', '/materials', payload);
    closeModal('mat-modal');
    loadMaterials();
  } catch (e) { alert(e.message); }
}

async function deleteMaterial(id, name) {
  if (!confirm(`Delete material "${name}"? This will also remove its BOM entries.`)) return;
  try { await api('DELETE', '/materials/' + id); loadMaterials(); }
  catch (e) { alert(e.message); }
}

// ── STOCK IN ──
function openStockIn(id, name) {
  document.getElementById('si-mat-id').value = id;
  document.getElementById('si-mat-name').textContent = name;
  document.getElementById('si-qty').value = '';
  document.getElementById('si-reference').value = '';
  document.getElementById('si-notes').value = '';
  openModal('stock-in-modal');
}

async function confirmStockIn() {
  const id = document.getElementById('si-mat-id').value;
  const qty = parseFloat(document.getElementById('si-qty').value);
  if (!qty || qty <= 0) return alert('Enter a valid quantity.');
  try {
    await api('POST', '/materials/' + id + '/stock-in', {
      qty, reference: document.getElementById('si-reference').value,
      notes: document.getElementById('si-notes').value
    });
    closeModal('stock-in-modal');
    loadMaterials();
  } catch (e) { alert(e.message); }
}

// ── ADJUST ──
function openAdjust(id, name, current) {
  document.getElementById('adj-mat-id').value = id;
  document.getElementById('adj-mat-name').textContent = name;
  document.getElementById('adj-current').textContent = `Current: ${current.toFixed(2)}`;
  document.getElementById('adj-qty').value = current;
  document.getElementById('adj-notes').value = '';
  openModal('adjust-modal');
}

async function confirmAdjust() {
  const id = document.getElementById('adj-mat-id').value;
  const qty = parseFloat(document.getElementById('adj-qty').value);
  if (qty === undefined || isNaN(qty)) return alert('Enter a valid quantity.');
  try {
    await api('POST', '/materials/' + id + '/adjust', {
      qty, notes: document.getElementById('adj-notes').value
    });
    closeModal('adjust-modal');
    loadMaterials();
  } catch (e) { alert(e.message); }
}

// ── LOGS ──
async function viewLogs(id, name) {
  document.getElementById('logs-modal-title').textContent = `Stock History — ${name}`;
  document.getElementById('logs-modal-body').innerHTML = '<div class="loading"><div class="spinner"></div> Loading…</div>';
  openModal('logs-modal');
  try {
    const logs = await api('GET', '/materials/' + id + '/logs');
    if (!logs.length) {
      document.getElementById('logs-modal-body').innerHTML = '<div class="empty-state">No stock movements recorded.</div>';
      return;
    }
    const actionColor = { in: '#10b981', out: '#ef4444', adjust: '#f59e0b' };
    document.getElementById('logs-modal-body').innerHTML = `
      <table style="width:100%;font-size:13px">
        <thead><tr><th>Date</th><th>Action</th><th>Qty</th><th>Reference</th><th>By</th></tr></thead>
        <tbody>
          ${logs.map(l => `
            <tr>
              <td style="color:var(--text-muted)">${new Date(l.created_at).toLocaleDateString('en-MY')}</td>
              <td><span class="status-badge" style="background:${actionColor[l.action]}20;color:${actionColor[l.action]}">${l.action}</span></td>
              <td style="font-weight:500;color:${parseFloat(l.qty) >= 0 ? '#10b981' : '#ef4444'}">${parseFloat(l.qty) >= 0 ? '+' : ''}${parseFloat(l.qty).toFixed(2)}</td>
              <td>${l.reference || '—'}</td>
              <td style="color:var(--text-muted)">${l.users?.display_name || l.users?.username || '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    document.getElementById('logs-modal-body').innerHTML = `<div class="empty-state">${e.message}</div>`;
  }
}

// ── BOM EDITOR ──
let bomMaterials = [];

async function initBOM() {
  bomMaterials = await api('GET', '/materials');
  const sel = document.getElementById('bom-material');
  sel.innerHTML = '<option value="">— Select material —</option>' +
    bomMaterials.map(m => `<option value="${m.id}">[${m.code}] ${m.name} (${m.unit})</option>`).join('');

  const products = await api('GET', '/bom/products');
  const psel = document.getElementById('bom-product-select');
  psel.innerHTML = '<option value="">— Select product —</option>' +
    products.map(p => `<option value="${p}">${p}</option>`).join('');
}

async function loadBOM() {
  const product = document.getElementById('bom-product-select').value;
  if (!product) {
    document.getElementById('bom-table-wrap').innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:40px">Select a product to view its Bill of Materials.</div>';
    return;
  }
  document.getElementById('bom-table-wrap').innerHTML = '<div class="loading"><div class="spinner"></div> Loading…</div>';
  try {
    const rows = await api('GET', '/bom?product_name=' + encodeURIComponent(product));
    renderBOM(rows, product);
  } catch (e) {
    document.getElementById('bom-table-wrap').innerHTML = `<div class="empty-state">${e.message}</div>`;
  }
}

function renderBOM(rows, product) {
  if (!rows.length) {
    document.getElementById('bom-table-wrap').innerHTML = `<div class="empty-state">No BOM lines for "${product}". Click "+ Add BOM Line" to start.</div>`;
    return;
  }
  document.getElementById('bom-table-wrap').innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Material</th><th>Category</th><th>Qty/Unit</th>
          <th>Cut L×W×T (mm)</th><th>On Hand</th><th>Notes</th><th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => {
          const mat = r.materials || {};
          const inv = mat.inventory?.[0] || {};
          return `
            <tr>
              <td><span style="font-family:monospace;font-size:12px;color:var(--text-muted)">${mat.code || ''}</span> ${mat.name || '—'}</td>
              <td>${mat.category || '—'}</td>
              <td style="font-weight:600">${parseFloat(r.quantity_per_unit)} ${mat.unit || ''}</td>
              <td style="font-size:12px;color:var(--text-muted)">
                ${r.cut_length ? `${r.cut_length}×${r.cut_width}×${r.cut_thickness}` : '—'}
              </td>
              <td style="color:${parseFloat(inv.qty_on_hand||0)===0?'#ef4444':'var(--text-primary)'}">
                ${parseFloat(inv.qty_on_hand||0).toFixed(2)}
              </td>
              <td style="color:var(--text-muted);font-size:13px">${r.notes || '—'}</td>
              <td>
                <button class="btn btn-outline btn-sm" onclick="editBOMLine('${r.id}')">Edit</button>
                <button class="btn btn-outline btn-sm" style="color:#ef4444" onclick="deleteBOMLine('${r.id}')">Del</button>
              </td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function addBOMLine() {
  const product = document.getElementById('bom-product-select').value ||
    document.getElementById('bom-new-product').value.trim();
  document.getElementById('bom-line-id').value = '';
  document.getElementById('bom-modal-title').textContent = 'Add BOM Line';
  document.getElementById('bom-product').value = product;
  document.getElementById('bom-material').value = '';
  document.getElementById('bom-qty-per-unit').value = '';
  document.getElementById('bom-line-notes').value = '';
  document.getElementById('bom-cut-length').value = '';
  document.getElementById('bom-cut-width').value = '';
  document.getElementById('bom-cut-thickness').value = '';
  openModal('bom-modal');
}

async function editBOMLine(id) {
  const product = document.getElementById('bom-product-select').value;
  const rows = await api('GET', '/bom?product_name=' + encodeURIComponent(product));
  const r = rows.find(x => x.id === id);
  if (!r) return;
  document.getElementById('bom-line-id').value = r.id;
  document.getElementById('bom-modal-title').textContent = 'Edit BOM Line';
  document.getElementById('bom-product').value = r.product_name;
  document.getElementById('bom-material').value = r.material_id;
  document.getElementById('bom-qty-per-unit').value = r.quantity_per_unit;
  document.getElementById('bom-line-notes').value = r.notes || '';
  document.getElementById('bom-cut-length').value = r.cut_length || '';
  document.getElementById('bom-cut-width').value = r.cut_width || '';
  document.getElementById('bom-cut-thickness').value = r.cut_thickness || '';
  openModal('bom-modal');
}

async function saveBOMLine() {
  const id = document.getElementById('bom-line-id').value;
  const payload = {
    product_name: document.getElementById('bom-product').value.trim(),
    material_id: document.getElementById('bom-material').value,
    quantity_per_unit: parseFloat(document.getElementById('bom-qty-per-unit').value),
    notes: document.getElementById('bom-line-notes').value.trim(),
    cut_length: parseFloat(document.getElementById('bom-cut-length').value) || null,
    cut_width: parseFloat(document.getElementById('bom-cut-width').value) || null,
    cut_thickness: parseFloat(document.getElementById('bom-cut-thickness').value) || null
  };
  if (!payload.product_name || !payload.material_id || !payload.quantity_per_unit) {
    return alert('Product, material and quantity are required.');
  }
  try {
    if (id) await api('PATCH', '/bom/' + id, payload);
    else {
      await api('POST', '/bom', payload);
      // Refresh product list
      const products = await api('GET', '/bom/products');
      const psel = document.getElementById('bom-product-select');
      psel.innerHTML = '<option value="">— Select product —</option>' +
        products.map(p => `<option value="${p}">${p}</option>`).join('');
      psel.value = payload.product_name;
    }
    closeModal('bom-modal');
    loadBOM();
  } catch (e) { alert(e.message); }
}

async function deleteBOMLine(id) {
  if (!confirm('Delete this BOM line?')) return;
  try { await api('DELETE', '/bom/' + id); loadBOM(); }
  catch (e) { alert(e.message); }
}

// ── STOCK CHECK ──
function openMaterialCheck() {
  document.getElementById('sc-items-list').innerHTML = '';
  document.getElementById('sc-result').innerHTML = '';
  addStockCheckItem();
  openModal('stock-check-modal');
}

function addStockCheckItem() {
  const list = document.getElementById('sc-items-list');
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;margin-bottom:8px';
  row.innerHTML = `
    <input type="text" class="form-input sc-product" placeholder="Product name" style="flex:2">
    <input type="number" class="form-input sc-qty" placeholder="Qty" style="flex:1" min="1" value="1">
    <button class="btn btn-outline btn-sm" onclick="this.parentElement.remove()">✕</button>`;
  list.appendChild(row);
}

async function runStockCheck() {
  const rows = document.querySelectorAll('#sc-items-list > div');
  const items = [];
  rows.forEach(r => {
    const product = r.querySelector('.sc-product').value.trim();
    const qty = parseFloat(r.querySelector('.sc-qty').value) || 1;
    if (product) items.push({ product, qty });
  });
  if (!items.length) return alert('Add at least one product.');
  try {
    const result = await api('POST', '/bom/check', { items });
    renderStockCheckResult(result);
  } catch (e) { alert(e.message); }
}

function renderStockCheckResult(result) {
  const el = document.getElementById('sc-result');
  if (!result.has_bom) {
    el.innerHTML = '<div class="empty-state">No BOM data found for these products. Add BOM lines first.</div>';
    return;
  }
  const icon = result.all_sufficient ? '✅' : '❌';
  const msg = result.all_sufficient ? 'All materials sufficient' : 'Some materials are short';
  el.innerHTML = `
    <div style="font-weight:600;margin-bottom:10px;color:${result.all_sufficient?'#10b981':'#ef4444'}">${icon} ${msg}</div>
    <table style="width:100%;font-size:13px">
      <thead><tr><th>Material</th><th>Required</th><th>On Hand</th><th>Shortfall</th><th>Status</th></tr></thead>
      <tbody>
        ${result.results.map(r => `
          <tr>
            <td>${r.material_name} <span style="color:var(--text-muted);font-size:11px">(${r.unit})</span></td>
            <td>${r.required}</td>
            <td>${r.on_hand}</td>
            <td style="color:${r.shortfall>0?'#ef4444':'var(--text-muted)'}">${r.shortfall > 0 ? r.shortfall : '—'}</td>
            <td><span class="status-badge" style="background:${r.sufficient?'#10b98120':'#ef444420'};color:${r.sufficient?'#10b981':'#ef4444'}">${r.sufficient?'OK':'SHORT'}</span></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

// ── CUT LIST GENERATOR ──
function addCutListItem() {
  const list = document.getElementById('cl-items-list');
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;margin-bottom:8px';
  row.innerHTML = `
    <input type="text" class="form-input cl-product" placeholder="Product name" style="flex:2">
    <input type="number" class="form-input cl-qty" placeholder="Qty" style="flex:1" min="1" value="1">
    <button class="btn btn-outline btn-sm" onclick="this.parentElement.remove()">✕</button>`;
  list.appendChild(row);
}

async function generateCutList() {
  const rows = document.querySelectorAll('#cl-items-list > div');
  const items = [];
  rows.forEach(r => {
    const product = r.querySelector('.cl-product').value.trim();
    const qty = parseFloat(r.querySelector('.cl-qty').value) || 1;
    if (product) items.push({ product, qty });
  });
  if (!items.length) return alert('Add at least one product.');

  const sheetLength = parseFloat(document.getElementById('cl-sheet-length').value) || 2440;
  const sheetWidth = parseFloat(document.getElementById('cl-sheet-width').value) || 1220;

  try {
    const result = await api('POST', '/bom/cutlist', { items, sheet_length: sheetLength, sheet_width: sheetWidth });
    renderCutList(result);
  } catch (e) { alert(e.message); }
}

function renderCutList(result) {
  const el = document.getElementById('cl-result');
  if (!result.cutlist?.length) {
    el.innerHTML = `<div class="panel"><div style="padding:20px;color:var(--text-muted);text-align:center">${result.message || 'No panel BOM entries found. Add cut dimensions in the BOM Editor.'}</div></div>`;
    return;
  }
  el.innerHTML = result.cutlist.map(group => `
    <div class="panel" style="margin-bottom:16px">
      <div class="panel-header">
        <h2>${group.material.name} <span style="font-size:13px;font-weight:400;color:var(--text-muted)">[${group.material.code}]</span></h2>
        <span style="font-weight:700;color:var(--indigo)">
          ${group.sheets_needed} sheet${group.sheets_needed !== 1 ? 's' : ''} needed
          <span style="font-size:12px;font-weight:400;color:var(--text-muted)"> (${group.sheet_size}, 15% waste)</span>
        </span>
      </div>
      <div style="padding:0 16px 16px">
        <table style="width:100%">
          <thead>
            <tr><th>Description</th><th>L (mm)</th><th>W (mm)</th><th>T (mm)</th><th>Pcs</th><th>Area (mm²)</th></tr>
          </thead>
          <tbody>
            ${group.cuts.map(c => `
              <tr>
                <td>${c.label}</td>
                <td style="font-weight:600">${c.length}</td>
                <td style="font-weight:600">${c.width}</td>
                <td style="color:var(--text-muted)">${c.thickness || '—'}</td>
                <td style="font-weight:600;color:var(--indigo)">${c.pcs}</td>
                <td style="color:var(--text-muted);font-size:12px">${(c.length * c.width * c.pcs).toLocaleString()}</td>
              </tr>`).join('')}
            <tr style="background:var(--content-bg);font-weight:600">
              <td colspan="5" style="text-align:right;padding-right:12px">Total Area:</td>
              <td>${group.total_area_mm2.toLocaleString()} mm²</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>`).join('');
}

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  loadMaterials();
  initBOM();
  addCutListItem();

  // Hash-based tab routing: /inventory#bom → open BOM tab
  const hash = window.location.hash.replace('#', '');
  if (hash && ['materials', 'bom', 'cutlist'].includes(hash)) {
    activateInvTab(hash);
  }
});
