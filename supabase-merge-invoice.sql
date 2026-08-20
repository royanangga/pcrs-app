-- ============================================================
-- MERGE INVOICE APP INTO PCRS — jalankan SEMUA isi file ini
-- di SQL Editor project Supabase PCRS (yang sudah dipakai PCRS
-- selama ini). JANGAN dijalankan di project Supabase Invoice lama.
--
-- Aman dijalankan berkali-kali (pakai "if not exists" / "if exists").
-- ============================================================

-- 1) Tambah kolom invoice_role di tabel profiles (punya PCRS).
--    Ini menyatukan login: 1 akun (1 baris di profiles) bisa punya
--    role PCRS (employee/supervisor/manager/finance_manager/admin)
--    SEKALIGUS invoice_role terpisah (null / staff / manager), karena
--    kedua sistem punya arti "manager" yang berbeda konteks.
alter table profiles add column if not exists invoice_role text
  check (invoice_role in ('staff', 'manager'));

-- 2) Tabel-tabel invoice (nama tabel diberi prefix invoice_ supaya
--    tidak bentrok dengan tabel apapun yang sudah ada di PCRS).
create table if not exists invoice_invoices (
  id bigint generated always as identity primary key,
  invoice_no text unique,
  invoice_date date,
  due_date date,
  customer_name text,
  customer_address text,
  attn text,
  currency text not null default 'IDR',
  batch text,
  remark text,
  status text not null default 'Diajukan' check (status in ('Draft', 'Diajukan')),
  exchange_rate numeric,
  created_by uuid references profiles(id),
  approval_status text not null default 'pending' check (approval_status in ('pending', 'approved')),
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists invoice_items (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references invoice_invoices(id) on delete cascade,
  item_name text not null,
  description text,
  qty numeric default 1,
  amount numeric not null default 0
);

create table if not exists invoice_settings (
  key text primary key,
  value jsonb
);

create table if not exists invoice_attachments (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references invoice_invoices(id) on delete cascade,
  filename text not null,
  mimetype text not null,
  size bigint not null,
  data text not null, -- base64
  uploaded_by uuid references profiles(id),
  created_at timestamptz default now()
);

create index if not exists idx_invoice_items_invoice_id on invoice_items(invoice_id);
create index if not exists idx_invoice_attachments_invoice_id on invoice_attachments(invoice_id);

-- 3) Data awal settings (customer, format nomor, data perusahaan) —
--    SESUAIKAN isinya kalau kamu mau data yang beda dari default ini.
insert into invoice_settings (key, value) values
('customers', '[
  {"name":"FUJI SEATS (MALAYSIA) SDN BHD","address":"5, Jalan Jasmine 3, Kawasan Perindustrian Bukti Beruntung, Sek. BB 10, Bandar Bukit Beruntung, 48300 Rawang, Selangor Darul Ehsan","currency":"USD","code":"FJM"},
  {"name":"FUJI SEAT CO., LTD","address":"","currency":"JPY","code":"FJ"}
]'::jsonb)
on conflict (key) do nothing;

insert into invoice_settings (key, value) values
('number_format', '"{seq}/INV/FJI-FA/{roman}/{year}"'::jsonb)
on conflict (key) do nothing;

insert into invoice_settings (key, value) values
('company', '{
  "name": "PT. FUJI SEAT INDONESIA",
  "subtitle": "( A FOREIGN INVESTMENT COMPANY )",
  "address_line1": "JL. Agung Perkasa IX Blok K-1 No. 9-15",
  "address_line2": "Sunter Podomoro, Jakarta Utara 14350",
  "phone": "TELP. 62-21-6530 2228  FAX. 62-21-6530 3486",
  "bank_name": "MUFG Bank, Ltd.",
  "bank_branch": "JAKARTA BRANCH",
  "swift_code": "BOTKIDJX",
  "account_number": "5300911224",
  "signer_name": "",
  "signer_title": "",
  "logo": null
}'::jsonb)
on conflict (key) do nothing;

-- 4) Jabatan yang muncul di kolom tanda tangan invoice (hanya dipakai kalau
--    approver adalah Manager Invoice). Tanda tangan GAMBAR-nya sendiri
--    memakai `signature_url` yang SUDAH ADA di tabel profiles (dipakai
--    bersama dengan fitur cetak slip reimbursement PCRS) — supaya user
--    cukup upload 1 tanda tangan saja untuk kedua fitur.
alter table profiles add column if not exists invoice_title text;    -- jabatan yang muncul di ttd invoice
alter table profiles drop column if exists invoice_signature;        -- (versi lama, sudah digantikan signature_url)

