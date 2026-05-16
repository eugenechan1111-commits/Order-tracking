const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { nextDocNo } = require('../lib/doc-number');

const WORKSTATIONS = ['Cut', 'Edge', 'Boring', 'Cut-Curve', 'Edge-Curve', 'Assembly', 'Packing'];

// Admin task queue — SOs with overdue next_action
router.get('/task-queue', requireAuth, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const { entity } = req.query;
  let query = supabase.from('sales_orders')
    .select('*, customers(company_name, phone)')
    .not('next_action', 'is', null)
    .lte('next_action_due', today)
    .not('status', 'in', '("delivered","paid","cancelled")')
    .order('next_action_due', { ascending: true });
  if (entity) query = query.eq('entity', entity);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/', requireAuth, async (req, res) => {
  const { status, customer_id, entity } = req.query;
  let query = supabase.from('sales_orders')
    .select('*, customers(company_name, phone, email)')
    .order('created_at', { ascending: false });
  if (status) {
    const statuses = status.split(',');
    if (statuses.length > 1) query = query.in('status', statuses);
    else query = query.eq('status', status);
  }
  if (customer_id) query = query.eq('customer_id', customer_id);
  if (entity) query = query.eq('entity', entity);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('sales_orders')
    .select('*, customers(*), quotations(quote_no)').eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: 'Not found' });
  res.json(data);
});

router.post('/', requireAuth, async (req, res) => {
  const { customer_id, quotation_id, items, subtotal, discount, total_amount,
    payment_term, delivery_date, delivery_type, delivery_address, notes, entity } = req.body;
  if (!customer_id) return res.status(400).json({ error: 'customer_id required' });
  if (!items || !items.length) return res.status(400).json({ error: 'items required' });

  const { data: customer } = await supabase.from('customers').select('payment_term').eq('id', customer_id).single();
  const pterm = payment_term || customer?.payment_term || 'cash';
  const deposit = pterm === 'cash' ? 0 : parseFloat(((total_amount || 0) * 0.5).toFixed(2));

  const so_no = await nextDocNo('SO');
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase.from('sales_orders')
    .insert({
      so_no, customer_id, quotation_id, items, subtotal: subtotal || 0,
      discount: discount || 0, total_amount: total_amount || 0,
      payment_term: pterm, deposit_amount: deposit,
      status: 'draft',
      next_action: 'Confirm order', next_action_due: today,
      delivery_date, delivery_type: delivery_type || 'delivery',
      delivery_address, notes, created_by: req.user.id,
      entity: entity || 'AOSB'
    })
    .select('*, customers(company_name)').single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.patch('/:id', requireAuth, async (req, res) => {
  const allowed = ['items','subtotal','discount','total_amount','status','payment_term',
    'deposit_amount','delivery_date','delivery_type','delivery_address','notes',
    'next_action','next_action_due','entity'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));

  // Auto-set next_action when status changes
  if (updates.status) {
    const today = new Date().toISOString().split('T')[0];
    const actionMap = {
      confirmed:     { action: 'Create purchase order',    due: today },
      in_production: { action: 'Follow production progress', due: today },
      ready:         { action: 'Schedule delivery',         due: today },
      delivered:     { action: 'Send invoice',              due: today },
      invoiced:      { action: 'Follow up payment',         due: null },
      paid:          { action: null,                        due: null },
    };
    if (actionMap[updates.status]) {
      const { action, due } = actionMap[updates.status];
      updates.next_action = action;
      updates.next_action_due = due;
    }
  }

  const { data, error } = await supabase.from('sales_orders')
    .update(updates).eq('id', req.params.id).select('*, customers(company_name)').single();
  if (error) return res.status(500).json({ error: error.message });

  // Auto-create Job Order when confirmed
  if (updates.status === 'confirmed') {
    await _maybeCreateJobOrder(data, req.user.id);
  }

  res.json(data);
});

// Record deposit payment
router.post('/:id/deposit', requireAuth, async (req, res) => {
  const { amount, note } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'amount required' });

  const { data: so } = await supabase.from('sales_orders').select('*').eq('id', req.params.id).single();
  if (!so) return res.status(404).json({ error: 'Not found' });

  const today = new Date().toISOString().split('T')[0];
  const updates = {
    deposit_paid_at: new Date().toISOString(),
    status: 'confirmed',
    next_action: 'Create purchase order',
    next_action_due: today,
    notes: so.notes ? `${so.notes}\nDeposit: ${note || ''}` : (note || '')
  };

  const { data, error } = await supabase.from('sales_orders')
    .update(updates).eq('id', req.params.id).select('*, customers(company_name)').single();
  if (error) return res.status(500).json({ error: error.message });

  await _maybeCreateJobOrder(data, req.user.id);
  res.json(data);
});

// Convert SO → Job Order manually (in case auto-create failed)
router.post('/:id/create-job-order', requireAdmin, async (req, res) => {
  const { data: so } = await supabase.from('sales_orders')
    .select('*, customers(company_name)').eq('id', req.params.id).single();
  if (!so) return res.status(404).json({ error: 'Not found' });
  if (so.job_order_id) return res.status(400).json({ error: 'Job order already exists' });

  const jo = await _createJobOrder(so, req.user.id);
  if (jo.error) return res.status(500).json({ error: jo.error });
  res.status(201).json(jo);
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const { error } = await supabase.from('sales_orders').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

async function _maybeCreateJobOrder(so, userId) {
  if (so.job_order_id) return; // already created
  if (so.payment_term !== 'cash' && !so.deposit_paid_at) return; // deposit gate

  // Check if all items have supplier = ADSB (or no supplier = assume ADSB)
  const hasAdsbItems = so.items && so.items.some(i => !i.supplier || i.supplier === 'ADSB');
  if (!hasAdsbItems) return;

  await _createJobOrder(so, userId);
}

async function _createJobOrder(so, userId) {
  try {
    const order_no = await nextDocNo('JO');
    const customer = so.customers?.company_name || '';
    const totalQty = so.items.reduce((s, i) => s + (parseInt(i.qty) || parseInt(i.quantity) || 0), 0);
    const firstProduct = so.items[0]?.product || so.items[0]?.name || 'Product';
    const productSummary = so.items.length > 1 ? `${firstProduct} (+${so.items.length - 1} more)` : firstProduct;

    const { data: order, error: orderErr } = await supabase.from('orders')
      .insert({
        order_no, customer, product: productSummary, quantity: totalQty,
        items: so.items, workstations: WORKSTATIONS,
        due_date: so.delivery_date || new Date().toISOString().split('T')[0],
        urgent: false, hidden: false, delete_requested: false,
        sales_order_id: so.id
      })
      .select().single();
    if (orderErr) return { error: orderErr.message };

    const { error: woErr } = await supabase.from('work_orders').insert(
      WORKSTATIONS.map(ws => ({ order_id: order.id, workstation: ws, target_qty: totalQty }))
    );
    if (woErr) return { error: woErr.message };

    // Link job order back to SO
    await supabase.from('sales_orders').update({ job_order_id: order.id }).eq('id', so.id);

    // Update SO next_action
    await supabase.from('sales_orders').update({
      next_action: 'Follow production progress',
      next_action_due: new Date().toISOString().split('T')[0]
    }).eq('id', so.id);

    return order;
  } catch (e) {
    return { error: e.message };
  }
}

module.exports = router;
