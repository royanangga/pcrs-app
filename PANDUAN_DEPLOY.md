# Panduan Deploy PCRS (Petty Cash Reimbursement System)

Aplikasi ini terdiri dari 2 bagian:
1. **Supabase** — database SQL + sistem login (gratis)
2. **Vercel** — tempat aplikasi web-nya jalan online (gratis)

Total waktu ±20-30 menit. Tidak perlu install apapun di PC, semua dikerjakan lewat browser, KECUALI satu langkah upload kode ke GitHub yang juga lewat browser.

---

## BAGIAN 1 — Setup Database (Supabase)

1. Buka https://supabase.com → klik **Start your project** → daftar/login (bisa pakai akun Google).
2. Klik **New Project**.
   - Name: `pcrs-app`
   - Database Password: buat password (catat baik-baik, simpan di tempat aman)
   - Region: pilih yang paling dekat (misal Singapore)
   - Klik **Create new project** (tunggu ±2 menit sampai siap)
3. Setelah project siap, di menu kiri klik **SQL Editor** → klik **New query**.
4. Buka file `supabase-schema.sql` (ada di paket file yang saya berikan), **copy semua isinya**, paste ke SQL Editor di Supabase.
5. Klik **Run** (atau tombol ▶). Pastikan muncul tulisan "Success" di bawah. Ini otomatis membuat semua tabel database yang dibutuhkan.
6. **Jalankan juga `supabase-update-v2.sql`** dengan cara yang sama (New query → paste → Run). Ini menambahkan fitur upload bukti transaksi, Finance Verification, dan storage untuk file. *(Kalau ini project baru/belum pernah jalan sebelumnya, jalankan v1 lalu v2 secara berurutan. Kalau project sudah jalan dari versi sebelumnya, cukup jalankan v2 saja.)*
7. Di menu kiri klik **Project Settings** (ikon gear) → **API**.
   - Catat dua hal ini, akan dipakai di Bagian 3:
     - **Project URL** (contoh: `https://xxxx.supabase.co`)
     - **anon public key** (kode panjang di bagian "Project API keys")

> Opsional: di menu **Authentication → Providers**, pastikan "Email" aktif (biasanya sudah default aktif). Untuk MVP ini, fitur "Confirm email" boleh dimatikan dulu (Authentication → Settings → matikan "Enable email confirmations") supaya user baru bisa langsung login tanpa klik email verifikasi — lebih simpel untuk testing internal.

> Catatan soal file bukti transaksi: file disimpan di Supabase Storage bucket bernama `receipts` yang bersifat **public** (siapa saja yang punya link bisa lihat, tapi link-nya acak panjang jadi tidak akan ketemu orang tanpa sengaja). Ini paling simpel untuk MVP. Kalau nanti perlu lebih aman/privat, kasih tahu saya, bisa diubah ke private bucket dengan signed URL.

---

## BAGIAN 2 — Upload Kode ke GitHub

1. Buka https://github.com → daftar/login.
2. Klik tombol **+** (kanan atas) → **New repository**.
   - Repository name: `pcrs-app`
   - Pilih **Private** (supaya tidak publik)
   - Klik **Create repository**
3. Di halaman repo yang baru, klik link **uploading an existing file**.
4. Drag & drop SEMUA file dan folder dari paket `pcrs-app` (yang saya berikan) ke halaman tersebut.
   - Pastikan folder `src` ikut terupload beserta isinya.
5. Klik **Commit changes**.

---

## BAGIAN 3 — Deploy ke Vercel (supaya online)

1. Buka https://vercel.com → daftar/login (paling mudah pakai **Continue with GitHub**, supaya otomatis terhubung).
2. Klik **Add New** → **Project**.
3. Pilih repository `pcrs-app` yang baru dibuat → klik **Import**.
4. Di bagian **Environment Variables**, tambahkan 2 variabel berikut (dari Bagian 1 langkah 6):
   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | (Project URL dari Supabase) |
   | `VITE_SUPABASE_ANON_KEY` | (anon public key dari Supabase) |
5. Klik **Deploy**. Tunggu ±1-2 menit.
6. Setelah selesai, Vercel akan memberi link seperti `https://pcrs-app-xxxx.vercel.app` — **ini link aplikasi Anda yang sudah online** dan bisa diakses siapa saja yang Anda bagikan linknya.

---

## Cara Pakai Setelah Online

1. Buka link Vercel tadi.
2. Klik **Belum punya akun? Daftar** → isi Nama, Department, **Role**, Email, Password.
   - Untuk testing, daftar beberapa akun: 1x **employee**, 1x **supervisor**/**manager**/**finance_manager** (approval), dan 1x **finance_staff** (verifikasi).
3. Login sebagai employee → submit reimbursement + upload bukti transaksi dari tab **Submit Reimbursement**.
4. Login dengan akun approver yang sesuai → buka tab **Approval** untuk approve/reject/revisi.
5. Login sebagai finance_staff/finance_manager → buka tab **Finance Verification**, cek bukti transaksi & checklist, klik **Verifikasi** atau **Kembalikan**.
6. Tab **Dashboard** menampilkan ringkasan semua pengajuan dan jumlah per status.

### Aturan level approval (otomatis sesuai BRD)
- ≤ Rp500.000 → harus di-approve role **supervisor**
- Rp500.001 – Rp5.000.000 → role **manager**
- > Rp5.000.000 → role **finance_manager**
- Role **finance_manager** juga bisa melihat & approve semua level (sebagai admin/keseluruhan)

### Flow lengkap sekarang
1. Employee submit reimbursement + upload bukti transaksi (struk/foto) → status **Menunggu Approval**
2. Approver (supervisor/manager/finance_manager sesuai nominal) approve → status **Menunggu Finance Verification**
3. Finance staff/finance_manager cek bukti transaksi & checklist, klik **Verifikasi** → status **Terverifikasi (Siap Bayar)**, atau **Kembalikan** kalau ada yang kurang → status Revisi
4. Setiap transaksi punya **QR Code** unik (nomor request) — klik "Detail" di Pengajuan Saya, atau "Lihat bukti transaksi" di Finance Verification untuk melihatnya. Bisa di-screenshot/print sebagai bukti fisik tracking.

---

## Jika Ingin Update Aplikasi di Kemudian Hari

Cukup edit file di GitHub (lewat browser, klik ikon pensil di file), commit perubahan → Vercel otomatis re-deploy dalam ±1 menit. Tidak perlu repeat langkah dari awal.

---

## Catatan Pengembangan Selanjutnya (di luar versi ini)

Modul berikut ada di BRD tapi belum termasuk versi ini, bisa ditambahkan menyusul:
- Modul Petty Cash (cash in/out, saldo, history)
- Pembayaran oleh Cashier (status "Paid" setelah verified)
- Integrasi jurnal otomatis ke SAP B1
- Grafik/chart di dashboard (saat ini masih tabel angka)
- QR Code yang langsung link ke halaman detail publik saat di-scan (saat ini QR berisi nomor request sebagai identitas, belum berupa link)

Beri tahu saya kalau mau lanjut ke salah satu modul ini.
