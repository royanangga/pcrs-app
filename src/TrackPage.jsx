import React, { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { AuthScreen } from './App.jsx'

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

export default function TrackPage({ requestNo }) {
  const [session, setSession] = useState(undefined) // undefined = belum dicek
  const [data, setData] = useState(null)
  const [attachments, setAttachments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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
              <span className={`badge badge-${data.status}`}>{STATUS_LABEL[data.status] || data.status}</span>
            </div>

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
