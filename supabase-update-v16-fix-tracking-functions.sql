-- ============================================================
-- PCRS - Update v16: Perbaikan Fungsi Tracking & Helper yang Belum Teraudit
-- Jalankan ini di Supabase SQL Editor SETELAH v1-v15.
--
-- Ditemukan lewat rls-structural-checks.sql query #3 -- 3 fungsi yang
-- sebelumnya tidak pernah kelihatan di file migrasi manapun:
--
-- 1. get_tracking_info() & get_tracking_attachments() -- dipanggil dari
--    TrackPage.jsx (halaman "Lacak Pengajuan"). Keduanya punya 2 masalah:
--    a) Tidak cek profiles.status -- resigned user dgn token lama masih
--       bisa akses (kelas bug sama seperti is_admin() sebelum v15).
--    b) Role yang dicek ('finance_staff', 'finance_manager') TIDAK PERNAH
--       ADA di sistem role aplikasi ini (cuma employee/supervisor/manager/
--       admin, dan Finance dikenali lewat department bukan nama role) --
--       kemungkinan sisa skema versi lama. Efeknya staff Finance asli
--       kemungkinan tidak bisa lihat tracking pengajuan departemen lain
--       lewat fitur ini.
--
-- 2. my_role() & my_department() -- tidak dipanggil dari frontend manapun
--    (kemungkinan dead code atau dipakai fungsi lain yang belum
--    teridentifikasi), tapi sama-sama tidak cek status. Dikunci sebagai
--    jaga-jaga murah.
-- ============================================================

create or replace function public.get_tracking_info(p_request_no text)
returns table(request_no text, status text, total_amount numeric, request_date date, department text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_role text;
  v_caller_department text;
  v_caller_status text;
begin
  select role, department, status into v_caller_role, v_caller_department, v_caller_status
  from profiles where id = auth.uid();

  return query
  select r.request_no, r.status, r.total_amount, r.request_date, p.department
  from reimbursements r
  left join profiles p on p.id = r.employee_id
  where r.request_no = p_request_no
    and auth.uid() is not null
    and v_caller_status = 'active'
    and (
      r.employee_id = auth.uid()
      or v_caller_role = 'admin'
      or lower(trim(v_caller_department)) = 'finance'
    );
end;
$function$;

create or replace function public.get_tracking_attachments(p_request_no text)
returns table(file_name text, file_path text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_role text;
  v_caller_department text;
  v_caller_status text;
begin
  select role, department, status into v_caller_role, v_caller_department, v_caller_status
  from profiles where id = auth.uid();

  return query
  select a.file_name, a.file_path
  from attachments a
  join reimbursements r on r.id = a.reimbursement_id
  where r.request_no = p_request_no
    and auth.uid() is not null
    and v_caller_status = 'active'
    and (
      r.employee_id = auth.uid()
      or v_caller_role = 'admin'
      or lower(trim(v_caller_department)) = 'finance'
    );
end;
$function$;

create or replace function public.my_role()
returns text
language sql
security definer
set search_path to 'public'
as $function$
  select role from profiles where id = auth.uid() and status = 'active'
$function$;

create or replace function public.my_department()
returns text
language sql
security definer
set search_path to 'public'
as $function$
  select department from profiles where id = auth.uid() and status = 'active'
$function$;

-- ============================================================
-- Tidak ada perubahan frontend -- TrackPage.jsx tetap manggil RPC yang
-- sama persis, cuma isinya sekarang benar.
-- Tes: buka halaman Lacak Pengajuan, coba lacak 1 request_no punya
-- department lain sebagai user Finance (role apa saja, asal department-nya
-- Finance) -- sekarang harus BISA (sebelumnya salah ditolak kecuali admin).
-- Coba juga sebagai employee biasa untuk request_no bukan miliknya --
-- harus tetap DITOLAK.
-- ============================================================
