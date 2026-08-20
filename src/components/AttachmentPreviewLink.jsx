import { useState } from 'react'
import { supabase } from '../supabaseClient'
import Icon from '../icons.jsx'
import Portal from '../Portal.jsx'
import { useEscapeToClose } from '../hooks/useEscapeToClose.js'
import { attachmentUrl } from '../lib/helpers.js'

// Link attachment yang membuka PREVIEW di dalam modal (gambar/PDF ditampilkan
// langsung), bukan <a target="_blank"> yang membuka tab baru dan memperlihatkan
// URL storage-nya di address bar.
export default function AttachmentPreviewLink({ a }) {
  const [open, setOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  useEscapeToClose(() => setOpen(false), open)
  const url = attachmentUrl(a.file_path)
  const isImage = /\.(png|jpe?g|gif|webp)$/i.test(a.file_name || '')
  const isPdf = /\.pdf$/i.test(a.file_name || '')

  // Download lewat blob (bukan cuma <a href download> ke URL publik lintas-origin,
  // yang di banyak browser diabaikan/malah dibuka di tab baru). Blob URL selalu
  // bersifat same-origin, jadi atribut `download` pasti dihormati browser.
  async function handleDownload() {
    setDownloading(true)
    const { data, error } = await supabase.storage.from('receipts').download(a.file_path)
    setDownloading(false)
    if (error || !data) return
    const blobUrl = URL.createObjectURL(data)
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = a.file_name || 'lampiran'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(blobUrl)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ background: 'none', border: 'none', padding: 0, color: 'var(--teal)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit', textAlign: 'left' }}
      >
        {a.file_name}
      </button>
      {open && (
        <Portal>
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal-box" style={{ width: 640, maxWidth: '96vw' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-close" onClick={() => setOpen(false)}><Icon name="x" size={16} /></div>
            <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: 15 }}>{a.file_name}</h3>
            <button
              type="button"
              className="btn btn-sm btn-neutral"
              style={{ marginBottom: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}
              onClick={handleDownload}
              disabled={downloading}
            >
              <Icon name="download" size={12} /> {downloading ? 'Mengunduh...' : 'Download'}
            </button>
            {isImage ? (
              <img src={url} alt={a.file_name} style={{ maxWidth: '100%', maxHeight: '70vh', display: 'block', margin: '0 auto', borderRadius: 8 }} />
            ) : isPdf ? (
              <iframe src={url} title={a.file_name} style={{ width: '100%', height: '70vh', border: 'none', borderRadius: 8 }} />
            ) : (
              <div className="checklist-line">Preview tidak didukung untuk tipe file ini -- gunakan tombol Download di atas.</div>
            )}
          </div>
        </div>
        </Portal>
      )}
    </>
  )
}
