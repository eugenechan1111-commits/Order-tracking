const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const supabase = require('../lib/supabase');
const { signToken, requireAuth, requireAdmin } = require('../lib/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  // Dev mode: no Supabase configured — allow demo logins
  if (!process.env.SUPABASE_URL) {
    const demoUsers = { admin: { password: 'admin123', role: 'admin', display_name: 'Admin (Demo)' }, worker: { password: 'worker123', role: 'worker', display_name: 'Worker (Demo)' }, boss: { password: 'boss123', role: 'super_admin', display_name: 'Boss (Demo)' } };
    const demo = demoUsers[username];
    if (!demo || demo.password !== password) return res.status(401).json({ error: 'Demo mode: use admin/admin123 or worker/worker123' });
    const token = signToken({ id: 'demo', username, role: demo.role, display_name: demo.display_name });
    return res.json({ token, role: demo.role, username, display_name: demo.display_name });
  }

  const { data: user, error } = await supabase
    .from('users').select('*').eq('username', username.trim()).single();

  if (error || !user) return res.status(401).json({ error: 'Invalid username or password' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid username or password' });

  const token = signToken(user);
  res.json({ token, role: user.role, username: user.username, display_name: user.display_name });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => res.json(req.user));

// GET /api/auth/users — admin only
router.get('/users', requireAdmin, async (req, res) => {
  if (!process.env.SUPABASE_URL) return res.json([
    { id: 'demo-1', username: 'admin', role: 'admin', display_name: 'Admin (Demo)', created_at: new Date().toISOString() },
    { id: 'demo-2', username: 'boss', role: 'super_admin', display_name: 'Boss (Demo)', created_at: new Date().toISOString() },
    { id: 'demo-3', username: 'worker', role: 'worker', display_name: 'Worker (Demo)', created_at: new Date().toISOString() }
  ]);
  const { data, error } = await supabase
    .from('users').select('id, username, role, display_name, created_at').order('created_at');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/auth/users — admin creates user
router.post('/users', requireAdmin, async (req, res) => {
  const { username, password, role, display_name } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const password_hash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase
    .from('users')
    .insert({ username: username.trim(), password_hash, role: role || 'worker', display_name: display_name || username })
    .select('id, username, role, display_name, created_at').single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// PATCH /api/auth/users/:id — admin updates user (password or display_name)
router.patch('/users/:id', requireAdmin, async (req, res) => {
  const { password, display_name, role } = req.body;
  const updates = {};
  if (display_name) updates.display_name = display_name;
  if (role) updates.role = role;
  if (password) updates.password_hash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase
    .from('users').update(updates).eq('id', req.params.id)
    .select('id, username, role, display_name').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/auth/users/:id — admin deletes user
router.delete('/users/:id', requireAdmin, async (req, res) => {
  const { error } = await supabase.from('users').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
