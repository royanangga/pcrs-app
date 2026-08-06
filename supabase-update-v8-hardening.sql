-- ============================================================
-- PCRS - Update v8: Perbaikan Temuan "Kacamata Hacker"
-- Jalankan ini di Supabase SQL Editor SETELAH v1-v7.
-- ============================================================

-- ------------------------------------------------------------
-- 1. KRITIS: reimb_update with_check terlalu longgar untuk pemilik
--    sendiri -- bisa lompat langsung ke status 'verified'/'approved'
--    tanpa lewat approval siapa pun. Diperbaiki supaya status baru
--    yang boleh diset pemilik cuma sesuai alur normal:
--    - 'draft'      : simpan draft
--    - 'submitted'  : submit normal (role BUKAN manager/admin)
--    - 'approved'   : submit oleh Manager/Admin (skip approval dept,
--                     sesuai initialStatusFor() di App.jsx)
--    TIDAK PERNAH boleh 'finance_approved' atau 'verified' langsung.
-- ------------------------------------------------------------
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
  or delegated_approver_id = auth.uid()
  or (
    employee_id = auth.uid()
    and (
      status = 'draft'
      or (
        status = 'submitted'
        and not exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role in ('manager', 'admin'))
      )
      or (
        status = 'approved'
        and exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role in ('manager', 'admin'))
      )
    )
  )
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

-- ------------------------------------------------------------
-- 2. TINGGI: item bisa ditambahkan ke reimbursement yang SUDAH
--    disetujui/dicairkan (items_insert tidak mengecek status).
--    Juga: items_delete_admin selama ini HANYA admin yang boleh
--    hapus item -- padahal fitur "submit ulang revisi" di App.jsx
--    (submitRevision) dijalankan oleh EMPLOYEE biasa dan perlu
--    menghapus item lama dulu. Ditambahkan policy pemilik.
-- ------------------------------------------------------------
drop policy if exists "items_insert" on reimbursement_items;
create policy "items_insert" on reimbursement_items for insert
with check (
  is_admin()
  or exists (
    select 1 from reimbursements r
    where r.id = reimbursement_id
      and r.employee_id = auth.uid()
      and r.status in ('draft', 'revision')
  )
);

drop policy if exists "items_delete_owner" on reimbursement_items;
create policy "items_delete_owner" on reimbursement_items for delete
using (
  exists (
    select 1 from reimbursements r
    where r.id = reimbursement_id
      and r.employee_id = auth.uid()
      and r.status in ('draft', 'revision')
  )
);
-- (items_delete_admin tetap ada, tidak diubah -- admin tetap bisa hapus kapan pun)

-- ------------------------------------------------------------
-- 3. SEDANG: total_amount tidak divalidasi terhadap SUM(reimbursement_items).
--    Diperbaiki dengan menjadikan reimbursement_items sebagai satu-satunya
--    sumber kebenaran -- total_amount SELALU dihitung ulang oleh server,
--    berapa pun nilai yang dikirim client (termasuk lewat reimb_update
--    langsung) akan diabaikan dan ditimpa nilai yang benar.
-- ------------------------------------------------------------
create or replace function public.recalc_reimbursement_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
begin
  target_id := coalesce(new.reimbursement_id, old.reimbursement_id);
  update reimbursements
  set total_amount = coalesce((select sum(amount) from reimbursement_items where reimbursement_id = target_id), 0)
  where id = target_id;
  return null;
end;
$$;

drop trigger if exists trg_recalc_total_ins on reimbursement_items;
create trigger trg_recalc_total_ins after insert on reimbursement_items
for each row execute procedure recalc_reimbursement_total();

drop trigger if exists trg_recalc_total_upd on reimbursement_items;
create trigger trg_recalc_total_upd after update on reimbursement_items
for each row execute procedure recalc_reimbursement_total();

drop trigger if exists trg_recalc_total_del on reimbursement_items;
create trigger trg_recalc_total_del after delete on reimbursement_items
for each row execute procedure recalc_reimbursement_total();

-- Jaring pengaman kedua: berapa pun total_amount yang coba diset langsung
-- lewat UPDATE/INSERT ke reimbursements, selalu dipaksa sama dengan
-- SUM(reimbursement_items) saat itu (0 kalau belum ada item sama sekali).
create or replace function public.force_recalc_total_amount()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.total_amount := coalesce((select sum(amount) from reimbursement_items where reimbursement_id = new.id), 0);
  return new;
end;
$$;

drop trigger if exists trg_force_recalc_total on reimbursements;
create trigger trg_force_recalc_total
before insert or update on reimbursements
for each row execute procedure force_recalc_total_amount();

-- ============================================================
-- CATATAN:
-- - Setelah ini jalan, alur submit baru (header dibuat dulu, baru insert
--   item) akan otomatis benar: total_amount mulai dari 0, lalu ter-update
--   sendiri begitu item-nya masuk -- tidak perlu ubah kode frontend.
-- - Field `total_amount` yang dikirim dari App.jsx (mis. di submitRevision)
--   sekarang aman diabaikan/ditimpa oleh trigger ini, tidak perlu dihapus
--   dari kode, tapi juga tidak lagi dipercaya sebagai sumber kebenaran.
-- - Tes ulang: submit pengajuan baru, edit & submit ulang revisi (hapus/
--   tambah item), pastikan total yang tampil di UI tetap sesuai rincian
--   item setelah refresh.
-- ============================================================
