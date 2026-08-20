import { createPortal } from 'react-dom'

// ---- REUSABLE: portal ----
// Merender children langsung ke document.body, di luar hierarki DOM
// .app-shell. Ini wajib dipakai untuk semua .modal-overlay: karena
// .app-shell punya overflow-x:hidden (yang memaksa overflow-y jadi
// auto), sebagian browser (terutama Chrome) menjadikan .app-shell
// sebagai scroll-container-nya sendiri dan "mengurung" descendant
// position:fixed di dalamnya — akibatnya pop-up tidak menutupi
// seluruh layar (header/bagian atas halaman lolos dari overlay).
// Dengan portal ke document.body, modal-overlay selalu fixed relatif
// terhadap viewport browser yang sesungguhnya.
export default function Portal({ children }) {
  return createPortal(children, document.body)
}
