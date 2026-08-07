# Migrasi Database — Panduan (Tanpa Install Apa Pun)

Mulai sekarang, semua perubahan skema database ditulis sebagai file
terpisah di `supabase/migrations/`, dan **dicatat manual** lewat tabel
`_migration_log` — supaya selalu jelas "sudah sampai mana", tanpa perlu
install Supabase CLI (yang butuh akses install program di komputer).

## Setup sekali di awal

Jalankan file `supabase/migrations/20260806000000_migration_log_table.sql`
di SQL Editor. Ini akan:
1. Bikin tabel kecil `_migration_log` (cuma buat catatan, bukan tabel aplikasi).
2. Mengisi catatan untuk 16 migrasi lama (`v1`–`v16`) yang sudah pernah kamu
   jalankan sebelumnya, supaya riwayatnya lengkap dari awal.

Setelah itu jalankan:
```sql
select filename, applied_at, notes from public._migration_log order by applied_at;
```
Harus muncul 16 baris. Kalau muncul, setup selesai.

## Cara pakai untuk migrasi baru

Setiap kali ada perubahan skema (misalnya nanti ada "v17"):

**1. Buat file baru** di `supabase/migrations/`, format nama:
`YYYYMMDDHHMMSS_deskripsi-singkat.sql` (boleh juga kamu minta saya yang
buatkan filenya seperti biasa).

**2. Jalankan isinya di SQL Editor**, sama seperti selama ini.

**3. Catat di `_migration_log`** — SATU baris SQL tambahan tiap habis
jalankan migrasi:
```sql
insert into public._migration_log (filename, notes)
values ('20260810000000_nama_file_migrasinya.sql', 'Deskripsi singkat perubahannya');
```

Itu saja — tidak ada langkah lain, tidak ada yang perlu di-install.

## Cara cek status ("sudah sampai mana")

```sql
select filename, applied_at, notes from public._migration_log order by applied_at desc;
```

Baris paling atas = migrasi terakhir yang dijalankan. Bandingkan dengan isi
folder `supabase/migrations/` di project — kalau ada file yang BELUM muncul
di tabel ini, berarti itu yang belum dijalankan.

## Kalau nanti komputer/laptop lain bisa install Supabase CLI

Panduan lengkap versi CLI (lebih otomatis, tapi butuh install) tetap saya
simpan di `supabase/CLI_MIGRATION_GUIDE.md` kalau suatu saat mau upgrade ke
situ. Tidak wajib — cara manual di atas sudah cukup untuk kebutuhan
sekarang, dan folder `supabase/migrations/` yang sama tetap kepakai baik
kamu pilih cara manual atau CLI.
