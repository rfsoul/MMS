/**
 * DashboardPage.jsx — MMS Web Admin
 *
 * help_desk_agent : SupervisoryDashboard — global issue overview across all companies
 * admin / manager : ContractorDashboard  — own company issues + WO queue
 * technician      : TechnicianDashboard  — own assigned WO queue only (issues denied)
 */
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext.jsx'
import { issues, workOrders } from '../services/api.js'
import { useNavigate } from 'react-router-dom'

// ─── Metadata ─────────────────────────────────────────────────

const ISSUE_STATUS_META = {
  open:           { label: 'Open',          color: '#64748b', bg: '#f1f5f9' },
  assigned:       { label: 'Assigned',      color: '#2563eb', bg: '#eff6ff' },
  inspecting:     { label: 'Inspecting',    color: '#d97706', bg: '#fffbeb' },
  follow_up_work: { label: 'Follow-up Work',color: '#7c3aed', bg: '#f5f3ff' },
  closed:         { label: 'Closed',        color: '#16a34a', bg: '#f0fdf4' },
}

const WO_STATUS_META = {
  open:        { label: 'Open',        color: '#64748b', bg: '#f1f5f9' },
  assigned:    { label: 'Assigned',    color: '#2563eb', bg: '#eff6ff' },
  in_progress: { label: 'In Progress', color: '#d97706', bg: '#fffbeb' },
  on_hold:     { label: 'On Hold',     color: '#7c3aed', bg: '#f5f3ff' },
  completed:   { label: 'Completed',   color: '#16a34a', bg: '#f0fdf4' },
}

const SEVERITY_META = {
  low:      { label: 'Low',      color: '#64748b', bg: '#f1f5f9' },
  medium:   { label: 'Medium',   color: '#d97706', bg: '#fffbeb' },
  high:     { label: 'High',     color: '#f97316', bg: '#fff7ed' },
  critical: { label: 'Critical', color: '#dc2626', bg: '#fef2f2' },
}

// ─── Shared UI ────────────────────────────────────────────────

function Badge({ meta }) {
  if (!meta) return null
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '2px 7px',
      borderRadius: 99, fontSize: 11, fontWeight: 600,
      color: meta.color, background: meta.bg,
    }}>{meta.label}</span>
  )
}

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
      <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--color-border)', borderTopColor: 'var(--color-sky)', animation: 'spin 0.7s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

function ErrorState({ message }) {
  return (
    <div style={{ padding: '20px 16px', textAlign: 'center', color: '#dc2626', fontSize: 13 }}>
      ⚠ {message}
    </div>
  )
}

