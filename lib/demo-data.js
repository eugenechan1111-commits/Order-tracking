const today = new Date();
const fmt = d => d.toISOString().split('T')[0];
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const WORKSTATIONS = ['Cut', 'Edge', 'Boring', 'Cut-Curve', 'Edge-Curve', 'Assembly', 'Packing'];

function makeWorkOrders(orderId, quantity, orderStatus) {
  return WORKSTATIONS.map((ws, i) => {
    let status = 'pending', actual_qty = 0, rework_qty = 0;
    if (['completed', 'done', 'pickup_delivery', 'ready'].includes(orderStatus)) {
      status = 'completed'; actual_qty = quantity; rework_qty = Math.round(quantity * 0.03);
    } else if (orderStatus === 'in_progress') {
      if (i < 3) { status = 'completed'; actual_qty = quantity; rework_qty = Math.round(quantity * 0.01); }
      else if (i === 3) { status = 'in_progress'; }
    }
    return { id: `wo-${orderId}-${ws}`, order_id: orderId, workstation: ws, status, target_qty: quantity, actual_qty, rework_qty, worker_name: status !== 'pending' ? ['John Tan', 'Mary Lim', 'Ali Hassan'][i % 3] : null };
  });
}

const DEMO_ORDERS = [
  { id: 'ord-1', order_no: 'PO-2024-001', customer: 'Ikea Malaysia',     product: 'BILLY Bookcase',      quantity: 50, due_date: fmt(addDays(today, -3)), status: 'done',            shipped_at: addDays(today, -4).toISOString(), urgent: false, hidden: false, delete_requested: false },
  { id: 'ord-2', order_no: 'PO-2024-002', customer: 'Courts Singapore',  product: 'Office Desk A2',      quantity: 30, due_date: fmt(addDays(today, -1)), status: 'in_progress',     shipped_at: null,                             urgent: true,  hidden: false, delete_requested: false },
  { id: 'ord-3', order_no: 'PO-2024-003', customer: 'Harvey Norman',     product: 'TV Cabinet C1',       quantity: 20, due_date: fmt(addDays(today,  3)), status: 'in_progress',     shipped_at: null,                             urgent: false, hidden: false, delete_requested: false },
  { id: 'ord-4', order_no: 'PO-2024-004', customer: 'Signature Kitchen', product: 'Kitchen Cabinet Set', quantity:  8, due_date: fmt(addDays(today,  7)), status: 'pending',          shipped_at: null,                             urgent: false, hidden: false, delete_requested: false },
  { id: 'ord-5', order_no: 'PO-2024-005', customer: 'Home Club',         product: 'Wardrobe W3',         quantity: 15, due_date: fmt(addDays(today, 10)), status: 'pending',          shipped_at: null,                             urgent: false, hidden: false, delete_requested: false },
  { id: 'ord-6', order_no: 'PO-2024-006', customer: 'Ikea Malaysia',     product: 'KALLAX Shelf',        quantity: 60, due_date: fmt(addDays(today, -5)), status: 'done',             shipped_at: addDays(today, -6).toISOString(), urgent: false, hidden: false, delete_requested: false },
  { id: 'ord-7', order_no: 'PO-2024-007', customer: 'Commune',           product: 'Dining Table D1',     quantity: 10, due_date: fmt(addDays(today,  2)), status: 'ready',            shipped_at: null,                             urgent: false, hidden: false, delete_requested: false },
  { id: 'ord-8', order_no: 'PO-2024-008', customer: 'FortyTwo',          product: 'Study Desk S2',       quantity: 25, due_date: fmt(addDays(today, -2)), status: 'pickup_delivery',  shipped_at: null,                             urgent: true,  hidden: false, delete_requested: false },
].map(o => ({ ...o, created_at: addDays(today, -10).toISOString(), work_orders: makeWorkOrders(o.id, o.quantity, o.status) }));

// Flatten all work orders for worker page queries
const DEMO_WORK_ORDERS = DEMO_ORDERS.flatMap(o =>
  o.work_orders.map(wo => ({ ...wo, orders: { order_no: o.order_no, customer: o.customer, product: o.product, quantity: o.quantity, due_date: o.due_date, status: o.status, urgent: o.urgent } }))
);

// Dashboard KPIs from demo data
function getDemoDashboard() {
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); weekStart.setHours(0,0,0,0);
  const todayStr = fmt(today);

  const activeOrders = DEMO_ORDERS.filter(o => ['pending','in_progress','ready','pickup_delivery'].includes(o.status)).length;
  const dueOrders = DEMO_ORDERS.filter(o => o.due_date <= todayStr);
  const onTime = dueOrders.filter(o => o.shipped_at && new Date(o.shipped_at) <= new Date(o.due_date + 'T23:59:59')).length;
  const otd = dueOrders.length > 0 ? Math.round(onTime / dueOrders.length * 100) : null;

  const weeklyShipped = DEMO_ORDERS.filter(o => o.status === 'done' && o.shipped_at && new Date(o.shipped_at) >= weekStart);
  const weeklyQty = weeklyShipped.reduce((s, o) => s + o.quantity, 0);

  const weeklyWOs = DEMO_WORK_ORDERS;
  const totalTarget = weeklyWOs.reduce((s, w) => s + w.target_qty, 0);
  const totalActual = weeklyWOs.filter(w => w.status === 'completed').reduce((s, w) => s + (w.actual_qty || 0), 0);
  const capacityRate = totalTarget > 0 ? Math.round(totalActual / totalTarget * 100) : null;

  const days = Array.from({length:7}, (_,i) => { const d = new Date(); d.setDate(d.getDate()-(6-i)); return fmt(d); });
  const trend = days.map((date, i) => ({ date, qty: i < 5 ? Math.round(30 + Math.random() * 40) : 0 }));

  const STATIONS = ['Cut','Edge','Boring','Cut-Curve','Edge-Curve','Assembly','Packing'];
  const oee = STATIONS.map(ws => {
    const wos = DEMO_WORK_ORDERS.filter(w => w.workstation === ws);
    const completed = wos.filter(w => w.status === 'completed');
    const totalTargetQty = wos.reduce((s,w) => s + w.target_qty, 0);
    const totalActualQty = completed.reduce((s,w) => s + (w.actual_qty||0), 0);
    const totalRejectedQty = completed.reduce((s,w) => s + (w.rework_qty||0), 0);
    const availability = wos.length > 0 ? completed.length / wos.length : 0;
    const performance = totalTargetQty > 0 ? Math.min(totalActualQty / totalTargetQty, 1) : 0;
    const quality = totalActualQty > 0 ? Math.max((totalActualQty - totalRejectedQty) / totalActualQty, 0) : (completed.length > 0 ? 1 : 0);
    return { workstation: ws, availability: Math.round(availability*100), performance: Math.round(performance*100), quality: Math.round(quality*100), oee: Math.round(availability*performance*quality*100), completed: completed.length, total: wos.length, actual_qty: totalActualQty, target_qty: totalTargetQty, rework_qty: totalRejectedQty };
  });

  return { active_orders: activeOrders, otd_percent: otd, otd_detail: { on_time: onTime, total_due: dueOrders.length }, weekly_shipment_qty: weeklyQty, weekly_shipment_orders: weeklyShipped.length, capacity_rate: capacityRate, capacity_detail: { actual: totalActual, target: totalTarget }, trend, oee };
}

module.exports = { DEMO_ORDERS, DEMO_WORK_ORDERS, getDemoDashboard };
