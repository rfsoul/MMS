function Placeholder({ title, icon, description }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--color-text-faint)' }}>
      <div style={{ fontSize: 52 }}>{icon}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-border)', fontFamily: 'var(--font-serif)' }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--color-text-faint)' }}>{description}</div>
    </div>
  )
}

export function PMPage() {
  return <Placeholder title="PM Schedules" icon="🔄" description="Calendar and runtime-based preventive maintenance scheduling" />
}

export function AssetsPage() {
  return <Placeholder title="Assets" icon="🏗️" description="Asset graph, hierarchy, and checklist management" />
}

export function ReportsPage() {
  return <Placeholder title="Reports" icon="📊" description="Work order analytics, compliance, and performance reporting" />
}

export function SettingsPage() {
  return <Placeholder title="Settings" icon="⚙️" description="Users, roles, and company configuration" />
}
