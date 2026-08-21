# Invoice sudah digabung ke PCRS — Panduan Singkat

Ini adalah project PCRS kamu yang **sudah ditambah fitur Invoice** (bekas
web invoice terpisah). Satu login, satu deploy, satu database.

## Apa yang berubah?

- **Menu Invoice tersebar rapi ke menu yang sudah ada** (bukan menu
  "Invoice" sendiri) — sesuai struktur sidebar terbaru:
  - **Submit → Submit Invoice**: form isi invoice baru (dulunya pop-up,
    sekarang halaman penuh). Setelah simpan, form otomatis kosong lagi
    supaya bisa lanjut isi invoice berikutnya — sama seperti Submit
    Reimbursement.
  - **Pengajuan Saya**: sekarang punya 2 tab — **Pengajuan Petty Cash
    Reimbursement** (seperti biasa) dan **Pengajuan Invoice** (daftar
    semua invoice: cari, bulk action, edit draft, cetak, hapus). Tab
    Invoice hanya muncul untuk user yang punya akses invoice.
  - **Database**: menu baru yang isinya **Tanda Tangan Saya** dan
    **Pengaturan Invoice** (khusus user dengan akses invoice) jadi satu
    tempat — data acuan yang jarang diubah tapi dipakai fitur lain.
  - **Approval**: tetap 1 menu untuk approval reimbursement & invoice
    (lihat poin di bawah).
- **Approval jadi satu menu.** Menu **"Approval"** yang sudah ada di PCRS
  sekarang juga dipakai untuk approval invoice. Kalau seorang user cuma
  approver reimbursement, tampilannya sama seperti biasa. Kalau user itu
  Manager Invoice, dia langsung lihat antrian invoice di menu yang sama.
  Kalau user itu approver reimbursement **sekaligus** Manager Invoice,
  muncul 2 tab kecil ("Reimbursement" / "Invoice") di dalam 1 menu Approval
  itu untuk pindah antar antrian — tidak ada lagi menu approval terpisah.
- **Tanda tangan jadi satu.** Menu **"Tanda Tangan Saya"** (sekarang di
  dalam menu Database) dipakai bersama untuk slip reimbursement DAN
  invoice — user cukup upload/gambar 1 tanda tangan saja. Khusus Manager
  Invoice, di halaman yang sama ada tambahan field **"Jabatan (untuk
  Invoice)"** (mis. "Finance Manager") yang muncul di bawah tanda tangan
  saat invoice dicetak.
- **Bulk action** di tab Pengajuan Invoice: centang beberapa invoice
  sekaligus (ada checkbox "pilih semua" di header tabel) untuk **Print
  bareng**, **Ajukan Draft bareng** (khusus yang berstatus Draft & datanya
  sudah lengkap), atau **Hapus bareng** (khusus yang belum disetujui).
- **Import dari Excel sekarang jadi Draft**, bukan langsung Diajukan &
  otomatis disetujui seperti sebelumnya. Setelah diimpor, cek datanya dulu
  lalu klik Ajukan (satuan atau bulk) kalau sudah oke. Tombol impor ada di
  tab Pengajuan Invoice.
- Login tetap pakai akun PCRS yang sudah ada (Supabase Auth) — tidak ada
  login terpisah lagi untuk invoice.
- Semua tabel invoice (`invoices`, `invoice_items`, dst) dipindah ke project
  Supabase PCRS dengan nama baru **`invoice_invoices`, `invoice_items`,
  `invoice_settings`, `invoice_attachments`** (diberi prefix biar tidak
  bentrok dengan tabel PCRS yang lain).
- Backend Express terpisah (`api/index.js`) **tidak dipakai lagi** — semua
  logic invoice (nomor otomatis, approval, cetak PDF) sekarang jalan
  langsung di browser + Supabase, sama seperti pola PCRS yang sudah ada.

## Langkah deploy

### 1. Jalankan migrasi database (SEKALI SAJA)

Buka **project Supabase PCRS** (yang SEKARANG dipakai PCRS, bukan project
invoice yang lama) → **SQL Editor** → New query → copy-paste seluruh isi
file **`supabase/migrations/20260812000000_merge_invoice_app.sql`** → **Run**.

Ini akan:
- Menambah kolom `invoice_role`, `invoice_signature`, `invoice_title` di
  tabel `profiles`.
- Membuat 4 tabel baru untuk invoice.
- Mengisi data awal (daftar customer, format nomor invoice, data
  perusahaan) — **cek & sesuaikan isinya nanti lewat menu Pengaturan
  Invoice di aplikasi**, terutama kalau data di web invoice lama kamu
  sudah berbeda dari default di file ini.
- Update fungsi `admin_get_users` supaya Admin Panel bisa menampilkan &
  mengatur akses invoice per user.

### 2. Deploy seperti biasa

