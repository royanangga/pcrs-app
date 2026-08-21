import React from 'react'
import InvoiceForm from './InvoiceForm.jsx'
import { useInvoiceSettings } from '../../lib/useInvoiceSettings.js'

export default function InvoiceSubmit({ profile }) {
  const { customers, numberFormat, exchangeRates, loading } = useInvoiceSettings()

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Submit Invoice</h2>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: -6, marginBottom: 16 }}>
        Isi invoice baru di bawah ini. Bisa disimpan sebagai <strong>Draft</strong> dulu (belum
        resmi, nomor invoice belum keluar, masih bisa diubah), atau langsung{' '}
        <strong>diajukan</strong>. Semua invoice yang sudah dibuat bisa dilihat, dilanjutkan, atau
        dicetak di menu <strong>Pengajuan Saya</strong> → tab <strong>Pengajuan Invoice</strong>.
      </p>
      {loading ? (
        <div className="empty-state">Memuat...</div>
      ) : (
        <InvoiceForm profile={profile} customers={customers} numberFormat={numberFormat} exchangeRates={exchangeRates} invoice={null} showAddressFields={false} />
      )}
    </div>
  )
}
