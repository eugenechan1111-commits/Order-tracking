const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('../lib/supabase');
const { requireAuth } = require('../lib/auth');
const { DEMO_ORDERS, DEMO_WORK_ORDERS } = require('../lib/demo-data');

const WORKSTATIONS = ['Cut', 'Edge', 'Boring', 'Cut-Curve', 'Edge-Curve', 'Assembly', 'Packing'];

function buildStatsFromData(allOrders, completedThisWeek, overdueOrders, weeklyWorkOrders, weekStartDate, weekEndDate) {
  const stationStats = {};
  WORKSTATIONS.forEach(ws => { stationStats[ws] = { completed: 0, total: 0, actual: 0, target: 0, rework: 0 }; });
  (weeklyWorkOrders || []).forEach(wo => {
    const s = stationStats[wo.workstation];
    if (!s) return;
    s.total++; s.target += wo.target_qty || 0;
    if (wo.status === 'completed') { s.completed++; s.actual += wo.actual_qty || 0; s.rework += wo.rework_qty || 0; }
  });
  const totalTarget = Object.values(stationStats).reduce((s, w) => s + w.target, 0);
  const totalActual = Object.values(stationStats).reduce((s, w) => s + w.actual, 0);

  return `You are a factory management assistant for Amber Office. Write a concise weekly management report in English based on the data below.

## This Week's Data (${weekStartDate} to ${weekEndDate})

**Orders:**
- Orders shipped this week: ${(completedThisWeek || []).length}
- Active orders (not completed): ${(allOrders || []).length}
- Overdue orders: ${(overdueOrders || []).length}
${(overdueOrders || []).map(o => `  - ${o.order_no} ${o.customer}: ${o.product} × ${o.quantity}, due ${o.due_date}`).join('\n')}

**Production:**
- Weekly target qty: ${totalTarget}
- Weekly actual qty: ${totalActual}
- Capacity utilization: ${totalTarget > 0 ? Math.round(totalActual / totalTarget * 100) : 'N/A'}%

**Per Workstation:**
${Object.entries(stationStats).map(([ws, s]) => `- ${ws}: ${s.actual}/${s.target} units (${s.completed}/${s.total} work orders done, ${s.rework} rework units)`).join('\n')}

Write the report in this format:
1. **Highlights** (2-3 positive achievements)
2. **Issues** (overdue orders, bottlenecks, quality problems)
3. **Action Items for Next Week** (2-3 specific, actionable items)
4. **One-Line Summary** (for the boss)

Keep each point to 1-2 lines. Professional and concise.`;
}

router.post('/weekly-report', requireAuth, async (req, res) => {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay() + 1);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const weekStartISO = weekStart.toISOString();
  const weekStartDate = weekStart.toISOString().split('T')[0];
  const weekEndDate = weekEnd.toISOString().split('T')[0];
  const todayDate = now.toISOString().split('T')[0];

  let prompt;

  if (!process.env.SUPABASE_URL) {
    // Demo mode — use in-memory demo data
    const allOrders = DEMO_ORDERS.filter(o => ['pending', 'in_progress'].includes(o.status));
    const completedThisWeek = DEMO_ORDERS.filter(o => o.status === 'completed');
    const overdueOrders = DEMO_ORDERS.filter(o => o.due_date < todayDate && o.status !== 'completed');
    const weeklyWorkOrders = DEMO_WORK_ORDERS;
    prompt = buildStatsFromData(allOrders, completedThisWeek, overdueOrders, weeklyWorkOrders, weekStartDate, weekEndDate);
  } else {
    const [
      { data: allOrders },
      { data: completedThisWeek },
      { data: overdueOrders },
      { data: weeklyWorkOrders }
    ] = await Promise.all([
      supabase.from('orders').select('*').in('status', ['pending', 'in_progress']),
      supabase.from('orders').select('*').eq('status', 'completed').gte('shipped_at', weekStartISO),
      supabase.from('orders').select('*').lt('due_date', todayDate).neq('status', 'completed'),
      supabase.from('work_orders').select('workstation, status, actual_qty, target_qty, rework_qty').gte('created_at', weekStartISO)
    ]);
    prompt = buildStatsFromData(allOrders, completedThisWeek, overdueOrders, weeklyWorkOrders, weekStartDate, weekEndDate);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({ error: 'Anthropic API key not configured. Add ANTHROPIC_API_KEY to your .env file to enable AI reports.' });
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    });
    const content = message.content[0].text;

    // Save report — skip DB save in demo mode
    if (!process.env.SUPABASE_URL) {
      return res.json({
        id: 'demo-' + Date.now(),
        week_start: weekStartDate,
        week_end: weekEndDate,
        content,
        generated_at: new Date().toISOString()
      });
    }

    const { data: report, error } = await supabase
      .from('weekly_reports').insert({ week_start: weekStartDate, week_end: weekEndDate, content }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', requireAuth, async (req, res) => {
  if (!process.env.SUPABASE_URL) return res.json([]);
  const { data, error } = await supabase
    .from('weekly_reports').select('*').order('generated_at', { ascending: false }).limit(20);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
