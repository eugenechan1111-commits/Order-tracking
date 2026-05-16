const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth, requireAdmin } = require('../lib/auth');

// GET both entities
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('company_settings').select('*').order('entity_name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/:entity', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('company_settings').select('*').eq('entity_name', req.params.entity.toUpperCase()).single();
  if (error) return res.status(404).json({ error: 'Not found' });
  res.json(data);
});

router.put('/:entity', requireAdmin, async (req, res) => {
  const entity = req.params.entity.toUpperCase();
  const allowed = ['company_name','tin','registration_no','sst_no','address','city','postcode',
    'state','phone','email','bank_name','bank_account','bank_holder','logo_url'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('company_settings')
    .update(updates)
    .eq('entity_name', entity)
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
