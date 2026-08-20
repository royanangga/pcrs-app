// Helper bersama (logic alur approval + util umum) yang dipakai di banyak
// komponen. Dipisah dari App.jsx supaya lebih gampang dites & ditelusuri
// terpisah dari kode tampilan (JSX).

import { supabase } from '../supabaseClient'
import {
  FINANCE_DEPARTMENT,
  STATUS_LABEL,
  APPROVER_ROLE_LABEL,
  MANAGER_THRESHOLD,
  SKIP_DEPT_APPROVAL_ROLES,
  SELF_SKIP_TO_MANAGER_ROLES,
  ALLOWED_FILE_TYPES,
  MAX_FILE_MB,
} from './constants'

// User dianggap "Finance" (boleh lihat semua pengajuan lintas departemen &
// melakukan Finance Verification) kalau department-nya Finance -- TIDAK PEDULI
// role-nya (Employee/Supervisor/Manager di department Finance semua berlaku
// sama, bisa melihat & melakukan verifikasi). Admin juga selalu dianggap Finance.
// "Finance Manager" di sini bukan role tersendiri -- cukup user dengan
// department = Finance (role apa pun), sesuai struktur organisasi yang ada.
export function isFinanceUser(profile) {
  if (!profile) return false
  if (profile.role === 'admin') return true
  return (profile.department || '').trim().toLowerCase() === FINANCE_DEPARTMENT.toLowerCase()
}

// Finance Manager = user dengan role 'manager' DAN department 'Finance' (bukan
// role tersendiri). Hanya Finance Manager (atau Admin) yang boleh melakukan
// approval SEBELUM uang dicairkan (tahap "Approval Finance Manager"). Berbeda
// dengan isFinanceUser() di atas yang mengizinkan SEMUA orang di department
// Finance untuk tahap "Finance Verification" (SETELAH uang dicairkan).
export function isFinanceManager(profile) {
  if (!profile) return false
  if (profile.role === 'admin') return true
  return profile.role === 'manager' && (profile.department || '').trim().toLowerCase() === FINANCE_DEPARTMENT.toLowerCase()
}

// Label status yang lebih jelas: kalau masih 'submitted', sebutkan menunggu
// approval dari siapa (berdasarkan required_role), bukan cuma "Menunggu Approval".
export function statusLabelFor(row) {
  if (!row) return ''
  if (row.status === 'submitted') {
    const approverLabel = APPROVER_ROLE_LABEL[row.required_role] || row.required_role
    return `Menunggu Approval ${approverLabel}`
  }
  return STATUS_LABEL[row.status] || row.status
}

// Menentukan status awal & tahap approval pertama saat pengajuan dibuat/disubmit ulang:
//  - Pengaju = Manager/Admin (semua nominal) -> tidak ada approval departemen,
//    status langsung 'approved' (siap masuk antrian Approval Finance Manager)
//  - Pengaju = Supervisor -> approval diri sendiri di-skip, langsung ke Manager
//    Departemen (status 'submitted', required_role = 'manager')
//  - Pengaju = Employee -> mulai dari approval Supervisor (status 'submitted')
//
// Alur status lengkap sebuah pengajuan:
//   submitted (approval pimpinan departemen: Supervisor/Manager)
//     -> approved (menunggu Approval Finance Manager, SEBELUM uang dicairkan)
//     -> finance_approved (disetujui Finance Manager, siap dicairkan)
//     -> verified (Finance Verification, SETELAH uang benar-benar dicairkan)
export function requiredRoleFor(submitterRole) {
  if (SKIP_DEPT_APPROVAL_ROLES.includes(submitterRole)) return 'manager' // placeholder, tak dipakai (status langsung 'approved')
  if (SELF_SKIP_TO_MANAGER_ROLES.includes(submitterRole)) return 'manager'
  return 'supervisor'
}

export function initialStatusFor(submitterRole) {
  return SKIP_DEPT_APPROVAL_ROLES.includes(submitterRole) ? 'approved' : 'submitted'
}

