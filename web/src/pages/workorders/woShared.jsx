// Shared display constants and primitive UI components for Work Orders

export const STATUS_META = {
  open:        { label: 'Open',        color: 'var(--color-open)',     bg: 'var(--color-open-bg)'     },
  assigned:    { label: 'Assigned',    color: 'var(--color-assigned)', bg: 'var(--color-assigned-bg)' },
  in_progress: { label: 'In Progress', color: 'var(--color-progress)', bg: 'var(--color-progress-bg)' },
  on_hold:     { label: 'On Hold',     color: 'var(--color-hold)',     bg: 'var(--color-hold-bg)'     },
  completed:   { label: 'Completed',   color: 'var(--color-done)',     bg: 'var(--color-done-bg)'     },
}

export const PRIORITY_META = {
  low:      { label: 'Low',      dot: '#94a3b8'               },
  medium:   { label: 'Medium',   dot: '#64748b'               },
  high:     { label: 'High',     dot: 'var(--color-high)'     },
  critical: { label: 'Critical', dot: 'var(--color-critical)' },
}

export const TYPE_META = {
  pm:          { label: 'PM',          icon: '🔄' },
  inspection:  { label: 'Inspection',  icon: '🔍' },
  corrective:  { label: 'Corrective',  icon: '🔧' },
  replacement: { label: 'Replacement', icon: '📦' },
}

export function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.open
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 9px', borderRadius: 20,
      fontSize: 11, fontWeight: 600, letterSpacing: '0.02em',
      color: m.color, background: m.bg,
    }}>
      {m.label}
    </span>
  )
}

export function PriorityDot({ priority }) {
  const m = PRIORITY_META[priority] || PRIORITY_META.low
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--color-text-muted)' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: m.dot, display: 'inline-block', flexShrink: 0 }} />
      {m.label}
    </span>
  )
}

export function Avatar({ name = '?', size = 28 }) {
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  const hue = (name.charCodeAt(0) * 17) % 360
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%',
      background: `hsl(${hue},55%,88%)`, color: `hsl(${hue},50%,35%)`,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 700, flexShrink: 0,
    }}>{initials}</span>
  )
}

export function FieldLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: 'var(--color-text-faint)',
      letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5,
    }}>
      {children}
    </div>
  )
}

export function Spinner() {
  return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--color-text-faint)', fontSize: 13, gap: 10,
    }}>
      <span style={{
        display: 'inline-block', width: 16, height: 16,
        border: '2px solid #e2e8f0', borderTopColor: 'var(--color-sky)',
        borderRadius: '50%', animation: 'spin 0.7s linear infinite',
      }} />
      Loading…
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
