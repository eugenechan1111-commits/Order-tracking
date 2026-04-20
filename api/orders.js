const express = require('express');
const router = express.Router();
const multer = require('multer');
const supabase = require('../lib/supabase');
const { requireAuth, requireAdmin, requireSuperAdmin } = require('../lib/auth');
const { DEMO_ORDERS } = require('../lib/demo-data');

const WORKSTATIONS = ['Cut', 'Edge', 'Boring', 'Cut-Curve', 'Edge-Curve', 'Assembly', 'Packing'];

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.get('/', requireAuth, async (req, res) => {
  const includeHidden = req.query.include_hidden === 'true';
  if (!process.env.SUPABASE_URL) {
    let orders = includeHidden ? DEMO_ORDERS : DEMO_ORDERS.filter(o => !o.hidden);
    return res.json(orders);
  }
  let query = supabase
    .from('orders')
    .select('*, work_orders(id, workstation, status, actual_qty, target_qty, rework_qty)')
    .order('created_at', { ascending: false });
  if (!includeHidden) query = query.eq('hidden', false);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/delete-requests', requireSuperAdmin, async (req, res) => {
  if (!process.env.SUPABASE_URL) {
    return res.json(DEMO_ORDERS.filter(o => o.delete_requested));
  }
  const { data, error } = await supabase.from('orders').select('*').eq('delete_requested', true);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/', requireAuth, async (req, res) => {
  const { order_no, customer, due_date } = req.body;
  let items = req.body.items;
  let workstations = req.body.workstations;

  if (!order_no || !customer || !due_date)
    return res.status(400).json({ error: 'Missing required fields: order_no, customer, due_date' });

  if (typeof items === 'string') items = JSON.parse(items);
  if (typeof workstations === 'string') workstations = JSON.parse(workstations);
  if (!Array.isArray(items) || !items.length)
    return res.status(400).json({ error: 'At least one product is required' });
  if (!Array.isArray(workstations) || !workstations.length)
    return res.status(400).json({ error: 'At least one workstation must be selected' });

  const validItems = items.filter(i => i.product && parseInt(i.quantity) > 0);
  if (!validItems.length)
    return res.status(400).json({ error: 'Each product must have a name and quantity > 0' });

  const totalQty = validItems.reduce((s, i) => s + parseInt(i.quantity), 0);
  const firstProduct = validItems[0].product;
  const productSummary = validItems.length > 1 ? `${firstProduct} (+${validItems.length - 1} more)` : firstProduct;

  if (!process.env.SUPABASE_URL) {
    const demoOrder = {
      id: 'demo-' + Date.now(),
      order_no, customer,
      product: productSummary,
      quantity: totalQty,
      items: validItems,
      workstations,
      attachments: [],
      urgent: false, hidden: false, delete_requested: false,
      due_date, status: 'pending',
      created_at: new Date().toISOString(),
      work_orders: workstations.map(ws => ({
        id: `wo-demo-${Date.now()}-${ws}`,
        workstation: ws, status: 'pending',
        target_qty: totalQty, actual_qty: 0, rework_qty: 0
      }))
    };
    DEMO_ORDERS.unshift(demoOrder);
    return res.status(201).json(demoOrder);
  }

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert({ order_no, customer, product: productSummary, quantity: totalQty, items: validItems, workstations, due_date, urgent: false, hidden: false, delete_requested: false })
    .select().single();
  if (orderErr) return res.status(500).json({ error: orderErr.message });

  const { error: woErr } = await supabase.from('work_orders').insert(
    workstations.map(ws => ({ order_id: order.id, workstation: ws, target_qty: totalQty }))
  );
  if (woErr) return res.status(500).json({ error: woErr.message });

  res.status(201).json(order);
});

router.post('/:id/attachments', requireAuth, upload.array('files', 10), async (req, res) => {
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files uploaded' });

  if (!process.env.SUPABASE_URL) {
    const newAttachments = req.files.map(f => ({
      name: f.originalname, filename: f.originalname, url: null, type: f.mimetype, size: f.size
    }));
    return res.json({ attachments: newAttachments });
  }

  const orderId = req.params.id;
  const newAttachments = [];

  for (const f of req.files) {
    const safe = f.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${orderId}/${Date.now()}_${safe}`;
    const { error: upErr } = await supabase.storage
      .from('order-attachments')
      .upload(storagePath, f.buffer, { contentType: f.mimetype, upsert: false });
    if (upErr) return res.status(500).json({ error: `Storage upload failed: ${upErr.message}` });

    const { data: urlData } = supabase.storage.from('order-attachments').getPublicUrl(storagePath);
    newAttachments.push({
      name: f.originalname,
      filename: safe,
      url: urlData.publicUrl,
      type: f.mimetype,
      size: f.size
    });
  }

  const { data: order } = await supabase.from('orders').select('attachments').eq('id', orderId).single();
  const updated = [...(order?.attachments || []), ...newAttachments];
  const { error: dbErr } = await supabase.from('orders').update({ attachments: updated }).eq('id', orderId);
  if (dbErr) return res.status(500).json({ error: dbErr.message });
  res.json({ attachments: updated });
});

// Toggle urgent
router.post('/:id/urgent', requireAdmin, async (req, res) => {
  if (!process.env.SUPABASE_URL) {
    const o = DEMO_ORDERS.find(x => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'Not found' });
    o.urgent = !o.urgent;
    return res.json(o);
  }
  const { data: cur } = await supabase.from('orders').select('urgent').eq('id', req.params.id).single();
  const { data, error } = await supabase.from('orders').update({ urgent: !cur?.urgent }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Hide order
router.post('/:id/hide', requireAdmin, async (req, res) => {
  if (!process.env.SUPABASE_URL) {
    const o = DEMO_ORDERS.find(x => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'Not found' });
    o.hidden = true;
    return res.json(o);
  }
  const { data, error } = await supabase.from('orders').update({ hidden: true }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Request delete (admin) or approve delete (super_admin via ?approve=true)
router.post('/:id/request-delete', requireAdmin, async (req, res) => {
  if (!process.env.SUPABASE_URL) {
    const o = DEMO_ORDERS.find(x => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'Not found' });
    o.delete_requested = true;
    return res.json(o);
  }
  const { data, error } = await supabase.from('orders').update({ delete_requested: true }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/:id/reject-delete', requireSuperAdmin, async (req, res) => {
  if (!process.env.SUPABASE_URL) {
    const o = DEMO_ORDERS.find(x => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'Not found' });
    o.delete_requested = false;
    return res.json(o);
  }
  const { data, error } = await supabase.from('orders').update({ delete_requested: false }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.patch('/:id', requireAuth, async (req, res) => {
  const updates = req.body;
  if (updates.status === 'done' && !updates.shipped_at) updates.shipped_at = new Date().toISOString();
  if (!process.env.SUPABASE_URL) {
    const o = DEMO_ORDERS.find(x => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'Not found' });
    Object.assign(o, updates);
    return res.json(o);
  }
  const { data, error } = await supabase.from('orders').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Super admin direct delete, or approve a delete request
router.delete('/:id', requireSuperAdmin, async (req, res) => {
  if (!process.env.SUPABASE_URL) {
    const idx = DEMO_ORDERS.findIndex(x => x.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    DEMO_ORDERS.splice(idx, 1);
    return res.json({ ok: true });
  }
  const { error } = await supabase.from('orders').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
