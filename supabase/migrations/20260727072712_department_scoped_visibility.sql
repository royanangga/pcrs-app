-- ============================================================
-- PCRS - Update v9: Batasi Visibility per Department
-- Jalankan ini di Supabase SQL Editor SETELAH v1-v8.
--
-- Sebelumnya: reimb_select/items_select/attachments_select cuma
-- mensyaratkan "sudah login" -- artinya karyawan departemen mana pun
-- bisa melihat SEMUA pengajuan + rincian item + attachment/struk milik
-- SEMUA departemen lain lewat API langsung (di luar apa yang
-- ditampilkan UI).
--
-- Sesudah ini: karyawan biasa hanya melihat pengajuan (dan
-- rincian/attachment-nya) di DEPARTEMENNYA SENDIRI. Admin dan siapa pun
-- di department Finance tetap melihat semua departemen (memang butuh
-- lintas-departemen untuk Approval Finance Manager & Finance
-- Verification).
-- ============================================================

-- 1. reimbursements: lihat cuma department sendiri (kecuali admin/finance)
drop policy if exists "reimb_select" on reimbursements;
create policy "reimb_select" on reimbursements for select
using (
  is_admin()
  or exists (
    select 1 from profiles p
    where p.id = auth.uid() and lower(trim(p.department)) = 'finance'
  )
  or exists (
    select 1 from profiles caller
    join profiles owner on owner.id = reimbursements.employee_id
    where caller.id = auth.uid()
      and caller.department = owner.department
  )
);

-- 2. reimbursement_items: ikut aturan reimbursements induknya
drop policy if exists "items_select" on reimbursement_items;
create policy "items_select" on reimbursement_items for select
using (
  is_admin()
  or exists (
    select 1 from profiles p
    where p.id = auth.uid() and lower(trim(p.department)) = 'finance'
  )
  or exists (
    select 1 from reimbursements r
    join profiles caller on caller.id = auth.uid()
    join profiles owner on owner.id = r.employee_id
    where r.id = reimbursement_items.reimbursement_id
      and caller.department = owner.department
  )
);

-- 3. attachments: ikut aturan reimbursements induknya juga
drop policy if exists "attachments_select" on attachments;
create policy "attachments_select" on attachments for select
using (
  is_admin()
  or exists (
    select 1 from profiles p
    where p.id = auth.uid() and lower(trim(p.department)) = 'finance'
  )
  or exists (
    select 1 from reimbursements r
    join profiles caller on caller.id = auth.uid()
    join profiles owner on owner.id = r.employee_id
    where r.id = attachments.reimbursement_id
      and caller.department = owner.department
  )
);

-- ============================================================
-- CATATAN:
-- - approval_history TIDAK ikut dibatasi di migrasi ini (scope-nya
--   spesifik reimbursements/items/attachments sesuai permintaan).
--   Kalau mau konsisten (supaya riwayat approval juga tidak kebaca
--   lintas departemen), tinggal bilang, polanya sama persis.
-- - Storage bucket "receipts" TIDAK diubah di migrasi ini (tetap publik
--   seperti sebelumnya, sesuai pilihan kamu) -- tapi karena
--   attachments_select sekarang dibatasi, karyawan lain tidak lagi bisa
--   MENEMUKAN path file departemen lain lewat query tabel attachments,
--   jadi risiko praktisnya sudah jauh berkurang meski bucket-nya publik.
-- - Tidak ada perubahan frontend untuk migrasi ini -- Dashboard/
--   ApprovalQueue/FinanceVerification sudah menampilkan data dengan
--   asumsi scoping ini (mereka sudah filter begini di client), jadi
--   perilaku yang terlihat di UI harusnya sama persis, cuma sekarang
--   benar-benar dijaga di server juga.
-- ============================================================
