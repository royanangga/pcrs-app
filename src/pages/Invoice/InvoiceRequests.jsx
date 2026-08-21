import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import Icon from '../../icons.jsx'
import Portal from '../../Portal.jsx'
import { useEscapeToClose } from '../../hooks/useEscapeToClose.js'
import { useInvoiceSettings } from '../../lib/useInvoiceSettings.js'
import { numFmt, numFmtValuta, invoiceTotal, nextInvoiceNumber } from '../../lib/invoiceHelpers.js'
import { printInvoice, printInvoiceBatch } from '../../lib/invoicePrint.js'
import InvoiceForm from './InvoiceForm.jsx'

export default function InvoiceRequests({ profile }) {
  const { customers, numberFormat, company, exchangeRates } = useInvoiceSettings()

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [msg, setMsg] = useState('')

  const [editingRow, setEditingRow] = useState(null) // null | invoice row object
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')

  useEscapeToClose(() => setEditingRow(null), !!editingRow)
  useEscapeToClose(() => setDeleteTarget(null), !!deleteTarget)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('invoice_invoices')
      .select('*, items:invoice_items(*)')
      .order('created_at', { ascending: false })
    setRows(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      (r.invoice_no || '').toLowerCase().includes(q) ||
      (r.customer_name || '').toLowerCase().includes(q) ||
      (r.batch || '').toLowerCase().includes(q)
    )
  }, [rows, search])

  async function doDelete() {
    setSaving(true)
    const { error } = await supabase.from('invoice_invoices').delete().eq('id', deleteTarget.id)
    setSaving(false)
    setDeleteTarget(null)
    if (error) { setMsg('Gagal menghapus: ' + error.message) } else { load() }
  }

  async function doPrint(r) {
    let approver = null
    if (r.approval_status === 'approved' && r.approved_by) {
      const { data } = await supabase.from('profiles').select('full_name, signature_url, invoice_title').eq('id', r.approved_by).single()
      approver = data
    }
    printInvoice(r, company, approver)
  }

  async function doBatchPrint() {
    const chosen = rows.filter((r) => selected.has(r.id))
    if (chosen.length === 0) return
    const approverIds = [...new Set(chosen.filter((r) => r.approval_status === 'approved' && r.approved_by).map((r) => r.approved_by))]
    let approverMap = {}
    if (approverIds.length) {
      const { data } = await supabase.from('profiles').select('id, full_name, signature_url, invoice_title').in('id', approverIds)
      approverMap = Object.fromEntries((data || []).map((p) => [p.id, p]))
    }
    printInvoiceBatch(chosen.map((inv) => ({ inv, approver: approverMap[inv.approved_by] || null })), company)
  }

  function toggleSelect(id) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const selectedRows = useMemo(() => filtered.filter((r) => selected.has(r.id)), [filtered, selected])
  const selectedDrafts = useMemo(() => selectedRows.filter((r) => r.status === 'Draft'), [selectedRows])
  const selectedDeletable = useMemo(() => selectedRows.filter((r) => r.approval_status === 'pending'), [selectedRows])
  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id))
  const someFilteredSelected = filtered.some((r) => selected.has(r.id))

  function toggleSelectAll() {
    setSelected((s) => {
      if (allFilteredSelected) return new Set()
      const n = new Set(s)
      filtered.forEach((r) => n.add(r.id))
      return n
    })
  }

  async function doBulkSubmit() {
    if (selectedDrafts.length === 0) return
    setBulkBusy(true)
    setMsg('')
    const { data: existing } = await supabase.from('invoice_invoices').select('invoice_no').not('invoice_no', 'is', null)
    let existingNos = (existing || []).map((r) => r.invoice_no)
    const errors = []
    let ok = 0
    for (const r of selectedDrafts) {
      if (!r.customer_name || !r.invoice_date || !(r.items && r.items.length)) {
        errors.push(`${r.invoice_no || '(Draft tanpa no.)'}: data belum lengkap (customer/tanggal/item wajib diisi dulu — buka Edit).`)
        continue
      }
      let invoiceNo = r.invoice_no
      if (!invoiceNo) {
        invoiceNo = nextInvoiceNumber(existingNos, r.invoice_date, numberFormat)
        existingNos = [...existingNos, invoiceNo]
      }
      const { error } = await supabase.from('invoice_invoices').update({ status: 'Diajukan', invoice_no: invoiceNo }).eq('id', r.id)
      if (error) errors.push(`${r.invoice_no || r.id}: ${error.message}`)
      else ok++
    }
    setBulkBusy(false)
    setSelected(new Set())
    if (errors.length) setMsg(`${ok} invoice berhasil diajukan. Sebagian gagal:\n` + errors.join('\n'))
    await load()
  }

  async function doBulkDelete() {
    setBulkBusy(true)
    setMsg('')
    const errors = []
    let ok = 0
    for (const r of selectedDeletable) {
      const { error } = await supabase.from('invoice_invoices').delete().eq('id', r.id)
      if (error) errors.push(`${r.invoice_no || '(Draft)'}: ${error.message}`)
      else ok++
    }
    setBulkBusy(false)
    setBulkDeleteConfirm(false)
    setSelected(new Set())
    if (errors.length) setMsg(`${ok} invoice berhasil dihapus. Sebagian gagal:\n` + errors.join('\n'))
    await load()
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    setImportMsg('')
    try {
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      const buf = await file.arrayBuffer()
      await wb.xlsx.load(buf)

      const { data: existingInvoices } = await supabase.from('invoice_invoices').select('invoice_no')
      const existingNos = new Set((existingInvoices || []).map((r) => r.invoice_no))

      let imported = 0, skipped = 0
      const errors = []

      for (const ws of wb.worksheets) {
        if (['summary', 'gl'].includes(ws.name.toLowerCase())) continue
        try {
          const rowsData = []
          ws.eachRow({ includeEmpty: true }, (row) => {
            rowsData.push(row.values.slice(1).map((v) => (v && v.result !== undefined ? v.result : v)))
          })

          const toIdx = rowsData.findIndex((r) => r[0] && String(r[0]).trim().startsWith('TO'))
          if (toIdx === -1) { skipped++; continue }
          const customerName = rowsData[toIdx + 1] ? String(rowsData[toIdx + 1][0] || '').trim() : ''
          const addressLines = []
          let i = toIdx + 2
          while (i < rowsData.length && rowsData[i][0] && !String(rowsData[i][0]).trim().startsWith('ATTN')) {
            addressLines.push(String(rowsData[i][0]).trim())
            i++
          }
          let attn = ''
          if (rowsData[i] && String(rowsData[i][0]).trim().startsWith('ATTN')) attn = String(rowsData[i][1] || '').trim()

          let invoiceDate = null, dueDate = null, invoiceNo = null, headerRowIdx = -1
          const toISO = (v) => {
            if (v instanceof Date) return v.toISOString().slice(0, 10)
            if (typeof v === 'number') { const ms = Math.floor(v - 25569) * 86400 * 1000; return new Date(ms).toISOString().slice(0, 10) }
            return null
          }
          for (let r = 0; r < rowsData.length; r++) {
            const row = rowsData[r]
            if (!row) continue
            for (let c = 0; c < row.length; c++) {
              const cell = row[c]
              if (typeof cell !== 'string') continue
              const label = cell.trim().toUpperCase()
              if (label.startsWith('INVOICE DATE')) invoiceDate = toISO(row[c + 1])
              else if (label.startsWith('DUE DATE')) dueDate = toISO(row[c + 1])
              else if (label.startsWith('INVOICE NO')) invoiceNo = String(row[c + 1] || '').trim()
            }
            if (row[0] === 'NO.' && String(row[1] || '').toUpperCase().startsWith('ITEM')) { headerRowIdx = r; break }
          }
          if (!invoiceNo || headerRowIdx === -1) { skipped++; continue }
          if (existingNos.has(invoiceNo)) { skipped++; continue }

          const headerRow = rowsData[headerRowIdx]
          let secondCurrencyCol = -1, secondCurrencyLabel = 'USD', personsCol = 3
          for (let c = 0; c < headerRow.length; c++) {
            const v = String(headerRow[c] || '').toUpperCase()
            if (v.startsWith('AMOUNT') && !v.includes('IDR')) {
              secondCurrencyCol = c
              const m = v.match(/\(([A-Z]+)\)/)
              if (m) secondCurrencyLabel = m[1]
            }
            if (v.includes('NUMBER OF PERSONS')) personsCol = c
          }
          const idrCol = headerRow.findIndex((v) => String(v || '').toUpperCase().includes('AMOUNT (IDR)'))

          let remark = ''
          let itemStart = headerRowIdx + 1
          if (rowsData[itemStart] && rowsData[itemStart][0] && typeof rowsData[itemStart][0] !== 'number') {
            remark = String(rowsData[itemStart][1] || rowsData[itemStart][0] || '').trim()
            itemStart++
          }

          const items = []
          let r2 = itemStart
          while (r2 < rowsData.length) {
            const row = rowsData[r2]
            if (!row || row.every((v) => v === null || v === undefined || v === '')) { r2++; continue }
            if (String(row[2] || '').toUpperCase().includes('TOTAL') || String(row[3] || '').toUpperCase().includes('TOTAL')) break
            if (typeof row[0] === 'number') {
              let itemName = String(row[1] || '').trim()
              if (!itemName) itemName = remark || `Item ${row[0]}`
              let amount = null
              if (idrCol !== -1 && typeof row[idrCol] === 'number' && row[idrCol] !== 0) amount = row[idrCol]
              else if (secondCurrencyCol !== -1 && typeof row[secondCurrencyCol] === 'number') amount = row[secondCurrencyCol]
              const persons = (typeof row[personsCol] === 'number' && row[personsCol] > 0) ? row[personsCol] : 1
              if (itemName && amount !== null) items.push({ item_name: itemName, qty: persons, amount: amount / persons })
            }
            r2++
          }
          if (items.length === 0) { skipped++; continue }

          const { data: inv, error: invErr } = await supabase.from('invoice_invoices').insert({
            invoice_no: invoiceNo, invoice_date: invoiceDate || '2026-01-01', due_date: dueDate,
            customer_name: customerName || 'Unknown', customer_address: addressLines.join(', '),
            attn, currency: 'IDR', batch: '', remark, status: 'Draft', approval_status: 'pending',
            created_by: profile.id,
          }).select().single()
          if (invErr) { errors.push(`${ws.name}: ${invErr.message}`); continue }

          const { error: itemErr } = await supabase.from('invoice_items').insert(items.map((it) => ({ ...it, invoice_id: inv.id })))
          if (itemErr) { errors.push(`${ws.name} (items): ${itemErr.message}`); continue }

          existingNos.add(invoiceNo)
          imported++
        } catch (err) {
          errors.push(`${ws.name}: ${err.message}`)
        }
      }

      setImportMsg(`Selesai: ${imported} invoice berhasil diimpor sebagai Draft (cek & Ajukan manual di daftar di bawah), ${skipped} dilewati.${errors.length ? ' Error: ' + errors.slice(0, 3).join('; ') : ''}`)
      load()
    } catch (err) {
      setImportMsg('Gagal membaca file: ' + err.message + ' — pastikan file berformat .xlsx (kalau file lama masih .xls, buka & simpan ulang sebagai .xlsx di Excel dulu).')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input placeholder="Cari no. invoice / customer / batch..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 240 }} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label className="btn btn-sm btn-neutral" style={{ cursor: importing ? 'wait' : 'pointer' }}>
            {importing ? 'Mengimpor...' : 'Import dari Excel'}
            <input type="file" accept=".xlsx" onChange={handleImportFile} disabled={importing} style={{ display: 'none' }} />
          </label>
        </div>
      </div>

      {importMsg && <div className="error-text" style={{ marginBottom: 10, whiteSpace: 'pre-line' }}>{importMsg}</div>}
      {msg && <div className="error-text" style={{ color: 'var(--danger)', marginBottom: 10, whiteSpace: 'pre-line' }}>{msg}</div>}

      {someFilteredSelected && (
        <div className="bulk-bar">
          <span className="bulk-count">{selected.size} invoice dipilih</span>
          <div className="bulk-actions">
            <button className="btn btn-sm btn-neutral" disabled={bulkBusy} onClick={doBatchPrint}>
              <Icon name="printer" size={12} /> Print
            </button>
            <button className="btn btn-sm btn-primary" disabled={bulkBusy || selectedDrafts.length === 0} onClick={doBulkSubmit} title={selectedDrafts.length === 0 ? 'Tidak ada Draft yang dipilih' : ''}>
              {bulkBusy ? 'Memproses...' : `Ajukan Draft (${selectedDrafts.length})`}
            </button>
            <button className="btn btn-sm btn-danger" disabled={bulkBusy || selectedDeletable.length === 0} onClick={() => setBulkDeleteConfirm(true)} title={selectedDeletable.length === 0 ? 'Tidak ada yang bisa dihapus (sudah disetujui)' : ''}>
              <Icon name="trash" size={12} /> Hapus ({selectedDeletable.length})
            </button>
            <button className="btn btn-sm btn-neutral" onClick={() => setSelected(new Set())}>Batal Pilih</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="empty-state">Memuat...</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">Belum ada invoice. Buat invoice baru lewat menu Submit → Submit Invoice.</div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    ref={(el) => { if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected }}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th>No. Invoice</th><th>Tanggal</th><th>Customer</th><th>Total</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const total = invoiceTotal(r.items)
                const locked = r.approval_status === 'approved'
                return (
                  <tr key={r.id}>
                    <td><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} /></td>
                    <td>{r.invoice_no || <em style={{ color: 'var(--text-muted)' }}>Draft</em>}</td>
                    <td>{r.invoice_date || '-'}</td>
                    <td>{r.customer_name || '-'}</td>
                    <td>{r.currency === 'IDR' ? numFmt(total) : `${numFmt(total)} (≈ ${numFmtValuta(r.exchange_rate ? total / r.exchange_rate : 0, r.currency)} ${r.currency})`}</td>
                    <td>
                      {r.status === 'Draft'
                        ? <span className="badge badge-draft">Draft</span>
                        : r.approval_status === 'approved'
                          ? <span className="badge badge-approved">Disetujui</span>
                          : <span className="badge badge-submitted">Menunggu Approval</span>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', display: 'flex', gap: 6 }}>
                      <button className="btn btn-sm btn-neutral" onClick={() => doPrint(r)}><Icon name="printer" size={12} /></button>
                      {!locked && <button className="btn btn-sm btn-neutral" onClick={() => setEditingRow(r)}><Icon name="edit" size={12} /></button>}
                      {!locked && <button className="btn btn-sm btn-danger" onClick={() => setDeleteTarget(r)}><Icon name="trash" size={12} /></button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editingRow && (
        <Portal>
          <div className="modal-overlay" onClick={() => setEditingRow(null)}>
            <div className="modal-box" style={{ width: 780, maxWidth: '98vw' }} onClick={(e) => e.stopPropagation()}>
              <span className="modal-close" onClick={() => setEditingRow(null)}><Icon name="x" size={16} /></span>
              <h3>Edit Invoice {editingRow.invoice_no || '(Draft)'}</h3>
              <InvoiceForm
                key={editingRow.id}
                profile={profile}
                customers={customers}
                numberFormat={numberFormat}
                exchangeRates={exchangeRates}
                invoice={editingRow}
                onCancel={() => setEditingRow(null)}
                onSaved={() => { setEditingRow(null); load() }}
              />
            </div>
          </div>
        </Portal>
      )}

      {deleteTarget && (
        <Portal>
          <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
            <div className="modal-box confirm-modal" onClick={(e) => e.stopPropagation()}>
              <p>Hapus invoice <strong>{deleteTarget.invoice_no || '(Draft)'}</strong>? Tindakan ini tidak bisa dibatalkan.</p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
                <button className="btn btn-neutral" onClick={() => setDeleteTarget(null)}>Batal</button>
                <button className="btn btn-danger" disabled={saving} onClick={doDelete}>{saving ? 'Menghapus...' : 'Ya, Hapus'}</button>
              </div>
            </div>
          </div>
        </Portal>
      )}
      {bulkDeleteConfirm && (
        <Portal>
          <div className="modal-overlay" onClick={() => !bulkBusy && setBulkDeleteConfirm(false)}>
            <div className="modal-box confirm-modal" onClick={(e) => e.stopPropagation()}>
              <p>
                Hapus <strong>{selectedDeletable.length} invoice</strong> yang dipilih (belum disetujui)?
                {selectedRows.length !== selectedDeletable.length && (
                  <><br /><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {selectedRows.length - selectedDeletable.length} invoice lain yang dipilih dilewati karena sudah disetujui.
                  </span></>
                )}
                <br />Tindakan ini tidak bisa dibatalkan.
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
                <button className="btn btn-neutral" onClick={() => setBulkDeleteConfirm(false)}>Batal</button>
                <button className="btn btn-danger" disabled={bulkBusy} onClick={doBulkDelete}>{bulkBusy ? 'Menghapus...' : 'Ya, Hapus'}</button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  )
}
