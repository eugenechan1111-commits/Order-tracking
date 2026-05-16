const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const supabase = require('../lib/supabase');
const { requireCustomerAuth, requireAdmin } = require('../lib/auth');

// File upload setup for payment slips
// On Vercel the filesystem is read-only except /tmp; use /tmp there
const IS_VERCEL = !!process.env.VERCEL;
const uploadDir = IS_VERCEL
  ? '/tmp/portal-uploads'
  : path.join(__dirname, '..', 'public', 'uploads', 'portal');

try {
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
} catch (e) {
  console.warn('Could not create upload dir:', e.message);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `slip_${Date.now()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ── Demo data ──────────────────────────────────────────────────────────────────
const DEMO_PRODUCTS = [
  {
    id: 'demo-prod-1',
    name: 'Kitchen Cabinet',
    description: 'Custom kitchen cabinet — laminate finish, soft-close hinges',
    image_url: null,
    fields: [
      { key: 'width',  label: 'Width (mm)',  type: 'number', min: 300, max: 3600, default: 900 },
      { key: 'height', label: 'Height (mm)', type: 'number', min: 300, max: 2400, default: 720 },
      { key: 'depth',  label: 'Depth (mm)',  type: 'number', min: 300, max: 600,  default: 560 },
      { key: 'color',  label: 'Colour',      type: 'select', options: ['White','Walnut','Oak','Anthracite'], price_mod: { White: 0, Walnut: 180, Oak: 150, Anthracite: 120 } },
      { key: 'drilling', label: 'Add Hole Drilling', type: 'checkbox', price_add: 60 }
    ],
    formula: '(width/1000)*(height/1000)*base_price + color_mod + (drilling ? price_add : 0)',
    base_price: 850,
    currency: 'MYR',
    active: true,
    sort_order: 0,
    created_at: new Date().toISOString()
  },
  {
    id: 'demo-prod-2',
    name: 'Wardrobe',
    description: 'Sliding door wardrobe — customise width, height, and finish',
    image_url: null,
    fields: [
      { key: 'width',  label: 'Width (mm)',  type: 'number', min: 900, max: 4800, default: 1800 },
      { key: 'height', label: 'Height (mm)', type: 'number', min: 1800, max: 2700, default: 2100 },
      { key: 'color',  label: 'Finish',      type: 'select', options: ['White','Dark Grey','Teak'], price_mod: { White: 0, 'Dark Grey': 200, Teak: 250 } },
    ],
    formula: '(width/1000)*(height/1000)*base_price + color_mod',
    base_price: 1200,
    currency: 'MYR',
    active: true,
    sort_order: 1,
    created_at: new Date().toISOString()
  }
];

const DEMO_REQUESTS = [];
const DEMO_PAYMENTS = [];

// ── Helpers ────────────────────────────────────────────────────────────────────
function genRequestNo() {
  const d = new Date();
  const yyyymmdd = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const seq = String(DEMO_REQUESTS.length + 1).padStart(3, '0');
  return `PO-${yyyymmdd}-${seq}`;
}

async function nextPortalNo(prefix) {
  // Simple date-based fallback when doc-number counter unavailable
  const d = new Date();
  const yyyymmdd = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const { count } = await supabase.from('portal_quote_requests').select('id', { count: 'exact', head: true });
  return `${prefix}-${yyyymmdd}-${String((count || 0) + 1).padStart(3,'0')}`;
}

// ── CUSTOMER ROUTES ────────────────────────────────────────────────────────────

// GET /api/customer-portal/products — list active product configs
router.get('/products', requireCustomerAuth, async (req, res) => {
  if (!process.env.SUPABASE_URL) return res.json(DEMO_PRODUCTS);
  const { data, error } = await supabase
    .from('portal_product_configs')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/customer-portal/my-requests — customer's quote requests
router.get('/my-requests', requireCustomerAuth, async (req, res) => {
  const customerName = req.customer.customer_name;
  if (!process.env.SUPABASE_URL) {
    return res.json(DEMO_REQUESTS.filter(r => r.customer_name === customerName));
  }
  const { data, error } = await supabase
    .from('portal_quote_requests')
    .select('*')
    .eq('customer_name', customerName)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/customer-portal/my-requests — submit a new quote request
router.post('/my-requests', requireCustomerAuth, async (req, res) => {
  const { product_config_id, product_name, config_snapshot, estimated_price, notes } = req.body;
  if (!product_name) return res.status(400).json({ error: 'product_name is required' });

  if (!process.env.SUPABASE_URL) {
    const r = {
      id: 'demo-req-' + Date.now(),
      request_no: genRequestNo(),
      customer_user_id: req.customer.id,
      customer_name: req.customer.customer_name,
      product_config_id, product_name, config_snapshot, estimated_price, notes,
      status: 'pending',
      quotation_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    DEMO_REQUESTS.push(r);
    return res.status(201).json(r);
  }

  const request_no = await nextPortalNo('PO');
  const { data, error } = await supabase
    .from('portal_quote_requests')
    .insert({
      request_no,
      customer_user_id: req.customer.id,
      customer_name: req.customer.customer_name,
      product_config_id, product_name,
      config_snapshot: config_snapshot || {},
      estimated_price: estimated_price || 0,
      notes,
      status: 'pending'
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// DELETE /api/customer-portal/my-requests/:id — customer cancels a pending request
router.delete('/my-requests/:id', requireCustomerAuth, async (req, res) => {
  if (!process.env.SUPABASE_URL) return res.json({ ok: true });
  // Only allow deletion of own pending requests
  const { data, error } = await supabase
    .from('portal_quote_requests')
    .select('id, status, customer_user_id')
    .eq('id', req.params.id)
    .single();
  if (error || !data) return res.status(404).json({ error: 'Request not found' });
  if (data.customer_user_id !== req.customer.id) return res.status(403).json({ error: 'Not authorised' });
  if (!['pending', 'rejected'].includes(data.status)) return res.status(400).json({ error: 'Only pending or rejected orders can be deleted' });
  const { error: delErr } = await supabase.from('portal_quote_requests').delete().eq('id', req.params.id);
  if (delErr) return res.status(500).json({ error: delErr.message });
  res.json({ ok: true });
});

// GET /api/customer-portal/my-quotations — quotations from admin for this customer
router.get('/my-quotations', requireCustomerAuth, async (req, res) => {
  if (!process.env.SUPABASE_URL) return res.json([]);

  // Find linked_customer_id from customer_users
  const { data: cu } = await supabase
    .from('customer_users')
    .select('linked_customer_id')
    .eq('id', req.customer.id)
    .single();

  if (!cu?.linked_customer_id) return res.json([]);

  const { data, error } = await supabase
    .from('quotations')
    .select('*, customers(company_name)')
    .eq('customer_id', cu.linked_customer_id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PATCH /api/customer-portal/my-quotations/:id/accept
router.patch('/my-quotations/:id/accept', requireCustomerAuth, async (req, res) => {
  if (!process.env.SUPABASE_URL) return res.json({ ok: true });
  // Verify this quotation belongs to the customer
  const { data: cu } = await supabase.from('customer_users').select('linked_customer_id').eq('id', req.customer.id).single();
  if (!cu?.linked_customer_id) return res.status(403).json({ error: 'No linked customer account' });

  const { data: qt } = await supabase.from('quotations').select('customer_id').eq('id', req.params.id).single();
  if (!qt || qt.customer_id !== cu.linked_customer_id) return res.status(403).json({ error: 'Not your quotation' });

  const { data, error } = await supabase
    .from('quotations').update({ status: 'accepted' }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PATCH /api/customer-portal/my-quotations/:id/reject
router.patch('/my-quotations/:id/reject', requireCustomerAuth, async (req, res) => {
  if (!process.env.SUPABASE_URL) return res.json({ ok: true });
  const { data: cu } = await supabase.from('customer_users').select('linked_customer_id').eq('id', req.customer.id).single();
  if (!cu?.linked_customer_id) return res.status(403).json({ error: 'No linked customer account' });

  const { data: qt } = await supabase.from('quotations').select('customer_id').eq('id', req.params.id).single();
  if (!qt || qt.customer_id !== cu.linked_customer_id) return res.status(403).json({ error: 'Not your quotation' });

  const { data, error } = await supabase
    .from('quotations').update({ status: 'rejected' }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/customer-portal/my-orders — production orders (same as /api/track)
router.get('/my-orders', requireCustomerAuth, async (req, res) => {
  const customerName = req.customer.customer_name;
  const { order_no } = req.query;

  if (!process.env.SUPABASE_URL) {
    const { DEMO_ORDERS } = require('../lib/demo-data');
    let results = DEMO_ORDERS.filter(o => !o.hidden && o.customer.toLowerCase() === customerName.toLowerCase());
    if (order_no) results = results.filter(o => o.order_no.toLowerCase().includes(order_no.trim().toLowerCase()));
    return res.json(results);
  }

  let query = supabase
    .from('orders')
    .select('order_no, customer, product, items, due_date, status, urgent, work_orders(workstation, status, actual_qty, target_qty)')
    .eq('hidden', false)
    .ilike('customer', customerName);
  if (order_no) query = query.ilike('order_no', `%${order_no.trim()}%`);

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Something went wrong.' });
  res.json(data || []);
});

// GET /api/customer-portal/my-sales-orders — sales orders for payment
router.get('/my-sales-orders', requireCustomerAuth, async (req, res) => {
  if (!process.env.SUPABASE_URL) return res.json([]);
  const { data: cu } = await supabase.from('customer_users').select('linked_customer_id').eq('id', req.customer.id).single();
  if (!cu?.linked_customer_id) return res.json([]);

  const { data, error } = await supabase
    .from('sales_orders')
    .select('id, so_no, total_amount, deposit_amount, status, payment_term')
    .eq('customer_id', cu.linked_customer_id)
    .not('status', 'in', '("delivered","paid","cancelled")')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/customer-portal/payments — this customer's payments
router.get('/payments', requireCustomerAuth, async (req, res) => {
  if (!process.env.SUPABASE_URL) {
    return res.json(DEMO_PAYMENTS.filter(p => p.customer_user_id === req.customer.id));
  }
  const { data, error } = await supabase
    .from('portal_payments')
    .select('*')
    .eq('customer_user_id', req.customer.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/customer-portal/payments — submit a payment
router.post('/payments', requireCustomerAuth, upload.single('slip'), async (req, res) => {
  const { sales_order_id, so_no, method, amount, bank_ref, notes } = req.body;
  if (!method || !amount) return res.status(400).json({ error: 'method and amount are required' });
  if (method === 'bank_transfer' && !req.file) return res.status(400).json({ error: 'Please upload a bank-in slip.' });

  const slip_url = req.file ? `/uploads/portal/${req.file.filename}` : null;

  if (!process.env.SUPABASE_URL) {
    const p = {
      id: 'demo-pay-' + Date.now(),
      customer_user_id: req.customer.id,
      customer_name: req.customer.customer_name,
      sales_order_id, so_no, method,
      amount: parseFloat(amount),
      slip_url, bank_ref, notes,
      status: 'pending',
      created_at: new Date().toISOString()
    };
    DEMO_PAYMENTS.push(p);
    return res.status(201).json(p);
  }

  const { data, error } = await supabase
    .from('portal_payments')
    .insert({
      customer_user_id: req.customer.id,
      customer_name: req.customer.customer_name,
      sales_order_id: sales_order_id || null,
      so_no, method,
      amount: parseFloat(amount),
      slip_url, bank_ref, notes,
      status: 'pending'
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// GET /api/customer-portal/my-account
router.get('/my-account', requireCustomerAuth, async (req, res) => {
  if (!process.env.SUPABASE_URL) {
    return res.json({ id: req.customer.id, username: req.customer.username, display_name: req.customer.display_name, customer_name: req.customer.customer_name, linked_customer: null });
  }
  const { data: cu } = await supabase
    .from('customer_users')
    .select('id, username, display_name, customer_name, linked_customer_id')
    .eq('id', req.customer.id).single();
  if (!cu) return res.status(404).json({ error: 'Account not found' });

  let linked_customer = null;
  if (cu.linked_customer_id) {
    const { data: c } = await supabase.from('customers').select('company_name, email, phone, payment_term, credit_limit').eq('id', cu.linked_customer_id).single();
    linked_customer = c || null;
  }

  res.json({ ...cu, linked_customer });
});

// PATCH /api/customer-portal/my-account
router.patch('/my-account', requireCustomerAuth, async (req, res) => {
  const { display_name, current_password, new_password } = req.body;
  if (!process.env.SUPABASE_URL) return res.json({ ok: true });

  const updates = {};
  if (display_name !== undefined) updates.display_name = display_name;

  if (new_password) {
    // Verify current password
    const { data: cu } = await supabase.from('customer_users').select('password_hash').eq('id', req.customer.id).single();
    if (!cu) return res.status(404).json({ error: 'Account not found' });
    const valid = await bcrypt.compare(current_password || '', cu.password_hash);
    if (!valid) return res.status(400).json({ error: 'Current password is incorrect.' });
    updates.password_hash = await bcrypt.hash(new_password, 10);
  }

  if (!Object.keys(updates).length) return res.json({ ok: true });

  const { data, error } = await supabase
    .from('customer_users').update(updates).eq('id', req.customer.id).select('id, username, display_name, customer_name').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/customer-portal/credit-balance
router.get('/credit-balance', requireCustomerAuth, async (req, res) => {
  if (!process.env.SUPABASE_URL) return res.json({ credit_limit: 0, used: 0, available: 0 });

  const { data: cu } = await supabase.from('customer_users').select('linked_customer_id').eq('id', req.customer.id).single();
  if (!cu?.linked_customer_id) return res.json({ credit_limit: 0, used: 0, available: 0 });

  const { data: cust } = await supabase.from('customers').select('credit_limit').eq('id', cu.linked_customer_id).single();
  const credit_limit = parseFloat(cust?.credit_limit || 0);

  // Sum verified credit_limit payments
  const { data: pays } = await supabase
    .from('portal_payments')
    .select('amount')
    .eq('customer_user_id', req.customer.id)
    .eq('method', 'credit_limit')
    .eq('status', 'verified');
  const used = (pays || []).reduce((s, p) => s + parseFloat(p.amount), 0);

  res.json({ credit_limit, used, available: Math.max(0, credit_limit - used) });
});

// ── ADMIN ROUTES ───────────────────────────────────────────────────────────────

// GET /api/customer-portal/admin/products
router.get('/admin/products', requireAdmin, async (req, res) => {
  if (!process.env.SUPABASE_URL) return res.json(DEMO_PRODUCTS);
  const { data, error } = await supabase.from('portal_product_configs').select('*').order('sort_order', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/customer-portal/admin/products
router.post('/admin/products', requireAdmin, async (req, res) => {
  const { name, description, image_url, fields, formula, base_price, currency, active, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!process.env.SUPABASE_URL) {
    const p = { id: 'demo-prod-' + Date.now(), name, description, image_url, fields: fields || [], formula: formula || '', base_price: base_price || 0, currency: currency || 'MYR', active: active !== false, sort_order: sort_order || 0, created_at: new Date().toISOString() };
    DEMO_PRODUCTS.push(p);
    return res.status(201).json(p);
  }
  const { data, error } = await supabase.from('portal_product_configs')
    .insert({ name, description, image_url, fields: fields || [], formula: formula || '', base_price: base_price || 0, currency: currency || 'MYR', active: active !== false, sort_order: sort_order || 0 })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// PATCH /api/customer-portal/admin/products/:id
router.patch('/admin/products/:id', requireAdmin, async (req, res) => {
  const allowed = ['name','description','image_url','fields','formula','base_price','currency','active','sort_order'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if (!process.env.SUPABASE_URL) {
    const p = DEMO_PRODUCTS.find(x => x.id === req.params.id);
    if (p) Object.assign(p, updates);
    return res.json(p || {});
  }
  const { data, error } = await supabase.from('portal_product_configs').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/customer-portal/admin/products/:id
router.delete('/admin/products/:id', requireAdmin, async (req, res) => {
  if (!process.env.SUPABASE_URL) {
    const idx = DEMO_PRODUCTS.findIndex(x => x.id === req.params.id);
    if (idx !== -1) DEMO_PRODUCTS.splice(idx, 1);
    return res.json({ ok: true });
  }
  const { error } = await supabase.from('portal_product_configs').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// GET /api/customer-portal/admin/requests — portal quote requests for admin
router.get('/admin/requests', requireAdmin, async (req, res) => {
  if (!process.env.SUPABASE_URL) return res.json(DEMO_REQUESTS);
  const { status } = req.query;
  let query = supabase.from('portal_quote_requests').select('*').order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PATCH /api/customer-portal/admin/requests/:id
router.patch('/admin/requests/:id', requireAdmin, async (req, res) => {
  const allowed = ['status', 'quotation_id'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  updates.updated_at = new Date().toISOString();
  if (!process.env.SUPABASE_URL) {
    const r = DEMO_REQUESTS.find(x => x.id === req.params.id);
    if (r) Object.assign(r, updates);
    return res.json(r || {});
  }
  const { data, error } = await supabase.from('portal_quote_requests').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/customer-portal/admin/payments — payments for admin review
router.get('/admin/payments', requireAdmin, async (req, res) => {
  if (!process.env.SUPABASE_URL) return res.json(DEMO_PAYMENTS);
  const { status } = req.query;
  let query = supabase.from('portal_payments').select('*').order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PATCH /api/customer-portal/admin/payments/:id — verify or reject
router.patch('/admin/payments/:id', requireAdmin, async (req, res) => {
  const { status } = req.body;
  if (!['verified','rejected'].includes(status)) return res.status(400).json({ error: 'status must be verified or rejected' });
  if (!process.env.SUPABASE_URL) {
    const p = DEMO_PAYMENTS.find(x => x.id === req.params.id);
    if (p) { p.status = status; p.reviewed_at = new Date().toISOString(); }
    return res.json(p || {});
  }
  const { data, error } = await supabase
    .from('portal_payments')
    .update({ status, reviewed_by: req.user.id, reviewed_at: new Date().toISOString() })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PATCH /api/customer-portal/admin/accounts/:id/link — link customer_user to customers.id
router.patch('/admin/accounts/:id/link', requireAdmin, async (req, res) => {
  const { linked_customer_id } = req.body;
  if (!process.env.SUPABASE_URL) return res.json({ ok: true });
  const { data, error } = await supabase
    .from('customer_users').update({ linked_customer_id }).eq('id', req.params.id)
    .select('id, username, display_name, customer_name, linked_customer_id').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
