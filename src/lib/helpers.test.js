import { describe, it, expect } from 'vitest'
import {
  isFinanceUser,
  isFinanceManager,
  statusLabelFor,
  requiredRoleFor,
  initialStatusFor,
  nextApprovalRole,
  approvalFlowLabel,
  rupiah,
  generateRequestNo,
  generateTopupNo,
  validatePickedFiles,
  formatThousands,
  stripThousands,
} from './helpers.js'

// ============================================================
// isFinanceUser / isFinanceManager
// Finance dikenali lewat DEPARTMENT ('Finance'), bukan nama role --
// ini persis kelas bug yang kita temukan di get_tracking_info/
// get_tracking_attachments (v16): sempat salah cek nama role yang
// tidak pernah ada di sistem. Test ini mengunci perilaku yang benar.
// ============================================================
describe('isFinanceUser', () => {
  it('true untuk admin, apapun department-nya', () => {
    expect(isFinanceUser({ role: 'admin', department: 'IT' })).toBe(true)
  })
  it('true untuk siapa pun di department Finance, apapun role-nya', () => {
    expect(isFinanceUser({ role: 'employee', department: 'Finance' })).toBe(true)
    expect(isFinanceUser({ role: 'supervisor', department: 'Finance' })).toBe(true)
    expect(isFinanceUser({ role: 'manager', department: 'Finance' })).toBe(true)
  })
  it('tidak case-sensitive dan toleran spasi di department', () => {
    expect(isFinanceUser({ role: 'employee', department: '  finance  ' })).toBe(true)
    expect(isFinanceUser({ role: 'employee', department: 'FINANCE' })).toBe(true)
  })
  it('false untuk department selain Finance', () => {
    expect(isFinanceUser({ role: 'manager', department: 'IT' })).toBe(false)
  })
  it('false untuk profile kosong/null', () => {
    expect(isFinanceUser(null)).toBe(false)
    expect(isFinanceUser(undefined)).toBe(false)
    expect(isFinanceUser({})).toBe(false)
  })
})

describe('isFinanceManager', () => {
  it('true untuk admin', () => {
    expect(isFinanceManager({ role: 'admin', department: 'IT' })).toBe(true)
  })
  it('true HANYA untuk role manager DI department Finance', () => {
    expect(isFinanceManager({ role: 'manager', department: 'Finance' })).toBe(true)
  })
  it('false untuk employee/supervisor di department Finance (bukan manager)', () => {
    expect(isFinanceManager({ role: 'employee', department: 'Finance' })).toBe(false)
    expect(isFinanceManager({ role: 'supervisor', department: 'Finance' })).toBe(false)
  })
  it('false untuk manager di department selain Finance', () => {
    expect(isFinanceManager({ role: 'manager', department: 'IT' })).toBe(false)
  })
})

// ============================================================
// Alur approval: requiredRoleFor / initialStatusFor / nextApprovalRole
// Ini "jantung" logic routing approval -- diuji lengkap per kombinasi
// role pengaju supaya perubahan di masa depan (mis. tambah role baru)
// ketahuan langsung kalau merusak alur yang sudah ada.
// ============================================================
describe('requiredRoleFor (tahap approval pertama)', () => {
  it('employee -> supervisor', () => {
    expect(requiredRoleFor('employee')).toBe('supervisor')
  })
  it('supervisor -> manager (approval diri sendiri di-skip)', () => {
    expect(requiredRoleFor('supervisor')).toBe('manager')
  })
  it('manager/admin -> placeholder "manager" (tidak dipakai, status langsung approved)', () => {
    expect(requiredRoleFor('manager')).toBe('manager')
    expect(requiredRoleFor('admin')).toBe('manager')
  })
})

describe('initialStatusFor (status awal saat submit)', () => {
  it('employee/supervisor -> submitted (masih perlu approval departemen)', () => {
    expect(initialStatusFor('employee')).toBe('submitted')
    expect(initialStatusFor('supervisor')).toBe('submitted')
  })
  it('manager/admin -> approved (skip approval departemen sepenuhnya)', () => {
    expect(initialStatusFor('manager')).toBe('approved')
    expect(initialStatusFor('admin')).toBe('approved')
  })
})

describe('nextApprovalRole (tahap approval berikutnya setelah 1 step approve)', () => {
  it('submitter supervisor: manager approve -> selesai, TIDAK PEDULI nominal', () => {
    expect(nextApprovalRole('manager', 'supervisor', 999999999)).toBe(null)
    expect(nextApprovalRole('manager', 'supervisor', 0)).toBe(null)
  })
  it('submitter employee, nominal < 5jt: supervisor approve -> selesai (tidak perlu manager)', () => {
    expect(nextApprovalRole('supervisor', 'employee', 4999999)).toBe(null)
  })
  it('submitter employee, nominal >= 5jt: supervisor approve -> lanjut manager', () => {
    expect(nextApprovalRole('supervisor', 'employee', 5000000)).toBe('manager')
    expect(nextApprovalRole('supervisor', 'employee', 10000000)).toBe('manager')
  })
  it('submitter employee: manager approve (tahap ke-2) -> selesai', () => {
    expect(nextApprovalRole('manager', 'employee', 10000000)).toBe(null)
  })
})

