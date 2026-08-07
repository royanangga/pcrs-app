# Migrasi Database — Panduan Supabase CLI

Mulai sekarang, semua perubahan skema database (`ALTER TABLE`, policy RLS baru,
function baru, dst) ditulis sebagai file migrasi di `supabase/migrations/`,
bukan lagi file lepas `supabase-update-vXX.sql` di root project.

## Kenapa pindah dari cara lama

Cara lama (16 file `supabase-update-v1.sql` s/d `v16.sql`, dijalankan manual
satu-satu lewat SQL Editor) punya masalah:
- Tidak ada cara programatis untuk tahu "skema production sekarang di versi
  berapa" — cuma bisa dilacak manual dari riwayat chat/percakapan.
- Gampang lupa migrasi mana yang sudah/belum dijalankan kalau ganti laptop
  atau ada environment kedua (staging).
- Tidak ada jejak di git yang terstruktur — semua 16 file itu baru saya
  kumpulkan jadi `supabase/migrations/` di sesi ini, sebelumnya tersebar
  sebagai lampiran chat.

Supabase CLI punya tabel tracking bawaan (`supabase_migrations.schema_migrations`)
yang otomatis mencatat migrasi mana saja yang sudah jalan di database mana.

## Yang sudah disiapkan di sesi ini

Ke-16 migrasi lama sudah disalin ke `supabase/migrations/` dengan format nama
yang benar (`<timestamp>_<deskripsi>.sql`), urut sesuai kapan aslinya dibuat:

```
supabase/migrations/
  20260716084007_initial_schema.sql
  20260716084008_attachments_finance_verification_storage.sql
  20260727020352_resign_status_column.sql
  20260727024151_rls_security_hardening.sql
  20260727024914_fix_reimb_update_with_check_bug.sql
  20260727025534_reassign_delegated_approver.sql
  20260727065846_enforce_min_one_active_admin.sql
  20260727072323_self_approval_bypass_and_total_amount_fix.sql
  20260727072712_department_scoped_visibility.sql
  20260727074342_lock_delegated_approver_id.sql
  20260729024802_delete_own_draft.sql
  20260729031612_lock_attachments_post_approval.sql
  20260729034646_delete_own_attachment.sql
  20260729074112_validate_storage_upload_path.sql
  20260731020609_fix_is_admin_status_check.sql
  20260731022448_fix_tracking_functions.sql
```

**PENTING:** ini cuma menata ulang file yang SUDAH kamu jalankan manual satu-satu
selama ini. Belum ada yang "dijalankan ulang" — database production kamu
sudah dalam kondisi setelah v16, sama seperti sekarang.

## Langkah adopsi (jalankan di komputer kamu sendiri, bukan di sini)

Supabase CLI perlu login interaktif dan akses langsung ke project kamu, jadi
langkah-langkah ini **tidak bisa saya jalankan dari sandbox** — ini panduan
buat kamu jalankan sendiri.

### 1. Install Supabase CLI (kalau belum ada)
```bash
npm install -g supabase
# atau: brew install supabase/tap/supabase  (Mac)
```

### 2. Login & hubungkan ke project
```bash
supabase login
cd pcrs-app-main
supabase link --project-ref <project-ref-kamu>
```
`<project-ref-kamu>` ada di URL dashboard Supabase:
`https://supabase.com/dashboard/project/<project-ref-kamu>`

### 3. Tandai ke-16 migrasi lama sebagai "sudah diterapkan" (TANPA menjalankan ulang)

Ini langkah paling penting — karena migrasi-migrasi ini SUDAH ada di database
kamu (dijalankan manual), kita cuma perlu memberi tahu Supabase CLI supaya
tidak mencoba menjalankannya lagi dari awal (yang akan gagal karena
objek-objeknya sudah ada):

```bash
supabase migration repair --status applied 20260716084007
supabase migration repair --status applied 20260716084008
supabase migration repair --status applied 20260727020352
supabase migration repair --status applied 20260727024151
supabase migration repair --status applied 20260727024914
supabase migration repair --status applied 20260727025534
supabase migration repair --status applied 20260727065846
supabase migration repair --status applied 20260727072323
supabase migration repair --status applied 20260727072712
supabase migration repair --status applied 20260727074342
supabase migration repair --status applied 20260729024802
supabase migration repair --status applied 20260729031612
supabase migration repair --status applied 20260729034646
supabase migration repair --status applied 20260729074112
supabase migration repair --status applied 20260731020609
supabase migration repair --status applied 20260731022448
```

### 4. Verifikasi
```bash
supabase migration list
```
Harus menampilkan ke-16 migrasi dengan status "Applied" di kolom Remote,
tanpa ada yang "pending".

## Cara pakai untuk migrasi BARU mulai sekarang

Jangan lagi bikin file `supabase-update-vXX.sql` lepas. Pakai:

```bash
supabase migration new nama_perubahan_singkat
```

Ini otomatis membuat file kosong dengan timestamp yang benar di
`supabase/migrations/`. Isi file itu dengan SQL perubahannya, lalu:

```bash
supabase db push
```

Ini menjalankan migrasi baru ke database production DAN mencatatnya di
tabel tracking — tidak perlu lagi copy-paste manual ke SQL Editor.

Untuk cek dulu tanpa benar-benar menjalankan (dry run):
```bash
supabase db push --dry-run
```

## File lama (`supabase-update-vXX.sql` di root)

Tidak saya hapus — biarkan saja sebagai arsip/referensi historis (dan
`RLS-AUDIT.md` masih mengacu ke nomor v1-v16 tersebut). Tapi mulai sekarang,
**jangan tambah file baru dengan pola itu lagi** — pakai `supabase migration new`.
