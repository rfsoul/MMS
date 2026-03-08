// src/services/checklists.service.js
'use strict';

const { query } = require('../db/pool');

const VALID_ITEM_TYPES = ['measurement', 'true_false', 'step', 'text', 'photo'];

const CSV_HEADERS = [
  'sequence',
  'label',
  'description',
  'item_type',
  'unit',
  'min_value',
  'max_value',
  'is_required',
  'is_runtime_trigger',
];

function fail(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code   = code;
  throw err;
}

// ─────────────────────────────────────────
// ACCESS HELPERS
// ─────────────────────────────────────────

function assertCompanyAccess(resourceCompanyId, requestingUser) {
  if (requestingUser.role === 'help_desk_agent') return;
  if (resourceCompanyId !== requestingUser.company_id) {
    fail(403, 'FORBIDDEN', 'Access denied');
  }
}

function assertCanManage(requestingUser) {
  if (!['admin', 'manager'].includes(requestingUser.role)) {
    fail(403, 'FORBIDDEN', 'Only admin or manager can manage checklists');
  }
}

// ─────────────────────────────────────────
// CSV HELPERS
// ─────────────────────────────────────────

function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function parseCsvLine(line) {
  const fields = [];
  let current  = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { fields.push(current); current = ''; }
      else { current += ch; }
    }
  }
  fields.push(current);
  return fields;
}

function parseCsvToItems(csvText) {
  const lines = csvText
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .split('\n').map(l => l.trim()).filter(l => l.length > 0);

  if (lines.length < 2) {
    fail(400, 'INVALID_CSV', 'CSV must contain a header row and at least one item row');
  }

  const headerFields = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  for (const col of ['label', 'item_type']) {
    if (!headerFields.includes(col)) {
      fail(400, 'INVALID_CSV', `CSV is missing required column: '${col}'`);
    }
  }

  const colIndex = {};
  for (const col of CSV_HEADERS) colIndex[col] = headerFields.indexOf(col);

  const items  = [];
  const errors = [];

  for (let i = 1; i < lines.length; i++) {
    const rowNum = i + 1;
    const fields = parseCsvLine(lines[i]);
    const get    = col => {
      const idx = colIndex[col];
      return idx >= 0 && idx < fields.length ? fields[idx].trim() : '';
    };

    const label     = get('label');
    const item_type = get('item_type').toLowerCase();

    if (!label) { errors.push(`Row ${rowNum}: label is required`); continue; }
    if (!VALID_ITEM_TYPES.includes(item_type)) {
      errors.push(`Row ${rowNum}: invalid item_type '${item_type}' — must be one of: ${VALID_ITEM_TYPES.join(', ')}`);
      continue;
    }

    const seqRaw   = get('sequence');
    const sequence = seqRaw ? parseInt(seqRaw, 10) : i;
    if (isNaN(sequence)) { errors.push(`Row ${rowNum}: sequence must be a number`); continue; }

    const minRaw    = get('min_value');
    const maxRaw    = get('max_value');
    const min_value = minRaw !== '' ? parseFloat(minRaw) : null;
    const max_value = maxRaw !== '' ? parseFloat(maxRaw) : null;

    if (minRaw !== '' && isNaN(min_value)) { errors.push(`Row ${rowNum}: min_value must be numeric`); continue; }
    if (maxRaw !== '' && isNaN(max_value)) { errors.push(`Row ${rowNum}: max_value must be numeric`); continue; }
    if (min_value !== null && max_value !== null && min_value > max_value) {
      errors.push(`Row ${rowNum}: min_value cannot be greater than max_value`); continue;
    }

    const isReqRaw           = get('is_required').toLowerCase();
    const is_required        = !(isReqRaw === 'false' || isReqRaw === '0');
    const isRtRaw            = get('is_runtime_trigger').toLowerCase();
    const is_runtime_trigger = isRtRaw === 'true' || isRtRaw === '1';

    items.push({
      sequence, label,
      description: get('description') || null,
      item_type,
      unit:        get('unit') || null,
      min_value:   min_value ?? null,
      max_value:   max_value ?? null,
      is_required,
      is_runtime_trigger,
    });
  }

  const rtCount = items.filter(i => i.is_runtime_trigger).length;
  if (rtCount > 1) errors.push('Only one item per checklist may have is_runtime_trigger = true');

  return { items, errors };
}

