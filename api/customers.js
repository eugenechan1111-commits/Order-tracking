const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth, requireAdmin } = require('../lib/auth');

router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('customers').select('*').order('company_name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('customers').select('*').eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: 'Not found' });
  res.json(data);
});

router.post('/', requireAdmin, async (req, res) => {
  const { company_name, contact_person, phone, email, billing_email, address, payment_term, credit_limit, notes } = req.body;
  if (!company_name) return res.status(400).json({ error: 'company_name is required' });
  const { data, error } = await supabase
    .from('customers')
    .insert({ company_name, contact_person, phone, email, billing_email, address,
      payment_term: payment_term || 'cash', credit_limit: credit_limit || 0, notes,
      created_by: req.user.id })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.patch('/:id', requireAdmin, async (req, res) => {
  const allowed = ['company_name','contact_person','phone','email','billing_email','address','payment_term','credit_limit','notes',
    'tin','registration_no','sst_no','billing_address','billing_city','billing_postcode','billing_state','sql_account_code'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  const { data, error } = await supabase
    .from('customers').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const { error } = await supabase.from('customers').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
