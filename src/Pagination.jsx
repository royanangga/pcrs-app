import React from 'react'

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

// Footer navigasi halaman: dropdown "tampilkan X per halaman" + info total data + tombol next/prev.
// Dipakai di Admin Panel (User/Transaksi/Riwayat) dan di Dashboard.
export default function Pagination({ page, setPage, pageSize, setPageSize, total }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1
  const end = Math.min(safePage * pageSize, total)

  return (
    <div className="pagination-bar">
      <div className="pagination-info">
        Menampilkan <strong>{start}-{end}</strong> dari <strong>{total}</strong> data
      </div>
      <div className="pagination-controls">
        <label className="pagination-size">
          Tampilkan
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}
          >
            {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          / halaman
        </label>
        <div className="pagination-nav">
          <button className="btn btn-sm" disabled={safePage <= 1} onClick={() => setPage(1)}>«</button>
          <button className="btn btn-sm" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</button>
          <span className="pagination-page">Hal {safePage} / {totalPages}</span>
          <button className="btn btn-sm" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>›</button>
          <button className="btn btn-sm" disabled={safePage >= totalPages} onClick={() => setPage(totalPages)}>»</button>
        </div>
      </div>
    </div>
  )
}
