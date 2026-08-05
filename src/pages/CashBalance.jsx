import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import Icon from '../icons.jsx'
import Portal from '../Portal.jsx'
import Pagination from '../Pagination.jsx'
import { printCashTopupSlip } from '../slip.js'
import { useEscapeToClose } from '../hooks/useEscapeToClose.js'
import { rupiah, generateTopupNo, formatThousands, stripThousands } from '../lib/helpers.js'

// ---------------------------------------------------------------- SALDO KAS (TOP-UP) ----
// Hanya untuk user department "Finance" (role apa pun) atau admin — dijaga di
// level UI (nav item disembunyikan) DAN di level database (RLS policy
// "cash_topups_select_finance" / "..._insert_finance"), jadi tetap aman
// walau seseorang mencoba akses langsung lewat API.
// Halaman ini HANYA untuk mengisi ulang (top-up) saldo kas kecil. Riwayat
// transaksi lengkap + filter + export ada di halaman terpisah
// "Laporan Arus Kas" (lihat CashFlowReport.jsx) supaya menu ini tetap fokus
// untuk aksi submit/isi ulang saja.
export default function CashBalance({ profile, refreshKey, onActed }) {
  const [topups, setTopups] = useState([])
  const [disbursements, setDisbursements] = useState([]) // dipakai untuk hitung saldo berjalan saja
  const [profilesById, setProfilesById] = useState({}) // id -> {full_name, signature_url}, untuk kolom "Diinput Oleh" & cetak slip
  const [loadingData, setLoadingData] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [amount, setAmount] = useState('')
  const [topupDate, setTopupDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  useEscapeToClose(() => setShowConfirm(false), showConfirm)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const load = useCallback(async () => {
    setLoadingData(true)
    setLoadError('')

    try {
      const [topupRes, disbRes] = await Promise.all([
        supabase.from('cash_topups').select('*'),
        supabase
          .from('approval_history')
          .select('id, reimbursement_id, reimbursements(total_amount, status)')
          .eq('action', 'verified'),
      ])

      if (topupRes.error) { setLoadError(topupRes.error.message); return }
      if (disbRes.error) { console.error('Gagal memuat riwayat pencairan:', disbRes.error.message) }

      setTopups(topupRes.data || [])
      setDisbursements((disbRes.data || []).filter((d) => d.reimbursements))

      // Ambil nama & tanda tangan digital user yang menginput pengisian kas —
      // dipakai di kolom "Diinput Oleh" pada tabel riwayat, sekaligus untuk
      // mengisi kolom tanda tangan saat tombol "Cetak Slip" per baris ditekan.
      const ids = [...new Set((topupRes.data || []).map((t) => t.created_by).filter(Boolean))]
      if (ids.length) {
        const { data: profs, error: profErr } = await supabase.from('profiles').select('id, full_name, signature_url').in('id', ids)
        if (profErr) {
          console.error('Gagal memuat profil:', profErr.message)
        } else {
          const map = {}
          ;(profs || []).forEach((p) => { map[p.id] = p })
          setProfilesById(map)
        }
      }
    } catch (err) {
      console.error('Gagal memuat data saldo kas:', err)
      setLoadError(err?.message || 'Terjadi kesalahan tak terduga saat memuat data.')
    } finally {
      setLoadingData(false)
    }
  }, [])

  useEffect(() => { load() }, [load, refreshKey])

  // Riwayat pengisian kas, urut terbaru dulu untuk ditampilkan di tabel.
  const topupHistory = useMemo(() => {
    return [...topups].sort((a, b) => {
      const ta = new Date(a.topup_date + 'T00:00:00').getTime()
      const tb = new Date(b.topup_date + 'T00:00:00').getTime()
      if (tb !== ta) return tb - ta
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    })
  }, [topups])

  useEffect(() => { setPage(1) }, [topups.length])
  const totalPages = Math.max(1, Math.ceil(topupHistory.length / pageSize))
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [totalPages, page])
  const pageTopups = useMemo(() => {
    const start = (page - 1) * pageSize
    return topupHistory.slice(start, start + pageSize)
  }, [topupHistory, page, pageSize])

  // Cetak slip untuk SATU baris pengisian kas (bukan export gabungan) —
  // memakai tema hijau "KAS MASUK" dari slip.js supaya langsung kelihatan
  // beda dari slip reimbursement (uang keluar) saat dicetak/diarsipkan.
  function handlePrintTopup(t) {
    const creator = profilesById[t.created_by]
    printCashTopupSlip(t, creator?.full_name, creator?.signature_url, false)
  }

  const totalTopup = topups.reduce((s, t) => s + Number(t.amount), 0)
  const verifiedTotal = disbursements.reduce((s, d) => s + Number(d.reimbursements?.total_amount || 0), 0)
  const saldo = totalTopup - verifiedTotal

  function handleSubmit(e) {
    e.preventDefault()
    setSaveError('')
    const amt = Number(amount)
    if (!amt || amt <= 0) { setSaveError('Nominal harus lebih dari 0.'); return }
    setShowConfirm(true)
  }

  async function confirmTopup() {
    setSaving(true)
    const { error } = await supabase.from('cash_topups').insert({
      amount: Number(amount),
      topup_date: topupDate,
      note: note || null,
      created_by: profile.id,
      topup_no: generateTopupNo(),
    })
    setSaving(false)
    setShowConfirm(false)
    if (error) { setSaveError('Gagal menyimpan: ' + error.message); return }

    setAmount(''); setNote('')
    setTopupDate(new Date().toISOString().slice(0, 10))
    load()
    onActed && onActed()
  }

  return (
    <>
      <div className="grid-kpi">
        {loadingData ? Array(3).fill(0).map((_, i) => (
          <div className="kpi-box" key={i}>
            <div className="skeleton-row short" style={{ marginBottom: 8 }} />
            <div className="skeleton-row medium" style={{ height: 28 }} />
          </div>
        )) : <>
          <div className="kpi-box">
            <div className="label">Saldo Kas Saat Ini</div>
            <div className="value" style={{ color: saldo < 0 ? 'var(--danger)' : undefined }}>{rupiah(saldo)}</div>
          </div>
          <div className="kpi-box"><div className="label">Total Kas Masuk (Topup)</div><div className="value">{rupiah(totalTopup)}</div></div>
          <div className="kpi-box"><div className="label">Total Sudah Dicairkan</div><div className="value">{rupiah(verifiedTotal)}</div></div>
        </>}
      </div>

      {saldo < 0 && !loadingData && (
        <div className="empty-state" style={{ color: 'var(--danger)', marginBottom: 16 }}>
          Saldo kas minus. Pengeluaran yang sudah terverifikasi melebihi total kas masuk yang tercatat — segera isi ulang saldo kas.
        </div>
      )}

      {loadError && <div className="empty-state" style={{ color: 'var(--danger)' }}>Gagal memuat data: {loadError}</div>}

      <div className="card" style={{ maxWidth: 480, marginBottom: 20 }}>
        <h3>Isi Ulang Saldo Kas</h3>
        <form onSubmit={handleSubmit}>
          <label>Nominal (Rp)</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="cth. 5.000.000"
            value={formatThousands(amount)}
            onChange={(e) => setAmount(stripThousands(e.target.value))}
            required
          />
          <label>Tanggal</label>
          <input type="date" value={topupDate} onChange={(e) => setTopupDate(e.target.value)} required />
          <label>Catatan (opsional)</label>
          <input
            type="text"
            placeholder="cth. Transfer dari rekening perusahaan"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {saveError && <div className="empty-state" style={{ color: 'var(--danger)' }}>{saveError}</div>}
          <button className="btn btn-success" type="submit" style={{ marginTop: 10 }}>
            Tambah Saldo
          </button>
        </form>
      </div>

      {/* ---- Tabel Riwayat Pengisian Kas ---- */}
      <div className="card">
        <h3>Riwayat Pengisian Kas ({topupHistory.length})</h3>
        <div className="bulk-bar" style={{ marginBottom: 14 }}>
          <span className="bulk-count">Total Pengisian: {rupiah(totalTopup)}</span>
        </div>

        {loadError && <div className="empty-state" style={{ color: 'var(--danger)' }}>Gagal memuat data: {loadError}</div>}
        {topupHistory.length === 0 && !loadError ? (
          <div className="empty-state">Belum ada riwayat pengisian kas.</div>
        ) : (
          <div className="table-scroll">
          <table>
            <thead>
              <tr><th>No. Pengisian</th><th>Tanggal</th><th style={{ textAlign: 'right' }}>Nominal</th><th>Catatan</th><th>Diinput Oleh</th><th>Aksi</th></tr>
            </thead>
            <tbody>
              {pageTopups.map((t) => (
                <tr key={t.id}>
                  <td>{t.topup_no || '—'}</td>
                  <td>{t.topup_date}</td>
                  <td style={{ textAlign: 'right', color: '#1f8a4c', fontWeight: 700 }}>{rupiah(Number(t.amount) || 0)}</td>
                  <td>{t.note || '—'}</td>
                  <td>{profilesById[t.created_by]?.full_name || '—'}</td>
                  <td>
                    <button className="btn btn-sm" style={{ background: '#1f8a4c', color: '#fff', display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={() => handlePrintTopup(t)}>
                      <Icon name="printer" size={13} /> Cetak Slip
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}

        {topupHistory.length > 0 && (
          <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={topupHistory.length} />
        )}
      </div>

      {/* ---- Pop-up konfirmasi isi ulang saldo kas ---- */}
      {showConfirm && (
        <Portal>
        <div className="modal-overlay" onClick={() => !saving && setShowConfirm(false)}>
          <div className="modal-box confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon" style={{ color: '#1f8a4c' }}><Icon name="wallet" size={30} /></div>
            <h3 className="confirm-title">Konfirmasi Isi Ulang Saldo Kas</h3>
            <p className="confirm-desc">Pastikan data di bawah ini sudah benar sebelum disimpan.</p>

            <div className="confirm-detail">
              <div className="confirm-row"><span>Nominal</span><strong>{rupiah(Number(amount) || 0)}</strong></div>
              <div className="confirm-row"><span>Tanggal</span><strong>{topupDate}</strong></div>
              <div className="confirm-row"><span>Catatan</span><strong>{note || '—'}</strong></div>
            </div>

            <div className="confirm-actions">
              <button className="btn btn-neutral" style={{ flex: 1 }} onClick={() => setShowConfirm(false)} disabled={saving}>
                Batal
              </button>
              <button className="btn" style={{ background: '#1f8a4c', color: '#fff', flex: 1 }} onClick={confirmTopup} disabled={saving}>
                {saving ? <><span className="spinner" />Menyimpan...</> : 'Ya, Tambah Saldo'}
              </button>
            </div>
          </div>
        </div>
      </Portal>
      )}
    </>
  )
}
