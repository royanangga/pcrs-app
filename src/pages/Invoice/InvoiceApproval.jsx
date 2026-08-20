import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import Icon from '../../icons.jsx'
import { numFmt, invoiceTotal } from '../../lib/invoiceHelpers.js'

export default function InvoiceApproval({ profile }) {
  const [tab, setTab] = useState('pending')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('invoice_invoices')
      .select('*, items:invoice_items(*)')
      .eq('status', 'Diajukan')
      .eq('approval_status', tab === 'pending' ? 'pending' : 'approved')
      .order('created_at', { ascending: false })
    setRows(data || [])
    setLoading(false)
  }, [tab])

  useEffect(() => { load() }, [load])

  async function approve(r) {
    setBusyId(r.id)
    setMsg('')
    const { error } = await supabase.from('invoice_invoices').update({
      approval_status: 'approved', approved_by: profile.id, approved_at: new Date().toISOString(),
    }).eq('id', r.id)
    setBusyId(null)
    if (error) setMsg('Gagal approve: ' + error.message)
    else load()
  }

  async function unapprove(r) {
    setBusyId(r.id)
    setMsg('')
    const { error } = await supabase.from('invoice_invoices').update({
      approval_status: 'pending', approved_by: null, approved_at: null,
    }).eq('id', r.id)
    setBusyId(null)
    if (error) setMsg('Gagal membatalkan approval: ' + error.message)
    else load()
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button className={`btn btn-sm ${tab === 'pending' ? 'btn-primary' : 'btn-neutral'}`} onClick={() => setTab('pending')}>Menunggu Approval</button>
        <button className={`btn btn-sm ${tab === 'approved' ? 'btn-primary' : 'btn-neutral'}`} onClick={() => setTab('approved')}>Sudah Disetujui</button>
      </div>

      {msg && <div className="error-text" style={{ color: 'var(--danger)', marginBottom: 10 }}>{msg}</div>}

      {loading ? (
        <div className="empty-state">Memuat...</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">{tab === 'pending' ? 'Tidak ada invoice yang menunggu approval.' : 'Belum ada invoice yang disetujui.'}</div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>No. Invoice</th><th>Tanggal</th><th>Customer</th><th>Total (IDR)</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.invoice_no}</td>
                  <td>{r.invoice_date}</td>
                  <td>{r.customer_name}</td>
                  <td>{numFmt(invoiceTotal(r.items))}</td>
                  <td>
                    {tab === 'pending' ? (
                      <button className="btn btn-sm btn-success" disabled={busyId === r.id} onClick={() => approve(r)}>
                        {busyId === r.id ? 'Memproses...' : <><Icon name="check" size={12} /> Approve</>}
                      </button>
                    ) : (
                      <button className="btn btn-sm btn-danger" disabled={busyId === r.id} onClick={() => unapprove(r)}>
                        {busyId === r.id ? 'Memproses...' : 'Batalkan Approval'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
