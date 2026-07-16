import React from 'react'

// Komponen chart SVG murni (tanpa library eksternal) supaya tidak perlu
// tambah dependency baru di package.json. Dipakai di Dashboard untuk
// menampilkan tren pengeluaran bulanan & distribusi per kategori.

const PALETTE = ['#4f46e5', '#f59e0b', '#f43f5e', '#3b82f6', '#8b5cf6', '#10b981', '#64748b', '#a855f7']

function rupiahShort(n) {
  const v = Number(n) || 0
  if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'jt'
  if (v >= 1_000) return (v / 1_000).toFixed(0) + 'rb'
  return String(v)
}

// Bar chart vertikal sederhana. `data` = [{ label, value }]
export function MonthlyBarChart({ data, height = 200 }) {
  if (!data || data.every((d) => d.value === 0)) {
    return <div className="chart-empty">Belum ada data terverifikasi pada periode ini.</div>
  }
  const max = Math.max(...data.map((d) => d.value), 1)
  const padTop = 26
  const padBottom = 26
  const chartH = height - padTop - padBottom
  const colW = 60

  return (
    <svg viewBox={`0 0 ${data.length * colW} ${height}`} className="chart-svg" preserveAspectRatio="xMidYMid meet">
      {data.map((d, i) => {
        const barH = max > 0 ? (d.value / max) * chartH : 0
        const x = i * colW + 10
        const y = padTop + (chartH - barH)
        return (
          <g key={i}>
            <rect
              x={x} y={y} width={colW - 20} height={Math.max(barH, 2)} rx={5}
              fill="var(--teal)" opacity={d.value > 0 ? 1 : 0.15}
            />
            {d.value > 0 && (
              <text x={x + (colW - 20) / 2} y={y - 7} textAnchor="middle" fontSize="10" fill="var(--text-muted)">
                {rupiahShort(d.value)}
              </text>
            )}
            <text x={x + (colW - 20) / 2} y={height - 8} textAnchor="middle" fontSize="10" fill="var(--text-muted)">
              {d.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// Donut chart sederhana untuk distribusi per kategori. `data` = [{ label, value }]
export function CategoryDonutChart({ data, size = 168 }) {
  const total = (data || []).reduce((s, d) => s + d.value, 0)
  if (!data || data.length === 0 || total <= 0) {
    return <div className="chart-empty">Belum ada data terverifikasi pada periode ini.</div>
  }
  const r = size / 2
  const strokeW = size * 0.24
  const innerR = r - strokeW / 2
  const circumference = 2 * Math.PI * innerR

  let offset = 0
  const segments = data.map((d, i) => {
    const frac = d.value / total
    const dash = frac * circumference
    const seg = {
      color: PALETTE[i % PALETTE.length],
      dasharray: `${dash} ${Math.max(circumference - dash, 0)}`,
      dashoffset: -offset,
      label: d.label,
      value: d.value,
      pct: frac * 100,
    }
    offset += dash
    return seg
  })

  return (
    <div className="donut-wrap">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="chart-svg">
        <g transform={`rotate(-90 ${r} ${r})`}>
          {segments.map((s, i) => (
            <circle
              key={i}
              cx={r} cy={r} r={innerR}
              fill="none"
              stroke={s.color}
              strokeWidth={strokeW}
              strokeDasharray={s.dasharray}
              strokeDashoffset={s.dashoffset}
            />
          ))}
        </g>
      </svg>
      <div className="donut-legend">
        {segments.map((s, i) => (
          <div className="donut-legend-item" key={i}>
            <span className="donut-legend-dot" style={{ background: s.color }} />
            <span className="donut-legend-label">{s.label}</span>
            <span className="donut-legend-pct">{s.pct.toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
