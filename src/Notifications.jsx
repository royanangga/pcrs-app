import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from './supabaseClient'
import Icon from './icons.jsx'

// Notifikasi in-app untuk PENGAJU: memberi tahu kalau pengajuan reimbursement
// miliknya sendiri baru saja disetujui/ditolak/perlu revisi/dicairkan, tanpa
// harus buka menu "Pengajuan Saya" satu-satu untuk cek manual.
//
// Sumber data: tabel `approval_history`, difilter ke reimbursement milik user
// yang sedang login. Tidak menambah tabel baru di database — status
// "sudah dibaca" disimpan di localStorage per user (cukup untuk kebutuhan
// badge counter, tidak perlu sinkron lintas device).

const NOTIF_ACTION_LABEL = {
  approved: 'disetujui',
  rejected: 'ditolak',
  revision: 'perlu direvisi',
  finance_approved: 'disetujui Finance Manager',
  verified: 'sudah dicairkan (terverifikasi)',
}

const NOTIF_ACTION_ICON = {
  approved: 'check',
  rejected: 'x',
  revision: 'edit',
  finance_approved: 'check',
  verified: 'wallet',
}

// Aksi approval yang relevan dinotifikasikan ke pengaju. 'submitted' sengaja
// tidak disertakan karena itu aksi pengaju sendiri (dia sudah tahu).
const NOTIFIABLE_ACTIONS = ['approved', 'rejected', 'revision', 'finance_approved', 'verified']

function seenKey(userId) { return `pcrs_notif_seen_${userId}` }

export function useNotifications(profile, refreshKey) {
  const [items, setItems] = useState([])
  const [lastSeen, setLastSeen] = useState(() => localStorage.getItem(seenKey(profile.id)))

  const load = useCallback(async () => {
    // Ambil dulu reimbursement milik user ini (bukan lewat join eq — pola ini
    // konsisten dengan komponen lain di App.jsx yang menghindari filter join
    // langsung karena tidak selalu bisa diandalkan di Supabase).
    const { data: myReimbs } = await supabase
      .from('reimbursements')
      .select('id, request_no')
      .eq('employee_id', profile.id)
    const ids = (myReimbs || []).map((r) => r.id)
    if (ids.length === 0) { setItems([]); return }

    const reqMap = {}
    ;(myReimbs || []).forEach((r) => { reqMap[r.id] = r.request_no })

    const { data: hist } = await supabase
      .from('approval_history')
      .select('*')
      .in('reimbursement_id', ids)
      .in('action', NOTIFIABLE_ACTIONS)
      .order('created_at', { ascending: false })
      .limit(30)

    const approverIds = [...new Set((hist || []).map((h) => h.approver_id).filter(Boolean))]
    let approverMap = {}
    if (approverIds.length) {
      const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', approverIds)
      ;(profs || []).forEach((p) => { approverMap[p.id] = p.full_name })
    }

    setItems((hist || []).map((h) => ({
      id: h.id,
      action: h.action,
      requestNo: reqMap[h.reimbursement_id] || '—',
      approverName: approverMap[h.approver_id] || null,
      notes: h.notes,
      createdAt: h.created_at,
    })))
  }, [profile.id])

  useEffect(() => { load() }, [load, refreshKey])

  const unreadCount = items.filter((it) => !lastSeen || new Date(it.createdAt).getTime() > new Date(lastSeen).getTime()).length

  const markAllRead = useCallback(() => {
    const now = new Date().toISOString()
    localStorage.setItem(seenKey(profile.id), now)
    setLastSeen(now)
  }, [profile.id])

  return { items, unreadCount, markAllRead }
}

export default function NotificationBell({ profile, refreshKey, onNavigate }) {
  const { items, unreadCount, markAllRead } = useNotifications(profile, refreshKey)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    function onClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function toggleOpen() {
    setOpen((o) => {
      const next = !o
      if (next) markAllRead()
      return next
    })
  }

  return (
    <div className="notif-bell-wrap" ref={wrapRef}>
      <button className="notif-bell-btn" onClick={toggleOpen} title="Notifikasi">
        <Icon name="bell" size={18} />
        {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {open && (
        <div className="notif-dropdown">
          <div className="notif-dropdown-title">Notifikasi</div>
          {items.length === 0 ? (
            <div className="notif-empty">Belum ada notifikasi.</div>
          ) : (
            <div className="notif-list">
              {items.map((it) => (
                <button
                  key={it.id}
                  className="notif-item"
                  onClick={() => { setOpen(false); onNavigate && onNavigate('mine') }}
                >
                  <span className="notif-item-icon"><Icon name={NOTIF_ACTION_ICON[it.action] || 'bell'} size={15} /></span>
                  <span className="notif-item-body">
                    <span className="notif-item-text">
                      Pengajuan <strong>{it.requestNo}</strong> {NOTIF_ACTION_LABEL[it.action] || it.action}
                      {it.approverName ? ` oleh ${it.approverName}` : ''}
                    </span>
                    <span className="notif-item-time">{new Date(it.createdAt).toLocaleString('id-ID')}</span>
                    {it.notes && <span className="notif-item-notes">"{it.notes}"</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
