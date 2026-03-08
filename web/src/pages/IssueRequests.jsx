/**
 * IssueRequests.jsx
 * MMS Web Admin — Issue Request Workflow
 *
 * All data sourced from real API endpoints:
 *   GET    /issues                      list + filters
 *   POST   /issues                      raise new issue
 *   GET    /issues/:id                  detail + history + WOs + inspection
 *   PATCH  /issues/:id/status           advance lifecycle
 *   GET    /issues/symptom-categories   picker lookup
 *   GET    /companies                   target company picker
 *   GET    /reporters                   reporter picker
 *   POST   /reporters                   create reporter on-the-fly
 *
 * Props:
 *   token  {string}  — JWT from login, passed down from app shell
 *   user   {object}  — current user object from /auth/me
 */

import { useState, useEffect, useCallback } from "react";

// ─── Config ───────────────────────────────────────────────────────────────────
const API_BASE = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE) ?? "http://localhost:3000";

// ─── API client hook ─────────────────────────────────────────────────────────
function useApi(token) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const get = useCallback(async (path) => {
    const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw Object.assign(new Error(data.message ?? "API error"), { code: data.code });
    return data;
  }, [token]);

  const post = useCallback(async (path, body) => {
    const res = await fetch(`${API_BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw Object.assign(new Error(data.message ?? "API error"), { code: data.code });
    return data;
  }, [token]);

  const patch = useCallback(async (path, body) => {
    const res = await fetch(`${API_BASE}${path}`, { method: "PATCH", headers, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw Object.assign(new Error(data.message ?? "API error"), { code: data.code });
    return data;
  }, [token]);

  return { get, post, patch };
}

// ─── Constants ────────────────────────────────────────────────────────────────
const SEVERITY_CONFIG = {
  low:      { label: "Low",      color: "#6b7280", bg: "#f3f4f6" },
  medium:   { label: "Medium",   color: "#d97706", bg: "#fffbeb" },
  high:     { label: "High",     color: "#ea580c", bg: "#fff7ed" },
  critical: { label: "Critical", color: "#dc2626", bg: "#fef2f2" },
};

const STATUS_CONFIG = {
  open:           { label: "Open",           color: "#6b7280", bg: "#f9fafb" },
  assigned:       { label: "Assigned",       color: "#2563eb", bg: "#eff6ff" },
  inspecting:     { label: "Inspecting",     color: "#7c3aed", bg: "#f5f3ff" },
  follow_up_work: { label: "Follow-up Work", color: "#d97706", bg: "#fffbeb" },
  closed:         { label: "Closed",         color: "#16a34a", bg: "#f0fdf4" },
};

const STATUS_STEPS = ["open", "assigned", "inspecting", "follow_up_work", "closed"];

// Role-gated next status
function getNextStatus(current, role) {
  const map = {
    open:           { help_desk_agent: "assigned" },
    assigned:       { help_desk_agent: "inspecting", admin: "inspecting", manager: "inspecting" },
    inspecting:     { help_desk_agent: "follow_up_work", admin: "follow_up_work", manager: "follow_up_work" },
    follow_up_work: { help_desk_agent: "closed" },
  };
  return map[current]?.[role] ?? null;
}

// ─── Formatting ───────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-AU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
}
function fmtShort(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-AU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
}
function timeAgo(iso) {
  if (!iso) return "";
  const h = Math.floor((Date.now() - new Date(iso)) / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return fmtShort(iso);
}

// ─── Shared atoms ─────────────────────────────────────────────────────────────
function SeverityBadge({ severity }) {
  const c = SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.medium;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: c.color, background: c.bg, border: `1px solid ${c.color}33` }}>
      {severity === "critical" && <span style={{ fontSize: 7 }}>●</span>}
      {c.label}
    </span>
  );
}

function StatusBadge({ status }) {
  const c = STATUS_CONFIG[status] ?? STATUS_CONFIG.open;
  return (
    <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 4, fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", color: c.color, background: c.bg, border: `1px solid ${c.color}44` }}>
      {c.label}
    </span>
  );
}

function Spinner({ size = 20 }) {
  return <div style={{ width: size, height: size, borderRadius: "50%", border: "2px solid #e2e8f0", borderTopColor: "#2563eb", animation: "spin 0.7s linear infinite", display: "inline-block" }} />;
}

function ErrBanner({ msg, onDismiss }) {
  return (
    <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 7, padding: "9px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "#991b1b", marginBottom: 12 }}>
      <span>⚠ {msg}</span>
      {onDismiss && <button onClick={onDismiss} style={{ background: "none", border: "none", cursor: "pointer", color: "#991b1b", fontSize: 16, lineHeight: 1 }}>×</button>}
    </div>
  );
}

// ─── Status Progress Bar ──────────────────────────────────────────────────────
function StatusProgress({ status }) {
  const current = STATUS_STEPS.indexOf(status);
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {STATUS_STEPS.map((s, i) => {
        const cfg = STATUS_CONFIG[s];
        const done = i < current, active = i === current;
        return (
          <div key={s} style={{ display: "flex", alignItems: "center", flex: i < STATUS_STEPS.length - 1 ? 1 : "none" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, background: done ? "#1d4ed8" : active ? cfg.color : "#e5e7eb", color: (done || active) ? "#fff" : "#9ca3af", border: active ? `2.5px solid ${cfg.color}` : "none", boxSizing: "border-box" }}>
                {done ? "✓" : i + 1}
              </div>
              <span style={{ fontSize: 8.5, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap", color: done ? "#1d4ed8" : active ? cfg.color : "#9ca3af" }}>
                {cfg.label}
              </span>
            </div>
            {i < STATUS_STEPS.length - 1 && (
              <div style={{ flex: 1, height: 2, margin: "0 3px", marginBottom: 16, background: done ? "#1d4ed8" : "#e5e7eb" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Issue List Row ───────────────────────────────────────────────────────────
function IssueRow({ issue, onClick, isSelected }) {
  return (
    <div onClick={onClick}
      style={{ display: "grid", gridTemplateColumns: "3fr 1.2fr 1fr 1fr 1fr 60px", gap: 12, alignItems: "center", padding: "11px 20px", borderBottom: "1px solid #f1f5f9", background: isSelected ? "#eff6ff" : "white", cursor: "pointer", borderLeft: isSelected ? "3px solid #2563eb" : "3px solid transparent", transition: "background 0.1s" }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "#f8fafc"; }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "white"; }}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", marginBottom: 2, lineHeight: 1.3 }}>{issue.title}</div>
        <div style={{ fontSize: 11, color: "#64748b", display: "flex", gap: 6, alignItems: "center" }}>
          {issue.asset_name
            ? <span style={{ color: "#2563eb", fontWeight: 500 }}>{issue.asset_name}</span>
            : <span style={{ color: "#9ca3af", fontStyle: "italic" }}>No asset specified</span>}
          {issue.symptom_category_name && (
            <span style={{ background: "#f1f5f9", padding: "1px 5px", borderRadius: 3, fontSize: 10, fontWeight: 500 }}>{issue.symptom_category_name}</span>
          )}
        </div>
      </div>
      <div style={{ fontSize: 12, color: "#374151", fontWeight: 500 }}>{issue.target_company_name}</div>
      <SeverityBadge severity={issue.severity} />
      <StatusBadge status={issue.status} />
      <div style={{ fontSize: 11, color: "#6b7280" }}>{timeAgo(issue.created_at)}</div>
      <div>
        {(issue.work_order_count ?? issue.work_orders?.length ?? 0) > 0 && (
          <span style={{ background: "#e0e7ff", color: "#3730a3", padding: "2px 7px", borderRadius: 10, fontSize: 10, fontWeight: 600 }}>
            {issue.work_order_count ?? issue.work_orders.length} WO
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Raise Issue Form ─────────────────────────────────────────────────────────
function RaiseIssueForm({ api, user, onCancel, onCreate }) {
  const [form, setForm] = useState({ title: "", fault_description: "", severity: "medium", target_company_id: "", asset_graph_id: "", symptom_category_id: "", reporter_id: "" });
  const [errors, setErrors]     = useState({});
  const [submitting, setSub]    = useState(false);
  const [apiErr, setApiErr]     = useState(null);
  const [companies, setCompanies]   = useState([]);
  const [categories, setCategories] = useState([]);
  const [reporters, setReporters]   = useState([]);
  const [lookupLoading, setLookupLoading] = useState(true);
  const [showNewRep, setShowNewRep] = useState(false);
  const [newRep, setNewRep] = useState({ full_name: "", organisation: "", email: "" });
  const [creatingRep, setCreatingRep] = useState(false);

  useEffect(() => {
    Promise.all([api.get("/companies"), api.get("/issues/symptom-categories"), api.get("/reporters")])
      .then(([co, cat, rep]) => {
        setCompanies((co.companies ?? []).filter(c => !c.is_help_desk));
        setCategories(cat.categories ?? []);
        setReporters(rep.reporters ?? []);
      })
      .catch(e => setApiErr(e.message))
      .finally(() => setLookupLoading(false));
  }, []);

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: null })); };

  const validate = () => {
    const e = {};
    if (!form.title.trim()) e.title = "Required";
    if (!form.fault_description.trim()) e.fault_description = "Required";
    if (!form.target_company_id) e.target_company_id = "Select a company";
    return e;
  };

  const handleSaveReporter = async () => {
    if (!newRep.full_name.trim()) return;
    setCreatingRep(true);
    try {
      const d = await api.post("/reporters", { full_name: newRep.full_name, organisation: newRep.organisation || undefined, email: newRep.email || undefined });
      const r = d.reporter ?? d;
      setReporters(p => [...p, r]);
      set("reporter_id", r.id);
      setShowNewRep(false);
      setNewRep({ full_name: "", organisation: "", email: "" });
    } catch (e) { setApiErr(e.message); }
    finally { setCreatingRep(false); }
  };

  const handleSubmit = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSub(true); setApiErr(null);
    try {
      const body = { title: form.title, fault_description: form.fault_description, severity: form.severity, target_company_id: form.target_company_id };
      if (form.asset_graph_id.trim())  body.asset_graph_id        = form.asset_graph_id.trim();
      if (form.symptom_category_id)    body.symptom_category_id   = form.symptom_category_id;
      if (form.reporter_id)            body.reporter_id            = form.reporter_id;
      const d = await api.post("/issues", body);
      onCreate(d.issue ?? d);
    } catch (e) { setApiErr(e.message); }
    finally { setSub(false); }
  };

  const inp = (err) => ({ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 6, fontSize: 13, border: `1.5px solid ${err ? "#dc2626" : "#d1d5db"}`, outline: "none", fontFamily: "inherit", background: "#fafafa" });

  const Field = ({ label, required, error, hint, children }) => (
    <div style={{ marginBottom: 15 }}>
      <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>
        {label}{required && <span style={{ color: "#dc2626" }}> *</span>}
      </label>
      {children}
      {hint  && <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 3 }}>{hint}</div>}
      {error && <div style={{ fontSize: 11, color: "#dc2626", marginTop: 3 }}>{error}</div>}
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "flex-start", justifyContent: "flex-end", zIndex: 100 }}>
      <div style={{ width: 520, height: "100vh", background: "white", display: "flex", flexDirection: "column", boxShadow: "-8px 0 40px rgba(0,0,0,0.18)" }}>

        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #e5e7eb", flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>New Issue Request</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a" }}>Raise Maintenance Issue</div>
            </div>
            <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", fontSize: 22, lineHeight: 1 }}>×</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px" }}>
          {apiErr && <ErrBanner msg={apiErr} onDismiss={() => setApiErr(null)} />}
          {lookupLoading ? (
            <div style={{ display: "flex", justifyContent: "center", paddingTop: 40 }}><Spinner size={28} /></div>
          ) : (
            <>
              <Field label="Title" required error={errors.title}>
                <input value={form.title} onChange={e => set("title", e.target.value)} placeholder="Brief description of the fault" style={inp(errors.title)} />
              </Field>

              <Field label="Fault Description" required error={errors.fault_description} hint="Describe what is observable. The contractor will determine the cause.">
                <textarea value={form.fault_description} onChange={e => set("fault_description", e.target.value)} placeholder="Symptom, location, frequency, any relevant context…" rows={4} style={{ ...inp(errors.fault_description), resize: "vertical", lineHeight: 1.5 }} />
              </Field>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Field label="Severity" required>
                  <select value={form.severity} onChange={e => set("severity", e.target.value)} style={inp()}>
                    {["low","medium","high","critical"].map(s => <option key={s} value={s}>{SEVERITY_CONFIG[s].label}</option>)}
                  </select>
                </Field>
                <Field label="Symptom Category">
                  <select value={form.symptom_category_id} onChange={e => set("symptom_category_id", e.target.value)} style={inp()}>
                    <option value="">— Select —</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
              </div>

              <Field label="Assign to Company" required error={errors.target_company_id}>
                <select value={form.target_company_id} onChange={e => set("target_company_id", e.target.value)} style={inp(errors.target_company_id)}>
                  <option value="">— Select contractor —</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>

              <Field label="Asset (optional)" hint="Leave blank if the source is unknown — the contractor will investigate.">
                <input value={form.asset_graph_id} onChange={e => set("asset_graph_id", e.target.value)} placeholder="Asset graph ID" style={inp()} />
              </Field>

              <div style={{ position: "relative", borderTop: "1px dashed #e5e7eb", margin: "2px 0 15px" }}>
                <span style={{ position: "absolute", top: -8, left: 0, background: "white", paddingRight: 8, fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em" }}>Reporter (optional)</span>
              </div>

              <Field label="Reporter">
                <div style={{ display: "flex", gap: 8 }}>
                  <select value={form.reporter_id} onChange={e => set("reporter_id", e.target.value)} style={{ ...inp(), flex: 1 }}>
                    <option value="">— Not recorded —</option>
                    {reporters.map(r => <option key={r.id} value={r.id}>{r.full_name}{r.organisation ? ` — ${r.organisation}` : ""}</option>)}
                  </select>
                  <button onClick={() => setShowNewRep(v => !v)} style={{ padding: "6px 12px", borderRadius: 6, border: "1.5px solid #d1d5db", background: "white", color: "#374151", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>+ New</button>
                </div>
              </Field>

              {showNewRep && (
                <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px 14px", marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", marginBottom: 8 }}>New Reporter</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                    <input value={newRep.full_name} onChange={e => setNewRep(r => ({ ...r, full_name: e.target.value }))} placeholder="Full name *" style={{ ...inp(), fontSize: 12 }} />
                    <input value={newRep.organisation} onChange={e => setNewRep(r => ({ ...r, organisation: e.target.value }))} placeholder="Organisation" style={{ ...inp(), fontSize: 12 }} />
                  </div>
                  <input value={newRep.email} onChange={e => setNewRep(r => ({ ...r, email: e.target.value }))} placeholder="Email (optional)" style={{ ...inp(), fontSize: 12, marginBottom: 8 }} />
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button onClick={() => setShowNewRep(false)} style={{ padding: "5px 12px", border: "1.5px solid #d1d5db", borderRadius: 5, background: "white", fontSize: 12, cursor: "pointer" }}>Cancel</button>
                    <button onClick={handleSaveReporter} disabled={creatingRep || !newRep.full_name.trim()} style={{ padding: "5px 14px", border: "none", borderRadius: 5, background: "#2563eb", color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: (creatingRep || !newRep.full_name.trim()) ? 0.6 : 1 }}>
                      {creatingRep ? "Saving…" : "Save Reporter"}
                    </button>
                  </div>
                </div>
              )}

              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "11px 13px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 7 }}>Severity Guide</div>
                {[["low","Non-urgent, no safety or operational impact"],["medium","Degraded performance, attend within normal schedule"],["high","Significant impact, prioritise response"],["critical","Safety risk or complete failure — immediate response required"]].map(([k, desc]) => (
                  <div key={k} style={{ display: "flex", gap: 8, marginBottom: 3 }}>
                    <span style={{ color: SEVERITY_CONFIG[k].color, fontWeight: 700, fontSize: 11, minWidth: 54, textTransform: "uppercase" }}>{k}</span>
                    <span style={{ fontSize: 11, color: "#6b7280" }}>{desc}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div style={{ padding: "13px 24px", borderTop: "1px solid #e5e7eb", display: "flex", gap: 10, justifyContent: "flex-end", background: "#fafafa", flexShrink: 0 }}>
          <button onClick={onCancel} style={{ padding: "8px 18px", border: "1.5px solid #d1d5db", borderRadius: 6, background: "white", color: "#374151", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
          <button onClick={handleSubmit} disabled={submitting || lookupLoading} style={{ padding: "8px 22px", border: "none", borderRadius: 6, background: (submitting || lookupLoading) ? "#93c5fd" : "#2563eb", color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            {submitting ? "Raising…" : "Raise Issue"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Issue Detail Panel ───────────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function IssueDetail({ api, user, issueId, onClose, onUpdated }) {
  const [issue, setIssue]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const [err, setErr]           = useState(null);
  const [advancing, setAdv]     = useState(false);
  const [advNotes, setAdvNotes] = useState("");
  const [showAdv, setShowAdv]   = useState(false);
  const [advErr, setAdvErr]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const d = await api.get(`/issues/${issueId}`);
      setIssue(d.issue ?? d);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [api, issueId]);

  useEffect(() => { load(); }, [load]);

  const next = issue ? getNextStatus(issue.status, user?.role) : null;
  const nextLabel = next ? STATUS_CONFIG[next]?.label : null;

  const handleAdvance = async () => {
    if (!next) return;
    setAdv(true); setAdvErr(null);
    try {
      const d = await api.patch(`/issues/${issueId}/status`, { status: next, notes: advNotes || undefined });
      const updated = d.issue ?? d;
      setIssue(updated);
      onUpdated(updated);
      setShowAdv(false); setAdvNotes("");
    } catch (e) { setAdvErr(e.message); }
    finally { setAdv(false); }
  };

  const statusSince = issue ? (
    issue.status === "closed"         ? issue.closed_at :
    issue.status === "follow_up_work" ? issue.follow_up_work_at :
    issue.status === "inspecting"     ? issue.inspecting_at :
    issue.status === "assigned"       ? issue.assigned_at :
    issue.created_at
  ) : null;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "white", borderLeft: "1px solid #e5e7eb", height: "100%", overflow: "hidden" }}>

      <div style={{ padding: "15px 20px 13px", borderBottom: "1px solid #e5e7eb", flexShrink: 0 }}>
        {loading && !issue ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Spinner />
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 20 }}>×</button>
          </div>
        ) : issue ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div style={{ flex: 1, paddingRight: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>{issue.target_company_name}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", lineHeight: 1.3 }}>{issue.title}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <SeverityBadge severity={issue.severity} />
                <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 20 }}>×</button>
              </div>
            </div>
            <StatusProgress status={issue.status} />
          </>
        ) : null}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "15px 20px" }}>
        {loading && <div style={{ display: "flex", justifyContent: "center", paddingTop: 40 }}><Spinner size={28} /></div>}
        {err && <ErrBanner msg={err} />}

        {issue && !loading && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
              {[
                ["Category",    issue.symptom_category_name ?? "—"],
                ["Asset",       issue.asset_name ?? <em style={{ color: "#9ca3af" }}>Not specified</em>],
                ["Reporter",    issue.reporter_name ?? <em style={{ color: "#9ca3af" }}>Not recorded</em>],
                ["Raised by",   issue.raised_by_name],
                ["Created",     fmtShort(issue.created_at)],
                ["Status since",fmtShort(statusSince)],
              ].map(([k, v]) => (
                <div key={k} style={{ background: "#f8fafc", borderRadius: 6, padding: "7px 10px" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>{k}</div>
                  <div style={{ fontSize: 12, color: "#1e293b", fontWeight: 500 }}>{v}</div>
                </div>
              ))}
            </div>

            <Section title="Fault Description">
              <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 12px", fontSize: 12.5, color: "#1e293b", lineHeight: 1.6 }}>
                {issue.fault_description}
              </div>
            </Section>

            {issue.inspection && (
              <Section title="Inspection Finding">
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#166534" }}>By {issue.inspection.inspected_by_name}</span>
                    <span style={{ fontSize: 11, color: "#6b7280" }}>{fmtShort(issue.inspection.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "#1e293b", lineHeight: 1.6 }}>{issue.inspection.notes}</div>
                  {issue.inspection.outcome && (
                    <div style={{ marginTop: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: issue.inspection.outcome === "resolved" ? "#16a34a" : "#d97706", background: issue.inspection.outcome === "resolved" ? "#f0fdf4" : "#fffbeb", padding: "2px 7px", borderRadius: 4, border: `1px solid ${issue.inspection.outcome === "resolved" ? "#86efac" : "#fde68a"}` }}>
                        Outcome: {issue.inspection.outcome === "resolved" ? "Resolved on-site" : "Follow-up work required"}
                      </span>
                    </div>
                  )}
                </div>
              </Section>
            )}

            {issue.work_orders?.length > 0 && (
              <Section title={`Linked Work Orders (${issue.work_orders.length})`}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {issue.work_orders.map(wo => (
                    <div key={wo.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px" }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#1e293b" }}>{wo.title}</div>
                        <div style={{ fontSize: 11, color: "#64748b" }}>{wo.company_name}{wo.assigned_to_name ? ` — ${wo.assigned_to_name}` : ""}</div>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <SeverityBadge severity={wo.priority} />
                        <StatusBadge status={wo.status} />
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            <Section title="Status History">
              <div style={{ position: "relative" }}>
                <div style={{ position: "absolute", left: 10, top: 8, bottom: 8, width: 1.5, background: "#e2e8f0" }} />
                {issue.status_history?.map(h => {
                  const cfg = STATUS_CONFIG[h.new_status] ?? STATUS_CONFIG.open;
                  return (
                    <div key={h.id} style={{ display: "flex", gap: 12, marginBottom: 13, paddingLeft: 28, position: "relative" }}>
                      <div style={{ position: "absolute", left: 5, top: 4, width: 11, height: 11, borderRadius: "50%", background: cfg.color, border: "2px solid white", boxShadow: `0 0 0 1.5px ${cfg.color}` }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 2, flexWrap: "wrap" }}>
                          <StatusBadge status={h.new_status} />
                          <span style={{ fontSize: 11, color: "#6b7280" }}>by {h.changed_by_name}</span>
                        </div>
                        {h.notes && <div style={{ fontSize: 12, color: "#374151", background: "#f8fafc", borderRadius: 4, padding: "3px 8px", marginTop: 3 }}>{h.notes}</div>}
                        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3 }}>{fmtDate(h.created_at)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>

            {next && issue.status !== "closed" && (
              <div style={{ background: "#f8fafc", border: "1.5px dashed #cbd5e1", borderRadius: 8, padding: "12px 14px", marginBottom: 16 }}>
                {advErr && <ErrBanner msg={advErr} onDismiss={() => setAdvErr(null)} />}
                {!showAdv ? (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: "#475569" }}>Advance to <strong style={{ color: STATUS_CONFIG[next].color }}>{nextLabel}</strong></span>
                    <button onClick={() => setShowAdv(true)} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: STATUS_CONFIG[next].color, color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>→ {nextLabel}</button>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 8 }}>Advance to <span style={{ color: STATUS_CONFIG[next].color }}>{nextLabel}</span></div>
                    <textarea value={advNotes} onChange={e => setAdvNotes(e.target.value)} placeholder="Notes (optional)" rows={2} style={{ width: "100%", boxSizing: "border-box", padding: "7px 9px", borderRadius: 6, fontSize: 12, border: "1.5px solid #d1d5db", resize: "none", fontFamily: "inherit", marginBottom: 8 }} />
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button onClick={() => { setShowAdv(false); setAdvNotes(""); setAdvErr(null); }} style={{ padding: "5px 12px", border: "1.5px solid #d1d5db", borderRadius: 5, background: "white", fontSize: 12, cursor: "pointer" }}>Cancel</button>
                      <button onClick={handleAdvance} disabled={advancing} style={{ padding: "5px 14px", border: "none", borderRadius: 5, background: STATUS_CONFIG[next].color, color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: advancing ? 0.7 : 1 }}>
                        {advancing ? "Advancing…" : "Confirm"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function IssueRequests({ token, user }) {
  const api = useApi(token);

  const [issues, setIssues]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [err, setErr]           = useState(null);
  const [selectedId, setSel]    = useState(null);
  const [showRaise, setShowRaise] = useState(false);
  const [filterStatus,   setFStatus]   = useState("all");
  const [filterSeverity, setFSeverity] = useState("all");
  const [filterCompany,  setFCompany]  = useState("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const params = new URLSearchParams();
      if (filterStatus   !== "all") params.set("status",            filterStatus);
      if (filterSeverity !== "all") params.set("severity",          filterSeverity);
      if (filterCompany  !== "all") params.set("target_company_id", filterCompany);
      const d = await api.get(`/issues?${params}`);
      setIssues(d.issues ?? []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [api, filterStatus, filterSeverity, filterCompany]);

  useEffect(() => { load(); }, [load]);

  const filtered = issues.filter(i =>
    !search || i.title.toLowerCase().includes(search.toLowerCase()) || i.fault_description?.toLowerCase().includes(search.toLowerCase())
  );

  const counts = {
    total: issues.length,
    open: issues.filter(i => i.status === "open").length,
    assigned: issues.filter(i => i.status === "assigned").length,
    inspecting: issues.filter(i => i.status === "inspecting").length,
    follow_up_work: issues.filter(i => i.status === "follow_up_work").length,
    closed: issues.filter(i => i.status === "closed").length,
    critical_open: issues.filter(i => i.severity === "critical" && i.status !== "closed").length,
  };

  const companies = [...new Map(issues.map(i => [i.target_company_id, i.target_company_name])).entries()].map(([id, name]) => ({ id, name }));

  const handleCreate = (issue) => { setIssues(p => [issue, ...p]); setShowRaise(false); setSel(issue.id); };
  const handleUpdated = (updated) => { setIssues(p => p.map(i => i.id === updated.id ? { ...i, ...updated } : i)); };

  return (
    <div style={{ fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif", height: "100vh", display: "flex", flexDirection: "column", background: "#f1f5f9", overflow: "hidden" }}>

      {/* Top bar */}
      <div style={{ background: "white", borderBottom: "1px solid #e2e8f0", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", letterSpacing: "-0.01em" }}>Issue Requests</span>
          {counts.critical_open > 0 && (
            <span style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5", padding: "2px 9px", borderRadius: 12, fontSize: 11, fontWeight: 700 }}>
              ● {counts.critical_open} CRITICAL
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={load} title="Refresh" style={{ background: "none", border: "1.5px solid #e2e8f0", borderRadius: 6, padding: "5px 10px", cursor: "pointer", color: "#64748b", fontSize: 13 }}>↻</button>
          {user?.role === "help_desk_agent" && (
            <button onClick={() => setShowRaise(true)} style={{ padding: "7px 16px", borderRadius: 7, border: "none", background: "#2563eb", color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer", boxShadow: "0 1px 3px rgba(37,99,235,0.35)" }}>
              + Raise Issue
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* List panel */}
        <div style={{ width: selectedId ? 480 : "100%", flexShrink: 0, display: "flex", flexDirection: "column", background: "white", borderRight: "1px solid #e2e8f0", overflow: "hidden" }}>

          <div style={{ padding: "10px 16px", borderBottom: "1px solid #f1f5f9", background: "#fafbfc", flexShrink: 0 }}>
            <div style={{ position: "relative", marginBottom: 8 }}>
              <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", fontSize: 12 }}>🔍</span>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search issues…" style={{ width: "100%", boxSizing: "border-box", padding: "6px 10px 6px 28px", border: "1.5px solid #e2e8f0", borderRadius: 6, fontSize: 12, background: "white", outline: "none", fontFamily: "inherit" }} />
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: companies.length > 0 ? 6 : 0 }}>
              {[["all","All",counts.total],["open","Open",counts.open],["assigned","Assigned",counts.assigned],["inspecting","Inspecting",counts.inspecting],["follow_up_work","Follow-up",counts.follow_up_work],["closed","Closed",counts.closed]].map(([val, label, count]) => (
                <button key={val} onClick={() => setFStatus(val)} style={{ padding: "3px 9px", borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: "pointer", border: "1.5px solid", borderColor: filterStatus === val ? "#2563eb" : "#e2e8f0", background: filterStatus === val ? "#eff6ff" : "white", color: filterStatus === val ? "#2563eb" : "#64748b" }}>
                  {label} ({count})
                </button>
              ))}
            </div>
            {companies.length > 1 && (
              <select value={filterCompany} onChange={e => setFCompany(e.target.value)} style={{ fontSize: 11, border: "1.5px solid #e2e8f0", borderRadius: 5, padding: "3px 8px", background: "white", color: "#374151", cursor: "pointer", fontFamily: "inherit" }}>
                <option value="all">All companies</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "3fr 1.2fr 1fr 1fr 1fr 60px", gap: 12, padding: "6px 20px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", flexShrink: 0 }}>
            {["Issue","Company","Severity","Status","Raised","WOs"].map(h => (
              <div key={h} style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</div>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            {loading && <div style={{ display: "flex", justifyContent: "center", paddingTop: 48 }}><Spinner size={28} /></div>}
            {err && !loading && <div style={{ padding: 20 }}><ErrBanner msg={err} /></div>}
            {!loading && !err && filtered.length === 0 && (
              <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
                {issues.length === 0 ? "No issues raised yet." : "No issues match the current filter."}
              </div>
            )}
            {!loading && filtered.map(issue => (
              <IssueRow key={issue.id} issue={issue} onClick={() => setSel(issue.id)} isSelected={selectedId === issue.id} />
            ))}
          </div>
        </div>

        {selectedId && (
          <IssueDetail api={api} user={user} issueId={selectedId} onClose={() => setSel(null)} onUpdated={handleUpdated} />
        )}
      </div>

      {showRaise && <RaiseIssueForm api={api} user={user} onCancel={() => setShowRaise(false)} onCreate={handleCreate} />}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        @keyframes spin { to { transform: rotate(360deg); } }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
        select, input, textarea, button { font-family: inherit; }
      `}</style>
    </div>
  );
}
