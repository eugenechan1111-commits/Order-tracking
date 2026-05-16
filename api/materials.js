const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth, requireAdmin } = require('../lib/auth');

// List all materials with inventory
router.get('/', requireAuth, async (req, res) => {
  const { category, low_stock } = req.query;
  let query = supabase.from('materials')
    .select('*, inventory(*)')
    .order('category')
    .order('name');
  if (category) query = query.eq('category', category);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  let result = data;
  if (low_stock === 'true') {
    result = data.filter(m => {
      const inv = m.inventory?.[0];
      return inv && inv.reorder_point > 0 && parseFloat(inv.qty_on_hand) <= parseFloat(inv.reorder_point);
    });
  }
  res.json(result);
});

router.get('/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('materials').select('*, inventory(*)')
    .eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: 'Not found' });
  res.json(data);
});

router.post('/', requireAdmin, async (req, res) => {
  const { code, name, unit, category, unit_cost, notes, qty_on_hand, reorder_point } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'code and name required' });

  const { data: mat, error } = await supabase.from('materials')
    .insert({ code, name, unit: unit || 'pcs', category: category || 'hardware',
      unit_cost: unit_cost || 0, notes })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('inventory').insert({
    material_id: mat.id,
    qty_on_hand: parseFloat(qty_on_hand) || 0,
    reorder_point: parseFloat(reorder_point) || 0
  });

  const { data: full } = await supabase.from('materials')
    .select('*, inventory(*)').eq('id', mat.id).single();
  res.status(201).json(full);
});

router.patch('/:id', requireAdmin, async (req, res) => {
  const matFields = ['code', 'name', 'unit', 'category', 'unit_cost', 'notes'];
  const invFields = ['qty_on_hand', 'qty_reserved', 'reorder_point'];

  const matUpdates = Object.fromEntries(Object.entries(req.body).filter(([k]) => matFields.includes(k)));
  const invUpdates = Object.fromEntries(Object.entries(req.body).filter(([k]) => invFields.includes(k)));

  if (Object.keys(matUpdates).length) {
    const { error } = await supabase.from('materials').update(matUpdates).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
  }
  if (Object.keys(invUpdates).length) {
    await supabase.from('inventory')
      .update({ ...invUpdates, last_updated: new Date().toISOString() })
      .eq('material_id', req.params.id);
  }

  const { data } = await supabase.from('materials')
    .select('*, inventory(*)').eq('id', req.params.id).single();
  res.json(data);
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const { error } = await supabase.from('materials').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Stock In
router.post('/:id/stock-in', requireAuth, async (req, res) => {
  const { qty, reference, notes } = req.body;
  if (!qty || parseFloat(qty) <= 0) return res.status(400).json({ error: 'qty must be positive' });

  const { data: inv } = await supabase.from('inventory')
    .select('*').eq('material_id', req.params.id).single();
  if (!inv) return res.status(404).json({ error: 'Inventory record not found' });

  const newQty = (parseFloat(inv.qty_on_hand) || 0) + parseFloat(qty);
  await Promise.all([
    supabase.from('inventory')
      .update({ qty_on_hand: newQty, last_updated: new Date().toISOString() })
      .eq('material_id', req.params.id),
    supabase.from('inventory_logs').insert({
      material_id: req.params.id, action: 'in', qty: parseFloat(qty),
      reference, notes, created_by: req.user.id
    })
  ]);

  const { data } = await supabase.from('materials')
    .select('*, inventory(*)').eq('id', req.params.id).single();
  res.json(data);
});

// Stock Adjust (set absolute qty)
router.post('/:id/adjust', requireAdmin, async (req, res) => {
  const { qty, notes } = req.body;
  if (qty === undefined || qty === null) return res.status(400).json({ error: 'qty required' });

  const { data: inv } = await supabase.from('inventory')
    .select('*').eq('material_id', req.params.id).single();
  const diff = parseFloat(qty) - (parseFloat(inv?.qty_on_hand) || 0);

  await Promise.all([
    supabase.from('inventory')
      .update({ qty_on_hand: parseFloat(qty), last_updated: new Date().toISOString() })
      .eq('material_id', req.params.id),
    supabase.from('inventory_logs').insert({
      material_id: req.params.id, action: 'adjust', qty: diff,
      notes: notes || `Adjusted to ${qty}`, created_by: req.user.id
    })
  ]);

  const { data } = await supabase.from('materials')
    .select('*, inventory(*)').eq('id', req.params.id).single();
  res.json(data);
});

// Stock logs
router.get('/:id/logs', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('inventory_logs')
    .select('*, users(display_name, username)')
    .eq('material_id', req.params.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
