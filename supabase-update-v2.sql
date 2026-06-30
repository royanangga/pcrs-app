-- ============================================================
-- PCRS - Update v2: Attachment, Finance Verification, Storage
-- Jalankan ini di Supabase SQL Editor SETELAH schema awal (v1)
-- Aman dijalankan walau data sudah ada, tidak akan menghapus data.
-- ============================================================

-- 1. Tambah role baru: finance_staff
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('employee','supervisor','manager','finance_manager','finance_staff','admin'));

-- 2. Tambah status baru: verified (hasil Finance Verification)
alter table reimbursements drop constraint if exists reimbursements_status_check;
alter table reimbursements add constraint reimbursements_status_check
  check (status in ('draft','submitted','approved','rejected','revision','verified'));

-- 3. Tabel attachment (bukti transaksi)
create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  reimbursement_id uuid not null references reimbursements(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  uploaded_at timestamptz default now()
);

alter table attachments enable row level security;

drop policy if exists "attachments_select" on attachments;
create policy "attachments_select" on attachments for select
  using (auth.uid() is not null);

drop policy if exists "attachments_insert" on attachments;
create policy "attachments_insert" on attachments for insert
  with check (
    exists (select 1 from reimbursements r
            where r.id = reimbursement_id and r.employee_id = auth.uid())
  );

-- 4. Storage bucket untuk file bukti transaksi (foto struk dll)
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', true)
on conflict (id) do nothing;

drop policy if exists "receipts_public_read" on storage.objects;
create policy "receipts_public_read" on storage.objects for select
  using (bucket_id = 'receipts');

drop policy if exists "receipts_authenticated_upload" on storage.objects;
create policy "receipts_authenticated_upload" on storage.objects for insert
  with check (bucket_id = 'receipts' and auth.uid() is not null);

-- ============================================================
-- Selesai. Sekarang ganti file App.jsx, style.css, package.json
-- dengan versi terbaru lalu re-deploy seperti biasa.
-- ============================================================
