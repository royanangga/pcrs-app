import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { supabase } from './supabaseClient'
import AdminPanel from './AdminPanel.jsx'
import Pagination from './Pagination.jsx'
import { trackUrl, printSlip as printSlipShared, printBulkSlips as printBulkSlipsShared, printCashTopupSlip } from './slip.js'
import { MonthlyBarChart, CategoryDonutChart } from './Charts.jsx'
import NotificationBell from './Notifications.jsx'
import Icon, { Ico } from './icons.jsx'
import Portal from './Portal.jsx'

import AuthScreen from './AuthScreen.jsx'
import MyProfile from './pages/MyProfile.jsx'
import CashFlowReport from './pages/CashFlowReport.jsx'
import CashBalance from './pages/CashBalance.jsx'
import FinanceVerification from './pages/FinanceVerification.jsx'
import ApprovalQueue from './pages/ApprovalQueue.jsx'
import Dashboard from './pages/Dashboard.jsx'
import QRBadge from './components/QRBadge.jsx'
import SimpleAlertModal from './components/SimpleAlertModal.jsx'
import AttachmentPreviewLink from './components/AttachmentPreviewLink.jsx'
import SkeletonTable from './components/SkeletonTable.jsx'
import { useEscapeToClose } from './hooks/useEscapeToClose.js'
import {
  CATEGORIES,
  STATUS_LABEL,
  FINANCE_DEPARTMENT,
  APPROVER_ROLE_LABEL,
  MANAGER_THRESHOLD,
  SKIP_DEPT_APPROVAL_ROLES,
  SELF_SKIP_TO_MANAGER_ROLES,
  MAX_FILE_MB,
  ALLOWED_FILE_TYPES,
} from './lib/constants.js'
import {
  isFinanceUser,
  isFinanceManager,
  statusLabelFor,
  requiredRoleFor,
  initialStatusFor,
  nextApprovalRole,
  approvalFlowLabel,
  updateWithGuard,
  rupiah,
  generateRequestNo,
  generateTopupNo,
  fetchAttachments,
  validatePickedFiles,
  formatThousands,
  stripThousands,
  attachmentUrl,
} from './lib/helpers.js'

