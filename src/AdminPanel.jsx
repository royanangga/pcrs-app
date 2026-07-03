import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from './supabaseClient'

const ROLES = ['employee', 'supervisor', 'manager', 'admin']

const STATUS_OPTIONS = ['draft', 'submitted', 'approved', 'verified', 'rejected', 'revision']

const STATUS_LABEL = {
  draft: 'Draft',
  submitted: 'Menunggu Approval',
  approved: 'Menunggu Finance Verification',
  verified: 'Terverifikasi (Siap Bayar)',
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

// ---- sub-tab: USER MANAGEMENT ----
function AdminUsers() {
  const [users, setUsers] = useState([])
  const [session, setSession] = useState(null)
  const [editing, setEditing] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ full_name: '', email: '', password: '', department: '', role: 'employee' })
  const [pwModal, setPwModal] = useState(null)  // { id, email }
  const [newPw, setNewPw] = useState('')
  const [msg, setMsg] = useState({ text: '', type: '' })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
  }, [])

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_get_users')
    if (error) setMsg({ text: 'Gagal memuat: ' + error.message, type: 'error' })
    else setUsers(data || [])
  }, [])

  useEffect(() => { load() }, [load])

  function startEdit(u) {
    setEditing(u.id)
    setEditForm({ full_name: u.full_name, department: u.department, role: u.role, email: u.email })
    setMsg({ text: '', type: '' })
  }

  async function saveEdit(u) {
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

  async function deleteUser(id, name) {
    if (!window.confirm(`Hapus user "${name}"?\nUser tidak akan bisa login lagi dan semua datanya akan dihapus permanen.`)) return
    setLoading(true)
    const result = await callAdminOps(session, { action: 'delete_user', user_id: id })
    if (result.error) {
      setMsg({ text: 'Gagal hapus: ' + result.error, type: 'error' })
    } else {
      setMsg({ text: `User "${name}" berhasil dihapus sepenuhnya.`, type: 'ok' })
      load()
    }
    setLoading(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
        <h3 className="admin-section-title" style={{ margin: 0, border: 'none', padding: 0 }}>👥 Manajemen User ({users.length})</h3>
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

      <table style={{ marginTop: 12 }}>
        <thead>
          <tr><th>Nama</th><th>Email</th><th>Department</th><th>Role</th><th>Aksi</th></tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
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
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-success btn-sm" onClick={() => saveEdit(u)} disabled={loading}>Simpan</button>{' '}
                    <button className="btn btn-sm" style={{ background: '#eee' }} onClick={() => setEditing(null)}>Batal</button>
                  </td>
                </>
              ) : (
                <>
                  <td>{u.full_name}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{u.email}</td>
                  <td>{u.department}</td>
                  <td><span className="admin-role-badge">{u.role}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm" style={{ background: '#e8f0fe', color: '#1a56db' }} onClick={() => startEdit(u)}>Edit</button>{' '}
                    <button className="btn btn-sm" style={{ background: '#fff3cd', color: '#664d03' }} onClick={() => { setPwModal({ id: u.id, email: u.email }); setNewPw('') }}>Reset PW</button>{' '}
                    <button className="btn btn-danger btn-sm" onClick={() => deleteUser(u.id, u.full_name)}>Hapus</button>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {pwModal && (
        <div className="modal-overlay" onClick={() => setPwModal(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-close" onClick={() => setPwModal(null)}>✕</div>
            <h3 style={{ marginTop: 0 }}>Reset Password</h3>
            <div className="checklist-line" style={{ marginBottom: 12 }}>{pwModal.email}</div>
            <form onSubmit={handleResetPw}>
              <label>Password Baru (min. 6 karakter)</label>
              <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} required minLength={6} autoFocus />
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button type="button" className="btn btn-sm" style={{ background: '#eee', flex: 1 }} onClick={() => setPwModal(null)}>Batal</button>
                <button type="submit" className="btn btn-primary btn-sm" style={{ flex: 1 }} disabled={loading || newPw.length < 6}>
                  {loading ? 'Memproses...' : 'Simpan Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- sub-tab: TRANSACTION MANAGEMENT ----
function AdminTransactions() {
  const [rows, setRows] = useState([])
  const [profiles, setProfiles] = useState({})
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const [openId, setOpenId] = useState(null)
  const [items, setItems] = useState({})
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('reimbursements')
      .select('*')
      .order('created_at', { ascending: false })
    setRows(data || [])

    const { data: profs } = await supabase.from('profiles').select('id, full_name')
    const map = {}
    ;(profs || []).forEach((p) => { map[p.id] = p.full_name })
    setProfiles(map)
  }, [])

  useEffect(() => { load() }, [load])

  async function toggleItems(id) {
    if (openId === id) { setOpenId(null); return }
    setOpenId(id)
    if (!items[id]) {
      const { data } = await supabase.from('reimbursement_items').select('*').eq('reimbursement_id', id)
      setItems((m) => ({ ...m, [id]: data || [] }))
    }
  }

  function startEdit(r) {
    setEditing(r.id)
    setForm({ status: r.status, total_amount: r.total_amount, required_role: r.required_role })
    setMsg('')
  }

  async function saveEdit(id) {
    const { error } = await supabase.from('reimbursements').update(form).eq('id', id)
    if (error) { setMsg('Error: ' + error.message); return }
    setEditing(null)
    setMsg('Transaksi berhasil diupdate.')
    load()
  }

  async function deleteTransaction(id, no) {
    if (!window.confirm(`Hapus transaksi "${no}"? Semua item, lampiran, dan riwayat approval juga akan dihapus.`)) return
    const { error } = await supabase.from('reimbursements').delete().eq('id', id)
    if (error) { setMsg('Error: ' + error.message); return }
    setMsg('Transaksi dihapus.')
    load()
  }

  async function deleteItem(itemId, reimbId) {
    if (!window.confirm('Hapus item ini?')) return
    await supabase.from('reimbursement_items').delete().eq('id', itemId)
    const { data: remaining } = await supabase.from('reimbursement_items').select('amount').eq('reimbursement_id', reimbId)
    const newTotal = (remaining || []).reduce((s, i) => s + Number(i.amount), 0)
    await supabase.from('reimbursements').update({ total_amount: newTotal }).eq('id', reimbId)
    const { data } = await supabase.from('reimbursement_items').select('*').eq('reimbursement_id', reimbId)
    setItems((m) => ({ ...m, [reimbId]: data || [] }))
    load()
  }

  return (
    <div>
      <h3 className="admin-section-title">📋 Manajemen Transaksi</h3>
      {msg && <div className="admin-msg">{msg}</div>}
      <table>
        <thead>
          <tr><th>No. Request</th><th>Employee</th><th>Tanggal</th><th>Total</th><th>Status</th><th>Aksi</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <React.Fragment key={r.id}>
              <tr>
                <td>
                  <span className="detail-toggle" onClick={() => toggleItems(r.id)}>
                    {openId === r.id ? '▼' : '▶'}
                  </span>{' '}
                  {r.request_no}
                </td>
                <td>{profiles[r.employee_id] || '—'}</td>
                <td>{r.request_date}</td>
                {editing === r.id ? (
                  <>
                    <td><input type="number" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} style={{ width: 110 }} /></td>
                    <td>
                      <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                        {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                      </select>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-success btn-sm" onClick={() => saveEdit(r.id)}>Simpan</button>{' '}
                      <button className="btn btn-sm" style={{ background: '#eee' }} onClick={() => setEditing(null)}>Batal</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td>{rupiah(r.total_amount)}</td>
                    <td><span className={`badge badge-${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm" style={{ background: '#e8f0fe', color: '#1a56db' }} onClick={() => startEdit(r)}>Edit</button>{' '}
                      <button className="btn btn-danger btn-sm" onClick={() => deleteTransaction(r.id, r.request_no)}>Hapus</button>
                    </td>
                  </>
                )}
              </tr>
              {openId === r.id && (
                <tr>
                  <td colSpan={6}>
                    <div className="admin-items-box">
                      <strong style={{ fontSize: 12 }}>Detail Item</strong>
                      {(items[r.id] || []).length === 0 ? (
                        <div className="checklist-line">Tidak ada item.</div>
                      ) : (
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
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---- sub-tab: APPROVAL HISTORY ----
function AdminHistory() {
  const [rows, setRows] = useState([])
  const [profiles, setProfiles] = useState({})
  const [reqNos, setReqNos] = useState({})

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('approval_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)
    setRows(data || [])

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

  async function deleteHistory(id) {
    if (!window.confirm('Hapus riwayat ini?')) return
    await supabase.from('approval_history').delete().eq('id', id)
    load()
  }

  return (
    <div>
      <h3 className="admin-section-title">📜 Riwayat Approval (200 terakhir)</h3>
      <table>
        <thead>
          <tr><th>Waktu</th><th>No. Request</th><th>Approver</th><th>Aksi</th><th>Catatan</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((h) => (
            <tr key={h.id}>
              <td style={{ whiteSpace: 'nowrap', fontSize: 11 }}>{new Date(h.created_at).toLocaleString('id-ID')}</td>
              <td>{reqNos[h.reimbursement_id] || '—'}</td>
              <td>{profiles[h.approver_id] || '—'}</td>
              <td><span className={`badge badge-${h.action}`}>{h.action}</span></td>
              <td style={{ maxWidth: 200, fontSize: 12 }}>{h.notes || '—'}</td>
              <td><button className="btn btn-danger btn-sm" onClick={() => deleteHistory(h.id)}>Hapus</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---- MAIN ADMIN PANEL ----
const ADMIN_TABS = [
  { key: 'users', label: '👥 User' },
  { key: 'transactions', label: '📋 Transaksi' },
  { key: 'history', label: '📜 Riwayat' },
]

export default function AdminPanel() {
  const [activeTab, setActiveTab] = useState('users')

  return (
    <div>
      <div className="admin-header">
        <div className="admin-title">⚙️ Admin Panel</div>
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
        {activeTab === 'history' && <AdminHistory />}
      </div>
    </div>
  )
}
