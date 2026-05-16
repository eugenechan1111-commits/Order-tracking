const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const supabase = require('../lib/supabase');
const { signCustomerToken, requireAdmin } = require('../lib/auth');

// Demo customer accounts (no Supabase)
const DEMO_CUSTOMERS = [
  { id: 'demo-cu-1', username: 'picktenants', password: 'demo123', customer_name: 'PICKTENANTS', display_name: 'PickTenants', active: true, created_at: new Date().toISOString() },
];

// POST /api/customer-auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  if (!process.env.SUPABASE_URL) {
    const cu = DEMO_CUSTOMERS.find(c => c.username === username.trim());
    if (!cu || cu.password !== password) return res.status(401).json({ error: 'Invalid username or password' });
    if (!cu.active) return res.status(403).json({ error: 'Account is disabled. Please contact us.' });
    const token = signCustomerToken(cu);
    return res.json({ token, display_name: cu.display_name, customer_name: cu.customer_name });
  }

  const { data: cu, error } = await supabase
    .from('customer_users').select('*').eq('username', username.trim()).single();
  if (error || !cu) return res.status(401).json({ error: 'Invalid username or password' });
  if (!cu.active) return res.status(403).json({ error: 'Account is disabled. Please contact us.' });
  const valid = await bcrypt.compare(password, cu.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid username or password' });
  const token = signCustomerToken(cu);
  res.json({ token, display_name: cu.display_name || cu.username, customer_name: cu.customer_name });
});

// GET /api/customer-auth/accounts — admin lists customer accounts
router.get('/accounts', requireAdmin, async (req, res) => {
  if (!process.env.SUPABASE_URL) {
    return res.json(DEMO_CUSTOMERS.map(({ password, ...c }) => c));
  }
  const { data, error } = await supabase
    .from('customer_users')
    .select('id, username, display_name, customer_name, active, created_at')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/customer-auth/accounts — admin creates customer account
router.post('/accounts', requireAdmin, async (req, res) => {
  const { username, password, customer_name, display_name } = req.body;
  if (!username || !password || !customer_name)
    return res.status(400).json({ error: 'Username, password and customer name are required' });

  if (!process.env.SUPABASE_URL) {
    const existing = DEMO_CUSTOMERS.find(c => c.username === username.trim());
    if (existing) return res.status(409).json({ error: 'Username already exists' });
    const cu = { id: 'demo-cu-' + Date.now(), username: username.trim(), password, customer_name: customer_name.trim(), display_name: display_name || username, active: true, created_at: new Date().toISOString() };
    DEMO_CUSTOMERS.push(cu);
    const { password: _, ...safe } = cu;
    return res.status(201).json(safe);
  }

  const password_hash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase
    .from('customer_users')
    .insert({ username: username.trim(), password_hash, customer_name: customer_name.trim(), display_name: display_name || username, active: true })
    .select('id, username, display_name, customer_name, active, created_at').single();
  if (error) return res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'Username already exists' : error.message });
  res.status(201).json(data);
});

// PATCH /api/customer-auth/accounts/:id — admin updates customer account
router.patch('/accounts/:id', requireAdmin, async (req, res) => {
  const { password, display_name, customer_name, active } = req.body;

  if (!process.env.SUPABASE_URL) {
    const cu = DEMO_CUSTOMERS.find(c => c.id === req.params.id);
    if (!cu) return res.status(404).json({ error: 'Not found' });
    if (display_name !== undefined) cu.display_name = display_name;
    if (customer_name !== undefined) cu.customer_name = customer_name;
    if (active !== undefined) cu.active = active;
    if (password) cu.password = password;
    const { password: _, ...safe } = cu;
    return res.json(safe);
  }

  const updates = {};
  if (display_name !== undefined) updates.display_name = display_name;
  if (customer_name !== undefined) updates.customer_name = customer_name;
  if (active !== undefined) updates.active = active;
  if (password) updates.password_hash = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from('customer_users').update(updates).eq('id', req.params.id)
    .select('id, username, display_name, customer_name, active, created_at').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/customer-auth/accounts/:id — admin deletes customer account
router.delete('/accounts/:id', requireAdmin, async (req, res) => {
  if (!process.env.SUPABASE_URL) {
    const idx = DEMO_CUSTOMERS.findIndex(c => c.id === req.params.id);
    if (idx !== -1) DEMO_CUSTOMERS.splice(idx, 1);
    return res.json({ ok: true });
  }
  const { error } = await supabase.from('customer_users').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
