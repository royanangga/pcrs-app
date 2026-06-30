import React, { useEffect, useState, useCallback } from 'react'
import QRCode from 'qrcode'
import { supabase } from './supabaseClient'

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

// ---------------------------------------------------------------- AUTH ----
function AuthScreen() {
  const [mode, setMode] = useState('login') // login | register
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [department, setDepartment] = useState('Finance')
  const [role, setRole] = useState('employee')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName, department, role } },
      })
      if (error) setError(error.message)
      else setError('Akun dibuat. Cek email Anda untuk verifikasi, lalu login.')
    }
    setLoading(false)
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={handleSubmit}>
        <h2>PCRS</h2>
        <div className="sub">Petty Cash Reimbursement System</div>

        {mode === 'register' && (
          <>
            <label>Nama Lengkap</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            <label>Department</label>
            <input value={department} onChange={(e) => setDepartment(e.target.value)} required />
            <label>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="employee">Employee</option>
              <option value="supervisor">Supervisor</option>
              <option value="manager">Manager</option>
              <option value="finance_staff">Finance Staff</option>
              <option value="finance_manager">Finance Manager</option>
            </select>
          </>
        )}

        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />

        {error && <div className="error-text">{error}</div>}

        <button className="btn btn-primary" style={{ width: '100%', marginTop: 16 }} disabled={loading}>
          {loading ? 'Memproses...' : mode === 'login' ? 'Login' : 'Daftar'}
        </button>

        <div className="toggle-link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>
          {mode === 'login' ? 'Belum punya akun? Daftar' : 'Sudah punya akun? Login'}
        </div>
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
          {saving ? 'Mengirim...' : 'Submit Reimbursement'}
        </button>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------- MY REQUESTS ----
function MyRequests({ profile, refreshKey }) {
  const [rows, setRows] = useState([])
  const [openId, setOpenId] = useState(null)
  const [attMap, setAttMap] = useState({})

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('reimbursements')
        .select('*')
        .eq('employee_id', profile.id)
        .order('created_at', { ascending: false })
      setRows(data || [])
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
      {rows.length === 0 ? (
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
                        <QRBadge value={r.request_no} label={`QR: ${r.request_no}`} />
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
  const [names, setNames] = useState({})
  const [noteDraft, setNoteDraft] = useState({})

  const canSeeAll = profile.role === 'finance_manager' || profile.role === 'admin'

  useEffect(() => {
    async function load() {
      let query = supabase.from('reimbursements').select('*').eq('status', 'submitted')
      if (!canSeeAll) query = query.eq('required_role', profile.role)
      const { data } = await query.order('created_at', { ascending: true })
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
  }, [profile.role, refreshKey, canSeeAll])

  async function act(row, action) {
    const newStatus = action === 'approved' ? 'approved' : action === 'rejected' ? 'rejected' : 'revision'
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
      <h3>Antrian Approval {canSeeAll ? '(Semua level)' : `(Level: ${profile.role})`}</h3>
      {rows.length === 0 ? (
        <div className="empty-state">Tidak ada pengajuan menunggu approval Anda.</div>
      ) : (
        <table>
          <thead>
            <tr><th>No. Request</th><th>Employee</th><th>Total</th><th>Note</th><th>Aksi</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.request_no}</td>
                <td>{names[r.employee_id] || '—'}</td>
                <td>{rupiah(r.total_amount)}</td>
                <td style={{ minWidth: 160 }}>
                  <input
                    placeholder="Catatan (opsional)"
                    value={noteDraft[r.id] || ''}
                    onChange={(e) => setNoteDraft({ ...noteDraft, [r.id]: e.target.value })}
                  />
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-success btn-sm" onClick={() => act(r, 'approved')}>Approve</button>{' '}
                  <button className="btn btn-danger btn-sm" onClick={() => act(r, 'rejected')}>Reject</button>{' '}
                  <button className="btn btn-sm" style={{ background: '#ffe6cc', color: '#b35900' }} onClick={() => act(r, 'revision')}>Revisi</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
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
                        <QRBadge value={r.request_no} label={`QR: ${r.request_no}`} />
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
function Dashboard({ refreshKey }) {
  const [all, setAll] = useState([])
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterDept, setFilterDept] = useState('all')
  const [filterCategory, setFilterCategory] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('reimbursements')
        .select('*, profiles(full_name, department), reimbursement_items(category)')
        .order('created_at', { ascending: false })
      setAll(data || [])
    }
    load()
  }, [refreshKey])

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
            <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)}>
              <option value="all">Semua Department</option>
              {departments.map((d) => <option key={d} value={d}>{d}</option>)}
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
        <div className="kpi-box"><div className="label">Total Reimbursement Terverifikasi</div><div className="value">{rupiah(totalApproved)}</div></div>
        <div className="kpi-box"><div className="label">Menunggu Approval</div><div className="value">{outstanding}</div></div>
        <div className="kpi-box"><div className="label">Menunggu Finance Verification</div><div className="value">{pendingFinance}</div></div>
        <div className="kpi-box"><div className="label">Terverifikasi</div><div className="value">{verifiedCount}</div></div>
        <div className="kpi-box"><div className="label">Rejected</div><div className="value">{rejectedCount}</div></div>
      </div>
      <div className="card">
        <h3>Pengajuan ({filtered.length} dari {all.length} total)</h3>
        {filtered.length === 0 ? (
          <div className="empty-state">Tidak ada data yang cocok dengan filter.</div>
        ) : (
          <table>
            <thead><tr><th>No. Request</th><th>Tanggal</th><th>Employee</th><th>Department</th><th>Total</th><th>Status</th></tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{r.request_no}</td>
                  <td>{r.request_date}</td>
                  <td>{r.profiles?.full_name || '—'}</td>
                  <td>{r.profiles?.department || '—'}</td>
                  <td>{rupiah(r.total_amount)}</td>
                  <td><span className={`badge badge-${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                </tr>
              ))}
            </tbody>
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
  if (!profile) return <div className="container">Memuat profil...</div>

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
      </div>

      <div className="container">
        {tab === 'dashboard' && <Dashboard refreshKey={refreshKey} />}
        {tab === 'submit' && <SubmitForm profile={profile} onSubmitted={bump} />}
        {tab === 'mine' && <MyRequests profile={profile} refreshKey={refreshKey} />}
        {tab === 'approval' && isApprover && <ApprovalQueue profile={profile} refreshKey={refreshKey} onActed={bump} />}
        {tab === 'finance' && isFinance && <FinanceVerification profile={profile} refreshKey={refreshKey} onActed={bump} />}
      </div>
    </div>
  )
}
