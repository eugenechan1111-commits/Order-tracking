const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../lib/auth');
const { getDemoDashboard } = require('../lib/demo-data');

const WORKSTATIONS = ['Cut', 'Edge', 'Boring', 'Cut-Curve', 'Edge-Curve', 'Assembly', 'Packing'];

const EMPTY = {
  active_orders: 0, otd_percent: null, otd_detail: { on_time: 0, total_due: 0 },
  weekly_shipment_qty: 0, weekly_shipment_orders: 0,
  capacity_rate: null, capacity_detail: { actual: 0, target: 0 },
  trend: Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    return { date: d.toISOString().split('T')[0], qty: 0 };
  }),
  oee: WORKSTATIONS.map(ws => ({ workstation: ws, availability: null, performance: null, quality: null, oee: null }))
};

router.get('/', requireAuth, async (req, res) => {
  if (!process.env.SUPABASE_URL) return res.json(getDemoDashboard());

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay() + 1);
  weekStart.setHours(0, 0, 0, 0);
  const weekStartISO = weekStart.toISOString();
  const todayISO = now.toISOString().split('T')[0];
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    return d.toISOString().split('T')[0];
  });

  const [
    { data: activeOrders },
    { data: dueOrders },
    { data: weeklyShipped },
    { data: weeklyWO },
    { data: recentCompleted }
  ] = await Promise.all([
    supabase.from('orders').select('id').in('status', ['pending', 'in_progress', 'ready', 'pickup_delivery']),
    supabase.from('orders').select('due_date, shipped_at, status').lte('due_date', todayISO),
    supabase.from('orders').select('quantity').eq('status', 'done').gte('shipped_at', weekStartISO),
    supabase.from('work_orders').select('workstation, status, actual_qty, target_qty, rework_qty, started_at, completed_at').gte('created_at', weekStartISO),
    supabase.from('work_orders').select('completed_at, actual_qty').eq('status', 'completed').gte('completed_at', days[0] + 'T00:00:00')
  ]);

  const totalDue = dueOrders?.length || 0;
  const onTime = (dueOrders || []).filter(o => o.shipped_at && new Date(o.shipped_at) <= new Date(o.due_date + 'T23:59:59')).length;
  const otd = totalDue > 0 ? Math.round((onTime / totalDue) * 100) : null;
  const weeklyQty = (weeklyShipped || []).reduce((s, o) => s + o.quantity, 0);
  const totalTarget = (weeklyWO || []).reduce((s, w) => s + w.target_qty, 0);
  const totalActual = (weeklyWO || []).filter(w => w.status === 'completed').reduce((s, w) => s + (w.actual_qty || 0), 0);

  const trend = days.map(day => ({
    date: day,
    qty: (recentCompleted || []).filter(w => w.completed_at?.startsWith(day)).reduce((s, w) => s + (w.actual_qty || 0), 0)
  }));

  // OEE per workstation
  const oee = WORKSTATIONS.map(ws => {
    const wos = (weeklyWO || []).filter(w => w.workstation === ws);
    if (!wos.length) return { workstation: ws, availability: null, performance: null, quality: null, oee: null, total: 0 };

    const total = wos.length;
    const completed = wos.filter(w => w.status === 'completed');
    const totalTargetQty = wos.reduce((s, w) => s + (w.target_qty || 0), 0);
    const totalActualQty = completed.reduce((s, w) => s + (w.actual_qty || 0), 0);
    const totalRejectedQty = completed.reduce((s, w) => s + (w.rework_qty || 0), 0);

    // Availability = completed / total work orders
    const availability = total > 0 ? completed.length / total : 0;
    // Performance = actual / target (for completed orders)
    const performance = totalTargetQty > 0 ? Math.min(totalActualQty / totalTargetQty, 1) : 0;
    // Quality = (actual - rejected) / actual
    const quality = totalActualQty > 0 ? Math.max((totalActualQty - totalRejectedQty) / totalActualQty, 0) : (completed.length > 0 ? 1 : 0);

    const oeeVal = availability * performance * quality;
    return {
      workstation: ws,
      availability: Math.round(availability * 100),
      performance: Math.round(performance * 100),
      quality: Math.round(quality * 100),
      oee: Math.round(oeeVal * 100),
      completed: completed.length,
      total,
      actual_qty: totalActualQty,
      target_qty: totalTargetQty,
      rework_qty: totalRejectedQty
    };
  });

  res.json({
    active_orders: activeOrders?.length || 0,
    otd_percent: otd, otd_detail: { on_time: onTime, total_due: totalDue },
    weekly_shipment_qty: weeklyQty, weekly_shipment_orders: weeklyShipped?.length || 0,
    capacity_rate: totalTarget > 0 ? Math.round((totalActual / totalTarget) * 100) : null,
    capacity_detail: { actual: totalActual, target: totalTarget },
    trend, oee
  });
});

module.exports = router;
