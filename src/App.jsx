import { useEffect, useState, useCallback } from 'react'
import { supabase } from './supabaseClient'
import AdminPanel from './AdminPanel.jsx'
import NotificationBell from './Notifications.jsx'
import { Ico } from './icons.jsx'

import AuthScreen from './AuthScreen.jsx'
import MyProfile from './pages/MyProfile.jsx'
import CashFlowReport from './pages/CashFlowReport.jsx'
import CashBalance from './pages/CashBalance.jsx'
import FinanceVerification from './pages/FinanceVerification.jsx'
import ApprovalQueue from './pages/ApprovalQueue.jsx'
import Dashboard from './pages/Dashboard.jsx'
import SubmitForm from './pages/SubmitForm.jsx'
import MyRequests from './pages/MyRequests.jsx'
import InvoiceList from './pages/Invoice/InvoiceList.jsx'
import InvoiceApproval from './pages/Invoice/InvoiceApproval.jsx'
import InvoiceSettings from './pages/Invoice/InvoiceSettings.jsx'
import { isFinanceUser } from './lib/helpers.js'

// SubmitForm dipindah ke src/pages/SubmitForm.jsx
// MyRequests dipindah ke src/pages/MyRequests.jsx
// (lihat import keduanya di atas)

const PAGE_TITLE = {
  dashboard:              'Dashboard',
  'submit-reimbursement': 'Submit Reimbursement',
  'submit-kas':           'Saldo Kas',
  mine:                   'Pengajuan Saya',
  approval:               'Approval',
  finance:                'Finance Verification',
  'cash-flow-report':     'Laporan Arus Kas',
  admin:                  'Admin Panel',
  signature:              'Tanda Tangan Saya',
  'invoice-list':         'Daftar Invoice',
  'invoice-approval':     'Approval Invoice',
  'invoice-settings':     'Pengaturan Invoice',
}