describe('approvalFlowLabel (label alur yang ditampilkan ke user)', () => {
  it('manager/admin: skip approval departemen', () => {
    expect(approvalFlowLabel('manager', 1000000)).toMatch(/Langsung ke Approval Finance Manager/)
    expect(approvalFlowLabel('admin', 1000000)).toMatch(/Langsung ke Approval Finance Manager/)
  })
  it('supervisor: approval diri sendiri di-skip ke manager', () => {
    expect(approvalFlowLabel('supervisor', 1000000)).toMatch(/Manager Departemen/)
  })
  it('employee, nominal >= 5jt: lewat Supervisor DAN Manager', () => {
    const label = approvalFlowLabel('employee', 5000000)
    expect(label).toMatch(/Supervisor/)
    expect(label).toMatch(/Manager/)
  })
  it('employee, nominal < 5jt: cukup Supervisor saja (tanpa Manager)', () => {
    const label = approvalFlowLabel('employee', 4999999)
    expect(label).toMatch(/Supervisor/)
    expect(label).not.toMatch(/→ Manager →/)
  })
})

// ============================================================
// statusLabelFor
// ============================================================
describe('statusLabelFor', () => {
  it('status submitted: sebutkan role approver yang ditunggu', () => {
    expect(statusLabelFor({ status: 'submitted', required_role: 'supervisor' })).toBe('Menunggu Approval SPV Departemen')
    expect(statusLabelFor({ status: 'submitted', required_role: 'manager' })).toBe('Menunggu Approval Manager Departemen')
  })
  it('status lain: pakai STATUS_LABEL biasa', () => {
    expect(statusLabelFor({ status: 'verified' })).toBe('Terverifikasi (Sudah Dicairkan)')
    expect(statusLabelFor({ status: 'rejected' })).toBe('Ditolak')
  })
  it('row kosong/null tidak error', () => {
    expect(statusLabelFor(null)).toBe('')
    expect(statusLabelFor(undefined)).toBe('')
  })
})

// ============================================================
// Util umum
// ============================================================
describe('rupiah', () => {
  it('format angka jadi Rupiah dengan pemisah ribuan', () => {
    expect(rupiah(5000000)).toBe('Rp 5.000.000')
    expect(rupiah(0)).toBe('Rp 0')
  })
  it('nilai kosong/null/undefined dianggap 0', () => {
    expect(rupiah(null)).toBe('Rp 0')
    expect(rupiah(undefined)).toBe('Rp 0')
  })
})

describe('generateRequestNo / generateTopupNo', () => {
  it('format PCR-YYYYMM-XXXX dan KAS-YYYYMM-XXXX', () => {
    expect(generateRequestNo()).toMatch(/^PCR-\d{6}-\d{4}$/)
    expect(generateTopupNo()).toMatch(/^KAS-\d{6}-\d{4}$/)
  })
  it('dua panggilan berturut-turut tidak selalu sama (acak)', () => {
    const results = new Set(Array.from({ length: 20 }, () => generateRequestNo()))
    expect(results.size).toBeGreaterThan(1)
  })
})

describe('formatThousands / stripThousands', () => {
  it('format angka mentah jadi berpemisah titik', () => {
    expect(formatThousands('5000000')).toBe('5.000.000')
    expect(formatThousands(1000)).toBe('1.000')
    expect(formatThousands('999')).toBe('999')
  })
  it('input kosong/bukan angka -> string kosong', () => {
    expect(formatThousands('')).toBe('')
    expect(formatThousands(null)).toBe('')
    expect(formatThousands('abc')).toBe('')
  })
  it('buang karakter non-digit sebelum format (mis. sudah ada titik)', () => {
    expect(formatThousands('5.000.000')).toBe('5.000.000')
  })
  it('stripThousands adalah kebalikan formatThousands (round-trip)', () => {
    const raw = '5000000'
    expect(stripThousands(formatThousands(raw))).toBe(raw)
  })
  it('stripThousands buang semua karakter non-digit', () => {
    expect(stripThousands('5.000.000')).toBe('5000000')
    expect(stripThousands('Rp 5.000.000')).toBe('5000000')
  })
})

describe('validatePickedFiles', () => {
  function fakeFile(name, type, sizeMB) {
    return { name, type, size: sizeMB * 1024 * 1024 }
  }

  it('menerima file dengan tipe & ukuran valid', () => {
    const { valid, rejected } = validatePickedFiles([fakeFile('struk.jpg', 'image/jpeg', 2)])
    expect(valid).toHaveLength(1)
    expect(rejected).toHaveLength(0)
  })
  it('menolak tipe file yang tidak didukung', () => {
    const { valid, rejected } = validatePickedFiles([fakeFile('data.exe', 'application/x-msdownload', 1)])
    expect(valid).toHaveLength(0)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatch(/tipe file tidak didukung/)
  })
  it('menolak file yang melebihi batas ukuran (5MB)', () => {
    const { valid, rejected } = validatePickedFiles([fakeFile('besar.pdf', 'application/pdf', 6)])
    expect(valid).toHaveLength(0)
    expect(rejected[0]).toMatch(/melebihi batas/)
  })
  it('memproses banyak file sekaligus, sebagian lolos sebagian ditolak', () => {
    const { valid, rejected } = validatePickedFiles([
      fakeFile('ok.jpg', 'image/jpeg', 1),
      fakeFile('kebesaran.png', 'image/png', 10),
      fakeFile('ok2.pdf', 'application/pdf', 2),
    ])
    expect(valid).toHaveLength(2)
    expect(rejected).toHaveLength(1)
  })
  it('fileList kosong/null tidak error', () => {
    expect(validatePickedFiles([])).toEqual({ valid: [], rejected: [] })
    expect(validatePickedFiles(null)).toEqual({ valid: [], rejected: [] })
  })
})
