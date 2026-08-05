import { useEffect } from 'react'

// Tutup modal manapun dengan tombol Escape. Dipakai di setiap komponen yang
// punya modal -- `active` menentukan listener cuma terpasang saat modal itu
// benar-benar terbuka, `onClose` adalah aksi penutup yang sama persis dengan
// yang dipakai tombol/klik-overlay-nya (termasuk guard `!saving`/`!processing`
// kalau ada, supaya konsisten -- tidak bisa ditutup paksa saat proses berjalan).
export function useEscapeToClose(onClose, active) {
  useEffect(() => {
    if (!active) return
    function handler(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active, onClose])
}
