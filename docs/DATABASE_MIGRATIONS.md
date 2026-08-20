# Migrasi Database — Panduan

Semua perubahan skema database (tabel baru, kolom baru, RLS policy, function,
dst) ditulis sebagai file di `supabase/migrations/`, urut berdasarkan nama
file (format `YYYYMMDDHHMMSS_deskripsi.sql`). Folder ini adalah **satu-satunya
sumber kebenaran** untuk riwayat skema — jangan lagi bikin file SQL lepas di
root project.

Ada 2 cara menjalankannya. Pakai salah satu, tidak perlu dua-duanya.

---

## Cara A — Manual lewat SQL Editor (tidak perlu install apapun)

Ini cara yang dipakai sejauh ini untuk project ini.

**Setup sekali di awal** (kalau belum pernah): jalankan
`supabase/migrations/20260806000000_migration_log_table.sql` di SQL Editor.
Ini membuat tabel kecil `_migration_log` untuk mencatat migrasi mana saja
yang sudah dijalankan.

**Setiap ada migrasi baru:**
1. Buka file migrasinya di `supabase/migrations/` (biasanya sudah dibuatkan).
2. Copy semua isinya → paste di Supabase SQL Editor → **Run**.
3. Catat di `_migration_log`:
   ```sql
   insert into public._migration_log (filename, notes)
   values ('20260812000000_nama_file.sql', 'Deskripsi singkat perubahannya');
   ```

**Cek status "sudah sampai mana":**
```sql
select filename, applied_at, notes from public._migration_log order by applied_at desc;
```
Baris paling atas = migrasi terakhir yang dijalankan. Bandingkan dengan isi
folder `supabase/migrations/` — file yang belum muncul di sini berarti
belum dijalankan.

## Cara B — Supabase CLI (lebih otomatis, butuh install)

Kalau suatu saat mau upgrade ke cara ini (opsional, tidak wajib):

```bash
npm install -g supabase          # sekali saja
supabase login
cd pcrs-app                      # folder project ini
supabase link --project-ref <project-ref-kamu>   # ada di URL dashboard Supabase
```

Karena migrasi-migrasi yang sudah ada di `supabase/migrations/` SUDAH
dijalankan manual sebelumnya (lewat Cara A), migrasi itu perlu ditandai
"applied" tanpa dijalankan ulang:

```bash
supabase migration list          # lihat migrasi mana yang belum ditandai
supabase migration repair --status applied <timestamp-migrasi>
```
Ulangi perintah `repair` untuk tiap migrasi yang statusnya belum "applied".

Setelah semua migrasi lama ditandai applied, migrasi baru ke depannya
tinggal:
```bash
supabase migration new nama_perubahan_singkat   # bikin file kosong di folder migrations
# ...isi file SQL-nya...
supabase db push                                # jalankan ke production + catat otomatis
```

---

## Riwayat migrasi (untuk konteks)

| File | Perubahan |
|---|---|
| `20260716084007_initial_schema.sql` | Skema awal PCRS (semua tabel dasar) |
| `20260716084008_attachments_finance_verification_storage.sql` | Upload bukti transaksi, Finance Verification, storage |
| `20260727020352_resign_status_column.sql` | Kolom status resign user |
| `20260727024151_rls_security_hardening.sql` | Pengetatan RLS |
| `20260727024914_fix_reimb_update_with_check_bug.sql` | Perbaikan bug policy update reimbursement |
| `20260727025534_reassign_delegated_approver.sql` | Fitur reassign approver |
| `20260727065846_enforce_min_one_active_admin.sql` | Jaga minimal 1 admin aktif |
| `20260727072323_self_approval_bypass_and_total_amount_fix.sql` | Perbaikan self-approval & total_amount |
| `20260727072712_department_scoped_visibility.sql` | Pembatasan visibilitas per department |
| `20260727074342_lock_delegated_approver_id.sql` | Kunci kolom delegated_approver_id |
| `20260729024802_delete_own_draft.sql` | User boleh hapus draft sendiri |
| `20260729031612_lock_attachments_post_approval.sql` | Kunci lampiran setelah approved |
| `20260729034646_delete_own_attachment.sql` | User boleh hapus lampiran sendiri |
| `20260729074112_validate_storage_upload_path.sql` | Validasi path upload storage |
| `20260731020609_fix_is_admin_status_check.sql` | Perbaikan cek status di is_admin() |
| `20260731022448_fix_tracking_functions.sql` | Perbaikan fungsi tracking |
| `20260806000000_migration_log_table.sql` | Tabel `_migration_log` (Cara A di atas) |
| `20260810010000_reimbursements_updated_at.sql` | Kolom updated_at reimbursements |
| `20260812000000_merge_invoice_app.sql` | Gabungkan fitur Invoice ke PCRS (lihat `docs/INVOICE_MERGE.md`) |
