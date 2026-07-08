import QRCode from 'qrcode'

// Label aksi untuk baris riwayat approval (approval_history.action) — dipakai
// di slip cetak untuk menampilkan riwayat approval sampai verified.
export const ACTION_LABEL = {
  submitted: 'Diajukan',
  approved: 'Disetujui',
  finance_approved: 'Disetujui Finance Manager',
  verified: 'Diverifikasi & Dicairkan',
  rejected: 'Ditolak',
  revision: 'Diminta Revisi',
}

export const ROLE_LABEL = {
  employee: 'Employee',
  supervisor: 'Supervisor',
  manager: 'Manager',
  admin: 'Admin',
}

export function trackUrl(requestNo) {
  return `${window.location.origin}/track/${encodeURIComponent(requestNo)}`
}

// Bangun isi (body) satu slip dari data pengajuan + item + riwayat approval.
// Fungsi murni (tidak bergantung pada state komponen manapun) supaya bisa
// dipakai baik dari Dashboard (App.jsx) maupun dari halaman Tracking publik.
export function buildSlipBody(r, items, history, qrDataUrl) {
  const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID')

  // Ekstrak nama dari history berdasarkan role & urutan
  const hist = history || []
  const employeeName   = r.profiles?.full_name || '—'
  const submittedRow   = hist.find((h) => h.action === 'submitted')
  const supervisorRow  = hist.find((h) => h.action === 'approved' && h.profiles?.role === 'supervisor')
  const managerRow     = hist.find((h) => h.action === 'approved' && h.profiles?.role === 'manager')
  const financeMgrRow  = hist.find((h) => h.action === 'finance_approved')
  const verifierRow    = hist.find((h) => h.action === 'verified')

  // Format tanggal singkat (tanpa jam) untuk ditampilkan di bawah tiap kolom
  // tanda tangan — dipakai sebagai pengganti tabel "Riwayat Approval".
  const fmtDate = (iso) => iso
    ? new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
    : null

  const supervisorName  = supervisorRow?.profiles?.full_name  || null
  const managerName     = managerRow?.profiles?.full_name     || null
  const financeMgrName  = financeMgrRow?.profiles?.full_name  || null
  const verifierName    = verifierRow?.profiles?.full_name    || null

  const employeeSig     = r.profiles?.signature_url           || null
  const supervisorSig   = supervisorRow?.profiles?.signature_url || null
  const managerSig      = managerRow?.profiles?.signature_url    || null
  const financeMgrSig   = financeMgrRow?.profiles?.signature_url || null
  const verifierSig     = verifierRow?.profiles?.signature_url   || null

  const itemRows = (items || []).map((it, i) => `
      <tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${it.expense_date}</td>
        <td>${it.category}</td>
        <td>${it.description || '—'}</td>
        <td style="text-align:right">${rp(it.amount)}</td>
      </tr>`).join('')

  // Kolom tanda tangan dinamis. Kalau orangnya sudah menyimpan tanda tangan digital,
  // gambar itu otomatis dipasang di atas nama (tidak perlu tanda tangan basah lagi).
  // Tanggal aksi (approval/verifikasi) ditampilkan langsung di bawah kolom
  // tanda tangan masing-masing — menggantikan tabel "Riwayat Approval" yang
  // sebelumnya ditampilkan terpisah.
  const signBox = (label, role, name, sigUrl, actionLabel, dateStr) => `
      <div class="sign-box">
        <div class="sign-space">
          ${sigUrl ? `<img class="sign-img" src="${sigUrl}"/>` : ''}
        </div>
        <div class="sign-printed-name">${name || '\u00A0'}</div>
        <div class="sign-name">${label}</div>
        <div class="sign-role">(${role})</div>
        <div class="sign-date">${dateStr ? `${actionLabel}: ${dateStr}` : '\u00A0'}</div>
      </div>`

  // Hanya tampilkan kolom tanda tangan untuk tahap yang BENAR-BENAR dilalui
  // pengajuan ini (ada baris di approval_history-nya). Pembuat pengajuan
  // selalu ditampilkan; tahap lain (Supervisor/Manager/Finance Manager/
  // Verifikasi) hanya muncul kalau memang ada orang yang approve di tahap
  // itu — jadi tahap yang di-skip (mis. pengaju Supervisor yang approval
  // dirinya sendiri di-skip, atau pengaju Manager/Admin yang tanpa approval
  // departemen) tidak menampilkan kolom tanda tangan kosong yang tidak relevan.
  const signCols = [
    signBox('Pembuat Pengajuan', 'Employee', employeeName, employeeSig, 'Diajukan', fmtDate(submittedRow?.created_at) || r.request_date),
    ...(supervisorRow ? [signBox('Menyetujui Tahap 1', 'Supervisor', supervisorName, supervisorSig, 'Disetujui', fmtDate(supervisorRow.created_at))] : []),
    ...(managerRow    ? [signBox('Menyetujui Tahap 2', 'Manager', managerName, managerSig, 'Disetujui', fmtDate(managerRow.created_at))] : []),
    ...(financeMgrRow ? [signBox('Approval Finance Manager', 'Finance Manager', financeMgrName, financeMgrSig, 'Disetujui', fmtDate(financeMgrRow.created_at))] : []),
    ...(verifierRow   ? [signBox('Verifikasi Pencairan', 'Finance', verifierName, verifierSig, 'Dicairkan', fmtDate(verifierRow.created_at))] : []),
  ].join('')

  const printDate = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })

  return `
<div class="header">
  <div>
    <div class="brand">PCRS <span>•</span> Petty Cash</div>
    <div style="font-size:10px;color:#888;margin-top:2px">Petty Cash Reimbursement System</div>
  </div>
  <div class="doc-label">
    <div class="title">Slip Reimbursement</div>
    <div class="no">${r.request_no}</div>
  </div>
</div>

<hr class="thick"/>

<div style="overflow:hidden;margin-bottom:8px">
  <div class="sah">✓ DOKUMEN SAH</div>
  <div class="info-row">
    <div class="info-col"><div class="lbl">Nama Karyawan</div><div class="val">${employeeName}</div></div>
    <div class="info-col"><div class="lbl">Department</div><div class="val">${r.profiles?.department || '—'}</div></div>
    <div class="info-col"><div class="lbl">Tanggal Pengajuan</div><div class="val">${r.request_date}</div></div>
    <div class="info-col"><div class="lbl">Tanggal Cetak</div><div class="val">${printDate}</div></div>
  </div>
</div>

<hr class="thin"/>

<table>
  <thead>
    <tr>
      <th style="width:28px;text-align:center">No</th>
      <th style="width:88px">Tanggal</th>
      <th style="width:100px">Kategori</th>
      <th>Keterangan</th>
      <th style="width:110px;text-align:right">Nominal</th>
    </tr>
  </thead>
  <tbody>
    ${itemRows}
    <tr class="total-row">
      <td colspan="4" style="padding:6px 8px">TOTAL</td>
      <td style="text-align:right;padding:6px 8px">${rp(r.total_amount)}</td>
    </tr>
  </tbody>
</table>

<div class="bottom">
  <div class="qr-wrap">
    <img src="${qrDataUrl}" width="100" height="100"/>
    <p>Scan untuk verifikasi</p>
  </div>
  <div class="signs">${signCols}</div>
</div>

<div class="footer">
  Dicetak otomatis oleh PCRS &nbsp;•&nbsp; ${r.request_no} &nbsp;•&nbsp; ${new Date().toLocaleString('id-ID')}
</div>`
}

