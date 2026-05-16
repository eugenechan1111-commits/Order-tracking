const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth, requireAdmin } = require('../lib/auth');

// GET /api/bridge/sql-account/export
// Returns CSV download in SQL Account AR Invoice import format
router.get('/sql-account/export', requireAdmin, async (req, res) => {
  const { from_date, to_date, unsynced_only } = req.query;

  let query = supabase.from('invoices')
    .select('*, customers(company_name, sql_account_code, tin, address), sales_orders(so_no)')
    .order('created_at', { ascending: true });

  if (from_date) query = query.gte('created_at', from_date);
  if (to_date)   query = query.lte('created_at', to_date + 'T23:59:59');
  if (unsynced_only === 'true') query = query.is('sql_synced_at', null);

  // Only export sent/partial/paid invoices (not drafts)
  query = query.not('status', 'eq', 'draft');

  const { data: invoices, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  if (!invoices.length) {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="sql_account_export.csv"');
    return res.send('CustomerCode,InvoiceDate,InvoiceNo,Description,Qty,UnitPrice,TaxCode,TaxRate,TaxAmount,Amount,Terms,Remarks\n');
  }

  const termMap = { cash: 'CASH', net30: 'NET30', net60: 'NET60', '50_50': 'DEPOSIT' };
  const rows = ['CustomerCode,InvoiceDate,InvoiceNo,Description,Qty,UnitPrice,TaxCode,TaxRate,TaxAmount,Amount,Terms,Remarks'];

  for (const inv of invoices) {
    const custCode = inv.customers?.sql_account_code || inv.customers?.company_name?.substring(0, 10).replace(/\s/g, '_').toUpperCase() || 'UNKNOWN';
    const invDate = inv.created_at ? inv.created_at.split('T')[0] : '';
    const term = termMap[inv.payment_term] || 'NET30';
    const soNo = inv.sales_orders?.so_no || '';

    const lineItems = inv.line_items || [];
    if (lineItems.length) {
      for (const li of lineItems) {
        rows.push([
          csvEsc(custCode),
          csvEsc(invDate),
          csvEsc(inv.invoice_no),
          csvEsc(li.description || li.product || 'Services'),
          li.qty || 1,
          (li.unit_price || 0).toFixed(2),
          csvEsc(li.tax_code || inv.tax_code || 'NA'),
          (li.tax_rate ?? inv.tax_rate ?? 0).toFixed(2) + '%',
          (li.tax_amount || 0).toFixed(2),
          (li.line_total || li.unit_price * (li.qty || 1)).toFixed(2),
          csvEsc(term),
          csvEsc(soNo)
        ].join(','));
      }
    } else {
      // Single-line fallback
      rows.push([
        csvEsc(custCode),
        csvEsc(invDate),
        csvEsc(inv.invoice_no),
        csvEsc('Services'),
        1,
        (inv.amount || 0).toFixed(2),
        csvEsc(inv.tax_code || 'NA'),
        (inv.tax_rate || 0).toFixed(2) + '%',
        (inv.tax_amount || 0).toFixed(2),
        (inv.amount || 0).toFixed(2),
        csvEsc(term),
        csvEsc(soNo)
      ].join(','));
    }
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sql_account_${new Date().toISOString().split('T')[0]}.csv"`);
  res.send('\uFEFF' + rows.join('\r\n')); // BOM for Excel UTF-8
});

// POST /api/bridge/sql-account/mark-synced
// Mark invoices as synced after SQL Account import
router.post('/sql-account/mark-synced', requireAdmin, async (req, res) => {
  const { invoice_ids } = req.body;
  if (!invoice_ids?.length) return res.status(400).json({ error: 'invoice_ids required' });

  const { error } = await supabase.from('invoices')
    .update({ sql_synced_at: new Date().toISOString() })
    .in('id', invoice_ids);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, synced: invoice_ids.length });
});

// POST /api/invoices/:id/lhdn — store LHDN UUID + QR URL after SQL Account submits
router.post('/invoices/:id/lhdn', requireAdmin, async (req, res) => {
  const { lhdn_uuid, lhdn_qr_url, lhdn_status } = req.body;
  if (!lhdn_uuid) return res.status(400).json({ error: 'lhdn_uuid required' });

  const { data, error } = await supabase.from('invoices')
    .update({
      lhdn_uuid,
      lhdn_qr_url: lhdn_qr_url || null,
      lhdn_status: lhdn_status || 'valid'
    })
    .eq('id', req.params.id)
    .select('*, customers(company_name)').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

function csvEsc(val) {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

module.exports = router;
