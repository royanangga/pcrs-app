import React, { useEffect, useState, useCallback } from 'react'
import QRCode from 'qrcode'
import { supabase } from './supabaseClient'
import AdminPanel from './AdminPanel.jsx'

const CATEGORIES = ['Transport', 'Meal', 'Office Supplies', 'Communication', 'Accommodation', 'Other']

const STATUS_LABEL = {
  draft: 'Draft',
  submitted: 'Menunggu Approval',
  approved: 'Menunggu Finance Verification',
  verified: 'Terverifikasi (Siap Bayar)',
  rejected: 'Ditolak',
  revision: 'Perlu Revisi',
}

function requiredRoleFor(total) {
  if (total <= 500000) return 'supervisor'
  if (total <= 5000000) return 'manager'
  return 'finance_manager'
}

function rupiah(n) {
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID')
}

function generateRequestNo() {
  const now = new Date()
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  const rand = Math.floor(Math.random() * 9000 + 1000)
  return `PCR-${ym}-${rand}`
}

function QRBadge({ value, size = 90, label }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let active = true
    QRCode.toDataURL(value, { width: size, margin: 1 }).then((url) => {
      if (active) setSrc(url)
    })
    return () => { active = false }
  }, [value, size])
  if (!src) return null
  return (
    <div className="qr-box">
      <img src={src} alt="QR Code" width={size} height={size} />
      <div>{label || 'Scan untuk verifikasi'}</div>
    </div>
  )
}

async function fetchAttachments(reimbursementId) {
  const { data } = await supabase
    .from('attachments')
    .select('*')
    .eq('reimbursement_id', reimbursementId)
  return data || []
}

function attachmentUrl(filePath) {
  return supabase.storage.from('receipts').getPublicUrl(filePath).data.publicUrl
}

function trackUrl(requestNo) {
  return `${window.location.origin}/track/${encodeURIComponent(requestNo)}`
}

// ---------------------------------------------------------------- AUTH ----
export function AuthScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('Email atau password salah.')
    setLoading(false)
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-logo">PCRS</div>
        <h2 style={{ margin: '8px 0 4px' }}>Selamat Datang</h2>
        <div className="sub">Petty Cash Reimbursement System</div>

        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="email@perusahaan.com" />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} placeholder="••••••••" />

        {error && <div className="error-text">{error}</div>}

        <button className="btn btn-primary" style={{ width: '100%', marginTop: 16 }} disabled={loading}>
          {loading ? <><span className="spinner" />Masuk...</> : 'Login'}
        </button>

        <div className="login-note">Belum punya akun? Hubungi Admin untuk mendaftar.</div>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------- SUBMIT FORM ----
