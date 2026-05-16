const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth, requireAdmin } = require('../lib/auth');

router.get('/', requireAuth, async (req, res) => {
  const { status } = req.query;
  let query = supabase.from('leads')
    .select('*, customers(company_name, phone, email)')
    .order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/', requireAuth, async (req, res) => {
  const { customer_id, customer_name, source, notes, assigned_to } = req.body;
  const { data, error } = await supabase
    .from('leads')
    .insert({ customer_id, customer_name, source: source || 'whatsapp', notes, assigned_to: assigned_to || req.user.id })
    .select('*, customers(company_name)').single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.patch('/:id', requireAuth, async (req, res) => {
  const allowed = ['customer_id','customer_name','source','status','notes','assigned_to'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  const { data, error } = await supabase
    .from('leads').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const { error } = await supabase.from('leads').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
