import Icon from '../icons.jsx'
import Portal from '../Portal.jsx'
import { useEscapeToClose } from '../hooks/useEscapeToClose.js'

// Pengganti alert() bawaan browser -- konsisten dengan gaya modal custom
// yang dipakai di seluruh aplikasi. Dipakai lokal per-komponen:
// const [alertMsg, setAlertMsg] = useState('')
// setAlertMsg('teks pesan') menggantikan alert('teks pesan')
// {alertMsg && <SimpleAlertModal text={alertMsg} onClose={() => setAlertMsg('')} />}
export default function SimpleAlertModal({ text, onClose }) {
  useEscapeToClose(onClose, true)
  const isError = /gagal|error/i.test(text)
  return (
    <Portal>
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-icon" style={{ color: isError ? 'var(--danger, #d9534f)' : 'var(--teal)' }}>
          <Icon name={isError ? 'x' : 'check'} size={28} />
        </div>
        <h3 className="confirm-title">{isError ? 'Terjadi Masalah' : 'Berhasil'}</h3>
        <p className="confirm-desc" style={{ whiteSpace: 'pre-line' }}>{text}</p>
        <div className="confirm-actions">
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
    </Portal>
  )
}
