-- ============================================================
-- PCRS - Update v3: Status Resign/Nonaktif Karyawan
-- Jalankan ini di Supabase SQL Editor SETELAH v1 dan v2.
-- Aman dijalankan walau data sudah ada, tidak akan menghapus data.
-- ============================================================

-- 1. Tambah kolom status aktif/resign + tanggal resign di profiles
alter table profiles add column if not exists status text not null default 'active'
  check (status in ('active', 'resigned'));
alter table profiles add column if not exists resigned_at timestamptz;

-- 2. Index untuk mempercepat filter user aktif (dipakai di Admin Panel & pengecekan approver)
create index if not exists profiles_status_idx on profiles(status);

-- 3. Update admin_get_users supaya ikut mengembalikan status & resigned_at
--    (bentuk asli dipertahankan persis -- cuma menambah 2 kolom output)
--    Return type berubah, jadi function lama harus di-drop dulu sebelum dibuat ulang.
drop function if exists public.admin_get_users();

create or replace function public.admin_get_users()
 returns table(id uuid, full_name text, department text, role text, email text, created_at timestamp with time zone, status text, resigned_at timestamptz)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_admin() then
    raise exception 'Access denied: admin only';
  end if;

  return query
  select
    p.id,
    p.full_name,
    p.department,
    p.role,
    u.email::text,
    p.created_at,
    p.status,
    p.resigned_at
  from profiles p
  join auth.users u on u.id = p.id
  order by p.full_name;
end;
$function$;

-- ============================================================
-- CATATAN:
-- - Kolom ini TIDAK mengubah RLS/foreign key yang sudah ada.
-- - Edge Function `admin-user-ops` masih perlu ditambah action baru:
--   'deactivate_user' dan 'reactivate_user' -- lihat file terpisah
--   admin-user-ops-PATCH.ts untuk kode yang perlu ditambahkan/disesuaikan
--   ke Edge Function kamu (cek dulu isi asli sebelum menimpa).
-- ============================================================
