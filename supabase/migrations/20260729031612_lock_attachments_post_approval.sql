-- ============================================================
-- PCRS - Update v12: Kunci Upload Attachment Pasca-Approval
-- Jalankan ini di Supabase SQL Editor SETELAH v1-v11.
--
-- Bug: attachments_insert cuma mengecek kepemilikan (employee_id =
-- auth.uid()), sama sekali tidak mengecek status reimbursement --
-- persis seperti bug items_insert yang sudah diperbaiki di v8, tapi
-- attachments_insert waktu itu kelewat. Karyawan masih bisa upload
-- "bukti" ke pengajuan yang sudah verified/dicairkan, kapan saja,
-- tanpa direview ulang siapa pun.
-- ============================================================

drop policy if exists "attachments_insert" on attachments;
create policy "attachments_insert" on attachments for insert
with check (
  is_admin()
  or exists (
    select 1 from reimbursements r
    where r.id = reimbursement_id
      and r.employee_id = auth.uid()
      and r.status in ('draft', 'revision')
  )
);

-- ============================================================
-- Tidak ada perubahan frontend -- upload bukti transaksi tetap normal
-- selama pengajuan masih draft/revision (alur yang sudah ada di App.jsx),
-- cuma sekarang beneran ditutup di server setelah lewat tahap itu.
-- ============================================================
