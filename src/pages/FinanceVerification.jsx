import React, { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import Icon from '../icons.jsx'
import Portal from '../Portal.jsx'
import Pagination from '../Pagination.jsx'
import { trackUrl } from '../slip.js'
import { useEscapeToClose } from '../hooks/useEscapeToClose.js'
import QRBadge from '../components/QRBadge.jsx'
import SimpleAlertModal from '../components/SimpleAlertModal.jsx'
import AttachmentPreviewLink from '../components/AttachmentPreviewLink.jsx'
import { rupiah, fetchAttachments, updateWithGuard } from '../lib/helpers.js'

// ---------------------------------------------------------------- FINANCE VERIFICATION ----
export default function FinanceVerification({ profile, refreshKey, onActed }) {
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
