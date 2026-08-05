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
import QRBadge from './components/QRBadge.jsx'
import SimpleAlertModal from './components/SimpleAlertModal.jsx'
import AttachmentPreviewLink from './components/AttachmentPreviewLink.jsx'
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
function ApprovalQueue({ profile, refreshKey, onActed }) {
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
  const [alertMsg, setAlertMsg] = useState('')
  useEscapeToClose(() => !processing && setConfirm(null), !!confirm)

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
    // Validasi eksplisit di sini WAJIB ada, jangan cuma andalkan atribut
    // max="today" pada <input type="date">: di picker native mobile
    // (iOS/Android) atribut max itu tidak dipatuhi secara visual — user
    // tetap bisa scroll/pilih tanggal di masa depan lewat wheel picker,
    // beda dengan kalender grid di desktop yang otomatis men-disable
    // tanggal setelah hari ini.
    if (action === 'verified' && disbursedDate > new Date().toISOString().slice(0, 10)) {
      setDateError('Tanggal pencairan tidak boleh lebih dari hari ini.')
      return
    }
    setDateError('')
    setProcessing(true)
    const newStatus = action === 'verified' ? 'verified' : 'revision'
    const { error: updErr } = await updateWithGuard(row.id, row.status, { status: newStatus })
    if (updErr) {
      setProcessing(false)
      setAlertMsg('Gagal memproses verifikasi: ' + updErr.message)
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
      setAlertMsg('Verifikasi berhasil, namun gagal mencatat riwayat: ' + histErr.message)
    }
    setConfirm(null)
    onActed && onActed()
  }

  const VERIFY_ACTION_META = {
    verified: {
      label: 'Verifikasi',
      color: 'var(--success)',
      icon: <Icon name="check" size={28} />,
      desc: (row) => `Konfirmasi bahwa dana sebesar ${rupiah(row?.total_amount)} untuk ${row?.request_no} sudah benar-benar ditransfer/dicairkan ke pengaju. Pengajuan akan ditutup sebagai "Terverifikasi".`,
    },
    revision: {
      label: 'Kembalikan',
      color: '#b35900',
      icon: <Icon name="undo" size={28} />,
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
                          <div className="checklist-line"><Icon name="square" size={12} style={{ marginRight: 5 }} /> Struk/bukti sesuai nominal</div>
                          <div className="checklist-line"><Icon name="square" size={12} style={{ marginRight: 5 }} /> Tidak ada duplikasi pengajuan</div>
                          <div className="checklist-line"><Icon name="square" size={12} style={{ marginRight: 5 }} /> Sesuai budget department</div>
                          <strong style={{ fontSize: 13, display: 'block', marginTop: 8 }}>File Bukti Transaksi</strong>
                          {(attMap[r.id] || []).length === 0 ? (
                            <div className="checklist-line">Tidak ada file diupload oleh employee.</div>
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

      {rows.length > 0 && (
        <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={rows.length} />
      )}

      {/* ---- Pop-up konfirmasi verifikasi / kembalikan ---- */}
      {confirm && (
        <Portal>
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
                  onChange={(e) => {
                    const v = e.target.value
                    setDisbursedDate(v)
                    setDateError(v > new Date().toISOString().slice(0, 10)
                      ? 'Tanggal pencairan tidak boleh lebih dari hari ini.'
                      : '')
                  }}
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
                className="btn btn-neutral"
                style={{ flex: 1 }}
                onClick={() => setConfirm(null)}
                disabled={processing}
              >
                Batal
              </button>
              <button
                className="btn"
                style={{ background: VERIFY_ACTION_META[confirm.action].color, color: '#fff', flex: 1 }}
                onClick={confirmAct}
                disabled={processing || (confirm.action === 'verified' && (!disbursedDate || !!dateError))}
              >
                {processing ? <><span className="spinner" />Memproses...</> : `Ya, ${VERIFY_ACTION_META[confirm.action].label}`}
              </button>
            </div>
          </div>
        </div>
      </Portal>
      )}
      {alertMsg && <SimpleAlertModal text={alertMsg} onClose={() => setAlertMsg('')} />}
    </div>
  )
}

// ---------------------------------------------------------------- SALDO KAS & LAPORAN ARUS KAS ----
// CashBalance (Submit Kas) dipindah ke src/pages/CashBalance.jsx
// CashFlowReport (Laporan Arus Kas) dipindah ke src/pages/CashFlowReport.jsx
// (lihat import keduanya di atas, dan komentar penjelasan lengkap di masing-masing file)


// ---------------------------------------------------------------- TANDA TANGAN SAYA ----
// MyProfile dipindah ke src/pages/MyProfile.jsx (lihat import di atas)

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
  const [alertMsg, setAlertMsg] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const isFinanceOrAdmin = isFinanceUser(profile)

  useEffect(() => {
    async function load() {
      setLoadingData(true)
      let query = supabase
        .from('reimbursements')
        .select('*, profiles!employee_id(full_name, department, signature_url), reimbursement_items(category, amount)')
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
      setAlertMsg('Gagal membuat file Excel. Silakan coba lagi.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <div className="filter-panel">
        <div className="filter-panel-head">
          <div className="filter-title"><span className="filter-icon"><Icon name="filter" size={13} /></span> Filter Data</div>
          {activeChips.length > 0 && (
            <span className="filter-clear-all" onClick={resetFilters}>Hapus semua filter</span>
          )}
        </div>

        {/* Search bar */}
        <div className="search-bar-wrap">
          <span className="search-icon"><Icon name="search" size={14} /></span>
          <input
            className="search-bar-input"
            type="text"
            placeholder="Cari no. request, nama karyawan, departemen, atau nominal..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <span className="search-clear" onClick={() => setSearch('')}><Icon name="x" size={12} /></span>
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
                <span className="chip-x" onClick={c.clear}><Icon name="x" size={10} /></span>
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
            <h3><Icon name="trendingUp" size={16} style={{ marginRight: 6 }} /> Tren Pengeluaran Terverifikasi (6 Bulan Terakhir)</h3>
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
                style={{ background: '#14213d', color: '#fff', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                disabled={bulkPrinting || selectedPrintableRows.length === 0}
                onClick={() => handleBulkPrint(false)}
                title={selectedPrintableRows.length === 0 ? 'Tidak ada dokumen berstatus Terverifikasi pada seleksi ini' : ''}
              >
                {bulkPrinting ? <><span className="spinner" />Menyiapkan...</> : <><Icon name="printer" size={13} /> Print Slip ({selectedPrintableRows.length})</>}
              </button>
              <button
                className="btn btn-sm"
                style={{ background: '#0f6e6e', color: '#fff', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                disabled={exporting}
                onClick={handleExportExcel}
              >
                {exporting ? <><span className="spinner" />Menyiapkan...</> : <><Icon name="barChart" size={13} /> Export Excel</>}
              </button>
              <button className="btn btn-sm btn-neutral" onClick={() => setSelectedPrintIds([])}>Batal Pilih</button>
            </div>
            {selectedIgnoredCount > 0 && (
              <div style={{ flexBasis: '100%', fontSize: 12, color: '#ffe9b3', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Icon name="alertTriangle" size={13} /> {selectedIgnoredCount} baris terpilih belum berstatus <strong>Terverifikasi</strong> — akan diabaikan saat Print Slip (tetap ikut di Export Excel).
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
                        style={{ background: '#14213d', color: '#fff', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                        onClick={() => printSlipShared(supabase, r, false)}
                      >
                        <Icon name="printer" size={13} /> Print Slip
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
      {alertMsg && <SimpleAlertModal text={alertMsg} onClose={() => setAlertMsg('')} />}
    </>
  )
}

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