-- 5) Update fungsi admin_get_users supaya ikut mengembalikan invoice_role,
--    supaya Admin Panel bisa menampilkan & mengatur akses invoice per user.
--    (drop dulu karena return type berubah)
drop function if exists public.admin_get_users();

create or replace function public.admin_get_users()
 returns table(id uuid, full_name text, department text, role text, email text, created_at timestamp with time zone, status text, resigned_at timestamptz, invoice_role text)
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
    p.resigned_at,
    p.invoice_role
  from profiles p
  join auth.users u on u.id = p.id
  order by p.full_name;
end;
$function$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table invoice_invoices    enable row level security;
alter table invoice_items       enable row level security;
alter table invoice_settings    enable row level security;
alter table invoice_attachments enable row level security;

-- Helper: cek user login ini punya invoice_role apapun (staff/manager) atau admin PCRS
create or replace function is_invoice_user()
returns boolean as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and (invoice_role in ('staff', 'manager') or role = 'admin')
  );
$$ language sql security definer stable;

create or replace function is_invoice_manager()
returns boolean as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and (invoice_role = 'manager' or role = 'admin')
  );
$$ language sql security definer stable;

-- invoice_invoices: siapapun yang punya akses invoice boleh lihat semua,
-- insert punya sendiri, update/delete diatur ketat di aplikasi (invoice yang
-- sudah approved dikunci lewat pengecekan di React, dan lewat policy update
-- di bawah yang menolak update kalau approval_status masih 'approved' kecuali
-- oleh manager yang sedang membatalkan approval / meng-approve).
drop policy if exists "invoice_select" on invoice_invoices;
create policy "invoice_select" on invoice_invoices for select
  using (is_invoice_user());

drop policy if exists "invoice_insert" on invoice_invoices;
create policy "invoice_insert" on invoice_invoices for insert
  with check (is_invoice_user());

drop policy if exists "invoice_update" on invoice_invoices;
create policy "invoice_update" on invoice_invoices for update
  using (is_invoice_user() and (approval_status = 'pending' or is_invoice_manager()));

drop policy if exists "invoice_delete" on invoice_invoices;
create policy "invoice_delete" on invoice_invoices for delete
  using (is_invoice_user() and approval_status = 'pending');

-- invoice_items: ikut aturan header (akses lewat join, jadi cek is_invoice_user saja,
-- pembatasan approved-lock cukup di sisi invoice header karena item selalu ikut header)
drop policy if exists "invoice_items_all" on invoice_items;
create policy "invoice_items_all" on invoice_items for all
  using (is_invoice_user())
  with check (is_invoice_user());

-- invoice_settings: semua invoice user boleh baca & edit (sama seperti aplikasi lama)
drop policy if exists "invoice_settings_select" on invoice_settings;
create policy "invoice_settings_select" on invoice_settings for select
  using (is_invoice_user());

drop policy if exists "invoice_settings_write" on invoice_settings;
create policy "invoice_settings_write" on invoice_settings for all
  using (is_invoice_user())
  with check (is_invoice_user());

-- invoice_attachments
drop policy if exists "invoice_attachments_all" on invoice_attachments;
create policy "invoice_attachments_all" on invoice_attachments for all
  using (is_invoice_user())
  with check (is_invoice_user());

notify pgrst, 'reload schema';

-- ============================================================
-- CATATAN MIGRASI DATA LAMA (opsional, manual):
-- Kalau kamu mau bawa data invoice yang SUDAH ADA dari project Supabase
-- invoice yang lama ke project PCRS ini, cara paling gampang:
--   1. Di project Supabase INVOICE LAMA -> Table Editor -> tabel `invoices`,
--      `invoice_items`, `settings`, `invoice_attachments` -> Export as CSV.
--   2. Di project Supabase PCRS (project ini) -> Table Editor -> tabel
--      invoice_invoices / invoice_items / invoice_settings / invoice_attachments
--      -> Import data from CSV.
--   3. Kolom created_by/approved_by di tabel lama berupa teks nama/username,
--      sedangkan di skema baru ini berupa uuid yang merujuk ke profiles(id).
--      Setelah import CSV, kosongkan dulu created_by/approved_by (biar tidak
--      error foreign key), lalu isi manual lewat SQL Editor kalau perlu,
--      sesuaikan dengan akun PCRS masing-masing orang.
-- ============================================================
