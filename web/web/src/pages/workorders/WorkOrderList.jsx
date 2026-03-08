import { useState, useMemo } from 'react'
import { StatusBadge, PriorityDot, Avatar, Spinner, STATUS_META, TYPE_META } from './woShared.jsx'

function WORow({ wo, selected, onClick }) {
  const isSelected = selected?.id === wo.id
  return (
    <div
      onClick={() => onClick(wo)}
      style={{
        display: 'grid',
        gridTemplateColumns: '32px 1fr 110px 80px 90px 130px 60px',
        alignItems: 'center', gap: 8,
        padding: '11px 18px', cursor: 'pointer',
        background: isSelected ? '#f0f9ff' : 'white',
        borderBottom: '1px solid var(--color-border-soft)',
        borderLeft: isSelected ? '3px solid var(--color-sky)' : '3px solid transparent',
        transition: 'background 0.1s',
      }}
    >
      <span style={{ fontSize: 15, textAlign: 'center' }}>{TYPE_META[wo.type]?.icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {wo.title}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: 1 }}>
          {wo.id} · {wo.asset_label || wo.asset_graph_id || '—'}
        </div>
      </div>
      <StatusBadge status={wo.status} />
      <PriorityDot priority={wo.priority} />
      <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{TYPE_META[wo.type]?.label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        {wo.assigned_to_name
          ? <>
              <Avatar name={wo.assigned_to_name} size={22} />
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {wo.assigned_to_name.split(' ')[0]}
              </span>
            </>
          : <span style={{ fontSize: 11, color: 'var(--color-border)', fontStyle: 'italic' }}>Unassigned</span>
        }
      </div>
      <span style={{ fontSize: 11, color: 'var(--color-text-faint)', textAlign: 'right', whiteSpace: 'nowrap' }}>
        {wo.due_date?.slice(0, 10) || wo.due || '—'}
      </span>
    </div>
  )
}

export default function WorkOrderList({ wos, loading, selected, onSelect, onNew }) {
  const [search, setSearch]           = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterType, setFilterType]   = useState('all')

  const filtered = useMemo(() => {
    return wos.filter(wo => {
      const q = search.toLowerCase()
      const matchSearch = !q
        || wo.title?.toLowerCase().includes(q)
        || wo.id?.toLowerCase().includes(q)
        || (wo.asset_label || wo.asset?.label || '').toLowerCase().includes(q)
      const matchStatus = filterStatus === 'all' || wo.status === filterStatus
      const matchType   = filterType === 'all'   || wo.type === filterType
      return matchSearch && matchStatus && matchType
    })
  }, [wos, search, filterStatus, filterType])

  const counts = useMemo(() => {
    const c = { open: 0, assigned: 0, in_progress: 0, on_hold: 0, completed: 0 }
    wos.forEach(w => { if (c[w.status] !== undefined) c[w.status]++ })
    return c
  }, [wos])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '20px 24px 0', background: 'white', borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--color-text)', fontFamily: 'var(--font-serif)' }}>
              Work Orders
            </h1>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--color-text-faint)' }}>
              Reactive requests · Inspection · Corrective · Replacement
            </p>
          </div>
          <button
            onClick={onNew}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              background: 'var(--color-navy)', color: 'white', border: 'none',
              padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 16 }}>+</span> New Request
          </button>
        </div>

        {/* Status pills */}
        <div style={{ display: 'flex', gap: 5, marginBottom: 12, flexWrap: 'wrap' }}>
          <button onClick={() => setFilterStatus('all')} style={pillStyle(filterStatus === 'all')}>
            All <span style={{ opacity: 0.6 }}>{wos.length}</span>
          </button>
          {Object.entries(counts).map(([s, n]) => (
            <button key={s} onClick={() => setFilterStatus(s)} style={pillStyle(filterStatus === s)}>
              {STATUS_META[s].label} <span style={{ opacity: 0.6 }}>{n}</span>
            </button>
          ))}
        </div>

        {/* Search + type */}
        <div style={{ display: 'flex', gap: 8, paddingBottom: 12 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-faint)', fontSize: 12 }}>🔍</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search work orders, assets…"
              style={{ width: '100%', padding: '7px 10px 7px 30px', borderRadius: 7, border: '1px solid var(--color-border)', fontSize: 12, boxSizing: 'border-box' }}
            />
          </div>
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            style={{ padding: '7px 10px', border: '1px solid var(--color-border)', borderRadius: 7, fontSize: 12, background: 'white', cursor: 'pointer' }}
          >
            <option value="all">All Types</option>
            {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>

        {/* Column headers */}
        <div style={{
          display: 'grid', gridTemplateColumns: '32px 1fr 110px 80px 90px 130px 60px',
          gap: 8, padding: '0 18px 8px',
          fontSize: 10, fontWeight: 700, color: 'var(--color-text-faint)',
          letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>
          <span /><span>Title / Asset</span><span>Status</span>
          <span>Priority</span><span>Type</span><span>Assignee</span>
          <span style={{ textAlign: 'right' }}>Due</span>
        </div>
      </div>

      {/* Rows */}
      <div style={{ flex: 1, overflowY: 'auto', background: 'white' }}>
        {loading
          ? <Spinner />
          : filtered.length === 0
            ? <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-faint)', fontSize: 13 }}>
                No work orders match your filters.
              </div>
            : filtered.map(wo => <WORow key={wo.id} wo={wo} selected={selected} onClick={onSelect} />)
        }
      </div>
    </div>
  )
}

function pillStyle(active) {
  return {
    padding: '4px 11px', borderRadius: 20, border: '1px solid',
    borderColor: active ? 'var(--color-sky)' : 'var(--color-border)',
    background: active ? '#f0f9ff' : 'white',
    color: active ? '#0369a1' : 'var(--color-text-muted)',
    fontSize: 11, fontWeight: 600, cursor: 'pointer',
  }
}