// ---------------------------------------------------------------- SUBMIT FORM ----
function SubmitForm({ profile, onSubmitted }) {
  const [items, setItems] = useState([{ expense_date: '', category: CATEGORIES[0], description: '', amount: '' }])
  const [files, setFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  useEscapeToClose(() => setShowConfirm(false), showConfirm)

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
    if (items.length === 0) {
      setMsg('Tambahkan minimal 1 item sebelum submit.')
      return
    }
    if (items.some((it) => !it.expense_date || !it.amount)) {
      setMsg('Lengkapi semua tanggal dan nominal item.')
      return
    }
    setShowConfirm(true)
  }

  async function handleSaveDraft() {
    if (items.length === 0) {
      setMsg('Tambahkan minimal 1 item sebelum menyimpan draft.')
      return
    }
    if (items.some((it) => !it.expense_date || !it.amount)) {
      setMsg('Lengkapi semua tanggal dan nominal item.')
      return
    }
    setSaving(true)

    const { data: header, error: hErr } = await supabase
      .from('reimbursements')
      .insert({
        request_no: generateRequestNo(),
        employee_id: profile.id,
        total_amount: total,
        status: 'draft',
        required_role: requiredRoleFor(profile.role),
      })
      .select()
      .single()

    if (hErr) {
      setMsg('Gagal menyimpan draft: ' + hErr.message)
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
    setMsg(`✓ Draft ${header.request_no} tersimpan. Belum dikirim ke siapa pun -- lanjutkan & submit kapan saja dari tab "Pengajuan Saya".`)
    onSubmitted && onSubmitted()
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
              <input
                type="text"
                inputMode="numeric"
                placeholder="0"
                value={formatThousands(it.amount)}
                onChange={(e) => updateItem(i, 'amount', stripThousands(e.target.value))}
                required
              />
            </div>
            <div>
              {items.length > 1 && (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => removeItem(i)}
                  disabled={items.length === 1}
                  title={items.length === 1 ? 'Minimal harus ada 1 item' : undefined}
                >
                  Hapus
                </button>
              )}
            </div>
          </div>
        ))}

        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-neutral" onClick={addItem}>
            + Tambah Item
          </button>
        </div>

        <label style={{ marginTop: 18 }}>Upload Bukti Transaksi (struk/foto, bisa lebih dari satu, maks {MAX_FILE_MB}MB/file)</label>
        <input
          type="file"
          accept="image/*,.pdf"
          multiple
          onChange={(e) => {
            const { valid, rejected } = validatePickedFiles(e.target.files)
            setFiles(valid)
            setMsg(rejected.length ? rejected.join('\n') : '')
          }}
        />
        {files.length > 0 && (
          <div className="checklist-line">{files.length} file dipilih: {files.map((f) => f.name).join(', ')}</div>
        )}

        <div className="total-line">Total: {rupiah(total)} &nbsp;•&nbsp; Alur Approval: <span style={{ color: 'var(--teal)', fontWeight: 700 }}>{approvalFlowLabel(profile.role, total)}</span></div>

        {msg && <div className="error-text" style={{ color: msg.startsWith('✓') ? 'var(--success)' : 'var(--danger)', whiteSpace: 'pre-line' }}>{msg}</div>}

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button className="btn btn-primary" disabled={saving}>
            {saving ? <><span className="spinner" />Mengirim...</> : 'Submit Reimbursement'}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-neutral"
            disabled={saving}
            onClick={handleSaveDraft}
          >
            {saving ? 'Menyimpan...' : 'Simpan sebagai Draft'}
          </button>
        </div>
      </form>
    </div>

    {/* Modal Konfirmasi Submit */}
    {showConfirm && (
      <Portal>
      <div className="modal-overlay" onClick={() => setShowConfirm(false)}>
        <div className="modal-box" style={{ width: 480, maxWidth: '96vw' }} onClick={(e) => e.stopPropagation()}>
          <div className="modal-close" onClick={() => setShowConfirm(false)}><Icon name="x" size={16} /></div>

          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ color: 'var(--teal)', marginBottom: 8 }}><Icon name="clipboard" size={36} /></div>
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
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="paperclip" size={13} /> {files.length} file bukti: {files.map((f) => f.name).join(', ')}
            </div>
          )}

          <div className="confirm-actions" style={{ marginTop: 18 }}>
            <button className="btn btn-neutral" style={{ flex: 1 }} onClick={() => setShowConfirm(false)}>
              Kembali & Edit
            </button>
            <button className="btn btn-primary" style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} onClick={handleConfirmedSubmit}>
              <Icon name="check" size={15} /> Ya, Kirim Sekarang
            </button>
          </div>
        </div>
      </div>
    </Portal>
    )}
    </>
  )
}

