// All API calls go through this module.
// In dev, Vite proxies /api → localhost:3001 (see vite.config.js).
// In production (Docker), VITE_API_URL is embedded at build time.

const BASE = import.meta.env.VITE_API_URL || '/api'

// ── Token storage ────────────────────────────────────────────

export function getToken() {
  return sessionStorage.getItem('mms_token')
}

export function setToken(token) {
  sessionStorage.setItem('mms_token', token)
}

export function clearToken() {
  sessionStorage.removeItem('mms_token')
}

// ── Core fetch wrapper ───────────────────────────────────────

async function apiFetch(path, options = {}) {
  const token = getToken()
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers })

  if (res.status === 401) {
    clearToken()
    window.location.href = '/login'
    throw new Error('Session expired')
  }

  if (!res.ok) {
    let message = `API error ${res.status}`
    try {
      const body = await res.json()
      message = body.message || body.error || message
    } catch (_) {}
    throw new Error(message)
  }

  if (res.status === 204) return null
  return res.json()
}

// ── Auth ─────────────────────────────────────────────────────

export const auth = {
  // POST /auth/login → { token, user }
  login: (email, password) =>
    apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  logout: () =>
    apiFetch('/auth/logout', { method: 'POST' }),

  changePassword: (currentPassword, newPassword) =>
    apiFetch('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
}

// ── Work Orders ───────────────────────────────────────────────
// API wraps responses: { work_orders: [] } or { work_order: {} }

export const workOrders = {
  // GET /work-orders → { work_orders: [] }
  list: async (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    const res = await apiFetch(`/work-orders${qs ? `?${qs}` : ''}`)
    return res?.work_orders ?? res ?? []
  },

  // GET /work-orders/:id → { work_order: {} }
  get: async (id) => {
    const res = await apiFetch(`/work-orders/${id}`)
    return res?.work_order ?? res
  },

  // POST /work-orders → { message, work_order: {} }
  create: async (data) => {
    const res = await apiFetch('/work-orders', { method: 'POST', body: JSON.stringify(data) })
    return res?.work_order ?? res
  },

  // PATCH /work-orders/:id → { message, work_order: {} }
  update: async (id, data) => {
    const res = await apiFetch(`/work-orders/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
    return res?.work_order ?? res
  },

  // POST /work-orders/:id/assign → { message, work_order: {} }
  assign: async (id, assignedTo, notes) => {
    const res = await apiFetch(`/work-orders/${id}/assign`, {
      method: 'POST',
      body: JSON.stringify({ assigned_to: assignedTo, notes }),
    })
    return res?.work_order ?? res
  },

  // POST /work-orders/:id/start|hold|complete → { message, work_order: {} }
  transition: async (id, action, notes, extra = {}) => {
    const res = await apiFetch(`/work-orders/${id}/${action}`, {
      method: 'POST',
      body: JSON.stringify({ notes, ...extra }),
    })
    return res?.work_order ?? res
  },

  addUpdate: async (id, notes, photoUrls = []) => {
    const res = await apiFetch(`/work-orders/${id}/updates`, {
      method: 'POST',
      body: JSON.stringify({ notes, photo_urls: photoUrls }),
    })
    return res?.update ?? res
  },
}

// ── Work Order Tasks ──────────────────────────────────────────

export const workOrderTasks = {
  list: async (workOrderId) => {
    const res = await apiFetch(`/work-orders/${workOrderId}/tasks`)
    return res?.tasks ?? res ?? []
  },

  create: async (workOrderId, data) => {
    const res = await apiFetch(`/work-orders/${workOrderId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
    return res?.task ?? res
  },

  update: async (workOrderId, taskId, data) => {
    const res = await apiFetch(`/work-orders/${workOrderId}/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
    return res?.task ?? res
  },
}

// ── Checklist Responses ───────────────────────────────────────

export const checklistResponses = {
  list: async (workOrderId, taskId) => {
    const res = await apiFetch(`/work-orders/${workOrderId}/tasks/${taskId}/responses`)
    return res?.responses ?? res ?? []
  },

  submit: async (workOrderId, taskId, responses) => {
    const res = await apiFetch(`/work-orders/${workOrderId}/tasks/${taskId}/responses`, {
      method: 'POST',
      body: JSON.stringify({ responses }),
    })
    return res?.responses ?? res
  },
}

// ── Assets ────────────────────────────────────────────────────

export const assets = {
  // GET /assets/flat → { assets: [], total, offset, limit }
  // Returns enriched flat list: asset_graph_id, name, code, asset_type_name,
  // site_name, building_name, floor_name, space_name
  listFlat: async (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    const res = await apiFetch(`/assets/flat${qs ? `?${qs}` : ''}`)
    return res?.assets ?? res ?? []
  },

  // GET /assets → { nodes: [] } — raw graph nodes
  listNodes: async (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    const res = await apiFetch(`/assets${qs ? `?${qs}` : ''}`)
    return res?.nodes ?? res ?? []
  },

  // GET /assets/types → { asset_types: [] }
  listTypes: async () => {
    const res = await apiFetch('/assets/types')
    return res?.asset_types ?? res ?? []
  },

  // GET /assets/:nodeId → { node: {} }
  getNode: async (id) => {
    const res = await apiFetch(`/assets/${id}`)
    return res?.node ?? res
  },

  // GET /assets/:nodeId/hierarchy → { hierarchy: {} }
  getHierarchy: async (id) => {
    const res = await apiFetch(`/assets/${id}/hierarchy`)
    return res?.hierarchy ?? res
  },
}

// ── Preventive Maintenance ────────────────────────────────────

export const pm = {
  listSchedules: async (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    const res = await apiFetch(`/pm/schedules${qs ? `?${qs}` : ''}`)
    return res?.schedules ?? res ?? []
  },

  getSchedule: async (id) => {
    const res = await apiFetch(`/pm/schedules/${id}`)
    return res?.schedule ?? res
  },

  createSchedule: async (data) => {
    const res = await apiFetch('/pm/schedules', { method: 'POST', body: JSON.stringify(data) })
    return res?.schedule ?? res
  },

  updateSchedule: async (id, data) => {
    const res = await apiFetch(`/pm/schedules/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
    return res?.schedule ?? res
  },

  deleteSchedule: (id) => apiFetch(`/pm/schedules/${id}`, { method: 'DELETE' }),

  listTriggerTypes: async () => {
    const res = await apiFetch('/pm/trigger-types')
    return res?.trigger_types ?? res ?? []
  },

  generateWorkOrders: async (scheduleId) => {
    const res = await apiFetch(`/pm/schedules/${scheduleId}/generate`, { method: 'POST' })
    return res
  },
}

// ── Users / Technicians ───────────────────────────────────────

export const users = {
  list: async (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    const res = await apiFetch(`/users${qs ? `?${qs}` : ''}`)
    return res?.users ?? res ?? []
  },

  get: async (id) => {
    const res = await apiFetch(`/users/${id}`)
    return res?.user ?? res
  },

  create: async (data) => {
    const res = await apiFetch('/users', { method: 'POST', body: JSON.stringify(data) })
    return res?.user ?? res
  },

  update: async (id, data) => {
    const res = await apiFetch(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
    return res?.user ?? res
  },

  delete: (id) => apiFetch(`/users/${id}`, { method: 'DELETE' }),
}

// ── Companies ─────────────────────────────────────────────────

export const companies = {
  get: async (id) => {
    const res = await apiFetch(`/companies/${id}`)
    return res?.company ?? res
  },

  update: async (id, data) => {
    const res = await apiFetch(`/companies/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
    return res?.company ?? res
  },
}