function itemsToCsv(items) {
  const header = CSV_HEADERS.join(',');
  const rows   = items.map(item =>
    CSV_HEADERS.map(col => csvEscape(item[col] ?? '')).join(',')
  );
  return [header, ...rows].join('\n');
}

// ─────────────────────────────────────────
// VERSIONING HELPERS
// ─────────────────────────────────────────

async function resolveUniqueTemplateName(companyId, assetTypeId, desiredName) {
  const { rows } = await query(
    `SELECT name FROM asset_type_checklist_templates
     WHERE company_id = $1 AND asset_type_id = $2 AND name LIKE $3`,
    [companyId, assetTypeId, `${desiredName}%`]
  );
  const names = new Set(rows.map(r => r.name));
  if (!names.has(desiredName)) return desiredName;
  let v = 2;
  while (names.has(`${desiredName} v${v}`)) v++;
  return `${desiredName} v${v}`;
}

async function resolveUniqueAssetChecklistName(companyId, assetGraphId, desiredName) {
  const { rows } = await query(
    `SELECT name FROM asset_checklists
     WHERE company_id = $1 AND asset_graph_id = $2 AND name LIKE $3`,
    [companyId, assetGraphId, `${desiredName}%`]
  );
  const names = new Set(rows.map(r => r.name));
  if (!names.has(desiredName)) return desiredName;
  let v = 2;
  while (names.has(`${desiredName} v${v}`)) v++;
  return `${desiredName} v${v}`;
}

// ─────────────────────────────────────────
// ITEM VALIDATION & INSERTION
// ─────────────────────────────────────────

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    fail(400, 'VALIDATION_ERROR', 'At least one item is required');
  }
  let rtCount = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.label) fail(400, 'VALIDATION_ERROR', `Item ${i + 1}: label is required`);
    if (!VALID_ITEM_TYPES.includes(item.item_type)) {
      fail(400, 'INVALID_ITEM_TYPE',
        `Item ${i + 1}: invalid item_type '${item.item_type}'. Must be one of: ${VALID_ITEM_TYPES.join(', ')}`
      );
    }
    if (item.is_runtime_trigger) rtCount++;
  }
  if (rtCount > 1) {
    fail(400, 'VALIDATION_ERROR', 'Only one item per checklist may have is_runtime_trigger = true');
  }
}

async function insertTemplateItems(templateId, items) {
  const inserted = [];
  for (const item of items) {
    const { rows } = await query(
      `INSERT INTO asset_type_checklist_template_items
         (template_id, sequence, label, description, item_type,
          unit, min_value, max_value, is_required, is_runtime_trigger)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [templateId, item.sequence, item.label, item.description || null,
       item.item_type, item.unit || null, item.min_value ?? null, item.max_value ?? null,
       item.is_required !== false, item.is_runtime_trigger === true]
    );
    inserted.push(rows[0]);
  }
  return inserted;
}

async function insertAssetChecklistItems(checklistId, items) {
  const inserted = [];
  for (const item of items) {
    const { rows } = await query(
      `INSERT INTO asset_checklist_items
         (checklist_id, sequence, label, description, item_type,
          unit, min_value, max_value, is_required, is_runtime_trigger)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [checklistId, item.sequence, item.label, item.description || null,
       item.item_type, item.unit || null, item.min_value ?? null, item.max_value ?? null,
       item.is_required !== false, item.is_runtime_trigger === true]
    );
    inserted.push(rows[0]);
  }
  return inserted;
}

// ─────────────────────────────────────────
// ASSET TYPE CHECKLIST TEMPLATES
// ─────────────────────────────────────────

