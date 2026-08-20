-- ============================================================
-- PCRS - Update v6: Reassign Pengajuan Macet (Delegated Approver)
-- Jalankan ini di Supabase SQL Editor SETELAH v1-v5.
--
-- Konteks: routing approval di app ini berbasis role+department
-- (bukan approver_id tetap per pengajuan). Jadi kalau satu-satunya
-- Supervisor/Manager aktif di sebuah department resign, pengajuan yang
-- menunggu role itu jadi macet -- tidak ada orang yang cocok untuk
-- memprosesnya.
--
-- Solusi: kolom `delegated_approver_id`, nullable. Kalau diisi admin,
-- user tsb boleh memproses pengajuan itu SECARA KHUSUS, di luar aturan
-- role+department normal (tanpa mengubah data pengajuan itu sendiri).
-- ============================================================

alter table reimbursements add column if not exists delegated_approver_id uuid references profiles(id);

-- Update reimb_update: tambahkan jalur akses baru "delegated_approver_id = auth.uid()"
drop policy if exists "reimb_update" on reimbursements;
create policy "reimb_update" on reimbursements for update
using (
  is_admin()
  or (employee_id = auth.uid() and status in ('draft', 'revision'))
  or (delegated_approver_id = auth.uid() and status in ('submitted', 'approved'))
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
  or delegated_approver_id = auth.uid()
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
-- Setelah ini jalan, lanjut deploy frontend (AdminPanel.jsx + App.jsx)
-- yang menambahkan UI reassign & menampilkan pengajuan yang
-- didelegasikan di Approval Queue.
-- ============================================================
