// src/hooks/useWorkOrders.ts
// All reads come from local SQLite — never directly from the network.
// The sync engine keeps SQLite up to date; these hooks just query it.

import { useEffect, useState, useCallback } from 'react';
import { dbQuery, dbRun } from '@/db/database';
import { useAuthStore } from '@/store/authStore';
import type { WorkOrder, WorkOrderTask, ChecklistItem, ChecklistResponse } from '@/utils/types';

// ── Work Orders ───────────────────────────────────────────────────────────────

export function useWorkOrders(filter: 'active' | 'all' = 'active') {
  const user = useAuthStore(s => s.user);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading]       = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const rows = await dbQuery<WorkOrder>(
        `SELECT * FROM work_orders
         WHERE assigned_to = ?
           ${filter === 'active' ? "AND status NOT IN ('completed')" : ''}
         ORDER BY
           CASE priority
             WHEN 'critical' THEN 0
             WHEN 'high'     THEN 1
             WHEN 'medium'   THEN 2
             WHEN 'low'      THEN 3
           END,
           created_at ASC`,
        [user.id]
      );
      setWorkOrders(rows);
    } finally {
      setLoading(false);
    }
  }, [user, filter]);

  useEffect(() => { load(); }, [load]);

  return { workOrders, loading, reload: load };
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export function useTasks(workOrderId: string) {
  const [tasks, setTasks]   = useState<WorkOrderTask[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await dbQuery<WorkOrderTask>(
        `SELECT * FROM work_order_tasks
         WHERE work_order_id = ?
         ORDER BY sequence`,
        [workOrderId]
      );
      setTasks(rows);
    } finally {
      setLoading(false);
    }
  }, [workOrderId]);

  useEffect(() => { load(); }, [load]);

  return { tasks, loading, reload: load };
}

// ── Checklist items + responses ───────────────────────────────────────────────

export function useChecklistItems(checklistId: string | null) {
  const [items, setItems]     = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!checklistId) { setLoading(false); return; }
    setLoading(true);
    try {
      const rows = await dbQuery<ChecklistItem>(
        `SELECT * FROM checklist_items WHERE checklist_id = ? ORDER BY sequence`,
        [checklistId]
      );
      setItems(rows);
    } finally {
      setLoading(false);
    }
  }, [checklistId]);

  useEffect(() => { load(); }, [load]);

  return { items, loading, reload: load };
}

export function useResponses(taskId: string) {
  const [responses, setResponses] = useState<Record<string, ChecklistResponse>>({});
  const [loading, setLoading]     = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await dbQuery<ChecklistResponse>(
        `SELECT * FROM checklist_responses WHERE work_order_task_id = ?`,
        [taskId]
      );
      const map: Record<string, ChecklistResponse> = {};
      for (const r of rows) map[r.asset_checklist_item_id] = r;
      setResponses(map);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  return { responses, loading, reload: load };
}

// ── Write helpers (write to SQLite + enqueue outbox) ─────────────────────────

export async function localTransitionTask(
  workOrderId: string,
  task: WorkOrderTask,
  transition: 'start' | 'complete' | 'skip',
  actual_duration_minutes?: number
): Promise<void> {
  const newStatus =
    transition === 'start'    ? 'in_progress' :
    transition === 'complete' ? 'completed'   : 'skipped';

  const now = new Date().toISOString();
  await dbRun(
    `UPDATE work_order_tasks
     SET status = ?,
         started_at   = CASE WHEN ? = 'in_progress' THEN ? ELSE started_at END,
         completed_at = CASE WHEN ? IN ('completed','skipped') THEN ? ELSE completed_at END,
         actual_duration_minutes = COALESCE(?, actual_duration_minutes)
     WHERE id = ?`,
    [newStatus, newStatus, now, newStatus, now, actual_duration_minutes ?? null, task.id]
  );

  // Enqueue outbox
  await dbRun(
    `INSERT INTO outbox (id, entity_type, entity_id, operation, payload, created_at)
     VALUES (?, 'task_transition', ?, 'UPDATE', ?, ?)`,
    [
      `${task.id}_${transition}_${Date.now()}`,
      task.id,
      JSON.stringify({ workOrderId, taskId: task.id, transition, actual_duration_minutes }),
      now,
    ]
  );

  // If WO is still 'assigned', optimistically move it to 'in_progress'
  if (transition === 'start') {
    await dbRun(
      `UPDATE work_orders SET status = 'in_progress'
       WHERE id = ? AND status = 'assigned'`,
      [workOrderId]
    );
  }
}

export async function localSaveResponse(
  workOrderId: string,
  taskId: string,
  itemId: string,
  responseData: {
    numeric_value?:   number;
    boolean_value?:   boolean;
    text_value?:      string;
    photo_url?:       string;
    local_photo_path?: string;
    notes?:           string;
  },
  item: ChecklistItem
): Promise<void> {
  const now = new Date().toISOString();
  const user = useAuthStore.getState().user!;

  // Calculate is_out_of_range locally
  let is_out_of_range = 0;
  if (
    item.item_type === 'measurement' &&
    responseData.numeric_value !== undefined
  ) {
    const v = responseData.numeric_value;
    if ((item.min_value !== null && v < item.min_value) ||
        (item.max_value !== null && v > item.max_value)) {
      is_out_of_range = 1;
    }
  }

  const id = `${itemId}_${taskId}`;

  await dbRun(
    `INSERT INTO checklist_responses
       (id, asset_checklist_item_id, work_order_task_id, responded_by,
        responded_at, numeric_value, boolean_value, text_value, photo_url,
        notes, is_out_of_range, is_pending_sync, local_photo_path)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)
     ON CONFLICT(asset_checklist_item_id, work_order_task_id) DO UPDATE SET
       numeric_value=excluded.numeric_value,
       boolean_value=excluded.boolean_value,
       text_value=excluded.text_value, photo_url=excluded.photo_url,
       notes=excluded.notes, is_out_of_range=excluded.is_out_of_range,
       responded_by=excluded.responded_by, responded_at=excluded.responded_at,
       is_pending_sync=1, local_photo_path=excluded.local_photo_path`,
    [
      id, itemId, taskId, user.id, now,
      responseData.numeric_value    ?? null,
      responseData.boolean_value !== undefined ? (responseData.boolean_value ? 1 : 0) : null,
      responseData.text_value       ?? null,
      responseData.photo_url        ?? null,
      responseData.notes            ?? null,
      is_out_of_range,
      responseData.local_photo_path ?? null,
    ]
  );

  // Enqueue outbox
  await dbRun(
    `INSERT INTO outbox (id, entity_type, entity_id, operation, payload, created_at)
     VALUES (?, 'checklist_response', ?, 'UPSERT', ?, ?)
     ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, created_at=excluded.created_at`,
    [
      `resp_${itemId}_${taskId}`,
      id,
      JSON.stringify({
        workOrderId, taskId,
        asset_checklist_item_id: itemId,
        ...responseData,
      }),
      now,
    ]
  );
}
