// Print/PDF invoice — diporting dari aplikasi invoice lama (api/index.js:
// buildInvoiceHtml / buildInvoiceBody / invoiceStyleTag), disesuaikan supaya
// jalan sepenuhnya di browser (tanpa backend), memakai pola window.open yang
// sama dengan src/slip.js milik PCRS.
import { numFmt, numFmtValuta } from './invoiceHelpers.js'

function invoiceStyleTag() {
  return `<style>
      @page { size: A4; margin: 18mm 15mm; }
      * { box-sizing: border-box; }
      body { font-family: "Times New Roman", Times, serif; font-size: 11pt; color: #000; margin:0; padding: 0; }
      .co-header { display:flex; align-items:center; gap:14px; }
      .co-logo { width:80px; height:80px; object-fit:contain; flex-shrink:0; }
      .co-info { text-align:left; }
      .co-name { font-size: 17pt; font-weight: bold; text-align:left; margin:0 0 2px; }
      .co-line { font-size: 10.5pt; text-align:left; margin:1px 0; }
      .spacer-sm { height: 14px; }
      .spacer-md { height: 22px; }
      .to-label { font-weight:bold; }
      .customer-name { font-weight:bold; font-size:12pt; }
      .attn-row { font-weight:bold; }
      .invoice-head { display:flex; justify-content:space-between; align-items:flex-start; margin-top: 20px; }
      .invoice-title { font-size:20pt; font-weight:bold; flex:1; text-align:center; }
      .meta-table td { padding: 2px 6px; font-weight:bold; font-size: 11pt; }
      .meta-table td.label { text-align:left; }
      .meta-table td.colon { text-align:center; width:10px; }
      .meta-table td.value { text-align:right; }
      table.items { width:100%; border-collapse: collapse; margin-top: 14px; }
      table.items th { border-top: 2px solid #000; border-bottom: 1px solid #000; padding: 5px 6px; font-weight:bold; font-size:11pt; }
      table.items td { padding: 4px 6px; font-size: 11pt; }
      .c-no { text-align:center; width: 5%; }
      .c-item { text-align:left; width: 55%; }
      .c-item-desc { font-size:9.5pt; font-weight:normal; color:#333; margin-top:2px; white-space:pre-line; }
      .c-qty { text-align:center; width: 15%; }
      .c-amt { text-align:right; width: 25%; }
      table.items.dual-amt .c-item { width: 40%; }
      table.items.dual-amt .c-qty { width: 12%; }
      table.items.dual-amt .c-amt { width: 21.5%; }
      tr.group-header td { font-weight:bold; text-align:left; padding-top:10px; padding-bottom:6px; border-bottom:1px solid #000; }
      .ex-rate { text-align:right; margin-top: 10px; font-size:11pt; }
      .ex-rate span { margin-right: 10px; }
      tr.total-row td { font-weight:bold; border-top: 2px solid #000; padding-top:8px; }
      .footer { display:flex; justify-content:space-between; margin-top: 50px; }
      .footer .bank-block { font-size: 10pt; }
      .footer .bank-block .co-repeat { font-size: 11pt; font-weight:bold; margin-bottom:4px; }
      .footer .sig-block { text-align:center; font-size: 11pt; min-width: 260px; }
      .footer .sig-issuer { font-weight:bold; margin-bottom: 6px; }
      .footer .sig-img-wrap { height:58px; display:flex; align-items:center; justify-content:center; margin-bottom:2px; }
      .footer .sig-img-wrap img { max-height:58px; max-width:250px; object-fit:contain; }
      .footer .sig-name { font-weight:bold; border-top: 1px solid #000; padding-top:4px; display:inline-block; min-width:260px; }
      .footer .sig-title { font-weight:bold; }
      @media print { .no-print { display:none; } }
      .draft-watermark { margin: 0 0 14px; padding: 8px 14px; border: 1px solid #b8860b; color: #8a6300; background:#fff8e1; font-family: Arial, sans-serif; font-size: 10.5pt; font-weight: bold; text-align:center; }
      .print-page { page-break-after: always; }
      .print-page:last-child { page-break-after: auto; }
      @media screen {
        .print-page + .print-page { margin-top: 40px; padding-top: 40px; border-top: 3px dashed #ccc; }
      }
    </style>`
}