// Bungkus 1 atau banyak slip jadi satu dokumen HTML siap print/simpan PDF.
// Setiap slip ditaruh di halaman terpisah (page-break-after) supaya rapi saat dicetak sekaligus.
export function wrapSlipsHtml(bodies, savePdf, docTitle) {
  return `<!DOCTYPE html>
<html lang="id"><head>
<meta charset="UTF-8"/>
<title>${docTitle}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #111; }

  .slip-page { padding: 28px 32px; page-break-after: always; }
  .slip-page:last-child { page-break-after: auto; }

  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .brand { font-size: 20px; font-weight: 900; color: #14213d; }
  .brand span { color: #0f6e6e; }
  .doc-label { text-align: right; }
  .doc-label .title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #14213d; }
  .doc-label .no { font-size: 15px; font-weight: 900; color: #0f6e6e; }
  hr.thick { border: none; border-top: 2.5px solid #14213d; margin: 10px 0; }
  hr.thin  { border: none; border-top: 1px solid #ccc; margin: 10px 0; }

  .sah { display: inline-block; border: 2.5px solid #1f8a4c; color: #1f8a4c; font-size: 13px;
    font-weight: 900; padding: 3px 14px; border-radius: 4px; letter-spacing: 2px;
    transform: rotate(-4deg); float: right; margin-top: -4px; }

  .info-row { display: flex; gap: 0; margin: 8px 0 12px; }
  .info-col { flex: 1; }
  .info-col .lbl { font-size: 10px; color: #666; font-weight: 700; text-transform: uppercase; }
  .info-col .val { font-size: 12px; font-weight: 600; margin-top: 1px; }

  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  thead th { background: #14213d; color: #fff; padding: 6px 8px; font-size: 10px; text-transform: uppercase; text-align: left; }
  tbody td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px; }
  .total-row td { font-weight: 700; font-size: 12px; background: #e6f3f3; border-top: 2px solid #14213d; }

  .bottom { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 20px; padding-top: 14px; border-top: 1px solid #e3e6ea; }
  .qr-wrap { text-align: center; flex-shrink: 0; }
  .qr-wrap img { border: 1px solid #ddd; border-radius: 4px; }
  .qr-wrap p { font-size: 9px; color: #888; margin-top: 3px; }

  .signs { display: flex; gap: 20px; flex-wrap: wrap; justify-content: flex-end; }
  .sign-box { text-align: center; min-width: 110px; }
  .sign-space { height: 44px; border-bottom: 1px solid #333; margin-bottom: 3px; position: relative; }
  .sign-img { max-height: 40px; max-width: 100%; position: absolute; bottom: 2px; left: 0; right: 0; margin: 0 auto; display: block; object-fit: contain; }
  .sign-printed-name { font-size: 10px; font-weight: 700; text-align: center; color: #14213d; margin-bottom: 5px; min-height: 12px; }
  .sign-name { font-size: 10px; font-weight: 700; }
  .sign-role { font-size: 9px; color: #666; margin-top: 1px; }
  .sign-date { font-size: 8.5px; color: #0f6e6e; margin-top: 3px; white-space: nowrap; }

  .footer { margin-top: 14px; text-align: center; font-size: 9px; color: #aaa; border-top: 1px dashed #ddd; padding-top: 8px; }
  @media print { @page { margin: 15mm; } }
</style>
</head><body>

${bodies.map((b) => `<div class="slip-page">${b}</div>`).join('')}

<div id="save-hint" style="display:none;margin:20px 32px;background:#f0faf4;border:1px solid #1f8a4c;border-radius:8px;padding:14px 18px;text-align:center;">
  <div style="font-size:14px;font-weight:700;color:#14213d;margin-bottom:8px">📥 Simpan sebagai PDF</div>
  <div style="font-size:12px;color:#444;margin-bottom:12px">Klik tombol di bawah, lalu pilih <strong>"Save as PDF"</strong> atau <strong>"Microsoft Print to PDF"</strong> sebagai printer.</div>
  <button onclick="window.print()" style="background:#14213d;color:#fff;border:none;border-radius:6px;padding:10px 28px;font-size:13px;font-weight:700;cursor:pointer;letter-spacing:0.3px">
    📥 Simpan PDF Sekarang
  </button>
</div>

<script>
  window.onload = () => {
    ${savePdf
      ? `document.getElementById('save-hint').style.display='block';`
      : `window.print();`
    }
  }
</script>
</body></html>`
}