export default function App() {
  const [session, setSession]       = useState(null)
  const [profile, setProfile]       = useState(null)
  const [tab, setTab]               = useState('dashboard')
  const [refreshKey, setRefreshKey] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [openGroups, setOpenGroups] = useState({ submit: true, invoice: true })
  const [mobileGroup, setMobileGroup] = useState(null) // key grup yang sheet-nya sedang terbuka di mobile
  const bump = useCallback(() => setRefreshKey((k) => k + 1), [])

  // ---- DARK MODE ----
  // Preferensi disimpan di localStorage; kalau belum pernah diset, ikuti
  // preferensi sistem (prefers-color-scheme). Class "dark" ditaruh di
  // <html> (bukan hanya .app-shell) supaya layar login yang tampil
  // sebelum ada session pun ikut menyesuaikan.
  const [darkMode, setDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('pcrs-theme')
      if (saved) return saved === 'dark'
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    } catch {
      return false
    }
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    try { localStorage.setItem('pcrs-theme', darkMode ? 'dark' : 'light') } catch {}
  }, [darkMode])

  const toggleDarkMode = useCallback(() => setDarkMode((d) => !d), [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const loadProfile = useCallback(async () => {
    if (!session) { setProfile(null); return }
    const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
    // Jaga-jaga: kalau akun sudah ditandai resign tapi masih sempat punya sesi aktif
    // (mis. ban belum diproses / sesi lama sebelum dinonaktifkan), paksa sign-out.
    if (data?.status === 'resigned') {
      await supabase.auth.signOut()
      setProfile(null)
      return
    }
    setProfile(data)
  }, [session])

  useEffect(() => { loadProfile() }, [loadProfile])

  // ---- REALTIME: auto-refresh saat ada perubahan data dari user lain ----
  // Tanpa ini, approver B baru approve pengajuan tidak akan otomatis
  // terlihat oleh approver C yang sedang membuka halaman Approval/Dashboard
  // yang sama — mereka harus refresh manual. Dengan subscribe ke perubahan
  // tabel-tabel inti (reimbursements, approval_history, cash_topups), setiap
  // INSERT/UPDATE/DELETE dari siapa pun akan memicu `bump()`, yang otomatis
  // mem-refresh semua komponen yang bergantung pada `refreshKey` (Dashboard,
  // ApprovalQueue, FinanceVerification, CashBalance, CashFlowReport, dst).
  //
  // CATATAN: fitur Realtime harus AKTIF di Supabase untuk tabel-tabel ini
  // (Dashboard Supabase -> Database -> Replication). Kalau belum aktif,
  // subscribe ini tidak error, hanya tidak menerima event apa pun (fallback-
  // nya tetap load manual seperti biasa saat pindah tab/refresh halaman).
  useEffect(() => {
    if (!session) return
    const channel = supabase
      .channel('pcrs-realtime-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reimbursements' }, () => bump())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'approval_history' }, () => bump())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_topups' }, () => bump())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [session, bump])

  if (!session) return <AuthScreen />
  if (!profile) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
        <div style={{ width: 36, height: 36, border: '3px solid #e3e6ea', borderTopColor: 'var(--teal)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 12px' }} />
        Memuat profil...
      </div>
    </div>
  )

  // Approval Finance Manager (tahap sebelum pencairan) sudah digabung ke dalam
  // menu "Approval" biasa — Manager Departemen Finance / Admin otomatis melihat
  // pengajuan lintas departemen di tahap itu juga saat membuka menu Approval.
  const isApprover = ['supervisor', 'manager', 'admin'].includes(profile.role)
  const isFinance  = isFinanceUser(profile)
  const isInvoiceUser    = ['staff', 'manager'].includes(profile.invoice_role) || profile.role === 'admin'
  const isInvoiceManager = profile.invoice_role === 'manager' || profile.role === 'admin'

  function navigate(key) {
    setTab(key)
    setSidebarOpen(false)
    setMobileGroup(null)
  }

  const navItems = [
    { key: 'dashboard', label: 'Dashboard',             icon: Ico.dashboard, show: true },
    {
      key: 'submit', label: 'Submit', icon: Ico.submit, show: true,
      children: [
        { key: 'submit-reimbursement', label: 'Submit Reimbursement', show: true },
        { key: 'submit-kas',           label: 'Submit Kas',           show: isFinance },
      ].filter((c) => c.show),
    },
    { key: 'mine',      label: 'Pengajuan Saya',        icon: Ico.mine,      show: true },
    { key: 'approval',  label: 'Approval',              icon: Ico.approval,  show: isApprover },
    { key: 'finance',   label: 'Finance Verification',  icon: Ico.finance,   show: isFinance },
    // Menu terpisah, khusus department Finance — bukan bagian dari submenu
    // "Submit" karena ini murni laporan (bukan aksi submit/isi ulang).
    { key: 'cash-flow-report', label: 'Laporan Arus Kas', icon: Ico.cash,    show: isFinance },
    { key: 'signature', label: 'Tanda Tangan Saya',      icon: Ico.signature, show: true },
    {
      key: 'invoice', label: 'Invoice', icon: Ico.invoice, show: isInvoiceUser,
      children: [
        { key: 'invoice-list',     label: 'Daftar Invoice',     show: true },
        { key: 'invoice-approval', label: 'Approval Invoice',   show: isInvoiceManager },
        { key: 'invoice-settings', label: 'Pengaturan Invoice', show: true },
      ].filter((c) => c.show),
    },
    { key: 'admin',     label: 'Admin Panel',           icon: Ico.admin,     show: profile.role === 'admin', accent: true },
  ].filter((n) => n.show)

  const roleColors = {
    employee: '#6fd6c8', supervisor: '#f6c90e', manager: '#f6a40e', admin: '#fd79a8',
  }
  const roleColor = roleColors[profile.role] || '#ccc'

  return (
    <div className={`app-shell ${sidebarOpen ? 'sidebar-open' : ''}`}>

      {/* ---- SIDEBAR ---- */}
      <aside className="sidebar">
        {/* Brand */}
        <div className="sidebar-brand">
          <div className="sidebar-logo">PCRS</div>
          <div className="sidebar-brand-sub">Petty Cash System</div>
        </div>

        {/* Nav */}
        <nav className="sidebar-nav">
          {navItems.map((n) => {
            if (n.children) {
              const groupActive = n.children.some((c) => c.key === tab)
              return (
                <div key={n.key} className="nav-group">
                  <button
                    className={`nav-item nav-item-parent ${groupActive ? 'active' : ''}`}
                    onClick={() => setOpenGroups((o) => ({ ...o, [n.key]: !o[n.key] }))}
                  >
                    <span className="nav-icon">{n.icon}</span>
                    <span className="nav-label">{n.label}</span>
                    <span className={`nav-chevron ${openGroups[n.key] ? 'open' : ''}`}>&#9662;</span>
                  </button>
                  {openGroups[n.key] && (
                    <div className="nav-submenu">
                      {n.children.map((c) => (
                        <button
                          key={c.key}
                          className={`nav-subitem ${tab === c.key ? 'active' : ''}`}
                          onClick={() => navigate(c.key)}
                        >
                          <span className="nav-label">{c.label}</span>
                          {tab === c.key && <span className="nav-active-bar" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            }
            return (
              <button
                key={n.key}
                className={`nav-item ${tab === n.key ? 'active' : ''} ${n.accent ? 'accent' : ''}`}
                onClick={() => navigate(n.key)}
              >
                <span className="nav-icon">{n.icon}</span>
                <span className="nav-label">{n.label}</span>
                {tab === n.key && <span className="nav-active-bar" />}
              </button>
            )
          })}
        </nav>

        {/* User info + logout */}
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-avatar" style={{ background: roleColor }}>
              {profile.full_name.charAt(0).toUpperCase()}
            </div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{profile.full_name}</div>
              <div className="sidebar-user-role">{profile.role} · {profile.department}</div>
            </div>
          </div>
          <button className="sidebar-logout" onClick={() => supabase.auth.signOut()} title="Logout">
            {Ico.logout}
          </button>
        </div>
      </aside>

      {/* Overlay (mobile only) */}
      <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />

      {/* ---- MOBILE BOTTOM NAV (freeze/fixed di bawah, horizontal) ---- */}
      <nav className="bottom-nav">
        {navItems.map((n) => {
          if (n.children) {
            const groupActive = n.children.some((c) => c.key === tab)
            return (
              <button
                key={n.key}
                className={`bottom-nav-item ${groupActive ? 'active' : ''}`}
                onClick={() => setMobileGroup((k) => (k === n.key ? null : n.key))}
              >
                <span className="bottom-nav-icon">{n.icon}</span>
                <span className="bottom-nav-label">{n.label}</span>
              </button>
            )
          }
          return (
            <button
              key={n.key}
              className={`bottom-nav-item ${tab === n.key ? 'active' : ''} ${n.accent ? 'accent' : ''}`}
              onClick={() => navigate(n.key)}
            >
              <span className="bottom-nav-icon">{n.icon}</span>
              <span className="bottom-nav-label">{n.label}</span>
            </button>
          )
        })}
      </nav>

      {/* Sheet submenu mobile untuk grup "Submit" (dipicu dari bottom nav) */}
      {mobileGroup && (
        <>
          <div className="bottom-sheet-overlay" onClick={() => setMobileGroup(null)} />
          <div className="bottom-sheet">
            {navItems.find((n) => n.key === mobileGroup)?.children.map((c) => (
              <button
                key={c.key}
                className={`bottom-sheet-item ${tab === c.key ? 'active' : ''}`}
                onClick={() => navigate(c.key)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* ---- MAIN CONTENT ---- */}
      <div className="main-content">
        {/* Mobile topbar */}
        <div className="mobile-header">
          <button className="hamburger" onClick={() => setSidebarOpen(true)}>{Ico.menu}</button>
          <div className="mobile-title">{PAGE_TITLE[tab]}</div>
          <div className="mobile-header-actions">
            <button className="theme-toggle theme-toggle-mobile" onClick={toggleDarkMode} title={darkMode ? 'Ganti ke Mode Terang' : 'Ganti ke Mode Gelap'}>
              {darkMode ? Ico.sun : Ico.moon}
            </button>
            <NotificationBell profile={profile} refreshKey={refreshKey} onNavigate={navigate} />
            <button className="mobile-logout" onClick={() => supabase.auth.signOut()} title="Logout">
              {Ico.logout}
            </button>
          </div>
        </div>

        {/* Page header (desktop) */}
        <div className="page-header">
          <div>
            <h1 className="page-title">{PAGE_TITLE[tab]}</h1>
            <div className="page-breadcrumb">PCRS / {PAGE_TITLE[tab]}</div>
          </div>
          <div className="page-header-actions">
            <button className="theme-toggle" onClick={toggleDarkMode} title={darkMode ? 'Ganti ke Mode Terang' : 'Ganti ke Mode Gelap'}>
              {darkMode ? Ico.sun : Ico.moon}
            </button>
            <NotificationBell profile={profile} refreshKey={refreshKey} onNavigate={navigate} />
          </div>
        </div>

        <div className="content-area">
          <div className="tab-content" key={tab}>
            {tab === 'dashboard'              && <Dashboard refreshKey={refreshKey} profile={profile} />}
            {tab === 'submit-reimbursement'   && <SubmitForm profile={profile} onSubmitted={bump} />}
            {tab === 'submit-kas'             && isFinance  && <CashBalance profile={profile} refreshKey={refreshKey} onActed={bump} />}
            {tab === 'mine'                   && <MyRequests profile={profile} refreshKey={refreshKey} onRefresh={bump} />}
            {tab === 'approval'               && isApprover && <ApprovalQueue profile={profile} refreshKey={refreshKey} onActed={bump} />}
            {tab === 'finance'                && isFinance  && <FinanceVerification profile={profile} refreshKey={refreshKey} onActed={bump} />}
            {tab === 'cash-flow-report'       && isFinance  && <CashFlowReport profile={profile} refreshKey={refreshKey} />}
            {tab === 'admin'                  && profile.role === 'admin' && <AdminPanel />}
            {tab === 'signature' && <MyProfile profile={profile} onUpdated={loadProfile} />}
            {tab === 'invoice-list'     && isInvoiceUser    && <InvoiceList profile={profile} />}
            {tab === 'invoice-approval' && isInvoiceManager && <InvoiceApproval profile={profile} />}
            {tab === 'invoice-settings' && isInvoiceUser    && <InvoiceSettings profile={profile} onProfileUpdated={loadProfile} />}
          </div>
        </div>
      </div>
    </div>
  )
}
