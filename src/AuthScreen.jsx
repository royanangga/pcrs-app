import { useState } from 'react'
import { supabase } from './supabaseClient'

export default function AuthScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('Email atau password salah.')
    setLoading(false)
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-logo">PCRS</div>
        <h2 style={{ margin: '8px 0 4px' }}>Selamat Datang</h2>
        <div className="sub">Petty Cash Reimbursement System</div>

        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="email@perusahaan.com" />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} placeholder="••••••••" />

        {error && <div className="error-text">{error}</div>}

        <button className="btn btn-primary" style={{ width: '100%', marginTop: 16 }} disabled={loading}>
          {loading ? <><span className="spinner" />Masuk...</> : 'Login'}
        </button>

        <div className="login-note">Belum punya akun? Hubungi Admin untuk mendaftar.</div>
      </form>
    </div>
  )
}
