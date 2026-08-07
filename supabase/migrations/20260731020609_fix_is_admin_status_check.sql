-- ============================================================
-- PCRS - Update v15: Perbaikan is_admin() & is_finance_or_admin()
-- Jalankan ini di Supabase SQL Editor SETELAH v1-v14.
--
-- Bug: kedua fungsi ini dipakai di HAMPIR SEMUA policy RLS di seluruh
-- aplikasi, tapi TIDAK PERNAH mengecek profiles.status. Karena fitur
-- resign (nonaktifkan user) cuma mengubah `status`, BUKAN `role`, admin
-- atau staff Finance yang sudah resign tetap dianggap admin/finance
-- penuh oleh kedua fungsi ini selama token login lama mereka masih
-- berlaku -- termasuk untuk aksi DELETE (hapus data siapa pun),
-- cash_topups (uang beneran), dan bypass ke semua tabel lain.
-- ============================================================

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin' and status = 'active'
  )
$function$;

create or replace function public.is_finance_or_admin(uid uuid)
returns boolean
language sql
stable security definer
as $function$
  select exists (
    select 1 from profiles p
    where p.id = uid
      and p.status = 'active'
      and (p.role = 'admin' or lower(trim(p.department)) = lower('Finance'))
  );
$function$;

-- ============================================================
-- CATATAN:
-- - Tidak ada perubahan frontend untuk migrasi ini.
-- - Ini murni MEMPERKETAT (tidak ada admin/finance aktif yang kehilangan
--   akses) -- yang berubah cuma admin/finance yang statusnya SUDAH
--   'resigned' tidak lagi dianggap admin/finance oleh kedua fungsi ini.
-- - Tes: nonaktifkan 1 akun admin test (pastikan bukan admin aktif
--   terakhir -- trigger v7 akan menolak kalau itu satu-satunya), lalu
--   dari token lamanya (kalau masih ada) coba akses data lain -- harus
--   ditolak sekarang, bukan cuma sampai token itu expired sendiri.
-- ============================================================
