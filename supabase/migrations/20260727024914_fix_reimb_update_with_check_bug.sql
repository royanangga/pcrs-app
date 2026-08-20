-- ============================================================
-- PCRS - Update v5: Perbaikan bug with_check reimb_update
-- Jalankan ini di Supabase SQL Editor SETELAH v4.
--
-- Bug: with_check versi v4 mengecek "caller.role = required_role",
-- tapi di dalam with_check, `required_role` merujuk ke NILAI BARU
-- (setelah update), bukan nilai lama. Waktu Supervisor approve dan
-- required_role dibumping dari 'supervisor' -> 'manager', with_check
-- ikut mengecek terhadap 'manager' yang baru itu -- padahal yang
-- meng-update adalah Supervisor -- sehingga selalu gagal ("new row
-- violates row-level security policy").
--
-- Perbaikan: with_check dilonggarkan, cukup memastikan pemanggil
-- memang admin / pemilik baris / punya role approver yang relevan
-- (supervisor/manager) / bagian dari department Finance -- TANPA
-- menyamakan persis dengan required_role yang baru. Validasi "role
-- yang tepat untuk baris INI" sudah cukup dijaga oleh `using`
-- (yang mengecek kondisi row SEBELUM update).
-- ============================================================

drop policy if exists "reimb_update" on reimbursements;
create policy "reimb_update" on reimbursements for update
using (
  is_admin()
  or (employee_id = auth.uid() and status in ('draft', 'revision'))
  or (
    status = 'submitted'
    and exists (
      select 1 from profiles caller
      join profiles owner on owner.id = reimbursements.employee_id
      where caller.id = auth.uid()
        and caller.status = 'active'
        and caller.role = reimbursements.required_role
        and caller.department = owner.department
    )
  )
  or (
    status = 'approved'
    and exists (
      select 1 from profiles caller
      where caller.id = auth.uid()
        and caller.status = 'active'
        and caller.role = 'manager'
        and lower(trim(caller.department)) = 'finance'
    )
  )
  or (
    status = 'finance_approved'
    and exists (
      select 1 from profiles caller
      where caller.id = auth.uid()
        and caller.status = 'active'
        and lower(trim(caller.department)) = 'finance'
    )
  )
)
with check (
  is_admin()
  or employee_id = auth.uid()
  or exists (
    select 1 from profiles caller
    where caller.id = auth.uid()
      and caller.status = 'active'
      and (
        caller.role in ('supervisor', 'manager')
        or lower(trim(caller.department)) = 'finance'
      )
  )
);

-- ============================================================
-- Setelah ini, tes ulang: Supervisor approve pengajuan nominal
-- >= Rp5jt (yang harus lanjut ke Manager) -- ini skenario yang tadi
-- gagal. Lalu tes juga jalur normal lainnya (Manager approve,
-- Approval Finance Manager, Finance Verification, reject/revision).
-- ============================================================
