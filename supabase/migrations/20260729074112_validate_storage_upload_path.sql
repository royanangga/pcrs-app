-- ============================================================
-- PCRS - Update v14: Validasi Path Upload Storage
-- Jalankan ini di Supabase SQL Editor SETELAH v1-v13.
--
-- Bug: receipts_authenticated_upload cuma mengecek "sudah login", tidak
-- pernah memvalidasi folder tujuan upload (path-nya "{reimbursement_id}/
-- namafile") memang milik si pengupload. Siapa pun yang login bisa
-- upload file ke folder UUID reimbursement SIAPA PUN.
--
-- Fix: folder pertama di path (storage.foldername(name)[1]) wajib
-- berupa UUID reimbursement yang memang employee_id-nya = pengupload,
-- dan statusnya masih draft/revision (konsisten dengan attachments_insert).
-- ============================================================

drop policy if exists "receipts_authenticated_upload" on storage.objects;
create policy "receipts_authenticated_upload" on storage.objects for insert
with check (
  bucket_id = 'receipts'
  and auth.uid() is not null
  and (
    is_admin()
    or exists (
      select 1 from reimbursements r
      where r.id::text = (storage.foldername(name))[1]
        and r.employee_id = auth.uid()
        and r.status in ('draft', 'revision')
    )
  )
);

-- ============================================================
-- CATATAN: kalau ada folder lain di bucket "receipts" yang bukan
-- mengikuti pola "{reimbursement_id}/..." (mis. signature/profile foto
-- kalau pernah dipakai bucket yang sama), policy ini akan menolaknya --
-- pastikan cek dulu tidak ada pemakaian lain sebelum jalankan di
-- production. Tidak ada perubahan frontend untuk migrasi ini.
-- ============================================================
