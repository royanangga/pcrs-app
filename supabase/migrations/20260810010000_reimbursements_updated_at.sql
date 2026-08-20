-- ============================================================
-- PCRS - Tambah updated_at (dasar untuk Laporan Pengajuan Macet/Aging)
-- Jalankan di SQL Editor, lalu catat di _migration_log (lihat bawah).
--
-- reimbursements cuma punya created_at (tanggal DIBUAT) -- tidak cukup
-- buat tahu "sudah berapa lama nyangkut di status SEKARANG", karena
-- pengajuan yang direvisi berkali-kali tetap created_at-nya sama dari
-- awal. updated_at otomatis ter-update setiap ada perubahan (approve/
-- reject/revisi/dst), jadi mewakili "sejak kapan status ini bertahan".
-- ============================================================

alter table reimbursements add column if not exists updated_at timestamptz not null default now();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists trg_reimbursements_touch_updated_at on reimbursements;
create trigger trg_reimbursements_touch_updated_at
before update on reimbursements
for each row execute procedure touch_updated_at();

-- Isi updated_at awal untuk baris yang sudah ada (pakai created_at sebagai
-- perkiraan awal, karena tidak ada cara tahu kapan persis update
-- terakhirnya untuk data lama).
update reimbursements set updated_at = created_at where updated_at is null;

-- ============================================================
-- Setelah ini jalan, catat di _migration_log:
--
-- insert into public._migration_log (filename, notes)
-- values ('20260810010000_reimbursements_updated_at.sql', 'Kolom updated_at + trigger, dasar Laporan Pengajuan Macet');
-- ============================================================
