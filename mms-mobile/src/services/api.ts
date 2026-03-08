// src/services/api.ts
// All requests go through this client. It:
//   1. Reads the auth token from the auth store
//   2. Throws typed ApiError on non-2xx responses
//   3. Throws NetworkError if the device cannot reach the server

import { API_URL } from '@/utils/config';
import { useAuthStore } from '@/store/authStore';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class NetworkError extends Error {
  constructor(message = 'Cannot reach server — working offline') {
    super(message);
    this.name = 'NetworkError';
  }
}

export async function apiFetch<T>(
  method: string,
  path: string,
  body?: unknown,
  overrideToken?: string
): Promise<T> {
  const token = overrideToken ?? useAuthStore.getState().token;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new NetworkError();
  }

  if (!res.ok) {
    let code = 'UNKNOWN_ERROR';
    let message = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      code    = data.code    ?? code;
      message = data.message ?? message;
    } catch { /* ignore parse error */ }
    throw new ApiError(res.status, code, message);
  }

  return res.json() as Promise<T>;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (email: string, password: string) =>
    apiFetch<{ token: string; user: import('@/utils/types').User }>('POST', '/auth/login', { email, password }),

  me: () =>
    apiFetch<{ user: import('@/utils/types').User }>('GET', '/auth/me'),

  logout: () =>
    apiFetch<{ message: string }>('POST', '/auth/logout'),

  changePassword: (current_password: string, new_password: string) =>
    apiFetch<{ message: string }>('POST', '/auth/change-password', { current_password, new_password }),
};

// ── Work Orders ───────────────────────────────────────────────────────────────

export const workOrderApi = {
  list: () =>
    apiFetch<{ work_orders: import('@/utils/types').WorkOrder[] }>('GET', '/work-orders'),

  get: (id: string) =>
    apiFetch<{ work_order: import('@/utils/types').WorkOrder }>('GET', `/work-orders/${id}`),

  create: (data: {
    title: string;
    description?: string;
    priority?: string;
    asset_graph_id?: string;
  }) =>
    apiFetch<{ work_order: import('@/utils/types').WorkOrder }>('POST', '/work-orders', data),

  start: (id: string) =>
    apiFetch<{ work_order: import('@/utils/types').WorkOrder }>('POST', `/work-orders/${id}/start`, {}),

  complete: (id: string, notes?: string | null, actual_duration_minutes?: number, started_at?: string | null, completed_at?: string | null) =>
    apiFetch<{ work_order: import('@/utils/types').WorkOrder }>('POST', `/work-orders/${id}/complete`, { notes, actual_duration_minutes, started_at, completed_at }),

  hold: (id: string, reason?: string) =>
    apiFetch<{ work_order: import('@/utils/types').WorkOrder }>('POST', `/work-orders/${id}/hold`, { reason }),

  resume: (id: string) =>
    apiFetch<{ work_order: import('@/utils/types').WorkOrder }>('POST', `/work-orders/${id}/start`, {}),

  addUpdate: (id: string, notes: string) =>
    apiFetch<{ update: any }>('POST', `/work-orders/${id}/updates`, { notes }),
};

// ── Tasks ─────────────────────────────────────────────────────────────────────

export const taskApi = {
  list: (workOrderId: string) =>
    apiFetch<{ tasks: import('@/utils/types').WorkOrderTask[] }>('GET', `/work-orders/${workOrderId}/tasks`),

  start: (workOrderId: string, taskId: string) =>
    apiFetch<{ task: import('@/utils/types').WorkOrderTask }>('POST', `/work-orders/${workOrderId}/tasks/${taskId}/start`, {}),

  complete: (workOrderId: string, taskId: string, actual_duration_minutes?: number) =>
    apiFetch<{ task: import('@/utils/types').WorkOrderTask }>('POST', `/work-orders/${workOrderId}/tasks/${taskId}/complete`, { actual_duration_minutes }),

  skip: (workOrderId: string, taskId: string) =>
    apiFetch<{ task: import('@/utils/types').WorkOrderTask }>('POST', `/work-orders/${workOrderId}/tasks/${taskId}/skip`, {}),
};

// ── Checklist Responses ───────────────────────────────────────────────────────

export const responseApi = {
  list: (workOrderId: string, taskId: string) =>
    apiFetch<{ responses: import('@/utils/types').ChecklistResponse[] }>(
      'GET', `/work-orders/${workOrderId}/tasks/${taskId}/responses`
    ),

  // Server expects: POST { responses: [...] }  (bulk upsert — one call per task)
  // Returns: { responses: ChecklistResponse[], errors: any[] }
  submit: (
    workOrderId: string,
    taskId: string,
    responses: Array<{
      asset_checklist_item_id: string;
      numeric_value?:  number | null;
      boolean_value?:  boolean | null;
      text_value?:     string | null;
      photo_url?:      string | null;
      notes?:          string | null;
    }>
  ) =>
    apiFetch<{ responses: import('@/utils/types').ChecklistResponse[]; errors: any[] }>(
      'POST', `/work-orders/${workOrderId}/tasks/${taskId}/responses`,
      { responses }
    ),

  delete: (workOrderId: string, taskId: string, responseId: string) =>
    apiFetch<{ message: string }>(
      'DELETE', `/work-orders/${workOrderId}/tasks/${taskId}/responses/${responseId}`
    ),
};

// ── Checklist Items ───────────────────────────────────────────────────────────

export const checklistApi = {
  getItems: (assetGraphId: string, checklistId: string) =>
    apiFetch<{ checklist: { items: import('@/utils/types').ChecklistItem[] } }>(
      'GET', `/checklists/assets/${assetGraphId}/${checklistId}`
    ),
};
