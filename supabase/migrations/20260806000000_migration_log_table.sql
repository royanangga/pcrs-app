-- ============================================================
-- PCRS - Tabel Pencatatan Migrasi (tanpa Supabase CLI)
-- Jalankan ini SEKALI di SQL Editor. Setelah ini, tabel
-- `_migration_log` jadi "buku catatan" migrasi mana saja yang
-- sudah jalan -- gantinya tabel tracking otomatis milik CLI.
-- ============================================================

create table if not exists public._migration_log (
  id serial primary key,
  filename text not null unique,
  applied_at timestamptz not null default now(),
  notes text
);

comment on table public._migration_log is
  'Catatan manual migrasi SQL yang sudah dijalankan lewat SQL Editor. '
  'Isi tabel ini SETIAP KALI habis jalankan migrasi baru -- lihat '
  'supabase/MIGRATION_GUIDE.md untuk cara pakainya. Bukan tabel aplikasi, '
  'murni buat pencatatan/dokumentasi.';

-- Backfill 16 migrasi yang SUDAH dijalankan sebelumnya (v1-v16), supaya
-- catatannya lengkap dari awal, bukan baru mulai dari sekarang.
insert into public._migration_log (filename, applied_at, notes) values
  ('20260716084007_initial_schema.sql', '2026-07-16 08:40:07+00', 'Schema awal (tabel, RLS dasar)'),
  ('20260716084008_attachments_finance_verification_storage.sql', '2026-07-16 08:40:08+00', 'Attachment, Finance Verification, storage bucket'),
  ('20260727020352_resign_status_column.sql', '2026-07-27 02:03:52+00', 'Kolom status resign/nonaktif'),
  ('20260727024151_rls_security_hardening.sql', '2026-07-27 02:41:51+00', 'Perbaikan 3 celah RLS besar'),
  ('20260727024914_fix_reimb_update_with_check_bug.sql', '2026-07-27 02:49:14+00', 'Fix bug with_check reimb_update'),
  ('20260727025534_reassign_delegated_approver.sql', '2026-07-27 02:55:34+00', 'Fitur reassign approver (delegated_approver_id)'),
  ('20260727065846_enforce_min_one_active_admin.sql', '2026-07-27 06:58:46+00', 'Minimal 1 admin aktif + fix ambiguous embed'),
  ('20260727072323_self_approval_bypass_and_total_amount_fix.sql', '2026-07-27 07:23:23+00', 'Fix self-approval bypass, item pasca-approval, total_amount'),
  ('20260727072712_department_scoped_visibility.sql', '2026-07-27 07:27:12+00', 'Batasi visibility data per department'),
  ('20260727074342_lock_delegated_approver_id.sql', '2026-07-27 07:43:42+00', 'Kunci delegated_approver_id (anti-kolusi)'),
  ('20260729024802_delete_own_draft.sql', '2026-07-29 02:48:02+00', 'Izinkan hapus draft sendiri'),
  ('20260729031612_lock_attachments_post_approval.sql', '2026-07-29 03:16:12+00', 'Kunci upload attachment pasca-approval'),
  ('20260729034646_delete_own_attachment.sql', '2026-07-29 03:46:46+00', 'Izinkan hapus attachment sendiri saat draft/revisi'),
  ('20260729074112_validate_storage_upload_path.sql', '2026-07-29 07:41:12+00', 'Validasi path upload storage sesuai kepemilikan'),
  ('20260731020609_fix_is_admin_status_check.sql', '2026-07-31 02:06:09+00', 'Fix is_admin()/is_finance_or_admin() tidak cek status'),
  ('20260731022448_fix_tracking_functions.sql', '2026-07-31 02:24:48+00', 'Fix get_tracking_info/get_tracking_attachments')
on conflict (filename) do nothing;

-- Cek hasilnya
select filename, applied_at, notes from public._migration_log order by applied_at;
