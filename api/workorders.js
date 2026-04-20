const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../lib/auth');
const { DEMO_WORK_ORDERS } = require('../lib/demo-data');

router.get('/', requireAuth, async (req, res) => {
  if (!process.env.SUPABASE_URL) {
    const { workstation, status } = req.query;
    let list = DEMO_WORK_ORDERS;
    if (workstation) list = list.filter(w => w.workstation === workstation);
    if (status) { const statuses = status.split(','); list = list.filter(w => statuses.includes(w.status)); }
    return res.json(list);
  }
  const { workstation, status } = req.query;
  let query = supabase
    .from('work_orders')
    .select('*, orders(order_no, customer, product, quantity, due_date, status, urgent, attachments)')
    .order('created_at', { ascending: true });
  if (workstation) query = query.eq('workstation', workstation);
  if (status) {
    const statuses = status.split(',');
    query = statuses.length > 1 ? query.in('status', statuses) : query.eq('status', statuses[0]);
  }
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

function demoFindWO(id) {
  return DEMO_WORK_ORDERS.find(w => w.id === id);
}

router.post('/:id/start', requireAuth, async (req, res) => {
  const { worker_name } = req.body;
  if (!process.env.SUPABASE_URL) {
    const wo = demoFindWO(req.params.id);
    if (!wo) return res.status(404).json({ error: 'Not found' });
    Object.assign(wo, { status: 'in_progress', worker_name, started_at: new Date().toISOString() });
    return res.json(wo);
  }
  const { data, error } = await supabase
    .from('work_orders')
    .update({ status: 'in_progress', worker_name, started_at: new Date().toISOString() })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await supabase.from('work_logs').insert({ work_order_id: req.params.id, action: 'start', worker_name });
  await supabase.from('orders').update({ status: 'in_progress' }).eq('id', data.order_id).eq('status', 'pending');
  res.json(data);
});

router.post('/:id/pause', requireAuth, async (req, res) => {
  const { worker_name, note, actual_qty } = req.body;
  if (!process.env.SUPABASE_URL) {
    const wo = demoFindWO(req.params.id);
    if (!wo) return res.status(404).json({ error: 'Not found' });
    wo.status = 'paused';
    if (actual_qty != null && actual_qty >= 0) wo.actual_qty = actual_qty;
    return res.json(wo);
  }
  const updates = { status: 'paused' };
  if (actual_qty != null && actual_qty >= 0) updates.actual_qty = actual_qty;
  const { data, error } = await supabase
    .from('work_orders').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await supabase.from('work_logs').insert({ work_order_id: req.params.id, action: 'pause', worker_name, note });
  res.json(data);
});

router.post('/:id/resume', requireAuth, async (req, res) => {
  const { worker_name } = req.body;
  if (!process.env.SUPABASE_URL) {
    const wo = demoFindWO(req.params.id);
    if (!wo) return res.status(404).json({ error: 'Not found' });
    wo.status = 'in_progress';
    return res.json(wo);
  }
  const { data, error } = await supabase
    .from('work_orders').update({ status: 'in_progress' }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await supabase.from('work_logs').insert({ work_order_id: req.params.id, action: 'resume', worker_name });
  res.json(data);
});

// Complete — only allowed when actual_qty >= target_qty
router.post('/:id/complete', requireAuth, async (req, res) => {
  const { worker_name, actual_qty, note } = req.body;

  if (!process.env.SUPABASE_URL) {
    const wo = demoFindWO(req.params.id);
    if (!wo) return res.status(404).json({ error: 'Not found' });
    if (actual_qty < wo.target_qty) return res.status(400).json({ error: `Cannot complete: need ${wo.target_qty - actual_qty} more units.`, shortfall: wo.target_qty - actual_qty });
    Object.assign(wo, { status: 'completed', actual_qty, completed_at: new Date().toISOString() });
    return res.json(wo);
  }

  const { data: current, error: fetchErr } = await supabase
    .from('work_orders').select('target_qty, order_id').eq('id', req.params.id).single();
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });

  if (actual_qty < current.target_qty) {
    return res.status(400).json({
      error: `Cannot complete: actual qty (${actual_qty}) is less than target (${current.target_qty}). Need ${current.target_qty - actual_qty} more units.`,
      shortfall: current.target_qty - actual_qty
    });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('work_orders')
    .update({ status: 'completed', actual_qty, completed_at: now })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('work_logs').insert({ work_order_id: req.params.id, action: 'complete', worker_name, note, qty: actual_qty });

  const { data: siblings } = await supabase.from('work_orders').select('status').eq('order_id', data.order_id);
  if (siblings && siblings.every(w => w.status === 'completed')) {
    await supabase.from('orders').update({ status: 'ready' }).eq('id', data.order_id).in('status', ['pending', 'in_progress']);
  }
  res.json(data);
});

// Reject — records defective/rejected qty, OEE quality tracks this permanently
router.post('/:id/rework', requireAuth, async (req, res) => {
  const { worker_name, rework_qty, note } = req.body;
  if (!rework_qty || rework_qty <= 0) return res.status(400).json({ error: 'Reject quantity must be greater than 0' });
  if (!note) return res.status(400).json({ error: 'Reason is required' });

  if (!process.env.SUPABASE_URL) {
    const wo = demoFindWO(req.params.id);
    if (!wo) return res.status(404).json({ error: 'Not found' });
    wo.rework_qty = (wo.rework_qty || 0) + rework_qty;
    wo.actual_qty = (wo.actual_qty || 0) + rework_qty; // defective units still count as produced
    wo.status = 'paused';
    return res.json(wo);
  }

  const { data: current, error: fetchErr } = await supabase
    .from('work_orders').select('rework_qty, actual_qty').eq('id', req.params.id).single();
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });

  const newReworkQty = (current?.rework_qty || 0) + rework_qty;
  const newActualQty = (current?.actual_qty || 0) + rework_qty; // defective units still count as produced
  const { data, error } = await supabase
    .from('work_orders').update({ rework_qty: newReworkQty, actual_qty: newActualQty, status: 'paused' }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('work_logs').insert({ work_order_id: req.params.id, action: 'reject', worker_name, note, qty: rework_qty });
  res.json(data);
});

// Rework-done — worker fixed rejected pieces; reduces rework_qty
router.post('/:id/rework-done', requireAuth, async (req, res) => {
  const { worker_name, qty, note } = req.body;
  if (!qty || qty <= 0) return res.status(400).json({ error: 'Quantity must be greater than 0' });

  if (!process.env.SUPABASE_URL) {
    const wo = demoFindWO(req.params.id);
    if (!wo) return res.status(404).json({ error: 'Not found' });
    wo.rework_qty = Math.max(0, (wo.rework_qty || 0) - qty);
    wo.actual_qty = (wo.actual_qty || 0) + qty;
    return res.json(wo);
  }

  const { data: current, error: fetchErr } = await supabase
    .from('work_orders').select('rework_qty, actual_qty').eq('id', req.params.id).single();
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });

  const newReworkQty = Math.max(0, (current?.rework_qty || 0) - qty);
  const newActualQty = (current?.actual_qty || 0) + qty;
  const { data, error } = await supabase
    .from('work_orders').update({ rework_qty: newReworkQty, actual_qty: newActualQty }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('work_logs').insert({ work_order_id: req.params.id, action: 'rework_done', worker_name, note: note || '', qty });
  res.json(data);
});

module.exports = router;
