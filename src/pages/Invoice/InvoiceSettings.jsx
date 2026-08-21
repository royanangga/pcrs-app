import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import Icon from '../../icons.jsx'

const QUARTERS = [
  { key: 'Q1', label: 'Q1 (Jan–Mar)' },
  { key: 'Q2', label: 'Q2 (Apr–Jun)' },
  { key: 'Q3', label: 'Q3 (Jul–Sep)' },
  { key: 'Q4', label: 'Q4 (Okt–Des)' },
]

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

// Catatan: tanda tangan pribadi untuk approval invoice memakai `signature_url`
// yang SAMA dengan tanda tangan slip reimbursement PCRS (diatur di menu
// "Tanda Tangan Saya"), jadi tidak ada pengaturan tanda tangan terpisah di sini.
export default function InvoiceSettings({ profile }) {
  const [tab, setTab] = useState('company')
  const [company, setCompany] = useState({})
  const [customers, setCustomers] = useState([])
  const [numberFormat, setNumberFormat] = useState('')
  const [exchangeRates, setExchangeRates] = useState({})
  const [selectedYear, setSelectedYear] = useState(String(new Date().getFullYear()))
  const [newYearInput, setNewYearInput] = useState('')
  const [newCurrencyCode, setNewCurrencyCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('invoice_settings').select('*')
    const map = Object.fromEntries((data || []).map((r) => [r.key, r.value]))
    setCompany(map.company || {})
    setCustomers(map.customers || [])
    setNumberFormat(map.number_format || '{seq}/INV/FJI-FA/{roman}/{year}')
    setExchangeRates(map.exchange_rates || {})
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function saveSetting(key, value) {
    setSaving(true)
    setMsg('')
    const { error } = await supabase.from('invoice_settings').upsert({ key, value })
    setSaving(false)
    if (error) setMsg('Gagal menyimpan: ' + error.message)
    else setMsg('Tersimpan.')
  }

  async function handleLogo(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const dataUrl = await fileToDataUrl(file)
    setCompany((c) => ({ ...c, logo: dataUrl }))
  }

  function updateCustomer(i, field, value) {
    setCustomers((cs) => cs.map((c, idx) => (idx === i ? { ...c, [field]: value } : c)))
  }
  function addCustomer() { setCustomers((cs) => [...cs, { name: '', address: '', attn: '', currency: 'IDR', code: '' }]) }
  function removeCustomer(i) { setCustomers((cs) => cs.filter((_, idx) => idx !== i)) }

  const years = useMemo(() => {
    const ys = new Set(Object.keys(exchangeRates))
    ys.add(selectedYear)
    return [...ys].sort()
  }, [exchangeRates, selectedYear])

  const currencyRows = useMemo(() => {
    const fromYear = Object.keys(exchangeRates[selectedYear] || {})
    return [...new Set(['USD', 'JPY', ...fromYear])]
  }, [exchangeRates, selectedYear])

  function addYear() {
    const y = newYearInput.trim()
    if (!/^\d{4}$/.test(y)) return
    setExchangeRates((er) => ({ ...er, [y]: er[y] || {} }))
    setSelectedYear(y)
    setNewYearInput('')
  }

  function updateRate(cur, q, value) {
    setExchangeRates((er) => ({
      ...er,
      [selectedYear]: {
        ...(er[selectedYear] || {}),
        [cur]: { ...(er[selectedYear]?.[cur] || {}), [q]: value },
      },
    }))
  }

  function addCurrencyRow() {
    const code = newCurrencyCode.trim().toUpperCase()
    if (!code) return
    setExchangeRates((er) => ({
      ...er,
      [selectedYear]: { ...(er[selectedYear] || {}), [code]: (er[selectedYear] || {})[code] || {} },
    }))
    setNewCurrencyCode('')
  }

  function removeCurrencyRow(cur) {
    setExchangeRates((er) => {
      const yearData = { ...(er[selectedYear] || {}) }
      delete yearData[cur]
      return { ...er, [selectedYear]: yearData }
    })
  }

  if (loading) return <div className="card"><div className="empty-state">Memuat...</div></div>

  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${tab === 'company' ? 'btn-primary' : 'btn-neutral'}`} onClick={() => setTab('company')}>Data Perusahaan</button>
        <button className={`btn btn-sm ${tab === 'customers' ? 'btn-primary' : 'btn-neutral'}`} onClick={() => setTab('customers')}>Daftar Customer</button>
        <button className={`btn btn-sm ${tab === 'format' ? 'btn-primary' : 'btn-neutral'}`} onClick={() => setTab('format')}>Format Nomor</button>
        <button className={`btn btn-sm ${tab === 'exchange' ? 'btn-primary' : 'btn-neutral'}`} onClick={() => setTab('exchange')}>Exchange Rate</button>
      </div>

      {msg && <div className="error-text" style={{ marginBottom: 10, color: msg.startsWith('Gagal') ? 'var(--danger)' : 'var(--success)' }}>{msg}</div>}

      {tab === 'company' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxWidth: 700 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label>Logo Perusahaan</label>
            {company.logo && <div style={{ marginBottom: 6 }}><img src={company.logo} alt="logo" style={{ height: 60 }} /></div>}
            <input type="file" accept="image/*" onChange={handleLogo} />
          </div>
          <div><label>Nama Perusahaan</label><input value={company.name || ''} onChange={(e) => setCompany({ ...company, name: e.target.value })} /></div>
          <div><label>Subtitle</label><input value={company.subtitle || ''} onChange={(e) => setCompany({ ...company, subtitle: e.target.value })} /></div>
          <div><label>Alamat baris 1</label><input value={company.address_line1 || ''} onChange={(e) => setCompany({ ...company, address_line1: e.target.value })} /></div>
          <div><label>Alamat baris 2</label><input value={company.address_line2 || ''} onChange={(e) => setCompany({ ...company, address_line2: e.target.value })} /></div>
          <div><label>Telp/Fax</label><input value={company.phone || ''} onChange={(e) => setCompany({ ...company, phone: e.target.value })} /></div>
          <div><label>Nama Bank</label><input value={company.bank_name || ''} onChange={(e) => setCompany({ ...company, bank_name: e.target.value })} /></div>
          <div><label>Cabang Bank</label><input value={company.bank_branch || ''} onChange={(e) => setCompany({ ...company, bank_branch: e.target.value })} /></div>
          <div><label>Swift Code</label><input value={company.swift_code || ''} onChange={(e) => setCompany({ ...company, swift_code: e.target.value })} /></div>
          <div><label>No. Rekening</label><input value={company.account_number || ''} onChange={(e) => setCompany({ ...company, account_number: e.target.value })} /></div>
          <div><label>Nama Penandatangan (cadangan)</label><input value={company.signer_name || ''} onChange={(e) => setCompany({ ...company, signer_name: e.target.value })} /></div>
          <div><label>Jabatan Penandatangan (cadangan)</label><input value={company.signer_title || ''} onChange={(e) => setCompany({ ...company, signer_title: e.target.value })} /></div>
          <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--text-muted)' }}>
            "Penandatangan (cadangan)" ini hanya dipakai kalau invoice sudah disetujui tapi manager yang meng-approve
            belum mengisi tanda tangan/jabatan di menu <strong>Tanda Tangan Saya</strong>.
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <button className="btn btn-primary" disabled={saving} onClick={() => saveSetting('company', company)}>{saving ? 'Menyimpan...' : 'Simpan Data Perusahaan'}</button>
          </div>
        </div>
      )}

      {tab === 'customers' && (
        <div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Nama Customer</th><th>Alamat</th><th>ATTN</th><th style={{ width: 100 }}>Currency</th><th style={{ width: 90 }}>Kode</th><th></th></tr></thead>
              <tbody>
                {customers.map((c, i) => (
                  <tr key={i}>
                    <td><input value={c.name} onChange={(e) => updateCustomer(i, 'name', e.target.value)} /></td>
                    <td><input value={c.address} onChange={(e) => updateCustomer(i, 'address', e.target.value)} /></td>
                    <td><input value={c.attn || ''} onChange={(e) => updateCustomer(i, 'attn', e.target.value)} placeholder="mis. Bpk/Ibu ..." /></td>
                    <td>
                      <select value={c.currency} onChange={(e) => updateCustomer(i, 'currency', e.target.value)}>
                        <option value="IDR">IDR</option><option value="USD">USD</option><option value="JPY">JPY</option>
                      </select>
                    </td>
                    <td><input value={c.code} onChange={(e) => updateCustomer(i, 'code', e.target.value)} /></td>
                    <td><button className="btn btn-sm btn-danger" onClick={() => removeCustomer(i)}><Icon name="trash" size={11} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn btn-sm btn-neutral" onClick={addCustomer}>+ Tambah Customer</button>
            <button className="btn btn-primary btn-sm" disabled={saving} onClick={() => saveSetting('customers', customers)}>{saving ? 'Menyimpan...' : 'Simpan Daftar Customer'}</button>
          </div>
        </div>
      )}

      {tab === 'format' && (
        <div style={{ maxWidth: 500 }}>
          <label>Format Nomor Invoice</label>
          <input value={numberFormat} onChange={(e) => setNumberFormat(e.target.value)} />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            Placeholder yang bisa dipakai: <code>{'{seq}'}</code> (nomor urut 3 digit), <code>{'{roman}'}</code> (angka romawi bulan), <code>{'{year}'}</code> (tahun).
          </div>
          <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={saving} onClick={() => saveSetting('number_format', numberFormat)}>{saving ? 'Menyimpan...' : 'Simpan Format'}</button>
        </div>
      )}

      {tab === 'exchange' && (
        <div style={{ maxWidth: 650 }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: -4, marginBottom: 14 }}>
            Isi kurs per kuartal di sini. Saat bikin invoice, Exchange Rate otomatis terisi sesuai
            mata uang & tanggal invoice yang dipilih (kuartal ditentukan dari tanggalnya) — tetap
            bisa diubah manual per invoice kalau memang perlu beda dari kurs standar ini.
          </p>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <label style={{ marginBottom: 0 }}>Tahun</label>
            <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} style={{ width: 110 }}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <input
              type="text" inputMode="numeric" placeholder="mis. 2027" value={newYearInput}
              onChange={(e) => setNewYearInput(e.target.value)} style={{ width: 90 }}
            />
            <button className="btn btn-sm btn-neutral" onClick={addYear}>+ Tambah Tahun</button>
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Mata Uang</th>
                  {QUARTERS.map((q) => <th key={q.key}>{q.label}</th>)}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {currencyRows.map((cur) => (
                  <tr key={cur}>
                    <td>{cur}</td>
                    {QUARTERS.map((q) => (
                      <td key={q.key}>
                        <input
                          type="number" step="any" style={{ width: 110 }}
                          value={exchangeRates[selectedYear]?.[cur]?.[q.key] ?? ''}
                          onChange={(e) => updateRate(cur, q.key, e.target.value)}
                        />
                      </td>
                    ))}
                    <td>
                      {!['USD', 'JPY'].includes(cur) && (
                        <button className="btn btn-sm btn-danger" onClick={() => removeCurrencyRow(cur)}><Icon name="trash" size={11} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              placeholder="Kode mata uang baru, mis. SGD" value={newCurrencyCode}
              onChange={(e) => setNewCurrencyCode(e.target.value)} style={{ width: 180 }}
            />
            <button className="btn btn-sm btn-neutral" onClick={addCurrencyRow}>+ Tambah Mata Uang</button>
            <button className="btn btn-primary btn-sm" disabled={saving} onClick={() => saveSetting('exchange_rates', exchangeRates)}>{saving ? 'Menyimpan...' : 'Simpan Exchange Rate'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
