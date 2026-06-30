import React, { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

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
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data: rows, error: err } = await supabase.rpc('get_tracking_info', { p_request_no: requestNo })
      if (err) {
        setError('Gagal memuat data.')
      } else if (!rows || rows.length === 0) {
        setError('Nomor request tidak ditemukan.')
      } else {
        setData(rows[0])
      }
      setLoading(false)
    }
    load()
  }, [requestNo])

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
          </div>
        )}

        <div className="toggle-link" onClick={() => { window.location.href = '/' }}>
          Buka aplikasi PCRS
        </div>
      </div>
    </div>
  )
}
