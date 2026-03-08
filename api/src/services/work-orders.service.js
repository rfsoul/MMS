// src/services/work-orders.service.js
const { query } = require('../db/pool');

// Valid statuses — matches schema CHECK constraint exactly
// Note: 'cancelled' does NOT exist in the schema
const VALID_STATUSES = ['open', 'assigned', 'in_progress', 'on_hold', 'completed'];

// Valid priorities — matches schema CHECK constraint exactly
const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];

// Valid types — matches schema CHECK constraint exactly
const VALID_TYPES = ['pm', 'inspection', 'corrective', 'replacement'];

// Allowed status transitions
const ALLOWED_TRANSITIONS = {
  open:        ['assigned'],
  assigned:    ['in_progress', 'open'],
  in_progress: ['on_hold', 'completed'],
  on_hold:     ['in_progress'],
  completed:   [],  // terminal — auto-stamps completed_at via DB trigger
};

function fail(status, code, message) {
  throw { status, code, message };
}

function assertTransition(current, next) {
  const allowed = ALLOWED_TRANSITIONS[current];
  if (!allowed) fail(400, 'INVALID_STATUS', `Unknown current status '${current}'`);
  if (!allowed.includes(next)) {
    fail(400, 'INVALID_TRANSITION',
      `Cannot transition work order from '${current}' to '${next}'. ` +
      `Allowed: ${allowed.length ? allowed.join(', ') : 'none (terminal state)'}`
    );
  }
}

function assertCompanyAccess(wo, requestingUser) {
  if (requestingUser.role === 'help_desk_agent') return;
  if (wo.company_id !== requestingUser.company_id) {
    fail(403, 'FORBIDDEN', 'Access denied');
  }
}

function assertWriteAccess(wo, requestingUser) {
  assertCompanyAccess(wo, requestingUser);
  if (requestingUser.role === 'technician' && wo.assigned_to !== requestingUser.id) {
    fail(403, 'FORBIDDEN', 'Technicians can only update work orders assigned to them');
  }
}

// ─────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────

