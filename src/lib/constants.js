// Konstanta bersama yang dipakai di banyak komponen (SubmitForm, MyRequests,
// ApprovalQueue, FinanceVerification, Dashboard, dst). Dipisah dari App.jsx
// supaya tidak perlu buka file 3.600+ baris cuma buat lihat/ubah 1 angka.

export const CATEGORIES = ['Transport', 'Meal', 'Office Supplies', 'Communication', 'Accommodation', 'Other']

export const STATUS_LABEL = {
  draft: 'Draft',
  submitted: 'Menunggu Approval',
  approved: 'Menunggu Approval Finance Manager',
  finance_approved: 'Disetujui Finance Manager — Menunggu Pencairan',
  verified: 'Terverifikasi (Sudah Dicairkan)',
  rejected: 'Ditolak',
  revision: 'Perlu Revisi',
}

// Nama department yang dianggap "Finance" (bisa disesuaikan sesuai penamaan
// department di organisasi Anda). Pencocokan tidak case-sensitive.
export const FINANCE_DEPARTMENT = 'Finance'

// Label nama tahap approver untuk ditampilkan ke user (sesuai kolom required_role)
export const APPROVER_ROLE_LABEL = {
  supervisor: 'SPV Departemen',
  manager: 'Manager Departemen',
}

// Batas nominal yang mewajibkan approval tambahan dari Manager Departemen
// (hanya berlaku untuk pengaju Employee -- lihat requiredRoleFor di helpers.js)
export const MANAGER_THRESHOLD = 5000000

// Role yang tidak punya atasan lagi di departemennya sendiri (level Manager ke
// atas): pengajuan mereka langsung lanjut ke Finance Verification tanpa
// approval departemen sama sekali. Berlaku sama untuk semua departemen,
// termasuk department Finance sendiri (Manager di department Finance yang
// mengajukan juga langsung ke Finance Verification tanpa approval SPV).
export const SKIP_DEPT_APPROVAL_ROLES = ['manager', 'admin']

// Role yang approval-diri-sendiri di-skip, langsung ke atasan terkait (bukan
// dihilangkan sepenuhnya seperti Manager/Admin di atas). Saat ini hanya
// Supervisor: seorang Supervisor yang mengajukan reimbursement tidak perlu
// (dan tidak boleh) di-approve oleh sesama Supervisor, jadi langsung
// diteruskan ke Manager Departemen (atasannya).
export const SELF_SKIP_TO_MANAGER_ROLES = ['supervisor']

export const MAX_FILE_MB = 5
export const ALLOWED_FILE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']
