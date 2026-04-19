require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const WORKSTATIONS = ['Cut', 'Edge', 'Boring', 'Cut-Curve', 'Edge-Curve', 'Assembly', 'Packing'];

const USERS = [
  { username: 'boss', password: 'boss123', role: 'super_admin', display_name: 'Boss' },
  { username: 'admin', password: 'admin123', role: 'admin', display_name: 'Admin' },
  { username: 'john', password: 'worker123', role: 'worker', display_name: 'John Tan' },
  { username: 'mary', password: 'worker123', role: 'worker', display_name: 'Mary Lim' },
  { username: 'ali', password: 'worker123', role: 'worker', display_name: 'Ali Hassan' },
];

const today = new Date();
const fmt = d => d.toISOString().split('T')[0];
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

const ORDERS = [
  { order_no: 'PO-2024-001', customer: 'Ikea Malaysia', product: 'BILLY Bookcase', quantity: 50, due_date: fmt(addDays(today, -3)), status: 'done' },
  { order_no: 'PO-2024-002', customer: 'Courts Singapore', product: 'Office Desk A2', quantity: 30, due_date: fmt(addDays(today, -1)), status: 'in_progress' },
  { order_no: 'PO-2024-003', customer: 'Harvey Norman', product: 'TV Cabinet C1', quantity: 20, due_date: fmt(addDays(today, 3)), status: 'in_progress' },
  { order_no: 'PO-2024-004', customer: 'Signature Kitchen', product: 'Kitchen Cabinet Set', quantity: 8, due_date: fmt(addDays(today, 7)), status: 'pending' },
  { order_no: 'PO-2024-005', customer: 'Home Club', product: 'Wardrobe W3', quantity: 15, due_date: fmt(addDays(today, 10)), status: 'pending' },
  { order_no: 'PO-2024-006', customer: 'Ikea Malaysia', product: 'KALLAX Shelf', quantity: 60, due_date: fmt(addDays(today, -5)), status: 'done' },
  { order_no: 'PO-2024-007', customer: 'Commune', product: 'Dining Table D1', quantity: 10, due_date: fmt(addDays(today, 2)), status: 'in_progress' },
  { order_no: 'PO-2024-008', customer: 'FortyTwo', product: 'Study Desk S2', quantity: 25, due_date: fmt(addDays(today, -2)), status: 'in_progress' },
];

async function seed() {
  console.log('🌱 Seeding Amber Office database...\n');

  // Users
  console.log('Creating users...');
  for (const u of USERS) {
    const password_hash = await bcrypt.hash(u.password, 10);
    const { error } = await supabase.from('users').upsert({ username: u.username, role: u.role, display_name: u.display_name, password_hash }, { onConflict: 'username' });
    if (error) console.log(`  ⚠ ${u.username}: ${error.message}`);
    else console.log(`  ✓ ${u.username} (${u.role})`);
  }

  // Orders
  console.log('\nCreating orders...');
  for (const o of ORDERS) {
    const shipped_at = o.status === 'done' ? addDays(new Date(o.due_date), -1).toISOString() : null;
    const { data: order, error: oErr } = await supabase
      .from('orders').upsert({ ...o, shipped_at }, { onConflict: 'order_no' }).select().single();
    if (oErr) { console.log(`  ⚠ ${o.order_no}: ${oErr.message}`); continue; }
    console.log(`  ✓ ${o.order_no} — ${o.customer} [${o.status}]`);

    // Create work orders
    for (const [i, ws] of WORKSTATIONS.entries()) {
      let status = 'pending', actual_qty = 0, rework_qty = 0, started_at = null, completed_at = null;
      const workerNames = ['John Tan', 'Mary Lim', 'Ali Hassan'];
      const worker_name = workerNames[i % workerNames.length];

      if (o.status === 'done') {
        status = 'completed';
        actual_qty = Math.floor(o.quantity * (0.92 + Math.random() * 0.08));
        rework_qty = Math.floor(actual_qty * Math.random() * 0.05);
        started_at = addDays(new Date(o.due_date), -4).toISOString();
        completed_at = addDays(new Date(o.due_date), -1).toISOString();
      } else if (o.status === 'in_progress') {
        if (i < 3) {
          status = 'completed';
          actual_qty = Math.floor(o.quantity * (0.9 + Math.random() * 0.1));
          rework_qty = Math.floor(actual_qty * Math.random() * 0.03);
          started_at = addDays(today, -2).toISOString();
          completed_at = addDays(today, -1).toISOString();
        } else if (i === 3) {
          status = 'in_progress';
          started_at = new Date(Date.now() - 3600000).toISOString();
        } else {
          status = 'pending';
        }
      }

      await supabase.from('work_orders').insert({
        order_id: order.id, workstation: ws, worker_name: status !== 'pending' ? worker_name : null,
        status, target_qty: o.quantity, actual_qty, rework_qty, started_at, completed_at
      });
    }
  }

  console.log('\n✅ Seed complete!\n');
  console.log('Users: boss/boss123 (super_admin), admin/admin123 (admin), john|mary|ali/worker123 (worker)');
}

seed().catch(console.error);
