-- ============================================================
-- PCRS (Petty Cash Reimbursement System) - Database Schema
-- Jalankan SEMUA isi file ini di Supabase SQL Editor
-- ============================================================

-- 1. Tabel profil user (melengkapi data auth.users milik Supabase)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  department text not null default 'General',
  role text not null default 'employee'
    check (role in ('employee','supervisor','manager','finance_manager','admin')),
  created_at timestamptz default now()
);

-- 2. Tabel header pengajuan reimbursement
create table if not exists reimbursements (
  id uuid primary key default gen_random_uuid(),
  request_no text not null unique,
  employee_id uuid not null references profiles(id),
  request_date date not null default current_date,
  total_amount numeric not null default 0,
  status text not null default 'draft'
    check (status in ('draft','submitted','approved','rejected','revision')),
  required_role text not null default 'supervisor'
    check (required_role in ('supervisor','manager','finance_manager')),
  created_at timestamptz default now()
);

-- 3. Tabel detail item expense (satu pengajuan bisa banyak item)
create table if not exists reimbursement_items (
  id uuid primary key default gen_random_uuid(),
  reimbursement_id uuid not null references reimbursements(id) on delete cascade,
  expense_date date not null,
  category text not null,
  description text,
  amount numeric not null check (amount > 0)
);

-- 4. Tabel riwayat approval (audit trail)
create table if not exists approval_history (
  id uuid primary key default gen_random_uuid(),
  reimbursement_id uuid not null references reimbursements(id) on delete cascade,
  approver_id uuid references profiles(id),
  action text not null check (action in ('submitted','approved','rejected','revision')),
  notes text,
  created_at timestamptz default now()
);

-- ============================================================
-- Fungsi: otomatis buat baris di "profiles" saat user baru daftar
-- ============================================================
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, department, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce(new.raw_user_meta_data->>'department', 'General'),
    coalesce(new.raw_user_meta_data->>'role', 'employee')
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ============================================================
-- Row Level Security (aturan siapa boleh lihat/ubah data apa)
-- ============================================================
alter table profiles enable row level security;
alter table reimbursements enable row level security;
alter table reimbursement_items enable row level security;
alter table approval_history enable row level security;

-- Semua user yang login boleh melihat semua profil (perlu untuk tampilkan nama)
create policy "profiles_select_all" on profiles for select
  using (auth.uid() is not null);

create policy "profiles_update_own" on profiles for update
  using (auth.uid() = id);

-- Reimbursements: employee lihat punya sendiri, approver lihat semua
create policy "reimb_select" on reimbursements for select
  using (auth.uid() is not null);

create policy "reimb_insert_own" on reimbursements for insert
  with check (employee_id = auth.uid());

create policy "reimb_update" on reimbursements for update
  using (auth.uid() is not null);

-- Items: ikut aturan header (siapa login boleh baca, hanya pemilik insert)
create policy "items_select" on reimbursement_items for select
  using (auth.uid() is not null);

create policy "items_insert" on reimbursement_items for insert
  with check (
    exists (select 1 from reimbursements r
            where r.id = reimbursement_id and r.employee_id = auth.uid())
  );

-- Approval history: semua login boleh baca, hanya approver login boleh insert
create policy "history_select" on approval_history for select
  using (auth.uid() is not null);

create policy "history_insert" on approval_history for insert
  with check (auth.uid() is not null);

-- ============================================================
-- Selesai. Lanjut ke langkah berikutnya di panduan deploy.
-- ============================================================