// Ambil item + riwayat approval + QR code untuk satu baris pengajuan (r harus
// sudah punya field id, request_no, dan join profiles).
export async function fetchSlipParts(supabase, r) {
  const { data: items } = await supabase
    .from('reimbursement_items').select('*')
    .eq('reimbursement_id', r.id).order('expense_date')

  const { data: history } = await supabase
    .from('approval_history').select('*, profiles(full_name, role, department, signature_url)')
    .eq('reimbursement_id', r.id).order('created_at')

  const qrDataUrl = await QRCode.toDataURL(trackUrl(r.request_no), { width: 110, margin: 1 })
  return { items: items || [], history: history || [], qrDataUrl }
}

function openPrintWindow(html) {
  const w = window.open('', '_blank', 'width=860,height=680')
  w.document.write(html)
  w.document.close()
}

export async function printSlip(supabase, r, savePdf = false) {
  const { items, history, qrDataUrl } = await fetchSlipParts(supabase, r)
  const body = buildSlipBody(r, items, history, qrDataUrl)
  const html = wrapSlipsHtml([body], savePdf, `Slip Reimbursement ${r.request_no}`)
  openPrintWindow(html)
}

export async function printBulkSlips(supabase, rows, savePdf = false) {
  const parts = await Promise.all(rows.map((r) => fetchSlipParts(supabase, r)))
  const bodies = rows.map((r, i) => buildSlipBody(r, parts[i].items, parts[i].history, parts[i].qrDataUrl))
  const html = wrapSlipsHtml(bodies, savePdf, `Slip Reimbursement (${rows.length} dokumen)`)
  openPrintWindow(html)
}

