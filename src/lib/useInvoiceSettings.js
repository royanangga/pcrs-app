import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'

// Dipakai bareng-bareng oleh InvoiceSubmit, InvoiceRequests, InvoiceApproval —
// supaya logic ambil data invoice_settings tidak diduplikasi di tiap halaman.
export function useInvoiceSettings() {
  const [customers, setCustomers] = useState([])
  const [numberFormat, setNumberFormat] = useState('{seq}/INV/FJI-FA/{roman}/{year}')
  const [company, setCompany] = useState({})
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('invoice_settings').select('*')
    const map = Object.fromEntries((data || []).map((r) => [r.key, r.value]))
    setCustomers(map.customers || [])
    setNumberFormat(map.number_format || '{seq}/INV/FJI-FA/{roman}/{year}')
    setCompany(map.company || {})
    setLoading(false)
  }, [])

  useEffect(() => { reload() }, [reload])

  return { customers, numberFormat, company, loading, reload }
}
