import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import Icon from '../icons.jsx'
import Pagination from '../Pagination.jsx'
import SimpleAlertModal from '../components/SimpleAlertModal.jsx'
import { rupiah } from '../lib/helpers.js'

// ---------------------------------------------------------------- LAPORAN ARUS KAS ----
export default function CashFlowReport({ profile, refreshKey }) {
  const [topups, setTopups] = useState([])
  const [disbursements, setDisbursements] = useState([]) // approval_history rows (action='verified') + joined reimbursement info
  const [loadingData, setLoadingData] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [names, setNames] = useState({})

  const [filterType, setFilterType] = useState('all') // all | in | out
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [exportingExcel, setExportingExcel] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [alertMsg, setAlertMsg] = useState('')
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
          .select('id, created_at, disbursed_date, reimbursement_id, reimbursements(request_no, employee_id, total_amount, status)')
          .eq('action', 'verified'),
      ])

      if (topupRes.error) { setLoadError(topupRes.error.message); return }
      if (disbRes.error) { console.error('Gagal memuat riwayat pencairan:', disbRes.error.message) }

      setTopups(topupRes.data || [])
      setDisbursements((disbRes.data || []).filter((d) => d.reimbursements))

      const idSet = new Set()
      ;(topupRes.data || []).forEach((t) => t.created_by && idSet.add(t.created_by))
      ;(disbRes.data || []).forEach((d) => d.reimbursements?.employee_id && idSet.add(d.reimbursements.employee_id))
      const ids = [...idSet]
      if (ids.length) {
        const { data: profs, error: profErr } = await supabase.from('profiles').select('id, full_name').in('id', ids)
        if (profErr) {
          console.error('Gagal memuat nama:', profErr.message)
        } else {
          const map = {}
          ;(profs || []).forEach((p) => { map[p.id] = p.full_name })
          setNames(map)
        }
      }
    } catch (err) {
      console.error('Gagal memuat data laporan arus kas:', err)
      setLoadError(err?.message || 'Terjadi kesalahan tak terduga saat memuat data.')
    } finally {
      setLoadingData(false)
    }
  }, [])

  useEffect(() => { load() }, [load, refreshKey])

  // Gabungkan kas masuk (topup) & kas keluar (reimbursement yang sudah
  // dicairkan/verified) jadi satu buku arus kas, urut tanggal naik, dengan
  // saldo berjalan (running balance) yang dihitung dari SELURUH riwayat —
  // supaya saldo tetap akurat walau tabel sedang difilter per periode.
  //
  // PENTING soal tanggal: `topup_date` adalah kolom date murni (tanpa jam),
  // sedangkan tanggal verifikasi reimbursement diambil dari `created_at`
  // (timestamptz, tersimpan dalam UTC). Kalau tanggal UTC itu langsung
  // dipotong mentah-mentah (mis. `.slice(0,10)`), transaksi yang terjadi
  // dini hari WIB bisa "geser" tampil mundur sehari dibanding tanggal lokal
  // sebenarnya — laporan jadi kelihatan tidak urut. Di bawah ini semua
  // tanggal dikonversi dulu ke tanggal LOKAL (zona waktu browser/WIB)
  // sebelum dipakai untuk ditampilkan maupun diurutkan, dan transaksi di
  // hari yang sama diurutkan lagi berdasarkan jam pastinya (sortTie).
  const fullLedger = useMemo(() => {
    const localDateOnly = (iso) => {
      const d = new Date(iso)
      const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0')
      return `${y}-${m}-${day}`
    }

    const inEntries = topups.map((t) => {
      const dayTs = new Date(t.topup_date + 'T00:00:00').getTime()
      return {
        id: 'in-' + t.id,
        date: t.topup_date,
        sortTs: dayTs,
        sortTie: t.created_at ? new Date(t.created_at).getTime() : dayTs,
        type: 'in',
        description: t.note || 'Isi ulang kas',
        ref: t.topup_no || '—',
        person: names[t.created_by] || '—',
        amount: Number(t.amount) || 0,
      }
    })
    const outEntries = disbursements.map((d) => {
      // Utamakan `disbursed_date` (tanggal aktual dana dicairkan, diisi
      // manual oleh Finance saat verifikasi). Fallback ke `created_at`
      // hanya untuk data lama (sebelum field ini ada).
      const localDate = d.disbursed_date || localDateOnly(d.created_at)
      return {
        id: 'out-' + d.id,
        date: localDate,
        sortTs: new Date(localDate + 'T00:00:00').getTime(),
        sortTie: new Date(d.created_at).getTime(),
        type: 'out',
        description: `Pencairan Reimbursement ${d.reimbursements?.request_no || ''}`,
        ref: d.reimbursements?.request_no || '—',
        person: names[d.reimbursements?.employee_id] || '—',
        amount: Number(d.reimbursements?.total_amount) || 0,
      }
    })
    const merged = [...inEntries, ...outEntries].sort((a, b) => (a.sortTs - b.sortTs) || (a.sortTie - b.sortTie))
    let running = 0
    return merged.map((e) => {
      running += e.type === 'in' ? e.amount : -e.amount
      return { ...e, balance: running }
    })
  }, [topups, disbursements, names])

  const totalTopup = topups.reduce((s, t) => s + Number(t.amount), 0)
  const verifiedTotal = disbursements.reduce((s, d) => s + Number(d.reimbursements?.total_amount || 0), 0)
  const saldo = totalTopup - verifiedTotal

  // Baris yang lolos filter periode & tipe, TAPI saldo berjalan yang
  // ditampilkan tetap dari fullLedger (bukan dihitung ulang dari 0), supaya
  // laporan tetap benar meski sedang difilter.
  const filteredLedger = useMemo(() => {
    return fullLedger.filter((e) => {
      if (filterType !== 'all' && e.type !== filterType) return false
      if (dateFrom && e.date < dateFrom) return false
      if (dateTo && e.date > dateTo) return false
      return true
    }).sort((a, b) => (b.sortTs - a.sortTs) || (b.sortTie - a.sortTie)) // tampilan: terbaru dulu
  }, [fullLedger, filterType, dateFrom, dateTo])

  const periodMasuk = filteredLedger.filter((e) => e.type === 'in').reduce((s, e) => s + e.amount, 0)
  const periodKeluar = filteredLedger.filter((e) => e.type === 'out').reduce((s, e) => s + e.amount, 0)
  const hasActiveFilter = filterType !== 'all' || dateFrom || dateTo

  useEffect(() => { setPage(1) }, [filterType, dateFrom, dateTo])

  const totalPages = Math.max(1, Math.ceil(filteredLedger.length / pageSize))
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [totalPages, page])

  // Halaman yang sedang ditampilkan di tabel. Export Excel/PDF tetap pakai
  // `filteredLedger` (SELURUH data yang lolos filter), bukan `pageLedger` —
  // supaya export tidak ikut kepotong ke satu halaman saja.
  const pageLedger = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredLedger.slice(start, start + pageSize)
  }, [filteredLedger, page, pageSize])

  function resetFilters() { setFilterType('all'); setDateFrom(''); setDateTo('') }

  // ---- Export Excel: laporan arus kas (baris yang sedang tampil / sudah difilter) ----
  async function handleExportExcel() {
    if (filteredLedger.length === 0) return
    setExportingExcel(true)
    try {
      const { default: ExcelJS } = await import('exceljs')
      const wb = new ExcelJS.Workbook()
      wb.creator = 'PCRS App'
      wb.created = new Date()

      const ws = wb.addWorksheet('Laporan Arus Kas', { views: [{ state: 'frozen', ySplit: 4, showGridLines: false }] })
      ws.columns = [{ width: 5 }, { width: 14 }, { width: 34 }, { width: 16 }, { width: 22 }, { width: 18 }, { width: 18 }, { width: 18 }]

      ws.mergeCells('A1:H1')
      ws.getCell('A1').value = 'Laporan Arus Kas Kecil'
      ws.getCell('A1').font = { size: 16, bold: true, color: { argb: 'FF14213D' } }

      ws.mergeCells('A2:H2')
      ws.getCell('A2').value = `Diekspor: ${new Date().toLocaleString('id-ID')}   |   Periode: ${dateFrom || 'Awal'} s/d ${dateTo || 'Sekarang'}   |   ${filteredLedger.length} transaksi`
      ws.getCell('A2').font = { size: 10, italic: true, color: { argb: 'FF666666' } }

      const headers = ['No', 'Tanggal', 'Keterangan', 'No. Ref', 'Terkait', 'Kas Masuk', 'Kas Keluar', 'Saldo']
      const headerRow = ws.getRow(4)
      headers.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1)
        cell.value = h
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14213D' } }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
      })
      headerRow.height = 22

      // tampilkan urut tanggal naik di file excel supaya enak dibaca sebagai laporan
      const rowsAsc = [...filteredLedger].sort((a, b) => (a.sortTs - b.sortTs) || (a.sortTie - b.sortTie))
      rowsAsc.forEach((e, idx) => {
        const row = ws.getRow(5 + idx)
        row.getCell(1).value = idx + 1
        row.getCell(2).value = e.date
        row.getCell(3).value = e.description
        row.getCell(4).value = e.ref
        row.getCell(5).value = e.person
        row.getCell(6).value = e.type === 'in' ? e.amount : null
        row.getCell(7).value = e.type === 'out' ? e.amount : null
        row.getCell(8).value = e.balance
        row.getCell(6).numFmt = '"Rp" #,##0'
        row.getCell(7).numFmt = '"Rp" #,##0'
        row.getCell(8).numFmt = '"Rp" #,##0'
        const isEven = idx % 2 === 0
        for (let c = 1; c <= 8; c++) {
          const cell = row.getCell(c)
          cell.alignment = { vertical: 'middle', horizontal: c === 1 ? 'center' : (c >= 6 ? 'right' : 'left') }
          if (isEven) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F8FA' } }
        }
      })

      const totalRowIdx = 5 + rowsAsc.length
      const totalRow = ws.getRow(totalRowIdx)
      ws.mergeCells(`A${totalRowIdx}:E${totalRowIdx}`)
      totalRow.getCell(1).value = 'Total Periode Ini'
      totalRow.getCell(1).font = { bold: true }
      totalRow.getCell(1).alignment = { horizontal: 'right' }
      totalRow.getCell(6).value = periodMasuk
      totalRow.getCell(7).value = periodKeluar
      totalRow.getCell(8).value = rowsAsc.length ? rowsAsc[rowsAsc.length - 1].balance : saldo
      ;[6, 7, 8].forEach((c) => { totalRow.getCell(c).numFmt = '"Rp" #,##0'; totalRow.getCell(c).font = { bold: true } })
      for (let c = 1; c <= 8; c++) totalRow.getCell(c).border = { top: { style: 'double', color: { argb: 'FF14213D' } } }

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Laporan_Arus_Kas_${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
      setAlertMsg('Gagal membuat file Excel. Silakan coba lagi.')
    } finally {
      setExportingExcel(false)
    }
  }

  // ---- Export PDF: buka jendela print berisi tabel laporan, lalu user
  // pilih "Save as PDF" di dialog print browser (pola yang sama dipakai
  // untuk cetak slip reimbursement di slip.js). ----
  function handleExportPdf() {
    if (filteredLedger.length === 0) return
    setExportingPdf(true)
    const rowsAsc = [...filteredLedger].sort((a, b) => (a.sortTs - b.sortTs) || (a.sortTie - b.sortTie))
    const rowsHtml = rowsAsc.map((e, idx) => `
      <tr>
        <td style="text-align:center">${idx + 1}</td>
        <td>${e.date}</td>
        <td>${e.description}</td>
        <td>${e.ref}</td>
        <td>${e.person}</td>
        <td style="text-align:right;color:#1f8a4c">${e.type === 'in' ? rupiah(e.amount) : ''}</td>
        <td style="text-align:right;color:#b3261e">${e.type === 'out' ? rupiah(e.amount) : ''}</td>
        <td style="text-align:right;font-weight:700">${rupiah(e.balance)}</td>
      </tr>`).join('')

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Laporan Arus Kas</title>
    <style>
      * { box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; }
      body { margin: 24px; color: #14213d; }
      h1 { font-size: 18px; margin: 0 0 4px; }
      .sub { font-size: 11px; color: #666; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; }
      thead th { background: #14213d; color: #fff; padding: 6px 8px; font-size: 10px; text-transform: uppercase; text-align: left; }
      tbody td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px; }
      tfoot td { padding: 8px; font-size: 12px; font-weight: 700; border-top: 2px solid #14213d; }
      @media print { @page { margin: 15mm; size: landscape; } }
    </style></head><body>
      <h1>Laporan Arus Kas Kecil</h1>
      <div class="sub">Diekspor: ${new Date().toLocaleString('id-ID')} &nbsp;|&nbsp; Periode: ${dateFrom || 'Awal'} s/d ${dateTo || 'Sekarang'} &nbsp;|&nbsp; ${rowsAsc.length} transaksi</div>
      <table>
        <thead><tr><th>No</th><th>Tanggal</th><th>Keterangan</th><th>No. Ref</th><th>Terkait</th><th>Kas Masuk</th><th>Kas Keluar</th><th>Saldo</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot><tr>
          <td colspan="5" style="text-align:right">Total Periode Ini</td>
          <td style="text-align:right;color:#1f8a4c">${rupiah(periodMasuk)}</td>
          <td style="text-align:right;color:#b3261e">${rupiah(periodKeluar)}</td>
          <td style="text-align:right">${rupiah(rowsAsc.length ? rowsAsc[rowsAsc.length - 1].balance : saldo)}</td>
        </tr></tfoot>
      </table>
      <script>
        window.onload = () => { window.print(); }
      </script>
    </body></html>`

    const w = window.open('', '_blank', 'width=1000,height=700')
    w.document.write(html)
    w.document.close()
    setExportingPdf(false)
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

      {/* ---- Filter Laporan Arus Kas ---- */}
      <div className="filter-panel">
        <div className="filter-panel-head">
          <div className="filter-title"><span className="filter-icon"><Icon name="filter" size={13} /></span> Filter Laporan</div>
          {hasActiveFilter && <span className="filter-clear-all" onClick={resetFilters}>Hapus semua filter</span>}
        </div>
        <div className="filter-grid">
          <div className="filter-field">
            <label><span className="f-ico">●</span> Jenis Transaksi</label>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="all">Semua Transaksi</option>
              <option value="in">Kas Masuk</option>
              <option value="out">Kas Keluar</option>
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
        {hasActiveFilter && (
          <div className="chip-row">
            {filterType !== 'all' && <span className="chip">{filterType === 'in' ? 'Kas Masuk' : 'Kas Keluar'}<span className="chip-x" onClick={() => setFilterType('all')}><Icon name="x" size={10} /></span></span>}
            {dateFrom && <span className="chip">Dari {dateFrom}<span className="chip-x" onClick={() => setDateFrom('')}><Icon name="x" size={10} /></span></span>}
            {dateTo && <span className="chip">Sampai {dateTo}<span className="chip-x" onClick={() => setDateTo('')}><Icon name="x" size={10} /></span></span>}
          </div>
        )}
      </div>

      <div className="card">
        <h3>Laporan Arus Kas ({filteredLedger.length} transaksi)</h3>

        <div className="bulk-bar" style={{ marginBottom: 14 }}>
          <span className="bulk-count">Kas Masuk: {rupiah(periodMasuk)} &nbsp;|&nbsp; Kas Keluar: {rupiah(periodKeluar)}</span>
          <div className="bulk-actions">
            <button
              className="btn btn-sm"
              style={{ background: '#0f6e6e', color: '#fff', display: 'inline-flex', alignItems: 'center', gap: 5 }}
              disabled={exportingExcel || filteredLedger.length === 0}
              onClick={handleExportExcel}
            >
              {exportingExcel ? <><span className="spinner" />Menyiapkan...</> : <><Icon name="barChart" size={13} /> Export Excel</>}
            </button>
            <button
              className="btn btn-sm"
              style={{ background: '#14213d', color: '#fff', display: 'inline-flex', alignItems: 'center', gap: 5 }}
              disabled={exportingPdf || filteredLedger.length === 0}
              onClick={handleExportPdf}
            >
              {exportingPdf ? <><span className="spinner" />Menyiapkan...</> : <><Icon name="printer" size={13} /> Export PDF</>}
            </button>
          </div>
        </div>

        {loadError && <div className="empty-state" style={{ color: 'var(--danger)' }}>Gagal memuat data: {loadError}</div>}
        {filteredLedger.length === 0 && !loadError ? (
          <div className="empty-state">Tidak ada transaksi yang cocok dengan filter.</div>
        ) : (
          <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Tanggal</th><th>Keterangan</th><th>No. Ref</th><th>Terkait</th><th>Kas Masuk</th><th>Kas Keluar</th><th>Saldo</th></tr>
            </thead>
            <tbody>
              {pageLedger.map((e) => (
                <tr key={e.id}>
                  <td>{e.date}</td>
                  <td>{e.description}</td>
                  <td>{e.ref}</td>
                  <td>{e.person}</td>
                  <td style={{ color: '#1f8a4c', textAlign: 'right' }}>{e.type === 'in' ? rupiah(e.amount) : ''}</td>
                  <td style={{ color: '#b3261e', textAlign: 'right' }}>{e.type === 'out' ? rupiah(e.amount) : ''}</td>
                  <td style={{ fontWeight: 700, textAlign: 'right' }}>{rupiah(e.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}

        {filteredLedger.length > 0 && (
          <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={filteredLedger.length} />
        )}
      </div>
      {alertMsg && <SimpleAlertModal text={alertMsg} onClose={() => setAlertMsg('')} />}
    </>
  )
}
