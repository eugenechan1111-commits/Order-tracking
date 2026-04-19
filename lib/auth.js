const jwt = require('jsonwebtoken');

if (!process.env.JWT_SECRET && process.env.SUPABASE_URL) {
  throw new Error('JWT_SECRET environment variable is required when SUPABASE_URL is set. Add it to your .env file.');
}
const SECRET = process.env.JWT_SECRET || 'amber-office-local-dev-only-not-for-production';

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, display_name: user.display_name },
    SECRET,
    { expiresIn: '24h' }
  );
}

function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.user = verifyToken(header.slice(7));
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}

function requireSuperAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Super admin (Boss) access required' });
    }
    next();
  });
}

module.exports = { signToken, verifyToken, requireAuth, requireAdmin, requireSuperAdmin };
