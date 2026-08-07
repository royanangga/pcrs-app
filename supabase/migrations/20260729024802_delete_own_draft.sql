-- ============================================================
-- PCRS - Update v11: Hapus Draft Sendiri
-- Jalankan ini di Supabase SQL Editor SETELAH v1-v10.
--
-- Sebelumnya cuma admin yang boleh hapus reimbursement (reimb_delete_admin).
-- Sekarang pemilik juga boleh hapus draft MILIKNYA SENDIRI (status masih
-- 'draft', belum pernah disubmit ke siapa pun). Item & attachment ikut
-- terhapus otomatis lewat ON DELETE CASCADE yang sudah ada dari skema awal.
-- ============================================================

drop policy if exists "reimb_delete_own_draft" on reimbursements;
create policy "reimb_delete_own_draft" on reimbursements for delete
using (
  employee_id = auth.uid() and status = 'draft'
);