function SummaryTile({ label, value, sub, color, icon, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: '#fff', border: '1px solid var(--color-border)', borderRadius: 10,
        padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'box-shadow 0.12s, border-color 0.12s',
      }}
      onMouseEnter={e => { if (onClick) { e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)'; e.currentTarget.style.borderColor = 'var(--color-sky)' }}}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = 'var(--color-border)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
        <span style={{ fontSize: 18 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: color ?? 'var(--color-text)', letterSpacing: '-0.02em', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>{sub}</div>}
    </div>
  )
}

function Card({ title, sub, action, actionLabel, children, loading, error, empty, emptyText }) {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
          {sub && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{sub}</div>}
        </div>
        {action && (
          <button onClick={action} style={{ fontSize: 12, color: 'var(--color-sky)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
            {actionLabel ?? 'View all →'}
          </button>
        )}
      </div>
      {loading  ? <Spinner /> :
       error    ? <ErrorState message={error} /> :
       empty    ? <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--color-text-faint)', fontSize: 13 }}>{emptyText ?? 'Nothing here'}</div> :
       children}
    </div>
  )
}

// ─── Row components ───────────────────────────────────────────

function IssueRow({ issue, onClick }) {
  const sev  = SEVERITY_META[issue.severity]
  const stat = ISSUE_STATUS_META[issue.status]
  return (
    <div
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid var(--color-border-soft)', cursor: 'pointer', transition: 'background 0.1s' }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      {sev && <div style={{ width: 3, height: 36, borderRadius: 2, background: sev.color, flexShrink: 0 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{issue.title}</div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
          #{issue.id}{issue.target_company_name ? ` · ${issue.target_company_name}` : ''}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {sev  && <Badge meta={sev} />}
        {stat && <Badge meta={stat} />}
      </div>
    </div>
  )
}

function WORow({ wo, onClick }) {
  const stat = WO_STATUS_META[wo.status]
  return (
    <div
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid var(--color-border-soft)', cursor: onClick ? 'pointer' : 'default', transition: 'background 0.1s' }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.background = 'var(--color-bg)' }}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wo.title}</div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
          WO-{wo.id}{wo.assigned_to_name ? ` · ${wo.assigned_to_name}` : ' · Unassigned'}
        </div>
      </div>
      {stat && <Badge meta={stat} />}
    </div>
  )
}

// ─── Supervisory Dashboard (help_desk_agent) ──────────────────

function SupervisoryDashboard() {
  const navigate = useNavigate()

  const { data: allIssues = [], isLoading, error } = useQuery({
    queryKey: ['issues', 'all'],
    queryFn: () => issues.list(),
  })

  const active   = allIssues.filter(i => i.status !== 'closed')
  const open     = allIssues.filter(i => i.status === 'open')
  const assigned = allIssues.filter(i => i.status === 'assigned')
  const critical = allIssues.filter(i => i.severity === 'critical' && i.status !== 'closed')

  // Hot list: critical first, then open unassigned — deduplicated, capped at 15
  const hotList = [
    ...allIssues.filter(i => i.severity === 'critical' && i.status !== 'closed'),
    ...allIssues.filter(i => i.status === 'open'       && i.severity !== 'critical'),
  ].slice(0, 15)

  // Per-company breakdown derived from issue list — no extra API call needed
  const byCompany = allIssues.reduce((acc, i) => {
    if (i.status === 'closed') return acc
    const key = i.target_company_name ?? `Company ${i.target_company_id}`
    if (!acc[key]) acc[key] = { active: 0, open: 0, critical: 0 }
    acc[key].active++
    if (i.status === 'open') acc[key].open++
    if (i.severity === 'critical') acc[key].critical++
    return acc
  }, {})

  const companyEntries = Object.entries(byCompany)

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 2 }}>Overview</h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Global issue status across all contractor companies</p>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', color: '#dc2626', fontSize: 13 }}>
          ⚠ Failed to load issues: {error.message}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <SummaryTile label="Active Issues"   value={isLoading ? '—' : active.length}   icon="📋" onClick={() => navigate('/issues')} />
        <SummaryTile label="Open"            value={isLoading ? '—' : open.length}     icon="🔵" color="#2563eb" onClick={() => navigate('/issues')} />
        <SummaryTile label="Assigned"        value={isLoading ? '—' : assigned.length} icon="🔄" color="#d97706" onClick={() => navigate('/issues')} />
        <SummaryTile
          label="Critical"
          value={isLoading ? '—' : critical.length}
          icon="🔴"
          color={critical.length > 0 ? '#dc2626' : '#64748b'}
          onClick={() => navigate('/issues')}
        />
      </div>

      <Card
        title="Hot List"
        sub="Critical severity and open unassigned issues requiring immediate attention"
        action={() => navigate('/issues')}
        actionLabel="All issues →"
        loading={isLoading}
        error={error?.message}
        empty={!isLoading && !error && hotList.length === 0}
        emptyText="No urgent issues — all clear ✓"
      >
        {hotList.map(i => <IssueRow key={i.id} issue={i} onClick={() => navigate('/issues')} />)}
      </Card>

      {!isLoading && companyEntries.length > 0 && (
        <Card title="By Contractor" sub="Active issue load per company">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {companyEntries.map(([name, counts]) => (
              <div key={name} style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border-soft)', borderRight: '1px solid var(--color-border-soft)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                <div style={{ display: 'flex', gap: 10, fontSize: 12 }}>
                  <span style={{ color: '#64748b' }}>{counts.active} active</span>
                  {counts.open     > 0 && <span style={{ color: '#2563eb' }}>{counts.open} open</span>}
                  {counts.critical > 0 && <span style={{ color: '#dc2626', fontWeight: 700 }}>⚠ {counts.critical} critical</span>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

// ─── Contractor Dashboard (admin / manager) ───────────────────

function ContractorDashboard() {
  const navigate = useNavigate()

  const { data: myIssues = [], isLoading: loadingIssues, error: issueError } = useQuery({
    queryKey: ['issues', 'mine'],
    queryFn: () => issues.list(),
  })

  const { data: myWOs = [], isLoading: loadingWOs, error: woError } = useQuery({
    queryKey: ['workOrders'],
    queryFn: () => workOrders.list(),
  })

  // Issues awaiting contractor action: assigned (need to start inspecting) + critical active
  const assignedIssues = myIssues.filter(i => i.status === 'assigned')
  const criticalIssues = myIssues.filter(i => i.severity === 'critical' && i.status !== 'closed')
  const activeIssues   = myIssues.filter(i => i.status !== 'closed')

  const openWOs        = myWOs.filter(w => w.status === 'open')
  const inProgressWOs  = myWOs.filter(w => w.status === 'in_progress')

  // Attention list: critical issues first, then newly assigned — no duplicates
  const issueAttentionList = [
    ...criticalIssues,
    ...assignedIssues.filter(i => i.severity !== 'critical'),
  ].slice(0, 10)

  const pendingWOs = myWOs
    .filter(w => ['open', 'assigned', 'in_progress'].includes(w.status))
    .slice(0, 10)

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 2 }}>Dashboard</h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Your company's current workload</p>
      </div>

      {(issueError || woError) && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', color: '#dc2626', fontSize: 13 }}>
          ⚠ {issueError?.message ?? woError?.message}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <SummaryTile label="Active Issues"   value={loadingIssues ? '—' : activeIssues.length}   icon="📋" onClick={() => navigate('/issues')} />
        <SummaryTile label="Assigned to You" value={loadingIssues ? '—' : assignedIssues.length} icon="📥" color="#2563eb" onClick={() => navigate('/issues')} />
        <SummaryTile label="Open WOs"        value={loadingWOs    ? '—' : openWOs.length}         icon="🔧" color="#d97706" onClick={() => navigate('/work-orders')} />
        <SummaryTile
          label="Critical Issues"
          value={loadingIssues ? '—' : criticalIssues.length}
          icon="🔴"
          color={criticalIssues.length > 0 ? '#dc2626' : '#64748b'}
          onClick={() => navigate('/issues')}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card
          title="Issues Requiring Attention"
          sub="Critical and newly assigned to your company"
          action={() => navigate('/issues')}
          actionLabel="All issues →"
          loading={loadingIssues}
          error={issueError?.message}
          empty={!loadingIssues && !issueError && issueAttentionList.length === 0}
          emptyText="No urgent issues ✓"
        >
          {issueAttentionList.map(i => <IssueRow key={i.id} issue={i} onClick={() => navigate('/issues')} />)}
        </Card>

        <Card
          title="Work Order Queue"
          sub="Open and in-progress work orders"
          action={() => navigate('/work-orders')}
          actionLabel="All WOs →"
          loading={loadingWOs}
          error={woError?.message}
          empty={!loadingWOs && !woError && pendingWOs.length === 0}
          emptyText="No pending work orders ✓"
        >
          {pendingWOs.map(w => <WORow key={w.id} wo={w} onClick={() => navigate('/work-orders')} />)}
        </Card>
      </div>
    </div>
  )
}

// ─── Technician Dashboard ─────────────────────────────────────
// Technicians are denied GET /issues — dashboard shows WO queue only

function TechnicianDashboard() {
  const navigate = useNavigate()

  const { data: myWOs = [], isLoading, error } = useQuery({
    queryKey: ['workOrders'],
    queryFn: () => workOrders.list(),
  })

  const assignedWOs   = myWOs.filter(w => w.status === 'assigned')
  const inProgressWOs = myWOs.filter(w => w.status === 'in_progress')
  const onHoldWOs     = myWOs.filter(w => w.status === 'on_hold')

  const activeWOs = myWOs
    .filter(w => ['assigned', 'in_progress', 'on_hold'].includes(w.status))
    .slice(0, 15)

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 2 }}>My Work Orders</h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Your assigned and active jobs</p>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', color: '#dc2626', fontSize: 13 }}>
          ⚠ Failed to load work orders: {error.message}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <SummaryTile label="Assigned"    value={isLoading ? '—' : assignedWOs.length}   icon="📋" color="#2563eb" onClick={() => navigate('/work-orders')} />
        <SummaryTile label="In Progress" value={isLoading ? '—' : inProgressWOs.length} icon="⚙️" color="#d97706" onClick={() => navigate('/work-orders')} />
        <SummaryTile label="On Hold"     value={isLoading ? '—' : onHoldWOs.length}     icon="⏸️" color="#7c3aed" onClick={() => navigate('/work-orders')} />
      </div>

      <Card
        title="Active Jobs"
        sub="Assigned, in-progress, and on-hold work orders"
        action={() => navigate('/work-orders')}
        actionLabel="All WOs →"
        loading={isLoading}
        error={error?.message}
        empty={!isLoading && !error && activeWOs.length === 0}
        emptyText="No active work orders — queue is clear ✓"
      >
        {activeWOs.map(w => <WORow key={w.id} wo={w} onClick={() => navigate('/work-orders')} />)}
      </Card>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth()
  const role = user?.role

  if (role === 'help_desk_agent') return <SupervisoryDashboard />
  if (role === 'technician')      return <TechnicianDashboard />
  return <ContractorDashboard />
}