// ---------------------------------------------------------------- MY REQUESTS ----
// SkeletonTable dipindah ke src/components/SkeletonTable.jsx (lihat import di atas)

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
  const [confirmModal, setConfirmModal] = useState(null) // { type: 'submit' | 'delete', row }
  useEscapeToClose(() => !saving && setConfirmModal(null), !!confirmModal)

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
    // Muat juga attachment yang sudah ada, biar kelihatan di panel edit
    // (bukan cuma nambah file baru tanpa sadar file lama masih ada)
    if (!attMap[r.id]) {
      const list = await fetchAttachments(r.id)
      setAttMap((m) => ({ ...m, [r.id]: list }))
    }
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

  // Simpan perubahan pada draft TANPA mengubah statusnya (masih draft,
  // belum masuk antrian approval siapa pun).
  async function deleteDraft(r) {
    setSaving(true)
    const { error } = await supabase.from('reimbursements').delete().eq('id', r.id)
    setSaving(false)
    if (error) { setMsg('Gagal menghapus: ' + error.message); return }
    setEditId(null)
    setMsg('')
    load()
    onRefresh && onRefresh()
  }

  // Eksekutor tunggal untuk modal konfirmasi submit/hapus draft/hapus attachment
  async function runConfirmModal() {
    if (!confirmModal) return
    const { type, row } = confirmModal
    setConfirmModal(null)
    if (type === 'delete') await deleteDraft(row)
    else if (type === 'delete-attachment') await deleteAttachment(row.attachment, row.reimbId)
    else await submitRevision(row)
  }

  async function deleteAttachment(a, reimbId) {
    setSaving(true)
    // Hapus baris DB dulu (dijaga RLS: cuma boleh selama masih draft/revision)
    const { error } = await supabase.from('attachments').delete().eq('id', a.id)
    if (!error) {
      // Hapus file fisiknya juga dari storage (best-effort, tidak fatal kalau gagal)
      await supabase.storage.from('receipts').remove([a.file_path])
    }
    setSaving(false)
    if (error) { setMsg('Gagal menghapus lampiran: ' + error.message); return }
    setMsg('')
    setAttMap((m) => ({ ...m, [reimbId]: (m[reimbId] || []).filter((x) => x.id !== a.id) }))
  }

  async function saveDraftEdit(r) {
    if (editItems.length === 0) {
      setMsg('Tambahkan minimal 1 item sebelum menyimpan draft.')
      return
    }
    if (editItems.some((it) => !it.expense_date || !it.amount)) {
      setMsg('Lengkapi semua tanggal dan nominal item.')
      return
    }
    setSaving(true)

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

    for (const file of editFiles) {
      const path = `${r.id}/${Date.now()}_${file.name}`
      const { error: upErr } = await supabase.storage.from('receipts').upload(path, file)
      if (!upErr) {
        await supabase.from('attachments').insert({
          reimbursement_id: r.id, file_name: file.name, file_path: path,
        })
      }
    }

    setSaving(false)
    setEditId(null)
    setMsg('')
    setAttMap((m) => { const n = { ...m }; delete n[r.id]; return n })
    load()
    onRefresh && onRefresh()
  }

  async function submitRevision(r) {
    if (editItems.length === 0) {
      setMsg('Tambahkan minimal 1 item sebelum submit.')
      return
    }
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
      notes: r.status === 'draft' ? 'Draft disubmit oleh employee' : 'Pengajuan direvisi dan disubmit ulang oleh employee',
    })

    setSaving(false)
    setEditId(null)
    setMsg('')
    setAttMap((m) => { const n = { ...m }; delete n[r.id]; return n })
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
        <div className="myreq-search-box">
          <span className="search-icon"><Icon name="search" size={14} /></span>
          <input
            type="text"
            placeholder="Cari no. request, tanggal, status, atau nominal..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {search && (
          <button type="button" className="btn btn-sm btn-neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={() => setSearch('')}>
            <Icon name="x" size={12} /> Bersihkan
          </button>
        )}
      </div>

      {msg && <div className="error-text" style={{ color: 'var(--danger)', marginBottom: 10, whiteSpace: 'pre-line' }}>{msg}</div>}
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
                    {(r.status === 'revision' || r.status === 'draft') ? (
                      <button
                        className="btn btn-sm"
                        style={{ background: r.status === 'draft' ? '#e8f0fe' : '#ffe6cc', color: r.status === 'draft' ? '#1a56db' : '#b35900', fontWeight: 700 }}
                        onClick={() => editId === r.id ? setEditId(null) : openRevision(r)}
                      >
                        {editId === r.id ? 'Tutup' : r.status === 'draft' ? <><Icon name="edit" size={12} /> Lanjutkan Draft</> : <><Icon name="edit" size={12} /> Edit & Submit Ulang</>}
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
                          <Icon name="edit" size={14} style={{ marginRight: 4 }} />
                          {r.status === 'draft' ? 'Lanjutkan Draft' : 'Revisi Pengajuan'} <span>{r.request_no}</span>
                          <div className="revision-note">
                            {r.status === 'draft'
                              ? 'Belum dikirim ke siapa pun. Bisa disimpan lagi sebagai draft, atau langsung disubmit.'
                              : `Nomor request tetap sama. Setelah submit ulang, alur approval: ${approvalFlowLabel(profile.role, editTotal)}.`}
                          </div>
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
                              <input
                                type="text"
                                inputMode="numeric"
                                placeholder="0"
                                value={formatThousands(it.amount)}
                                onChange={(e) => updateEditItem(i, 'amount', stripThousands(e.target.value))}
                                required
                              />
                            </div>
                            <div>
                              {editItems.length > 1 && (
                                <button
                                  type="button"
                                  className="btn btn-danger btn-sm"
                                  onClick={() => removeEditItem(i)}
                                  disabled={editItems.length === 1}
                                  title={editItems.length === 1 ? 'Minimal harus ada 1 item' : undefined}
                                >
                                  Hapus
                                </button>
                              )}
                            </div>
                          </div>
                        ))}

                        <button type="button" className="btn btn-sm btn-neutral" style={{ marginTop: 10 }} onClick={addEditItem}>
                          + Tambah Item
                        </button>

                        <div className="total-line" style={{ marginTop: 10 }}>
                          Total: {rupiah(editTotal)} &nbsp;•&nbsp; Alur: {approvalFlowLabel(profile.role, editTotal)}
                        </div>

                        <label style={{ marginTop: 14 }}>Bukti Transaksi yang Sudah Diunggah</label>
                        {(attMap[r.id] || []).length === 0 ? (
                          <div className="checklist-line" style={{ color: 'var(--text-muted)' }}>Belum ada file diunggah.</div>
                        ) : (
                          <ul className="attachment-list">
                            {(attMap[r.id] || []).map((a) => (
                              <li key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                <AttachmentPreviewLink a={a} />
                                <button
                                  type="button"
                                  className="btn btn-danger btn-sm"
                                  style={{ padding: '2px 8px', fontSize: 11 }}
                                  disabled={saving}
                                  onClick={() => setConfirmModal({ type: 'delete-attachment', row: { attachment: a, reimbId: r.id } })}
                                >
                                  Hapus
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}

                        <label style={{ marginTop: 14 }}>Upload Bukti Transaksi Baru (opsional, file di atas tetap tersimpan, ini cuma menambah, maks {MAX_FILE_MB}MB/file)</label>
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          multiple
                          onChange={(e) => {
                            const { valid, rejected } = validatePickedFiles(e.target.files)
                            setEditFiles(valid)
                            setMsg(rejected.length ? rejected.join('\n') : '')
                          }}
                        />
                        {editFiles.length > 0 && (
                          <div className="checklist-line">{editFiles.length} file dipilih: {editFiles.map((f) => f.name).join(', ')}</div>
                        )}

                        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                          <button
                            className="btn btn-primary"
                            onClick={() => {
                              if (editItems.length === 0) { setMsg('Tambahkan minimal 1 item sebelum submit.'); return }
                              if (editItems.some((it) => !it.expense_date || !it.amount)) { setMsg('Lengkapi semua tanggal dan nominal item.'); return }
                              setMsg('')
                              setConfirmModal({ type: 'submit', row: r })
                            }}
                            disabled={saving}
                          >
                            {saving ? <><span className="spinner" />Menyimpan...</> : <><Icon name="check" size={13} /> {r.status === 'draft' ? 'Kirim Sekarang' : 'Submit Ulang'}</>}
                          </button>
                          {r.status === 'draft' && (
                            <button className="btn btn-sm btn-neutral" onClick={() => saveDraftEdit(r)} disabled={saving}>
                              Simpan sebagai Draft
                            </button>
                          )}
                          {r.status === 'draft' && (
                            <button className="btn btn-danger btn-sm" onClick={() => setConfirmModal({ type: 'delete', row: r })} disabled={saving}>
                              Hapus Draft
                            </button>
                          )}
                          <button className="btn btn-sm btn-neutral" onClick={() => setEditId(null)}>
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
                                  <AttachmentPreviewLink a={a} />
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

      {/* ---- Modal Konfirmasi Submit / Hapus Draft ---- */}
      {confirmModal && (
        <Portal>
        <div className="modal-overlay" onClick={() => !saving && setConfirmModal(null)}>
          <div className="modal-box confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon" style={{ color: confirmModal.type === 'delete' || confirmModal.type === 'delete-attachment' ? 'var(--danger, #d9534f)' : 'var(--teal)' }}>
              <Icon name={confirmModal.type === 'delete' || confirmModal.type === 'delete-attachment' ? 'trash' : 'check'} size={28} />
            </div>
            <h3 className="confirm-title">
              {confirmModal.type === 'delete'
                ? 'Hapus Draft?'
                : confirmModal.type === 'delete-attachment'
                  ? 'Hapus Lampiran?'
                  : confirmModal.row.status === 'draft' ? 'Kirim Draft Sekarang?' : 'Submit Ulang Pengajuan?'}
            </h3>
            <p className="confirm-desc">
              {confirmModal.type === 'delete'
                ? 'Draft ini akan dihapus permanen beserta item dan file yang sudah diunggah. Tidak bisa dibatalkan.'
                : confirmModal.type === 'delete-attachment'
                  ? `File "${confirmModal.row.attachment.file_name}" akan dihapus permanen. Tidak bisa dibatalkan.`
                  : confirmModal.row.status === 'draft'
                    ? `Alur approval: ${approvalFlowLabel(profile.role, editTotal)}. Setelah dikirim, tidak bisa ditarik kembali ke draft.`
                    : 'Pengajuan akan dikirim ulang ke approval dari tahap awal.'}
            </p>

            {confirmModal.type !== 'delete-attachment' && (
              <div className="confirm-detail">
                <div className="confirm-row"><span>No. Request</span><strong>{confirmModal.row.request_no}</strong></div>
                {confirmModal.type !== 'delete' && (
                  <div className="confirm-row"><span>Total</span><strong>{rupiah(editTotal)}</strong></div>
                )}
              </div>
            )}

            <div className="confirm-actions">
              <button className="btn btn-neutral" style={{ flex: 1 }} onClick={() => setConfirmModal(null)} disabled={saving}>
                Batal
              </button>
              <button
                className="btn"
                style={{ background: confirmModal.type === 'delete' || confirmModal.type === 'delete-attachment' ? 'var(--danger, #d9534f)' : 'var(--teal)', color: '#fff', flex: 1 }}
                onClick={runConfirmModal}
                disabled={saving}
              >
                {saving ? <><span className="spinner" />Memproses...</> : confirmModal.type === 'delete' || confirmModal.type === 'delete-attachment' ? 'Ya, Hapus' : 'Ya, Kirim'}
              </button>
            </div>
          </div>
        </div>
        </Portal>
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
// ApprovalQueue dipindah ke src/pages/ApprovalQueue.jsx (lihat import di atas)


// ---------------------------------------------------------------- FINANCE VERIFICATION (SETELAH PENCAIRAN) ----
// Tahap ini dilakukan SETELAH uang benar-benar sudah ditransfer/dibayarkan ke
// pengaju, sebagai konfirmasi/penutupan pengajuan. Bisa dilakukan oleh SIAPA
// SAJA di department Finance (role apa pun) + Admin — beda dengan tahap
// Approval Finance Manager di atas yang khusus Finance Manager/Admin saja.
// FinanceVerification dipindah ke src/pages/FinanceVerification.jsx (lihat import di atas)


// ---------------------------------------------------------------- SALDO KAS & LAPORAN ARUS KAS ----
// CashBalance (Submit Kas) dipindah ke src/pages/CashBalance.jsx
// CashFlowReport (Laporan Arus Kas) dipindah ke src/pages/CashFlowReport.jsx
// (lihat import keduanya di atas, dan komentar penjelasan lengkap di masing-masing file)


// ---------------------------------------------------------------- TANDA TANGAN SAYA ----
// MyProfile dipindah ke src/pages/MyProfile.jsx (lihat import di atas)

// ---------------------------------------------------------------- DASHBOARD ----
// Dashboard dipindah ke src/pages/Dashboard.jsx (lihat import di atas)


// ---------------------------------------------------------------- MAIN APP ----

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
    // Jaga-jaga: kalau akun sudah ditandai resign tapi masih sempat punya sesi aktif
    // (mis. ban belum diproses / sesi lama sebelum dinonaktifkan), paksa sign-out.
    if (data?.status === 'resigned') {
      await supabase.auth.signOut()
      setProfile(null)
      return
    }
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
