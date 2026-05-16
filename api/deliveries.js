const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth, requireAdmin } = require('../lib/auth');

router.get('/', requireAuth, async (req, res) => {
  const { date, status } = req.query;
  let query = supabase.from('deliveries')
    .select('*, sales_orders(so_no, total_amount, items, customers(company_name, phone, address))')
    .order('scheduled_date', { ascending: true });
  if (date) query = query.eq('scheduled_date', date);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('deliveries')
    .select('*, sales_orders(*, customers(*))').eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: 'Not found' });
  res.json(data);
});

router.post('/', requireAuth, async (req, res) => {
  const { sales_order_id, scheduled_date, time_slot, type, driver_name, notes } = req.body;
  if (!sales_order_id || !scheduled_date) return res.status(400).json({ error: 'sales_order_id and scheduled_date required' });

  const { data, error } = await supabase.from('deliveries')
    .insert({
      sales_order_id, scheduled_date, time_slot,
      type: type || 'delivery', driver_name,
      status: 'scheduled', notes, created_by: req.user.id
    })
    .select('*, sales_orders(so_no)').single();
  if (error) return res.status(500).json({ error: error.message });

  // Update SO status
  await supabase.from('sales_orders').update({
    status: 'ready',
    next_action: 'Deliver order',
    next_action_due: scheduled_date
  }).eq('id', sales_order_id);

  res.status(201).json(data);
});

router.patch('/:id', requireAuth, async (req, res) => {
  const allowed = ['scheduled_date','time_slot','type','driver_name','status','notes','delivered_at'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if (updates.status === 'delivered' && !updates.delivered_at) updates.delivered_at = new Date().toISOString();

  const { data, error } = await supabase.from('deliveries')
    .update(updates).eq('id', req.params.id).select('*, sales_orders(so_no, id)').single();
  if (error) return res.status(500).json({ error: error.message });

  // Update SO when delivered
  if (updates.status === 'delivered' && data.sales_orders?.id) {
    await supabase.from('sales_orders').update({
      status: 'delivered',
      next_action: 'Send invoice',
      next_action_due: new Date().toISOString().split('T')[0]
    }).eq('id', data.sales_orders.id);
  }

  res.json(data);
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const { error } = await supabase.from('deliveries').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
