-- ============================================================
-- PCRS - RLS Structural Checks (jalankan ulang kapan saja)
-- Jalankan seluruh blok ini di Supabase SQL Editor.
-- Setiap baris hasil yang muncul = ada yang perlu ditinjau.
-- Kalau semua query kembali KOSONG (0 baris) -- aman.
-- ============================================================

-- 1. Tabel di schema public yang RLS-nya TIDAK aktif (harusnya semua aktif)
select tablename, 'RLS TIDAK AKTIF' as masalah
from pg_tables
where schemaname = 'public'
  and rowsecurity = false;

-- 2. Tabel dengan RLS aktif tapi NOL policy sama sekali (tertutup total --
--    mungkin memang disengaja, tapi wajib ditinjau manual, terutama untuk
--    tabel baru yang lupa dikasih policy)
select t.tablename, 'RLS AKTIF TAPI 0 POLICY' as masalah
from pg_tables t
where t.schemaname = 'public'
  and t.rowsecurity = true
  and not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = t.tablename
  );

-- 3. Kolom yang terlihat seperti status aktif/tidak (nama kolom 'status')
--    tapi ada function SECURITY DEFINER yang query ke tabel itu TANPA
--    menyebut 'status' di definisinya -- sinyal kemungkinan lupa cek status
--    (seperti bug is_admin()/is_finance_or_admin() sebelum v15).
--    Manual review disarankan untuk semua yang muncul di sini.
--    (Pakai p.prosrc langsung -- kolom source code mentah -- bukan
--    pg_get_functiondef(), karena itu sering error di SQL Editor Supabase.)
select p.proname as fungsi
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosrc ilike '%from profiles%'
  and p.prosrc not ilike '%status%';

-- 4. Kolom uuid yang punya foreign key ke tabel yang SAMA dari lebih dari
--    1 kolom di tabel yang sama -- rawan bikin PostgREST embed ambigu
--    (persis kejadian delegated_approver_id vs employee_id).
--    Kalau ada hasil di sini, WAJIB pakai hint eksplisit `table!kolom(...)`
--    di semua query frontend yang embed tabel tersebut.
--    (Pakai pg_catalog langsung, bukan information_schema.constraint_column_usage
--    -- view itu sering error "array_agg is an aggregate function" di Supabase.)
select
  cl.relname as table_name,
  ref.relname as referenced_table,
  count(*) as jumlah_fk_ke_tabel_sama,
  string_agg(att.attname, ', ') as kolom_kolom
from pg_constraint c
join pg_class cl on cl.oid = c.conrelid
join pg_class ref on ref.oid = c.confrelid
join pg_namespace n on n.oid = cl.relnamespace
join lateral unnest(c.conkey) as k(attnum) on true
join pg_attribute att on att.attrelid = cl.oid and att.attnum = k.attnum
where c.contype = 'f' and n.nspname = 'public'
group by cl.relname, ref.relname
having count(*) > 1;

-- 5. Policy UPDATE yang punya `using` tapi with_check NULL (artinya
--    Postgres otomatis pakai `using` yang sama sebagai `with_check` --
--    ini SERING salah untuk tabel dengan alur status bertahap, karena
--    baris baru tidak akan lolos syarat baris lama. WAJIB tinjau manual
--    tiap yang muncul di sini, pastikan itu benar-benar dimaksudkan.
select tablename, policyname, 'UPDATE tanpa with_check eksplisit -- cek manual' as masalah
from pg_policies
where schemaname = 'public' and cmd = 'UPDATE' and with_check is null;

-- 6. Ringkasan jumlah policy per tabel per aksi -- untuk verifikasi cepat
--    "tabel ini sudah punya policy buat SELECT/INSERT/UPDATE/DELETE atau belum"
select tablename,
  count(*) filter (where cmd = 'SELECT') as n_select,
  count(*) filter (where cmd = 'INSERT') as n_insert,
  count(*) filter (where cmd = 'UPDATE') as n_update,
  count(*) filter (where cmd = 'DELETE') as n_delete
from pg_policies
where schemaname = 'public'
group by tablename
order by tablename;