// Ambil satu pengajuan lengkap (dengan join profiles) berdasarkan request_no —
// dipakai halaman Tracking publik (dibuka lewat scan QR) untuk cetak ulang.
// Catatan: kebijakan RLS pada tabel `reimbursements`/`reimbursement_items`/
// `approval_history` sudah mengizinkan SEMUA user yang login untuk SELECT
// (lihat supabase-schema.sql), jadi query langsung di sini tidak membuka
// akses baru dibanding yang sudah ada di RPC get_tracking_info.
export async function fetchReimbursementByRequestNo(supabase, requestNo) {
  const { data, error } = await supabase
    .from('reimbursements')
    .select('*, profiles(full_name, department, signature_url)')
    .eq('request_no', requestNo)
    .maybeSingle()
  if (error) throw error
  return data
}

// Cetak ulang slip langsung dari nomor request (dipakai tombol "Print Ulang
// Slip" di halaman Tracking). Hanya masuk akal untuk pengajuan yang statusnya
// sudah verified — pemanggil (TrackPage) yang menentukan kapan tombol tampil.
export async function printSlipByRequestNo(supabase, requestNo, savePdf = false) {
  const r = await fetchReimbursementByRequestNo(supabase, requestNo)
  if (!r) throw new Error('Pengajuan tidak ditemukan.')
  await printSlip(supabase, r, savePdf)
}

