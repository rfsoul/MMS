import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { workOrders } from '../../services/api.js'

const CARD = {
  background: 'white',
  border: '1px solid var(--color-border)',
  borderRadius: 10,
  padding: 16,
}

function Metric({ label, value, hint }) {
  return (
    <div style={CARD}>
      <div style={{ fontSize: 12, color: 'var(--color-text-faint)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--color-text)' }}>{value}</div>
      {hint ? <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>{hint}</div> : null}
    </div>
  )
}

export default function ReportsPage() {
  const { data: woList = [], isLoading, error } = useQuery({
    queryKey: ['reports', 'workOrders'],
    queryFn: () => workOrders.list(),
  })

  const analytics = useMemo(() => {
    const byStatus = { open: 0, assigned: 0, in_progress: 0, on_hold: 0, completed: 0 }
    const byPriority = { low: 0, medium: 0, high: 0, critical: 0 }

    let completedWithDuration = 0
    let totalDurationMinutes = 0

    for (const wo of woList) {
      if (byStatus[wo.status] !== undefined) byStatus[wo.status] += 1
      if (byPriority[wo.priority] !== undefined) byPriority[wo.priority] += 1

      const minutes = Number(wo.actual_duration_minutes)
      if (wo.status === 'completed' && Number.isFinite(minutes) && minutes > 0) {
        totalDurationMinutes += minutes
        completedWithDuration += 1
      }
    }

    const total = woList.length
    const completed = byStatus.completed
    const completionRate = total ? Math.round((completed / total) * 100) : 0
    const avgDuration = completedWithDuration ? Math.round(totalDurationMinutes / completedWithDuration) : 0

    return { byStatus, byPriority, total, completed, completionRate, avgDuration }
  }, [woList])

  return (
    <section style={{ padding: 24 }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>Analytics</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-text-faint)' }}>
          MMS operational snapshot based on current work order data.
        </p>
      </div>

      {isLoading ? <div style={CARD}>Loading analytics…</div> : null}
      {error ? <div style={{ ...CARD, color: '#b91c1c' }}>Failed to load analytics: {error.message}</div> : null}

      {!isLoading && !error ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 12 }}>
            <Metric label="Total work orders" value={analytics.total} />
            <Metric label="Completed" value={analytics.completed} hint={`Completion rate: ${analytics.completionRate}%`} />
            <Metric label="In progress" value={analytics.byStatus.in_progress} />
            <Metric label="Avg completion duration" value={analytics.avgDuration ? `${analytics.avgDuration}m` : '—'} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={CARD}>
              <h2 style={{ margin: '0 0 8px', fontSize: 15 }}>Work order status breakdown</h2>
              {Object.entries(analytics.byStatus).map(([status, count]) => (
                <div key={status} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderTop: '1px solid var(--color-border-soft)' }}>
                  <span>{status.replace('_', ' ')}</span>
                  <strong>{count}</strong>
                </div>
              ))}
            </div>

            <div style={CARD}>
              <h2 style={{ margin: '0 0 8px', fontSize: 15 }}>Priority distribution</h2>
              {Object.entries(analytics.byPriority).map(([priority, count]) => (
                <div key={priority} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderTop: '1px solid var(--color-border-soft)' }}>
                  <span>{priority}</span>
                  <strong>{count}</strong>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </section>
  )
}
