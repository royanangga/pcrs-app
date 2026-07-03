import React, { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { AuthScreen } from './App.jsx'
import { printSlipByRequestNo } from './slip.js'

const STATUS_LABEL = {
  draft: 'Draft',
  submitted: 'Menunggu Approval',
  approved: 'Menunggu Approval Finance Manager',
  finance_approved: 'Disetujui Finance Manager — Menunggu Pencairan',
  verified: 'Terverifikasi (Sudah Dicairkan)',
  rejected: 'Ditolak',
  revision: 'Perlu Revisi',
}

const APPROVER_ROLE_LABEL = {
  supervisor: 'SPV Departemen',
  manager: 'Manager Departemen',
}

// Kalau RPC tracking mengembalikan kolom required_role, tampilkan menunggu
// approval dari siapa secara spesifik. Kalau tidak ada, fallback ke label umum.
function statusLabelFor(row) {
  if (!row) return ''
  if (row.status === 'submitted' && row.required_role) {
    const approverLabel = APPROVER_ROLE_LABEL[row.required_role] || row.required_role
    return `Menunggu Approval ${approverLabel}`
  }
  return STATUS_LABEL[row.status] || row.status
}

function rupiah(n) {
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID')
}

export default function TrackPage({ requestNo }) {
  const [session, setSession] = useState(undefined) // undefined = belum dicek
  const [data, setData] = useState(null)
  const [attachments, setAttachments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [printing, setPrinting] = useState(false)
  const [printError, setPrintError] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    async function load() {
      setLoading(true)
      const { data: rows, error: err } = await supabase.rpc('get_tracking_info', { p_request_no: requestNo })
      if (err) {
        setError('Gagal memuat data.')
      } else if (!rows || rows.length === 0) {
        setError('Pengajuan tidak ditemukan, atau Anda tidak punya akses untuk melihatnya. Hanya pembuat pengajuan dan tim finance yang bisa melihat halaman ini.')
      } else {
        setData(rows[0])
        const { data: atts } = await supabase.rpc('get_tracking_attachments', { p_request_no: requestNo })
        setAttachments(atts || [])
      }
      setLoading(false)
    }
    load()
  }, [requestNo, session])

  function fileUrl(filePath) {
    return supabase.storage.from('receipts').getPublicUrl(filePath).data.publicUrl
  }

  function isImage(name) {
    return /\.(jpe?g|png|gif|webp)$/i.test(name)
  }

  // Print ulang slip — hanya masuk akal untuk pengajuan yang sudah verified
  // (sudah dicairkan), sama seperti aturan print slip di Dashboard.
  async function handlePrint() {
    setPrintError('')
    setPrinting(true)
    try {
      await printSlipByRequestNo(supabase, requestNo, false)
    } catch (e) {
      setPrintError('Gagal menyiapkan slip untuk dicetak. Silakan coba lagi.')
    } finally {
      setPrinting(false)
    }
  }

  if (session === undefined) {
    return <div className="container">Memuat...</div>
  }

  if (!session) {
    return <AuthScreen />
  }

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ width: 380 }}>
        <h2>PCRS Tracking</h2>
        <div className="sub">Status pengajuan reimbursement</div>

        {loading && <div className="checklist-line">Memuat...</div>}
        {!loading && error && <div className="error-text">{error}</div>}

        {!loading && data && (
          <div>
            <div className="track-row"><span>No. Request</span><strong>{data.request_no}</strong></div>
            <div className="track-row"><span>Department</span><strong>{data.department || '—'}</strong></div>
            <div className="track-row"><span>Tanggal</span><strong>{data.request_date}</strong></div>
            <div className="track-row"><span>Total</span><strong>{rupiah(data.total_amount)}</strong></div>
            <div className="track-row">
              <span>Status</span>
              <span className={`badge badge-${data.status}`}>{statusLabelFor(data)}</span>
            </div>

            {data.status === 'verified' && (
              <div style={{ marginTop: 12 }}>
                <button
                  className="btn btn-sm"
                  style={{ background: '#14213d', color: '#fff', width: '100%' }}
                  disabled={printing}
                  onClick={handlePrint}
                >
                  {printing ? 'Menyiapkan...' : '🖨 Print Ulang Slip'}
                </button>
                {printError && <div className="error-text" style={{ marginTop: 6 }}>{printError}</div>}
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <strong style={{ fontSize: 13 }}>Bukti Transaksi</strong>
              {attachments.length === 0 ? (
                <div className="checklist-line">Tidak ada file dilampirkan.</div>
              ) : (
                <div className="track-attachments">
                  {attachments.map((a, i) => (
                    <a key={i} href={fileUrl(a.file_path)} target="_blank" rel="noreferrer" className="track-att-item">
                      {isImage(a.file_name) ? (
                        <img src={fileUrl(a.file_path)} alt={a.file_name} />
                      ) : (
                        <div className="track-att-file">📄</div>
                      )}
                      <span>{a.file_name}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="toggle-link" onClick={() => { window.location.href = '/' }}>
          Buka aplikasi PCRS
        </div>
      </div>
    </div>
  )
}
