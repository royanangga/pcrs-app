import React, { useState, useMemo, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { formatThousands, stripThousands } from '../../lib/helpers.js'
import { nextInvoiceNumber, dueDateOneMonthEnd, lookupExchangeRate, numFmt, numFmtValuta, invoiceTotal } from '../../lib/invoiceHelpers.js'
import Icon from '../../icons.jsx'

const emptyItem = () => ({ item_name: '', description: '', qty: '1', amount: '' })

function buildInitialForm(invoice) {
  if (!invoice) {
    return {
      invoice_date: new Date().toISOString().slice(0, 10),
      due_date: '',
      customer_name: '',
      customer_address: '',
      attn: '',
      currency: 'IDR',
      exchange_rate: '',
      batch: '',
      remark: '',
      items: [emptyItem()],
    }
  }
  return {
    invoice_date: invoice.invoice_date || '',
    due_date: invoice.due_date || '',
    customer_name: invoice.customer_name || '',
    customer_address: invoice.customer_address || '',
    attn: invoice.attn || '',
    currency: invoice.currency || 'IDR',
    exchange_rate: invoice.exchange_rate || '',
    batch: invoice.batch || '',
    remark: invoice.remark || '',
    items: (invoice.items || []).length
      ? invoice.items.map((it) => ({ id: it.id, item_name: it.item_name, description: it.description || '', qty: String(it.qty ?? 1), amount: String(it.amount ?? '') }))
      : [emptyItem()],
  }
}

// Form isi/edit 1 invoice. Dipakai di 2 tempat:
//  - Halaman penuh "Submit Invoice" (invoice = null, bikin baru, form ke-reset
//    otomatis setelah simpan supaya bisa lanjut isi invoice berikutnya)
//  - Modal Edit di "Pengajuan Saya" > tab Pengajuan Invoice (invoice = row yang
//    diedit, tampilkan tombol Batal, modal ditutup lewat onSaved/onCancel)
export default function InvoiceForm({ profile, customers, numberFormat, exchangeRates, invoice, onSaved, onCancel }) {
  const [form, setForm] = useState(() => buildInitialForm(invoice))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  // Due date & exchange rate otomatis cuma jalan selama user belum pernah
  // ketik manual di field-nya sendiri (supaya tidak menimpa isian yang
  // sudah disesuaikan tangan). Default aktif kalau nilai awalnya kosong.
  const [dueDateAuto, setDueDateAuto] = useState(() => !buildInitialForm(invoice).due_date)
  const [exchangeRateAuto, setExchangeRateAuto] = useState(() => !buildInitialForm(invoice).exchange_rate)

  // Preview nomor invoice: cuma dihitung kalau invoice ini belum punya
  // nomor resmi (draft baru / draft lama yang belum diajukan). Nomor asli
  // tetap ditentukan ulang saat tombol "Simpan & Ajukan" ditekan (lihat
  // save()), jadi preview ini murni informasi, bisa berubah kalau ada
  // invoice lain yang diajukan lebih dulu.
  const fixedInvoiceNo = invoice?.invoice_no || null
  const [invoiceNoPreview, setInvoiceNoPreview] = useState('')
  const [loadingPreview, setLoadingPreview] = useState(!fixedInvoiceNo)

  useEffect(() => {
    if (fixedInvoiceNo) return
    let cancelled = false
    setLoadingPreview(true)
    supabase.from('invoice_invoices').select('invoice_no').not('invoice_no', 'is', null).then(({ data }) => {
      if (cancelled) return
      const preview = nextInvoiceNumber((data || []).map((r) => r.invoice_no), form.invoice_date, numberFormat)
      setInvoiceNoPreview(preview)
      setLoadingPreview(false)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.invoice_date, numberFormat, fixedInvoiceNo])

  function pickCustomer(name) {
    const c = customers.find((x) => x.name === name)
    setForm((f) => ({
      ...f,
      customer_name: name,
      customer_address: c?.address || f.customer_address,
      attn: c?.attn || f.attn,
      currency: c?.currency || f.currency,
    }))
  }

  function handleInvoiceDateChange(value) {
    setForm((f) => ({
      ...f,
      invoice_date: value,
      due_date: dueDateAuto ? dueDateOneMonthEnd(value) : f.due_date,
    }))
  }

  function handleDueDateChange(value) {
    setDueDateAuto(false)
    setForm((f) => ({ ...f, due_date: value }))
  }

  // Auto-isi Exchange Rate dari tabel Exchange Rate di Pengaturan Invoice,
  // berdasarkan mata uang & kuartal dari tanggal invoice yang berlaku.
  useEffect(() => {
    if (!exchangeRateAuto) return
    if (form.currency === 'IDR') return
    const rate = lookupExchangeRate(exchangeRates, form.currency, form.invoice_date)
    if (rate !== null) setForm((f) => ({ ...f, exchange_rate: String(rate) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.currency, form.invoice_date, exchangeRates, exchangeRateAuto])

  function handleExchangeRateChange(value) {
    setExchangeRateAuto(false)
    setForm((f) => ({ ...f, exchange_rate: value }))
  }

  function updateItem(i, field, value) {
    setForm((f) => {
      const items = [...f.items]
      items[i] = { ...items[i], [field]: value }
      return { ...f, items }
    })
  }
  function addItem() { setForm((f) => ({ ...f, items: [...f.items, emptyItem()] })) }
  function removeItem(i) { setForm((f) => ({ ...f, items: f.items.filter((_, idx) => idx !== i) })) }

  const formTotal = useMemo(() => invoiceTotal(form.items.map((it) => ({ amount: stripThousands(it.amount), qty: it.qty }))), [form])

  async function save(asStatus) {
    setSaving(true)
    setMsg('')
    try {
      const items = form.items
        .filter((it) => it.item_name.trim() || stripThousands(it.amount))
        .map((it) => ({ item_name: it.item_name.trim(), description: it.description.trim() || null, qty: Number(it.qty || 1), amount: Number(stripThousands(it.amount) || 0) }))

      if (asStatus === 'Diajukan') {
        if (!form.customer_name.trim()) throw new Error('Nama customer wajib diisi untuk mengajukan invoice.')
        if (!form.invoice_date) throw new Error('Tanggal invoice wajib diisi untuk mengajukan invoice.')
        if (items.length === 0) throw new Error('Minimal 1 item wajib diisi untuk mengajukan invoice.')
      }

      let invoiceNo = invoice ? invoice.invoice_no : null
      if (asStatus === 'Diajukan' && !invoiceNo) {
        const { data: existing } = await supabase.from('invoice_invoices').select('invoice_no').not('invoice_no', 'is', null)
        invoiceNo = nextInvoiceNumber((existing || []).map((r) => r.invoice_no), form.invoice_date, numberFormat)
      }

      const payload = {
        invoice_no: invoiceNo,
        invoice_date: form.invoice_date || null,
        due_date: form.due_date || null,
        customer_name: form.customer_name.trim() || null,
        customer_address: form.customer_address.trim() || null,
        attn: form.attn.trim() || null,
        currency: form.currency,
        exchange_rate: form.currency === 'IDR' ? null : (Number(form.exchange_rate) || null),
        batch: form.batch.trim() || null,
        remark: form.remark.trim() || null,
        status: asStatus,
      }

      let invoiceId
      if (!invoice) {
        payload.created_by = profile.id
        const { data, error } = await supabase.from('invoice_invoices').insert(payload).select().single()
        if (error) throw error
        invoiceId = data.id
      } else {
        const { error } = await supabase.from('invoice_invoices').update(payload).eq('id', invoice.id)
        if (error) throw error
        invoiceId = invoice.id
        await supabase.from('invoice_items').delete().eq('invoice_id', invoiceId)
      }

      if (items.length) {
        const { error: itemErr } = await supabase.from('invoice_items').insert(items.map((it) => ({ ...it, invoice_id: invoiceId })))
        if (itemErr) throw itemErr
      }

      if (!invoice) {
        // Invoice baru: reset form supaya siap dipakai isi invoice berikutnya
        // (pola yang sama dengan Submit Reimbursement).
        setForm(buildInitialForm(null))
        setDueDateAuto(true)
        setExchangeRateAuto(true)
        setMsg(`✓ Invoice ${asStatus === 'Draft' ? 'tersimpan sebagai Draft' : 'berhasil diajukan'}. Lihat & lanjutkan di menu "Pengajuan Saya" → tab "Pengajuan Invoice".`)
      }
      onSaved && onSaved(invoiceId, asStatus)
    } catch (e) {
      setMsg(e.message || 'Gagal menyimpan invoice.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label>Customer</label>
          <select value={form.customer_name} onChange={(e) => pickCustomer(e.target.value)}>
            <option value="">-- pilih atau ketik manual di bawah --</option>
            {customers.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label>Nama Customer</label>
          <input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label>Alamat Customer</label>
          <textarea rows={2} value={form.customer_address} onChange={(e) => setForm({ ...form, customer_address: e.target.value })} />
        </div>
        <div>
          <label>ATTN</label>
          <input value={form.attn} onChange={(e) => setForm({ ...form, attn: e.target.value })} />
        </div>
        <div>
          <label>Batch</label>
          <input value={form.batch} onChange={(e) => setForm({ ...form, batch: e.target.value })} />
        </div>
        <div>
          <label>Nomor Invoice</label>
          <input
            value={fixedInvoiceNo || (loadingPreview ? 'Menghitung...' : invoiceNoPreview)}
            readOnly
            disabled
            style={{ color: 'var(--text-muted)', background: 'var(--bg-subtle, #f5f5f5)' }}
          />
          {!fixedInvoiceNo && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Perkiraan — nomor pasti ditentukan saat invoice diajukan (bisa berubah kalau ada invoice lain yang diajukan lebih dulu).
            </div>
          )}
        </div>
        <div>
          <label>Tanggal Invoice</label>
          <input type="date" value={form.invoice_date} onChange={(e) => handleInvoiceDateChange(e.target.value)} />
        </div>
        <div>
          <label>Due Date{dueDateAuto ? ' (otomatis)' : ''}</label>
          <input type="date" value={form.due_date} onChange={(e) => handleDueDateChange(e.target.value)} />
        </div>
        <div>
          <label>Mata Uang</label>
          <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
            <option value="IDR">IDR</option>
            <option value="USD">USD</option>
            <option value="JPY">JPY</option>
            {[...new Set(customers.map((c) => c.currency))].filter((c) => !['IDR', 'USD', 'JPY'].includes(c)).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {form.currency !== 'IDR' && (
          <div>
            <label>Exchange Rate (1 {form.currency} = ? IDR){exchangeRateAuto ? ' (otomatis)' : ''}</label>
            <input type="number" step="any" value={form.exchange_rate} onChange={(e) => handleExchangeRateChange(e.target.value)} />
          </div>
        )}
        <div style={{ gridColumn: '1 / -1' }}>
          <label>Remark (judul grup item, opsional)</label>
          <input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
        </div>
      </div>

      <h4 style={{ marginTop: 16, marginBottom: 6 }}>Item</h4>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Nama Item</th><th>Deskripsi</th><th style={{ width: 90 }}>Qty</th><th style={{ width: 140 }}>Nominal (per unit, IDR)</th><th></th></tr></thead>
          <tbody>
            {form.items.map((it, i) => (
              <tr key={i}>
                <td><input value={it.item_name} onChange={(e) => updateItem(i, 'item_name', e.target.value)} /></td>
                <td><input value={it.description} onChange={(e) => updateItem(i, 'description', e.target.value)} /></td>
                <td><input type="number" min="0" value={it.qty} onChange={(e) => updateItem(i, 'qty', e.target.value)} /></td>
                <td>
                  <input
                    type="text" inputMode="numeric" value={formatThousands(it.amount)}
                    onChange={(e) => updateItem(i, 'amount', stripThousands(e.target.value))}
                  />
                </td>
                <td>{form.items.length > 1 && <button type="button" className="btn btn-sm btn-danger" onClick={() => removeItem(i)}><Icon name="trash" size={11} /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn btn-sm btn-neutral" style={{ marginTop: 8 }} onClick={addItem}>+ Tambah Item</button>

      <div style={{ textAlign: 'right', marginTop: 10, fontWeight: 700 }}>
        Total: {form.currency === 'IDR' ? numFmt(formTotal) : `${numFmt(formTotal)} IDR${form.exchange_rate ? ` (≈ ${numFmtValuta(formTotal / Number(form.exchange_rate), form.currency)} ${form.currency})` : ''}`}
      </div>

      {msg && <div className="error-text" style={{ color: msg.startsWith('✓') ? 'var(--success)' : 'var(--danger)', marginTop: 10, whiteSpace: 'pre-line' }}>{msg}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
        {onCancel && <button className="btn btn-neutral" disabled={saving} onClick={onCancel}>Batal</button>}
        <button className="btn btn-neutral" disabled={saving} onClick={() => save('Draft')}>{saving ? 'Menyimpan...' : 'Simpan sebagai Draft'}</button>
        <button className="btn btn-primary" disabled={saving} onClick={() => save('Diajukan')}>{saving ? 'Menyimpan...' : 'Simpan & Ajukan'}</button>
      </div>
    </div>
  )
}