function SubmitForm({ profile, onSubmitted }) {
  const [items, setItems] = useState([{ expense_date: '', category: CATEGORIES[0], description: '', amount: '' }])
  const [files, setFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const total = items.reduce((s, it) => s + (Number(it.amount) || 0), 0)

  function updateItem(i, field, value) {
    const next = [...items]
    next[i][field] = value
    setItems(next)
  }
  function addItem() {
    setItems([...items, { expense_date: '', category: CATEGORIES[0], description: '', amount: '' }])
  }
  function removeItem(i) {
    setItems(items.filter((_, idx) => idx !== i))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setMsg('')
    if (items.some((it) => !it.expense_date || !it.amount)) {
      setMsg('Lengkapi semua tanggal dan nominal item.')
      return
    }
    setSaving(true)

    const required_role = requiredRoleFor(total)
    const { data: header, error: hErr } = await supabase
      .from('reimbursements')
      .insert({
        request_no: generateRequestNo(),
        employee_id: profile.id,
        total_amount: total,
        status: 'submitted',
        required_role,
      })
      .select()
      .single()

    if (hErr) {
      setMsg('Gagal menyimpan: ' + hErr.message)
      setSaving(false)
      return
    }

    const rows = items.map((it) => ({
      reimbursement_id: header.id,
      expense_date: it.expense_date,
      category: it.category,
      description: it.description,
      amount: Number(it.amount),
    }))
    const { error: iErr } = await supabase.from('reimbursement_items').insert(rows)
    if (iErr) {
      setMsg('Gagal menyimpan item: ' + iErr.message)
      setSaving(false)
      return
    }

    await supabase.from('approval_history').insert({
      reimbursement_id: header.id,
      approver_id: profile.id,
      action: 'submitted',
      notes: 'Pengajuan dibuat oleh employee',
    })

    if (files.length > 0) {
      for (const file of files) {
        const path = `${header.id}/${Date.now()}_${file.name}`
        const { error: upErr } = await supabase.storage.from('receipts').upload(path, file)
        if (!upErr) {
          await supabase.from('attachments').insert({
            reimbursement_id: header.id,
            file_name: file.name,
            file_path: path,
          })
        }
      }
    }

    setSaving(false)
    setItems([{ expense_date: '', category: CATEGORIES[0], description: '', amount: '' }])
    setFiles([])
    setMsg(`Berhasil! Request ${header.request_no} dikirim untuk approval ${header.required_role}.`)
    onSubmitted && onSubmitted()
  }

  return (
    <div className="card">
      <h3>Pengajuan Reimbursement Baru</h3>
      <form onSubmit={handleSubmit}>
        {items.map((it, i) => (
          <div className="item-row" key={i}>
            <div>
              <label>Tanggal</label>
              <input type="date" value={it.expense_date} onChange={(e) => updateItem(i, 'expense_date', e.target.value)} required />
            </div>
            <div>
              <label>Kategori</label>
              <select value={it.category} onChange={(e) => updateItem(i, 'category', e.target.value)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label>Keterangan</label>
              <input value={it.description} onChange={(e) => updateItem(i, 'description', e.target.value)} placeholder="Opsional" />
            </div>
            <div>
              <label>Nominal</label>
              <input type="number" min="1" value={it.amount} onChange={(e) => updateItem(i, 'amount', e.target.value)} required />
            </div>
            <div>
              {items.length > 1 && (
                <button type="button" className="btn btn-danger btn-sm" onClick={() => removeItem(i)}>Hapus</button>
              )}
            </div>
          </div>
        ))}

        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-outline" style={{ background: '#f1f3f5', color: '#333' }} onClick={addItem}>
            + Tambah Item
          </button>
        </div>

        <label style={{ marginTop: 18 }}>Upload Bukti Transaksi (struk/foto, bisa lebih dari satu)</label>
        <input
          type="file"
          accept="image/*,.pdf"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files))}
        />
        {files.length > 0 && (
          <div className="checklist-line">{files.length} file dipilih: {files.map((f) => f.name).join(', ')}</div>
        )}

        <div className="total-line">Total: {rupiah(total)} &nbsp;•&nbsp; Approval level: {requiredRoleFor(total)}</div>

        {msg && <div className="error-text" style={{ color: msg.startsWith('Berhasil') ? 'var(--success)' : 'var(--danger)' }}>{msg}</div>}

        <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={saving}>
          {saving ? <><span className="spinner" />Mengirim...</> : 'Submit Reimbursement'}
        </button>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------- MY REQUESTS ----
function SkeletonTable({ cols = 4, rows = 4 }) {
  return (
    <table>
      <thead><tr>{Array(cols).fill(0).map((_, i) => <th key={i}><div className="skeleton-row short" /></th>)}</tr></thead>
      <tbody>
        {Array(rows).fill(0).map((_, i) => (
          <tr key={i}>
            {Array(cols).fill(0).map((_, j) => (
              <td key={j}><div className={`skeleton-row ${j % 2 === 0 ? 'medium' : 'short'}`} /></td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function MyRequests({ profile, refreshKey }) {
  const [rows, setRows] = useState([])
  const [loadingData, setLoadingData] = useState(true)
  const [openId, setOpenId] = useState(null)
  const [attMap, setAttMap] = useState({})

  useEffect(() => {
    async function load() {
      setLoadingData(true)
      const { data } = await supabase
        .from('reimbursements')
        .select('*')
        .eq('employee_id', profile.id)
        .order('created_at', { ascending: false })
      setRows(data || [])
      setLoadingData(false)
    }
    load()
  }, [profile.id, refreshKey])

  async function toggleOpen(id) {
    if (openId === id) { setOpenId(null); return }
    setOpenId(id)
    if (!attMap[id]) {
      const list = await fetchAttachments(id)
      setAttMap((m) => ({ ...m, [id]: list }))
    }
  }

  return (
    <div className="card">
      <h3>Pengajuan Saya</h3>
      {loadingData ? <SkeletonTable cols={5} rows={4} /> : rows.length === 0 ? (
        <div className="empty-state">Belum ada pengajuan.</div>
      ) : (
        <table>
          <thead>
            <tr><th>No. Request</th><th>Tanggal</th><th>Total</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <React.Fragment key={r.id}>
                <tr>
                  <td>{r.request_no}</td>
                  <td>{r.request_date}</td>
                  <td>{rupiah(r.total_amount)}</td>
                  <td><span className={`badge badge-${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                  <td><span className="detail-toggle" onClick={() => toggleOpen(r.id)}>{openId === r.id ? 'Tutup' : 'Detail'}</span></td>
                </tr>
                {openId === r.id && (
                  <tr>
                    <td colSpan={5}>
                      <div className="detail-box">
                        <QRBadge value={trackUrl(r.request_no)} label={`Scan untuk lacak: ${r.request_no}`} />
                        <div>
                          <strong style={{ fontSize: 13 }}>Bukti Transaksi</strong>
                          {(attMap[r.id] || []).length === 0 ? (
                            <div className="checklist-line">Belum ada file diupload.</div>
                          ) : (
                            <ul className="attachment-list">
                              {(attMap[r.id] || []).map((a) => (
                                <li key={a.id}>
                                  <a href={attachmentUrl(a.file_path)} target="_blank" rel="noreferrer">{a.file_name}</a>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- APPROVAL ----
function ApprovalQueue({ profile, refreshKey, onActed }) {
  const [rows, setRows] = useState([])
  const [empProfiles, setEmpProfiles] = useState({}) // id -> { full_name, department }
  const [noteDraft, setNoteDraft] = useState({})
  const [selected, setSelected] = useState([])         // array of row.id
  const [bulkNote, setBulkNote] = useState('')
  const [confirm, setConfirm] = useState(null)         // single: { row, action }
  const [bulkConfirm, setBulkConfirm] = useState(null) // bulk: { action }
  const [processing, setProcessing] = useState(false)

  // Finance Manager dan Admin: lihat semua departemen, semua level
  const canSeeAll = profile.role === 'finance_manager' || profile.role === 'admin'

  useEffect(() => {
    async function load() {
      // Ambil semua reimbursement status submitted, beserta data department karyawan
      let query = supabase
        .from('reimbursements')
        .select('*, profiles(id, full_name, department)')
        .eq('status', 'submitted')

      // Kalau bukan finance_manager/admin: batasi ke role yang sesuai dulu
      if (!canSeeAll) query = query.eq('required_role', profile.role)

      const { data } = await query.order('created_at', { ascending: true })

      // Filter tambahan di client: kalau bukan canSeeAll,
      // hanya tampilkan pengajuan dari departemen yang sama
      const filtered = canSeeAll
        ? (data || [])
        : (data || []).filter((r) => r.profiles?.department === profile.department)

      setRows(filtered)

      // Simpan map profil untuk ditampilkan di tabel & modal
      const map = {}
      ;(filtered).forEach((r) => {
        if (r.profiles) map[r.employee_id] = r.profiles
      })
      setEmpProfiles(map)
    }
    load()
  }, [profile.role, profile.department, refreshKey, canSeeAll])

  function requestAct(row, action) {
    setConfirm({ row, action })
  }

  async function confirmAct() {
    const { row, action } = confirm
    const newStatus = action === 'approved' ? 'approved' : action === 'rejected' ? 'rejected' : 'revision'
    setProcessing(true)
    await supabase.from('reimbursements').update({ status: newStatus }).eq('id', row.id)
    await supabase.from('approval_history').insert({
      reimbursement_id: row.id,
      approver_id: profile.id,
      action: newStatus,
      notes: noteDraft[row.id] || null,
    })
    setProcessing(false)
    setConfirm(null)
    onActed && onActed()
  }

  // ---- Select helpers ----
  const allSelected = rows.length > 0 && selected.length === rows.length
  const someSelected = selected.length > 0 && selected.length < rows.length

  function toggleOne(id) {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }
  function toggleAll() {
    setSelected(allSelected ? [] : rows.map((r) => r.id))
  }

  // ---- Bulk confirm action ----
  async function confirmBulkAct() {
    const { action } = bulkConfirm
    const newStatus = action === 'approved' ? 'approved' : action === 'rejected' ? 'rejected' : 'revision'
    setProcessing(true)
    for (const id of selected) {
      await supabase.from('reimbursements').update({ status: newStatus }).eq('id', id)
      await supabase.from('approval_history').insert({
        reimbursement_id: id,
        approver_id: profile.id,
        action: newStatus,
        notes: bulkNote || `Bulk ${action}`,
      })
    }
    setProcessing(false)
    setBulkConfirm(null)
    setSelected([])
    setBulkNote('')
    onActed && onActed()
  }

  const ACTION_META = {
    approved: { label: 'Approve', color: 'var(--success)', icon: '✓', desc: 'Pengajuan akan diteruskan ke Finance Verification.' },
    rejected: { label: 'Reject', color: 'var(--danger)', icon: '✕', desc: 'Pengajuan akan ditolak dan employee akan diberitahu.' },
    revision: { label: 'Kembalikan untuk Revisi', color: '#b35900', icon: '↩', desc: 'Pengajuan dikembalikan ke employee untuk diperbaiki.' },
  }

  const queueLabel = canSeeAll
    ? 'Semua Departemen'
    : `Dept. ${profile.department} — Level: ${profile.role}`

  return (
    <>
      <div className="card">
        <h3>Antrian Approval <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 13 }}>({queueLabel})</span></h3>

        {/* Bulk action bar — muncul saat ada yang dipilih */}
        {selected.length > 0 && (
          <div className="bulk-bar">
            <span className="bulk-count">{selected.length} pengajuan dipilih</span>
            <div className="bulk-actions">
              <input
                className="bulk-note-input"
                placeholder="Catatan bulk (opsional)"
                value={bulkNote}
                onChange={(e) => setBulkNote(e.target.value)}
              />
              <button className="btn btn-success btn-sm" onClick={() => setBulkConfirm({ action: 'approved' })}>✓ Approve Semua</button>
              <button className="btn btn-danger btn-sm" onClick={() => setBulkConfirm({ action: 'rejected' })}>✕ Reject Semua</button>
              <button className="btn btn-sm" style={{ background: '#ffe6cc', color: '#b35900' }} onClick={() => setBulkConfirm({ action: 'revision' })}>↩ Revisi Semua</button>
              <button className="btn btn-sm" style={{ background: '#eee', color: '#555' }} onClick={() => setSelected([])}>Batal Pilih</button>
            </div>
          </div>
        )}

        {rows.length === 0 ? (
          <div className="empty-state">Tidak ada pengajuan dari departemen Anda yang menunggu approval.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    style={{ width: 15, height: 15, cursor: 'pointer' }}
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected }}
                    onChange={toggleAll}
                  />
                </th>
                <th>No. Request</th><th>Employee</th><th>Departemen</th><th>Total</th><th>Catatan</th><th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={selected.includes(r.id) ? 'row-selected' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      style={{ width: 15, height: 15, cursor: 'pointer' }}
                      checked={selected.includes(r.id)}
                      onChange={() => toggleOne(r.id)}
                    />
                  </td>
                  <td>{r.request_no}</td>
                  <td>{empProfiles[r.employee_id]?.full_name || '—'}</td>
                  <td><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{empProfiles[r.employee_id]?.department || '—'}</span></td>
                  <td>{rupiah(r.total_amount)}</td>
                  <td style={{ minWidth: 150 }}>
                    <input
                      placeholder="Catatan (opsional)"
                      value={noteDraft[r.id] || ''}
                      onChange={(e) => setNoteDraft({ ...noteDraft, [r.id]: e.target.value })}
                    />
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-success btn-sm" onClick={() => requestAct(r, 'approved')}>✓</button>{' '}
                    <button className="btn btn-danger btn-sm" onClick={() => requestAct(r, 'rejected')}>✕</button>{' '}
                    <button className="btn btn-sm" style={{ background: '#ffe6cc', color: '#b35900' }} onClick={() => requestAct(r, 'revision')}>↩</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {confirm && (
        <div className="modal-overlay" onClick={() => !processing && setConfirm(null)}>
          <div className="modal-box confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon" style={{ color: ACTION_META[confirm.action].color }}>
              {ACTION_META[confirm.action].icon}
            </div>
            <h3 className="confirm-title">Konfirmasi {ACTION_META[confirm.action].label}</h3>
            <p className="confirm-desc">{ACTION_META[confirm.action].desc}</p>

            <div className="confirm-detail">
              <div className="confirm-row"><span>No. Request</span><strong>{confirm.row.request_no}</strong></div>
              <div className="confirm-row"><span>Employee</span><strong>{empProfiles[confirm.row.employee_id]?.full_name || '—'}</strong></div>
              <div className="confirm-row"><span>Departemen</span><strong>{empProfiles[confirm.row.employee_id]?.department || '—'}</strong></div>
              <div className="confirm-row"><span>Total</span><strong>{rupiah(confirm.row.total_amount)}</strong></div>
              {noteDraft[confirm.row.id] && (
                <div className="confirm-row"><span>Catatan</span><strong>{noteDraft[confirm.row.id]}</strong></div>
              )}
            </div>

            <div className="confirm-actions">
              <button
                className="btn"
                style={{ background: '#f1f3f5', color: '#333', flex: 1 }}
                onClick={() => setConfirm(null)}
                disabled={processing}
              >
                Batal
              </button>
              <button
                className="btn"
                style={{ background: ACTION_META[confirm.action].color, color: '#fff', flex: 1 }}
                onClick={confirmAct}
                disabled={processing}
              >
                {processing ? <><span className="spinner" />{`${ACTION_META[confirm.action].label}...`}</> : `Ya, ${ACTION_META[confirm.action].label}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Bulk Confirm Modal ---- */}
      {bulkConfirm && (
        <div className="modal-overlay" onClick={() => !processing && setBulkConfirm(null)}>
          <div className="modal-box confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon" style={{ color: ACTION_META[bulkConfirm.action].color }}>
              {ACTION_META[bulkConfirm.action].icon}
            </div>
            <h3 className="confirm-title">Bulk {ACTION_META[bulkConfirm.action].label}</h3>
            <p className="confirm-desc">
              Anda akan {ACTION_META[bulkConfirm.action].label.toLowerCase()} <strong>{selected.length} pengajuan</strong> sekaligus.
              Aksi ini tidak bisa dibatalkan.
            </p>

            <div className="confirm-detail">
              {selected.map((id) => {
                const r = rows.find((x) => x.id === id)
                return r ? (
                  <div className="confirm-row" key={id}>
                    <span>{r.request_no}</span>
                    <strong>{rupiah(r.total_amount)}</strong>
                  </div>
                ) : null
              })}
              <div className="confirm-row" style={{ borderTop: '2px solid var(--border)', marginTop: 4, paddingTop: 8 }}>
                <span>Total keseluruhan</span>
                <strong>{rupiah(rows.filter((r) => selected.includes(r.id)).reduce((s, r) => s + Number(r.total_amount), 0))}</strong>
              </div>
            </div>

            {bulkNote && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                Catatan: <em>{bulkNote}</em>
              </div>
            )}

            <div className="confirm-actions">
              <button className="btn" style={{ background: '#f1f3f5', color: '#333', flex: 1 }} onClick={() => setBulkConfirm(null)} disabled={processing}>
                Batal
              </button>
              <button
                className="btn"
                style={{ background: ACTION_META[bulkConfirm.action].color, color: '#fff', flex: 1 }}
                onClick={confirmBulkAct}
                disabled={processing}
              >
                {processing
                  ? <><span className="spinner" />Memproses {selected.length} pengajuan...</>
                  : `Ya, ${ACTION_META[bulkConfirm.action].label} ${selected.length} Pengajuan`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------- FINANCE VERIFICATION ----
function FinanceVerification({ profile, refreshKey, onActed }) {
  const [rows, setRows] = useState([])
  const [names, setNames] = useState({})
  const [openId, setOpenId] = useState(null)
  const [attMap, setAttMap] = useState({})
  const [noteDraft, setNoteDraft] = useState({})

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('reimbursements')
        .select('*')
        .eq('status', 'approved')
        .order('created_at', { ascending: true })
      setRows(data || [])
      if (data && data.length) {
        const ids = [...new Set(data.map((r) => r.employee_id))]
        const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids)
        const map = {}
        (profs || []).forEach((p) => { map[p.id] = p.full_name })
        setNames(map)
      }
    }
    load()
  }, [refreshKey])

  async function toggleOpen(id) {
    if (openId === id) { setOpenId(null); return }
    setOpenId(id)
    if (!attMap[id]) {
      const list = await fetchAttachments(id)
      setAttMap((m) => ({ ...m, [id]: list }))
    }
  }

  async function act(row, action) {
    const newStatus = action === 'verified' ? 'verified' : 'revision'
    await supabase.from('reimbursements').update({ status: newStatus }).eq('id', row.id)
    await supabase.from('approval_history').insert({
      reimbursement_id: row.id,
      approver_id: profile.id,
      action: newStatus,
      notes: noteDraft[row.id] || null,
    })
    onActed && onActed()
  }

  return (
    <div className="card">
      <h3>Finance Verification</h3>
      {rows.length === 0 ? (
        <div className="empty-state">Tidak ada pengajuan yang menunggu verifikasi finance.</div>
      ) : (
        <table>
          <thead>
            <tr><th>No. Request</th><th>Employee</th><th>Total</th><th>Bukti & Catatan</th><th>Aksi</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <React.Fragment key={r.id}>
                <tr>
                  <td>{r.request_no}</td>
                  <td>{names[r.employee_id] || '—'}</td>
                  <td>{rupiah(r.total_amount)}</td>
                  <td>
                    <span className="detail-toggle" onClick={() => toggleOpen(r.id)}>
                      {openId === r.id ? 'Tutup detail' : 'Lihat bukti transaksi'}
                    </span>
                    <input
                      placeholder="Catatan verifikasi (opsional)"
                      style={{ marginTop: 6 }}
                      value={noteDraft[r.id] || ''}
                      onChange={(e) => setNoteDraft({ ...noteDraft, [r.id]: e.target.value })}
                    />
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-success btn-sm" onClick={() => act(r, 'verified')}>Verifikasi</button>{' '}
                    <button className="btn btn-sm" style={{ background: '#ffe6cc', color: '#b35900' }} onClick={() => act(r, 'revision')}>Kembalikan</button>
                  </td>
                </tr>
                {openId === r.id && (
                  <tr>
                    <td colSpan={5}>
                      <div className="detail-box">
                        <QRBadge value={trackUrl(r.request_no)} label={`Scan untuk lacak: ${r.request_no}`} />
                        <div>
                          <strong style={{ fontSize: 13 }}>Checklist Verifikasi</strong>
                          <div className="checklist-line">☐ Struk/bukti sesuai nominal</div>
                          <div className="checklist-line">☐ Tidak ada duplikasi pengajuan</div>
                          <div className="checklist-line">☐ Sesuai budget department</div>
                          <strong style={{ fontSize: 13, display: 'block', marginTop: 8 }}>File Bukti Transaksi</strong>
                          {(attMap[r.id] || []).length === 0 ? (
                            <div className="checklist-line">Tidak ada file diupload oleh employee.</div>
                          ) : (
                            <ul className="attachment-list">
                              {(attMap[r.id] || []).map((a) => (
                                <li key={a.id}>
                                  <a href={attachmentUrl(a.file_path)} target="_blank" rel="noreferrer">{a.file_name}</a>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- DASHBOARD ----
function Dashboard({ refreshKey, profile }) {
  const [all, setAll] = useState([])
  const [loadingData, setLoadingData] = useState(true)
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterDept, setFilterDept] = useState('all')
  const [filterCategory, setFilterCategory] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [qrModal, setQrModal] = useState(null)

  async function printSlip(r) {
    // Ambil detail item
    const { data: items } = await supabase
      .from('reimbursement_items')
      .select('*')
      .eq('reimbursement_id', r.id)
      .order('expense_date')

    // Ambil riwayat approval
    const { data: history } = await supabase
      .from('approval_history')
      .select('*, profiles(full_name, role)')
      .eq('reimbursement_id', r.id)
      .order('created_at')

    // Generate QR sebagai data URL
    const qrDataUrl = await QRCode.toDataURL(trackUrl(r.request_no), { width: 110, margin: 1 })

    const rupiah = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID')
    const actionLabel = { submitted: 'Diajukan', approved: 'Disetujui', rejected: 'Ditolak', revision: 'Dikembalikan', verified: 'Diverifikasi' }

    const itemRows = (items || []).map((it) => `
      <tr>
        <td>${it.expense_date}</td>
        <td>${it.category}</td>
        <td>${it.description || '—'}</td>
        <td style="text-align:right">${rupiah(it.amount)}</td>
      </tr>`).join('')

    const historyRows = (history || []).map((h) => `
      <tr>
        <td>${new Date(h.created_at).toLocaleString('id-ID')}</td>
        <td>${actionLabel[h.action] || h.action}</td>
        <td>${h.profiles?.full_name || '—'} (${h.profiles?.role || '—'})</td>
        <td>${h.notes || '—'}</td>
      </tr>`).join('')

    const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8"/>
  <title>Bukti Reimbursement ${r.request_no}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #1c2230; padding: 24px; }
    .slip { max-width: 720px; margin: 0 auto; }

    /* Header */
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #14213d; padding-bottom: 14px; margin-bottom: 16px; }
    .header-left .title { font-size: 18px; font-weight: 800; color: #14213d; letter-spacing: 0.5px; }
    .header-left .subtitle { font-size: 11px; color: #6b7280; margin-top: 2px; }
    .header-right { text-align: right; }
    .doc-title { font-size: 13px; font-weight: 700; color: #0f6e6e; text-transform: uppercase; letter-spacing: 0.5px; }
    .req-no { font-size: 15px; font-weight: 800; color: #14213d; margin-top: 2px; }

    /* SAH stamp */
    .stamp-area { display: flex; justify-content: flex-end; margin-bottom: 14px; }
    .stamp {
      border: 3px solid #1f8a4c;
      color: #1f8a4c;
      font-size: 18px;
      font-weight: 900;
      padding: 6px 20px;
      border-radius: 6px;
      letter-spacing: 3px;
      transform: rotate(-5deg);
    }

    /* Info grid */
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; background: #f6f7f9; border-radius: 6px; padding: 12px; margin-bottom: 14px; }
    .info-item .label { font-size: 10px; color: #6b7280; text-transform: uppercase; font-weight: 700; letter-spacing: 0.4px; }
    .info-item .value { font-size: 13px; font-weight: 600; margin-top: 2px; }

    /* Tables */
    table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
    th { background: #14213d; color: #fff; padding: 7px 10px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; }
    td { padding: 7px 10px; border-bottom: 1px solid #e3e6ea; font-size: 12px; }
    tr:last-child td { border-bottom: none; }
    .total-row td { font-weight: 700; background: #e6f3f3; color: #0f6e6e; font-size: 13px; border-top: 2px solid #0f6e6e; }

    /* QR + signature row */
    .bottom-row { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 20px; border-top: 1px solid #e3e6ea; padding-top: 16px; }
    .qr-area { text-align: center; }
    .qr-area img { border: 1px solid #e3e6ea; border-radius: 4px; }
    .qr-label { font-size: 10px; color: #6b7280; margin-top: 4px; }
    .sign-area { display: flex; gap: 40px; }
    .sign-box { text-align: center; width: 140px; }
    .sign-line { border-bottom: 1px solid #14213d; margin-bottom: 6px; height: 40px; }
    .sign-label { font-size: 10px; color: #6b7280; text-transform: uppercase; font-weight: 700; }
    .sign-name { font-size: 11px; font-weight: 600; margin-top: 2px; }

    /* Footer */
    .footer { margin-top: 16px; text-align: center; font-size: 10px; color: #9ca3af; border-top: 1px dashed #e3e6ea; padding-top: 10px; }

    @media print {
      body { padding: 12px; }
      button { display: none !important; }
    }
  </style>
</head>
<body>
<div class="slip">

  <!-- Header -->
  <div class="header">
    <div class="header-left">
      <div class="title">PCRS</div>
      <div class="subtitle">Petty Cash Reimbursement System</div>
    </div>
    <div class="header-right">
      <div class="doc-title">Bukti Reimbursement Petty Cash</div>
      <div class="req-no">${r.request_no}</div>
    </div>
  </div>

  <!-- SAH stamp -->
  <div class="stamp-area">
    <div class="stamp">✓ DOKUMEN SAH</div>
  </div>

  <!-- Info -->
  <div class="info-grid">
    <div class="info-item">
      <div class="label">Employee</div>
      <div class="value">${r.profiles?.full_name || '—'}</div>
    </div>
    <div class="info-item">
      <div class="label">Department</div>
      <div class="value">${r.profiles?.department || '—'}</div>
    </div>
    <div class="info-item">
      <div class="label">Tanggal Pengajuan</div>
      <div class="value">${r.request_date}</div>
    </div>
    <div class="info-item">
      <div class="label">Tanggal Cetak</div>
      <div class="value">${new Date().toLocaleDateString('id-ID', { day:'2-digit', month:'long', year:'numeric' })}</div>
    </div>
  </div>

  <!-- Detail Item -->
  <table>
    <thead>
      <tr><th>Tanggal</th><th>Kategori</th><th>Keterangan</th><th style="text-align:right">Nominal</th></tr>
    </thead>
    <tbody>
      ${itemRows}
      <tr class="total-row">
        <td colspan="3">TOTAL REIMBURSEMENT</td>
        <td style="text-align:right">${rupiah(r.total_amount)}</td>
      </tr>
    </tbody>
  </table>

  <!-- Riwayat Approval -->
  <table>
    <thead>
      <tr><th>Waktu</th><th>Status</th><th>Oleh</th><th>Catatan</th></tr>
    </thead>
    <tbody>${historyRows}</tbody>
  </table>

  <!-- QR + Tanda Tangan -->
  <div class="bottom-row">
    <div class="qr-area">
      <img src="${qrDataUrl}" width="110" height="110" />
      <div class="qr-label">Scan untuk verifikasi online</div>
    </div>
    <div class="sign-area">
      <div class="sign-box">
        <div class="sign-line"></div>
        <div class="sign-label">Finance Staff</div>
        <div class="sign-name">( ______________________ )</div>
      </div>
      <div class="sign-box">
        <div class="sign-line"></div>
        <div class="sign-label">Finance Manager</div>
        <div class="sign-name">( ______________________ )</div>
      </div>
    </div>
  </div>

  <!-- Footer -->
  <div class="footer">
    Dokumen ini dicetak otomatis oleh sistem PCRS &nbsp;•&nbsp; ${r.request_no} &nbsp;•&nbsp; ${new Date().toLocaleString('id-ID')}
  </div>
</div>

<script>window.onload = () => window.print();</script>
</body>
</html>`

    const w = window.open('', '_blank', 'width=800,height=700')
    w.document.write(html)
    w.document.close()
  }

  const isFinanceOrAdmin = ['finance_staff', 'finance_manager', 'admin'].includes(profile.role)

  useEffect(() => {
    async function load() {
      setLoadingData(true)
      let query = supabase
        .from('reimbursements')
        .select('*, profiles(full_name, department), reimbursement_items(category)')
        .order('created_at', { ascending: false })

      // Bukan finance/admin: hanya tampilkan department sendiri
      if (!isFinanceOrAdmin) {
        query = query.eq('profiles.department', profile.department)
      }

      const { data } = await query
      // Filter tambahan di client untuk non-finance (karena eq pada join tidak cukup di Supabase)
      const result = isFinanceOrAdmin
        ? (data || [])
        : (data || []).filter((r) => r.profiles?.department === profile.department)

      setAll(result)
      setLoadingData(false)
    }
    load()
  }, [refreshKey, isFinanceOrAdmin, profile.department])

  const departments = [...new Set(all.map((r) => r.profiles?.department).filter(Boolean))]

  const filtered = all.filter((r) => {
    if (filterStatus !== 'all' && r.status !== filterStatus) return false
    if (filterDept !== 'all' && r.profiles?.department !== filterDept) return false
    if (filterCategory !== 'all') {
      const cats = (r.reimbursement_items || []).map((it) => it.category)
      if (!cats.includes(filterCategory)) return false
    }
    if (dateFrom && r.request_date < dateFrom) return false
    if (dateTo && r.request_date > dateTo) return false
    return true
  })

  const resetFilters = () => {
    setFilterStatus('all'); setFilterDept('all'); setFilterCategory('all'); setDateFrom(''); setDateTo('')
  }

  const activeChips = []
  if (filterStatus !== 'all') activeChips.push({ key: 'status', label: STATUS_LABEL[filterStatus], clear: () => setFilterStatus('all') })
  if (filterDept !== 'all') activeChips.push({ key: 'dept', label: filterDept, clear: () => setFilterDept('all') })
  if (filterCategory !== 'all') activeChips.push({ key: 'cat', label: filterCategory, clear: () => setFilterCategory('all') })
  if (dateFrom) activeChips.push({ key: 'from', label: `Dari ${dateFrom}`, clear: () => setDateFrom('') })
  if (dateTo) activeChips.push({ key: 'to', label: `Sampai ${dateTo}`, clear: () => setDateTo('') })

  const totalApproved = filtered.filter((r) => r.status === 'verified').reduce((s, r) => s + Number(r.total_amount), 0)
  const outstanding = filtered.filter((r) => r.status === 'submitted').length
  const pendingFinance = filtered.filter((r) => r.status === 'approved').length
  const verifiedCount = filtered.filter((r) => r.status === 'verified').length
  const rejectedCount = filtered.filter((r) => r.status === 'rejected').length

  return (
    <>
      <div className="filter-panel">
        <div className="filter-panel-head">
          <div className="filter-title"><span className="filter-icon">⚲</span> Filter Data</div>
          {activeChips.length > 0 && (
            <span className="filter-clear-all" onClick={resetFilters}>Hapus semua filter</span>
          )}
        </div>

        <div className="filter-grid">
          <div className="filter-field">
            <label><span className="f-ico">●</span> Status</label>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="all">Semua Status</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="filter-field">
            <label><span className="f-ico">▣</span> Department</label>
            <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)} disabled={!isFinanceOrAdmin} style={{ opacity: isFinanceOrAdmin ? 1 : 0.45 }}>
              <option value="all">{isFinanceOrAdmin ? 'Semua Department' : profile.department}</option>
              {isFinanceOrAdmin && departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="filter-field">
            <label><span className="f-ico">◆</span> Kategori Expense</label>
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
              <option value="all">Semua Kategori</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="filter-field filter-field-date">
            <label><span className="f-ico">▦</span> Periode</label>
            <div className="date-range">
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              <span className="date-sep">—</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
        </div>

        {activeChips.length > 0 && (
          <div className="chip-row">
            {activeChips.map((c) => (
              <span className="chip" key={c.key}>
                {c.label}
                <span className="chip-x" onClick={c.clear}>✕</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid-kpi">
        {loadingData ? Array(5).fill(0).map((_, i) => (
          <div className="kpi-box" key={i}>
            <div className="skeleton-row short" style={{ marginBottom: 8 }} />
            <div className="skeleton-row medium" style={{ height: 28 }} />
          </div>
        )) : <>
          <div className="kpi-box"><div className="label">Total Reimbursement Terverifikasi</div><div className="value">{rupiah(totalApproved)}</div></div>
          <div className="kpi-box"><div className="label">Menunggu Approval</div><div className="value">{outstanding}</div></div>
          <div className="kpi-box"><div className="label">Menunggu Finance Verification</div><div className="value">{pendingFinance}</div></div>
          <div className="kpi-box"><div className="label">Terverifikasi</div><div className="value">{verifiedCount}</div></div>
          <div className="kpi-box"><div className="label">Rejected</div><div className="value">{rejectedCount}</div></div>
        </>}
      </div>
      <div className="card">
        <h3>
          Pengajuan {isFinanceOrAdmin ? '' : `— Dept. ${profile.department} `}
          ({filtered.length} dari {all.length} total)
        </h3>
        {loadingData ? <SkeletonTable cols={6} rows={5} /> : filtered.length === 0 ? (
          <div className="empty-state">Tidak ada data yang cocok dengan filter.</div>
        ) : (
          <table>
            <thead><tr><th>No. Request</th><th>Tanggal</th><th>Employee</th><th>Department</th><th>Total</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{r.request_no}</td>
                  <td>{r.request_date}</td>
                  <td>{r.profiles?.full_name || '—'}</td>
                  <td>{r.profiles?.department || '—'}</td>
                  <td>{rupiah(r.total_amount)}</td>
                  <td><span className={`badge badge-${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                  <td>
                    {r.status === 'verified' && (r.employee_id === profile.id || ['finance_staff', 'finance_manager', 'admin'].includes(profile.role)) && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-primary btn-sm" onClick={() => setQrModal(r)}>QR</button>
                        <button className="btn btn-sm" style={{ background: '#14213d', color: '#fff' }} onClick={() => printSlip(r)}>🖨 Print</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {qrModal && (
        <div className="modal-overlay" onClick={() => setQrModal(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-close" onClick={() => setQrModal(null)}>✕</div>
            <h3 style={{ marginTop: 0 }}>QR Siap Bayar</h3>
            <div className="checklist-line">Scan untuk verifikasi sebelum pembayaran cash</div>
            <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0' }}>
              <QRBadge value={trackUrl(qrModal.request_no)} size={180} label={qrModal.request_no} />
            </div>
            <div className="track-row"><span>Employee</span><strong>{qrModal.profiles?.full_name || '—'}</strong></div>
            <div className="track-row"><span>Department</span><strong>{qrModal.profiles?.department || '—'}</strong></div>
            <div className="track-row"><span>Total</span><strong>{rupiah(qrModal.total_amount)}</strong></div>
          </div>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------- REPORTING ----
function ReportingPage({ profile }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterDept, setFilterDept] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const isFinanceOrAdmin = ['finance_staff', 'finance_manager', 'admin'].includes(profile.role)

  useEffect(() => {
    async function load() {
      setLoading(true)
      let query = supabase
        .from('reimbursements')
        .select('*, profiles(full_name, department)')
        .eq('status', 'verified')
        .order('request_date', { ascending: false })

      // Employee hanya lihat milik sendiri
      if (!isFinanceOrAdmin) query = query.eq('employee_id', profile.id)

      const { data } = await query
      setRows(data || [])
      setLoading(false)
    }
    load()
  }, [isFinanceOrAdmin, profile.id])

  const departments = [...new Set(rows.map((r) => r.profiles?.department).filter(Boolean))]

  const filtered = rows.filter((r) => {
    if (filterDept !== 'all' && r.profiles?.department !== filterDept) return false
    if (dateFrom && r.request_date < dateFrom) return false
    if (dateTo && r.request_date > dateTo) return false
    return true
  })

  const totalFiltered = filtered.reduce((s, r) => s + Number(r.total_amount), 0)

  async function doPrint(r) {
    const { data: items } = await supabase
      .from('reimbursement_items')
      .select('*')
      .eq('reimbursement_id', r.id)
      .order('expense_date')

    const { data: history } = await supabase
      .from('approval_history')
      .select('*, profiles(full_name, role)')
      .eq('reimbursement_id', r.id)
      .order('created_at')

    const qrDataUrl = await QRCode.toDataURL(trackUrl(r.request_no), { width: 100, margin: 1 })

    const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID')

    // Cari approver & finance verifier dari history
    const approverRow = (history || []).find((h) => h.action === 'approved')
    const verifierRow = (history || []).find((h) => h.action === 'verified')
    const submitterRow = (history || []).find((h) => h.action === 'submitted')

    const approverName  = approverRow?.profiles?.full_name  || '_______________'
    const verifierName  = verifierRow?.profiles?.full_name  || '_______________'
    const employeeName  = r.profiles?.full_name             || '_______________'

    const itemRows = (items || []).map((it, i) => `
      <tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${it.expense_date}</td>
        <td>${it.category}</td>
        <td>${it.description || '—'}</td>
        <td style="text-align:right">${rp(it.amount)}</td>
      </tr>`).join('')

    const printDate = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })

    const html = `<!DOCTYPE html>
<html lang="id"><head>
<meta charset="UTF-8"/>
<title>Slip Reimbursement ${r.request_no}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #111; padding: 28px 32px; }

  /* Header */
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .brand { font-size: 20px; font-weight: 900; color: #14213d; letter-spacing: 1px; }
  .brand span { color: #0f6e6e; }
  .doc-label { text-align: right; }
  .doc-label .title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #14213d; }
  .doc-label .no { font-size: 15px; font-weight: 900; color: #0f6e6e; }
  .divider { border: none; border-top: 2.5px solid #14213d; margin: 10px 0; }
  .divider-light { border: none; border-top: 1px solid #ccc; margin: 10px 0; }

  /* SAH stamp */
  .sah { display: inline-block; border: 2.5px solid #1f8a4c; color: #1f8a4c; font-size: 13px; font-weight: 900;
    padding: 3px 14px; border-radius: 4px; letter-spacing: 2px; transform: rotate(-4deg); float: right; margin-top: -4px; }

  /* Info row */
  .info-row { display: flex; gap: 0; margin-bottom: 10px; }
  .info-col { flex: 1; }
  .info-col .lbl { font-size: 10px; color: #666; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; }
  .info-col .val { font-size: 12px; font-weight: 600; margin-top: 1px; }

  /* Table */
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  thead th { background: #14213d; color: #fff; padding: 6px 8px; font-size: 10px; text-transform: uppercase; text-align: left; }
  tbody td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px; }
  .total-row td { font-weight: 700; font-size: 12px; background: #f0faf4; border-top: 2px solid #14213d; }

  /* Bottom: QR + signatures */
  .bottom { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 18px; }
  .qr-wrap { text-align: center; }
  .qr-wrap img { border: 1px solid #ddd; border-radius: 4px; }
  .qr-wrap p { font-size: 9px; color: #888; margin-top: 3px; }
  .signs { display: flex; gap: 32px; }
  .sign-box { text-align: center; min-width: 130px; }
  .sign-space { height: 44px; border-bottom: 1px solid #333; margin-bottom: 5px; position: relative; }
  .sign-name { font-size: 10px; font-weight: 700; }
  .sign-role { font-size: 9px; color: #666; margin-top: 1px; }
  .pre-filled { position: absolute; bottom: 4px; left: 0; right: 0; font-size: 10px; font-weight: 700; text-align: center; color: #14213d; }

  /* Footer */
  .footer { margin-top: 14px; text-align: center; font-size: 9px; color: #aaa; border-top: 1px dashed #ddd; padding-top: 8px; }

  @media print { @page { margin: 15mm; } }
</style>
</head><body>

<!-- Header -->
<div class="header">
  <div>
    <div class="brand">PCRS <span>•</span> Petty Cash</div>
    <div style="font-size:10px;color:#888;margin-top:2px">Petty Cash Reimbursement System</div>
  </div>
  <div class="doc-label">
    <div class="title">Slip Reimbursement</div>
    <div class="no">${r.request_no}</div>
  </div>
</div>

<hr class="divider"/>

<!-- SAH + Info -->
<div style="overflow:hidden;margin-bottom:10px">
  <div class="sah">✓ DOKUMEN SAH</div>
  <div class="info-row">
    <div class="info-col"><div class="lbl">Nama Karyawan</div><div class="val">${employeeName}</div></div>
    <div class="info-col"><div class="lbl">Department</div><div class="val">${r.profiles?.department || '—'}</div></div>
    <div class="info-col"><div class="lbl">Tanggal Pengajuan</div><div class="val">${r.request_date}</div></div>
    <div class="info-col"><div class="lbl">Tanggal Cetak</div><div class="val">${printDate}</div></div>
  </div>
</div>

<hr class="divider-light"/>

<!-- Tabel Item -->
<table>
  <thead>
    <tr><th style="width:30px;text-align:center">No</th><th style="width:90px">Tanggal</th><th style="width:110px">Kategori</th><th>Keterangan</th><th style="width:110px;text-align:right">Nominal</th></tr>
  </thead>
  <tbody>
    ${itemRows}
    <tr class="total-row">
      <td colspan="4">TOTAL</td>
      <td style="text-align:right">${rp(r.total_amount)}</td>
    </tr>
  </tbody>
</table>

<!-- QR + Tanda Tangan -->
<div class="bottom">
  <div class="qr-wrap">
    <img src="${qrDataUrl}" width="100" height="100"/>
    <p>Scan untuk verifikasi</p>
  </div>
  <div class="signs">
    <div class="sign-box">
      <div class="sign-space"><div class="pre-filled">${employeeName}</div></div>
      <div class="sign-name">Pembuat Pengajuan</div>
      <div class="sign-role">(Employee)</div>
    </div>
    <div class="sign-box">
      <div class="sign-space"><div class="pre-filled">${approverName}</div></div>
      <div class="sign-name">Menyetujui</div>
      <div class="sign-role">(Supervisor / Manager)</div>
    </div>
    <div class="sign-box">
      <div class="sign-space"><div class="pre-filled">${verifierName}</div></div>
      <div class="sign-name">Verifikasi Finance</div>
      <div class="sign-role">(Finance Staff / Manager)</div>
    </div>
  </div>
</div>

<!-- Footer -->
<div class="footer">
  Dicetak otomatis oleh PCRS &nbsp;•&nbsp; ${r.request_no} &nbsp;•&nbsp; ${new Date().toLocaleString('id-ID')}
</div>

<script>window.onload = () => window.print();</script>
</body></html>`

    const w = window.open('', '_blank', 'width=820,height=650')
    w.document.write(html)
    w.document.close()
  }

  return (
    <>
      {/* Filter bar */}
      <div className="filter-panel" style={{ marginBottom: 16 }}>
        <div className="filter-panel-head">
          <div className="filter-title"><span className="filter-icon">📊</span> {isFinanceOrAdmin ? 'Reporting — Semua Reimbursement Terverifikasi' : 'Reporting — Reimbursement Saya'}</div>
          {(filterDept !== 'all' || dateFrom || dateTo) && (
            <span className="filter-clear-all" onClick={() => { setFilterDept('all'); setDateFrom(''); setDateTo('') }}>Reset filter</span>
          )}
        </div>
        <div className="filter-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          {isFinanceOrAdmin && (
            <div className="filter-field">
              <label>Department</label>
              <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)}>
                <option value="all">Semua Department</option>
                {departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}
          <div className="filter-field">
            <label>Dari Tanggal</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="filter-field">
            <label>Sampai Tanggal</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Summary KPI */}
      <div className="grid-kpi" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 16 }}>
        <div className="kpi-box"><div className="label">Total Transaksi</div><div className="value">{filtered.length}</div></div>
        <div className="kpi-box"><div className="label">Total Nilai</div><div className="value" style={{ fontSize: 16 }}>{rupiah(totalFiltered)}</div></div>
        <div className="kpi-box"><div className="label">Department</div><div className="value">{filterDept === 'all' ? 'Semua' : filterDept}</div></div>
      </div>

      {/* Tabel */}
      <div className="card">
        <h3>Daftar Reimbursement Terverifikasi — Siap Cetak</h3>
        {loading ? <SkeletonTable cols={5} rows={4} /> : filtered.length === 0 ? (
          <div className="empty-state">Tidak ada data yang sesuai filter.</div>
        ) : (
          <table>
            <thead>
              <tr><th>No. Request</th><th>Tanggal</th><th>Karyawan</th><th>Department</th><th style={{ textAlign: 'right' }}>Total</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{r.request_no}</td>
                  <td>{r.request_date}</td>
                  <td>{r.profiles?.full_name || '—'}</td>
                  <td>{r.profiles?.department || '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{rupiah(r.total_amount)}</td>
                  <td>
                    <button className="btn btn-sm" style={{ background: '#14213d', color: '#fff', whiteSpace: 'nowrap' }} onClick={() => doPrint(r)}>
                      🖨 Print Slip
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: '#e6f3f3' }}>
                <td colSpan={4} style={{ fontWeight: 700, padding: '9px 10px' }}>TOTAL ({filtered.length} transaksi)</td>
                <td style={{ textAlign: 'right', fontWeight: 800, color: 'var(--teal)', padding: '9px 10px' }}>{rupiah(totalFiltered)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- MAIN APP ----
export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [tab, setTab] = useState('dashboard')
  const [refreshKey, setRefreshKey] = useState(0)
  const bump = useCallback(() => setRefreshKey((k) => k + 1), [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setSession(session))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    async function loadProfile() {
      if (!session) { setProfile(null); return }
      const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
      setProfile(data)
    }
    loadProfile()
  }, [session])

  if (!session) return <AuthScreen />
  if (!profile) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
        <div style={{ width: 36, height: 36, border: '3px solid #e3e6ea', borderTopColor: 'var(--teal)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 12px' }} />
        Memuat profil...
      </div>
    </div>
  )

  const isApprover = ['supervisor', 'manager', 'finance_manager', 'admin'].includes(profile.role)
  const isFinance = ['finance_staff', 'finance_manager', 'admin'].includes(profile.role)

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">PCRS <span>•</span> Petty Cash Reimbursement</div>
        <div className="userinfo">
          <span>{profile.full_name} ({profile.role})</span>
          <button className="btn btn-outline btn-sm" onClick={() => supabase.auth.signOut()}>Logout</button>
        </div>
      </div>

      <div className="tabs">
        <div className={`tab ${tab === 'dashboard' ? 'active' : ''}`} onClick={() => setTab('dashboard')}>Dashboard</div>
        <div className={`tab ${tab === 'submit' ? 'active' : ''}`} onClick={() => setTab('submit')}>Submit Reimbursement</div>
        <div className={`tab ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>Pengajuan Saya</div>
        {isApprover && (
          <div className={`tab ${tab === 'approval' ? 'active' : ''}`} onClick={() => setTab('approval')}>Approval</div>
        )}
        {isFinance && (
          <div className={`tab ${tab === 'finance' ? 'active' : ''}`} onClick={() => setTab('finance')}>Finance Verification</div>
        )}
        <div className={`tab ${tab === 'reporting' ? 'active' : ''}`} onClick={() => setTab('reporting')}>📊 Reporting</div>
        {profile.role === 'admin' && (
          <div className={`tab ${tab === 'admin' ? 'active' : ''}`} onClick={() => setTab('admin')} style={{ marginLeft: 'auto', color: tab === 'admin' ? 'var(--teal)' : '#b35900' }}>⚙️ Admin Panel</div>
        )}
      </div>

      <div className="container">
        <div className="tab-content" key={tab}>
          {tab === 'dashboard' && <Dashboard refreshKey={refreshKey} profile={profile} />}
          {tab === 'submit' && <SubmitForm profile={profile} onSubmitted={bump} />}
          {tab === 'mine' && <MyRequests profile={profile} refreshKey={refreshKey} />}
          {tab === 'approval' && isApprover && <ApprovalQueue profile={profile} refreshKey={refreshKey} onActed={bump} />}
          {tab === 'finance' && isFinance && <FinanceVerification profile={profile} refreshKey={refreshKey} onActed={bump} />}
          {tab === 'reporting' && <ReportingPage profile={profile} />}
          {tab === 'admin' && profile.role === 'admin' && <AdminPanel />}
        </div>
      </div>
    </div>
  )
}
