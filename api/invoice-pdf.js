const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../lib/auth');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

router.get('/:id', requireAuth, async (req, res) => {
  // Fetch invoice with full customer + company settings
  const { data: inv, error } = await supabase.from('invoices')
    .select('*, customers(*), sales_orders(so_no)')
    .eq('id', req.params.id).single();
  if (error || !inv) return res.status(404).json({ error: 'Invoice not found' });

  const entity = inv.entity || 'AOSB';
  const { data: co } = await supabase.from('company_settings')
    .select('*').eq('entity_name', entity).single();

  const customer = inv.customers || {};
  const lineItems = inv.line_items || [];

  // ── Build PDF ──
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${inv.invoice_no}.pdf"`);
  doc.pipe(res);

  const W = 595 - 100; // usable width
  const indigo = '#6366f1';
  const gray = '#64748b';
  const light = '#f0f2f7';
  const dark = '#1e2340';

  // ── Header bar ──
  doc.rect(50, 50, W, 6).fill(indigo);
  doc.moveDown(0.5);

  // Company name + entity badge
  doc.y = 70;
  doc.fontSize(20).fillColor(dark).font('Helvetica-Bold')
    .text(co?.company_name || entity, 50, 70);
  doc.fontSize(9).fillColor(gray).font('Helvetica')
    .text(`${entity} · e-Invoice`, 50, doc.y + 2);

  // Invoice label (right side)
  doc.fontSize(22).fillColor(indigo).font('Helvetica-Bold')
    .text('INVOICE', 400, 70, { width: 145, align: 'right' });
  doc.fontSize(11).fillColor(dark).font('Helvetica')
    .text(inv.invoice_no, 400, 96, { width: 145, align: 'right' });

  // LHDN status badge
  if (inv.lhdn_status === 'valid') {
    doc.fontSize(8).fillColor('#10b981').font('Helvetica-Bold')
      .text('✓ LHDN VALIDATED', 400, 110, { width: 145, align: 'right' });
  }

  doc.y = 145;
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e2e8f0').lineWidth(1).stroke();
  doc.y += 12;

  // ── Supplier + Buyer columns ──
  const col1 = 50, col2 = 300;
  const startY = doc.y;

  // Supplier (left)
  doc.fontSize(8).fillColor(gray).font('Helvetica-Bold').text('FROM', col1, startY);
  doc.fontSize(10).fillColor(dark).font('Helvetica-Bold').text(co?.company_name || entity, col1, startY + 12);
  doc.fontSize(9).fillColor(gray).font('Helvetica');
  if (co?.tin)             doc.text(`TIN: ${co.tin}`, col1, doc.y);
  if (co?.registration_no) doc.text(`Reg: ${co.registration_no}`, col1, doc.y);
  if (co?.sst_no)          doc.text(`SST: ${co.sst_no}`, col1, doc.y);
  if (co?.address)         doc.text(co.address, col1, doc.y, { width: 220 });
  if (co?.phone)           doc.text(`Tel: ${co.phone}`, col1, doc.y);
  if (co?.email)           doc.text(co.email, col1, doc.y);

  const afterSupplierY = doc.y;

  // Buyer (right)
  doc.fontSize(8).fillColor(gray).font('Helvetica-Bold').text('BILL TO', col2, startY);
  doc.fontSize(10).fillColor(dark).font('Helvetica-Bold').text(customer.company_name || '—', col2, startY + 12);
  doc.fontSize(9).fillColor(gray).font('Helvetica');
  if (customer.tin)             doc.text(`TIN: ${customer.tin}`, col2, doc.y);
  if (customer.registration_no) doc.text(`Reg: ${customer.registration_no}`, col2, doc.y);
  const billAddr = customer.billing_address || customer.address;
  if (billAddr) doc.text(billAddr, col2, doc.y, { width: 220 });
  if (customer.phone) doc.text(`Tel: ${customer.phone}`, col2, doc.y);
  if (customer.email) doc.text(customer.email, col2, doc.y);

  doc.y = Math.max(afterSupplierY, doc.y) + 16;
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
  doc.y += 12;

  // ── Invoice meta ──
  const metaY = doc.y;
  const metas = [
    ['Invoice No', inv.invoice_no],
    ['Invoice Date', fmtDate(inv.created_at)],
    ['Due Date', inv.due_date ? fmtDate(inv.due_date) : '—'],
    ['Payment Term', fmtTerm(inv.payment_term)],
    ...(inv.sales_orders?.so_no ? [['Sales Order', inv.sales_orders.so_no]] : []),
  ];
  metas.forEach(([label, value], i) => {
    const x = i % 3 === 0 ? 50 : i % 3 === 1 ? 220 : 390;
    const y = metaY + Math.floor(i / 3) * 26;
    doc.fontSize(8).fillColor(gray).font('Helvetica').text(label, x, y);
    doc.fontSize(10).fillColor(dark).font('Helvetica-Bold').text(value, x, y + 10);
  });

  doc.y = metaY + Math.ceil(metas.length / 3) * 26 + 12;

  // ── Line items table ──
  const tableTop = doc.y;
  doc.rect(50, tableTop, W, 20).fill(dark);
  doc.fontSize(8).fillColor('#ffffff').font('Helvetica-Bold');
  doc.text('Description', 56, tableTop + 6);
  doc.text('Qty', 310, tableTop + 6, { width: 40, align: 'right' });
  doc.text('Unit Price', 356, tableTop + 6, { width: 60, align: 'right' });
  doc.text('SST', 420, tableTop + 6, { width: 40, align: 'right' });
  doc.text('Amount', 464, tableTop + 6, { width: 75, align: 'right' });

  let rowY = tableTop + 20;
  const items = lineItems.length ? lineItems : [{ description: 'Services', qty: 1, unit_price: inv.amount, tax_amount: 0, line_total: inv.amount }];
  items.forEach((item, i) => {
    if (i % 2 === 1) doc.rect(50, rowY, W, 18).fill(light);
    doc.fontSize(9).fillColor(dark).font('Helvetica');
    doc.text(item.description || item.product || '—', 56, rowY + 4, { width: 250 });
    doc.text(String(item.qty || 1), 310, rowY + 4, { width: 40, align: 'right' });
    doc.text(`RM ${fmtAmt(item.unit_price || 0)}`, 356, rowY + 4, { width: 60, align: 'right' });
    doc.text(`RM ${fmtAmt(item.tax_amount || 0)}`, 420, rowY + 4, { width: 40, align: 'right' });
    doc.text(`RM ${fmtAmt(item.line_total || item.unit_price * (item.qty || 1))}`, 464, rowY + 4, { width: 75, align: 'right' });
    rowY += 18;
  });

  doc.moveTo(50, rowY).lineTo(545, rowY).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
  rowY += 8;

  // ── Totals ──
  const totals = [
    ['Subtotal', inv.subtotal || inv.amount],
    ...(inv.tax_amount > 0 ? [`SST (${inv.tax_rate || 0}%)`, inv.tax_amount] : []).map ? [[`SST (${inv.tax_rate || 0}%)`, inv.tax_amount]] : [],
    ...(inv.amount !== inv.subtotal && !inv.tax_amount ? [['—', '']] : []),
  ];

  doc.fontSize(9).fillColor(gray).font('Helvetica')
    .text('Subtotal:', 390, rowY, { width: 70, align: 'right' })
    .text(`RM ${fmtAmt(inv.subtotal || 0)}`, 464, rowY, { width: 75, align: 'right' });
  rowY += 14;

  if (inv.tax_amount > 0) {
    doc.text(`SST ${inv.tax_rate || 0}% (${inv.tax_code || 'NA'}):`, 390, rowY, { width: 70, align: 'right' })
      .text(`RM ${fmtAmt(inv.tax_amount)}`, 464, rowY, { width: 75, align: 'right' });
    rowY += 14;
  }

  // Grand total box
  doc.rect(390, rowY, 155, 22).fill(dark);
  doc.fontSize(10).fillColor('#ffffff').font('Helvetica-Bold')
    .text('TOTAL DUE', 396, rowY + 6, { width: 65, align: 'left' })
    .text(`RM ${fmtAmt(inv.amount)}`, 396, rowY + 6, { width: 143, align: 'right' });
  rowY += 34;

  // ── Payment info ──
  if (co?.bank_name) {
    doc.fontSize(8).fillColor(gray).font('Helvetica-Bold').text('PAYMENT DETAILS', 50, rowY);
    rowY += 12;
    doc.fontSize(9).fillColor(dark).font('Helvetica')
      .text(`Bank: ${co.bank_name}`, 50, rowY)
      .text(`Account: ${co.bank_account || '—'}  |  Account Name: ${co.bank_holder || '—'}`, 50, rowY + 12);
    rowY += 28;
  }

  // ── Notes ──
  if (inv.notes) {
    doc.fontSize(8).fillColor(gray).font('Helvetica-Bold').text('NOTES', 50, rowY);
    doc.fontSize(9).fillColor(dark).font('Helvetica').text(inv.notes, 50, rowY + 12, { width: W });
    rowY = doc.y + 12;
  }

  // ── QR Code ──
  if (inv.lhdn_qr_url) {
    try {
      const qrBuf = await QRCode.toBuffer(inv.lhdn_qr_url, { width: 80 });
      doc.image(qrBuf, 465, rowY, { width: 70 });
      doc.fontSize(7).fillColor(gray)
        .text('LHDN Validated', 460, rowY + 72, { width: 80, align: 'center' });
    } catch (_) {}
  }

  // Footer line
  const footY = 780;
  doc.moveTo(50, footY).lineTo(545, footY).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
  doc.fontSize(8).fillColor(gray).font('Helvetica')
    .text(`${co?.company_name || entity}  ·  ${co?.email || ''}  ·  ${co?.phone || ''}`, 50, footY + 6, { align: 'center', width: W });

  doc.end();
});

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtAmt(n) {
  return Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtTerm(t) {
  return { cash: 'Cash', net30: 'Net 30', net60: 'Net 60', '50_50': '50/50 Deposit' }[t] || t || '—';
}

module.exports = router;
