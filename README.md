# PCRS — Petty Cash Reimbursement System (+ Invoice)

Aplikasi internal untuk pengajuan & approval reimbursement petty cash,
sekarang juga mencakup fitur pembuatan & approval Invoice (lihat
`docs/INVOICE_MERGE.md`). React + Vite di frontend, Supabase (Postgres +
Auth + Storage + Edge Functions) di backend, di-deploy ke Vercel.

## Struktur folder

```
src/                      Kode aplikasi React (halaman, komponen, helper)
  pages/                  Satu file per halaman/menu (Dashboard, ApprovalQueue, dst)
  pages/Invoice/          Halaman-halaman khusus fitur Invoice
  lib/                    Fungsi helper murni (format angka, dst)
  hooks/                  Custom React hooks

supabase/
  migrations/             SELURUH riwayat skema database, urut berdasarkan
                           nama file (lihat docs/DATABASE_MIGRATIONS.md)
  functions/               Supabase Edge Functions (kode server-side)
    admin-user-ops/        Dipakai Admin Panel: buat/nonaktifkan akun user
  rls-structural-checks.sql   Query bantuan buat audit ulang RLS
  config.toml             Konfigurasi project untuk Supabase CLI (opsional)

docs/
  DEPLOY.md                Panduan deploy dari nol (Supabase + Vercel)
  DATABASE_MIGRATIONS.md   Cara menjalankan/menambah migrasi database
  RLS_AUDIT.md             Dokumentasi aturan akses data (Row-Level Security)
  INVOICE_MERGE.md         Catatan penggabungan fitur Invoice ke PCRS
```

## Mulai dari mana?

- **Deploy pertama kali / server baru** → `docs/DEPLOY.md`
- **Update yang sudah jalan ke versi terbaru** → jalankan migrasi yang
  belum pernah dijalankan, lihat `docs/DATABASE_MIGRATIONS.md`
- **Mau tahu siapa boleh akses data apa** → `docs/RLS_AUDIT.md`
- **Mau tahu apa saja yang berubah soal fitur Invoice** → `docs/INVOICE_MERGE.md`

## Development lokal

```bash
npm install
npm run dev       # jalankan lokal
npm run build     # build production
npm run test      # jalankan test
```

Butuh file `.env.local` berisi `VITE_SUPABASE_URL` dan
`VITE_SUPABASE_ANON_KEY` (lihat `docs/DEPLOY.md` cara dapatnya).
