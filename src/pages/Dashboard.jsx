import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import Icon from '../icons.jsx'
import Pagination from '../Pagination.jsx'
import { printSlip as printSlipShared, printBulkSlips as printBulkSlipsShared } from '../slip.js'
import { MonthlyBarChart, CategoryDonutChart } from '../Charts.jsx'
import SimpleAlertModal from '../components/SimpleAlertModal.jsx'
import SkeletonTable from '../components/SkeletonTable.jsx'
import { CATEGORIES, STATUS_LABEL } from '../lib/constants.js'
import { rupiah, isFinanceUser, statusLabelFor } from '../lib/helpers.js'

// ---------------------------------------------------------------- DASHBOARD ----
export default function Dashboard({ refreshKey, profile }) {
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
