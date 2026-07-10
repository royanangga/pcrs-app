import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import QRCode from 'qrcode'
import { supabase } from './supabaseClient'
import AdminPanel from './AdminPanel.jsx'
import Pagination from './Pagination.jsx'
import { trackUrl, printSlip as printSlipShared, printBulkSlips as printBulkSlipsShared, printCashTopupSlip } from './slip.js'
import { MonthlyBarChart, CategoryDonutChart } from './Charts.jsx'
import NotificationBell from './Notifications.jsx'

const CATEGORIES = ['Transport', 'Meal', 'Office Supplies', 'Communication', 'Accommodation', 'Other']

const STATUS_LABEL = {
  draft: 'Draft',
  submitted: 'Menunggu Approval',
  approved: 'Menunggu Approval Finance Manager',
  finance_approved: 'Disetujui Finance Manager — Menunggu Pencairan',
  verified: 'Terverifikasi (Sudah Dicairkan)',
  rejected: 'Ditolak',
  revision: 'Perlu Revisi',
}

// Nama department yang dianggap "Finance" (bisa disesuaikan sesuai penamaan
// department di organisasi Anda). Pencocokan tidak case-sensitive.
const FINANCE_DEPARTMENT = 'Finance'

// User dianggap "Finance" (boleh lihat semua pengajuan lintas departemen &
// melakukan Finance Verification) kalau department-nya Finance — TIDAK PEDULI
// role-nya (Employee/Supervisor/Manager di department Finance semua berlaku
// sama, bisa melihat & melakukan verifikasi). Admin juga selalu dianggap Finance.
// "Finance Manager" di sini bukan role tersendiri — cukup user dengan
// department = Finance (role apa pun), sesuai struktur organisasi yang ada.
function isFinanceUser(profile) {
  if (!profile) return false
  if (profile.role === 'admin') return true
  return (profile.department || '').trim().toLowerCase() === FINANCE_DEPARTMENT.toLowerCase()
}

// Finance Manager = user dengan role 'manager' DAN department 'Finance' (bukan
// role tersendiri). Hanya Finance Manager (atau Admin) yang boleh melakukan
// approval SEBELUM uang dicairkan (tahap "Approval Finance Manager"). Berbeda
// dengan isFinanceUser() di atas yang mengizinkan SEMUA orang di department
// Finance untuk tahap "Finance Verification" (SETELAH uang dicairkan).
function isFinanceManager(profile) {
  if (!profile) return false
  if (profile.role === 'admin') return true
  return profile.role === 'manager' && (profile.department || '').trim().toLowerCase() === FINANCE_DEPARTMENT.toLowerCase()
}

// Label nama tahap approver untuk ditampilkan ke user (sesuai kolom required_role)
const APPROVER_ROLE_LABEL = {
  supervisor: 'SPV Departemen',
  manager: 'Manager Departemen',
}

// Label status yang lebih jelas: kalau masih 'submitted', sebutkan menunggu
// approval dari siapa (berdasarkan required_role), bukan cuma "Menunggu Approval".
function statusLabelFor(row) {
  if (!row) return ''
  if (row.status === 'submitted') {
    const approverLabel = APPROVER_ROLE_LABEL[row.required_role] || row.required_role
    return `Menunggu Approval ${approverLabel}`
  }
  return STATUS_LABEL[row.status] || row.status
}

// Batas nominal yang mewajibkan approval tambahan dari Manager Departemen
// (hanya berlaku untuk pengaju Employee — lihat requiredRoleFor)
const MANAGER_THRESHOLD = 5000000

// Role yang tidak punya atasan lagi di departemennya sendiri (level Manager ke
// atas): pengajuan mereka langsung lanjut ke Finance Verification tanpa
// approval departemen sama sekali. Berlaku sama untuk semua departemen,
// termasuk department Finance sendiri (Manager di department Finance yang
// mengajukan juga langsung ke Finance Verification tanpa approval SPV).
const SKIP_DEPT_APPROVAL_ROLES = ['manager', 'admin']

// Role yang approval-diri-sendiri di-skip, langsung ke atasan terkait (bukan
// dihilangkan sepenuhnya seperti Manager/Admin di atas). Saat ini hanya
// Supervisor: seorang Supervisor yang mengajukan reimbursement tidak perlu
// (dan tidak boleh) di-approve oleh sesama Supervisor, jadi langsung
// diteruskan ke Manager Departemen (atasannya).
const SELF_SKIP_TO_MANAGER_ROLES = ['supervisor']

// Menentukan status awal & tahap approval pertama saat pengajuan dibuat/disubmit ulang:
//  - Pengaju = Manager/Admin (semua nominal) -> tidak ada approval departemen,
//    status langsung 'approved' (siap masuk antrian Approval Finance Manager)
//  - Pengaju = Supervisor -> approval diri sendiri di-skip, langsung ke Manager
//    Departemen (status 'submitted', required_role = 'manager')
//  - Pengaju = Employee -> mulai dari approval Supervisor (status 'submitted')
//
// Alur status lengkap sebuah pengajuan:
//   submitted (approval pimpinan departemen: Supervisor/Manager)
//     -> approved (menunggu Approval Finance Manager, SEBELUM uang dicairkan)
//     -> finance_approved (disetujui Finance Manager, siap dicairkan)
//     -> verified (Finance Verification, SETELAH uang benar-benar dicairkan)
function requiredRoleFor(submitterRole) {
  if (SKIP_DEPT_APPROVAL_ROLES.includes(submitterRole)) return 'manager' // placeholder, tak dipakai (status langsung 'approved')
  if (SELF_SKIP_TO_MANAGER_ROLES.includes(submitterRole)) return 'manager'
  return 'supervisor'
}

function initialStatusFor(submitterRole) {
  return SKIP_DEPT_APPROVAL_ROLES.includes(submitterRole) ? 'approved' : 'submitted'
}

// Menentukan tahap approval berikutnya SETELAH sebuah step di-approve.
// currentRole = required_role saat ini (tahap yang baru saja approve)
// Return null artinya tidak ada approval lagi -> lanjut ke Finance Verification (status = 'approved')
function nextApprovalRole(currentRole, submitterRole, total) {
  // Kalau pengaju adalah Supervisor, tahap 'manager' ini menggantikan approval
  // dirinya sendiri (atasan terkait) -> setelah Manager approve, selesai,
  // TIDAK tergantung nominal.
  if (SELF_SKIP_TO_MANAGER_ROLES.includes(submitterRole)) return null

  const needsDeptManager = Number(total) >= MANAGER_THRESHOLD && !SKIP_DEPT_APPROVAL_ROLES.includes(submitterRole)
  if (currentRole === 'supervisor') {
    return needsDeptManager ? 'manager' : null
  }
  // currentRole === 'manager' -> selesai, lanjut Finance Verification
  return null
}

