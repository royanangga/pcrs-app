-- ============================================================
-- PCRS - Update v7: Minimal 1 Admin Aktif + Fix Ambiguous Embed
-- Jalankan ini di Supabase SQL Editor SETELAH v1-v6.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Trigger: cegah admin aktif terakhir kehilangan status admin-aktifnya,
--    baik lewat ganti role, dinonaktifkan (resign), maupun dihapus.
--    Berlaku untuk SEMUA jalur (termasuk Edge Function service role) --
--    ini aturan bisnis, bukan soal siapa yang memanggil.
-- ------------------------------------------------------------
create or replace function public.enforce_min_one_active_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  other_active_admins integer;
  becomes_non_admin boolean;
begin
  if TG_OP = 'DELETE' then
    becomes_non_admin := (old.role = 'admin' and old.status = 'active');
  else
    becomes_non_admin := (old.role = 'admin' and old.status = 'active')
      and (new.role is distinct from 'admin' or new.status is distinct from 'active');
  end if;

  if becomes_non_admin then
    select count(*) into other_active_admins
    from profiles
    where role = 'admin' and status = 'active' and id <> old.id;

    if other_active_admins = 0 then
      raise exception 'Minimal harus ada 1 admin aktif -- tidak bisa menonaktifkan/menghapus/mengubah role admin ini.';
    end if;
  end if;

  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_min_one_active_admin_upd on profiles;
create trigger trg_enforce_min_one_active_admin_upd
before update on profiles
for each row execute procedure enforce_min_one_active_admin();

drop trigger if exists trg_enforce_min_one_active_admin_del on profiles;
create trigger trg_enforce_min_one_active_admin_del
before delete on profiles
for each row execute procedure enforce_min_one_active_admin();

-- ============================================================
-- CATATAN: Bug "Dashboard/Approval kosong untuk admin" ada di FRONTEND
-- (query embed `profiles(...)` jadi ambigu setelah kolom
-- `delegated_approver_id` ditambahkan di v6 -- Postgrest tidak tahu mana
-- relasi yang dimaksud). Sudah diperbaiki di App.jsx & AdminPanel.jsx
-- dengan hint eksplisit `profiles!employee_id(...)`. Tidak perlu SQL
-- tambahan untuk ini -- cukup deploy ulang frontend.
-- ============================================================
