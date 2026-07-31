# PCRS — Audit Row-Level Security (RLS)

Dokumen ini adalah **satu sumber kebenaran** untuk aturan akses data di PCRS,
menggantikan kebutuhan membaca ulang 15 file migrasi (`v1`–`v15`) untuk tahu
"siapa boleh apa" ke tabel mana. Update dokumen ini setiap kali ada policy
baru/berubah — jangan biarkan drift lagi seperti sebelumnya.

Terakhir diverifikasi: berdasarkan hasil query langsung ke `pg_policies` /
`pg_get_functiondef` pada database production (bukan cuma baca file migrasi).

---

## 1. Fungsi keamanan inti

Dipakai di hampir semua policy. **Kalau ada bug di sini, dampaknya menyebar
ke seluruh aplikasi** — jadi ini prioritas #1 kalau mau review ulang.

| Fungsi | Definisi | Catatan |
|---|---|---|
| `is_admin()` | `role = 'admin' AND status = 'active'` (auth.uid() saat ini) | Diperbaiki di v15 — sebelumnya tidak cek `status` |
| `is_finance_or_admin(uid)` | `status = 'active' AND (role = 'admin' OR department = 'Finance')` | Diperbaiki di v15 — sebelumnya tidak cek `status` |

**Aturan wajib ke depan:** setiap fungsi keamanan baru yang dibuat **harus**
ikut mengecek `status = 'active'` kalau merujuk ke `profiles`. Ini kelas bug
yang paling gampang lolos karena "kelihatan benar" tapi diam-diam salah.

---

## 2. Ringkasan per tabel

Semua 6 tabel di schema `public` sudah `rowsecurity = true` (dicek langsung,
bukan diasumsikan). Storage (`storage.objects`, bucket `receipts`) diaudit
terpisah di bagian 3.

### `profiles`
| Aksi | Siapa boleh | Catatan |
|---|---|---|
| SELECT | Siapa saja yang login | Semua orang bisa lihat nama/role/department semua orang — disengaja untuk fitur dropdown/display |
| UPDATE | Diri sendiri, atau admin | Kolom `role`/`department`/`status` khusus diri sendiri **diblokir trigger** `prevent_self_privilege_escalation` (kecuali admin/service role) |
| DELETE | Admin saja | Sudah nyaris tidak dipakai — alur resign sekarang pakai nonaktifkan (update `status`), bukan hapus |
| — | — | Trigger `enforce_min_one_active_admin` mencegah admin aktif terakhir kehilangan status admin lewat jalur manapun (update/delete) |

### `reimbursements`
| Aksi | Siapa boleh |
|---|---|
| SELECT | Admin, siapa saja di department Finance, atau sesama department dengan pemilik pengajuan |
| INSERT | Pemilik untuk dirinya sendiri (`employee_id = auth.uid()`) |
| UPDATE | Lihat tabel detail di bawah — paling kompleks, banyak tahap |
| DELETE | Admin, atau pemilik untuk draft miliknya sendiri |

**Detail UPDATE** (siapa boleh ubah baris di status apa):
| Status saat ini | Siapa boleh update |
|---|---|
| `draft` / `revision` | Pemilik sendiri |
| `submitted` | Approver dengan role = `required_role` DAN department sama dengan pemilik |
| `approved` | Manager di department Finance (Approval Finance Manager) |
| `finance_approved` | Siapa saja di department Finance (Finance Verification) |
| Status manapun | `delegated_approver_id` = diri sendiri (kalau di-assign admin lewat fitur reassign) |
| Status manapun | Admin |

**Pembatasan nilai baru yang boleh diset pemilik sendiri** (`with_check`):
cuma boleh `draft`, atau `submitted`/`approved` sesuai role-nya sendiri
(role `manager`/`admin` → `approved`, selain itu → `submitted`) — **tidak
pernah** boleh lompat ke `finance_approved`/`verified`.

**Kolom `delegated_approver_id` dikunci terpisah** lewat trigger
`protect_delegated_approver_id` — cuma admin yang boleh mengubahnya, supaya
tidak bisa dipakai kolusi (pemilik menaruh nama kolega di situ lalu kolega
itu approve tanpa role yang sesuai).

**`total_amount` dipaksa server** lewat trigger `force_recalc_total_amount`
— selalu dihitung ulang dari `SUM(reimbursement_items.amount)`, mengabaikan
apa pun yang dikirim client.

### `reimbursement_items`
| Aksi | Siapa boleh |
|---|---|
| SELECT | Sama seperti `reimbursements` induknya (admin/Finance/sesama department) |
| INSERT | Admin, atau pemilik reimbursement induk selama masih `draft`/`revision` |
| UPDATE | Admin saja |
| DELETE | Admin, atau pemilik reimbursement induk selama masih `draft`/`revision` |

### `attachments`
| Aksi | Siapa boleh |
|---|---|
| SELECT | Sama seperti `reimbursements` induknya |
| INSERT | Admin, atau pemilik reimbursement induk selama masih `draft`/`revision` |
| DELETE | Admin, atau pemilik reimbursement induk selama masih `draft`/`revision` |
| UPDATE | **Tidak ada policy — default tertutup total**, tidak ada yang bisa update baris attachment |