// Menentukan tahap approval berikutnya SETELAH sebuah step di-approve.
// currentRole = required_role saat ini (tahap yang baru saja approve)
// Return null artinya tidak ada approval lagi -> lanjut ke Finance Verification (status = 'approved')
export function nextApprovalRole(currentRole, submitterRole, total) {
  // Kalau pengaju adalah Supervisor, tahap 'manager' ini menggantikan approval
  // dirinya sendiri (atasan terkait) -> setelah Manager approve, selesai,
  // TIDAK tergantung nominal.
  if (SELF_SKIP_TO_MANAGER_ROLES.includes(submitterRole)) return null

  const needsDeptManager = Number(total) >= MANAGER_THRESHOLD && !SKIP_DEPT_APPROVAL_ROLES.includes(submitterRole)
  if (currentRole === 'supervisor') {
    return needsDeptManager ? 'manager' : null
  }
  // currentRole === 'manager' -> selesai, lanjut Finance Verification
  return null
}

export function approvalFlowLabel(submitterRole, total) {
  if (SKIP_DEPT_APPROVAL_ROLES.includes(submitterRole)) return 'Langsung ke Approval Finance Manager (tanpa approval departemen) → Finance Verification'
  if (SELF_SKIP_TO_MANAGER_ROLES.includes(submitterRole)) return 'Manager Departemen → Approval Finance Manager → Finance Verification (approval SPV di-skip karena pengaju adalah SPV)'
  if (Number(total) >= MANAGER_THRESHOLD) return 'Supervisor → Manager → Approval Finance Manager → Finance Verification (nominal ≥ Rp5jt)'
  return 'Supervisor → Approval Finance Manager → Finance Verification'
}

// Guard anti race-condition: update HANYA berhasil kalau status baris masih
// sama seperti saat dimuat di layar. Kalau sudah keburu diproses orang lain
// (mis. dua approver klik bersamaan, atau Finance Verification & Approval
// dibuka di 2 tab), `data` akan kosong -- munculkan pesan jelas, jangan
// diam-diam menimpa/mendobel data. Dipakai di ApprovalQueue & FinanceVerification.
export async function updateWithGuard(id, expectedStatus, patch) {
  const { data, error } = await supabase
    .from('reimbursements')
    .update(patch)
    .eq('id', id)
    .eq('status', expectedStatus)
    .select('id')
  if (error) return { error }
  if (!data || data.length === 0) {
    return { error: { message: 'Pengajuan ini sudah diproses oleh orang lain. Silakan refresh halaman.' } }
  }
  return { error: null }
}

export function rupiah(n) {
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID')
}

export function generateRequestNo() {
  const now = new Date()
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  const rand = Math.floor(Math.random() * 9000 + 1000)
  return `PCR-${ym}-${rand}`
}

// Nomor pengisian kas otomatis, format mirip generateRequestNo() di atas
// tapi pakai prefix "KAS-" supaya langsung kelihatan beda dari nomor
// pengajuan reimbursement ("PCR-") walau cuma dilihat sekilas di tabel.
export function generateTopupNo() {
  const now = new Date()
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  const rand = Math.floor(Math.random() * 9000 + 1000)
  return `KAS-${ym}-${rand}`
}

export async function fetchAttachments(reimbursementId) {
  const { data } = await supabase
    .from('attachments')
    .select('*')
    .eq('reimbursement_id', reimbursementId)
  return data || []
}

// Validasi file yang dipilih user SEBELUM diupload -- supaya ada feedback
// langsung ("tipe tidak didukung" / "ukuran kelebihan") alih-alih baru
// ketahuan setelah proses upload jalan (atau malah gagal diam-diam).
export function validatePickedFiles(fileList) {
  const valid = []
  const rejected = []
  for (const f of Array.from(fileList || [])) {
    if (!ALLOWED_FILE_TYPES.includes(f.type)) {
      rejected.push(`${f.name}: tipe file tidak didukung (cuma gambar JPG/PNG/GIF/WEBP atau PDF)`)
      continue
    }
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      rejected.push(`${f.name}: ukuran ${(f.size / 1024 / 1024).toFixed(1)}MB melebihi batas ${MAX_FILE_MB}MB`)
      continue
    }
    valid.push(f)
  }
  return { valid, rejected }
}

// Format angka mentah jadi berpemisah ribuan ala Indonesia ("5000000" -> "5.000.000")
// saat diketik, TANPA mengubah representasi angka mentah yang disimpan di state
// (jadi Number(value) di tempat lain tetap jalan seperti biasa).
export function formatThousands(value) {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (!digits) return ''
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}
export function stripThousands(value) {
  return String(value ?? '').replace(/\D/g, '')
}

export function attachmentUrl(filePath) {
  return supabase.storage.from('receipts').getPublicUrl(filePath).data.publicUrl
}
