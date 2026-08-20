# Invoice sudah digabung ke PCRS — Panduan Singkat

Ini adalah project PCRS kamu yang **sudah ditambah fitur Invoice** (bekas
web invoice terpisah). Satu login, satu deploy, satu database.

## Apa yang berubah?

- Menu baru **"Invoice"** muncul di sidebar (untuk user yang punya akses),
  dengan submenu: **Daftar Invoice** dan **Pengaturan Invoice**.
- **Approval jadi satu menu.** Menu **"Approval"** yang sudah ada di PCRS
  sekarang juga dipakai untuk approval invoice. Kalau seorang user cuma
  approver reimbursement, tampilannya sama seperti biasa. Kalau user itu
  Manager Invoice, dia langsung lihat antrian invoice di menu yang sama.
  Kalau user itu approver reimbursement **sekaligus** Manager Invoice,
  muncul 2 tab kecil ("Reimbursement" / "Invoice") di dalam 1 menu Approval
  itu untuk pindah antar antrian — tidak ada lagi menu approval terpisah.
- **Tanda tangan jadi satu.** Menu **"Tanda Tangan Saya"** yang sudah ada di
  PCRS sekarang dipakai bersama untuk slip reimbursement DAN invoice — user
  cukup upload/gambar 1 tanda tangan saja. Khusus Manager Invoice, di
  halaman yang sama ada tambahan field **"Jabatan (untuk Invoice)"** (mis.
  "Finance Manager") yang muncul di bawah tanda tangan saat invoice dicetak.
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
file **`supabase-merge-invoice.sql`** → **Run**.

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
di bagian bawah file `supabase-merge-invoice.sql` (export CSV dari project
Supabase invoice lama → import CSV ke tabel `invoice_invoices` dkk di
project PCRS).

## File yang berubah/ditambah dari project PCRS aslinya

```
supabase-merge-invoice.sql          → BARU, migrasi database (jalankan sekali)
src/lib/invoiceHelpers.js           → BARU, logic nomor invoice & format angka
src/lib/invoicePrint.js             → BARU, template cetak/PDF invoice
src/pages/Invoice/InvoiceList.jsx   → BARU, halaman Daftar Invoice
src/pages/Invoice/InvoiceApproval.jsx → BARU, antrian approval invoice (dipakai
                                          DI DALAM menu Approval, bukan menu sendiri)
src/pages/Invoice/InvoiceSettings.jsx → BARU, halaman Pengaturan Invoice
src/App.jsx           → diubah: tambah menu Invoice, dropdown sidebar multi-grup,
                          menu Approval sekarang juga untuk Manager Invoice
src/pages/ApprovalQueue.jsx → diubah: gabung antrian reimbursement + invoice
                                jadi 1 menu (dengan tab kalau user punya akses keduanya)
src/pages/MyProfile.jsx     → diubah: tambah field "Jabatan (untuk Invoice)"
                                untuk Manager Invoice, tanda tangan dipakai bersama
src/icons.jsx       → diubah: tambah ikon invoice
src/AdminPanel.jsx  → diubah: tambah kolom "Akses Invoice" di Kelola User
```

Kalau sebelumnya kamu sudah sempat menjalankan versi SQL sebelum update ini
(yang membuat kolom `invoice_signature` & tabel tanda tangan terpisah),
jalankan lagi `supabase-merge-invoice.sql` yang baru — aman dijalankan
ulang, dan akan otomatis menghapus kolom `invoice_signature` yang lama
(datanya tidak dipakai lagi karena sekarang pakai `signature_url` yang
sama dengan reimbursement).

Semua file PCRS lainnya (Dashboard, Cash Balance, dst) **tidak disentuh
sama sekali**.