async function listTemplates(requestingUser, filters = {}) {
  const conditions = [];
  const params     = [];
  let   idx        = 1;

  if (requestingUser.role !== 'help_desk_agent') {
    conditions.push(`t.company_id = $${idx++}`);
    params.push(requestingUser.company_id);
  }
  if (filters.asset_type_id) {
    conditions.push(`t.asset_type_id = $${idx++}`);
    params.push(filters.asset_type_id);
  }
  if (filters.is_active !== undefined) {
    conditions.push(`t.is_active = $${idx++}`);
    params.push(filters.is_active);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT t.*,
            at.name       AS asset_type_name,
            u.full_name   AS created_by_name,
            COUNT(i.id)::int AS item_count
     FROM asset_type_checklist_templates t
     LEFT JOIN asset_types at ON at.id = t.asset_type_id
     LEFT JOIN users u        ON u.id  = t.created_by
     LEFT JOIN asset_type_checklist_template_items i ON i.template_id = t.id
     ${where}
     GROUP BY t.id, at.name, u.full_name
     ORDER BY t.name`,
    params
  );
  return rows;
}

async function getTemplate(templateId, requestingUser) {
  const { rows } = await query(
    `SELECT t.*, at.name AS asset_type_name, u.full_name AS created_by_name
     FROM asset_type_checklist_templates t
     LEFT JOIN asset_types at ON at.id = t.asset_type_id
     LEFT JOIN users u        ON u.id  = t.created_by
     WHERE t.id = $1`,
    [templateId]
  );
  if (rows.length === 0) fail(404, 'NOT_FOUND', 'Checklist template not found');
  const template = rows[0];
  assertCompanyAccess(template.company_id, requestingUser);

  const items = await query(
    `SELECT * FROM asset_type_checklist_template_items
     WHERE template_id = $1 ORDER BY sequence`,
    [templateId]
  );
  template.items = items.rows;
  return template;
}

async function createTemplate(data, requestingUser) {
  assertCanManage(requestingUser);
  const { asset_type_id, name, description, items = [] } = data;
  if (!asset_type_id) fail(400, 'VALIDATION_ERROR', 'asset_type_id is required');
  if (!name)          fail(400, 'VALIDATION_ERROR', 'name is required');
  validateItems(items);

  const { rows: atRows } = await query(
    `SELECT id, company_id FROM asset_types WHERE id = $1`, [asset_type_id]
  );
  if (atRows.length === 0) fail(404, 'NOT_FOUND', 'Asset type not found');
  const companyId = atRows[0].company_id;
  assertCompanyAccess(companyId, requestingUser);

  const resolvedName = await resolveUniqueTemplateName(companyId, asset_type_id, name);

  const { rows } = await query(
    `INSERT INTO asset_type_checklist_templates
       (company_id, asset_type_id, name, description, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [companyId, asset_type_id, resolvedName, description || null, requestingUser.id]
  );
  const template = rows[0];
  template.items = await insertTemplateItems(template.id, items);
  return template;
}

async function importTemplateFromCsv(csvText, data, requestingUser) {
  assertCanManage(requestingUser);
  const { items, errors } = parseCsvToItems(csvText);
  if (errors.length > 0) fail(400, 'INVALID_CSV', `CSV validation failed:\n${errors.join('\n')}`);
  return createTemplate({ ...data, items }, requestingUser);
}

async function exportTemplateToCsv(templateId, requestingUser) {
  const template = await getTemplate(templateId, requestingUser);
  return { template, csv: itemsToCsv(template.items) };
}

async function deactivateTemplate(templateId, requestingUser) {
  assertCanManage(requestingUser);
  const template = await getTemplate(templateId, requestingUser);
  assertCompanyAccess(template.company_id, requestingUser);
  await query(
    `UPDATE asset_type_checklist_templates
     SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
    [templateId]
  );
  return { message: 'Checklist template deactivated' };
}

// ─────────────────────────────────────────
// ASSET CHECKLISTS
// ─────────────────────────────────────────

async function listAssetChecklists(assetGraphId, requestingUser) {
  const conditions = [`ac.asset_graph_id = $1`];
  const params     = [assetGraphId];
  let   idx        = 2;

  if (requestingUser.role !== 'help_desk_agent') {
    conditions.push(`ac.company_id = $${idx++}`);
    params.push(requestingUser.company_id);
  }

  const { rows } = await query(
    `SELECT ac.*,
            at.name      AS asset_type_name,
            u.full_name  AS created_by_name,
            t.name       AS source_template_name,
            COUNT(i.id)::int AS item_count
     FROM asset_checklists ac
     LEFT JOIN asset_types at ON at.id = ac.asset_type_id
     LEFT JOIN users u        ON u.id  = ac.created_by
     LEFT JOIN asset_type_checklist_templates t ON t.id = ac.source_template_id
     LEFT JOIN asset_checklist_items i ON i.checklist_id = ac.id
     WHERE ${conditions.join(' AND ')}
     GROUP BY ac.id, at.name, u.full_name, t.name
     ORDER BY ac.name`,
    params
  );
  return rows;
}

async function getAssetChecklist(checklistId, requestingUser) {
  const { rows } = await query(
    `SELECT ac.*, at.name AS asset_type_name, u.full_name AS created_by_name,
            t.name AS source_template_name
     FROM asset_checklists ac
     LEFT JOIN asset_types at ON at.id = ac.asset_type_id
     LEFT JOIN users u        ON u.id  = ac.created_by
     LEFT JOIN asset_type_checklist_templates t ON t.id = ac.source_template_id
     WHERE ac.id = $1`,
    [checklistId]
  );
  if (rows.length === 0) fail(404, 'NOT_FOUND', 'Asset checklist not found');
  const checklist = rows[0];
  assertCompanyAccess(checklist.company_id, requestingUser);

  const items = await query(
    `SELECT * FROM asset_checklist_items
     WHERE checklist_id = $1 ORDER BY sequence`,
    [checklistId]
  );
  checklist.items = items.rows;
  return checklist;
}

async function createAssetChecklist(assetGraphId, data, requestingUser) {
  assertCanManage(requestingUser);
  const {
    asset_type_id,
    name,
    description,
    source      = 'scratch',
    template_id = null,
    items       = [],
  } = data;

  if (!asset_type_id) fail(400, 'VALIDATION_ERROR', 'asset_type_id is required');
  if (!name)          fail(400, 'VALIDATION_ERROR', 'name is required');

  const { rows: atRows } = await query(
    `SELECT id, company_id FROM asset_types WHERE id = $1`, [asset_type_id]
  );
  if (atRows.length === 0) fail(404, 'NOT_FOUND', 'Asset type not found');
  const companyId = atRows[0].company_id;
  assertCompanyAccess(companyId, requestingUser);

  let sourceTemplateId = null;
  let itemsToInsert    = items;

  if (source === 'template') {
    if (!template_id) fail(400, 'VALIDATION_ERROR', 'template_id is required when source is template');
    const tmpl = await getTemplate(template_id, requestingUser);
    if (tmpl.company_id !== companyId) {
      fail(400, 'VALIDATION_ERROR', 'Template must belong to the same company as the asset');
    }
    sourceTemplateId = template_id;
    itemsToInsert    = tmpl.items.map(i => ({
      sequence: i.sequence, label: i.label, description: i.description,
      item_type: i.item_type, unit: i.unit, min_value: i.min_value,
      max_value: i.max_value, is_required: i.is_required,
      is_runtime_trigger: i.is_runtime_trigger,
    }));
  }

  validateItems(itemsToInsert);

  const resolvedName = await resolveUniqueAssetChecklistName(companyId, assetGraphId, name);

  const { rows } = await query(
    `INSERT INTO asset_checklists
       (company_id, asset_graph_id, asset_type_id, name, description,
        source_template_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [companyId, assetGraphId, asset_type_id, resolvedName,
     description || null, sourceTemplateId, requestingUser.id]
  );
  const checklist = rows[0];
  checklist.items = await insertAssetChecklistItems(checklist.id, itemsToInsert);
  return checklist;
}

async function importAssetChecklistFromCsv(assetGraphId, csvText, data, requestingUser) {
  assertCanManage(requestingUser);
  const { items, errors } = parseCsvToItems(csvText);
  if (errors.length > 0) fail(400, 'INVALID_CSV', `CSV validation failed:\n${errors.join('\n')}`);
  return createAssetChecklist(assetGraphId, { ...data, source: 'csv', items }, requestingUser);
}

async function exportAssetChecklistToCsv(checklistId, requestingUser) {
  const checklist = await getAssetChecklist(checklistId, requestingUser);
  return { checklist, csv: itemsToCsv(checklist.items) };
}

async function updateAssetChecklist(checklistId, data, requestingUser) {
  assertCanManage(requestingUser);
  const checklist = await getAssetChecklist(checklistId, requestingUser);
  assertCompanyAccess(checklist.company_id, requestingUser);

  const { name, description, is_active } = data;
  const fields = [];
  const params = [];
  let   idx    = 1;

  if (name        !== undefined) { fields.push(`name = $${idx++}`);        params.push(name); }
  if (description !== undefined) { fields.push(`description = $${idx++}`); params.push(description); }
  if (is_active   !== undefined) { fields.push(`is_active = $${idx++}`);   params.push(is_active); }

  if (fields.length === 0) fail(400, 'VALIDATION_ERROR', 'No fields to update');

  fields.push('updated_at = NOW()');
  params.push(checklistId);

  const { rows } = await query(
    `UPDATE asset_checklists SET ${fields.join(', ')}
     WHERE id = $${idx} RETURNING *`,
    params
  );
  return rows[0];
}

async function deactivateAssetChecklist(checklistId, requestingUser) {
  assertCanManage(requestingUser);
  const checklist = await getAssetChecklist(checklistId, requestingUser);
  assertCompanyAccess(checklist.company_id, requestingUser);
  await query(
    `UPDATE asset_checklists SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
    [checklistId]
  );
  return { message: 'Asset checklist deactivated' };
}

// ─────────────────────────────────────────
// CHECKLIST RESPONSES
// Technician responses captured during a work order task execution.
// The DB enforces UNIQUE (asset_checklist_item_id, work_order_task_id)
// so each item can only be answered once per task — we use an upsert.
// The DB trigger auto-flags is_out_of_range on measurement items.
// ─────────────────────────────────────────

/**
 * Verify the task belongs to a WO in the caller's company,
 * and that the task type is 'checklist_execution'.
 * Returns { task, workOrder } on success.
 */
async function resolveTask(workOrderTaskId, requestingUser) {
  const { rows } = await query(
    `SELECT t.*, wo.company_id, wo.status AS wo_status
     FROM work_order_tasks t
     JOIN work_orders wo ON wo.id = t.work_order_id
     WHERE t.id = $1`,
    [workOrderTaskId]
  );
  if (rows.length === 0) fail(404, 'NOT_FOUND', 'Work order task not found');
  const task = rows[0];
  assertCompanyAccess(task.company_id, requestingUser);
  if (task.task_type !== 'checklist_execution') {
    fail(400, 'INVALID_TASK_TYPE', 'Responses can only be submitted for checklist_execution tasks');
  }
  return task;
}

/**
 * Verify a checklist item belongs to the checklist linked to the task.
 */
async function resolveChecklistItem(itemId, checklistId) {
  const { rows } = await query(
    `SELECT * FROM asset_checklist_items WHERE id = $1 AND checklist_id = $2`,
    [itemId, checklistId]
  );
  if (rows.length === 0) {
    fail(404, 'NOT_FOUND', `Checklist item ${itemId} not found on this checklist`);
  }
  return rows[0];
}

/**
 * GET responses for a specific checklist task execution.
 * Returns all responses with the item label and type for context.
 */
async function listResponses(checklistId, workOrderTaskId, requestingUser) {
  // Verify the task is accessible
  const task = await resolveTask(workOrderTaskId, requestingUser);

  // Verify the task's asset_checklist_id matches the requested checklist
  if (task.asset_checklist_id && task.asset_checklist_id !== checklistId) {
    fail(400, 'VALIDATION_ERROR', 'Task is not linked to the specified checklist');
  }

  const { rows } = await query(
    `SELECT r.*,
            i.label           AS item_label,
            i.item_type       AS item_type,
            i.unit            AS item_unit,
            i.sequence        AS item_sequence,
            u.full_name       AS responded_by_name
     FROM asset_checklist_responses r
     JOIN asset_checklist_items i ON i.id = r.asset_checklist_item_id
     JOIN users u                 ON u.id = r.responded_by
     WHERE r.work_order_task_id = $1
     ORDER BY i.sequence`,
    [workOrderTaskId]
  );
  return rows;
}

/**
 * POST — bulk submit / upsert responses for a checklist task.
 * Body: { work_order_task_id, responses: [{ asset_checklist_item_id, numeric_value?, boolean_value?, text_value?, photo_url?, notes? }] }
 *
 * Rules:
 *  - Task must be checklist_execution type
 *  - WO must not be completed
 *  - Each item must belong to the checklist linked on the task
 *  - UPSERT: if a response already exists for (item, task) it is updated
 *  - is_out_of_range is set by DB trigger — we do not pass it
 */
async function submitResponses(checklistId, data, requestingUser) {
  const { work_order_task_id, responses } = data;

  if (!work_order_task_id) fail(400, 'VALIDATION_ERROR', 'work_order_task_id is required');
  if (!Array.isArray(responses) || responses.length === 0) {
    fail(400, 'VALIDATION_ERROR', 'responses array is required and must not be empty');
  }

  const task = await resolveTask(work_order_task_id, requestingUser);

  if (task.wo_status === 'completed') {
    fail(400, 'WORK_ORDER_CLOSED', 'Cannot submit responses for a completed work order');
  }
  if (task.status === 'completed' || task.status === 'skipped') {
    fail(400, 'TASK_CLOSED', 'Cannot submit responses for a completed or skipped task');
  }

  // Determine which checklist to validate items against
  // Task may already have asset_checklist_id set, or we accept the URL param
  const effectiveChecklistId = task.asset_checklist_id || checklistId;

  const saved = [];
  for (const resp of responses) {
    const { asset_checklist_item_id } = resp;
    if (!asset_checklist_item_id) {
      fail(400, 'VALIDATION_ERROR', 'Each response must include asset_checklist_item_id');
    }

    // Verify item belongs to this checklist
    await resolveChecklistItem(asset_checklist_item_id, effectiveChecklistId);

    // Build value fields — only pass what's provided
    const numeric_value = resp.numeric_value  !== undefined ? resp.numeric_value  : null;
    const boolean_value = resp.boolean_value  !== undefined ? resp.boolean_value  : null;
    const text_value    = resp.text_value     !== undefined ? resp.text_value     : null;
    const photo_url     = resp.photo_url      !== undefined ? resp.photo_url      : null;
    const notes         = resp.notes          !== undefined ? resp.notes          : null;

    // Upsert: ON CONFLICT update values (is_out_of_range re-evaluated by trigger)
    const { rows } = await query(
      `INSERT INTO asset_checklist_responses
         (asset_checklist_item_id, work_order_task_id, responded_by,
          numeric_value, boolean_value, text_value, photo_url, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (asset_checklist_item_id, work_order_task_id)
       DO UPDATE SET
         numeric_value  = EXCLUDED.numeric_value,
         boolean_value  = EXCLUDED.boolean_value,
         text_value     = EXCLUDED.text_value,
         photo_url      = EXCLUDED.photo_url,
         notes          = EXCLUDED.notes,
         responded_by   = EXCLUDED.responded_by,
         responded_at   = NOW()
       RETURNING *`,
      [asset_checklist_item_id, work_order_task_id, requestingUser.id,
       numeric_value, boolean_value, text_value, photo_url, notes]
    );
    saved.push(rows[0]);
  }

  return {
    message:   `${saved.length} response(s) saved`,
    responses: saved,
  };
}

/**
 * PATCH — update a single existing response (corrections before task completion).
 * Only the technician who submitted it, or a manager/admin, may update.
 */
async function updateResponse(responseId, data, requestingUser) {
  // Fetch the response with task/WO context
  const { rows } = await query(
    `SELECT r.*, t.status AS task_status, wo.status AS wo_status,
            wo.company_id, t.task_type
     FROM asset_checklist_responses r
     JOIN work_order_tasks t  ON t.id = r.work_order_task_id
     JOIN work_orders wo      ON wo.id = t.work_order_id
     WHERE r.id = $1`,
    [responseId]
  );
  if (rows.length === 0) fail(404, 'NOT_FOUND', 'Response not found');
  const response = rows[0];

  assertCompanyAccess(response.company_id, requestingUser);

  // Only the original responder or admin/manager can edit
  const isOwner   = response.responded_by === requestingUser.id;
  const canManage = ['admin', 'manager'].includes(requestingUser.role);
  if (!isOwner && !canManage) {
    fail(403, 'FORBIDDEN', 'Only the original responder or a manager/admin can update a response');
  }

  if (response.wo_status === 'completed') {
    fail(400, 'WORK_ORDER_CLOSED', 'Cannot update responses on a completed work order');
  }
  if (response.task_status === 'completed' || response.task_status === 'skipped') {
    fail(400, 'TASK_CLOSED', 'Cannot update responses on a completed or skipped task');
  }

  const fields = [];
  const params = [];
  let idx = 1;

  if (data.numeric_value !== undefined) { fields.push(`numeric_value = $${idx++}`); params.push(data.numeric_value); }
  if (data.boolean_value !== undefined) { fields.push(`boolean_value = $${idx++}`); params.push(data.boolean_value); }
  if (data.text_value    !== undefined) { fields.push(`text_value    = $${idx++}`); params.push(data.text_value); }
  if (data.photo_url     !== undefined) { fields.push(`photo_url     = $${idx++}`); params.push(data.photo_url); }
  if (data.notes         !== undefined) { fields.push(`notes         = $${idx++}`); params.push(data.notes); }

  if (fields.length === 0) fail(400, 'VALIDATION_ERROR', 'No fields to update');

  fields.push(`responded_by = $${idx++}`);
  params.push(requestingUser.id);
  fields.push(`responded_at = NOW()`);
  params.push(responseId);

  const { rows: updated } = await query(
    `UPDATE asset_checklist_responses
     SET ${fields.join(', ')}
     WHERE id = $${idx}
     RETURNING *`,
    params
  );
  return updated[0];
}

/**
 * GET — summary of outstanding required items for a task execution.
 * Useful for the UI to show "3 of 12 items completed" or flag missing required items.
 */
async function getResponseSummary(checklistId, workOrderTaskId, requestingUser) {
  const task = await resolveTask(workOrderTaskId, requestingUser);
  const effectiveChecklistId = task.asset_checklist_id || checklistId;

  const { rows } = await query(
    `SELECT
       COUNT(i.id)::int                                          AS total_items,
       COUNT(r.id)::int                                          AS answered_items,
       COUNT(i.id) FILTER (WHERE i.is_required)::int            AS required_items,
       COUNT(r.id) FILTER (WHERE i.is_required)::int            AS required_answered,
       COUNT(r.id) FILTER (WHERE r.is_out_of_range = TRUE)::int AS out_of_range_count
     FROM asset_checklist_items i
     LEFT JOIN asset_checklist_responses r
       ON r.asset_checklist_item_id = i.id
      AND r.work_order_task_id = $2
     WHERE i.checklist_id = $1`,
    [effectiveChecklistId, workOrderTaskId]
  );
  return rows[0];
}

module.exports = {
  listTemplates,
  getTemplate,
  createTemplate,
  importTemplateFromCsv,
  exportTemplateToCsv,
  deactivateTemplate,
  listAssetChecklists,
  getAssetChecklist,
  createAssetChecklist,
  importAssetChecklistFromCsv,
  exportAssetChecklistToCsv,
  updateAssetChecklist,
  deactivateAssetChecklist,
  listResponses,
  submitResponses,
  updateResponse,
  getResponseSummary,
  parseCsvToItems,
  itemsToCsv,
  CSV_HEADERS,
  VALID_ITEM_TYPES,
};
