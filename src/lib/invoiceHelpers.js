// Helper murni untuk fitur Invoice (diporting dari aplikasi invoice lama:
// lib/utils.js) — dipakai di seluruh halaman src/pages/Invoice/*.

export function toRoman(month) {
  const romans = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
  return romans[month - 1] || 'I'
}

// existingNos: array of invoice_no strings yang sudah ada di database
export function nextInvoiceNumber(existingNos, dateStr, template) {
  const year = new Date(dateStr).getFullYear()
  const month = new Date(dateStr).getMonth() + 1
  const roman = toRoman(month)

  let maxSeq = 0
  ;(existingNos || []).forEach((no) => {
    if (no && no.endsWith('/' + year)) {
      const m = no.match(/^(\d+)\//)
      if (m) {
        const n = parseInt(m[1], 10)
        if (n > maxSeq) maxSeq = n
      }
    }
  })
  const seq = String(maxSeq + 1).padStart(3, '0')

  return template.replace('{seq}', seq).replace('{roman}', roman).replace('{year}', year)
}

export function numFmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Format nominal valuta asing (USD/JPY dsb) hasil konversi dari IDR.
// JPY konvensinya tanpa desimal, mata uang lain (USD, dst) tetap 2 desimal.
export function numFmtValuta(n, currency) {
  const digits = currency === 'JPY' ? 0 : 2
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function invoiceTotal(items) {
  return (items || []).reduce((s, it) => s + Number(it.amount || 0) * Number(it.qty || 1), 0)
}

// Due date otomatis = akhir bulan, 1 bulan ke depan dari tanggal invoice.
// Contoh: invoice tanggal 21 Agustus 2026 -> due date 30 September 2026.
export function dueDateOneMonthEnd(invoiceDateStr) {
  if (!invoiceDateStr) return ''
  const d = new Date(invoiceDateStr + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return ''
  // new Date(year, month+2, 0) = tanggal terakhir dari (bulan invoice + 1)
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 2, 0)
  return lastDay.toISOString().slice(0, 10)
}
