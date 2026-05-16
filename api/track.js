const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireCustomerAuth } = require('../lib/auth');
const { DEMO_ORDERS } = require('../lib/demo-data');

const STATION_ORDER = ['Cut', 'Edge', 'Boring', 'Cut-Curve', 'Edge-Curve', 'Assembly', 'Packing'];

function sanitizeOrder(order) {
  const wos = (order.work_orders || [])
    .sort((a, b) => STATION_ORDER.indexOf(a.workstation) - STATION_ORDER.indexOf(b.workstation));

  const stations = wos.map(wo => ({
    name: wo.workstation,
    status: wo.status,
    actual_qty: wo.actual_qty || 0,
    target_qty: wo.target_qty || 0,
  }));

  const allDone   = stations.length > 0 && stations.every(s => s.status === 'completed');
  const anyDone   = stations.some(s => s.status === 'completed');
  const anyActive = stations.some(s => s.status === 'in_progress');
  const anyPaused = stations.some(s => s.status === 'paused');

  let production_status = 'Pending';
  if (allDone)               production_status = 'Production Complete';
  else if (anyActive)        production_status = 'In Production';
  else if (anyDone)          production_status = 'In Production';  // some stations completed = work has started
  else if (anyPaused)        production_status = 'On Hold';

  return {
    order_no:          order.order_no,
    customer:          order.customer,
    product:           order.product,
    items:             order.items || [],
    due_date:          order.due_date,
    status:            order.status,
    production_status,
    urgent:            order.urgent || false,
    stations,
  };
}

// GET /api/track — requires customer JWT; returns all orders for their customer_name
// Optional ?order_no= to filter further
router.get('/', requireCustomerAuth, async (req, res) => {
  const customerName = req.customer.customer_name;
  const { order_no } = req.query;

  if (!process.env.SUPABASE_URL) {
    let results = DEMO_ORDERS.filter(o => !o.hidden && o.customer.toLowerCase() === customerName.toLowerCase());
    if (order_no) results = results.filter(o => o.order_no.toLowerCase().includes(order_no.trim().toLowerCase()));
    if (!results.length) return res.status(404).json({ error: 'No orders found.' });
    return res.json(results.map(sanitizeOrder));
  }

  let query = supabase
    .from('orders')
    .select('order_no, customer, product, items, due_date, status, urgent, work_orders(workstation, status, actual_qty, target_qty)')
    .eq('hidden', false)
    .ilike('customer', customerName);

  if (order_no) query = query.ilike('order_no', `%${order_no.trim()}%`);

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  if (!data || !data.length) return res.status(404).json({ error: 'No orders found.' });

  res.json(data.map(sanitizeOrder));
});

module.exports = router;
