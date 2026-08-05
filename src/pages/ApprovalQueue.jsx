import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import Icon from '../icons.jsx'
import Portal from '../Portal.jsx'
import Pagination from '../Pagination.jsx'
import { useEscapeToClose } from '../hooks/useEscapeToClose.js'
import SimpleAlertModal from '../components/SimpleAlertModal.jsx'
import { APPROVER_ROLE_LABEL } from '../lib/constants.js'
import { rupiah, isFinanceManager, nextApprovalRole, updateWithGuard } from '../lib/helpers.js'

// ---------------------------------------------------------------- APPROVAL QUEUE ----
export default function ApprovalQueue({ profile, refreshKey, onActed }) {
  const [rows, setRows] = useState([])
  const [empProfiles, setEmpProfiles] = useState({}) // id -> { full_name, department }
  const [noteDraft, setNoteDraft] = useState({})
  const [selected, setSelected] = useState([])         // array of row.id
  const [bulkNote, setBulkNote] = useState('')
  const [confirm, setConfirm] = useState(null)         // single: { row, action }
  const [bulkConfirm, setBulkConfirm] = useState(null) // bulk: { action }
  const [processing, setProcessing] = useState(false)
  useEscapeToClose(() => !processing && setConfirm(null), !!confirm)
  useEscapeToClose(() => !processing && setBulkConfirm(null), !!bulkConfirm)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [alertMsg, setAlertMsg] = useState('')

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
        .select('*, profiles!employee_id(id, full_name, department, role)')
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
          .select('*, profiles!employee_id(id, full_name, department, role)')
          .eq('status', 'approved')
          .order('created_at', { ascending: true })
        fmRows = fmData || []
      }

      // ---- Tahap Delegasi: pengajuan yang secara khusus didelegasikan ke user
      // ini oleh admin (dipakai saat approver asli sudah resign/dinonaktifkan
      // dan tidak ada lagi yang cocok secara role+department) ----
      const { data: delegatedData } = await supabase
        .from('reimbursements')
        .select('*, profiles!employee_id(id, full_name, department, role)')
        .eq('delegated_approver_id', profile.id)
        .in('status', ['submitted', 'approved'])
        .order('created_at', { ascending: true })

      const existingIds = new Set([...deptRows, ...fmRows].map((r) => r.id))
      const delegatedRows = (delegatedData || []).filter((r) => !existingIds.has(r.id))

      const merged = [
        ...deptRows.map((r) => ({ ...r, _stage: 'dept' })),
        ...fmRows.map((r) => ({ ...r, _stage: 'fm' })),
        ...delegatedRows.map((r) => ({ ...r, _stage: r.status === 'approved' ? 'fm' : 'dept', _delegated: true })),
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
      setAlertMsg('Gagal memproses aksi: ' + error.message)
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
        const { error } = await updateWithGuard(row.id, row.status, { status: 'finance_approved' })
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
        const { error } = await updateWithGuard(row.id, row.status, { status: newStatus })
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
        const { error } = await updateWithGuard(row.id, row.status, { required_role: next })
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
        const { error } = await updateWithGuard(row.id, row.status, { status: 'approved' })
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
      const { error } = await updateWithGuard(row.id, row.status, { status: newStatus })
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

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [totalPages, page])

  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize
    return rows.slice(start, start + pageSize)
  }, [rows, page, pageSize])

  // ---- Select helpers ----
  // PENTING: "pilih semua" cuma memilih baris di HALAMAN YANG SEDANG TAMPIL
  // (pageRows), bukan seluruh data di semua halaman (rows) -- supaya tidak
  // diam-diam ikut memproses (approve/reject massal) baris yang belum pernah
  // dilihat user di halaman lain. Pola yang sama dipakai di Dashboard untuk
  // fitur cetak massal.
  const allSelected = pageRows.length > 0 && pageRows.every((r) => selected.includes(r.id))
  const someSelected = pageRows.some((r) => selected.includes(r.id)) && !allSelected

  function toggleOne(id) {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }
  function toggleAll() {
    const pageIds = pageRows.map((r) => r.id)
    setSelected((prev) => allSelected
      ? prev.filter((id) => !pageIds.includes(id))
      : [...new Set([...prev, ...pageIds])])
  }

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
    if (errors.length) setAlertMsg('Sebagian aksi gagal diproses:\n' + errors.join('\n'))
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
      icon: <Icon name="check" size={28} />,
      desc: (row) => {
        if (!row) return ''
        if (row._stage === 'fm') return 'Setelah Anda setujui (Finance Manager), pengajuan siap dicairkan dan akan masuk ke antrian Finance Verification.'
        const next = nextApprovalRole(row.required_role, row.profiles?.role, row.total_amount)
        if (next === 'manager') return 'Nominal ≥ Rp5jt — setelah Anda setujui, pengajuan diteruskan ke Manager Departemen.'
        return 'Setelah Anda setujui, pengajuan akan masuk ke antrian Approval Finance Manager (sebelum dana dicairkan).'
      },
    },
    rejected: { label: 'Reject', color: 'var(--danger)', icon: <Icon name="x" size={28} />, desc: () => 'Pengajuan akan ditolak dan employee akan diberitahu.' },
    revision: { label: 'Kembalikan untuk Revisi', color: '#b35900', icon: <Icon name="undo" size={28} />, desc: () => 'Pengajuan dikembalikan ke employee untuk diperbaiki.' },
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
              <button className="btn btn-success btn-sm" onClick={() => setBulkConfirm({ action: 'approved' })}><Icon name="check" size={12} /> Approve Semua</button>
              <button className="btn btn-danger btn-sm" onClick={() => setBulkConfirm({ action: 'rejected' })}><Icon name="x" size={12} /> Reject Semua</button>
              <button className="btn btn-sm" style={{ background: '#ffe6cc', color: '#b35900' }} onClick={() => setBulkConfirm({ action: 'revision' })}><Icon name="undo" size={12} /> Revisi Semua</button>
              <button className="btn btn-sm btn-neutral" onClick={() => setSelected([])}>Batal Pilih</button>
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
                  <td>
                    {empProfiles[r.employee_id]?.full_name || '—'}
                    {r._delegated && (
                      <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 999, background: '#fff3cd', color: '#664d03', whiteSpace: 'nowrap' }}>
                        Didelegasikan ke Anda
                      </span>
                    )}
                  </td>
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
                    <button className="btn btn-success btn-sm" onClick={() => requestAct(r, 'approved')}><Icon name="check" size={13} /></button>{' '}
                    <button className="btn btn-danger btn-sm" onClick={() => requestAct(r, 'rejected')}><Icon name="x" size={13} /></button>{' '}
                    <button className="btn btn-sm" style={{ background: '#ffe6cc', color: '#b35900' }} onClick={() => requestAct(r, 'revision')}><Icon name="undo" size={13} /></button>
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
        <Portal>
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
                className="btn btn-neutral"
                style={{ flex: 1 }}
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
      </Portal>
      )}

      {/* ---- Bulk Confirm Modal ---- */}
      {bulkConfirm && (
        <Portal>
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
              <button className="btn btn-neutral" style={{ flex: 1 }} onClick={() => setBulkConfirm(null)} disabled={processing}>
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
      </Portal>
      )}
      {alertMsg && <SimpleAlertModal text={alertMsg} onClose={() => setAlertMsg('')} />}
    </>
  )
}
