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

function buildTrend(completed, days) {
  if (days <= 30) {
    const dayList = Array.from({ length: days }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (days - 1 - i));
      return d.toISOString().split('T')[0];
    });
    return dayList.map(date => ({
      date,
      qty: (completed || []).filter(w => w.completed_at?.startsWith(date)).reduce((s, w) => s + (w.actual_qty || 0), 0)
    }));
  }
  if (days <= 90) {
    const weeks = Math.ceil(days / 7);
    return Array.from({ length: weeks }, (_, i) => {
      const end = new Date(); end.setDate(end.getDate() - (weeks - 1 - i) * 7);
      const start = new Date(end); start.setDate(start.getDate() - 6);
      const label = start.toISOString().split('T')[0].slice(5);
      const qty = (completed || []).filter(w => {
        const d = w.completed_at?.split('T')[0];
        return d >= start.toISOString().split('T')[0] && d <= end.toISOString().split('T')[0];
      }).reduce((s, w) => s + (w.actual_qty || 0), 0);
      return { date: label, qty };
    });
  }
  // 1 year — monthly
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(); d.setMonth(d.getMonth() - (11 - i));
    const ym = d.toISOString().slice(0, 7);
    const qty = (completed || []).filter(w => w.completed_at?.startsWith(ym)).reduce((s, w) => s + (w.actual_qty || 0), 0);
    return { date: ym, qty };
  });
}

router.get('/', requireAuth, async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 7, 365);
  if (!process.env.SUPABASE_URL) return res.json(getDemoDashboard());

  const now = new Date();
  const periodStart = new Date(now);
  periodStart.setDate(now.getDate() - days);
  periodStart.setHours(0, 0, 0, 0);
  const periodStartISO = periodStart.toISOString();
  const todayISO = now.toISOString().split('T')[0];

  const [
    { data: activeOrders },
    { data: dueOrders },
    { data: periodShipped },
    { data: periodWO },
    { data: recentCompleted }
  ] = await Promise.all([
    supabase.from('orders').select('id').in('status', ['pending', 'in_progress', 'ready', 'pickup_delivery']),
    supabase.from('orders').select('due_date, shipped_at, status').lte('due_date', todayISO),
    supabase.from('orders').select('quantity').eq('status', 'done').gte('shipped_at', periodStartISO),
    supabase.from('work_orders').select('workstation, status, actual_qty, target_qty, rework_qty, started_at, completed_at').gte('created_at', periodStartISO),
    supabase.from('work_orders').select('completed_at, actual_qty').eq('status', 'completed').gte('completed_at', periodStartISO)
  ]);

  const totalDue = dueOrders?.length || 0;
  const onTime = (dueOrders || []).filter(o => o.shipped_at && new Date(o.shipped_at) <= new Date(o.due_date + 'T23:59:59')).length;
  const otd = totalDue > 0 ? Math.round((onTime / totalDue) * 100) : null;
  const periodQty = (periodShipped || []).reduce((s, o) => s + o.quantity, 0);
  const totalTarget = (periodWO || []).reduce((s, w) => s + w.target_qty, 0);
  const totalActual = (periodWO || []).filter(w => w.status === 'completed').reduce((s, w) => s + (w.actual_qty || 0), 0);

  const trend = buildTrend(recentCompleted, days);

  const oee = WORKSTATIONS.map(ws => {
    const wos = (periodWO || []).filter(w => w.workstation === ws);
    if (!wos.length) return { workstation: ws, availability: null, performance: null, quality: null, oee: null, total: 0 };
    const total = wos.length;
    const completed = wos.filter(w => w.status === 'completed');
    const totalTargetQty = wos.reduce((s, w) => s + (w.target_qty || 0), 0);
    const totalActualQty = completed.reduce((s, w) => s + (w.actual_qty || 0), 0);
    const totalRejectedQty = completed.reduce((s, w) => s + (w.rework_qty || 0), 0);
    const availability = total > 0 ? completed.length / total : 0;
    const performance = totalTargetQty > 0 ? Math.min(totalActualQty / totalTargetQty, 1) : 0;
    const quality = totalActualQty > 0 ? Math.max((totalActualQty - totalRejectedQty) / totalActualQty, 0) : (completed.length > 0 ? 1 : 0);
    const oeeVal = availability * performance * quality;
    return {
      workstation: ws,
      availability: Math.round(availability * 100),
      performance: Math.round(performance * 100),
      quality: Math.round(quality * 100),
      oee: Math.round(oeeVal * 100),
      completed: completed.length, total,
      actual_qty: totalActualQty, target_qty: totalTargetQty, rework_qty: totalRejectedQty
    };
  });

  res.json({
    active_orders: activeOrders?.length || 0,
    otd_percent: otd, otd_detail: { on_time: onTime, total_due: totalDue },
    weekly_shipment_qty: periodQty, weekly_shipment_orders: periodShipped?.length || 0,
    capacity_rate: totalTarget > 0 ? Math.round((totalActual / totalTarget) * 100) : null,
    capacity_detail: { actual: totalActual, target: totalTarget },
    trend, oee
  });
});

module.exports = router;
