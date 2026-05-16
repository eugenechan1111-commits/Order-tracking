require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.get('/api/ping', (req, res) => res.json({ ok: true }));
app.use('/api/auth', require('./api/auth'));
app.use('/api/orders', require('./api/orders'));
app.use('/api/work-orders', require('./api/workorders'));
app.use('/api/dashboard', require('./api/dashboard'));
app.use('/api/ai', require('./api/ai-report'));
app.use('/api/reports', require('./api/ai-report'));
app.use('/api/customers', require('./api/customers'));
app.use('/api/leads', require('./api/leads'));
app.use('/api/quotations', require('./api/quotations'));
app.use('/api/sales-orders', require('./api/sales-orders'));
app.use('/api/invoices', require('./api/invoices'));
app.use('/api/deliveries', require('./api/deliveries'));
app.use('/api/materials', require('./api/materials'));
app.use('/api/bom', require('./api/bom'));
app.use('/api/company-settings', require('./api/company-settings'));
app.use('/api/bridge', require('./api/bridge'));
app.use('/api/invoice-pdf', require('./api/invoice-pdf'));
app.use('/api/track', require('./api/track'));
app.use('/api/customer-auth', require('./api/customer-auth'));
app.use('/api/customer-portal', require('./api/customer-portal'));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/worker', (req, res) => res.sendFile(path.join(__dirname, 'public', 'worker.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/crm', (req, res) => res.sendFile(path.join(__dirname, 'public', 'crm.html')));
app.get('/sales', (req, res) => res.sendFile(path.join(__dirname, 'public', 'sales.html')));
app.get('/inventory', (req, res) => res.sendFile(path.join(__dirname, 'public', 'inventory.html')));
app.get('/settings', (req, res) => res.sendFile(path.join(__dirname, 'public', 'settings.html')));
app.get('/track', (req, res) => res.sendFile(path.join(__dirname, 'public', 'track.html')));
app.get('/customer-login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'customer-login.html')));
app.get('/customer', (req, res) => res.sendFile(path.join(__dirname, 'public', 'portal.html')));

// JSON error handler — must be last
app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Amber Office running at http://localhost:${PORT}`));