// ---------------------------------------------------------------- SLIP PENGISIAN KAS (CASH TOP-UP) ----
// Slip untuk satu transaksi pengisian/isi ulang kas kecil (uang MASUK).
// Sengaja dibuat sebagai dokumen & fungsi terpisah dari slip reimbursement
// (uang KELUAR) — bukan cuma beda judul, tapi juga beda skema warna (hijau,
// bukan navy) dan ada pita "↑ KAS MASUK" di pojok, supaya kalau kedua jenis
// slip ini dicetak/diarsipkan bersamaan, orang bisa langsung membedakan
// mana slip uang masuk dan mana slip uang keluar hanya dari sekilas pandang.
function buildTopupSlipBody(t, creatorName, creatorSigUrl) {
  const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID')
  const printDate = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })
  const inputDate = t.created_at
    ? new Date(t.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—'

  return `
<div class="header">
  <div>
    <div class="brand">PCRS <span>•</span> Petty Cash</div>
    <div style="font-size:10px;color:#888;margin-top:2px">Petty Cash Reimbursement System</div>
  </div>
  <div class="doc-label">
    <div class="title">Slip Pengisian Kas</div>
    <div class="no">${t.topup_no || '—'}</div>
  </div>
</div>

<hr class="thick"/>

<div style="overflow:hidden;margin-bottom:8px">
  <div class="sah">↑ KAS MASUK</div>
  <div class="info-row">
    <div class="info-col"><div class="lbl">Tanggal Pengisian</div><div class="val">${t.topup_date}</div></div>
    <div class="info-col"><div class="lbl">Diinput Oleh</div><div class="val">${creatorName || '—'}</div></div>
    <div class="info-col"><div class="lbl">Diinput Pada</div><div class="val">${inputDate}</div></div>
    <div class="info-col"><div class="lbl">Tanggal Cetak</div><div class="val">${printDate}</div></div>
  </div>
</div>

<hr class="thin"/>

<table>
  <thead>
    <tr>
      <th>Keterangan</th>
      <th style="width:160px;text-align:right">Nominal</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>${t.note || 'Isi ulang kas kecil'}</td>
      <td style="text-align:right">${rp(t.amount)}</td>
    </tr>
    <tr class="total-row">
      <td style="padding:6px 8px">TOTAL KAS MASUK</td>
      <td style="text-align:right;padding:6px 8px">${rp(t.amount)}</td>
    </tr>
  </tbody>
</table>

<div class="bottom">
  <div style="font-size:9px;color:#888">Dokumen internal — bukti pengisian kas kecil, bukan bukti transfer bank.</div>
  <div class="signs">
    <div class="sign-box">
      <div class="sign-space">
        ${creatorSigUrl ? `<img class="sign-img" src="${creatorSigUrl}"/>` : ''}
      </div>
      <div class="sign-printed-name">${creatorName || '\u00A0'}</div>
      <div class="sign-name">Diinput Oleh</div>
      <div class="sign-role">(Finance)</div>
    </div>
  </div>
</div>

<div class="footer">
  Dicetak otomatis oleh PCRS &nbsp;•&nbsp; ${t.topup_no || ''} &nbsp;•&nbsp; ${new Date().toLocaleString('id-ID')}
</div>`
}