function esc(s) {
  return String(s ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// approver: { full_name, signature_url, invoice_title } (profil manager yang approve —
// signature_url adalah tanda tangan yang SAMA dipakai untuk slip reimbursement PCRS)
function buildInvoiceBody(inv, co, approver) {
  const items = inv.items || []
  const total = items.reduce((s, it) => s + Number(it.amount || 0) * Number(it.qty || 1), 0)
  const isDraft = inv.status === 'Draft'
  const invoiceNoDisplay = inv.invoice_no || '(Belum diisi)'
  const customerDisplay = inv.customer_name || '(Belum diisi)'
  const isIDR = inv.currency === 'IDR'
  const hasValuta = !isIDR && !!inv.exchange_rate
  const totalValuta = hasValuta ? total / inv.exchange_rate : null

  const rows = items
    .map((it, i) => {
      const lineIdr = Number(it.amount || 0) * Number(it.qty || 1)
      const valutaCell = hasValuta
        ? `<td class="c-amt">${numFmtValuta(lineIdr / inv.exchange_rate, inv.currency)}</td>`
        : ''
      return `
      <tr>
        <td class="c-no">${i + 1}</td>
        <td class="c-item">${esc(it.item_name)}${it.description ? `<div class="c-item-desc">${esc(it.description)}</div>` : ''}</td>
        <td class="c-qty">${it.qty || ''}</td>
        <td class="c-amt">${numFmt(lineIdr)}</td>
        ${valutaCell}
      </tr>`
    })
    .join('')

  const exRateLine = !isIDR && inv.exchange_rate
    ? `<div class="ex-rate"><span>Exchange Rate :</span><strong>${Number(inv.exchange_rate).toLocaleString('en-US')}</strong></div>`
    : ''

  const approved = inv.approval_status === 'approved' && !isDraft

  return `
      ${isDraft ? `<div class="draft-watermark">DRAFT — Invoice ini belum resmi, masih bisa diubah dari menu Daftar Invoice.</div>` : ''}
      <div class="co-header">
        ${co.logo ? `<img class="co-logo" src="${co.logo}">` : ''}
        <div class="co-info">
          <p class="co-name">${esc(co.name)}</p>
          <p class="co-line">${esc(co.subtitle)}</p>
          <p class="co-line">${esc(co.address_line1)}</p>
          <p class="co-line">${esc(co.address_line2)}</p>
          <p class="co-line">${esc(co.phone)}</p>
        </div>
      </div>
      <div class="spacer-md"></div>
      <div class="to-label">TO :</div>
      <div class="customer-name">${esc(customerDisplay)}</div>
      <div style="white-space:pre-line">${esc((inv.customer_address || '').split('//').map((s) => s.trim()).filter(Boolean).join('\n'))}</div>
      <div class="spacer-sm"></div>
      ${inv.attn ? `<div class="attn-row">ATTN : ${esc(inv.attn)}</div>` : ''}
      <div class="invoice-head">
        <div class="invoice-title">INVOICE</div>
        <table class="meta-table">
          <tr><td class="label">INVOICE DATE</td><td class="colon">:</td><td class="value">${inv.invoice_date || '-'}</td></tr>
          <tr><td class="label">DUE DATE</td><td class="colon">:</td><td class="value">${inv.due_date || '-'}</td></tr>
          <tr><td class="label">INVOICE NO.</td><td class="colon">:</td><td class="value">${esc(invoiceNoDisplay)}</td></tr>
        </table>
      </div>
      <table class="items ${hasValuta ? 'dual-amt' : ''}">
        <thead><tr>
          <th class="c-no">NO.</th><th class="c-item">ITEM</th>
          <th class="c-qty">Number of Persons</th><th class="c-amt">AMOUNT (IDR)</th>
          ${hasValuta ? `<th class="c-amt">AMOUNT (${esc(inv.currency)})</th>` : ''}
        </tr></thead>
        <tbody>
          ${inv.remark ? `<tr class="group-header"><td colspan="${hasValuta ? 5 : 4}">${esc(inv.remark)}</td></tr>` : ''}
          ${rows}
          <tr class="total-row"><td colspan="3" style="text-align:right">TOTAL</td><td class="c-amt">${numFmt(total)}</td>${hasValuta ? `<td class="c-amt">${numFmtValuta(totalValuta, inv.currency)}</td>` : ''}</tr>
        </tbody>
      </table>
      ${exRateLine}
      ${!isDraft && !approved ? `
      <div class="pending-notice no-print" style="margin-top:16px;padding:10px 14px;border:1px solid #c0392b;color:#c0392b;font-family:Arial,sans-serif;font-size:10pt;">
        ⚠ Invoice ini belum disetujui Manager — tanda tangan belum muncul. Status akan berubah otomatis setelah di-approve.
      </div>` : ''}
      <div class="footer">
        <div class="bank-block">
          <div class="co-repeat">${esc(co.name)}</div>
          <div><strong>Bank :</strong> ${esc(co.bank_name)}</div>
          <div>${esc(co.bank_branch)}</div>
          <div>SWIFT CODE : ${esc(co.swift_code)}</div>
          <div>(${esc(inv.currency)}) ${esc(co.account_number)}</div>
        </div>
        <div class="sig-block">
          <div class="sig-issuer">${esc(co.name)}</div>
          ${approved ? `
          <div class="sig-img-wrap">${approver?.signature_url ? `<img src="${approver.signature_url}">` : ''}</div>
          <div class="sig-name">${esc(approver?.full_name || co.signer_name || '')}</div>
          <div class="sig-title">${esc(approver?.invoice_title || co.signer_title || '')}</div>` : `
          <div class="sig-img-wrap" style="height:59px;font-size:9pt;color:#999;font-family:Arial,sans-serif;">( ${isDraft ? 'Draft — belum diajukan' : 'Menunggu persetujuan Manager'} )</div>
          <div class="sig-title" style="visibility:hidden">-</div>`}
        </div>
      </div>`
}

export function buildInvoiceHtml(inv, co, approver) {
  const invoiceNoDisplay = inv.invoice_no || '(Belum diisi)'
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(invoiceNoDisplay)}</title>
    ${invoiceStyleTag()}</head><body>
      <div class="print-page">${buildInvoiceBody(inv, co, approver)}</div>
      <button class="no-print" onclick="window.print()" style="margin-top:30px;padding:8px 16px;">Print / Save as PDF</button>
    </body></html>`
}

export function buildBatchInvoiceHtml(entries, co) {
  const pages = entries
    .map(({ inv, approver }) => `<div class="print-page">${buildInvoiceBody(inv, co, approver)}</div>`)
    .join('')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Print ${entries.length} Invoice</title>
    ${invoiceStyleTag()}</head><body>
      ${pages}
      <button class="no-print" onclick="window.print()" style="margin:20px 0;padding:8px 16px;">Print / Save as PDF (${entries.length} invoice)</button>
    </body></html>`
}

export function printInvoice(inv, co, approver) {
  const html = buildInvoiceHtml(inv, co, approver)
  const w = window.open('', '_blank', 'width=860,height=680')
  w.document.write(html)
  w.document.close()
}

export function printInvoiceBatch(entries, co) {
  const html = buildBatchInvoiceHtml(entries, co)
  const w = window.open('', '_blank', 'width=860,height=680')
  w.document.write(html)
  w.document.close()
}
