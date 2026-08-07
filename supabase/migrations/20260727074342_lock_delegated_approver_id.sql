-- ============================================================
-- PCRS - Update v10: Kunci delegated_approver_id (Anti-Kolusi)
-- Jalankan ini di Supabase SQL Editor SETELAH v1-v9.
--
-- Bug: with_check di reimb_update (v8) cuma membatasi kolom `status`
-- yang boleh diset pemilik sendiri -- kolom `delegated_approver_id`
-- tidak dibatasi sama sekali, jadi pemilik pengajuan bisa mengarahkan
-- delegated_approver_id ke akun siapa pun (termasuk kolega yang
-- berkolusi), lalu akun itu bisa approve tanpa role/department yang
-- sesuai sama sekali.
--
-- Fix: trigger terpisah yang menolak perubahan delegated_approver_id
-- kalau bukan admin -- berlaku di luar RLS (jadi tidak peduli lewat
-- jalur update mana pun, termasuk yang lolos reimb_update).
-- ============================================================

create or replace function public.protect_delegated_approver_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() and new.delegated_approver_id is distinct from old.delegated_approver_id then
    raise exception 'Hanya admin yang boleh mengatur delegated_approver_id (reassign approver)';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_delegated_approver on reimbursements;
create trigger trg_protect_delegated_approver
before update on reimbursements
for each row execute procedure protect_delegated_approver_id();

-- ============================================================
-- CATATAN TAMBAHAN (belum saya kode, sekadar dicatat):
--
-- 1. required_role juga tidak divalidasi server-side terhadap
--    total_amount (aturan ">=5jt wajib ke Manager" cuma dijaga di
--    client). Pemilik yang berkolusi dengan Supervisor "ramah" di
--    departemennya bisa memaksa required_role tetap 'supervisor'
--    walau nominalnya besar. Ini beda kategori dari delegated_approver_id
--    (perlu kolusi dgn approver ASLI di department sendiri, bukan
--    orang sembarangan) -- tapi kalau mau saya tutup juga, bilang saja.
--
-- 2. Setelah user dinonaktifkan (ban), access token yang SUDAH
--    diterbitkan sebelumnya (JWT) masih valid sampai masa berlakunya
--    habis (default ~1 jam di Supabase Auth) -- ban cuma mencegah
--    LOGIN/REFRESH baru. Selama jendela itu, kalau tab browser mereka
--    masih terbuka, request dgn token lama masih tervalidasi secara
--    kriptografis (meski hak akses approval tetap ketutup lewat cek
--    caller.status='active' yang sudah ada). Mitigasi: perpendek masa
--    berlaku access token di Supabase Dashboard -> Authentication ->
--    Settings -> JWT expiry, kalau mau jendela ini lebih sempit.
-- ============================================================