// Wrapper HTML khusus slip pengisian kas — struktur sama dengan
// wrapSlipsHtml (slip reimbursement) supaya class HTML tetap konsisten,
// tapi warna aksen diganti hijau (bukan navy) sebagai pembeda visual utama
// antara slip uang masuk (ini) dan slip uang keluar (reimbursement).
function wrapTopupSlipHtml(bodies, savePdf, docTitle) {
  return `<!DOCTYPE html>
<html lang="id"><head>
<meta charset="UTF-8"/>
<title>${docTitle}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #111; }

  .slip-page { padding: 28px 32px; page-break-after: always; border-top: 6px solid #1f8a4c; }
  .slip-page:last-child { page-break-after: auto; }

  .header { display: flex; justify-content: space-between; align-items: center; margin: 12px 0 6px; }
  .brand { font-size: 20px; font-weight: 900; color: #14213d; }
  .brand span { color: #1f8a4c; }
  .doc-label { text-align: right; }
  .doc-label .title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #1f8a4c; }
  .doc-label .no { font-size: 15px; font-weight: 900; color: #14213d; }
  hr.thick { border: none; border-top: 2.5px solid #1f8a4c; margin: 10px 0; }
  hr.thin  { border: none; border-top: 1px solid #ccc; margin: 10px 0; }

  .sah { display: inline-block; border: 2.5px solid #1f8a4c; background: #eaf7ee; color: #1f8a4c; font-size: 13px;
    font-weight: 900; padding: 3px 14px; border-radius: 4px; letter-spacing: 2px;
    transform: rotate(-4deg); float: right; margin-top: -4px; }

  .info-row { display: flex; gap: 0; margin: 8px 0 12px; }
  .info-col { flex: 1; }
  .info-col .lbl { font-size: 10px; color: #666; font-weight: 700; text-transform: uppercase; }
  .info-col .val { font-size: 12px; font-weight: 600; margin-top: 1px; }

  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  thead th { background: #1f8a4c; color: #fff; padding: 6px 8px; font-size: 10px; text-transform: uppercase; text-align: left; }
  tbody td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px; }
  .total-row td { font-weight: 700; font-size: 12px; background: #eaf7ee; border-top: 2px solid #1f8a4c; }

  .bottom { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 20px; padding-top: 14px; border-top: 1px solid #e3e6ea; }
  .signs { display: flex; gap: 20px; flex-wrap: wrap; justify-content: flex-end; }
  .sign-box { text-align: center; min-width: 130px; }
  .sign-space { height: 44px; border-bottom: 1px solid #333; margin-bottom: 3px; position: relative; }
  .sign-img { max-height: 40px; max-width: 100%; position: absolute; bottom: 2px; left: 0; right: 0; margin: 0 auto; display: block; object-fit: contain; }
  .sign-printed-name { font-size: 10px; font-weight: 700; text-align: center; color: #14213d; margin-bottom: 5px; min-height: 12px; }
  .sign-name { font-size: 10px; font-weight: 700; }
  .sign-role { font-size: 9px; color: #666; margin-top: 1px; }

  .footer { margin-top: 14px; text-align: center; font-size: 9px; color: #aaa; border-top: 1px dashed #ddd; padding-top: 8px; }
  @media print { @page { margin: 15mm; } }
</style>
</head><body>

${bodies.map((b) => `<div class="slip-page">${b}</div>`).join('')}

<div id="save-hint" style="display:none;margin:20px 32px;background:#f0faf4;border:1px solid #1f8a4c;border-radius:8px;padding:14px 18px;text-align:center;">
  <div style="font-size:14px;font-weight:700;color:#14213d;margin-bottom:8px">📥 Simpan sebagai PDF</div>
  <div style="font-size:12px;color:#444;margin-bottom:12px">Klik tombol di bawah, lalu pilih <strong>"Save as PDF"</strong> atau <strong>"Microsoft Print to PDF"</strong> sebagai printer.</div>
  <button onclick="window.print()" style="background:#1f8a4c;color:#fff;border:none;border-radius:6px;padding:10px 28px;font-size:13px;font-weight:700;cursor:pointer;letter-spacing:0.3px">
    📥 Simpan PDF Sekarang
  </button>
</div>

<script>
  window.onload = () => {
    ${savePdf
      ? `document.getElementById('save-hint').style.display='block';`
      : `window.print();`
    }
  }
</script>
</body></html>`
}

// Cetak slip untuk satu transaksi pengisian kas. `t` harus punya field
// topup_no, topup_date, amount, note, created_at. `creatorName`/`creatorSigUrl`
// diambil pemanggil dari tabel profiles berdasarkan `t.created_by`.
export function printCashTopupSlip(t, creatorName, creatorSigUrl, savePdf = false) {
  const body = buildTopupSlipBody(t, creatorName, creatorSigUrl)
  const html = wrapTopupSlipHtml([body], savePdf, `Slip Pengisian Kas ${t.topup_no || ''}`)
  openPrintWindow(html)
}
