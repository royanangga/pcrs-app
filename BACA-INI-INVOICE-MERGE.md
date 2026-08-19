# Invoice sudah digabung ke PCRS — Panduan Singkat

Ini adalah project PCRS kamu yang **sudah ditambah fitur Invoice** (bekas
web invoice terpisah). Satu login, satu deploy, satu database.

## Apa yang berubah?

- Menu baru **"Invoice"** muncul di sidebar (untuk user yang punya akses),
  dengan submenu: **Daftar Invoice**, **Approval Invoice**, **Pengaturan Invoice**.
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
- Cuma **Manager Invoice** yang bisa buka menu Approval Invoice
  (approve / batalkan approval) dan upload tanda tangan pribadi.
- Admin PCRS otomatis punya akses penuh ke fitur invoice (staff + manager)
  tanpa perlu diset manual.

### 4. (Opsional) Pindahkan data invoice lama

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
src/pages/Invoice/InvoiceApproval.jsx → BARU, halaman Approval (manager)
src/pages/Invoice/InvoiceSettings.jsx → BARU, halaman Pengaturan Invoice
src/App.jsx        → diubah: tambah menu Invoice, dropdown sidebar multi-grup
src/icons.jsx       → diubah: tambah ikon invoice
src/AdminPanel.jsx  → diubah: tambah kolom "Akses Invoice" di Kelola User
```

Semua file PCRS lainnya (Dashboard, Approval reimbursement, Cash Balance,
dst) **tidak disentuh sama sekali**.