async function createWorkOrder(data, requestingUser) {
  const {
    title,
    description,
    type = 'inspection',
    priority = 'medium',
    asset_graph_id,
    assigned_to,
    issue_id,
    inspection_id,
  } = data;

  if (!title) fail(400, 'VALIDATION_ERROR', 'title is required');

  if (!VALID_TYPES.includes(type)) {
    fail(400, 'INVALID_TYPE', `type must be one of: ${VALID_TYPES.join(', ')}`);
  }

  if (!VALID_PRIORITIES.includes(priority)) {
    fail(400, 'INVALID_PRIORITY', `priority must be one of: ${VALID_PRIORITIES.join(', ')}`);
  }

  // Technicians always self-assign
  let resolvedAssignee = assigned_to || null;
  if (requestingUser.role === 'technician') {
    resolvedAssignee = requestingUser.id;
  }

  if (resolvedAssignee) {
    const check = await query(
      `SELECT id FROM users WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
      [resolvedAssignee, requestingUser.company_id]
    );
    if (check.rows.length === 0) {
      fail(404, 'NOT_FOUND', 'Assigned user not found in your company');
    }
  }

  if (issue_id) {
    const check = await query(
      `SELECT id FROM maintenance_issues WHERE id = $1 AND target_company_id = $2`,
      [issue_id, requestingUser.company_id]
    );
    if (check.rows.length === 0) fail(404, 'NOT_FOUND', 'Issue not found for your company');
  }

  if (inspection_id) {
    const check = await query(
      `SELECT i.id FROM inspections i
       JOIN maintenance_issues mi ON mi.id = i.issue_id
       WHERE i.id = $1 AND mi.target_company_id = $2`,
      [inspection_id, requestingUser.company_id]
    );
    if (check.rows.length === 0) fail(404, 'NOT_FOUND', 'Inspection not found for your company');
  }

  const initialStatus = resolvedAssignee ? 'assigned' : 'open';

  const result = await query(
    `INSERT INTO work_orders (
      company_id, title, description, type, priority, status,
      asset_graph_id, assigned_to, created_by, issue_id, inspection_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING *`,
    [
      requestingUser.company_id,
      title,
      description || null,
      type,
      priority,
      initialStatus,
      asset_graph_id || null,
      resolvedAssignee,
      requestingUser.id,
      issue_id || null,
      inspection_id || null,
    ]
  );

  return result.rows[0];
}

// ─────────────────────────────────────────
// READ
// ─────────────────────────────────────────

async function listWorkOrders(requestingUser, filters = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (requestingUser.role !== 'help_desk_agent') {
    conditions.push(`wo.company_id = $${idx++}`);
    params.push(requestingUser.company_id);
  }

  // Technicians only see their own
  if (requestingUser.role === 'technician') {
    conditions.push(`wo.assigned_to = $${idx++}`);
    params.push(requestingUser.id);
  }

  if (filters.status) {
    if (!VALID_STATUSES.includes(filters.status)) {
      fail(400, 'INVALID_STATUS', `status must be one of: ${VALID_STATUSES.join(', ')}`);
    }
    conditions.push(`wo.status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.priority) {
    conditions.push(`wo.priority = $${idx++}`);
    params.push(filters.priority);
  }
  if (filters.assigned_to) {
    conditions.push(`wo.assigned_to = $${idx++}`);
    params.push(filters.assigned_to);
  }
  if (filters.asset_graph_id) {
    conditions.push(`wo.asset_graph_id = $${idx++}`);
    params.push(filters.asset_graph_id);
  }
  if (filters.issue_id) {
    conditions.push(`wo.issue_id = $${idx++}`);
    params.push(filters.issue_id);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query(
    `SELECT
       wo.*,
       u_assigned.full_name AS assigned_to_name,
       u_created.full_name  AS created_by_name
     FROM work_orders wo
     LEFT JOIN users u_assigned ON wo.assigned_to = u_assigned.id
     LEFT JOIN users u_created  ON wo.created_by  = u_created.id
     ${whereClause}
     ORDER BY
       CASE wo.priority
         WHEN 'critical' THEN 1
         WHEN 'high'     THEN 2
         WHEN 'medium'   THEN 3
         WHEN 'low'      THEN 4
       END,
       wo.created_at DESC`,
    params
  );

  return result.rows;
}

async function getWorkOrder(workOrderId, requestingUser) {
  const result = await query(
    `SELECT
       wo.*,
       u_assigned.full_name AS assigned_to_name,
       u_created.full_name  AS created_by_name
     FROM work_orders wo
     LEFT JOIN users u_assigned ON wo.assigned_to = u_assigned.id
     LEFT JOIN users u_created  ON wo.created_by  = u_created.id
     WHERE wo.id = $1`,
    [workOrderId]
  );

  if (result.rows.length === 0) fail(404, 'NOT_FOUND', 'Work order not found');

  const wo = result.rows[0];
  assertCompanyAccess(wo, requestingUser);

  // Fetch updates (field notes + photos from technicians)
  const updatesResult = await query(
    `SELECT u.*, usr.full_name AS updated_by_name
     FROM work_order_updates u
     LEFT JOIN users usr ON u.updated_by = usr.id
     WHERE u.work_order_id = $1
     ORDER BY u.created_at ASC`,
    [workOrderId]
  );
  wo.updates = updatesResult.rows;

  return wo;
}

// ─────────────────────────────────────────
// UPDATE FIELDS
// ─────────────────────────────────────────

async function updateWorkOrder(workOrderId, data, requestingUser) {
  const wo = await getWorkOrder(workOrderId, requestingUser);
  assertWriteAccess(wo, requestingUser);

  if (wo.status === 'completed') {
    fail(400, 'INVALID_OPERATION', 'Cannot update a completed work order');
  }

  const allowed = ['title', 'description', 'type', 'priority', 'asset_graph_id'];
  const updates = {};
  for (const key of allowed) {
    if (data[key] !== undefined) updates[key] = data[key];
  }

  // Admin / manager can reassign
  if (data.assigned_to !== undefined && requestingUser.role !== 'technician') {
    if (data.assigned_to !== null) {
      const check = await query(
        `SELECT id FROM users WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
        [data.assigned_to, requestingUser.company_id]
      );
      if (check.rows.length === 0) fail(404, 'NOT_FOUND', 'Assigned user not found in your company');
    }
    updates.assigned_to = data.assigned_to;
  }

  if (Object.keys(updates).length === 0) {
    fail(400, 'VALIDATION_ERROR', 'No valid fields to update');
  }

  const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = [workOrderId, ...Object.values(updates)];

  const result = await query(
    `UPDATE work_orders SET ${setClauses} WHERE id = $1 RETURNING *`,
    values
  );

  return result.rows[0];
}

// ─────────────────────────────────────────
// STATUS TRANSITIONS
// ─────────────────────────────────────────

/**
 * Transition status.
 * DB trigger auto-stamps completed_at and updated_at — we don't set those here.
 * actual_duration_minutes optionally recorded on completion.
 */
async function transitionStatus(workOrderId, newStatus, requestingUser, options = {}) {
  if (!VALID_STATUSES.includes(newStatus)) {
    fail(400, 'INVALID_STATUS', `status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  const wo = await getWorkOrder(workOrderId, requestingUser);
  assertWriteAccess(wo, requestingUser);
  assertTransition(wo.status, newStatus);

  const updates = { status: newStatus };
  if (newStatus === 'completed' && options.actual_duration_minutes) {
    updates.actual_duration_minutes = options.actual_duration_minutes;
  }

  const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = [workOrderId, ...Object.values(updates)];

  const result = await query(
    `UPDATE work_orders SET ${setClauses} WHERE id = $1 RETURNING *`,
    values
  );

  // Optionally record notes in work_order_updates
  if (options.notes) {
    await query(
      `INSERT INTO work_order_updates (work_order_id, updated_by, status, notes)
       VALUES ($1, $2, $3, $4)`,
      [workOrderId, requestingUser.id, newStatus, options.notes]
    );
  }

  return result.rows[0];
}

// ─────────────────────────────────────────
// ASSIGN
// ─────────────────────────────────────────

async function assignWorkOrder(workOrderId, assigneeId, requestingUser, notes) {
  if (requestingUser.role === 'technician') {
    fail(403, 'FORBIDDEN', 'Technicians cannot reassign work orders');
  }

  const wo = await getWorkOrder(workOrderId, requestingUser);
  assertCompanyAccess(wo, requestingUser);

  if (wo.status === 'completed') {
    fail(400, 'INVALID_OPERATION', 'Cannot assign a completed work order');
  }

  const assigneeCheck = await query(
    `SELECT id, full_name FROM users WHERE id = $1 AND company_id = $2 AND is_active = TRUE`,
    [assigneeId, requestingUser.company_id]
  );
  if (assigneeCheck.rows.length === 0) {
    fail(404, 'NOT_FOUND', 'Assignee not found in your company');
  }

  const newStatus = wo.status === 'open' ? 'assigned' : wo.status;

  const result = await query(
    `UPDATE work_orders SET assigned_to = $2, status = $3 WHERE id = $1 RETURNING *`,
    [workOrderId, assigneeId, newStatus]
  );

  if (notes) {
    await query(
      `INSERT INTO work_order_updates (work_order_id, updated_by, status, notes)
       VALUES ($1, $2, $3, $4)`,
      [workOrderId, requestingUser.id, newStatus, notes]
    );
  }

  return result.rows[0];
}

// ─────────────────────────────────────────
// UPDATES (notes + photos from field)
// ─────────────────────────────────────────

async function addUpdate(workOrderId, data, requestingUser) {
  const { notes, photo_urls } = data;

  if (!notes && (!photo_urls || photo_urls.length === 0)) {
    fail(400, 'VALIDATION_ERROR', 'notes or photo_urls are required');
  }

  const wo = await getWorkOrder(workOrderId, requestingUser);
  assertCompanyAccess(wo, requestingUser);

  if (requestingUser.role === 'technician' && wo.assigned_to !== requestingUser.id) {
    fail(403, 'FORBIDDEN', 'Technicians can only add updates to their own work orders');
  }

  const result = await query(
    `INSERT INTO work_order_updates (work_order_id, updated_by, notes, photo_urls)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [workOrderId, requestingUser.id, notes || null, photo_urls || null]
  );

  return result.rows[0];
}

// ─────────────────────────────────────────
// SWM DOCUMENT
// ─────────────────────────────────────────

async function setSWMDocument(workOrderId, data, requestingUser) {
  if (requestingUser.role === 'technician') {
    fail(403, 'FORBIDDEN', 'Technicians cannot upload SWM documents');
  }

  const { swm_document_url, swm_document_name } = data;
  if (!swm_document_url) fail(400, 'VALIDATION_ERROR', 'swm_document_url is required');

  const wo = await getWorkOrder(workOrderId, requestingUser);
  assertCompanyAccess(wo, requestingUser);

  const result = await query(
    `UPDATE work_orders
     SET swm_document_url  = $2,
         swm_document_name = $3,
         swm_uploaded_by   = $4,
         swm_uploaded_at   = NOW()
     WHERE id = $1
     RETURNING *`,
    [workOrderId, swm_document_url, swm_document_name || null, requestingUser.id]
  );

  return result.rows[0];
}

module.exports = {
  createWorkOrder,
  listWorkOrders,
  getWorkOrder,
  updateWorkOrder,
  transitionStatus,
  assignWorkOrder,
  addUpdate,
  setSWMDocument,
  VALID_STATUSES,
  VALID_PRIORITIES,
  VALID_TYPES,
  ALLOWED_TRANSITIONS,
};
