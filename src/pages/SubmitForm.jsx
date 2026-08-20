import { useState } from 'react'
import { supabase } from '../supabaseClient'
import Icon from '../icons.jsx'
import Portal from '../Portal.jsx'
import { useEscapeToClose } from '../hooks/useEscapeToClose.js'
import { CATEGORIES, MAX_FILE_MB } from '../lib/constants.js'
import { rupiah, generateRequestNo, requiredRoleFor, initialStatusFor, approvalFlowLabel, validatePickedFiles, formatThousands, stripThousands } from '../lib/helpers.js'

// ---------------------------------------------------------------- SUBMIT FORM ----
export default function SubmitForm({ profile, onSubmitted }) {
  const [items, setItems] = useState([{ expense_date: '', category: CATEGORIES[0], description: '', amount: '' }])
  const [files, setFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  useEscapeToClose(() => setShowConfirm(false), showConfirm)

  const total = items.reduce((s, it) => s + (Number(it.amount) || 0), 0)

  function updateItem(i, field, value) {
    const next = [...items]
    next[i][field] = value
    setItems(next)
  }
  function addItem() {
    setItems([...items, { expense_date: '', category: CATEGORIES[0], description: '', amount: '' }])
  }
  function removeItem(i) {
    setItems(items.filter((_, idx) => idx !== i))
  }

  function handleClickSubmit(e) {
    e.preventDefault()
    setMsg('')
    if (items.length === 0) {
      setMsg('Tambahkan minimal 1 item sebelum submit.')
      return
    }
    if (items.some((it) => !it.expense_date || !it.amount)) {
      setMsg('Lengkapi semua tanggal dan nominal item.')
      return
    }
    setShowConfirm(true)
  }

  async function handleSaveDraft() {
    if (items.length === 0) {
      setMsg('Tambahkan minimal 1 item sebelum menyimpan draft.')
      return
    }
    if (items.some((it) => !it.expense_date || !it.amount)) {
      setMsg('Lengkapi semua tanggal dan nominal item.')
      return
    }
    setSaving(true)

    const { data: header, error: hErr } = await supabase
      .from('reimbursements')
      .insert({
        request_no: generateRequestNo(),
        employee_id: profile.id,
        total_amount: total,
        status: 'draft',
        required_role: requiredRoleFor(profile.role),
      })
      .select()
      .single()

    if (hErr) {
      setMsg('Gagal menyimpan draft: ' + hErr.message)
      setSaving(false)
      return
    }

    const rows = items.map((it) => ({
      reimbursement_id: header.id,
      expense_date: it.expense_date,
      category: it.category,
      description: it.description,
      amount: Number(it.amount),
    }))
    const { error: iErr } = await supabase.from('reimbursement_items').insert(rows)
    if (iErr) {
      setMsg('Gagal menyimpan item: ' + iErr.message)
      setSaving(false)
      return
    }

    if (files.length > 0) {
      for (const file of files) {
        const path = `${header.id}/${Date.now()}_${file.name}`
        const { error: upErr } = await supabase.storage.from('receipts').upload(path, file)
        if (!upErr) {
          await supabase.from('attachments').insert({
            reimbursement_id: header.id,
            file_name: file.name,
            file_path: path,
          })
        }
      }
    }

    setSaving(false)
    setItems([{ expense_date: '', category: CATEGORIES[0], description: '', amount: '' }])
    setFiles([])
    setMsg(`✓ Draft ${header.request_no} tersimpan. Belum dikirim ke siapa pun -- lanjutkan & submit kapan saja dari tab "Pengajuan Saya".`)
    onSubmitted && onSubmitted()
  }

  async function handleConfirmedSubmit() {
    setSaving(true)
    setShowConfirm(false)

    const required_role = requiredRoleFor(profile.role)
    const { data: header, error: hErr } = await supabase
      .from('reimbursements')
      .insert({
        request_no: generateRequestNo(),
        employee_id: profile.id,
        total_amount: total,
        status: initialStatusFor(profile.role),
        required_role,
      })
      .select()
      .single()

    if (hErr) {
      setMsg('Gagal menyimpan: ' + hErr.message)
      setSaving(false)
      return
    }

    const rows = items.map((it) => ({
      reimbursement_id: header.id,
      expense_date: it.expense_date,
      category: it.category,
      description: it.description,
      amount: Number(it.amount),
    }))
    const { error: iErr } = await supabase.from('reimbursement_items').insert(rows)
    if (iErr) {
      setMsg('Gagal menyimpan item: ' + iErr.message)
      setSaving(false)
      return
    }

    await supabase.from('approval_history').insert({
      reimbursement_id: header.id,
      approver_id: profile.id,
      action: 'submitted',
      notes: initialStatusFor(profile.role) === 'approved'
        ? 'Pengajuan dibuat oleh Manager/Admin — tidak ada approval departemen, langsung ke Approval Finance Manager'
        : 'Pengajuan dibuat oleh employee',
    })

    if (files.length > 0) {
      for (const file of files) {
        const path = `${header.id}/${Date.now()}_${file.name}`
        const { error: upErr } = await supabase.storage.from('receipts').upload(path, file)
        if (!upErr) {
          await supabase.from('attachments').insert({
            reimbursement_id: header.id,
            file_name: file.name,
            file_path: path,
          })
        }
      }
    }

    setSaving(false)
    setItems([{ expense_date: '', category: CATEGORIES[0], description: '', amount: '' }])
    setFiles([])
    setMsg(`✓ Berhasil! Request ${header.request_no} dikirim untuk approval ${header.required_role}.`)
    onSubmitted && onSubmitted()
  }

  return (
    <>
    <div className="card">
      <h3>Pengajuan Reimbursement Baru</h3>
      <form onSubmit={handleClickSubmit}>
        {items.map((it, i) => (
          <div className="item-row" key={i}>
            <div>
              <label>Tanggal</label>
              <input type="date" value={it.expense_date} onChange={(e) => updateItem(i, 'expense_date', e.target.value)} required />
            </div>
            <div>
              <label>Kategori</label>
              <select value={it.category} onChange={(e) => updateItem(i, 'category', e.target.value)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label>Keterangan</label>
              <input value={it.description} onChange={(e) => updateItem(i, 'description', e.target.value)} placeholder="Opsional" />
            </div>
            <div>
              <label>Nominal</label>
              <input
                type="text"
                inputMode="numeric"
                placeholder="0"
                value={formatThousands(it.amount)}
                onChange={(e) => updateItem(i, 'amount', stripThousands(e.target.value))}
                required
              />
            </div>
            <div>
              {items.length > 1 && (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => removeItem(i)}
                  disabled={items.length === 1}
                  title={items.length === 1 ? 'Minimal harus ada 1 item' : undefined}
                >
                  Hapus
                </button>
              )}
            </div>
          </div>
        ))}

        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-neutral" onClick={addItem}>
            + Tambah Item
          </button>
        </div>

        <label style={{ marginTop: 18 }}>Upload Bukti Transaksi (struk/foto, bisa lebih dari satu, maks {MAX_FILE_MB}MB/file)</label>
        <input
          type="file"
          accept="image/*,.pdf"
          multiple
          onChange={(e) => {
            const { valid, rejected } = validatePickedFiles(e.target.files)
            setFiles(valid)
            setMsg(rejected.length ? rejected.join('\n') : '')
          }}
        />
        {files.length > 0 && (
          <div className="checklist-line">{files.length} file dipilih: {files.map((f) => f.name).join(', ')}</div>
        )}

        <div className="total-line">Total: {rupiah(total)} &nbsp;•&nbsp; Alur Approval: <span style={{ color: 'var(--teal)', fontWeight: 700 }}>{approvalFlowLabel(profile.role, total)}</span></div>

        {msg && <div className="error-text" style={{ color: msg.startsWith('✓') ? 'var(--success)' : 'var(--danger)', whiteSpace: 'pre-line' }}>{msg}</div>}

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button className="btn btn-primary" disabled={saving}>
            {saving ? <><span className="spinner" />Mengirim...</> : 'Submit Reimbursement'}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-neutral"
            disabled={saving}
            onClick={handleSaveDraft}
          >
            {saving ? 'Menyimpan...' : 'Simpan sebagai Draft'}
          </button>
        </div>
      </form>
    </div>

    {/* Modal Konfirmasi Submit */}
    {showConfirm && (
      <Portal>
      <div className="modal-overlay" onClick={() => setShowConfirm(false)}>
        <div className="modal-box" style={{ width: 480, maxWidth: '96vw' }} onClick={(e) => e.stopPropagation()}>
          <div className="modal-close" onClick={() => setShowConfirm(false)}><Icon name="x" size={16} /></div>

          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ color: 'var(--teal)', marginBottom: 8 }}><Icon name="clipboard" size={36} /></div>
            <h3 style={{ margin: 0, color: 'var(--navy)' }}>Konfirmasi Pengajuan</h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '6px 0 0' }}>
              Pastikan semua data berikut sudah benar sebelum dikirim.
            </p>
          </div>

          {/* Info pengaju */}
          <div className="submit-confirm-info">
            <div className="submit-confirm-row">
              <span>Nama</span><strong>{profile.full_name}</strong>
            </div>
            <div className="submit-confirm-row">
              <span>Department</span><strong>{profile.department}</strong>
            </div>
            <div className="submit-confirm-row">
              <span>Alur Approval</span>
              <strong style={{ color: 'var(--teal)' }}>{approvalFlowLabel(profile.role, total)}</strong>
            </div>
          </div>

          {/* Rekap item */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
              Rekap Item Tagihan
            </div>
            <div className="table-scroll">
            <table style={{ marginBottom: 0 }}>
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Kategori</th>
                  <th>Keterangan</th>
                  <th style={{ textAlign: 'right' }}>Nominal</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: 12 }}>{it.expense_date}</td>
                    <td style={{ fontSize: 12 }}>{it.category}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{it.description || '—'}</td>
                    <td style={{ fontSize: 12, textAlign: 'right', fontWeight: 600 }}>{rupiah(it.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} style={{ fontWeight: 800, fontSize: 13, paddingTop: 10, borderTop: '2px solid var(--navy)', color: 'var(--navy)' }}>
                    TOTAL
                  </td>
                  <td style={{ fontWeight: 800, fontSize: 15, textAlign: 'right', paddingTop: 10, borderTop: '2px solid var(--navy)', color: 'var(--teal)' }}>
                    {rupiah(total)}
                  </td>
                </tr>
              </tfoot>
            </table>
            </div>
          </div>

          {/* File */}
          {files.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="paperclip" size={13} /> {files.length} file bukti: {files.map((f) => f.name).join(', ')}
            </div>
          )}

          <div className="confirm-actions" style={{ marginTop: 18 }}>
            <button className="btn btn-neutral" style={{ flex: 1 }} onClick={() => setShowConfirm(false)}>
              Kembali & Edit
            </button>
            <button className="btn btn-primary" style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} onClick={handleConfirmedSubmit}>
              <Icon name="check" size={15} /> Ya, Kirim Sekarang
            </button>
          </div>
        </div>
      </div>
    </Portal>
    )}
    </>
  )
}
