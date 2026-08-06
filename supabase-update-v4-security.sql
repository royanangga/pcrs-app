-- ============================================================
-- PCRS - Update v4: Perbaikan RLS (Security Hardening)
-- Jalankan ini di Supabase SQL Editor SETELAH v1, v2, v3.
-- Tidak menghapus data apapun, hanya mengetatkan aturan akses.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Cegah self-privilege escalation di profiles
--    (RLS "profiles_update_own" tidak punya with_check sama sekali,
--    jadi user bisa update role/department dirinya sendiri jadi apapun)
--    Solusi: trigger BEFORE UPDATE yang menolak perubahan kolom
--    role/department/status kalau bukan admin ATAU bukan panggilan
--    dari service role (dipakai Edge Function admin-user-ops).
-- ------------------------------------------------------------
create or replace function public.prevent_self_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Lewati pengecekan kalau dipanggil pakai service role key
  -- (Edge Function admin-user-ops pakai ini untuk deactivate/reactivate_user)
  if auth.role() = 'service_role' then
    return new;
  end if;

  if is_admin() then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'Tidak diizinkan mengubah role sendiri';
  end if;
  if new.department is distinct from old.department then
    raise exception 'Tidak diizinkan mengubah department sendiri';
  end if;
  if new.status is distinct from old.status then
    raise exception 'Tidak diizinkan mengubah status sendiri';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_self_privilege_escalation on profiles;
create trigger trg_prevent_self_privilege_escalation
before update on profiles
for each row execute procedure prevent_self_privilege_escalation();

-- ------------------------------------------------------------
-- 2. Perketat reimb_update: hanya boleh diubah oleh pihak yang
--    memang berwenang di tahap approval saat itu, bukan sekadar
--    "sudah login".
--    Tahapan (lihat App.jsx applyAction / requiredRoleFor):
--    - draft/revision  -> pemilik sendiri (resubmit)
--    - submitted       -> approver dengan role = required_role
--                         DAN department sama dengan pengaju
--    - approved        -> Finance Manager (role manager, dept Finance)
--    - finance_approved-> siapapun di department Finance (Finance Verification)
-- ------------------------------------------------------------
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
        caller.role = required_role
        or (caller.role = 'manager' and lower(trim(caller.department)) = 'finance')
        or lower(trim(caller.department)) = 'finance'
      )
  )
);

-- ------------------------------------------------------------
-- 3. Perketat history_insert: approver_id di baris riwayat WAJIB
--    sama dengan yang benar-benar login (tidak bisa memalsukan
--    seolah-olah disetujui orang lain)
-- ------------------------------------------------------------
drop policy if exists "history_insert" on approval_history;
create policy "history_insert" on approval_history for insert
with check (
  is_admin() or approver_id = auth.uid()
);

-- ============================================================
-- CATATAN:
-- - Kalau ada tempat lain di app yang memang butuh admin/service-role
--   mengubah reimbursements/approval_history atas nama user lain
--   (di luar yang sudah dicek di atas), pastikan itu lewat Edge Function
--   (service role), bukan client biasa -- supaya tidak kena block RLS ini.
-- - Setelah dijalankan, tes ulang: submit request baru, approve dari
--   Supervisor/Manager, Approval Finance Manager, dan Finance
--   Verification -- pastikan semua tahap masih jalan normal.
-- ============================================================
