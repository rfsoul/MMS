import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { users, assets } from '../../services/api.js'
import { FieldLabel, TYPE_META, PRIORITY_META } from './woShared.jsx'

export default function WorkOrderCreate({ spawnType, parentWO, onClose, onCreate, saving, error }) {
  const [form, setForm] = useState({
    title: spawnType === 'corrective'
      ? `${parentWO?.asset_graph_id ? '' : ''}Corrective — `
      : spawnType === 'replacement'
      ? `Replacement Request`
      : '',
    type:        spawnType || 'inspection',
    priority:    'medium',
    asset_id:    parentWO?.asset_graph_id || '',
    assignee_id: '',
    description: parentWO ? `Spawned from ${parentWO.id}. ${parentWO.title}.` : '',
  })

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const { data: techList = [] } = useQuery({
    queryKey: ['users', 'technicians'],
    queryFn: () => users.list({ role: 'technician' }),
  })

  const { data: assetList = [], isLoading: assetsLoading, error: assetsError } = useQuery({
    queryKey: ['assets', 'flat'],
    queryFn: () => assets.listFlat({ limit: 500 }),
    enabled: !parentWO,
  })

  const handleSubmit = () => {
    if (!form.title) return
    onCreate({
      title:          form.title,
      type:           form.type,
      priority:       form.priority,
      asset_graph_id: form.asset_id || null,
      assigned_to:    form.assignee_id || null,
      description:    form.description || null,
      parent_wo_id:   parentWO?.id || null,
    })
  }

  const isValid = !!form.title

  function assetLabel(a) {
    const parts = [a.code, a.name].filter(Boolean)
    const location = [a.building_name, a.space_name].filter(Boolean).join(' / ')
    return location ? `${parts.join(' — ')} (${location})` : parts.join(' — ') || a.asset_graph_id
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
    }}>
      <div style={{
        background: 'white', borderRadius: 14, width: 540,
        maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: '0 28px 64px rgba(0,0,0,0.22)',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>
              {spawnType ? `Spawn ${TYPE_META[spawnType]?.label} Work Order` : 'New Maintenance Request'}
            </div>
            {parentWO && (
              <div style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: 2 }}>Linked to {parentWO.id}</div>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--color-text-faint)' }}>✕</button>
        </div>

        <div style={{ padding: '18px 22px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Parent context banner */}
          {parentWO && (
            <div style={{ background: '#f0f9ff', borderRadius: 8, border: '1px solid #bae6fd', padding: '10px 14px', fontSize: 12, color: '#075985' }}>
              <span style={{ fontWeight: 600, color: '#0369a1' }}>Spawning from: </span>
              {parentWO.id} — {parentWO.title}
            </div>
          )}

          {/* Title */}
          <div>
            <FieldLabel>Title *</FieldLabel>
            <input
              value={form.title}
              onChange={e => set('title', e.target.value)}
              placeholder="Describe the work required…"
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 7, fontSize: 12, boxSizing: 'border-box' }}
            />
          </div>

          {/* Type + Priority */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <FieldLabel>Type</FieldLabel>
              <select
                value={form.type}
                onChange={e => set('type', e.target.value)}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 7, fontSize: 12, background: 'white' }}
              >
                {Object.entries(TYPE_META).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>Priority</FieldLabel>
              <select
                value={form.priority}
                onChange={e => set('priority', e.target.value)}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 7, fontSize: 12, background: 'white' }}
              >
                {Object.entries(PRIORITY_META).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Asset picker */}
          <div>
            <FieldLabel>Asset</FieldLabel>
            {parentWO ? (
              <div style={{ padding: '8px 12px', background: '#f8fafc', border: '1px solid var(--color-border)', borderRadius: 7, fontSize: 12, color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>
                {parentWO.asset_graph_id || 'No asset'}
              </div>
            ) : assetsError ? (
              <div style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 7, fontSize: 12, color: '#dc2626' }}>
                Failed to load assets: {assetsError.message}
              </div>
            ) : (
              <select
                value={form.asset_id}
                onChange={e => set('asset_id', e.target.value)}
                disabled={assetsLoading}
                style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 7, fontSize: 12, background: 'white' }}
              >
                <option value="">
                  {assetsLoading ? 'Loading assets…' : `— Select asset (${assetList.length}) —`}
                </option>
                {assetList.map(a => (
                  <option key={a.asset_graph_id} value={a.asset_graph_id}>
                    {assetLabel(a)}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Assignee */}
          <div>
            <FieldLabel>Assignee</FieldLabel>
            <select
              value={form.assignee_id}
              onChange={e => set('assignee_id', e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 7, fontSize: 12, background: 'white' }}
            >
              <option value="">— Unassigned —</option>
              {techList.map(t => (
                <option key={t.id} value={t.id}>{t.full_name || t.name}</option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <FieldLabel>Description</FieldLabel>
            <textarea
              value={form.description}
              onChange={e => set('description', e.target.value)}
              rows={4}
              placeholder="Describe the maintenance request, symptoms observed, access requirements…"
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 7, fontSize: 12, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>

          {/* API error */}
          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#dc2626' }}>
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!isValid || saving}
            style={{
              padding: '11px', borderRadius: 8, border: 'none',
              background: (!isValid || saving) ? '#e2e8f0' : 'var(--color-navy)',
              color: (!isValid || saving) ? '#94a3b8' : 'white',
              fontSize: 13, fontWeight: 600,
              cursor: (!isValid || saving) ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Creating…' : 'Create Work Order'}
          </button>
        </div>
      </div>
    </div>
  )
}
