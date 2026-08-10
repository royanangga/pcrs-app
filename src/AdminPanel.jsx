import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from './supabaseClient'
import Pagination from './Pagination'
import Icon from './icons.jsx'
import Portal from './Portal.jsx'

const ROLES = ['employee', 'supervisor', 'manager', 'admin']

// Format angka mentah jadi berpemisah ribuan saat diketik (lihat App.jsx untuk
// versi yang sama -- didup di sini karena tiap file punya helper lokal sendiri,
// konsisten dengan pola rupiah() yang juga didup).
function formatThousands(value) {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (!digits) return ''
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}
function stripThousands(value) {
  return String(value ?? '').replace(/\D/g, '')
}

const STATUS_OPTIONS = ['draft', 'submitted', 'approved', 'finance_approved', 'verified', 'rejected', 'revision']

const STATUS_LABEL = {
  draft: 'Draft',
  submitted: 'Menunggu Approval',
  approved: 'Menunggu Approval Finance Manager',
  finance_approved: 'Disetujui Finance Manager — Menunggu Pencairan',
  verified: 'Terverifikasi (Sudah Dicairkan)',
  rejected: 'Ditolak',
  revision: 'Perlu Revisi',
}

function rupiah(n) {
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID')
}

// Panggil Edge Function admin-user-ops
async function callAdminOps(session, payload) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const res = await fetch(`${supabaseUrl}/functions/v1/admin-user-ops`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  })
  return res.json()
}

