import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { users } from '../../services/api.js'
import { StatusBadge, PriorityDot, FieldLabel, TYPE_META, STATUS_META, PRIORITY_META } from './woShared.jsx'

export default function WorkOrderDetail({ wo, allWOs, onClose, onSpawn, onUpdate, saving }) {
  const [assigneeId, setAssigneeId] = useState(wo.assigned_to || '')
  const [status, setStatus]         = useState(wo.status)
  const [priority, setPriority]     = useState(wo.priority)
  const [saved, setSaved]           = useState(false)

  useEffect(() => {
    setAssigneeId(wo.assigned_to || '')
    setStatus(wo.status)
    setPriority(wo.priority)
    setSaved(false)
  }, [wo.id])

  const { data: techList = [] } = useQuery({
    queryKey: ['users', 'technicians'],
    queryFn: () => users.list({ role: 'technician' }),
  })

  const handleSave = () => {
    onUpdate(wo.id, {
      assigned_to: assigneeId || null,
      status,
      priority,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  // Linked WOs via parent relationship
  const parent = wo.parent_wo_id
    ? allWOs.find(w => w.id === wo.parent_wo_id)
    : null
  const children = allWOs.filter(w => w.parent_wo_id === wo.id)

  const canSpawnCorrective  = wo.type === 'inspection'
  const canSpawnReplacement = wo.type === 'inspection' || wo.type === 'corrective'
  const isComplete          = wo.status === 'completed'

  // Allowed next statuses based on current
  const TRANSITIONS = {
    open:        ['assigned'],
    assigned:    ['in_progress', 'open'],
    in_progress: ['on_hold', 'completed'],
    on_hold:     ['in_progress'],
    completed:   [],
  }
  const allowedStatuses = [wo.status, ...(TRANSITIONS[wo.status] || [])]

  return (
    <div style={{
      width: 'var(--detail-width)', background: 'white',
      borderLeft: '1px solid var(--color-border)',
      display: 'flex', flexDirection: 'column', flexShrink: 0,
    }}>
      {/* Sticky header */}
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid var(--color-border)',
        position: 'sticky', top: 0, background: 'white', zIndex: 1,
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      }}>
        <div style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 16 }}>{TYPE_META[wo.type]?.icon || '⚙️'}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em' }}>
              {wo.id}
            </span>
            <StatusBadge status={wo.status} />
            <PriorityDot priority={wo.priority} />
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)', lineHeight: 1.35 }}>
            {wo.title}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--color-text-faint)', padding: 0, flexShrink: 0 }}>✕</button>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Asset */}
        <section>
          <FieldLabel>Asset</FieldLabel>
          <div style={{ background: '#f8fafc', border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 14px' }}>
            {wo.asset_label || wo.asset_graph_id
              ? <>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                    {wo.asset_label || wo.asset_graph_id}
                  </div>
                  {wo.asset_label && wo.asset_graph_id && (
                    <div style={{ fontSize: 10, color: 'var(--color-text-faint)', marginTop: 2, fontFamily: 'monospace' }}>
                      {wo.asset_graph_id}
                    </div>
                  )}
                </>
              : <div style={{ fontSize: 12, color: 'var(--color-text-faint)', fontStyle: 'italic' }}>No asset linked</div>
            }
          </div>
        </section>

        {/* Description */}
        {wo.description && (
          <section>
            <FieldLabel>Description</FieldLabel>
            <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.65 }}>{wo.description}</div>
          </section>
        )}

        {/* Meta grid */}
        <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <FieldLabel>Type</FieldLabel>
            <div style={{ fontSize: 12, color: '#475569' }}>{TYPE_META[wo.type]?.label || wo.type || '—'}</div>
          </div>
          <div>
            <FieldLabel>Created By</FieldLabel>
            <div style={{ fontSize: 12, color: '#475569' }}>{wo.created_by_name || '—'}</div>
          </div>
          <div>
            <FieldLabel>Created</FieldLabel>
            <div style={{ fontSize: 12, color: '#475569' }}>{wo.created_at?.slice(0, 10) || '—'}</div>
          </div>
          <div>
            <FieldLabel>Updated</FieldLabel>
            <div style={{ fontSize: 12, color: '#475569' }}>{wo.updated_at?.slice(0, 10) || '—'}</div>
          </div>
          {wo.completed_at && (
            <div>
              <FieldLabel>Completed</FieldLabel>
              <div style={{ fontSize: 12, color: 'var(--color-done)' }}>{wo.completed_at.slice(0, 10)}</div>
            </div>
          )}
          {wo.actual_duration_minutes && (
            <div>
              <FieldLabel>Duration</FieldLabel>
              <div style={{ fontSize: 12, color: '#475569' }}>{wo.actual_duration_minutes} min</div>
            </div>
          )}
        </section>

        {/* Parent WO */}
        {parent && (
          <section>
            <FieldLabel>Spawned From</FieldLabel>
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '8px 12px' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#15803d' }}>{parent.id}</div>
              <div style={{ fontSize: 11, color: '#166534', marginTop: 2 }}>{parent.title}</div>
            </div>
          </section>
        )}

        {/* Child WOs */}
        {children.length > 0 && (
          <section>
            <FieldLabel>Linked Work Orders</FieldLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {children.map(c => (
                <div key={c.id} style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#0369a1', display: 'flex', gap: 8, alignItems: 'center' }}>
                    {c.id} <StatusBadge status={c.status} />
                  </div>
                  <div style={{ fontSize: 11, color: '#075985', marginTop: 2 }}>{c.title}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Field updates from technicians */}
        {wo.updates?.length > 0 && (
          <section>
            <FieldLabel>Field Updates</FieldLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {wo.updates.map((u, i) => (
                <div key={u.id || i} style={{ background: '#f8fafc', border: '1px solid var(--color-border)', borderRadius: 7, padding: '8px 12px' }}>
                  <div style={{ fontSize: 10, color: 'var(--color-text-faint)', marginBottom: 4 }}>
                    {u.updated_by_name} · {u.created_at?.slice(0, 10)}
                    {u.status && <span style={{ marginLeft: 6 }}><StatusBadge status={u.status} /></span>}
                  </div>
                  {u.notes && <div style={{ fontSize: 12, color: '#475569' }}>{u.notes}</div>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Editable fields ── */}

        {/* Assignee */}
        <section>
          <FieldLabel>Assignee</FieldLabel>
          <select
            value={assigneeId}
            onChange={e => setAssigneeId(e.target.value)}
            disabled={isComplete}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 7, fontSize: 12, background: 'white', cursor: isComplete ? 'not-allowed' : 'pointer' }}
          >
            <option value="">— Unassigned —</option>
            {techList.map(t => <option key={t.id} value={t.id}>{t.full_name || t.name}</option>)}
          </select>
        </section>

        {/* Status */}
        <section>
          <FieldLabel>Status</FieldLabel>
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            disabled={isComplete}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 7, fontSize: 12, background: 'white', cursor: isComplete ? 'not-allowed' : 'pointer' }}
          >
            {allowedStatuses.map(s => (
              <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>
            ))}
          </select>
          {isComplete && <div style={{ fontSize: 10, color: 'var(--color-text-faint)', marginTop: 4 }}>Completed work orders cannot be edited.</div>}
        </section>

        {/* Priority */}
        <section>
          <FieldLabel>Priority</FieldLabel>
          <select
            value={priority}
            onChange={e => setPriority(e.target.value)}
            disabled={isComplete}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 7, fontSize: 12, background: 'white', cursor: isComplete ? 'not-allowed' : 'pointer' }}
          >
            {Object.entries(PRIORITY_META).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </section>

        {/* Save */}
        {!isComplete && (
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '10px', borderRadius: 8, border: 'none',
              cursor: saving ? 'wait' : 'pointer',
              background: saved ? '#16a34a' : saving ? '#94a3b8' : 'var(--color-navy)',
              color: 'white', fontSize: 13, fontWeight: 600, transition: 'background 0.2s',
            }}
          >
            {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save Changes'}
          </button>
        )}

        {/* Spawn actions */}
        {(canSpawnCorrective || canSpawnReplacement) && !isComplete && (
          <section>
            <FieldLabel>Spawn Work Order</FieldLabel>
            <div style={{ display: 'flex', gap: 8 }}>
              {canSpawnCorrective && (
                <button
                  onClick={() => onSpawn('corrective', wo)}
                  style={{ flex: 1, padding: '9px', borderRadius: 8, cursor: 'pointer', border: '1.5px solid #f97316', background: '#fff7ed', color: '#c2410c', fontSize: 12, fontWeight: 600 }}
                >
                  🔧 Corrective WO
                </button>
              )}
              {canSpawnReplacement && (
                <button
                  onClick={() => onSpawn('replacement', wo)}
                  style={{ flex: 1, padding: '9px', borderRadius: 8, cursor: 'pointer', border: '1.5px solid #7c3aed', background: '#f5f3ff', color: '#6d28d9', fontSize: 12, fontWeight: 600 }}
                >
                  📦 Replacement Request
                </button>
              )}
            </div>
            <div style={{ fontSize: 10, color: 'var(--color-text-faint)', marginTop: 6 }}>
              Creates a new linked work order inheriting asset context.
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
