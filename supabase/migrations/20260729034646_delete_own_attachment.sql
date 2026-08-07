-- ============================================================
-- PCRS - Update v13: Hapus Attachment Sendiri (saat Draft/Revisi)
-- Jalankan ini di Supabase SQL Editor SETELAH v1-v12.
--
-- Sebelumnya tidak ada policy DELETE untuk attachments sama sekali --
-- baik user maupun admin tidak bisa hapus attachment lewat aplikasi.
-- Sekarang pemilik boleh hapus attachment MILIKNYA SENDIRI, tapi HANYA
-- selama reimbursement induknya masih 'draft' atau 'revision' (sejalan
-- dengan attachments_insert & items_delete_owner yang sudah ada) --
-- begitu sudah 'submitted' dst, tidak bisa dihapus lagi (jejak audit
-- tetap terjaga untuk yang sudah masuk proses approval).
-- ============================================================

drop policy if exists "attachments_delete_owner" on attachments;
create policy "attachments_delete_owner" on attachments for delete
using (
  exists (
    select 1 from reimbursements r
    where r.id = attachments.reimbursement_id
      and r.employee_id = auth.uid()
      and r.status in ('draft', 'revision')
  )
);