### `approval_history`
| Aksi | Siapa boleh |
|---|---|
| SELECT | Siapa saja yang login (belum di-department-scope — lihat bagian "Belum Dikerjakan") |
| INSERT | Admin, atau `approver_id` = diri sendiri (tidak bisa memalsukan seolah orang lain yang approve) |
| DELETE | Admin saja |
| UPDATE | **Tidak ada policy — default tertutup total**, riwayat approval tidak bisa diedit siapa pun. Ini benar & disengaja (jejak audit harus permanen) |

### `cash_topups`
| Aksi | Siapa boleh |
|---|---|
| SELECT / INSERT / UPDATE / DELETE | `is_finance_or_admin()` — admin atau siapa saja di department Finance |
| INSERT | Tambahan: `created_by` wajib diri sendiri |

---

## 3. Storage (`storage.objects`, bucket `receipts`)

| Aksi | Aturan |
|---|---|
| SELECT | Publik (siapa saja dengan URL, tanpa perlu login) — **keputusan disengaja**, lihat bagian "Risiko yang Diterima" |
| INSERT | Login + folder pertama di path harus UUID reimbursement yang memang `employee_id`-nya diri sendiri, dan statusnya `draft`/`revision` |

Bucket `signatures` (tanda tangan profil) **belum pernah diaudit** — belum
ada review keamanan untuk ini sama sekali.

---

## 4. Trigger keamanan (di luar RLS biasa)

| Trigger | Tabel | Fungsi |
|---|---|---|
| `trg_prevent_self_privilege_escalation` | `profiles` | Blokir user ubah `role`/`department`/`status` diri sendiri (kecuali admin/service role) |
| `trg_enforce_min_one_active_admin_upd` / `_del` | `profiles` | Cegah admin aktif terakhir kehilangan status admin (update ATAU delete) |
| `trg_recalc_total_ins/upd/del` | `reimbursement_items` | Hitung ulang `total_amount` di induk setiap ada perubahan item |
| `trg_force_recalc_total` | `reimbursements` | Paksa `total_amount` selalu = SUM item, abaikan nilai dari client |
| `trg_protect_delegated_approver` | `reimbursements` | Cuma admin yang boleh ubah `delegated_approver_id` |

---

## 5. Risiko yang diterima (disengaja, bukan lupa)

- **Storage `receipts` publik untuk SELECT** — siapa saja dengan URL bisa akses tanpa login. Diterima karena jalur "menemukan" URL-nya sudah ditutup (`attachments_select` di-scope department), dan UUID path praktis tidak bisa ditebak.
- **`profiles` SELECT terbuka untuk semua** (nama/role/department semua orang) — disengaja untuk kebutuhan dropdown/tampilan approver.
- **`approval_history` SELECT belum di-scope department** — masih `auth.uid() IS NOT NULL` polos. Siapa saja yang login bisa lihat riwayat approval pengajuan department lain (walau tidak bisa lihat pengajuannya sendiri kalau `reimb_select` sudah membatasi — celah kecil, riwayatnya "bocor" duluan sebelum datanya).

## 6. Belum Dikerjakan / Perlu Diputuskan

- [ ] `approval_history` SELECT belum ikut di-scope department (lihat di atas).
- [ ] Bucket storage `signatures` belum pernah diaudit sama sekali.
- [ ] `required_role` di `reimbursements` tidak divalidasi server-side terhadap nominal (aturan ">=5jt wajib ke Manager" cuma dijaga di client) — butuh kolusi dengan approver asli, risiko lebih rendah tapi tetap ada.
- [ ] Grace period token JWT — user yang baru dinonaktifkan masih bisa pakai token lama sampai expired (default Supabase ~1 jam). Mitigasi: perpendek JWT expiry di Supabase Dashboard, atau cari cara invalidate session aktif saat deactivate.

---

## 7. Cara re-audit di masa depan

Jangan ulangi cara lama (nebak-nebak / nunggu ada yang lapor bug). Jalankan
`rls-structural-checks.sql` (file terpisah) setiap kali:
- Ada tabel baru ditambahkan
- Ada kolom baru yang berupa foreign key ke tabel lain (rawan bikin
  PostgREST embed jadi ambigu, seperti kejadian `delegated_approver_id`)
- Sebelum rilis besar / setelah sprint fitur baru

Checklist manual per tabel baru:
1. RLS aktif? (`rowsecurity = true`)
2. SELECT: siapa yang seharusnya BISA dan TIDAK BISA lihat baris ini?
3. INSERT: apakah `with_check` memverifikasi kepemilikan/status yang benar?
4. UPDATE: apakah `using` (baris lama) DAN `with_check` (baris baru) berdua
   sudah benar? (Bug yang pernah kejadian: `using` benar tapi `with_check`
   longgar, jadi bisa "lompat status".)
5. DELETE: siapa yang boleh, dan apakah ada skenario "hapus data yang
   harusnya permanen" (audit trail) yang kebuka?
6. Kalau tabel ini punya lebih dari 1 foreign key ke tabel yang sama →
   pastikan semua query `.select()` di frontend pakai hint eksplisit
   (`table!kolom_fk(...)`), bukan cuma `table(...)`.
