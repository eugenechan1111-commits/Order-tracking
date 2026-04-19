require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', require('./api/auth'));
app.use('/api/orders', require('./api/orders'));
app.use('/api/work-orders', require('./api/workorders'));
app.use('/api/dashboard', require('./api/dashboard'));
app.use('/api/ai', require('./api/ai-report'));
app.use('/api/reports', require('./api/ai-report'));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/worker', (req, res) => res.sendFile(path.join(__dirname, 'public', 'worker.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// JSON error handler — must be last
app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Amber Office running at http://localhost:${PORT}`));
