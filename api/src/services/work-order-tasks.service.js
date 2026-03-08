// src/services/work-order-tasks.service.js
'use strict';

const { query } = require('../db/pool');

const VALID_TASK_TYPES   = ['checklist_execution', 'inspection', 'general', 'safety_check', 'reading'];
const VALID_TASK_STATUSES = ['pending', 'in_progress', 'completed', 'skipped'];

const TASK_TRANSITIONS = {
  pending:     ['in_progress', 'skipped'],
  in_progress: ['completed',   'skipped'],
  completed:   [],
  skipped:     [],
};

function fail(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code   = code;
  throw err;
}

// ─────────────────────────────────────────
// ACCESS HELPERS
// ─────────────────────────────────────────

/**
 * Load a work order and verify the requesting user has access.
 * Returns the work order row.
 */
async function loadWorkOrder(workOrderId, requestingUser) {
  const { rows } = await query(
    `SELECT id, company_id, status, assigned_to FROM work_orders WHERE id = $1`,
    [workOrderId]
  );
  if (rows.length === 0) fail(404, 'NOT_FOUND', 'Work order not found');
  const wo = rows[0];

  if (requestingUser.role === 'help_desk_agent') return wo;
  if (wo.company_id !== requestingUser.company_id) fail(403, 'FORBIDDEN', 'Access denied');

  // Technicians can only access WOs assigned to them
  if (requestingUser.role === 'technician' && wo.assigned_to !== requestingUser.id) {
    fail(403, 'FORBIDDEN', 'Technicians can only access their own work orders');
  }

  return wo;
}

/**
 * Load a task and verify it belongs to the given work order.
 */
async function loadTask(taskId, workOrderId) {
  const { rows } = await query(
    `SELECT * FROM work_order_tasks WHERE id = $1 AND work_order_id = $2`,
    [taskId, workOrderId]
  );
  if (rows.length === 0) fail(404, 'NOT_FOUND', 'Task not found on this work order');
  return rows[0];
}

// ─────────────────────────────────────────
// TASKS
// ─────────────────────────────────────────

async function listTasks(workOrderId, requestingUser) {
  await loadWorkOrder(workOrderId, requestingUser);

  const { rows } = await query(
    `SELECT t.*,
            ac.name AS asset_checklist_name
     FROM work_order_tasks t
     LEFT JOIN asset_checklists ac ON ac.id = t.asset_checklist_id
     WHERE t.work_order_id = $1
     ORDER BY t.sequence`,
    [workOrderId]
  );
  return rows;
}

async function getTask(workOrderId, taskId, requestingUser) {
  await loadWorkOrder(workOrderId, requestingUser);
  const { rows } = await query(
    `SELECT t.*,
            ac.name AS asset_checklist_name
     FROM work_order_tasks t
     LEFT JOIN asset_checklists ac ON ac.id = t.asset_checklist_id
     WHERE t.id = $1 AND t.work_order_id = $2`,
    [taskId, workOrderId]
  );
  if (rows.length === 0) fail(404, 'NOT_FOUND', 'Task not found on this work order');
  return rows[0];
}