Upload seluruh isi folder ini (timpa/replace kode PCRS yang lama di GitHub)
→ Vercel otomatis redeploy. Environment Variables Vercel **tidak berubah**
(tetap `VITE_SUPABASE_URL` & `VITE_SUPABASE_ANON_KEY` yang sudah ada).

### 3. Beri akses invoice ke user

Login sebagai admin → **Admin Panel** → **Kelola User** → tiap user sekarang
punya kolom baru **"Akses Invoice"**: pilih `Staff Invoice` atau
`Manager Invoice` (atau kosongkan kalau user itu tidak perlu akses invoice
sama sekali). Menu Invoice baru muncul di sidebar user tsb setelah
disimpan.

**Beda Staff vs Manager (khusus fitur invoice):**
- Staff & Manager sama-sama bisa membuat, edit, cetak, hapus invoice
  (selama belum di-approve) dan mengubah Pengaturan Invoice.
- Cuma **Manager Invoice** yang bisa melihat antrian approval invoice
  (approve / batalkan approval) di menu Approval, dan mengisi jabatan
  invoice di menu Tanda Tangan Saya.
- Admin PCRS otomatis punya akses penuh ke fitur invoice (staff + manager)
  tanpa perlu diset manual.

### 4. Kalau kamu Manager Invoice: lengkapi tanda tangan

Buka menu **Tanda Tangan Saya** → pastikan tanda tangan sudah ada (kalau
sebelumnya sudah punya tanda tangan untuk reimbursement, tidak perlu upload
ulang, otomatis kepakai) → isi juga field **"Jabatan (untuk Invoice)"**
yang muncul khusus untuk Manager Invoice di halaman yang sama.

### 5. (Opsional) Pindahkan data invoice lama

Kalau kamu masih punya data invoice lama yang mau dibawa, lihat catatan
di bagian bawah file `supabase/migrations/20260812000000_merge_invoice_app.sql` (export CSV dari project
Supabase invoice lama → import CSV ke tabel `invoice_invoices` dkk di
project PCRS).

## File yang berubah/ditambah dari project PCRS aslinya

```
supabase/migrations/20260812000000_merge_invoice_app.sql
                                     → BARU, migrasi database (jalankan sekali)
src/lib/invoiceHelpers.js           → BARU, logic nomor invoice & format angka
src/lib/invoicePrint.js             → BARU, template cetak/PDF invoice
src/lib/useInvoiceSettings.js       → BARU, hook ambil data customer/format nomor/perusahaan
src/pages/Invoice/InvoiceForm.jsx   → BARU, form isi/edit 1 invoice (dipakai bersama
                                          oleh Submit Invoice & modal edit di Pengajuan Saya)
src/pages/Invoice/InvoiceSubmit.jsx → BARU, halaman "Submit Invoice" (di menu Submit)
src/pages/Invoice/InvoiceRequests.jsx → BARU, daftar invoice (tab "Pengajuan Invoice"
                                          DI DALAM menu Pengajuan Saya, bukan menu sendiri)
src/pages/Invoice/InvoiceApproval.jsx → BARU, antrian approval invoice (dipakai
                                          DI DALAM menu Approval, bukan menu sendiri)
src/pages/Invoice/InvoiceSettings.jsx → BARU, halaman Pengaturan Invoice (sekarang
                                          di dalam menu Database, bukan menu sendiri)
src/App.jsx           → diubah: sidebar dirapikan — menu Database (gabungan Tanda
                          Tangan Saya + Pengaturan Invoice), Submit Invoice masuk
                          submenu Submit, menu Approval juga untuk Manager Invoice
src/pages/MyRequests.jsx    → diubah: jadi 2 tab (Reimbursement / Invoice) untuk
                                user yang punya akses invoice
src/pages/ApprovalQueue.jsx → diubah: gabung antrian reimbursement + invoice
                                jadi 1 menu (dengan tab kalau user punya akses keduanya)
src/pages/MyProfile.jsx     → diubah: tambah field "Jabatan (untuk Invoice)"
                                untuk Manager Invoice, tanda tangan dipakai bersama
src/icons.jsx       → diubah: tambah ikon invoice & database
src/AdminPanel.jsx  → diubah: tambah kolom "Akses Invoice" di Kelola User
```

Kalau sebelumnya kamu sudah sempat menjalankan versi SQL sebelum update ini
(yang membuat kolom `invoice_signature` & tabel tanda tangan terpisah),
jalankan lagi `supabase/migrations/20260812000000_merge_invoice_app.sql`
yang baru — aman dijalankan
ulang, dan akan otomatis menghapus kolom `invoice_signature` yang lama
(datanya tidak dipakai lagi karena sekarang pakai `signature_url` yang
sama dengan reimbursement).

Semua file PCRS lainnya (Dashboard, Cash Balance, dst) **tidak disentuh
sama sekali**.
