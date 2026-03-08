/**
 * IssueRequests.jsx — MMS Web Admin
 * Issue lifecycle: open → assigned → inspecting → follow_up_work → closed
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext.jsx'
import { issues, reporters, companies } from '../services/api.js'

// ─── Constants ────────────────────────────────────────────────

const STATUSES = ['open', 'assigned', 'inspecting', 'follow_up_work', 'closed']

const STATUS_META = {
  open:           { label: 'Open',           color: '#64748b', bg: '#f1f5f9' },
  assigned:       { label: 'Assigned',        color: '#2563eb', bg: '#eff6ff' },
  inspecting:     { label: 'Inspecting',      color: '#d97706', bg: '#fffbeb' },
  follow_up_work: { label: 'Follow-up Work',  color: '#7c3aed', bg: '#f5f3ff' },
  closed:         { label: 'Closed',          color: '#16a34a', bg: '#f0fdf4' },
}

const SEVERITY_META = {
  low:      { label: 'Low',      color: '#64748b', bg: '#f1f5f9' },
  medium:   { label: 'Medium',   color: '#d97706', bg: '#fffbeb' },
  high:     { label: 'High',     color: '#f97316', bg: '#fff7ed' },
  critical: { label: 'Critical', color: '#dc2626', bg: '#fef2f2' },
}

const ADVANCE_RULES = {
  open:           { next: 'assigned',       allowedRoles: ['help_desk_agent'] },
  assigned:       { next: 'inspecting',     allowedRoles: ['help_desk_agent', 'admin', 'manager'] },
  inspecting:     { next: 'follow_up_work', allowedRoles: ['help_desk_agent', 'admin', 'manager'] },
  follow_up_work: { next: 'closed',         allowedRoles: ['help_desk_agent'] },
}

// ─── Shared UI ────────────────────────────────────────────────

const inputStyle = {
  padding: '8px 11px', borderRadius: 7, border: '1px solid var(--color-border)',
  fontSize: 13, background: '#fff', width: '100%', color: 'var(--color-text)',
}

function Badge({ status, type = 'status' }) {
  const meta = type === 'status' ? STATUS_META[status] : SEVERITY_META[status]
  if (!meta) return null
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '2px 8px',
      borderRadius: 99, fontSize: 11, fontWeight: 600,
      color: meta.color, background: meta.bg,
    }}>{meta.label}</span>
  )
}

function StatusBar({ current }) {
  const idx = STATUSES.indexOf(current)
  return (
    <div style={{ display: 'flex', alignItems: 'center', margin: '12px 0' }}>
      {STATUSES.map((s, i) => {
        const done = i < idx; const active = i === idx
        const m = STATUS_META[s]
        return (
          <div key={s} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
            <div style={{ flex: 1, height: 4, borderRadius: 2, background: done || active ? m.color : 'var(--color-border)', opacity: active ? 1 : done ? 0.6 : 0.3 }} />
            <div style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: done || active ? m.color : 'var(--color-border)', opacity: active ? 1 : done ? 0.7 : 0.3, border: active ? `2px solid ${m.color}` : '2px solid transparent', outline: active ? `3px solid ${m.bg}` : 'none' }} />
          </div>
        )
      })}
    </div>
  )
}

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
      <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid var(--color-border)', borderTopColor: 'var(--color-sky)', animation: 'spin 0.7s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</label>
      {children}
    </div>
  )
}

// ─── New Issue Panel ──────────────────────────────────────────

function NewIssuePanel({ onClose }) {
  const qc = useQueryClient()
  const { data: symptomCats = [] } = useQuery({ queryKey: ['symptomCategories'], queryFn: issues.listSymptomCategories })
  const { data: companyList  = [] } = useQuery({ queryKey: ['companies'],         queryFn: companies.list })
  const { data: reporterList = [] } = useQuery({ queryKey: ['reporters'],          queryFn: reporters.list })

  const [form, setForm] = useState({ title: '', fault_description: '', severity: 'medium', target_company_id: '', symptom_category_id: '', asset_graph_id: '', reporter_id: '' })
  const [newRep, setNewRep] = useState({ name: '', email: '', phone: '' })
  const [addingRep, setAddingRep] = useState(false)
  const [error, setError] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const createRepMut = useMutation({
    mutationFn: reporters.create,
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['reporters'] }); set('reporter_id', String(r.id)); setAddingRep(false); setNewRep({ name: '', email: '', phone: '' }) },
    onError: (e) => setError(e.message),
  })

  const createMut = useMutation({
    mutationFn: issues.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['issues'] }); onClose() },
    onError: (e) => setError(e.message),
  })

  const submit = () => {
    if (!form.title.trim()) return setError('Title is required')
    if (!form.fault_description.trim()) return setError('Fault description is required')
    if (!form.target_company_id) return setError('Target company is required')
    setError(null)
    createMut.mutate({
      title: form.title.trim(), fault_description: form.fault_description.trim(),
      severity: form.severity, target_company_id: Number(form.target_company_id),
      ...(form.symptom_category_id ? { symptom_category_id: Number(form.symptom_category_id) } : {}),
      ...(form.asset_graph_id.trim() ? { asset_graph_id: form.asset_graph_id.trim() } : {}),
      ...(form.reporter_id ? { reporter_id: Number(form.reporter_id) } : {}),
    })
  }

  const contractors = companyList.filter(c => !c.is_help_desk)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.35)' }} />
      <div style={{ position: 'relative', width: 460, background: '#fff', display: 'flex', flexDirection: 'column', overflowY: 'auto', boxShadow: '-8px 0 40px rgba(0,0,0,0.12)' }}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Raise Issue</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Log a maintenance issue for a contractor</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--color-text-muted)', cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
          {error && <div style={{ padding: '8px 12px', borderRadius: 7, background: '#fef2f2', color: '#dc2626', fontSize: 13 }}>⚠ {error}</div>}
          <Field label="Title *"><input style={inputStyle} value={form.title} onChange={e => set('title', e.target.value)} placeholder="Brief description of the fault" /></Field>
          <Field label="Fault Description *"><textarea style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }} value={form.fault_description} onChange={e => set('fault_description', e.target.value)} placeholder="Describe the fault in detail…" /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Severity *">
              <select style={inputStyle} value={form.severity} onChange={e => set('severity', e.target.value)}>
                {['low','medium','high','critical'].map(s => <option key={s} value={s}>{SEVERITY_META[s].label}</option>)}
              </select>
            </Field>
            <Field label="Target Company *">
              <select style={inputStyle} value={form.target_company_id} onChange={e => set('target_company_id', e.target.value)}>
                <option value="">Select…</option>
                {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Symptom Category">
            <select style={inputStyle} value={form.symptom_category_id} onChange={e => set('symptom_category_id', e.target.value)}>
              <option value="">None / Unknown</option>
              {symptomCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Asset Graph ID (optional)">
            <input style={inputStyle} value={form.asset_graph_id} onChange={e => set('asset_graph_id', e.target.value)} placeholder="Leave blank if asset location unknown" />
          </Field>
          <Field label="Reporter (optional)">
            <div style={{ display: 'flex', gap: 8 }}>
              <select style={{ ...inputStyle, flex: 1 }} value={form.reporter_id} onChange={e => set('reporter_id', e.target.value)}>
                <option value="">None</option>
                {reporterList.map(r => <option key={r.id} value={r.id}>{r.name}{r.email ? ` — ${r.email}` : ''}</option>)}
              </select>
              <button onClick={() => setAddingRep(v => !v)} style={{ padding: '8px 12px', borderRadius: 7, border: '1px solid var(--color-border)', background: addingRep ? 'var(--color-sky)' : '#fff', color: addingRep ? '#fff' : 'var(--color-text)', cursor: 'pointer', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>+ New</button>
            </div>
            {addingRep && (
              <div style={{ marginTop: 8, padding: 12, borderRadius: 8, background: 'var(--color-bg)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input style={inputStyle} placeholder="Full name *" value={newRep.name} onChange={e => setNewRep(r => ({ ...r, name: e.target.value }))} />
                <input style={inputStyle} placeholder="Email" value={newRep.email} onChange={e => setNewRep(r => ({ ...r, email: e.target.value }))} />
                <input style={inputStyle} placeholder="Phone" value={newRep.phone} onChange={e => setNewRep(r => ({ ...r, phone: e.target.value }))} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => { if (newRep.name.trim()) createRepMut.mutate(newRep) }} disabled={createRepMut.isPending} style={{ padding: '7px 14px', borderRadius: 7, border: 'none', background: 'var(--color-sky)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>{createRepMut.isPending ? 'Saving…' : 'Save'}</button>
                  <button onClick={() => setAddingRep(false)} style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid var(--color-border)', background: '#fff', cursor: 'pointer', fontSize: 12 }}>Cancel</button>
                </div>
              </div>
            )}
          </Field>
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--color-border)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid var(--color-border)', background: '#fff', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button onClick={submit} disabled={createMut.isPending} style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: 'var(--color-sky)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{createMut.isPending ? 'Raising…' : 'Raise Issue'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Issue Detail ─────────────────────────────────────────────

function IssueDetail({ issueId, role, onClose }) {
  const qc = useQueryClient()
  const [advancing, setAdvancing] = useState(false)
  const [advNotes, setAdvNotes]   = useState('')
  const [advError, setAdvError]   = useState(null)

  const { data: issue, isLoading, error, refetch } = useQuery({
    queryKey: ['issue', issueId],
    queryFn: () => issues.get(issueId),
    enabled: !!issueId,
  })

  const advanceMut = useMutation({
    mutationFn: ({ status, notes }) => issues.advanceStatus(issueId, status, notes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issues'] })
      qc.invalidateQueries({ queryKey: ['issue', issueId] })
      setAdvancing(false); setAdvNotes(''); setAdvError(null)
    },
    onError: (e) => setAdvError(e.message),
  })

  const rule = issue ? ADVANCE_RULES[issue.status] : null
  const canAdvance = rule && rule.allowedRoles.includes(role)

  const panelStyle = {
    width: 'var(--detail-width)', minWidth: 'var(--detail-width)',
    borderLeft: '1px solid var(--color-border)',
    background: '#fff', display: 'flex', flexDirection: 'column', overflowY: 'auto',
  }

  if (isLoading) return <div style={panelStyle}><Spinner /></div>
  if (error) return <div style={panelStyle}><div style={{ padding: 16, color: '#dc2626', fontSize: 13 }}>⚠ {error.message} <button onClick={refetch} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontWeight: 600 }}>Retry</button></div></div>
  if (!issue) return null

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3 }}>{issue.title}</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 3 }}>
            #{issue.id} · {issue.target_company_name ?? `Company ${issue.target_company_id}`}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: 'var(--color-text-muted)', cursor: 'pointer', flexShrink: 0 }}>×</button>
      </div>

      <div style={{ padding: '0 20px' }}><StatusBar current={issue.status} /></div>
      <div style={{ padding: '8px 20px 14px', display: 'flex', gap: 8 }}>
        <Badge status={issue.status} type="status" />
        <Badge status={issue.severity} type="severity" />
      </div>

      {/* Meta grid */}
      <div style={{ padding: '0 20px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px', fontSize: 12 }}>
        {[
          ['Raised by', issue.raised_by_name ?? '—'],
          ['Reporter', issue.reporter_name ?? '—'],
          ['Symptom', issue.symptom_category_name ?? '—'],
          ['Asset', issue.asset_graph_id ?? 'Not specified'],
          ['Opened', issue.created_at ? new Date(issue.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'],
          ['Assigned', issue.assigned_at ? new Date(issue.assigned_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '—'],
        ].map(([k, v]) => (
          <div key={k}>
            <div style={{ color: 'var(--color-text-muted)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{k}</div>
            <div style={{ fontWeight: 500 }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Fault description */}
      <div style={{ padding: '0 20px 14px' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Fault Description</div>
        <div style={{ fontSize: 13, lineHeight: 1.55, background: 'var(--color-bg)', borderRadius: 7, padding: '10px 12px', border: '1px solid var(--color-border-soft)' }}>{issue.fault_description}</div>
      </div>

      {/* Inspection */}
      {issue.inspection && (
        <div style={{ padding: '0 20px 14px' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Inspection Finding</div>
          <div style={{ fontSize: 13, lineHeight: 1.55, background: '#fffbeb', borderRadius: 7, padding: '10px 12px', border: '1px solid #fde68a' }}>
            <span style={{ fontWeight: 600 }}>{issue.inspection.outcome === 'resolved' ? '✓ Resolved' : '→ Follow-up required'}: </span>
            {issue.inspection.notes}
          </div>
        </div>
      )}

      {/* Linked WOs */}
      {issue.work_orders?.length > 0 && (
        <div style={{ padding: '0 20px 14px' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Linked Work Orders</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {issue.work_orders.map(wo => (
              <div key={wo.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 7, border: '1px solid var(--color-border)', fontSize: 12 }}>
                <span style={{ fontWeight: 600, color: 'var(--color-sky)' }}>WO-{wo.id}</span>
                <span style={{ color: 'var(--color-text-muted)', flex: 1, marginLeft: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wo.title}</span>
                <Badge status={wo.status ?? 'open'} type="status" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timeline */}
      {issue.status_history?.length > 0 && (
        <div style={{ padding: '0 20px 14px' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Timeline</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {issue.status_history.map((h, i) => {
              const m = STATUS_META[h.new_status] ?? STATUS_META.open
              return (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: m.color, marginTop: 4, flexShrink: 0 }} />
                    {i < issue.status_history.length - 1 && <div style={{ width: 1, flex: 1, background: 'var(--color-border)', minHeight: 16 }} />}
                  </div>
                  <div style={{ paddingBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: m.color }}>{m.label}</div>
                    {h.notes && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 1 }}>{h.notes}</div>}
                    <div style={{ fontSize: 10, color: 'var(--color-text-faint)', marginTop: 1 }}>
                      {h.changed_by_name ?? 'System'} · {new Date(h.changed_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Advance status */}
      {canAdvance && issue.status !== 'closed' && (
        <div style={{ margin: '0 20px 20px', padding: 14, borderRadius: 9, border: `1px solid ${STATUS_META[rule.next].color}30`, background: STATUS_META[rule.next].bg }}>
          {!advancing ? (
            <button onClick={() => setAdvancing(true)} style={{ width: '100%', padding: 9, borderRadius: 7, border: 'none', background: rule.next === 'closed' ? '#16a34a' : 'var(--color-sky)', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
              Advance to: {STATUS_META[rule.next]?.label}
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Advance to {STATUS_META[rule.next]?.label}</div>
              {advError && <div style={{ fontSize: 12, color: '#dc2626' }}>⚠ {advError}</div>}
              <textarea value={advNotes} onChange={e => setAdvNotes(e.target.value)} placeholder="Notes (optional)…" style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontSize: 12 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => advanceMut.mutate({ status: rule.next, notes: advNotes })} disabled={advanceMut.isPending} style={{ flex: 1, padding: 8, borderRadius: 7, border: 'none', background: rule.next === 'closed' ? '#16a34a' : 'var(--color-sky)', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>{advanceMut.isPending ? 'Saving…' : 'Confirm'}</button>
                <button onClick={() => { setAdvancing(false); setAdvNotes(''); setAdvError(null) }} style={{ padding: '8px 14px', borderRadius: 7, border: '1px solid var(--color-border)', background: '#fff', cursor: 'pointer', fontSize: 12 }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────

const TABS = ['all', ...STATUSES]

export default function IssueRequests() {
  const { user } = useAuth()
  const role = user?.role
  const isHelpDesk = role === 'help_desk_agent'

  const [activeTab, setActiveTab]     = useState('all')
  const [search, setSearch]           = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [selectedId, setSelectedId]   = useState(null)
  const [showNew, setShowNew]         = useState(false)

  const params = {}
  if (activeTab !== 'all') params.status = activeTab
  if (companyFilter) params.target_company_id = companyFilter

  const { data: issueList = [], isLoading, error, refetch } = useQuery({
    queryKey: ['issues', params],
    queryFn: () => issues.list(params),
  })

  const { data: companyList = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: companies.list,
    enabled: isHelpDesk,
  })

  const filtered = issueList.filter(i => {
    if (!search) return true
    const q = search.toLowerCase()
    return i.title?.toLowerCase().includes(q) || i.fault_description?.toLowerCase().includes(q)
  })

  const contractors = companyList.filter(c => !c.is_help_desk)

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Toolbar */}
        <div style={{ padding: '16px 20px 0', borderBottom: '1px solid var(--color-border)', background: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>Issue Requests</h1>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                {isHelpDesk ? 'Manage issues raised across all contractor companies' : 'Issues assigned to your company'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => refetch()} style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid var(--color-border)', background: '#fff', cursor: 'pointer', fontSize: 12, color: 'var(--color-text-muted)' }}>↻</button>
              {isHelpDesk && (
                <button onClick={() => setShowNew(true)} style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: 'var(--color-sky)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>+ Raise Issue</button>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search issues…" style={{ ...inputStyle, width: 220 }} />
            {isHelpDesk && contractors.length > 0 && (
              <select style={{ ...inputStyle, width: 'auto' }} value={companyFilter} onChange={e => { setCompanyFilter(e.target.value); setSelectedId(null) }}>
                <option value="">All companies</option>
                {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 2 }}>
            {TABS.map(t => {
              const count = t === 'all' ? issueList.length : issueList.filter(i => i.status === t).length
              const active = activeTab === t
              const m = STATUS_META[t]
              return (
                <button key={t} onClick={() => { setActiveTab(t); setSelectedId(null) }} style={{
                  padding: '6px 12px', borderRadius: '6px 6px 0 0',
                  borderBottom: active ? '2px solid var(--color-sky)' : '2px solid transparent',
                  background: 'transparent', border: 'none',
                  borderBottom: active ? `2px solid ${m?.color ?? 'var(--color-sky)'}` : '2px solid transparent',
                  color: active ? (m?.color ?? 'var(--color-text)') : 'var(--color-text-muted)',
                  cursor: 'pointer', fontSize: 12, fontWeight: active ? 600 : 400,
                  display: 'flex', alignItems: 'center', gap: 5,
                }}>
                  <span style={{ textTransform: 'capitalize' }}>{t === 'all' ? 'All' : t.replace('_', ' ')}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 99, background: active && m ? m.bg : 'var(--color-bg)', color: active && m ? m.color : 'var(--color-text-faint)' }}>{count}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
          {isLoading && <Spinner />}
          {error && <div style={{ margin: '12px 8px', padding: '10px 14px', borderRadius: 8, background: '#fef2f2', color: '#dc2626', fontSize: 13 }}>⚠ {error.message}</div>}
          {!isLoading && !error && filtered.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%', gap: 8, color: 'var(--color-text-faint)' }}>
              <div style={{ fontSize: 36 }}>📋</div>
              <div style={{ fontWeight: 600, color: 'var(--color-border)' }}>No issues found</div>
            </div>
          )}
          {filtered.map(issue => {
            const selected = selectedId === issue.id
            return (
              <div key={issue.id} onClick={() => setSelectedId(selected ? null : issue.id)} style={{
                padding: '12px 14px', borderRadius: 9, marginBottom: 4,
                border: `1px solid ${selected ? 'var(--color-sky)' : 'var(--color-border)'}`,
                background: selected ? 'rgba(14,165,233,0.04)' : '#fff',
                cursor: 'pointer', transition: 'border-color 0.12s',
                boxShadow: selected ? '0 0 0 3px rgba(14,165,233,0.10)' : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{issue.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      #{issue.id}{issue.target_company_name ? ` · ${issue.target_company_name}` : ''}{issue.symptom_category_name ? ` · ${issue.symptom_category_name}` : ''}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Badge status={issue.status} type="status" />
                      <Badge status={issue.severity} type="severity" />
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--color-text-faint)', flexShrink: 0 }}>
                    {issue.created_at ? new Date(issue.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {selectedId && <IssueDetail issueId={selectedId} role={role} onClose={() => setSelectedId(null)} />}
      {showNew && <NewIssuePanel onClose={() => setShowNew(false)} />}
    </div>
  )
}