async function createTask(workOrderId, data, requestingUser) {
  const wo = await loadWorkOrder(workOrderId, requestingUser);

  if (requestingUser.role === 'technician') {
    fail(403, 'FORBIDDEN', 'Technicians cannot create tasks');
  }
  if (wo.status === 'completed') {
    fail(400, 'INVALID_OPERATION', 'Cannot add tasks to a completed work order');
  }

  const { title, description, task_type, asset_checklist_id, sequence, estimated_duration_minutes } = data;

  if (!title)     fail(400, 'VALIDATION_ERROR', 'title is required');
  if (!task_type) fail(400, 'VALIDATION_ERROR', 'task_type is required');
  if (!VALID_TASK_TYPES.includes(task_type)) {
    fail(400, 'INVALID_TASK_TYPE',
      `Invalid task_type '${task_type}'. Must be one of: ${VALID_TASK_TYPES.join(', ')}`
    );
  }

  // checklist_execution tasks must reference a valid active asset checklist
  let resolvedChecklistId = null;
  if (task_type === 'checklist_execution') {
    if (!asset_checklist_id) {
      fail(400, 'VALIDATION_ERROR', 'asset_checklist_id is required for checklist_execution tasks');
    }
    const { rows: clRows } = await query(
      `SELECT id, company_id, is_active FROM asset_checklists WHERE id = $1`,
      [asset_checklist_id]
    );
    if (clRows.length === 0) fail(404, 'NOT_FOUND', 'Asset checklist not found');
    if (clRows[0].company_id !== wo.company_id) {
      fail(400, 'VALIDATION_ERROR', 'Asset checklist must belong to the same company as the work order');
    }
    if (!clRows[0].is_active) {
      fail(400, 'INVALID_OPERATION', 'Cannot attach an inactive asset checklist');
    }
    resolvedChecklistId = asset_checklist_id;
  }

  // Auto-assign sequence if not provided
  let taskSequence = sequence;
  if (taskSequence === undefined || taskSequence === null) {
    const { rows: seqRows } = await query(
      `SELECT COALESCE(MAX(sequence), 0) + 1 AS next_seq
       FROM work_order_tasks WHERE work_order_id = $1`,
      [workOrderId]
    );
    taskSequence = seqRows[0].next_seq;
  }

  const { rows } = await query(
    `INSERT INTO work_order_tasks
       (work_order_id, sequence, title, description, task_type,
        asset_checklist_id, estimated_duration_minutes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [workOrderId, taskSequence, title, description || null, task_type,
     resolvedChecklistId, estimated_duration_minutes || null]
  );
  return rows[0];
}

async function updateTask(workOrderId, taskId, data, requestingUser) {
  const wo   = await loadWorkOrder(workOrderId, requestingUser);
  const task = await loadTask(taskId, workOrderId);

  if (requestingUser.role === 'technician') {
    fail(403, 'FORBIDDEN', 'Technicians cannot edit task definitions');
  }
  if (['completed', 'skipped'].includes(task.status)) {
    fail(400, 'INVALID_OPERATION', 'Cannot edit a completed or skipped task');
  }
  if (wo.status === 'completed') {
    fail(400, 'INVALID_OPERATION', 'Cannot edit tasks on a completed work order');
  }

  const { title, description, sequence, estimated_duration_minutes } = data;
  const fields = [];
  const params = [];
  let   idx    = 1;

  if (title                       !== undefined) { fields.push(`title = $${idx++}`);                       params.push(title); }
  if (description                 !== undefined) { fields.push(`description = $${idx++}`);                 params.push(description); }
  if (sequence                    !== undefined) { fields.push(`sequence = $${idx++}`);                    params.push(sequence); }
  if (estimated_duration_minutes  !== undefined) { fields.push(`estimated_duration_minutes = $${idx++}`);  params.push(estimated_duration_minutes); }

  if (fields.length === 0) fail(400, 'VALIDATION_ERROR', 'No fields to update');

  fields.push('updated_at = NOW()');
  params.push(taskId);

  const { rows } = await query(
    `UPDATE work_order_tasks SET ${fields.join(', ')}
     WHERE id = $${idx} RETURNING *`,
    params
  );
  return rows[0];
}

async function transitionTask(workOrderId, taskId, newStatus, data = {}, requestingUser) {
  const wo   = await loadWorkOrder(workOrderId, requestingUser);
  const task = await loadTask(taskId, workOrderId);

  if (wo.status === 'completed') {
    fail(400, 'INVALID_OPERATION', 'Cannot transition tasks on a completed work order');
  }

  const allowed = TASK_TRANSITIONS[task.status] || [];
  if (!allowed.includes(newStatus)) {
    fail(400, 'INVALID_TRANSITION',
      `Cannot transition task from '${task.status}' to '${newStatus}'`
    );
  }

  // Before completing a checklist_execution task, enforce all required items are answered
  if (newStatus === 'completed' && task.task_type === 'checklist_execution' && task.asset_checklist_id) {
    const { rows: checkRows } = await query(
      `SELECT COUNT(i.id) FILTER (WHERE i.is_required AND r.id IS NULL)::int AS missing_required
       FROM asset_checklist_items i
       LEFT JOIN asset_checklist_responses r
         ON r.asset_checklist_item_id = i.id
        AND r.work_order_task_id = $2
       WHERE i.checklist_id = $1`,
      [task.asset_checklist_id, taskId]
    );
    if (checkRows[0].missing_required > 0) {
      fail(400, 'INCOMPLETE_CHECKLIST',
        `Cannot complete task: ${checkRows[0].missing_required} required checklist item(s) have no response`
      );
    }
  }

  const fields = [`status = $1`];
  const params = [newStatus];
  let   idx    = 2;

  if (data.actual_duration_minutes !== undefined) {
    fields.push(`actual_duration_minutes = $${idx++}`);
    params.push(data.actual_duration_minutes);
  }

  fields.push('updated_at = NOW()');
  params.push(taskId);

  const { rows } = await query(
    `UPDATE work_order_tasks SET ${fields.join(', ')}
     WHERE id = $${idx} RETURNING *`,
    params
  );
  return rows[0];
}

async function deleteTask(workOrderId, taskId, requestingUser) {
  const wo = await loadWorkOrder(workOrderId, requestingUser);

  if (requestingUser.role === 'technician') {
    fail(403, 'FORBIDDEN', 'Technicians cannot delete tasks');
  }
  if (wo.status === 'completed') {
    fail(400, 'INVALID_OPERATION', 'Cannot delete tasks from a completed work order');
  }

  const task = await loadTask(taskId, workOrderId);
  if (['completed', 'skipped'].includes(task.status)) {
    fail(400, 'INVALID_OPERATION', 'Cannot delete a completed or skipped task');
  }

  await query(`DELETE FROM work_order_tasks WHERE id = $1`, [taskId]);
  return { message: 'Task deleted' };
}

// ─────────────────────────────────────────
// CHECKLIST RESPONSES
// ─────────────────────────────────────────

async function listResponses(workOrderId, taskId, requestingUser) {
  await loadWorkOrder(workOrderId, requestingUser);
  const task = await loadTask(taskId, workOrderId);

  if (task.task_type !== 'checklist_execution' || !task.asset_checklist_id) {
    fail(400, 'INVALID_OPERATION', 'This task does not have an associated asset checklist');
  }

  const { rows } = await query(
    `SELECT i.id             AS item_id,
            i.sequence,
            i.label,
            i.description    AS item_description,
            i.item_type,
            i.unit,
            i.min_value,
            i.max_value,
            i.is_required,
            i.is_runtime_trigger,
            r.id             AS response_id,
            r.numeric_value,
            r.boolean_value,
            r.text_value,
            r.photo_url,
            r.is_out_of_range,
            r.notes          AS response_notes,
            r.responded_at,
            r.responded_by,
            u.full_name      AS responded_by_name
     FROM asset_checklist_items i
     LEFT JOIN asset_checklist_responses r
            ON r.asset_checklist_item_id = i.id
           AND r.work_order_task_id = $2
     LEFT JOIN users u ON u.id = r.responded_by
     WHERE i.checklist_id = $1
     ORDER BY i.sequence`,
    [task.asset_checklist_id, taskId]
  );
  return rows;
}

async function submitResponse(workOrderId, taskId, data, requestingUser) {
  const wo   = await loadWorkOrder(workOrderId, requestingUser);
  const task = await loadTask(taskId, workOrderId);

  if (task.task_type !== 'checklist_execution' || !task.asset_checklist_id) {
    fail(400, 'INVALID_OPERATION', 'This task does not have an associated asset checklist');
  }
  if (task.status === 'skipped') {
    fail(400, 'INVALID_OPERATION', 'Cannot respond to items on a skipped task');
  }
  if (task.status === 'completed') {
    fail(400, 'INVALID_OPERATION', 'Cannot respond to items on a completed task');
  }
  if (wo.status === 'completed') {
    fail(400, 'INVALID_OPERATION', 'Cannot submit responses on a completed work order');
  }

  const { asset_checklist_item_id, numeric_value, boolean_value, text_value, photo_url, notes } = data;

  if (!asset_checklist_item_id) {
    fail(400, 'VALIDATION_ERROR', 'asset_checklist_item_id is required');
  }

  // Verify the item belongs to this task's checklist
  const { rows: itemRows } = await query(
    `SELECT id, item_type, is_required FROM asset_checklist_items
     WHERE id = $1 AND checklist_id = $2`,
    [asset_checklist_item_id, task.asset_checklist_id]
  );
  if (itemRows.length === 0) {
    fail(404, 'NOT_FOUND', 'Checklist item not found on this task\'s checklist');
  }

  const item = itemRows[0];

  // Validate that at least one response value is provided
  const hasValue = numeric_value !== undefined || boolean_value !== undefined ||
                   text_value    !== undefined || photo_url     !== undefined;
  if (!hasValue) {
    fail(400, 'VALIDATION_ERROR',
      'At least one response value is required (numeric_value, boolean_value, text_value, or photo_url)'
    );
  }

  // Validate correct response type for item_type
  if (item.item_type === 'measurement' && numeric_value === undefined) {
    fail(400, 'VALIDATION_ERROR', 'numeric_value is required for measurement items');
  }
  if (item.item_type === 'true_false' && boolean_value === undefined) {
    fail(400, 'VALIDATION_ERROR', 'boolean_value is required for true_false items');
  }
  if (item.item_type === 'step' && boolean_value === undefined) {
    fail(400, 'VALIDATION_ERROR', 'boolean_value is required for step items');
  }
  if (item.item_type === 'text' && text_value === undefined) {
    fail(400, 'VALIDATION_ERROR', 'text_value is required for text items');
  }
  if (item.item_type === 'photo' && photo_url === undefined) {
    fail(400, 'VALIDATION_ERROR', 'photo_url is required for photo items');
  }

  // Upsert: one response per item per task
  const { rows } = await query(
    `INSERT INTO asset_checklist_responses
       (asset_checklist_item_id, work_order_task_id, responded_by,
        numeric_value, boolean_value, text_value, photo_url, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (asset_checklist_item_id, work_order_task_id)
     DO UPDATE SET
       numeric_value = EXCLUDED.numeric_value,
       boolean_value = EXCLUDED.boolean_value,
       text_value    = EXCLUDED.text_value,
       photo_url     = EXCLUDED.photo_url,
       notes         = EXCLUDED.notes,
       responded_by  = EXCLUDED.responded_by,
       responded_at  = NOW()
     RETURNING *`,
    [
      asset_checklist_item_id,
      taskId,
      requestingUser.id,
      numeric_value  ?? null,
      boolean_value  ?? null,
      text_value     ?? null,
      photo_url      ?? null,
      notes          || null,
    ]
  );
  return rows[0];
}

// ─────────────────────────────────────────
// submitResponses  (bulk wrapper around submitResponse)
// Called by POST /:taskId/responses with body { responses: [...] }
// Processes each item in order; collects results and per-item errors.
// A validation error on one item does NOT abort the others.
// ─────────────────────────────────────────
async function submitResponses(workOrderId, taskId, responsesArray, requestingUser) {
  // Guard: validate at task level once before iterating
  await loadWorkOrder(workOrderId, requestingUser);
  const task = await loadTask(taskId, workOrderId);

  if (task.task_type !== 'checklist_execution' || !task.asset_checklist_id) {
    fail(400, 'INVALID_OPERATION', 'This task does not have an associated asset checklist');
  }
  if (task.status === 'skipped') {
    fail(400, 'INVALID_OPERATION', 'Cannot respond to items on a skipped task');
  }
  if (task.status === 'completed') {
    fail(400, 'INVALID_OPERATION', 'Cannot respond to items on a completed task');
  }

  const results = [];
  const errors  = [];

  for (const item of responsesArray) {
    try {
      // Re-use the full single-item validation and upsert logic
      const saved = await submitResponse(workOrderId, taskId, item, requestingUser);
      results.push(saved);
    } catch (err) {
      errors.push({
        asset_checklist_item_id: item.asset_checklist_item_id ?? null,
        code:    err.code    ?? 'INTERNAL_ERROR',
        message: err.message ?? 'Unexpected error',
      });
    }
  }

  // If every item failed, surface the first error as a hard failure
  // so the route returns a non-201 and the caller knows nothing was saved.
  if (results.length === 0 && errors.length > 0) {
    const first = errors[0];
    fail(400, first.code, first.message);
  }

  return { responses: results, errors };
}

async function deleteResponse(workOrderId, taskId, responseId, requestingUser) {
  await loadWorkOrder(workOrderId, requestingUser);
  const task = await loadTask(taskId, workOrderId);

  if (task.status === 'completed') {
    fail(400, 'INVALID_OPERATION', 'Cannot delete responses from a completed task');
  }

  const { rows } = await query(
    `DELETE FROM asset_checklist_responses
     WHERE id = $1 AND work_order_task_id = $2
     RETURNING id`,
    [responseId, taskId]
  );
  if (rows.length === 0) fail(404, 'NOT_FOUND', 'Response not found on this task');
  return { message: 'Response deleted' };
}

module.exports = {
  listTasks,
  getTask,
  createTask,
  updateTask,
  transitionTask,
  deleteTask,
  listResponses,
  submitResponse,
  submitResponses,
  deleteResponse,
  VALID_TASK_TYPES,
  VALID_TASK_STATUSES,
};
