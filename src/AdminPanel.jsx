import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from './supabaseClient'

const ROLES = ['employee', 'supervisor', 'manager', 'finance_staff', 'finance_manager', 'admin']

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

// ---- sub-tab: USER MANAGEMENT ----
function AdminUsers() {
  const [users, setUsers] = useState([])
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*').order('full_name')
    setUsers(data || [])
  }, [])

  useEffect(() => { load() }, [load])

  function startEdit(u) {
    setEditing(u.id)
    setForm({ full_name: u.full_name, department: u.department, role: u.role })
    setMsg('')
  }

  async function saveEdit(id) {
    const { error } = await supabase.from('profiles').update(form).eq('id', id)
    if (error) { setMsg('Error: ' + error.message); return }
    setEditing(null)
    setMsg('User berhasil diupdate.')
    load()
  }

  async function deleteUser(id, name) {
    if (!window.confirm(`Hapus user "${name}"? Semua pengajuan terkait juga akan terpengaruh.`)) return
    const { error } = await supabase.from('profiles').delete().eq('id', id)
    if (error) { setMsg('Error: ' + error.message); return }
    setMsg('User dihapus.')
    load()
  }

  return (
    <div>
      <h3 className="admin-section-title">👥 Manajemen User</h3>
      {msg && <div className="admin-msg">{msg}</div>}
      <table>
        <thead>
          <tr><th>Nama</th><th>Department</th><th>Role</th><th>Aksi</th></tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              {editing === u.id ? (
                <>
                  <td><input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></td>
                  <td><input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></td>
                  <td>
                    <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-success btn-sm" onClick={() => saveEdit(u.id)}>Simpan</button>{' '}
                    <button className="btn btn-sm" style={{ background: '#eee' }} onClick={() => setEditing(null)}>Batal</button>
                  </td>
                </>
              ) : (
                <>
                  <td>{u.full_name}</td>
                  <td>{u.department}</td>
                  <td><span className="admin-role-badge">{u.role}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm" style={{ background: '#e8f0fe', color: '#1a56db' }} onClick={() => startEdit(u)}>Edit</button>{' '}
                    <button className="btn btn-danger btn-sm" onClick={() => deleteUser(u.id, u.full_name)}>Hapus</button>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
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
