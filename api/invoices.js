const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { nextDocNo } = require('../lib/doc-number');

router.get('/', requireAuth, async (req, res) => {
  const { status, customer_id, entity } = req.query;
  let query = supabase.from('invoices')
    .select('*, customers(company_name, billing_email), sales_orders(so_no)')
    .order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  if (customer_id) query = query.eq('customer_id', customer_id);
  if (entity) query = query.eq('entity', entity);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('invoices')
    .select('*, customers(*), sales_orders(so_no, items)').eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: 'Not found' });
  res.json(data);
});

router.post('/', requireAuth, async (req, res) => {
  const { sales_order_id, customer_id, amount, payment_term, due_date, notes,
    entity, subtotal, tax_rate, tax_amount, tax_code, line_items } = req.body;
  if (!customer_id || !amount) return res.status(400).json({ error: 'customer_id and amount required' });

  const invoice_no = await nextDocNo('INV');
  const { data, error } = await supabase.from('invoices')
    .insert({
      invoice_no, sales_order_id, customer_id, amount,
      amount_paid: 0, payment_term: payment_term || 'net30',
      due_date, status: 'draft', notes, created_by: req.user.id,
      entity: entity || 'AOSB',
      subtotal: subtotal || amount,
      tax_rate: tax_rate || 0,
      tax_amount: tax_amount || 0,
      tax_code: tax_code || 'NA',
      line_items: line_items || []
    })
    .select('*, customers(company_name)').single();
  if (error) return res.status(500).json({ error: error.message });

  // Update SO next_action if linked
  if (sales_order_id) {
    await supabase.from('sales_orders').update({ status: 'invoiced', next_action: 'Follow up payment', next_action_due: due_date })
      .eq('id', sales_order_id);
  }

  res.status(201).json(data);
});

router.patch('/:id', requireAuth, async (req, res) => {
  const allowed = ['amount','payment_term','due_date','status','notes','sent_at',
    'entity','subtotal','tax_rate','tax_amount','tax_code','line_items','customer_id','sales_order_id'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if (updates.status === 'sent' && !updates.sent_at) updates.sent_at = new Date().toISOString();
  const { data, error } = await supabase.from('invoices')
    .update(updates).eq('id', req.params.id).select('*, customers(company_name)').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Record payment
router.post('/:id/payment', requireAuth, async (req, res) => {
  const { amount, note } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'amount required' });

  const { data: inv } = await supabase.from('invoices').select('*').eq('id', req.params.id).single();
  if (!inv) return res.status(404).json({ error: 'Not found' });

  const newPaid = (inv.amount_paid || 0) + parseFloat(amount);
  const newStatus = newPaid >= inv.amount ? 'paid' : 'partial';
  const updates = {
    amount_paid: newPaid, status: newStatus,
    paid_at: newStatus === 'paid' ? new Date().toISOString() : inv.paid_at,
    notes: inv.notes ? `${inv.notes}\nPayment: ${note || ''}` : (note || '')
  };

  const { data, error } = await supabase.from('invoices')
    .update(updates).eq('id', req.params.id).select('*, customers(company_name)').single();
  if (error) return res.status(500).json({ error: error.message });

  // Mark SO as paid if invoice fully paid
  if (newStatus === 'paid' && inv.sales_order_id) {
    await supabase.from('sales_orders').update({ status: 'paid', next_action: null, next_action_due: null })
      .eq('id', inv.sales_order_id);
  }

  res.json(data);
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const { error } = await supabase.from('invoices').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
