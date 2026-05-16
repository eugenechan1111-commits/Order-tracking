const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth, requireAdmin } = require('../lib/auth');

// List all BOM entries (optionally filtered by product)
router.get('/', requireAuth, async (req, res) => {
  const { product_name } = req.query;
  let query = supabase.from('bom')
    .select('*, materials(*, inventory(*))')
    .order('product_name')
    .order('created_at');
  if (product_name) query = query.eq('product_name', product_name);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// List distinct product names in BOM
router.get('/products', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('bom').select('product_name');
  if (error) return res.status(500).json({ error: error.message });
  const names = [...new Set((data || []).map(r => r.product_name))].sort();
  res.json(names);
});

// Material availability check for a given set of items
router.post('/check', requireAuth, async (req, res) => {
  const { items } = req.body; // [{product, qty}]
  if (!items?.length) return res.status(400).json({ error: 'items required' });

  const productNames = [...new Set(items.map(i => i.product_name || i.product || '').filter(Boolean))];
  if (!productNames.length) return res.json({ results: [], all_sufficient: true, has_bom: false });

  const { data: bomEntries } = await supabase.from('bom')
    .select('*, materials(*, inventory(*))')
    .in('product_name', productNames);

  if (!bomEntries?.length) return res.json({ results: [], all_sufficient: true, has_bom: false });

  const requirements = {};
  for (const item of items) {
    const qty = parseFloat(item.qty || item.quantity || 1);
    const prodName = item.product_name || item.product;
    const entries = bomEntries.filter(b => b.product_name === prodName);
    for (const entry of entries) {
      const mid = entry.material_id;
      if (!requirements[mid]) requirements[mid] = { material: entry.materials, required: 0 };
      requirements[mid].required += entry.quantity_per_unit * qty;
    }
  }

  const results = Object.values(requirements).map(r => {
    const inv = r.material?.inventory?.[0];
    const onHand = parseFloat(inv?.qty_on_hand || 0);
    const required = r.required;
    return {
      material_id: r.material?.id,
      material_code: r.material?.code,
      material_name: r.material?.name,
      unit: r.material?.unit,
      required: +required.toFixed(4),
      on_hand: onHand,
      shortfall: +(Math.max(0, required - onHand)).toFixed(4),
      sufficient: onHand >= required
    };
  });

  res.json({ results, all_sufficient: results.every(r => r.sufficient), has_bom: true });
});

// Cut list generator
router.post('/cutlist', requireAuth, async (req, res) => {
  const { items, sheet_length = 2440, sheet_width = 1220 } = req.body;
  if (!items?.length) return res.status(400).json({ error: 'items required' });

  const productNames = [...new Set(items.map(i => i.product_name || i.product || '').filter(Boolean))];
  const { data: bomEntries } = await supabase.from('bom')
    .select('*, materials(*)')
    .in('product_name', productNames)
    .not('cut_length', 'is', null);

  if (!bomEntries?.length) return res.json({ cutlist: [], message: 'No panel BOM entries found' });

  const groups = {};
  for (const item of items) {
    const qty = parseFloat(item.qty || item.quantity || 1);
    const prodName = item.product_name || item.product;
    const entries = bomEntries.filter(b => b.product_name === prodName && b.cut_length);
    for (const entry of entries) {
      const key = entry.material_id;
      if (!groups[key]) groups[key] = { material: entry.materials, cuts: [] };
      const pcs = Math.ceil(entry.quantity_per_unit * qty);
      groups[key].cuts.push({
        label: `${prodName}${entry.notes ? ' — ' + entry.notes : ''}`,
        length: entry.cut_length,
        width: entry.cut_width,
        thickness: entry.cut_thickness,
        pcs
      });
    }
  }

  const sheetL = parseFloat(sheet_length);
  const sheetW = parseFloat(sheet_width);
  const sheetArea = sheetL * sheetW;

  const cutlist = Object.values(groups).map(g => {
    const totalArea = g.cuts.reduce((s, c) => s + c.length * c.width * c.pcs, 0);
    const sheetsNeeded = Math.ceil((totalArea / sheetArea) * 1.15); // 15% waste factor
    return {
      material: { id: g.material.id, code: g.material.code, name: g.material.name, unit: g.material.unit },
      cuts: g.cuts,
      sheets_needed: sheetsNeeded,
      total_area_mm2: Math.round(totalArea),
      sheet_size: `${sheetL}×${sheetW}mm`
    };
  });

  res.json({ cutlist });
});

router.post('/', requireAdmin, async (req, res) => {
  const { product_name, material_id, quantity_per_unit, cut_length, cut_width, cut_thickness, notes } = req.body;
  if (!product_name || !material_id || !quantity_per_unit) {
    return res.status(400).json({ error: 'product_name, material_id, quantity_per_unit required' });
  }
  const { data, error } = await supabase.from('bom')
    .insert({ product_name, material_id, quantity_per_unit: parseFloat(quantity_per_unit),
      cut_length: cut_length || null, cut_width: cut_width || null,
      cut_thickness: cut_thickness || null, notes })
    .select('*, materials(*, inventory(*))').single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.patch('/:id', requireAdmin, async (req, res) => {
  const allowed = ['product_name', 'material_id', 'quantity_per_unit', 'cut_length', 'cut_width', 'cut_thickness', 'notes'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  const { data, error } = await supabase.from('bom')
    .update(updates).eq('id', req.params.id)
    .select('*, materials(*, inventory(*))').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const { error } = await supabase.from('bom').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
