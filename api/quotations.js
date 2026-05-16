const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { nextDocNo } = require('../lib/doc-number');

router.get('/', requireAuth, async (req, res) => {
  const { status, customer_id } = req.query;
  let query = supabase.from('quotations')
    .select('*, customers(company_name, phone, email)')
    .order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  if (customer_id) query = query.eq('customer_id', customer_id);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('quotations')
    .select('*, customers(*)').eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: 'Not found' });
  res.json(data);
});

router.post('/', requireAuth, async (req, res) => {
  const { customer_id, lead_id, items, subtotal, discount, total_amount, valid_until, notes } = req.body;
  if (!customer_id) return res.status(400).json({ error: 'customer_id required' });
  const quote_no = await nextDocNo('QT');
  const { data, error } = await supabase.from('quotations')
    .insert({ quote_no, customer_id, lead_id, items: items || [], subtotal: subtotal || 0,
      discount: discount || 0, total_amount: total_amount || 0, valid_until, notes,
      created_by: req.user.id })
    .select('*, customers(company_name)').single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.patch('/:id', requireAuth, async (req, res) => {
  const allowed = ['items','subtotal','discount','total_amount','status','valid_until','notes','sent_at'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if (updates.status === 'sent' && !updates.sent_at) updates.sent_at = new Date().toISOString();
  const { data, error } = await supabase.from('quotations')
    .update(updates).eq('id', req.params.id).select('*, customers(company_name)').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Convert accepted quotation → Sales Order
router.post('/:id/convert', requireAuth, async (req, res) => {
  const { data: qt, error: qtErr } = await supabase.from('quotations')
    .select('*, customers(*)').eq('id', req.params.id).single();
  if (qtErr || !qt) return res.status(404).json({ error: 'Quotation not found' });
  if (qt.status === 'converted') return res.status(400).json({ error: 'Already converted' });

  const so_no = await nextDocNo('SO');
  const customer = qt.customers;
  const payment_term = customer?.payment_term || 'cash';
  const deposit_amount = payment_term === 'cash' ? 0 : parseFloat((qt.total_amount * 0.5).toFixed(2));

  const { data: so, error: soErr } = await supabase.from('sales_orders')
    .insert({
      so_no, customer_id: qt.customer_id, quotation_id: qt.id,
      items: qt.items, subtotal: qt.subtotal, discount: qt.discount,
      total_amount: qt.total_amount, payment_term, deposit_amount,
      status: payment_term === 'cash' ? 'confirmed' : 'deposit_pending',
      next_action: payment_term === 'cash' ? 'Process production' : 'Collect deposit',
      next_action_due: new Date().toISOString().split('T')[0],
      created_by: req.user.id
    })
    .select().single();
  if (soErr) return res.status(500).json({ error: soErr.message });

  // Mark quotation as accepted
  await supabase.from('quotations').update({ status: 'accepted' }).eq('id', qt.id);
  // Mark lead as converted if linked
  if (qt.lead_id) await supabase.from('leads').update({ status: 'converted' }).eq('id', qt.lead_id);

  res.status(201).json(so);
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const { error } = await supabase.from('quotations').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
