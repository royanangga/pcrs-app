import { useRef, useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import Icon from '../icons.jsx'

// ---------------------------------------------------------------- TANDA TANGAN SAYA ----
export default function MyProfile({ profile, onUpdated }) {
  const isInvoiceManager = profile.invoice_role === 'manager' || profile.role === 'admin'
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const hasStroke = useRef(false)
  const fileInputRef = useRef(null)

  const [signatureUrl, setSignatureUrl] = useState(profile.signature_url || null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState({ text: '', type: '' })
  const [invoiceTitle, setInvoiceTitle] = useState(profile.invoice_title || '')
  const [savingTitle, setSavingTitle] = useState(false)

  useEffect(() => { setSignatureUrl(profile.signature_url || null) }, [profile.signature_url])

  function setupCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    // Resolusi internal lebih tinggi dari ukuran tampilan supaya garis tidak buram
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * ratio
    canvas.height = rect.height * ratio
    const ctx = canvas.getContext('2d')
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#14213d'
  }

  useEffect(() => { setupCanvas() }, [])

  function pointFromEvent(e) {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const src = e.touches ? e.touches[0] : e
    return { x: src.clientX - rect.left, y: src.clientY - rect.top }
  }

  function startDraw(e) {
    e.preventDefault()
    drawing.current = true
    hasStroke.current = true
    const { x, y } = pointFromEvent(e)
    const ctx = canvasRef.current.getContext('2d')
    ctx.beginPath()
    ctx.moveTo(x, y)
  }
  function moveDraw(e) {
    if (!drawing.current) return
    e.preventDefault()
    const { x, y } = pointFromEvent(e)
    const ctx = canvasRef.current.getContext('2d')
    ctx.lineTo(x, y)
    ctx.stroke()
  }
  function endDraw() { drawing.current = false }

  function clearCanvas() {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    hasStroke.current = false
    setMsg({ text: '', type: '' })
  }

  async function uploadBlob(blob) {
    setSaving(true)
    setMsg({ text: '', type: '' })
    try {
      const path = `${profile.id}/signature.png`
      const { error: upErr } = await supabase.storage
        .from('signatures')
        .upload(path, blob, { upsert: true, contentType: 'image/png' })
      if (upErr) throw upErr

      // Tambah versi di query string supaya browser tidak memakai cache gambar lama
      const { data: pub } = supabase.storage.from('signatures').getPublicUrl(path)
      const versionedUrl = `${pub.publicUrl}?v=${Date.now()}`

      const { error: dbErr } = await supabase.from('profiles')
        .update({ signature_url: versionedUrl }).eq('id', profile.id)
      if (dbErr) throw dbErr

      setSignatureUrl(versionedUrl)
      setMsg({ text: 'Tanda tangan tersimpan. Akan otomatis muncul di slip yang dicetak.', type: 'success' })
      onUpdated && onUpdated()
    } catch (err) {
      setMsg({ text: 'Gagal menyimpan: ' + err.message, type: 'error' })
    }
    setSaving(false)
  }

  function saveDrawing() {
    if (!hasStroke.current) {
      setMsg({ text: 'Gambar tanda tangan dulu di area kanvas.', type: 'error' })
      return
    }
    canvasRef.current.toBlob((blob) => { if (blob) uploadBlob(blob) }, 'image/png')
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    uploadBlob(file)
    e.target.value = ''
  }

  async function removeSignature() {
    setSaving(true)
    setMsg({ text: '', type: '' })
    const path = `${profile.id}/signature.png`
    await supabase.storage.from('signatures').remove([path])
    const { error } = await supabase.from('profiles').update({ signature_url: null }).eq('id', profile.id)
    if (error) setMsg({ text: 'Gagal menghapus: ' + error.message, type: 'error' })
    else {
      setSignatureUrl(null)
      clearCanvas()
      setMsg({ text: 'Tanda tangan dihapus.', type: 'success' })
      onUpdated && onUpdated()
    }
    setSaving(false)
  }

  async function saveInvoiceTitle() {
    setSavingTitle(true)
    setMsg({ text: '', type: '' })
    const { error } = await supabase.from('profiles').update({ invoice_title: invoiceTitle || null }).eq('id', profile.id)
    setSavingTitle(false)
    if (error) setMsg({ text: 'Gagal menyimpan jabatan: ' + error.message, type: 'error' })
    else { setMsg({ text: 'Jabatan tersimpan.', type: 'success' }); onUpdated && onUpdated() }
  }

  return (
    <div>
      <div className="card" style={{ maxWidth: 640 }}>
        <h3>Tanda Tangan Digital</h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: -6, marginBottom: 14 }}>
          Gambar atau unggah tanda tangan Anda sekali di sini. Setiap kali slip reimbursement{isInvoiceManager ? ' atau invoice' : ''} dicetak
          (baik sebagai pemohon maupun approver), tanda tangan ini akan otomatis muncul di kolom tanda tangan Anda.
        </p>

        {signatureUrl && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>Tanda tangan saat ini</div>
            <div style={{ border: '1px solid #e3e6ea', borderRadius: 8, padding: 10, display: 'inline-block', background: '#fff' }}>
              <img src={signatureUrl} alt="Tanda tangan" style={{ height: 60, display: 'block' }} />
            </div>
          </div>
        )}

        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>
          {signatureUrl ? 'Gambar ulang tanda tangan baru' : 'Gambar tanda tangan di sini'}
        </div>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: 160, border: '1.5px dashed #c9ced6', borderRadius: 8, background: '#fbfbfc', touchAction: 'none', cursor: 'crosshair' }}
          onMouseDown={startDraw}
          onMouseMove={moveDraw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={moveDraw}
          onTouchEnd={endDraw}
        />

        {msg.text && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: msg.type === 'error' ? 'var(--danger)' : 'var(--success)' }}>
            {msg.text}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          <button className="btn btn-primary" disabled={saving} onClick={saveDrawing} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {saving ? 'Menyimpan...' : <><Icon name="check" size={14} /> Simpan Tanda Tangan</>}
          </button>
          <button className="btn btn-sm btn-neutral" disabled={saving} onClick={clearCanvas}>
            Bersihkan Kanvas
          </button>
          <button className="btn btn-sm btn-neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} disabled={saving} onClick={() => fileInputRef.current?.click()}>
            <Icon name="upload" size={12} /> Unggah Gambar
          </button>
          {signatureUrl && (
            <button className="btn btn-sm btn-danger" disabled={saving} onClick={removeSignature}>
              Hapus Tanda Tangan
            </button>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
        </div>
      </div>

      {isInvoiceManager && (
        <div className="card" style={{ maxWidth: 640, marginTop: 16 }}>
          <h3>Jabatan (untuk Invoice)</h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: -6, marginBottom: 14 }}>
            Jabatan ini muncul di bawah tanda tangan Anda saat invoice yang Anda approve dicetak. Tanda tangannya
            memakai gambar yang sama seperti di atas.
          </p>
          <input
            value={invoiceTitle}
            onChange={(e) => setInvoiceTitle(e.target.value)}
            placeholder="mis. Finance Manager"
            style={{ maxWidth: 320 }}
          />
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-primary" disabled={savingTitle} onClick={saveInvoiceTitle}>
              {savingTitle ? 'Menyimpan...' : 'Simpan Jabatan'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
