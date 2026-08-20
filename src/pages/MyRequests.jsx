import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import Icon from '../icons.jsx'
import Portal from '../Portal.jsx'
import Pagination from '../Pagination.jsx'
import { trackUrl } from '../slip.js'
import { useEscapeToClose } from '../hooks/useEscapeToClose.js'
import QRBadge from '../components/QRBadge.jsx'
import AttachmentPreviewLink from '../components/AttachmentPreviewLink.jsx'
import SkeletonTable from '../components/SkeletonTable.jsx'
import { CATEGORIES, MAX_FILE_MB } from '../lib/constants.js'
import { rupiah, statusLabelFor, requiredRoleFor, initialStatusFor, approvalFlowLabel, fetchAttachments, validatePickedFiles, formatThousands, stripThousands } from '../lib/helpers.js'

// ---------------------------------------------------------------- MY REQUESTS ----
export default function MyRequests({ profile, refreshKey, onRefresh }) {
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