// ---- REUSABLE: confirm modal (pengganti window.confirm bawaan browser) ----
// Dipakai lewat: const [askConfirm, confirmModal] = useConfirm()
// Lalu: const ok = await askConfirm('Pesan konfirmasi...'); if (!ok) return
// Render {confirmModal} di mana saja dalam JSX komponen yang memakainya.
// Tutup modal manapun dengan tombol Escape (lihat App.jsx untuk versi yang sama).
function useEscapeToClose(onClose, active) {
  useEffect(() => {
    if (!active) return
    function handler(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active, onClose])
}

function useConfirm() {
  const [state, setState] = useState(null) // { message, title, danger, resolveFn }
  const settle = (result) => {
    if (state) state.resolveFn(result)
    setState(null)
  }
  useEscapeToClose(() => settle(false), !!state)

  const askConfirm = useCallback((message, opts = {}) => {
    return new Promise((resolve) => {
      setState({
        message,
        title: opts.title || 'Konfirmasi',
        danger: opts.danger !== false,
        confirmLabel: opts.confirmLabel || 'Ya, Lanjutkan',
        resolveFn: resolve,
      })
    })
  }, [])

  const confirmModal = state && (
    <Portal>
    <div className="modal-overlay" onClick={() => settle(false)}>
      <div className="modal-box confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-icon" style={{ color: state.danger ? 'var(--danger)' : 'var(--teal)' }}>
          {state.danger ? <Icon name="alertTriangle" size={30} /> : '?'}
        </div>
        <h3 className="confirm-title">{state.title}</h3>
        <p className="confirm-desc" style={{ whiteSpace: 'pre-line' }}>{state.message}</p>
        <div className="confirm-actions">
          <button className="btn btn-neutral" style={{ flex: 1 }} onClick={() => settle(false)}>
            Batal
          </button>
          <button
            className="btn"
            style={{ background: state.danger ? 'var(--danger)' : 'var(--teal)', color: '#fff', flex: 1 }}
            onClick={() => settle(true)}
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  )

  return [askConfirm, confirmModal]
}

// ---- REUSABLE: bulk action toolbar ----
function BulkBar({ count, onClear, children }) {
  if (count === 0) return null
  return (
    <div className="bulk-bar">
      <div className="bulk-bar-count" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="check" size={13} /> {count} data terpilih</div>
      <div className="bulk-bar-actions">{children}</div>
      <button className="btn btn-sm bulk-bar-clear" onClick={onClear}>Batal Pilih</button>
    </div>
  )
}

// ---- sub-tab: USER MANAGEMENT ----
function AdminUsers() {
  const [askConfirm, confirmModal] = useConfirm()
  const [users, setUsers] = useState([])
  const [session, setSession] = useState(null)
  const [editing, setEditing] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ full_name: '', email: '', password: '', department: '', role: 'employee' })
  const [pwModal, setPwModal] = useState(null)  // { id, email }
  useEscapeToClose(() => setPwModal(null), !!pwModal)
  const [newPw, setNewPw] = useState('')
  const [msg, setMsg] = useState({ text: '', type: '' })
  const [loading, setLoading] = useState(false)

  // bulk action state
  const [selected, setSelected] = useState(new Set())
  const [bulkRole, setBulkRole] = useState(ROLES[0])

  // filter status aktif/resign
  const [filterStatus, setFilterStatus] = useState('all')

  // pagination state
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
  }, [])

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_get_users')
    if (error) setMsg({ text: 'Gagal memuat: ' + error.message, type: 'error' })
    else setUsers(data || [])
  }, [])

  useEffect(() => { load() }, [load])

  const visibleUsers = useMemo(() => {
    if (filterStatus === 'all') return users
    return users.filter((u) => (u.status || 'active') === filterStatus)
  }, [users, filterStatus])

  const totalPages = Math.max(1, Math.ceil(visibleUsers.length / pageSize))
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [totalPages, page])

  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize
    return visibleUsers.slice(start, start + pageSize)
  }, [visibleUsers, page, pageSize])

  const allOnPageSelected = pageRows.length > 0 && pageRows.every((u) => selected.has(u.id))

  function toggleOne(id) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleAllOnPage() {
    setSelected((s) => {
      const next = new Set(s)
      if (allOnPageSelected) pageRows.forEach((u) => next.delete(u.id))
      else pageRows.forEach((u) => next.add(u.id))
      return next
    })
  }

  function clearSelection() { setSelected(new Set()) }

  function startEdit(u) {
    setEditing(u.id)
    setEditForm({ full_name: u.full_name, department: u.department, role: u.role, email: u.email })
    setMsg({ text: '', type: '' })
  }

  // Cegah admin aktif terakhir kehilangan status admin-nya (ganti role/nonaktifkan)
  // -- pengecekan cepat di UI; jaring pengaman sebenarnya ada di trigger DB.
  function isLastActiveAdmin(u) {
    if (u.role !== 'admin' || (u.status || 'active') !== 'active') return false
    const otherActiveAdmins = users.filter(
      (x) => x.id !== u.id && x.role === 'admin' && (x.status || 'active') === 'active'
    ).length
    return otherActiveAdmins === 0
  }

  async function saveEdit(u) {
    if (u.role === 'admin' && editForm.role !== 'admin' && isLastActiveAdmin(u)) {
      setMsg({ text: `"${u.full_name}" adalah admin aktif terakhir -- tidak bisa mengubah role-nya. Aktifkan/buat admin lain dulu.`, type: 'error' })
      return
    }
    setLoading(true)
    // Update profil
    const { error: pErr } = await supabase.from('profiles').update({
      full_name: editForm.full_name,
      department: editForm.department,
      role: editForm.role,
    }).eq('id', u.id)

    // Update email kalau berubah
    if (!pErr && editForm.email !== u.email) {
      const result = await callAdminOps(session, { action: 'update_email', user_id: u.id, new_email: editForm.email })
      if (result.error) { setMsg({ text: 'Error update email: ' + result.error, type: 'error' }); setLoading(false); return }
    }

    if (pErr) { setMsg({ text: 'Error: ' + pErr.message, type: 'error' }); setLoading(false); return }
    setEditing(null)
    setMsg({ text: `User "${editForm.full_name}" berhasil diupdate.`, type: 'ok' })
    setLoading(false)
    load()
  }

  async function handleCreateUser(e) {
    e.preventDefault()
    if (!session) return
    setLoading(true)
    setMsg({ text: '', type: '' })
    const result = await callAdminOps(session, { action: 'create_user', ...createForm })
    if (result.error) {
      setMsg({ text: 'Gagal buat akun: ' + result.error, type: 'error' })
    } else {
      setMsg({ text: `Akun "${createForm.full_name}" berhasil dibuat.`, type: 'ok' })
      setShowCreate(false)
      setCreateForm({ full_name: '', email: '', password: '', department: '', role: 'employee' })
      load()
    }
    setLoading(false)
  }

  async function handleResetPw(e) {
    e.preventDefault()
    if (!session || newPw.length < 6) return
    setLoading(true)
    const result = await callAdminOps(session, { action: 'update_password', user_id: pwModal.id, new_password: newPw })
    if (result.error) {
      setMsg({ text: 'Gagal reset password: ' + result.error, type: 'error' })
    } else {
      setMsg({ text: `Password "${pwModal.email}" berhasil direset.`, type: 'ok' })
      setPwModal(null)
      setNewPw('')
    }
    setLoading(false)
  }

  // pengajuan yang butuh reassign setelah nonaktifkan user
  const [reassignModal, setReassignModal] = useState(null) // { resignedUser, rows, picks }
  useEscapeToClose(() => setReassignModal(null), !!reassignModal)
  const [savingReassign, setSavingReassign] = useState(false)

  // Ambil daftar pengajuan yang sedang menunggu approval role & department user ini
  // -- dipakai sebagai peringatan sebelum menonaktifkan, dan sumber data untuk
  // modal reassign/delegasi kalau memang ada yang macet.
  async function getStuckApprovals(u) {
    if (!['supervisor', 'manager', 'finance_manager'].includes(u.role)) return []
    const { data } = await supabase
      .from('reimbursements')
      .select('id, request_no, status, required_role, total_amount, profiles!employee_id(department, full_name)')
      .eq('required_role', u.role)
      .in('status', ['submitted', 'approved'])
    return (data || []).filter((r) => r.profiles?.department === u.department)
  }

  async function deactivateUser(u) {
    if (isLastActiveAdmin(u)) {
      setMsg({ text: `"${u.full_name}" adalah admin aktif terakhir -- tidak bisa dinonaktifkan. Aktifkan/buat admin lain dulu.`, type: 'error' })
      return
    }
    setLoading(true)
    const stuck = await getStuckApprovals(u)
    setLoading(false)

    const warning = stuck.length > 0
      ? `\n\n⚠️ Ada ${stuck.length} pengajuan yang sedang menunggu approval role "${u.role}" di department "${u.department}". Kalau "${u.full_name}" satu-satunya pemegang role itu di department tsb, Anda akan diminta memilih pengganti (delegasi) setelah ini.`
      : ''

    const ok = await askConfirm(
      `Nonaktifkan user "${u.full_name}"?\nUser tidak akan bisa login lagi, tapi semua riwayat transaksinya tetap tersimpan (tidak dihapus).${warning}`,
      { title: 'Nonaktifkan User (Resign)' }
    )
    if (!ok) return
    setLoading(true)
    const result = await callAdminOps(session, { action: 'deactivate_user', user_id: u.id })
    if (result.error) {
      setMsg({ text: 'Gagal menonaktifkan: ' + result.error, type: 'error' })
    } else {
      setMsg({ text: `User "${u.full_name}" berhasil dinonaktifkan.`, type: 'ok' })
      load()
      if (stuck.length > 0) {
        setReassignModal({ resignedUser: u, rows: stuck, picks: {} })
      }
    }
    setLoading(false)
  }

  // Kandidat delegate: user aktif, bukan si resign, dan punya role yang relevan
  // (approver departemen atau siapa saja di department Finance).
  function delegateCandidates(resignedUser) {
    return users.filter((cand) =>
      (cand.status || 'active') === 'active' &&
      cand.id !== resignedUser.id &&
      (cand.role === 'supervisor' || cand.role === 'manager' || (cand.department || '').trim().toLowerCase() === 'finance')
    )
  }

  async function saveReassign() {
    if (!reassignModal) return
    setSavingReassign(true)
    const entries = Object.entries(reassignModal.picks).filter(([, v]) => v)
    let failCount = 0
    for (const [reimbId, delegateId] of entries) {
      const { error } = await supabase.from('reimbursements').update({ delegated_approver_id: delegateId }).eq('id', reimbId)
      if (error) failCount++
    }
    setSavingReassign(false)
    setMsg({
      text: failCount
        ? `${entries.length - failCount} pengajuan berhasil didelegasikan, ${failCount} gagal.`
        : `${entries.length} pengajuan berhasil didelegasikan ke approver baru.`,
      type: failCount ? 'error' : 'ok',
    })
    setReassignModal(null)
  }

  async function reactivateUser(u) {
    const ok = await askConfirm(`Aktifkan kembali user "${u.full_name}"?`, { title: 'Aktifkan User', danger: false, confirmLabel: 'Ya, Aktifkan' })
    if (!ok) return
    setLoading(true)
    const result = await callAdminOps(session, { action: 'reactivate_user', user_id: u.id })
    if (result.error) {
      setMsg({ text: 'Gagal mengaktifkan: ' + result.error, type: 'error' })
    } else {
      setMsg({ text: `User "${u.full_name}" berhasil diaktifkan kembali.`, type: 'ok' })
      load()
    }
    setLoading(false)
  }

  // ---- bulk actions ----
  async function bulkChangeRole() {
    if (!session || selected.size === 0) return
    const ok = await askConfirm(`Ubah role ${selected.size} user terpilih menjadi "${bulkRole}"?`, { title: 'Ubah Role Massal', danger: false, confirmLabel: 'Ya, Ubah Role' })
    if (!ok) return
    setLoading(true)
    const ids = Array.from(selected)
    const { error } = await supabase.from('profiles').update({ role: bulkRole }).in('id', ids)
    if (error) setMsg({ text: 'Gagal ubah role massal: ' + error.message, type: 'error' })
    else setMsg({ text: `Role ${ids.length} user berhasil diubah menjadi "${bulkRole}".`, type: 'ok' })
    clearSelection()
    setLoading(false)
    load()
  }

  async function bulkDeactivateUsers() {
    if (!session || selected.size === 0) return
    const ok = await askConfirm(`Nonaktifkan ${selected.size} user terpilih?\nUser tidak akan bisa login lagi, tapi riwayat transaksinya tetap tersimpan.`, { title: 'Nonaktifkan User Massal' })
    if (!ok) return
    setLoading(true)
    const ids = Array.from(selected)
    let failCount = 0
    for (const id of ids) {
      const result = await callAdminOps(session, { action: 'deactivate_user', user_id: id })
      if (result.error) failCount++
    }
    setMsg({
      text: failCount
        ? `${ids.length - failCount} user berhasil dinonaktifkan, ${failCount} gagal.`
        : `${ids.length} user berhasil dinonaktifkan.`,
      type: failCount ? 'error' : 'ok',
    })
    clearSelection()
    setLoading(false)
    load()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
        <h3 className="admin-section-title" style={{ margin: 0, border: 'none', padding: 0, display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="users" size={16} /> Manajemen User ({users.length})</h3>
        <button className="btn btn-primary btn-sm" onClick={() => { setShowCreate(!showCreate); setMsg({ text: '', type: '' }) }}>
          {showCreate ? 'Tutup' : '+ Buat Akun Baru'}
        </button>
      </div>

      {msg.text && (
        <div className="admin-msg" style={{ background: msg.type === 'error' ? '#fbe2df' : '#d9f4e3', borderColor: msg.type === 'error' ? '#c0392b' : '#1f8a4c', color: msg.type === 'error' ? '#c0392b' : '#1f8a4c' }}>
          {msg.text}
        </div>
      )}

      {showCreate && (
        <form className="admin-create-form" onSubmit={handleCreateUser}>
          <h4 style={{ margin: '0 0 12px', color: 'var(--navy)' }}>Buat Akun Baru</h4>
          <div className="admin-form-grid">
            <div>
              <label>Nama Lengkap</label>
              <input value={createForm.full_name} onChange={(e) => setCreateForm({ ...createForm, full_name: e.target.value })} required />
            </div>
            <div>
              <label>Email</label>
              <input type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} required />
            </div>
            <div>
              <label>Password (min. 6 karakter)</label>
              <input type="password" value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} required minLength={6} />
            </div>
            <div>
              <label>Department</label>
              <input value={createForm.department} onChange={(e) => setCreateForm({ ...createForm, department: e.target.value })} required />
            </div>
            <div>
              <label>Role</label>
              <select value={createForm.role} onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} disabled={loading}>
            {loading ? 'Memproses...' : 'Buat Akun'}
          </button>
        </form>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>Status:</label>
        <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1) }}>
          <option value="all">Semua</option>
          <option value="active">Aktif</option>
          <option value="resigned">Resign</option>
        </select>
      </div>

      <BulkBar count={selected.size} onClear={clearSelection}>
        <select value={bulkRole} onChange={(e) => setBulkRole(e.target.value)}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button className="btn btn-primary btn-sm" onClick={bulkChangeRole} disabled={loading}>Ubah Role</button>
        <button className="btn btn-danger btn-sm" onClick={bulkDeactivateUsers} disabled={loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="trash" size={12} /> Nonaktifkan Terpilih</button>
      </BulkBar>

      <div className="table-scroll">
      <table style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th style={{ width: 32 }}>
              <input type="checkbox" checked={allOnPageSelected} onChange={toggleAllOnPage} />
            </th>
            <th>Nama</th><th>Email</th><th>Department</th><th>Role</th><th>Status</th><th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((u) => (
            <tr key={u.id} className={selected.has(u.id) ? 'row-selected' : ''}>
              <td><input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleOne(u.id)} /></td>
              {editing === u.id ? (
                <>
                  <td><input value={editForm.full_name} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} /></td>
                  <td><input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} /></td>
                  <td><input value={editForm.department} onChange={(e) => setEditForm({ ...editForm, department: e.target.value })} /></td>
                  <td>
                    <select value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td>{(u.status || 'active') === 'resigned' ? 'Resign' : 'Aktif'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-success btn-sm" onClick={() => saveEdit(u)} disabled={loading}>Simpan</button>{' '}
                    <button className="btn btn-sm btn-neutral" onClick={() => setEditing(null)}>Batal</button>
                  </td>
                </>
              ) : (
                <>
                  <td>{u.full_name}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{u.email}</td>
                  <td>{u.department}</td>
                  <td><span className="admin-role-badge">{u.role}</span></td>
                  <td>
                    <span
                      className="admin-role-badge"
                      style={
                        (u.status || 'active') === 'resigned'
                          ? { background: '#fbe2df', color: '#c0392b' }
                          : { background: '#d9f4e3', color: '#1f8a4c' }
                      }
                    >
                      {(u.status || 'active') === 'resigned' ? 'Resign' : 'Aktif'}
                    </span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm" style={{ background: '#e8f0fe', color: '#1a56db' }} onClick={() => startEdit(u)}>Edit</button>{' '}
                    <button className="btn btn-sm" style={{ background: '#fff3cd', color: '#664d03' }} onClick={() => { setPwModal({ id: u.id, email: u.email }); setNewPw('') }}>Reset PW</button>{' '}
                    {(u.status || 'active') === 'resigned' ? (
                      <button className="btn btn-sm" style={{ background: '#d9f4e3', color: '#1f8a4c' }} onClick={() => reactivateUser(u)}>Aktifkan</button>
                    ) : (
                      <button className="btn btn-danger btn-sm" onClick={() => deactivateUser(u)}>Nonaktifkan</button>
                    )}
                  </td>
                </>
              )}
            </tr>
          ))}
          {pageRows.length === 0 && (
            <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>Tidak ada data.</td></tr>
          )}
        </tbody>
      </table>
      </div>

      <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={visibleUsers.length} />

      {pwModal && (
        <Portal>
        <div className="modal-overlay" onClick={() => setPwModal(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-close" onClick={() => setPwModal(null)}><Icon name="x" size={16} /></div>
            <h3 style={{ marginTop: 0 }}>Reset Password</h3>
            <div className="checklist-line" style={{ marginBottom: 12 }}>{pwModal.email}</div>
            <form onSubmit={handleResetPw}>
              <label>Password Baru (min. 6 karakter)</label>
              <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} required minLength={6} autoFocus />
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button type="button" className="btn btn-sm btn-neutral" style={{ flex: 1 }} onClick={() => setPwModal(null)}>Batal</button>
                <button type="submit" className="btn btn-primary btn-sm" style={{ flex: 1 }} disabled={loading || newPw.length < 6}>
                  {loading ? 'Memproses...' : 'Simpan Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
        </Portal>
      )}

      {reassignModal && (
        <Portal>
        <div className="modal-overlay" onClick={() => setReassignModal(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-close" onClick={() => setReassignModal(null)}><Icon name="x" size={16} /></div>
            <h3 style={{ marginTop: 0 }}>Reassign Pengajuan yang Macet</h3>
            <div className="checklist-line" style={{ marginBottom: 12 }}>
              "{reassignModal.resignedUser.full_name}" sudah dinonaktifkan. Pengajuan di bawah ini sedang menunggu
              approval role "{reassignModal.resignedUser.role}" di department "{reassignModal.resignedUser.department}" —
              pilih pengganti untuk masing-masing (opsional, boleh dilewati kalau mau ditangani manual nanti).
            </div>
            <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {reassignModal.rows.map((r) => (
                <div key={r.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{r.request_no}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                    {r.profiles?.full_name || '—'} · {rupiah(r.total_amount)}
                  </div>
                  <select
                    value={reassignModal.picks[r.id] || ''}
                    onChange={(e) => setReassignModal({ ...reassignModal, picks: { ...reassignModal.picks, [r.id]: e.target.value } })}
                  >
                    <option value="">-- Lewati (jangan reassign) --</option>
                    {delegateCandidates(reassignModal.resignedUser).map((cand) => (
                      <option key={cand.id} value={cand.id}>{cand.full_name} ({cand.role} · {cand.department})</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button type="button" className="btn btn-sm btn-neutral" style={{ flex: 1 }} onClick={() => setReassignModal(null)}>Tutup</button>
              <button type="button" className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={saveReassign} disabled={savingReassign}>
                {savingReassign ? 'Menyimpan...' : 'Simpan Delegasi'}
              </button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {confirmModal}
    </div>
  )
}

// ---- sub-tab: TRANSACTION MANAGEMENT ----
function AdminTransactions() {
  const [askConfirm, confirmModal] = useConfirm()
  const [rows, setRows] = useState([])
  const [topups, setTopups] = useState([])
  const [profiles, setProfiles] = useState({})
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const [openId, setOpenId] = useState(null)
  const [items, setItems] = useState({})
  const [msg, setMsg] = useState('')

  // bulk action state
  const [selected, setSelected] = useState(new Set())
  const [bulkStatus, setBulkStatus] = useState(STATUS_OPTIONS[0])

  // pagination state
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('reimbursements')
      .select('*')
      .order('created_at', { ascending: false })
    setRows(data || [])

    const { data: topupData } = await supabase
      .from('cash_topups')
      .select('*')
      .order('created_at', { ascending: false })
    setTopups(topupData || [])

    const { data: profs } = await supabase.from('profiles').select('id, full_name')
    const map = {}
    ;(profs || []).forEach((p) => { map[p.id] = p.full_name })
    setProfiles(map)
  }, [])

  useEffect(() => { load() }, [load])

  // Gabungkan pengajuan reimbursement (kas keluar) & pengisian kas (kas
  // masuk) jadi satu daftar transaksi, diurutkan berdasarkan waktu dibuat
  // terbaru. Setiap baris ditandai `recordType` supaya kolom Status/Aksi
  // bisa tampil beda sesuai jenisnya, tapi tetap satu tabel yang sama.
  const mergedRows = useMemo(() => {
    const reimbRows = rows.map((r) => ({ recordType: 'reimb', sortTs: new Date(r.created_at).getTime(), data: r }))
    const topupRows = topups.map((t) => ({ recordType: 'topup', sortTs: new Date(t.created_at).getTime(), data: t }))
    return [...reimbRows, ...topupRows].sort((a, b) => b.sortTs - a.sortTs)
  }, [rows, topups])

  const totalPages = Math.max(1, Math.ceil(mergedRows.length / pageSize))
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [totalPages, page])

  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize
    return mergedRows.slice(start, start + pageSize)
  }, [mergedRows, page, pageSize])

  const allOnPageSelected = pageRows.length > 0 && pageRows.every((row) => selected.has(row.recordType + '-' + row.data.id))

  function toggleOne(key) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  function toggleAllOnPage() {
    setSelected((s) => {
      const next = new Set(s)
      if (allOnPageSelected) pageRows.forEach((row) => next.delete(row.recordType + '-' + row.data.id))
      else pageRows.forEach((row) => next.add(row.recordType + '-' + row.data.id))
      return next
    })
  }

  function clearSelection() { setSelected(new Set()) }

  async function toggleItems(id) {
    if (openId === id) { setOpenId(null); return }
    setOpenId(id)
    if (!items[id]) {
      const { data } = await supabase.from('reimbursement_items').select('*').eq('reimbursement_id', id)
      setItems((m) => ({ ...m, [id]: data || [] }))
    }
  }

  function startEdit(row) {
    setEditing(row.recordType + '-' + row.data.id)
    if (row.recordType === 'reimb') {
      setForm({ status: row.data.status, total_amount: row.data.total_amount, required_role: row.data.required_role })
    } else {
      setForm({ amount: row.data.amount, note: row.data.note || '', topup_date: row.data.topup_date })
    }
    setMsg('')
  }

  async function saveEdit(row) {
    if (row.recordType === 'reimb') {
      const { error } = await supabase.from('reimbursements').update(form).eq('id', row.data.id)
      if (error) { setMsg('Error: ' + error.message); return }
    } else {
      const { error } = await supabase.from('cash_topups')
        .update({ amount: form.amount, note: form.note || null, topup_date: form.topup_date })
        .eq('id', row.data.id)
      if (error) { setMsg('Error: ' + error.message); return }
    }
    setEditing(null)
    setMsg('Transaksi berhasil diupdate.')
    load()
  }

  async function deleteTransaction(row) {
    if (row.recordType === 'reimb') {
      const ok = await askConfirm(`Hapus transaksi "${row.data.request_no}"? Semua item, lampiran, dan riwayat approval juga akan dihapus.`, { title: 'Hapus Transaksi' })
      if (!ok) return
      const { error } = await supabase.from('reimbursements').delete().eq('id', row.data.id)
      if (error) { setMsg('Error: ' + error.message); return }
    } else {
      const ok = await askConfirm(`Hapus pengisian kas "${row.data.topup_no || ''}"?`, { title: 'Hapus Pengisian Kas' })
      if (!ok) return
      const { error } = await supabase.from('cash_topups').delete().eq('id', row.data.id)
      if (error) { setMsg('Error: ' + error.message); return }
    }
    setMsg('Transaksi dihapus.')
    load()
  }

  async function deleteItem(itemId, reimbId) {
    const ok = await askConfirm('Hapus item ini?', { title: 'Hapus Item' })
    if (!ok) return
    await supabase.from('reimbursement_items').delete().eq('id', itemId)
    const { data: remaining } = await supabase.from('reimbursement_items').select('amount').eq('reimbursement_id', reimbId)
    const newTotal = (remaining || []).reduce((s, i) => s + Number(i.amount), 0)
    await supabase.from('reimbursements').update({ total_amount: newTotal }).eq('id', reimbId)
    const { data } = await supabase.from('reimbursement_items').select('*').eq('reimbursement_id', reimbId)
    setItems((m) => ({ ...m, [reimbId]: data || [] }))
    load()
  }

  // ---- bulk actions ----
  async function bulkChangeStatus() {
    const ids = Array.from(selected)
      .filter((key) => key.startsWith('reimb-'))
      .map((key) => key.slice('reimb-'.length))
    if (ids.length === 0) { setMsg('Pilih minimal satu transaksi reimbursement (ubah status tidak berlaku untuk pengisian kas).'); return }
    const ok = await askConfirm(`Ubah status ${ids.length} transaksi terpilih menjadi "${STATUS_LABEL[bulkStatus]}"?`, { title: 'Ubah Status Massal', danger: false, confirmLabel: 'Ya, Ubah Status' })
    if (!ok) return
    const { error } = await supabase.from('reimbursements').update({ status: bulkStatus }).in('id', ids)
    if (error) setMsg('Gagal ubah status massal: ' + error.message)
    else setMsg(`Status ${ids.length} transaksi berhasil diubah.`)
    clearSelection()
    load()
  }

  async function bulkDeleteTransactions() {
    if (selected.size === 0) return
    const ok = await askConfirm(`Hapus ${selected.size} transaksi terpilih?\nSemua item, lampiran, dan riwayat approval terkait juga akan dihapus.`, { title: 'Hapus Transaksi Massal' })
    if (!ok) return
    const keys = Array.from(selected)
    const reimbIds = keys.filter((key) => key.startsWith('reimb-')).map((key) => key.slice('reimb-'.length))
    const topupIds = keys.filter((key) => key.startsWith('topup-')).map((key) => key.slice('topup-'.length))
    let errMsg = ''
    if (reimbIds.length) {
      const { error } = await supabase.from('reimbursements').delete().in('id', reimbIds)
      if (error) errMsg += 'Gagal hapus reimbursement: ' + error.message + ' '
    }
    if (topupIds.length) {
      const { error } = await supabase.from('cash_topups').delete().in('id', topupIds)
      if (error) errMsg += 'Gagal hapus pengisian kas: ' + error.message
    }
    setMsg(errMsg || `${keys.length} transaksi berhasil dihapus.`)
    clearSelection()
    load()
  }

  return (
    <div>
      <h3 className="admin-section-title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="clipboard" size={16} /> Manajemen Transaksi ({mergedRows.length})</h3>
      {msg && <div className="admin-msg">{msg}</div>}

      <BulkBar count={selected.size} onClear={clearSelection}>
        <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <button className="btn btn-primary btn-sm" onClick={bulkChangeStatus}>Ubah Status</button>
        <button className="btn btn-danger btn-sm" onClick={bulkDeleteTransactions} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="trash" size={12} /> Hapus Terpilih</button>
      </BulkBar>

      <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th style={{ width: 32 }}>
              <input type="checkbox" checked={allOnPageSelected} onChange={toggleAllOnPage} />
            </th>
            <th>No. Request / Ref</th><th>Employee</th><th>Tanggal</th><th>Total</th><th>Status</th><th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row) => {
            const key = row.recordType + '-' + row.data.id
            const isTopup = row.recordType === 'topup'
            const r = row.data
            return (
              <React.Fragment key={key}>
                <tr className={selected.has(key) ? 'row-selected' : ''} style={isTopup ? { background: 'var(--success-bg, #f2fbf6)' } : undefined}>
                  <td><input type="checkbox" checked={selected.has(key)} onChange={() => toggleOne(key)} /></td>
                  <td>
                    {!isTopup && (
                      <span className="detail-toggle" onClick={() => toggleItems(r.id)}>
                        {openId === r.id ? '▼' : '▶'}
                      </span>
                    )}{' '}
                    {isTopup ? (r.topup_no || '—') : r.request_no}
                  </td>
                  <td>{isTopup ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="arrowUp" size={11} /> {profiles[r.created_by] || '—'}</span> : (profiles[r.employee_id] || '—')}</td>
                  <td>{isTopup ? r.topup_date : r.request_date}</td>
                  {editing === key ? (
                    isTopup ? (
                      <>
                        <td><input type="text" inputMode="numeric" value={formatThousands(form.amount)} onChange={(e) => setForm({ ...form, amount: stripThousands(e.target.value) })} style={{ width: 110 }} /></td>
                        <td>
                          <input type="date" value={form.topup_date} onChange={(e) => setForm({ ...form, topup_date: e.target.value })} style={{ width: 130 }} />
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button className="btn btn-success btn-sm" onClick={() => saveEdit(row)}>Simpan</button>{' '}
                          <button className="btn btn-sm btn-neutral" onClick={() => setEditing(null)}>Batal</button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td><input type="text" inputMode="numeric" value={formatThousands(form.total_amount)} onChange={(e) => setForm({ ...form, total_amount: stripThousands(e.target.value) })} style={{ width: 110 }} /></td>
                        <td>
                          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                          </select>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button className="btn btn-success btn-sm" onClick={() => saveEdit(row)}>Simpan</button>{' '}
                          <button className="btn btn-sm btn-neutral" onClick={() => setEditing(null)}>Batal</button>
                        </td>
                      </>
                    )
                  ) : (
                    <>
                      <td>{rupiah(isTopup ? r.amount : r.total_amount)}</td>
                      <td>{isTopup ? <span className="badge badge-topup" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="arrowUp" size={10} /> Kas Masuk</span> : <span className={`badge badge-${r.status}`}>{STATUS_LABEL[r.status]}</span>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-sm" style={{ background: '#e8f0fe', color: '#1a56db' }} onClick={() => startEdit(row)}>Edit</button>{' '}
                        <button className="btn btn-danger btn-sm" onClick={() => deleteTransaction(row)}>Hapus</button>
                      </td>
                    </>
                  )}
                </tr>
                {!isTopup && openId === r.id && (
                  <tr>
                    <td colSpan={7}>
                      <div className="admin-items-box">
                        <strong style={{ fontSize: 12 }}>Detail Item</strong>
                        {(items[r.id] || []).length === 0 ? (
                          <div className="checklist-line">Tidak ada item.</div>
                        ) : (
                          <div className="table-scroll">
                          <table style={{ marginTop: 6 }}>
                            <thead><tr><th>Tanggal</th><th>Kategori</th><th>Keterangan</th><th>Nominal</th><th></th></tr></thead>
                            <tbody>
                              {(items[r.id] || []).map((it) => (
                                <tr key={it.id}>
                                  <td>{it.expense_date}</td>
                                  <td>{it.category}</td>
                                  <td>{it.description || '—'}</td>
                                  <td>{rupiah(it.amount)}</td>
                                  <td><button className="btn btn-danger btn-sm" onClick={() => deleteItem(it.id, r.id)}>Hapus</button></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            )
          })}
          {pageRows.length === 0 && (
            <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>Tidak ada data.</td></tr>
          )}
        </tbody>
      </table>
      </div>

      <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={mergedRows.length} />

      {confirmModal}
    </div>
  )
}

// ---- sub-tab: APPROVAL HISTORY ----
function AdminHistory() {
  const [askConfirm, confirmModal] = useConfirm()
  const [rows, setRows] = useState([])
  const [topups, setTopups] = useState([])
  const [profiles, setProfiles] = useState({})
  const [reqNos, setReqNos] = useState({})

  // bulk action state
  const [selected, setSelected] = useState(new Set())

  // pagination state
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('approval_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)
    setRows(data || [])

    const { data: topupData } = await supabase
      .from('cash_topups')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)
    setTopups(topupData || [])

    const { data: profs } = await supabase.from('profiles').select('id, full_name')
    const pm = {}
    ;(profs || []).forEach((p) => { pm[p.id] = p.full_name })
    setProfiles(pm)

    const { data: reimbs } = await supabase.from('reimbursements').select('id, request_no')
    const rm = {}
    ;(reimbs || []).forEach((r) => { rm[r.id] = r.request_no })
    setReqNos(rm)
  }, [])

  useEffect(() => { load() }, [load])

  // Gabungkan riwayat approval (kas keluar) & riwayat pengisian kas (kas
  // masuk) jadi satu daftar riwayat, diurutkan waktu terbaru dulu.
  const mergedRows = useMemo(() => {
    const histRows = rows.map((h) => ({ recordType: 'hist', sortTs: new Date(h.created_at).getTime(), data: h }))
    const topupRows = topups.map((t) => ({ recordType: 'topup', sortTs: new Date(t.created_at).getTime(), data: t }))
    return [...histRows, ...topupRows].sort((a, b) => b.sortTs - a.sortTs)
  }, [rows, topups])

  const totalPages = Math.max(1, Math.ceil(mergedRows.length / pageSize))
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [totalPages, page])

  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize
    return mergedRows.slice(start, start + pageSize)
  }, [mergedRows, page, pageSize])

  const allOnPageSelected = pageRows.length > 0 && pageRows.every((row) => selected.has(row.recordType + '-' + row.data.id))

  function toggleOne(key) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  function toggleAllOnPage() {
    setSelected((s) => {
      const next = new Set(s)
      if (allOnPageSelected) pageRows.forEach((row) => next.delete(row.recordType + '-' + row.data.id))
      else pageRows.forEach((row) => next.add(row.recordType + '-' + row.data.id))
      return next
    })
  }

  function clearSelection() { setSelected(new Set()) }

  async function deleteHistory(row) {
    if (row.recordType === 'topup') {
      const ok = await askConfirm('Hapus riwayat pengisian kas ini?', { title: 'Hapus Riwayat' })
      if (!ok) return
      await supabase.from('cash_topups').delete().eq('id', row.data.id)
    } else {
      const ok = await askConfirm('Hapus riwayat ini?', { title: 'Hapus Riwayat' })
      if (!ok) return
      await supabase.from('approval_history').delete().eq('id', row.data.id)
    }
    load()
  }

  async function bulkDeleteHistory() {
    if (selected.size === 0) return
    const ok = await askConfirm(`Hapus ${selected.size} riwayat terpilih?`, { title: 'Hapus Riwayat Massal' })
    if (!ok) return
    const keys = Array.from(selected)
    const histIds = keys.filter((key) => key.startsWith('hist-')).map((key) => key.slice('hist-'.length))
    const topupIds = keys.filter((key) => key.startsWith('topup-')).map((key) => key.slice('topup-'.length))
    if (histIds.length) await supabase.from('approval_history').delete().in('id', histIds)
    if (topupIds.length) await supabase.from('cash_topups').delete().in('id', topupIds)
    clearSelection()
    load()
  }

  return (
    <div>
      <h3 className="admin-section-title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="history" size={16} /> Riwayat Approval ({mergedRows.length})</h3>

      <BulkBar count={selected.size} onClear={clearSelection}>
        <button className="btn btn-danger btn-sm" onClick={bulkDeleteHistory} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="trash" size={12} /> Hapus Terpilih</button>
      </BulkBar>

      <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th style={{ width: 32 }}>
              <input type="checkbox" checked={allOnPageSelected} onChange={toggleAllOnPage} />
            </th>
            <th>Waktu</th><th>No. Request / Ref</th><th>Approver</th><th>Aksi</th><th>Catatan</th><th></th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row) => {
            const key = row.recordType + '-' + row.data.id
            const isTopup = row.recordType === 'topup'
            const h = row.data
            return (
              <tr key={key} className={selected.has(key) ? 'row-selected' : ''} style={isTopup ? { background: 'var(--success-bg, #f2fbf6)' } : undefined}>
                <td><input type="checkbox" checked={selected.has(key)} onChange={() => toggleOne(key)} /></td>
                <td style={{ whiteSpace: 'nowrap', fontSize: 11 }}>{new Date(h.created_at).toLocaleString('id-ID')}</td>
                <td>{isTopup ? (h.topup_no || '—') : (reqNos[h.reimbursement_id] || '—')}</td>
                <td>{isTopup ? (profiles[h.created_by] || '—') : (profiles[h.approver_id] || '—')}</td>
                <td>{isTopup ? <span className="badge badge-topup" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="arrowUp" size={10} /> kas_masuk</span> : <span className={`badge badge-${h.action}`}>{h.action}</span>}</td>
                <td style={{ maxWidth: 200, fontSize: 12 }}>{isTopup ? (h.note || '—') : (h.notes || '—')}</td>
                <td><button className="btn btn-danger btn-sm" onClick={() => deleteHistory(row)}>Hapus</button></td>
              </tr>
            )
          })}
          {pageRows.length === 0 && (
            <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>Tidak ada data.</td></tr>
          )}
        </tbody>
      </table>
      </div>

      <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={mergedRows.length} />

      {confirmModal}
    </div>
  )
}

// ---- LAPORAN PENGAJUAN MACET (AGING) ----
// Menampilkan SEMUA pengajuan yang masih menggantung (belum verified/
// rejected/draft/revision), diurutkan dari yang paling lama menunggu.
// Beda dengan peringatan yang muncul waktu nonaktifkan user (yang cuma
// cek role & department tertentu) -- ini proaktif, mencakup SEMUA
// penyebab macet (approver sibuk, lupa, dst -- bukan cuma karena resign).
const AGING_STATUS_LABEL = {
  submitted: 'Menunggu Approval Departemen',
  approved: 'Menunggu Approval Finance Manager',
  finance_approved: 'Disetujui, Menunggu Finance Verification',
}

function daysSince(dateStr) {
  const ms = Date.now() - new Date(dateStr).getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

function AdminAgingReport() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [minDays, setMinDays] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('reimbursements')
      .select('id, request_no, status, required_role, total_amount, created_at, updated_at, profiles!employee_id(full_name, department)')
      .in('status', ['submitted', 'approved', 'finance_approved'])
      .order('updated_at', { ascending: true })
    setRows(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(
    () => rows.filter((r) => daysSince(r.updated_at) >= minDays),
    [rows, minDays]
  )

  const stuckOver7 = rows.filter((r) => daysSince(r.updated_at) > 7).length
  const stuckOver3 = rows.filter((r) => daysSince(r.updated_at) > 3).length

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [totalPages, page])
  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize])

  return (
    <div>
      <h3 className="admin-section-title" style={{ margin: 0, border: 'none', padding: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
        <Icon name="alertTriangle" size={16} /> Pengajuan Macet ({rows.length} sedang berjalan)
      </h3>
      <div className="checklist-line" style={{ marginBottom: 14 }}>
        Semua pengajuan yang belum selesai (belum verified/ditolak), diurutkan dari yang paling lama menunggu di status saat ini.
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div className="stat-pill" style={{ background: stuckOver7 > 0 ? '#fbe2df' : '#d9f4e3', color: stuckOver7 > 0 ? '#c0392b' : '#1f8a4c' }}>
          <strong>{stuckOver7}</strong> pengajuan &gt; 7 hari
        </div>
        <div className="stat-pill" style={{ background: stuckOver3 > 0 ? '#fff3cd' : '#d9f4e3', color: stuckOver3 > 0 ? '#664d03' : '#1f8a4c' }}>
          <strong>{stuckOver3}</strong> pengajuan &gt; 3 hari
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>Tampilkan minimal:</label>
        <select value={minDays} onChange={(e) => { setMinDays(Number(e.target.value)); setPage(1) }}>
          <option value={0}>Semua</option>
          <option value={3}>&gt; 3 hari</option>
          <option value={7}>&gt; 7 hari</option>
          <option value={14}>&gt; 14 hari</option>
        </select>
      </div>

      {loading ? (
        <div className="empty-state">Memuat...</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">Tidak ada pengajuan yang macet di ambang ini. 👍</div>
      ) : (
        <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>No. Request</th><th>Pengaju</th><th>Department</th><th>Status</th><th>Total</th><th>Sudah Berapa Lama</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => {
              const days = daysSince(r.updated_at)
              const severity = days > 7 ? 'danger' : days > 3 ? 'warning' : 'normal'
              return (
                <tr key={r.id}>
                  <td>{r.request_no}</td>
                  <td>{r.profiles?.full_name || '—'}</td>
                  <td>{r.profiles?.department || '—'}</td>
                  <td>{AGING_STATUS_LABEL[r.status] || r.status}</td>
                  <td>{rupiah(r.total_amount)}</td>
                  <td>
                    <span
                      className="admin-role-badge"
                      style={
                        severity === 'danger' ? { background: '#fbe2df', color: '#c0392b' }
                        : severity === 'warning' ? { background: '#fff3cd', color: '#664d03' }
                        : { background: '#e8f0fe', color: '#1a56db' }
                      }
                    >
                      {days === 0 ? 'Hari ini' : `${days} hari`}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      )}

      {filtered.length > 0 && (
        <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={filtered.length} />
      )}
    </div>
  )
}

// ---- MAIN ADMIN PANEL ----
const ADMIN_TABS = [
  { key: 'users', label: <><Icon name="users" size={13} /> User</> },
  { key: 'transactions', label: <><Icon name="clipboard" size={13} /> Transaksi</> },
  { key: 'aging', label: <><Icon name="alertTriangle" size={13} /> Pengajuan Macet</> },
  { key: 'history', label: <><Icon name="history" size={13} /> Riwayat</> },
]

export default function AdminPanel() {
  const [activeTab, setActiveTab] = useState('users')

  return (
    <div>
      <div className="admin-header">
        <div className="admin-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="admin" size={18} /> Admin Panel</div>
        <div className="admin-subtitle">Kontrol penuh database PCRS</div>
      </div>

      <div className="admin-tabs">
        {ADMIN_TABS.map((t) => (
          <div
            key={t.key}
            className={`admin-tab ${activeTab === t.key ? 'active' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
        {activeTab === 'users' && <AdminUsers />}
        {activeTab === 'transactions' && <AdminTransactions />}
        {activeTab === 'aging' && <AdminAgingReport />}
        {activeTab === 'history' && <AdminHistory />}
      </div>
    </div>
  )
}