function approvalFlowLabel(submitterRole, total) {
  if (SKIP_DEPT_APPROVAL_ROLES.includes(submitterRole)) return 'Langsung ke Approval Finance Manager (tanpa approval departemen) → Finance Verification'
  if (SELF_SKIP_TO_MANAGER_ROLES.includes(submitterRole)) return 'Manager Departemen → Approval Finance Manager → Finance Verification (approval SPV di-skip karena pengaju adalah SPV)'
  if (Number(total) >= MANAGER_THRESHOLD) return 'Supervisor → Manager → Approval Finance Manager → Finance Verification (nominal ≥ Rp5jt)'
  return 'Supervisor → Approval Finance Manager → Finance Verification'
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

// Nomor pengisian kas otomatis, format mirip generateRequestNo() di atas
// tapi pakai prefix "KAS-" supaya langsung kelihatan beda dari nomor
// pengajuan reimbursement ("PCR-") walau cuma dilihat sekilas di tabel.
function generateTopupNo() {
  const now = new Date()
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  const rand = Math.floor(Math.random() * 9000 + 1000)
  return `KAS-${ym}-${rand}`
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
  const [showConfirm, setShowConfirm] = useState(false)

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

  function handleClickSubmit(e) {
    e.preventDefault()
    setMsg('')
    if (items.some((it) => !it.expense_date || !it.amount)) {
      setMsg('Lengkapi semua tanggal dan nominal item.')
      return
    }
    setShowConfirm(true)
  }

  async function handleConfirmedSubmit() {
    setSaving(true)
    setShowConfirm(false)

    const required_role = requiredRoleFor(profile.role)
    const { data: header, error: hErr } = await supabase
      .from('reimbursements')
      .insert({
        request_no: generateRequestNo(),
        employee_id: profile.id,
        total_amount: total,
        status: initialStatusFor(profile.role),
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
      notes: initialStatusFor(profile.role) === 'approved'
        ? 'Pengajuan dibuat oleh Manager/Admin — tidak ada approval departemen, langsung ke Approval Finance Manager'
        : 'Pengajuan dibuat oleh employee',
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
    setMsg(`✓ Berhasil! Request ${header.request_no} dikirim untuk approval ${header.required_role}.`)
    onSubmitted && onSubmitted()
  }

  return (
    <>
    <div className="card">
      <h3>Pengajuan Reimbursement Baru</h3>
      <form onSubmit={handleClickSubmit}>
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

        <div className="total-line">Total: {rupiah(total)} &nbsp;•&nbsp; Alur Approval: <span style={{ color: 'var(--teal)', fontWeight: 700 }}>{approvalFlowLabel(profile.role, total)}</span></div>

        {msg && <div className="error-text" style={{ color: msg.startsWith('✓') ? 'var(--success)' : 'var(--danger)' }}>{msg}</div>}

        <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={saving}>
          {saving ? <><span className="spinner" />Mengirim...</> : 'Submit Reimbursement'}
        </button>
      </form>
    </div>

    {/* Modal Konfirmasi Submit */}
    {showConfirm && (
      <div className="modal-overlay" onClick={() => setShowConfirm(false)}>
        <div className="modal-box" style={{ width: 480, maxWidth: '96vw' }} onClick={(e) => e.stopPropagation()}>
          <div className="modal-close" onClick={() => setShowConfirm(false)}>✕</div>

          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📋</div>
            <h3 style={{ margin: 0, color: 'var(--navy)' }}>Konfirmasi Pengajuan</h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '6px 0 0' }}>
              Pastikan semua data berikut sudah benar sebelum dikirim.
            </p>
          </div>

          {/* Info pengaju */}
          <div className="submit-confirm-info">
            <div className="submit-confirm-row">
              <span>Nama</span><strong>{profile.full_name}</strong>
            </div>
            <div className="submit-confirm-row">
              <span>Department</span><strong>{profile.department}</strong>
            </div>
            <div className="submit-confirm-row">
              <span>Alur Approval</span>
              <strong style={{ color: 'var(--teal)' }}>{approvalFlowLabel(profile.role, total)}</strong>
            </div>
          </div>

          {/* Rekap item */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
              Rekap Item Tagihan
            </div>
            <div className="table-scroll">
            <table style={{ marginBottom: 0 }}>
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Kategori</th>
                  <th>Keterangan</th>
                  <th style={{ textAlign: 'right' }}>Nominal</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: 12 }}>{it.expense_date}</td>
                    <td style={{ fontSize: 12 }}>{it.category}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{it.description || '—'}</td>
                    <td style={{ fontSize: 12, textAlign: 'right', fontWeight: 600 }}>{rupiah(it.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} style={{ fontWeight: 800, fontSize: 13, paddingTop: 10, borderTop: '2px solid var(--navy)', color: 'var(--navy)' }}>
                    TOTAL
                  </td>
                  <td style={{ fontWeight: 800, fontSize: 15, textAlign: 'right', paddingTop: 10, borderTop: '2px solid var(--navy)', color: 'var(--teal)' }}>
                    {rupiah(total)}
                  </td>
                </tr>
              </tfoot>
            </table>
            </div>
          </div>

          {/* File */}
          {files.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
              📎 {files.length} file bukti: {files.map((f) => f.name).join(', ')}
            </div>
          )}

          <div className="confirm-actions" style={{ marginTop: 18 }}>
            <button className="btn" style={{ background: '#f1f3f5', color: '#333', flex: 1 }} onClick={() => setShowConfirm(false)}>
              Kembali & Edit
            </button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleConfirmedSubmit}>
              ✓ Ya, Kirim Sekarang
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

// ---------------------------------------------------------------- MY REQUESTS ----
function SkeletonTable({ cols = 4, rows = 4 }) {
  return (
    <div className="table-scroll">
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
    </div>
  )
}

function MyRequests({ profile, refreshKey, onRefresh }) {
  const [rows, setRows]           = useState([])
  const [loadingData, setLoadingData] = useState(true)
  const [openId, setOpenId]       = useState(null)
  const [attMap, setAttMap]       = useState({})
  const [editId, setEditId]       = useState(null)   // ID pengajuan yang sedang direvisi
  const [editItems, setEditItems] = useState([])
  const [editFiles, setEditFiles] = useState([])
  const [saving, setSaving]       = useState(false)
  const [msg, setMsg]             = useState('')
  const [search, setSearch]       = useState('')
  const [page, setPage]           = useState(1)
  const [pageSize, setPageSize]   = useState(10)

  const load = useCallback(async () => {
    setLoadingData(true)
    const { data } = await supabase
      .from('reimbursements').select('*')
      .eq('employee_id', profile.id)
      .order('created_at', { ascending: false })
    setRows(data || [])
    setLoadingData(false)
  }, [profile.id])

  useEffect(() => { load() }, [load, refreshKey])

  async function toggleOpen(id) {
    if (openId === id) { setOpenId(null); return }
    setOpenId(id)
    if (!attMap[id]) {
      const list = await fetchAttachments(id)
      setAttMap((m) => ({ ...m, [id]: list }))
    }
  }

  // Buka form revisi — load item yang sudah ada
  async function openRevision(r) {
    const { data: items } = await supabase
      .from('reimbursement_items').select('*')
      .eq('reimbursement_id', r.id).order('expense_date')
    setEditItems((items || []).map((it) => ({
      id: it.id,
      expense_date: it.expense_date,
      category: it.category,
      description: it.description || '',
      amount: String(it.amount),
    })))
    setEditFiles([])
    setEditId(r.id)
    setMsg('')
    setOpenId(null)
  }

  function updateEditItem(i, field, value) {
    const next = [...editItems]
    next[i][field] = value
    setEditItems(next)
  }
  function addEditItem() {
    setEditItems([...editItems, { expense_date: '', category: CATEGORIES[0], description: '', amount: '' }])
  }
  function removeEditItem(i) {
    setEditItems(editItems.filter((_, idx) => idx !== i))
  }

  async function submitRevision(r) {
    if (editItems.some((it) => !it.expense_date || !it.amount)) {
      setMsg('Lengkapi semua tanggal dan nominal item.')
      return
    }
    setSaving(true)
    const total = editItems.reduce((s, it) => s + (Number(it.amount) || 0), 0)

    // Hapus item lama, insert item baru
    await supabase.from('reimbursement_items').delete().eq('reimbursement_id', r.id)
    await supabase.from('reimbursement_items').insert(
      editItems.map((it) => ({
        reimbursement_id: r.id,
        expense_date: it.expense_date,
        category: it.category,
        description: it.description,
        amount: Number(it.amount),
      }))
    )

    // Upload file baru kalau ada
    for (const file of editFiles) {
      const path = `${r.id}/${Date.now()}_${file.name}`
      const { error: upErr } = await supabase.storage.from('receipts').upload(path, file)
      if (!upErr) {
        await supabase.from('attachments').insert({
          reimbursement_id: r.id, file_name: file.name, file_path: path,
        })
      }
    }

    // Update status kembali ke submitted (atau langsung approved kalau Manager/
    // Admin, sama seperti alur submit baru), required_role kembali ke tahap awal
    await supabase.from('reimbursements').update({
      status: initialStatusFor(profile.role),
      required_role: requiredRoleFor(profile.role),
      total_amount: total,
    }).eq('id', r.id)

    // Catat di audit trail
    await supabase.from('approval_history').insert({
      reimbursement_id: r.id,
      approver_id: profile.id,
      action: 'submitted',
      notes: 'Pengajuan direvisi dan disubmit ulang oleh employee',
    })

    setSaving(false)
    setEditId(null)
    setMsg('')
    load()
    onRefresh && onRefresh()
  }

  const editTotal = editItems.reduce((s, it) => s + (Number(it.amount) || 0), 0)

  const filtered = rows.filter((r) => {
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    const matchNo     = r.request_no?.toLowerCase().includes(q)
    const matchDate   = r.request_date?.includes(q)
    const matchStatus = statusLabelFor(r)?.toLowerCase().includes(q)
    const matchAmt    = String(r.total_amount).includes(q)
    return matchNo || matchDate || matchStatus || matchAmt
  })

  useEffect(() => { setPage(1) }, [search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [totalPages, page])

  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize])

  return (
    <div className="card">
      <h3>Pengajuan Saya ({filtered.length}{filtered.length !== rows.length ? ` dari ${rows.length}` : ''})</h3>

      <div className="myreq-search">
        <input
          type="text"
          placeholder="🔍 Cari no. request, tanggal, status, atau nominal..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button type="button" className="btn btn-sm" style={{ background: '#eee', color: '#555' }} onClick={() => setSearch('')}>
            ✕ Bersihkan
          </button>
        )}
      </div>

      {msg && <div className="error-text" style={{ color: 'var(--danger)', marginBottom: 10 }}>{msg}</div>}
      {loadingData ? <SkeletonTable cols={5} rows={4} /> : rows.length === 0 ? (
        <div className="empty-state">Belum ada pengajuan.</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">Tidak ada pengajuan yang cocok dengan pencarian "{search}".</div>
      ) : (
        <div className="table-scroll">
        <table>
          <thead>
            <tr><th>No. Request</th><th>Tanggal</th><th>Total</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <React.Fragment key={r.id}>
                <tr className={editId === r.id ? 'row-selected' : ''}>
                  <td>{r.request_no}</td>
                  <td>{r.request_date}</td>
                  <td>{rupiah(r.total_amount)}</td>
                  <td><span className={`badge badge-${r.status}`}>{statusLabelFor(r)}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {r.status === 'revision' ? (
                      <button
                        className="btn btn-sm"
                        style={{ background: '#ffe6cc', color: '#b35900', fontWeight: 700 }}
                        onClick={() => editId === r.id ? setEditId(null) : openRevision(r)}
                      >
                        {editId === r.id ? 'Tutup' : '✏ Edit & Submit Ulang'}
                      </button>
                    ) : (
                      <span className="detail-toggle" onClick={() => toggleOpen(r.id)}>
                        {openId === r.id ? 'Tutup' : 'Detail'}
                      </span>
                    )}
                  </td>
                </tr>

                {/* Panel Revisi */}
                {editId === r.id && (
                  <tr>
                    <td colSpan={5}>
                      <div className="revision-panel">
                        <div className="revision-header">
                          ✏ Revisi Pengajuan <span>{r.request_no}</span>
                          <div className="revision-note">Nomor request tetap sama. Setelah submit ulang, alur approval: {approvalFlowLabel(profile.role, editTotal)}.</div>
                        </div>

                        {editItems.map((it, i) => (
                          <div className="item-row" key={i}>
                            <div>
                              <label>Tanggal</label>
                              <input type="date" value={it.expense_date} onChange={(e) => updateEditItem(i, 'expense_date', e.target.value)} required />
                            </div>
                            <div>
                              <label>Kategori</label>
                              <select value={it.category} onChange={(e) => updateEditItem(i, 'category', e.target.value)}>
                                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </div>
                            <div>
                              <label>Keterangan</label>
                              <input value={it.description} onChange={(e) => updateEditItem(i, 'description', e.target.value)} placeholder="Opsional" />
                            </div>
                            <div>
                              <label>Nominal</label>
                              <input type="number" min="1" value={it.amount} onChange={(e) => updateEditItem(i, 'amount', e.target.value)} required />
                            </div>
                            <div>
                              {editItems.length > 1 && (
                                <button type="button" className="btn btn-danger btn-sm" onClick={() => removeEditItem(i)}>Hapus</button>
                              )}
                            </div>
                          </div>
                        ))}

                        <button type="button" className="btn btn-sm" style={{ background: '#f1f3f5', color: '#333', marginTop: 10 }} onClick={addEditItem}>
                          + Tambah Item
                        </button>

                        <div className="total-line" style={{ marginTop: 10 }}>
                          Total: {rupiah(editTotal)} &nbsp;•&nbsp; Alur: {approvalFlowLabel(profile.role, editTotal)}
                        </div>

                        <label style={{ marginTop: 14 }}>Upload Bukti Transaksi Baru (opsional, file lama tetap tersimpan)</label>
                        <input type="file" accept="image/*,.pdf" multiple onChange={(e) => setEditFiles(Array.from(e.target.files))} />
                        {editFiles.length > 0 && (
                          <div className="checklist-line">{editFiles.length} file dipilih: {editFiles.map((f) => f.name).join(', ')}</div>
                        )}

                        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                          <button className="btn btn-primary" onClick={() => submitRevision(r)} disabled={saving}>
                            {saving ? <><span className="spinner" />Menyimpan...</> : '✓ Submit Ulang'}
                          </button>
                          <button className="btn btn-sm" style={{ background: '#eee', color: '#555' }} onClick={() => setEditId(null)}>
                            Batal
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Detail normal (non-revision) */}
                {openId === r.id && r.status !== 'revision' && (
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
        </div>
      )}

      {!loadingData && filtered.length > 0 && (
        <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={filtered.length} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------- APPROVAL ----
// Satu menu Approval untuk semua approver. Untuk Manager Departemen Finance
// (atau Admin), antrian ini digabung dengan tahap "Approval Finance Manager":
// selain melihat pengajuan departemen sendiri yang menunggu approval mereka
// (status 'submitted'), mereka juga melihat SEMUA pengajuan dari SEMUA
// departemen yang sudah lolos approval departemen masing-masing dan tinggal
// menunggu approval final Finance Manager sebelum dicairkan (status 'approved').
function ApprovalQueue({ profile, refreshKey, onActed }) {
  const [rows, setRows] = useState([])
  const [empProfiles, setEmpProfiles] = useState({}) // id -> { full_name, department }
  const [noteDraft, setNoteDraft] = useState({})
  const [selected, setSelected] = useState([])         // array of row.id
  const [bulkNote, setBulkNote] = useState('')
  const [confirm, setConfirm] = useState(null)         // single: { row, action }
  const [bulkConfirm, setBulkConfirm] = useState(null) // bulk: { action }
  const [processing, setProcessing] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  // Admin: lintas departemen (tidak dibatasi department pengaju).
  // Supervisor & Manager (termasuk yang di department Finance) hanya melihat
  // antrian approval di department mereka sendiri, sama seperti department lain.
  const isAdmin = profile.role === 'admin'
  // Manager Departemen Finance (atau Admin) juga bertindak sebagai approver
  // final lintas-departemen (tahap "Approval Finance Manager").
  const isFm = isFinanceManager(profile)

  useEffect(() => {
    async function load() {
      // ---- Tahap 1: approval departemen (status 'submitted') ----
      let query = supabase
        .from('reimbursements')
        .select('*, profiles(id, full_name, department, role)')
        .eq('status', 'submitted')

      // Admin melihat semua tahap; role lain hanya melihat pengajuan yang memang
      // sedang menunggu approval di tahap mereka, sesuai kolom required_role
      // (Waiting Approval SPV / Dept Manager)
      if (!isAdmin) query = query.eq('required_role', profile.role)

      const { data } = await query.order('created_at', { ascending: true })

      // Filter tambahan di client: Supervisor & Manager hanya melihat departemen sendiri.
      const deptRows = isAdmin
        ? (data || [])
        : (data || []).filter((r) => r.profiles?.department === profile.department)

      // ---- Tahap 2: Approval Finance Manager (status 'approved', lintas departemen) ----
      // Hanya untuk Manager Departemen Finance / Admin. Berlaku untuk pengajuan
      // dari SATU departemen maupun departemen lain (semua departemen).
      let fmRows = []
      if (isFm) {
        const { data: fmData } = await supabase
          .from('reimbursements')
          .select('*, profiles(id, full_name, department, role)')
          .eq('status', 'approved')
          .order('created_at', { ascending: true })
        fmRows = fmData || []
      }

      const merged = [
        ...deptRows.map((r) => ({ ...r, _stage: 'dept' })),
        ...fmRows.map((r) => ({ ...r, _stage: 'fm' })),
      ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

      setRows(merged)

      // Simpan map profil untuk ditampilkan di tabel & modal
      const map = {}
      merged.forEach((r) => {
        if (r.profiles) map[r.employee_id] = r.profiles
      })
      setEmpProfiles(map)
    }
    load()
  }, [profile.role, profile.department, refreshKey, isAdmin, isFm])

  function requestAct(row, action) {
    setConfirm({ row, action })
  }

  async function confirmAct() {
    const { row, action } = confirm
    setProcessing(true)
    const { error } = await applyAction(row, action, noteDraft[row.id])
    setProcessing(false)
    if (error) {
      alert('Gagal memproses aksi: ' + error.message)
      return
    }
    setConfirm(null)
    onActed && onActed()
  }

  // Menjalankan satu aksi approve/reject/revision untuk satu baris, otomatis
  // mengikuti tahap yang sesuai (_stage 'dept' = approval departemen SPV/Manager,
  // _stage 'fm' = Approval Finance Manager lintas-departemen sebelum pencairan).
  async function applyAction(row, action, note) {
    if (row._stage === 'fm') {
      // ---- Tahap Approval Finance Manager (status 'approved' -> 'finance_approved') ----
      if (action === 'approved') {
        const { error } = await supabase.from('reimbursements').update({ status: 'finance_approved' }).eq('id', row.id)
        if (error) return { error }
        const { error: histErr } = await supabase.from('approval_history').insert({
          reimbursement_id: row.id,
          approver_id: profile.id,
          action: 'finance_approved',
          notes: note || 'Disetujui Finance Manager — siap dicairkan',
        })
        return { error: histErr }
      } else {
        const newStatus = action === 'rejected' ? 'rejected' : 'revision'
        const { error } = await supabase.from('reimbursements').update({ status: newStatus }).eq('id', row.id)
        if (error) return { error }
        const { error: histErr } = await supabase.from('approval_history').insert({
          reimbursement_id: row.id,
          approver_id: profile.id,
          action: newStatus,
          notes: action === 'rejected'
            ? `[Rejected by Finance Manager] ${note || ''}`.trim()
            : (note || null),
        })
        return { error: histErr }
      }
    }

    // ---- Tahap approval departemen (status 'submitted') ----
    if (action === 'approved') {
      const submitterRole = row.profiles?.role
      const next = nextApprovalRole(row.required_role, submitterRole, row.total_amount)

      if (next) {
        // Masih ada tahap approval berikutnya (masih status 'submitted')
        const NEXT_LABEL = { manager: 'Manager' }
        const { error } = await supabase.from('reimbursements')
          .update({ required_role: next })
          .eq('id', row.id)
        if (error) return { error }
        const { error: histErr } = await supabase.from('approval_history').insert({
          reimbursement_id: row.id,
          approver_id: profile.id,
          action: 'approved',
          notes: (note || '') + ` [Disetujui, diteruskan ke ${NEXT_LABEL[next] || next}]`,
        })
        return { error: histErr }
      } else {
        // Approval departemen selesai → lanjut ke Approval Finance Manager (sebelum pencairan)
        const { error } = await supabase.from('reimbursements')
          .update({ status: 'approved' })
          .eq('id', row.id)
        if (error) return { error }
        const { error: histErr } = await supabase.from('approval_history').insert({
          reimbursement_id: row.id,
          approver_id: profile.id,
          action: 'approved',
          notes: note || null,
        })
        return { error: histErr }
      }
    } else {
      const newStatus = action === 'rejected' ? 'rejected' : 'revision'
      const rejectedByLabel = REJECTED_BY_LABEL[row.required_role] || profile.role
      const { error } = await supabase.from('reimbursements').update({ status: newStatus }).eq('id', row.id)
      if (error) return { error }
      const { error: histErr } = await supabase.from('approval_history').insert({
        reimbursement_id: row.id,
        approver_id: profile.id,
        action: newStatus,
        notes: action === 'rejected'
          ? `[Rejected by ${rejectedByLabel}] ${note || ''}`.trim()
          : (note || null),
      })
      return { error: histErr }
    }
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

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [totalPages, page])

  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize
    return rows.slice(start, start + pageSize)
  }, [rows, page, pageSize])

  // ---- Bulk confirm action ----
  async function confirmBulkAct() {
    const { action } = bulkConfirm
    setProcessing(true)
    const errors = []
    for (const id of selected) {
      const row = rows.find((x) => x.id === id)
      if (!row) continue
      const { error } = await applyAction(row, action, bulkNote || (action === 'approved' ? 'Bulk approve' : `Bulk ${action}`))
      if (error) errors.push(`${row.request_no}: ${error.message}`)
    }
    setProcessing(false)
    setBulkConfirm(null)
    setSelected([])
    setBulkNote('')
    if (errors.length) alert('Sebagian aksi gagal diproses:\n' + errors.join('\n'))
    onActed && onActed()
  }

  // Label "Rejected by X" untuk audit trail, sesuai tabel status sistem
  const REJECTED_BY_LABEL = {
    supervisor: 'SPV',
    manager: 'Dept Manager',
  }

  const ACTION_META = {
    approved: {
      label: 'Approve',
      color: 'var(--success)',
      icon: '✓',
      desc: (row) => {
        if (!row) return ''
        if (row._stage === 'fm') return 'Setelah Anda setujui (Finance Manager), pengajuan siap dicairkan dan akan masuk ke antrian Finance Verification.'
        const next = nextApprovalRole(row.required_role, row.profiles?.role, row.total_amount)
        if (next === 'manager') return 'Nominal ≥ Rp5jt — setelah Anda setujui, pengajuan diteruskan ke Manager Departemen.'
        return 'Setelah Anda setujui, pengajuan akan masuk ke antrian Approval Finance Manager (sebelum dana dicairkan).'
      },
    },
    rejected: { label: 'Reject', color: 'var(--danger)', icon: '✕', desc: () => 'Pengajuan akan ditolak dan employee akan diberitahu.' },
    revision: { label: 'Kembalikan untuk Revisi', color: '#b35900', icon: '↩', desc: () => 'Pengajuan dikembalikan ke employee untuk diperbaiki.' },
  }

  // Label tahap per baris, ditampilkan sebagai badge di tabel supaya jelas
  // mana pengajuan tahap approval departemen vs tahap Approval Finance Manager.
  function stageLabel(row) {
    if (row._stage === 'fm') return 'Finance Manager (Final)'
    return APPROVER_ROLE_LABEL[row.required_role] || row.required_role
  }

  const queueLabel = isFm
    ? (isAdmin ? 'Semua Departemen (Admin) + Approval Finance Manager' : `Dept. ${profile.department} + Approval Finance Manager (Semua Departemen)`)
    : isAdmin
      ? 'Semua Departemen (Admin)'
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
          <div className="empty-state">Tidak ada pengajuan yang menunggu approval Anda saat ini.</div>
        ) : (
          <div className="table-scroll">
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
                <th>No. Request</th><th>Employee</th><th>Departemen</th>{isFm && <th>Tahap</th>}<th>Total</th><th>Catatan</th><th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
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
                  {isFm && (
                    <td>
                      <span
                        style={{
                          fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
                          background: r._stage === 'fm' ? '#fdecea' : '#eaf4fd',
                          color: r._stage === 'fm' ? '#b3261e' : '#0b5fa5',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {stageLabel(r)}
                      </span>
                    </td>
                  )}
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
          </div>
        )}

        {rows.length > 0 && (
          <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={rows.length} />
        )}
      </div>

      {confirm && (
        <div className="modal-overlay" onClick={() => !processing && setConfirm(null)}>
          <div className="modal-box confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon" style={{ color: ACTION_META[confirm.action].color }}>
              {ACTION_META[confirm.action].icon}
            </div>
            <h3 className="confirm-title">Konfirmasi {ACTION_META[confirm.action].label}</h3>
            <p className="confirm-desc">{ACTION_META[confirm.action].desc(confirm.row)}</p>

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
            </p>            <div className="confirm-detail">
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

// ---------------------------------------------------------------- FINANCE VERIFICATION (SETELAH PENCAIRAN) ----
// Tahap ini dilakukan SETELAH uang benar-benar sudah ditransfer/dibayarkan ke
// pengaju, sebagai konfirmasi/penutupan pengajuan. Bisa dilakukan oleh SIAPA
// SAJA di department Finance (role apa pun) + Admin — beda dengan tahap
// Approval Finance Manager di atas yang khusus Finance Manager/Admin saja.
function FinanceVerification({ profile, refreshKey, onActed }) {
  const [rows, setRows] = useState([])
  const [names, setNames] = useState({})
  const [openId, setOpenId] = useState(null)
  const [attMap, setAttMap] = useState({})
  const [noteDraft, setNoteDraft] = useState({})
  const [confirm, setConfirm] = useState(null)   // { row, action }
  const [disbursedDate, setDisbursedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [dateError, setDateError] = useState('')
  const [processing, setProcessing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  useEffect(() => {
    async function load() {
      setLoadError('')
      const { data, error } = await supabase
        .from('reimbursements')
        .select('*')
        .eq('status', 'finance_approved')
        .order('created_at', { ascending: true })
      if (error) { setLoadError(error.message); return }
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

  useEffect(() => { setPage(1) }, [refreshKey])

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [totalPages, page])

  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize
    return rows.slice(start, start + pageSize)
  }, [rows, page, pageSize])

  async function toggleOpen(id) {
    if (openId === id) { setOpenId(null); return }
    setOpenId(id)
    if (!attMap[id]) {
      const list = await fetchAttachments(id)
      setAttMap((m) => ({ ...m, [id]: list }))
    }
  }

  function requestAct(row, action) {
    setDisbursedDate(new Date().toISOString().slice(0, 10))
    setDateError('')
    setConfirm({ row, action })
  }

  async function confirmAct() {
    const { row, action } = confirm
    if (action === 'verified' && !disbursedDate) {
      setDateError('Tanggal pencairan dana wajib diisi.')
      return
    }
    setDateError('')
    setProcessing(true)
    const newStatus = action === 'verified' ? 'verified' : 'revision'
    const { error: updErr } = await supabase.from('reimbursements').update({ status: newStatus }).eq('id', row.id)
    if (updErr) {
      setProcessing(false)
      alert('Gagal memproses verifikasi: ' + updErr.message)
      return
    }
    const { error: histErr } = await supabase.from('approval_history').insert({
      reimbursement_id: row.id,
      approver_id: profile.id,
      action: newStatus,
      notes: noteDraft[row.id] || (action === 'verified' ? 'Dana sudah dicairkan / dibayarkan' : null),
      // Tanggal aktual dana dicairkan (diisi manual oleh Finance saat
      // verifikasi) — INI yang dipakai sebagai tanggal transaksi "Kas
      // Keluar" di Laporan Arus Kas, BUKAN created_at (jam sistem saat
      // tombol Verifikasi diklik, yang bisa beda hari dengan tanggal dana
      // sungguh-sungguh ditransfer ke pengaju).
      disbursed_date: action === 'verified' ? disbursedDate : null,
    })
    setProcessing(false)
    if (histErr) {
      // Status reimbursement sudah berhasil diubah, tapi pencatatan riwayat gagal —
      // tetap beri tahu user supaya tidak mengira aksi gagal total.
      alert('Verifikasi berhasil, namun gagal mencatat riwayat: ' + histErr.message)
    }
    setConfirm(null)
    onActed && onActed()
  }

  const VERIFY_ACTION_META = {
    verified: {
      label: 'Verifikasi',
      color: 'var(--success)',
      icon: '✓',
      desc: (row) => `Konfirmasi bahwa dana sebesar ${rupiah(row?.total_amount)} untuk ${row?.request_no} sudah benar-benar ditransfer/dicairkan ke pengaju. Pengajuan akan ditutup sebagai "Terverifikasi".`,
    },
    revision: {
      label: 'Kembalikan',
      color: '#b35900',
      icon: '↩',
      desc: () => 'Pengajuan dikembalikan untuk revisi (misalnya bukti transaksi kurang lengkap/sesuai).',
    },
  }

  return (
    <div className="card">
      <h3>Finance Verification <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 13 }}>(Konfirmasi setelah dana dicairkan)</span></h3>
      {loadError && <div className="empty-state" style={{ color: 'var(--danger)' }}>Gagal memuat data: {loadError}</div>}
      {rows.length === 0 && !loadError ? (
        <div className="empty-state">Tidak ada pengajuan yang menunggu verifikasi finance.</div>
      ) : (
        <div className="table-scroll">
        <table>
          <thead>
            <tr><th>No. Request</th><th>Employee</th><th>Total</th><th>Bukti & Catatan</th><th>Aksi</th></tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
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
                    <button className="btn btn-success btn-sm" onClick={() => requestAct(r, 'verified')}>Verifikasi</button>{' '}
                    <button className="btn btn-sm" style={{ background: '#ffe6cc', color: '#b35900' }} onClick={() => requestAct(r, 'revision')}>Kembalikan</button>
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
        </div>
      )}

      {rows.length > 0 && (
        <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={rows.length} />
      )}

      {/* ---- Pop-up konfirmasi verifikasi / kembalikan ---- */}
      {confirm && (
        <div className="modal-overlay" onClick={() => !processing && setConfirm(null)}>
          <div className="modal-box confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon" style={{ color: VERIFY_ACTION_META[confirm.action].color }}>
              {VERIFY_ACTION_META[confirm.action].icon}
            </div>
            <h3 className="confirm-title">Konfirmasi {VERIFY_ACTION_META[confirm.action].label}</h3>
            <p className="confirm-desc">{VERIFY_ACTION_META[confirm.action].desc(confirm.row)}</p>

            <div className="confirm-detail">
              <div className="confirm-row"><span>No. Request</span><strong>{confirm.row.request_no}</strong></div>
              <div className="confirm-row"><span>Employee</span><strong>{names[confirm.row.employee_id] || '—'}</strong></div>
              <div className="confirm-row"><span>Total Dicairkan</span><strong>{rupiah(confirm.row.total_amount)}</strong></div>
              {noteDraft[confirm.row.id] && (
                <div className="confirm-row"><span>Catatan</span><strong>{noteDraft[confirm.row.id]}</strong></div>
              )}
            </div>

            {confirm.action === 'verified' && (
              <div style={{ textAlign: 'left', marginTop: 10, marginBottom: 4 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>Tanggal Dana Dicairkan</label>
                <input
                  type="date"
                  value={disbursedDate}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => { setDisbursedDate(e.target.value); setDateError('') }}
                  required
                />
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  Tanggal ini akan dipakai sebagai tanggal transaksi "Kas Keluar" di Laporan Arus Kas.
                </div>
                {dateError && <div className="empty-state" style={{ color: 'var(--danger)', padding: 0, marginTop: 6 }}>{dateError}</div>}
              </div>
            )}

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
                style={{ background: VERIFY_ACTION_META[confirm.action].color, color: '#fff', flex: 1 }}
                onClick={confirmAct}
                disabled={processing || (confirm.action === 'verified' && !disbursedDate)}
              >
                {processing ? <><span className="spinner" />Memproses...</> : `Ya, ${VERIFY_ACTION_META[confirm.action].label}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- SALDO KAS (CASH BALANCE) ----
// Hanya untuk user department "Finance" (role apa pun) atau admin — dijaga di
// level UI (nav item disembunyikan) DAN di level database (RLS policy
// "cash_topups_select_finance" / "..._insert_finance" di supabase-update-v3.sql),
// jadi tetap aman walau seseorang mencoba akses langsung lewat API.
// ---------------------------------------------------------------- SUBMIT KAS (Isi Ulang Saldo) ----
// Halaman ini HANYA untuk mengisi ulang (top-up) saldo kas kecil. Tabel
// "Laporan Arus Kas" (riwayat transaksi lengkap + filter + export) sengaja
// DIPISAH ke halaman/menu tersendiri (lihat komponen CashFlowReport di
// bawah) supaya menu ini tetap fokus untuk aksi submit/isi ulang saja.
function CashBalance({ profile, refreshKey, onActed }) {
  const [topups, setTopups] = useState([])
  const [disbursements, setDisbursements] = useState([]) // dipakai untuk hitung saldo berjalan saja
  const [profilesById, setProfilesById] = useState({}) // id -> {full_name, signature_url}, untuk kolom "Diinput Oleh" & cetak slip
  const [loadingData, setLoadingData] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [amount, setAmount] = useState('')
  const [topupDate, setTopupDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const load = useCallback(async () => {
    setLoadingData(true)
    setLoadError('')

    try {
      const [topupRes, disbRes] = await Promise.all([
        supabase.from('cash_topups').select('*'),
        supabase
          .from('approval_history')
          .select('id, reimbursement_id, reimbursements(total_amount, status)')
          .eq('action', 'verified'),
      ])

      if (topupRes.error) { setLoadError(topupRes.error.message); return }
      if (disbRes.error) { console.error('Gagal memuat riwayat pencairan:', disbRes.error.message) }

      setTopups(topupRes.data || [])
      setDisbursements((disbRes.data || []).filter((d) => d.reimbursements))

      // Ambil nama & tanda tangan digital user yang menginput pengisian kas —
      // dipakai di kolom "Diinput Oleh" pada tabel riwayat, sekaligus untuk
      // mengisi kolom tanda tangan saat tombol "Cetak Slip" per baris ditekan.
      const ids = [...new Set((topupRes.data || []).map((t) => t.created_by).filter(Boolean))]
      if (ids.length) {
        const { data: profs, error: profErr } = await supabase.from('profiles').select('id, full_name, signature_url').in('id', ids)
        if (profErr) {
          console.error('Gagal memuat profil:', profErr.message)
        } else {
          const map = {}
          ;(profs || []).forEach((p) => { map[p.id] = p })
          setProfilesById(map)
        }
      }
    } catch (err) {
      console.error('Gagal memuat data saldo kas:', err)
      setLoadError(err?.message || 'Terjadi kesalahan tak terduga saat memuat data.')
    } finally {
      setLoadingData(false)
    }
  }, [])

  useEffect(() => { load() }, [load, refreshKey])

  // Riwayat pengisian kas, urut terbaru dulu untuk ditampilkan di tabel.
  const topupHistory = useMemo(() => {
    return [...topups].sort((a, b) => {
      const ta = new Date(a.topup_date + 'T00:00:00').getTime()
      const tb = new Date(b.topup_date + 'T00:00:00').getTime()
      if (tb !== ta) return tb - ta
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    })
  }, [topups])

  useEffect(() => { setPage(1) }, [topups.length])
  const totalPages = Math.max(1, Math.ceil(topupHistory.length / pageSize))
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [totalPages, page])
  const pageTopups = useMemo(() => {
    const start = (page - 1) * pageSize
    return topupHistory.slice(start, start + pageSize)
  }, [topupHistory, page, pageSize])

  // Cetak slip untuk SATU baris pengisian kas (bukan export gabungan) —
  // memakai tema hijau "KAS MASUK" dari slip.js supaya langsung kelihatan
  // beda dari slip reimbursement (uang keluar) saat dicetak/diarsipkan.
  function handlePrintTopup(t) {
    const creator = profilesById[t.created_by]
    printCashTopupSlip(t, creator?.full_name, creator?.signature_url, false)
  }

  const totalTopup = topups.reduce((s, t) => s + Number(t.amount), 0)
  const verifiedTotal = disbursements.reduce((s, d) => s + Number(d.reimbursements?.total_amount || 0), 0)
  const saldo = totalTopup - verifiedTotal

  function handleSubmit(e) {
    e.preventDefault()
    setSaveError('')
    const amt = Number(amount)
    if (!amt || amt <= 0) { setSaveError('Nominal harus lebih dari 0.'); return }
    setShowConfirm(true)
  }

  async function confirmTopup() {
    setSaving(true)
    const { error } = await supabase.from('cash_topups').insert({
      amount: Number(amount),
      topup_date: topupDate,
      note: note || null,
      created_by: profile.id,
      topup_no: generateTopupNo(),
    })
    setSaving(false)
    setShowConfirm(false)
    if (error) { setSaveError('Gagal menyimpan: ' + error.message); return }

    setAmount(''); setNote('')
    setTopupDate(new Date().toISOString().slice(0, 10))
    load()
    onActed && onActed()
  }

  return (
    <>
      <div className="grid-kpi">
        {loadingData ? Array(3).fill(0).map((_, i) => (
          <div className="kpi-box" key={i}>
            <div className="skeleton-row short" style={{ marginBottom: 8 }} />
            <div className="skeleton-row medium" style={{ height: 28 }} />
          </div>
        )) : <>
          <div className="kpi-box">
            <div className="label">Saldo Kas Saat Ini</div>
            <div className="value" style={{ color: saldo < 0 ? 'var(--danger)' : undefined }}>{rupiah(saldo)}</div>
          </div>
          <div className="kpi-box"><div className="label">Total Kas Masuk (Topup)</div><div className="value">{rupiah(totalTopup)}</div></div>
          <div className="kpi-box"><div className="label">Total Sudah Dicairkan</div><div className="value">{rupiah(verifiedTotal)}</div></div>
        </>}
      </div>

      {saldo < 0 && !loadingData && (
        <div className="empty-state" style={{ color: 'var(--danger)', marginBottom: 16 }}>
          Saldo kas minus. Pengeluaran yang sudah terverifikasi melebihi total kas masuk yang tercatat — segera isi ulang saldo kas.
        </div>
      )}

      {loadError && <div className="empty-state" style={{ color: 'var(--danger)' }}>Gagal memuat data: {loadError}</div>}

      <div className="card" style={{ maxWidth: 480, marginBottom: 20 }}>
        <h3>Isi Ulang Saldo Kas</h3>
        <form onSubmit={handleSubmit}>
          <label>Nominal (Rp)</label>
          <input
            type="number"
            min="1"
            step="1"
            placeholder="cth. 5000000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
          <label>Tanggal</label>
          <input type="date" value={topupDate} onChange={(e) => setTopupDate(e.target.value)} required />
          <label>Catatan (opsional)</label>
          <input
            type="text"
            placeholder="cth. Transfer dari rekening perusahaan"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {saveError && <div className="empty-state" style={{ color: 'var(--danger)' }}>{saveError}</div>}
          <button className="btn btn-success" type="submit" style={{ marginTop: 10 }}>
            Tambah Saldo
          </button>
        </form>
      </div>

      {/* ---- Tabel Riwayat Pengisian Kas ---- */}
      <div className="card">
        <h3>Riwayat Pengisian Kas ({topupHistory.length})</h3>
        <div className="bulk-bar" style={{ marginBottom: 14 }}>
          <span className="bulk-count">Total Pengisian: {rupiah(totalTopup)}</span>
        </div>

        {loadError && <div className="empty-state" style={{ color: 'var(--danger)' }}>Gagal memuat data: {loadError}</div>}
        {topupHistory.length === 0 && !loadError ? (
          <div className="empty-state">Belum ada riwayat pengisian kas.</div>
        ) : (
          <div className="table-scroll">
          <table>
            <thead>
              <tr><th>No. Pengisian</th><th>Tanggal</th><th style={{ textAlign: 'right' }}>Nominal</th><th>Catatan</th><th>Diinput Oleh</th><th>Aksi</th></tr>
            </thead>
            <tbody>
              {pageTopups.map((t) => (
                <tr key={t.id}>
                  <td>{t.topup_no || '—'}</td>
                  <td>{t.topup_date}</td>
                  <td style={{ textAlign: 'right', color: '#1f8a4c', fontWeight: 700 }}>{rupiah(Number(t.amount) || 0)}</td>
                  <td>{t.note || '—'}</td>
                  <td>{profilesById[t.created_by]?.full_name || '—'}</td>
                  <td>
                    <button className="btn btn-sm" style={{ background: '#1f8a4c', color: '#fff' }} onClick={() => handlePrintTopup(t)}>
                      🖨 Cetak Slip
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}

        {topupHistory.length > 0 && (
          <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={topupHistory.length} />
        )}
      </div>

      {/* ---- Pop-up konfirmasi isi ulang saldo kas ---- */}
      {showConfirm && (
        <div className="modal-overlay" onClick={() => !saving && setShowConfirm(false)}>
          <div className="modal-box confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon" style={{ color: '#1f8a4c' }}>💰</div>
            <h3 className="confirm-title">Konfirmasi Isi Ulang Saldo Kas</h3>
            <p className="confirm-desc">Pastikan data di bawah ini sudah benar sebelum disimpan.</p>

            <div className="confirm-detail">
              <div className="confirm-row"><span>Nominal</span><strong>{rupiah(Number(amount) || 0)}</strong></div>
              <div className="confirm-row"><span>Tanggal</span><strong>{topupDate}</strong></div>
              <div className="confirm-row"><span>Catatan</span><strong>{note || '—'}</strong></div>
            </div>

            <div className="confirm-actions">
              <button className="btn" style={{ background: '#f1f3f5', color: '#333', flex: 1 }} onClick={() => setShowConfirm(false)} disabled={saving}>
                Batal
              </button>
              <button className="btn" style={{ background: '#1f8a4c', color: '#fff', flex: 1 }} onClick={confirmTopup} disabled={saving}>
                {saving ? <><span className="spinner" />Menyimpan...</> : 'Ya, Tambah Saldo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------- LAPORAN ARUS KAS ----
// Menu terpisah, khusus department Finance (lihat isFinanceUser). Berisi
// riwayat lengkap kas masuk (top-up) & kas keluar (reimbursement yang sudah
// dicairkan/verified), lengkap dengan filter periode/tipe serta export
// Excel & PDF. Tidak ada aksi "isi ulang saldo" di sini — itu ada di menu
// "Submit Kas" tersendiri.
function CashFlowReport({ profile, refreshKey }) {
  const [topups, setTopups] = useState([])
  const [disbursements, setDisbursements] = useState([]) // approval_history rows (action='verified') + joined reimbursement info
  const [loadingData, setLoadingData] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [names, setNames] = useState({})

  const [filterType, setFilterType] = useState('all') // all | in | out
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [exportingExcel, setExportingExcel] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const load = useCallback(async () => {
    setLoadingData(true)
    setLoadError('')

    try {
      const [topupRes, disbRes] = await Promise.all([
        supabase.from('cash_topups').select('*'),
        supabase
          .from('approval_history')
          .select('id, created_at, disbursed_date, reimbursement_id, reimbursements(request_no, employee_id, total_amount, status)')
          .eq('action', 'verified'),
      ])

      if (topupRes.error) { setLoadError(topupRes.error.message); return }
      if (disbRes.error) { console.error('Gagal memuat riwayat pencairan:', disbRes.error.message) }

      setTopups(topupRes.data || [])
      setDisbursements((disbRes.data || []).filter((d) => d.reimbursements))

      const idSet = new Set()
      ;(topupRes.data || []).forEach((t) => t.created_by && idSet.add(t.created_by))
      ;(disbRes.data || []).forEach((d) => d.reimbursements?.employee_id && idSet.add(d.reimbursements.employee_id))
      const ids = [...idSet]
      if (ids.length) {
        const { data: profs, error: profErr } = await supabase.from('profiles').select('id, full_name').in('id', ids)
        if (profErr) {
          console.error('Gagal memuat nama:', profErr.message)
        } else {
          const map = {}
          ;(profs || []).forEach((p) => { map[p.id] = p.full_name })
          setNames(map)
        }
      }
    } catch (err) {
      console.error('Gagal memuat data laporan arus kas:', err)
      setLoadError(err?.message || 'Terjadi kesalahan tak terduga saat memuat data.')
    } finally {
      setLoadingData(false)
    }
  }, [])

  useEffect(() => { load() }, [load, refreshKey])

  // Gabungkan kas masuk (topup) & kas keluar (reimbursement yang sudah
  // dicairkan/verified) jadi satu buku arus kas, urut tanggal naik, dengan
  // saldo berjalan (running balance) yang dihitung dari SELURUH riwayat —
  // supaya saldo tetap akurat walau tabel sedang difilter per periode.
  //
  // PENTING soal tanggal: `topup_date` adalah kolom date murni (tanpa jam),
  // sedangkan tanggal verifikasi reimbursement diambil dari `created_at`
  // (timestamptz, tersimpan dalam UTC). Kalau tanggal UTC itu langsung
  // dipotong mentah-mentah (mis. `.slice(0,10)`), transaksi yang terjadi
  // dini hari WIB bisa "geser" tampil mundur sehari dibanding tanggal lokal
  // sebenarnya — laporan jadi kelihatan tidak urut. Di bawah ini semua
  // tanggal dikonversi dulu ke tanggal LOKAL (zona waktu browser/WIB)
  // sebelum dipakai untuk ditampilkan maupun diurutkan, dan transaksi di
  // hari yang sama diurutkan lagi berdasarkan jam pastinya (sortTie).
  const fullLedger = useMemo(() => {
    const localDateOnly = (iso) => {
      const d = new Date(iso)
      const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0')
      return `${y}-${m}-${day}`
    }

    const inEntries = topups.map((t) => {
      const dayTs = new Date(t.topup_date + 'T00:00:00').getTime()
      return {
        id: 'in-' + t.id,
        date: t.topup_date,
        sortTs: dayTs,
        sortTie: t.created_at ? new Date(t.created_at).getTime() : dayTs,
        type: 'in',
        description: t.note || 'Isi ulang kas',
        ref: t.topup_no || '—',
        person: names[t.created_by] || '—',
        amount: Number(t.amount) || 0,
      }
    })
    const outEntries = disbursements.map((d) => {
      // Utamakan `disbursed_date` (tanggal aktual dana dicairkan, diisi
      // manual oleh Finance saat verifikasi). Fallback ke `created_at`
      // hanya untuk data lama (sebelum field ini ada).
      const localDate = d.disbursed_date || localDateOnly(d.created_at)
      return {
        id: 'out-' + d.id,
        date: localDate,
        sortTs: new Date(localDate + 'T00:00:00').getTime(),
        sortTie: new Date(d.created_at).getTime(),
        type: 'out',
        description: `Pencairan Reimbursement ${d.reimbursements?.request_no || ''}`,
        ref: d.reimbursements?.request_no || '—',
        person: names[d.reimbursements?.employee_id] || '—',
        amount: Number(d.reimbursements?.total_amount) || 0,
      }
    })
    const merged = [...inEntries, ...outEntries].sort((a, b) => (a.sortTs - b.sortTs) || (a.sortTie - b.sortTie))
    let running = 0
    return merged.map((e) => {
      running += e.type === 'in' ? e.amount : -e.amount
      return { ...e, balance: running }
    })
  }, [topups, disbursements, names])

  const totalTopup = topups.reduce((s, t) => s + Number(t.amount), 0)
  const verifiedTotal = disbursements.reduce((s, d) => s + Number(d.reimbursements?.total_amount || 0), 0)
  const saldo = totalTopup - verifiedTotal

  // Baris yang lolos filter periode & tipe, TAPI saldo berjalan yang
  // ditampilkan tetap dari fullLedger (bukan dihitung ulang dari 0), supaya
  // laporan tetap benar meski sedang difilter.
  const filteredLedger = useMemo(() => {
    return fullLedger.filter((e) => {
      if (filterType !== 'all' && e.type !== filterType) return false
      if (dateFrom && e.date < dateFrom) return false
      if (dateTo && e.date > dateTo) return false
      return true
    }).sort((a, b) => (b.sortTs - a.sortTs) || (b.sortTie - a.sortTie)) // tampilan: terbaru dulu
  }, [fullLedger, filterType, dateFrom, dateTo])

  const periodMasuk = filteredLedger.filter((e) => e.type === 'in').reduce((s, e) => s + e.amount, 0)
  const periodKeluar = filteredLedger.filter((e) => e.type === 'out').reduce((s, e) => s + e.amount, 0)
  const hasActiveFilter = filterType !== 'all' || dateFrom || dateTo

  useEffect(() => { setPage(1) }, [filterType, dateFrom, dateTo])

  const totalPages = Math.max(1, Math.ceil(filteredLedger.length / pageSize))
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [totalPages, page])

  // Halaman yang sedang ditampilkan di tabel. Export Excel/PDF tetap pakai
  // `filteredLedger` (SELURUH data yang lolos filter), bukan `pageLedger` —
  // supaya export tidak ikut kepotong ke satu halaman saja.
  const pageLedger = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredLedger.slice(start, start + pageSize)
  }, [filteredLedger, page, pageSize])

  function resetFilters() { setFilterType('all'); setDateFrom(''); setDateTo('') }

  // ---- Export Excel: laporan arus kas (baris yang sedang tampil / sudah difilter) ----
  async function handleExportExcel() {
    if (filteredLedger.length === 0) return
    setExportingExcel(true)
    try {
      const { default: ExcelJS } = await import('exceljs')
      const wb = new ExcelJS.Workbook()
      wb.creator = 'PCRS App'
      wb.created = new Date()

      const ws = wb.addWorksheet('Laporan Arus Kas', { views: [{ state: 'frozen', ySplit: 4, showGridLines: false }] })
      ws.columns = [{ width: 5 }, { width: 14 }, { width: 34 }, { width: 16 }, { width: 22 }, { width: 18 }, { width: 18 }, { width: 18 }]

      ws.mergeCells('A1:H1')
      ws.getCell('A1').value = 'Laporan Arus Kas Kecil'
      ws.getCell('A1').font = { size: 16, bold: true, color: { argb: 'FF14213D' } }

      ws.mergeCells('A2:H2')
      ws.getCell('A2').value = `Diekspor: ${new Date().toLocaleString('id-ID')}   |   Periode: ${dateFrom || 'Awal'} s/d ${dateTo || 'Sekarang'}   |   ${filteredLedger.length} transaksi`
      ws.getCell('A2').font = { size: 10, italic: true, color: { argb: 'FF666666' } }

      const headers = ['No', 'Tanggal', 'Keterangan', 'No. Ref', 'Terkait', 'Kas Masuk', 'Kas Keluar', 'Saldo']
      const headerRow = ws.getRow(4)
      headers.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1)
        cell.value = h
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14213D' } }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
      })
      headerRow.height = 22

      // tampilkan urut tanggal naik di file excel supaya enak dibaca sebagai laporan
      const rowsAsc = [...filteredLedger].sort((a, b) => (a.sortTs - b.sortTs) || (a.sortTie - b.sortTie))
      rowsAsc.forEach((e, idx) => {
        const row = ws.getRow(5 + idx)
        row.getCell(1).value = idx + 1
        row.getCell(2).value = e.date
        row.getCell(3).value = e.description
        row.getCell(4).value = e.ref
        row.getCell(5).value = e.person
        row.getCell(6).value = e.type === 'in' ? e.amount : null
        row.getCell(7).value = e.type === 'out' ? e.amount : null
        row.getCell(8).value = e.balance
        row.getCell(6).numFmt = '"Rp" #,##0'
        row.getCell(7).numFmt = '"Rp" #,##0'
        row.getCell(8).numFmt = '"Rp" #,##0'
        const isEven = idx % 2 === 0
        for (let c = 1; c <= 8; c++) {
          const cell = row.getCell(c)
          cell.alignment = { vertical: 'middle', horizontal: c === 1 ? 'center' : (c >= 6 ? 'right' : 'left') }
          if (isEven) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F8FA' } }
        }
      })

      const totalRowIdx = 5 + rowsAsc.length
      const totalRow = ws.getRow(totalRowIdx)
      ws.mergeCells(`A${totalRowIdx}:E${totalRowIdx}`)
      totalRow.getCell(1).value = 'Total Periode Ini'
      totalRow.getCell(1).font = { bold: true }
      totalRow.getCell(1).alignment = { horizontal: 'right' }
      totalRow.getCell(6).value = periodMasuk
      totalRow.getCell(7).value = periodKeluar
      totalRow.getCell(8).value = rowsAsc.length ? rowsAsc[rowsAsc.length - 1].balance : saldo
      ;[6, 7, 8].forEach((c) => { totalRow.getCell(c).numFmt = '"Rp" #,##0'; totalRow.getCell(c).font = { bold: true } })
      for (let c = 1; c <= 8; c++) totalRow.getCell(c).border = { top: { style: 'double', color: { argb: 'FF14213D' } } }

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Laporan_Arus_Kas_${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
      alert('Gagal membuat file Excel. Silakan coba lagi.')
    } finally {
      setExportingExcel(false)
    }
  }

  // ---- Export PDF: buka jendela print berisi tabel laporan, lalu user
  // pilih "Save as PDF" di dialog print browser (pola yang sama dipakai
  // untuk cetak slip reimbursement di slip.js). ----
  function handleExportPdf() {
    if (filteredLedger.length === 0) return
    setExportingPdf(true)
    const rowsAsc = [...filteredLedger].sort((a, b) => (a.sortTs - b.sortTs) || (a.sortTie - b.sortTie))
    const rowsHtml = rowsAsc.map((e, idx) => `
      <tr>
        <td style="text-align:center">${idx + 1}</td>
        <td>${e.date}</td>
        <td>${e.description}</td>
        <td>${e.ref}</td>
        <td>${e.person}</td>
        <td style="text-align:right;color:#1f8a4c">${e.type === 'in' ? rupiah(e.amount) : ''}</td>
        <td style="text-align:right;color:#b3261e">${e.type === 'out' ? rupiah(e.amount) : ''}</td>
        <td style="text-align:right;font-weight:700">${rupiah(e.balance)}</td>
      </tr>`).join('')

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Laporan Arus Kas</title>
    <style>
      * { box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; }
      body { margin: 24px; color: #14213d; }
      h1 { font-size: 18px; margin: 0 0 4px; }
      .sub { font-size: 11px; color: #666; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; }
      thead th { background: #14213d; color: #fff; padding: 6px 8px; font-size: 10px; text-transform: uppercase; text-align: left; }
      tbody td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px; }
      tfoot td { padding: 8px; font-size: 12px; font-weight: 700; border-top: 2px solid #14213d; }
      @media print { @page { margin: 15mm; size: landscape; } }
    </style></head><body>
      <h1>Laporan Arus Kas Kecil</h1>
      <div class="sub">Diekspor: ${new Date().toLocaleString('id-ID')} &nbsp;|&nbsp; Periode: ${dateFrom || 'Awal'} s/d ${dateTo || 'Sekarang'} &nbsp;|&nbsp; ${rowsAsc.length} transaksi</div>
      <table>
        <thead><tr><th>No</th><th>Tanggal</th><th>Keterangan</th><th>No. Ref</th><th>Terkait</th><th>Kas Masuk</th><th>Kas Keluar</th><th>Saldo</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot><tr>
          <td colspan="5" style="text-align:right">Total Periode Ini</td>
          <td style="text-align:right;color:#1f8a4c">${rupiah(periodMasuk)}</td>
          <td style="text-align:right;color:#b3261e">${rupiah(periodKeluar)}</td>
          <td style="text-align:right">${rupiah(rowsAsc.length ? rowsAsc[rowsAsc.length - 1].balance : saldo)}</td>
        </tr></tfoot>
      </table>
      <script>
        window.onload = () => { window.print(); }
      </script>
    </body></html>`

    const w = window.open('', '_blank', 'width=1000,height=700')
    w.document.write(html)
    w.document.close()
    setExportingPdf(false)
  }

  return (
    <>
      <div className="grid-kpi">
        {loadingData ? Array(3).fill(0).map((_, i) => (
          <div className="kpi-box" key={i}>
            <div className="skeleton-row short" style={{ marginBottom: 8 }} />
            <div className="skeleton-row medium" style={{ height: 28 }} />
          </div>
        )) : <>
          <div className="kpi-box">
            <div className="label">Saldo Kas Saat Ini</div>
            <div className="value" style={{ color: saldo < 0 ? 'var(--danger)' : undefined }}>{rupiah(saldo)}</div>
          </div>
          <div className="kpi-box"><div className="label">Total Kas Masuk (Topup)</div><div className="value">{rupiah(totalTopup)}</div></div>
          <div className="kpi-box"><div className="label">Total Sudah Dicairkan</div><div className="value">{rupiah(verifiedTotal)}</div></div>
        </>}
      </div>

      {/* ---- Filter Laporan Arus Kas ---- */}
      <div className="filter-panel">
        <div className="filter-panel-head">
          <div className="filter-title"><span className="filter-icon">⚲</span> Filter Laporan</div>
          {hasActiveFilter && <span className="filter-clear-all" onClick={resetFilters}>Hapus semua filter</span>}
        </div>
        <div className="filter-grid">
          <div className="filter-field">
            <label><span className="f-ico">●</span> Jenis Transaksi</label>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="all">Semua Transaksi</option>
              <option value="in">Kas Masuk</option>
              <option value="out">Kas Keluar</option>
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
        {hasActiveFilter && (
          <div className="chip-row">
            {filterType !== 'all' && <span className="chip">{filterType === 'in' ? 'Kas Masuk' : 'Kas Keluar'}<span className="chip-x" onClick={() => setFilterType('all')}>✕</span></span>}
            {dateFrom && <span className="chip">Dari {dateFrom}<span className="chip-x" onClick={() => setDateFrom('')}>✕</span></span>}
            {dateTo && <span className="chip">Sampai {dateTo}<span className="chip-x" onClick={() => setDateTo('')}>✕</span></span>}
          </div>
        )}
      </div>

      <div className="card">
        <h3>Laporan Arus Kas ({filteredLedger.length} transaksi)</h3>

        <div className="bulk-bar" style={{ marginBottom: 14 }}>
          <span className="bulk-count">Kas Masuk: {rupiah(periodMasuk)} &nbsp;|&nbsp; Kas Keluar: {rupiah(periodKeluar)}</span>
          <div className="bulk-actions">
            <button
              className="btn btn-sm"
              style={{ background: '#0f6e6e', color: '#fff' }}
              disabled={exportingExcel || filteredLedger.length === 0}
              onClick={handleExportExcel}
            >
              {exportingExcel ? <><span className="spinner" />Menyiapkan...</> : '📊 Export Excel'}
            </button>
            <button
              className="btn btn-sm"
              style={{ background: '#14213d', color: '#fff' }}
              disabled={exportingPdf || filteredLedger.length === 0}
              onClick={handleExportPdf}
            >
              {exportingPdf ? <><span className="spinner" />Menyiapkan...</> : '🖨 Export PDF'}
            </button>
          </div>
        </div>

        {loadError && <div className="empty-state" style={{ color: 'var(--danger)' }}>Gagal memuat data: {loadError}</div>}
        {filteredLedger.length === 0 && !loadError ? (
          <div className="empty-state">Tidak ada transaksi yang cocok dengan filter.</div>
        ) : (
          <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Tanggal</th><th>Keterangan</th><th>No. Ref</th><th>Terkait</th><th>Kas Masuk</th><th>Kas Keluar</th><th>Saldo</th></tr>
            </thead>
            <tbody>
              {pageLedger.map((e) => (
                <tr key={e.id}>
                  <td>{e.date}</td>
                  <td>{e.description}</td>
                  <td>{e.ref}</td>
                  <td>{e.person}</td>
                  <td style={{ color: '#1f8a4c', textAlign: 'right' }}>{e.type === 'in' ? rupiah(e.amount) : ''}</td>
                  <td style={{ color: '#b3261e', textAlign: 'right' }}>{e.type === 'out' ? rupiah(e.amount) : ''}</td>
                  <td style={{ fontWeight: 700, textAlign: 'right' }}>{rupiah(e.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}

        {filteredLedger.length > 0 && (
          <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={filteredLedger.length} />
        )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- TANDA TANGAN SAYA ----
function MyProfile({ profile, onUpdated }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const hasStroke = useRef(false)
  const fileInputRef = useRef(null)

  const [signatureUrl, setSignatureUrl] = useState(profile.signature_url || null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState({ text: '', type: '' })

  useEffect(() => { setSignatureUrl(profile.signature_url || null) }, [profile.signature_url])

  function setupCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    // Resolusi internal lebih tinggi dari ukuran tampilan supaya garis tidak buram
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * ratio
    canvas.height = rect.height * ratio
    const ctx = canvas.getContext('2d')
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#14213d'
  }

  useEffect(() => { setupCanvas() }, [])

  function pointFromEvent(e) {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const src = e.touches ? e.touches[0] : e
    return { x: src.clientX - rect.left, y: src.clientY - rect.top }
  }

  function startDraw(e) {
    e.preventDefault()
    drawing.current = true
    hasStroke.current = true
    const { x, y } = pointFromEvent(e)
    const ctx = canvasRef.current.getContext('2d')
    ctx.beginPath()
    ctx.moveTo(x, y)
  }
  function moveDraw(e) {
    if (!drawing.current) return
    e.preventDefault()
    const { x, y } = pointFromEvent(e)
    const ctx = canvasRef.current.getContext('2d')
    ctx.lineTo(x, y)
    ctx.stroke()
  }
  function endDraw() { drawing.current = false }

  function clearCanvas() {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    hasStroke.current = false
    setMsg({ text: '', type: '' })
  }

  async function uploadBlob(blob) {
    setSaving(true)
    setMsg({ text: '', type: '' })
    try {
      const path = `${profile.id}/signature.png`
      const { error: upErr } = await supabase.storage
        .from('signatures')
        .upload(path, blob, { upsert: true, contentType: 'image/png' })
      if (upErr) throw upErr

      // Tambah versi di query string supaya browser tidak memakai cache gambar lama
      const { data: pub } = supabase.storage.from('signatures').getPublicUrl(path)
      const versionedUrl = `${pub.publicUrl}?v=${Date.now()}`

      const { error: dbErr } = await supabase.from('profiles')
        .update({ signature_url: versionedUrl }).eq('id', profile.id)
      if (dbErr) throw dbErr

      setSignatureUrl(versionedUrl)
      setMsg({ text: 'Tanda tangan tersimpan. Akan otomatis muncul di slip yang dicetak.', type: 'success' })
      onUpdated && onUpdated()
    } catch (err) {
      setMsg({ text: 'Gagal menyimpan: ' + err.message, type: 'error' })
    }
    setSaving(false)
  }

  function saveDrawing() {
    if (!hasStroke.current) {
      setMsg({ text: 'Gambar tanda tangan dulu di area kanvas.', type: 'error' })
      return
    }
    canvasRef.current.toBlob((blob) => { if (blob) uploadBlob(blob) }, 'image/png')
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    uploadBlob(file)
    e.target.value = ''
  }

  async function removeSignature() {
    setSaving(true)
    setMsg({ text: '', type: '' })
    const path = `${profile.id}/signature.png`
    await supabase.storage.from('signatures').remove([path])
    const { error } = await supabase.from('profiles').update({ signature_url: null }).eq('id', profile.id)
    if (error) setMsg({ text: 'Gagal menghapus: ' + error.message, type: 'error' })
    else {
      setSignatureUrl(null)
      clearCanvas()
      setMsg({ text: 'Tanda tangan dihapus.', type: 'success' })
      onUpdated && onUpdated()
    }
    setSaving(false)
  }

  return (
    <div>
      <div className="card" style={{ maxWidth: 640 }}>
        <h3>Tanda Tangan Digital</h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: -6, marginBottom: 14 }}>
          Gambar atau unggah tanda tangan Anda sekali di sini. Setiap kali slip reimbursement dicetak
          (baik sebagai pemohon maupun approver), tanda tangan ini akan otomatis muncul di kolom tanda tangan Anda.
        </p>

        {signatureUrl && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>Tanda tangan saat ini</div>
            <div style={{ border: '1px solid #e3e6ea', borderRadius: 8, padding: 10, display: 'inline-block', background: '#fff' }}>
              <img src={signatureUrl} alt="Tanda tangan" style={{ height: 60, display: 'block' }} />
            </div>
          </div>
        )}

        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>
          {signatureUrl ? 'Gambar ulang tanda tangan baru' : 'Gambar tanda tangan di sini'}
        </div>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: 160, border: '1.5px dashed #c9ced6', borderRadius: 8, background: '#fbfbfc', touchAction: 'none', cursor: 'crosshair' }}
          onMouseDown={startDraw}
          onMouseMove={moveDraw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={moveDraw}
          onTouchEnd={endDraw}
        />

        {msg.text && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: msg.type === 'error' ? 'var(--danger)' : 'var(--success)' }}>
            {msg.text}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          <button className="btn btn-primary" disabled={saving} onClick={saveDrawing}>
            {saving ? 'Menyimpan...' : '✓ Simpan Tanda Tangan'}
          </button>
          <button className="btn btn-sm" style={{ background: '#eee', color: '#555' }} disabled={saving} onClick={clearCanvas}>
            Bersihkan Kanvas
          </button>
          <button className="btn btn-sm" style={{ background: '#eee', color: '#555' }} disabled={saving} onClick={() => fileInputRef.current?.click()}>
            📁 Unggah Gambar
          </button>
          {signatureUrl && (
            <button className="btn btn-sm btn-danger" disabled={saving} onClick={removeSignature}>
              Hapus Tanda Tangan
            </button>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
        </div>
      </div>
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
  const [search, setSearch] = useState('')
  const [selectedPrintIds, setSelectedPrintIds] = useState([])
  const [bulkPrinting, setBulkPrinting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const isFinanceOrAdmin = isFinanceUser(profile)

  useEffect(() => {
    async function load() {
      setLoadingData(true)
      let query = supabase
        .from('reimbursements')
        .select('*, profiles(full_name, department, signature_url), reimbursement_items(category, amount)')
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
    if (search.trim()) {
      const q = search.toLowerCase()
      const matchNo   = r.request_no?.toLowerCase().includes(q)
      const matchName = r.profiles?.full_name?.toLowerCase().includes(q)
      const matchDept = r.profiles?.department?.toLowerCase().includes(q)
      const matchAmt  = String(r.total_amount).includes(q)
      if (!matchNo && !matchName && !matchDept && !matchAmt) return false
    }
    return true
  })

  const resetFilters = () => {
    setFilterStatus('all'); setFilterDept('all'); setFilterCategory('all')
    setDateFrom(''); setDateTo(''); setSearch('')
  }

  // Reset ke halaman 1 setiap kali filter berubah, supaya tidak "nyangkut"
  // di halaman kosong ketika hasil filter berkurang.
  useEffect(() => { setPage(1) }, [filterStatus, filterDept, filterCategory, dateFrom, dateTo, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [totalPages, page])

  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize])

  const activeChips = []
  if (search.trim()) activeChips.push({ key: 'search', label: `"${search}"`, clear: () => setSearch('') })
  if (filterStatus !== 'all') activeChips.push({ key: 'status', label: STATUS_LABEL[filterStatus], clear: () => setFilterStatus('all') })
  if (filterDept !== 'all') activeChips.push({ key: 'dept', label: filterDept, clear: () => setFilterDept('all') })
  if (filterCategory !== 'all') activeChips.push({ key: 'cat', label: filterCategory, clear: () => setFilterCategory('all') })
  if (dateFrom) activeChips.push({ key: 'from', label: `Dari ${dateFrom}`, clear: () => setDateFrom('') })
  if (dateTo) activeChips.push({ key: 'to', label: `Sampai ${dateTo}`, clear: () => setDateTo('') })

  const totalApproved = filtered.filter((r) => r.status === 'verified').reduce((s, r) => s + Number(r.total_amount), 0)
  const outstanding = filtered.filter((r) => r.status === 'submitted').length
  const pendingFinanceManager = filtered.filter((r) => r.status === 'approved').length
  const pendingDisbursement = filtered.filter((r) => r.status === 'finance_approved').length
  const verifiedCount = filtered.filter((r) => r.status === 'verified').length
  const rejectedCount = filtered.filter((r) => r.status === 'rejected').length

  // ---- Data untuk grafik: dihitung dari `filtered` (ikut menghormati filter
  // status/department/kategori/periode/pencarian yang sedang aktif di atas),
  // hanya dari pengajuan yang SUDAH terverifikasi (dana benar-benar sudah
  // cair) — supaya grafik mencerminkan pengeluaran aktual, bukan estimasi.
  const verifiedFiltered = useMemo(() => filtered.filter((r) => r.status === 'verified'), [filtered])

  // Tren 6 bulan terakhir (termasuk bulan tanpa transaksi, ditampilkan 0)
  const monthlyData = useMemo(() => {
    const months = []
    const now = new Date()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' }),
        value: 0,
      })
    }
    const map = {}
    months.forEach((m) => { map[m.key] = m })
    verifiedFiltered.forEach((r) => {
      if (!r.request_date) return
      const key = r.request_date.slice(0, 7)
      if (map[key]) map[key].value += Number(r.total_amount) || 0
    })
    return months.map((m) => ({ label: m.label, value: m.value }))
  }, [verifiedFiltered])

  // Distribusi total pengeluaran per kategori item (diurutkan dari terbesar)
  const categoryData = useMemo(() => {
    const map = {}
    verifiedFiltered.forEach((r) => {
      ;(r.reimbursement_items || []).forEach((it) => {
        const cat = it.category || 'Lainnya'
        map[cat] = (map[cat] || 0) + (Number(it.amount) || 0)
      })
    })
    return Object.entries(map)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
  }, [verifiedFiltered])

  // Print Slip HANYA boleh untuk pengajuan yang sudah verified, dan user satu
  // departemen dengan pengaju (atau finance/admin yang bisa lintas departemen).
  // Checkbox seleksi sendiri sekarang tersedia untuk SEMUA baris apapun
  // statusnya (dipakai untuk Export Excel) — canPrintRow hanya menyaring baris
  // mana yang benar-benar akan dicetak saat tombol "Print Slip" bulk ditekan.
  function canPrintRow(r) {
    return r.status === 'verified' && (isFinanceOrAdmin || r.profiles?.department === profile.department)
  }
  // Checkbox "select all" di header hanya berlaku untuk baris yang tampil di
  // halaman aktif (pageRows), bukan seluruh data hasil filter — supaya tidak
  // ikut mencentang baris di halaman lain yang belum pernah dilihat/dicek user.
  // Seleksi tetap "diingat" lintas halaman lewat selectedPrintIds, jadi user
  // masih bisa pindah halaman dan menambah pilihan sebelum export/print.
  const allPrintSelected = pageRows.length > 0 && pageRows.every((r) => selectedPrintIds.includes(r.id))
  const somePrintSelected = pageRows.some((r) => selectedPrintIds.includes(r.id)) && !allPrintSelected

  function togglePrintOne(id) {
    setSelectedPrintIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }
  function togglePrintAll() {
    const pageIds = pageRows.map((r) => r.id)
    setSelectedPrintIds((prev) => {
      if (allPrintSelected) {
        // Hapus hanya id yang ada di halaman ini, sisakan seleksi di halaman lain
        return prev.filter((id) => !pageIds.includes(id))
      }
      // Tambahkan id halaman ini ke seleksi yang sudah ada (tanpa duplikat)
      const merged = new Set([...prev, ...pageIds])
      return Array.from(merged)
    })
  }

  // Semua baris yang tercentang (berapa pun statusnya) — dasar untuk Export Excel.
  const selectedRows = filtered.filter((r) => selectedPrintIds.includes(r.id))
  // Dari yang tercentang, hanya yang berstatus verified yang boleh di-print.
  const selectedPrintableRows = selectedRows.filter(canPrintRow)
  const selectedIgnoredCount = selectedRows.length - selectedPrintableRows.length

  // Print Slip (bulk): baris tercentang yang BUKAN verified otomatis diabaikan,
  // tidak akan ikut ke-print sama sekali.
  async function handleBulkPrint(savePdf) {
    const rows = selectedPrintableRows
    if (rows.length === 0) return
    setBulkPrinting(true)
    await printBulkSlipsShared(supabase, rows, savePdf)
    setBulkPrinting(false)
  }

  // Export Excel: mengambil SEMUA baris tercentang apapun statusnya, dan
  // menyusunnya menjadi ringkasan .xlsx yang rapi (header berwarna, format
  // Rupiah, total, dan ringkasan per-status) lalu langsung mengunduhnya.
  async function handleExportExcel() {
    const rows = selectedRows
    if (rows.length === 0) return
    setExporting(true)
    try {
      const { default: ExcelJS } = await import('exceljs')
      const wb = new ExcelJS.Workbook()
      wb.creator = 'PCRS App'
      wb.created = new Date()

      const ws = wb.addWorksheet('Summary Reimbursement', {
        views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
      })

      ws.columns = [
        { width: 5 }, { width: 16 }, { width: 13 }, { width: 24 },
        { width: 16 }, { width: 24 }, { width: 18 }, { width: 30 },
      ]

      ws.mergeCells('A1:H1')
      const titleCell = ws.getCell('A1')
      titleCell.value = 'Summary Reimbursement'
      titleCell.font = { size: 16, bold: true, color: { argb: 'FF14213D' } }

      ws.mergeCells('A2:H2')
      const subCell = ws.getCell('A2')
      subCell.value = `Diekspor: ${new Date().toLocaleString('id-ID')}   |   Total data terpilih: ${rows.length}`
      subCell.font = { size: 10, italic: true, color: { argb: 'FF666666' } }

      const headers = ['No', 'No. Request', 'Tanggal', 'Employee', 'Department', 'Kategori', 'Total (Rp)', 'Status']
      const headerRow = ws.getRow(4)
      headers.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1)
        cell.value = h
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14213D' } }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFCCCCCC' } }, bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
          left: { style: 'thin', color: { argb: 'FFCCCCCC' } }, right: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        }
      })
      headerRow.height = 22

      rows.forEach((r, idx) => {
        const row = ws.getRow(5 + idx)
        const cats = [...new Set((r.reimbursement_items || []).map((it) => it.category))].join(', ') || '—'
        row.getCell(1).value = idx + 1
        row.getCell(2).value = r.request_no
        row.getCell(3).value = r.request_date
        row.getCell(4).value = r.profiles?.full_name || '—'
        row.getCell(5).value = r.profiles?.department || '—'
        row.getCell(6).value = cats
        row.getCell(7).value = Number(r.total_amount) || 0
        row.getCell(7).numFmt = '"Rp" #,##0'
        row.getCell(8).value = STATUS_LABEL[r.status] || r.status

        const isEven = idx % 2 === 0
        for (let c = 1; c <= 8; c++) {
          const cell = row.getCell(c)
          cell.alignment = { vertical: 'middle', horizontal: c === 1 ? 'center' : c === 7 ? 'right' : 'left' }
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE5E5E5' } }, bottom: { style: 'thin', color: { argb: 'FFE5E5E5' } },
            left: { style: 'thin', color: { argb: 'FFE5E5E5' } }, right: { style: 'thin', color: { argb: 'FFE5E5E5' } },
          }
          if (isEven) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F8FA' } }
        }
      })

      const totalRowIdx = 5 + rows.length
      const totalRow = ws.getRow(totalRowIdx)
      ws.mergeCells(`A${totalRowIdx}:F${totalRowIdx}`)
      totalRow.getCell(1).value = 'Total Nominal Terpilih'
      totalRow.getCell(1).font = { bold: true }
      totalRow.getCell(1).alignment = { horizontal: 'right' }
      const grandTotal = rows.reduce((s, r) => s + Number(r.total_amount || 0), 0)
      totalRow.getCell(7).value = grandTotal
      totalRow.getCell(7).numFmt = '"Rp" #,##0'
      totalRow.getCell(7).font = { bold: true }
      for (let c = 1; c <= 8; c++) {
        totalRow.getCell(c).border = { top: { style: 'double', color: { argb: 'FF14213D' } } }
      }

      const statusCounts = {}
      rows.forEach((r) => { statusCounts[r.status] = (statusCounts[r.status] || 0) + 1 })
      let sIdx = totalRowIdx + 2
      ws.getCell(`A${sIdx}`).value = 'Ringkasan per Status'
      ws.getCell(`A${sIdx}`).font = { bold: true, color: { argb: 'FF14213D' } }
      sIdx++
      Object.entries(statusCounts).forEach(([status, count]) => {
        ws.getCell(`A${sIdx}`).value = STATUS_LABEL[status] || status
        ws.getCell(`B${sIdx}`).value = count
        sIdx++
      })

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Summary_Reimbursement_${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
      alert('Gagal membuat file Excel. Silakan coba lagi.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <div className="filter-panel">
        <div className="filter-panel-head">
          <div className="filter-title"><span className="filter-icon">⚲</span> Filter Data</div>
          {activeChips.length > 0 && (
            <span className="filter-clear-all" onClick={resetFilters}>Hapus semua filter</span>
          )}
        </div>

        {/* Search bar */}
        <div className="search-bar-wrap">
          <span className="search-icon">🔍</span>
          <input
            className="search-bar-input"
            type="text"
            placeholder="Cari no. request, nama karyawan, departemen, atau nominal..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <span className="search-clear" onClick={() => setSearch('')}>✕</span>
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
          <div className="kpi-box"><div className="label">Menunggu Approval Finance Manager</div><div className="value">{pendingFinanceManager}</div></div>
          <div className="kpi-box"><div className="label">Menunggu Pencairan & Verifikasi</div><div className="value">{pendingDisbursement}</div></div>
          <div className="kpi-box"><div className="label">Terverifikasi</div><div className="value">{verifiedCount}</div></div>
          <div className="kpi-box"><div className="label">Rejected</div><div className="value">{rejectedCount}</div></div>
        </>}
      </div>

      {/* ---- GRAFIK: tren bulanan & distribusi kategori (hanya data terverifikasi, ikut filter aktif) ---- */}
      {!loadingData && (
        <div className="chart-grid">
          <div className="card chart-card">
            <h3>📈 Tren Pengeluaran Terverifikasi (6 Bulan Terakhir)</h3>
            <MonthlyBarChart data={monthlyData} />
          </div>
          <div className="card chart-card">
            <h3>◆ Distribusi per Kategori</h3>
            <CategoryDonutChart data={categoryData} />
          </div>
        </div>
      )}

      <div className="card">
        <h3>
          Pengajuan {isFinanceOrAdmin ? '' : `— Dept. ${profile.department} `}
          ({filtered.length} dari {all.length} total)
        </h3>

        {/* Bulk action bar — muncul saat ada baris (status apa pun) yang dicentang */}
        {selectedPrintIds.length > 0 && (
          <div className="bulk-bar">
            <span className="bulk-count">{selectedPrintIds.length} baris dipilih</span>
            <div className="bulk-actions">
              <button
                className="btn btn-sm"
                style={{ background: '#14213d', color: '#fff' }}
                disabled={bulkPrinting || selectedPrintableRows.length === 0}
                onClick={() => handleBulkPrint(false)}
                title={selectedPrintableRows.length === 0 ? 'Tidak ada dokumen berstatus Terverifikasi pada seleksi ini' : ''}
              >
                {bulkPrinting ? <><span className="spinner" />Menyiapkan...</> : `🖨 Print Slip (${selectedPrintableRows.length})`}
              </button>
              <button
                className="btn btn-sm"
                style={{ background: '#0f6e6e', color: '#fff' }}
                disabled={exporting}
                onClick={handleExportExcel}
              >
                {exporting ? <><span className="spinner" />Menyiapkan...</> : '📊 Export Excel'}
              </button>
              <button className="btn btn-sm" style={{ background: '#eee', color: '#555' }} onClick={() => setSelectedPrintIds([])}>Batal Pilih</button>
            </div>
            {selectedIgnoredCount > 0 && (
              <div style={{ flexBasis: '100%', fontSize: 12, color: '#ffe9b3' }}>
                ⚠ {selectedIgnoredCount} baris terpilih belum berstatus <strong>Terverifikasi</strong> — akan diabaikan saat Print Slip (tetap ikut di Export Excel).
              </div>
            )}
          </div>
        )}

        {loadingData ? <SkeletonTable cols={6} rows={5} /> : filtered.length === 0 ? (
          <div className="empty-state">Tidak ada data yang cocok dengan filter.</div>
        ) : (
          <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  {pageRows.length > 0 && (
                    <input
                      type="checkbox"
                      style={{ width: 15, height: 15, cursor: 'pointer' }}
                      checked={allPrintSelected}
                      ref={(el) => { if (el) el.indeterminate = somePrintSelected }}
                      onChange={togglePrintAll}
                      title="Pilih semua baris di halaman ini"
                    />
                  )}
                </th>
                <th>No. Request</th><th>Tanggal</th><th>Employee</th><th>Department</th><th>Total</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id} className={selectedPrintIds.includes(r.id) ? 'row-selected' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      style={{ width: 15, height: 15, cursor: 'pointer' }}
                      checked={selectedPrintIds.includes(r.id)}
                      onChange={() => togglePrintOne(r.id)}
                    />
                  </td>
                  <td>{r.request_no}</td>
                  <td>{r.request_date}</td>
                  <td>{r.profiles?.full_name || '—'}</td>
                  <td>{r.profiles?.department || '—'}</td>
                  <td>{rupiah(r.total_amount)}</td>
                  <td><span className={`badge badge-${r.status}`}>{statusLabelFor(r)}</span></td>
                  <td>
                    {r.status === 'verified' && (isFinanceOrAdmin || r.profiles?.department === profile.department) && (
                      <button
                        className="btn btn-sm"
                        style={{ background: '#14213d', color: '#fff', whiteSpace: 'nowrap' }}
                        onClick={() => printSlipShared(supabase, r, false)}
                      >
                        🖨 Print Slip
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}

        {!loadingData && filtered.length > 0 && (
          <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={filtered.length} />
        )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- MAIN APP ----
// ---- SVG Icons ----
const Ico = {
  dashboard:  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  submit:     <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>,
  mine:       <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
  approval:   <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
  finance:    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>,
  cash:       <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 6v12M18 6v12"/></svg>,
  admin:      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/></svg>,
  signature:  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17c2-1 3-3 4-5 1.5-3 2-6 3.5-6S12 9 13 12c1 3 2 5 4 5 1.3 0 2-1 3-2"/><path d="M3 21h18"/></svg>,
  logout:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  menu:       <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>,
  close:      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  sun:        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>,
  moon:       <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
}

const PAGE_TITLE = {
  dashboard:              'Dashboard',
  'submit-reimbursement': 'Submit Reimbursement',
  'submit-kas':           'Saldo Kas',
  mine:                   'Pengajuan Saya',
  approval:               'Approval',
  finance:                'Finance Verification',
  'cash-flow-report':     'Laporan Arus Kas',
  admin:                  'Admin Panel',
  signature:              'Tanda Tangan Saya',
}

export default function App() {
  const [session, setSession]       = useState(null)
  const [profile, setProfile]       = useState(null)
  const [tab, setTab]               = useState('dashboard')
  const [refreshKey, setRefreshKey] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [submitMenuOpen, setSubmitMenuOpen] = useState(true)
  const [mobileSubmitOpen, setMobileSubmitOpen] = useState(false)
  const bump = useCallback(() => setRefreshKey((k) => k + 1), [])

  // ---- DARK MODE ----
  // Preferensi disimpan di localStorage; kalau belum pernah diset, ikuti
  // preferensi sistem (prefers-color-scheme). Class "dark" ditaruh di
  // <html> (bukan hanya .app-shell) supaya layar login yang tampil
  // sebelum ada session pun ikut menyesuaikan.
  const [darkMode, setDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('pcrs-theme')
      if (saved) return saved === 'dark'
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    } catch {
      return false
    }
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    try { localStorage.setItem('pcrs-theme', darkMode ? 'dark' : 'light') } catch {}
  }, [darkMode])

  const toggleDarkMode = useCallback(() => setDarkMode((d) => !d), [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const loadProfile = useCallback(async () => {
    if (!session) { setProfile(null); return }
    const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
    setProfile(data)
  }, [session])

  useEffect(() => { loadProfile() }, [loadProfile])

  // ---- REALTIME: auto-refresh saat ada perubahan data dari user lain ----
  // Tanpa ini, approver B baru approve pengajuan tidak akan otomatis
  // terlihat oleh approver C yang sedang membuka halaman Approval/Dashboard
  // yang sama — mereka harus refresh manual. Dengan subscribe ke perubahan
  // tabel-tabel inti (reimbursements, approval_history, cash_topups), setiap
  // INSERT/UPDATE/DELETE dari siapa pun akan memicu `bump()`, yang otomatis
  // mem-refresh semua komponen yang bergantung pada `refreshKey` (Dashboard,
  // ApprovalQueue, FinanceVerification, CashBalance, CashFlowReport, dst).
  //
  // CATATAN: fitur Realtime harus AKTIF di Supabase untuk tabel-tabel ini
  // (Dashboard Supabase -> Database -> Replication). Kalau belum aktif,
  // subscribe ini tidak error, hanya tidak menerima event apa pun (fallback-
  // nya tetap load manual seperti biasa saat pindah tab/refresh halaman).
  useEffect(() => {
    if (!session) return
    const channel = supabase
      .channel('pcrs-realtime-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reimbursements' }, () => bump())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'approval_history' }, () => bump())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_topups' }, () => bump())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [session, bump])

  if (!session) return <AuthScreen />
  if (!profile) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
        <div style={{ width: 36, height: 36, border: '3px solid #e3e6ea', borderTopColor: 'var(--teal)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 12px' }} />
        Memuat profil...
      </div>
    </div>
  )

  // Approval Finance Manager (tahap sebelum pencairan) sudah digabung ke dalam
  // menu "Approval" biasa — Manager Departemen Finance / Admin otomatis melihat
  // pengajuan lintas departemen di tahap itu juga saat membuka menu Approval.
  const isApprover = ['supervisor', 'manager', 'admin'].includes(profile.role)
  const isFinance  = isFinanceUser(profile)

  function navigate(key) {
    setTab(key)
    setSidebarOpen(false)
    setMobileSubmitOpen(false)
  }

  const navItems = [
    { key: 'dashboard', label: 'Dashboard',             icon: Ico.dashboard, show: true },
    {
      key: 'submit', label: 'Submit', icon: Ico.submit, show: true,
      children: [
        { key: 'submit-reimbursement', label: 'Submit Reimbursement', show: true },
        { key: 'submit-kas',           label: 'Submit Kas',           show: isFinance },
      ].filter((c) => c.show),
    },
    { key: 'mine',      label: 'Pengajuan Saya',        icon: Ico.mine,      show: true },
    { key: 'approval',  label: 'Approval',              icon: Ico.approval,  show: isApprover },
    { key: 'finance',   label: 'Finance Verification',  icon: Ico.finance,   show: isFinance },
    // Menu terpisah, khusus department Finance — bukan bagian dari submenu
    // "Submit" karena ini murni laporan (bukan aksi submit/isi ulang).
    { key: 'cash-flow-report', label: 'Laporan Arus Kas', icon: Ico.cash,    show: isFinance },
    { key: 'signature', label: 'Tanda Tangan Saya',      icon: Ico.signature, show: true },
    { key: 'admin',     label: 'Admin Panel',           icon: Ico.admin,     show: profile.role === 'admin', accent: true },
  ].filter((n) => n.show)

  const roleColors = {
    employee: '#6fd6c8', supervisor: '#f6c90e', manager: '#f6a40e', admin: '#fd79a8',
  }
  const roleColor = roleColors[profile.role] || '#ccc'

  return (
    <div className={`app-shell ${sidebarOpen ? 'sidebar-open' : ''}`}>

      {/* ---- SIDEBAR ---- */}
      <aside className="sidebar">
        {/* Brand */}
        <div className="sidebar-brand">
          <div className="sidebar-logo">PCRS</div>
          <div className="sidebar-brand-sub">Petty Cash System</div>
        </div>

        {/* Nav */}
        <nav className="sidebar-nav">
          {navItems.map((n) => {
            if (n.children) {
              const groupActive = n.children.some((c) => c.key === tab)
              return (
                <div key={n.key} className="nav-group">
                  <button
                    className={`nav-item nav-item-parent ${groupActive ? 'active' : ''}`}
                    onClick={() => setSubmitMenuOpen((o) => !o)}
                  >
                    <span className="nav-icon">{n.icon}</span>
                    <span className="nav-label">{n.label}</span>
                    <span className={`nav-chevron ${submitMenuOpen ? 'open' : ''}`}>&#9662;</span>
                  </button>
                  {submitMenuOpen && (
                    <div className="nav-submenu">
                      {n.children.map((c) => (
                        <button
                          key={c.key}
                          className={`nav-subitem ${tab === c.key ? 'active' : ''}`}
                          onClick={() => navigate(c.key)}
                        >
                          <span className="nav-label">{c.label}</span>
                          {tab === c.key && <span className="nav-active-bar" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            }
            return (
              <button
                key={n.key}
                className={`nav-item ${tab === n.key ? 'active' : ''} ${n.accent ? 'accent' : ''}`}
                onClick={() => navigate(n.key)}
              >
                <span className="nav-icon">{n.icon}</span>
                <span className="nav-label">{n.label}</span>
                {tab === n.key && <span className="nav-active-bar" />}
              </button>
            )
          })}
        </nav>

        {/* User info + logout */}
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-avatar" style={{ background: roleColor }}>
              {profile.full_name.charAt(0).toUpperCase()}
            </div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{profile.full_name}</div>
              <div className="sidebar-user-role">{profile.role} · {profile.department}</div>
            </div>
          </div>
          <button className="sidebar-logout" onClick={() => supabase.auth.signOut()} title="Logout">
            {Ico.logout}
          </button>
        </div>
      </aside>

      {/* Overlay (mobile only) */}
      <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />

      {/* ---- MOBILE BOTTOM NAV (freeze/fixed di bawah, horizontal) ---- */}
      <nav className="bottom-nav">
        {navItems.map((n) => {
          if (n.children) {
            const groupActive = n.children.some((c) => c.key === tab)
            return (
              <button
                key={n.key}
                className={`bottom-nav-item ${groupActive ? 'active' : ''}`}
                onClick={() => setMobileSubmitOpen((o) => !o)}
              >
                <span className="bottom-nav-icon">{n.icon}</span>
                <span className="bottom-nav-label">{n.label}</span>
              </button>
            )
          }
          return (
            <button
              key={n.key}
              className={`bottom-nav-item ${tab === n.key ? 'active' : ''} ${n.accent ? 'accent' : ''}`}
              onClick={() => navigate(n.key)}
            >
              <span className="bottom-nav-icon">{n.icon}</span>
              <span className="bottom-nav-label">{n.label}</span>
            </button>
          )
        })}
      </nav>

      {/* Sheet submenu mobile untuk grup "Submit" (dipicu dari bottom nav) */}
      {mobileSubmitOpen && (
        <>
          <div className="bottom-sheet-overlay" onClick={() => setMobileSubmitOpen(false)} />
          <div className="bottom-sheet">
            {navItems.find((n) => n.children)?.children.map((c) => (
              <button
                key={c.key}
                className={`bottom-sheet-item ${tab === c.key ? 'active' : ''}`}
                onClick={() => navigate(c.key)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* ---- MAIN CONTENT ---- */}
      <div className="main-content">
        {/* Mobile topbar */}
        <div className="mobile-header">
          <button className="hamburger" onClick={() => setSidebarOpen(true)}>{Ico.menu}</button>
          <div className="mobile-title">{PAGE_TITLE[tab]}</div>
          <div className="mobile-header-actions">
            <button className="theme-toggle theme-toggle-mobile" onClick={toggleDarkMode} title={darkMode ? 'Ganti ke Mode Terang' : 'Ganti ke Mode Gelap'}>
              {darkMode ? Ico.sun : Ico.moon}
            </button>
            <NotificationBell profile={profile} refreshKey={refreshKey} onNavigate={navigate} />
            <button className="mobile-logout" onClick={() => supabase.auth.signOut()} title="Logout">
              {Ico.logout}
            </button>
          </div>
        </div>

        {/* Page header (desktop) */}
        <div className="page-header">
          <div>
            <h1 className="page-title">{PAGE_TITLE[tab]}</h1>
            <div className="page-breadcrumb">PCRS / {PAGE_TITLE[tab]}</div>
          </div>
          <div className="page-header-actions">
            <button className="theme-toggle" onClick={toggleDarkMode} title={darkMode ? 'Ganti ke Mode Terang' : 'Ganti ke Mode Gelap'}>
              {darkMode ? Ico.sun : Ico.moon}
            </button>
            <NotificationBell profile={profile} refreshKey={refreshKey} onNavigate={navigate} />
          </div>
        </div>

        <div className="content-area">
          <div className="tab-content" key={tab}>
            {tab === 'dashboard'              && <Dashboard refreshKey={refreshKey} profile={profile} />}
            {tab === 'submit-reimbursement'   && <SubmitForm profile={profile} onSubmitted={bump} />}
            {tab === 'submit-kas'             && isFinance  && <CashBalance profile={profile} refreshKey={refreshKey} onActed={bump} />}
            {tab === 'mine'                   && <MyRequests profile={profile} refreshKey={refreshKey} onRefresh={bump} />}
            {tab === 'approval'               && isApprover && <ApprovalQueue profile={profile} refreshKey={refreshKey} onActed={bump} />}
            {tab === 'finance'                && isFinance  && <FinanceVerification profile={profile} refreshKey={refreshKey} onActed={bump} />}
            {tab === 'cash-flow-report'       && isFinance  && <CashFlowReport profile={profile} refreshKey={refreshKey} />}
            {tab === 'admin'                  && profile.role === 'admin' && <AdminPanel />}
            {tab === 'signature' && <MyProfile profile={profile} onUpdated={loadProfile} />}
          </div>
        </div>
      </div>
    </div>
  )
}
