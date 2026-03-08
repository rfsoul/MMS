// src/services/pm-schedules.service.js
'use strict';

const { query } = require('../db/pool');

const VALID_WORK_TYPES = ['Inspection', 'Service', 'Overhaul', 'Clean', 'Deep Clean', 'Replace'];
const ROLLING_WINDOW_MONTHS = 12;

function fail(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code   = code;
  throw err;
}

function assertCanManage(requestingUser) {
  if (!['admin', 'manager'].includes(requestingUser.role)) {
    fail(403, 'FORBIDDEN', 'Only admin or manager can manage PM schedules');
  }
}

function assertCompanyAccess(resourceCompanyId, requestingUser) {
  if (requestingUser.role === 'help_desk_agent') return;
  if (resourceCompanyId !== requestingUser.company_id) {
    fail(403, 'FORBIDDEN', 'Access denied');
  }
}

// ─────────────────────────────────────────
// DATE ARITHMETIC
// ─────────────────────────────────────────

/**
 * Calculate all due dates from startDate (exclusive) up to windowEnd
 * based on trigger type code and interval_value.
 */
function calculateDueDates(triggerCode, intervalValue, startDate, windowEnd) {
  const dates = [];
  let current = new Date(startDate);

  // Advance by one interval to get the first date after startDate
  current = advanceDate(current, triggerCode, intervalValue);

  while (current <= windowEnd) {
    dates.push(new Date(current));
    current = advanceDate(current, triggerCode, intervalValue);
  }

  return dates;
}

function advanceDate(date, triggerCode, intervalValue) {
  const d = new Date(date);
  switch (triggerCode) {
    case 'calendar_daily':
      d.setDate(d.getDate() + intervalValue);
      break;
    case 'calendar_weekly':
      d.setDate(d.getDate() + (intervalValue * 7));
      break;
    case 'calendar_monthly':
      d.setMonth(d.getMonth() + intervalValue);
      break;
    case 'calendar_yearly':
      d.setFullYear(d.getFullYear() + intervalValue);
      break;
    default:
      throw new Error(`Cannot advance date for trigger type: ${triggerCode}`);
  }
  return d;
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

// ─────────────────────────────────────────
// WO TITLE GENERATION
// Format: [work_type] - [asset_type_name] - [MMM YYYY]
// e.g. "Service - Air Handling Unit - Mar 2026"
// ─────────────────────────────────────────

function generateWOTitle(workType, assetTypeName, dueDate) {
  const date = new Date(dueDate);
  const month = date.toLocaleString('en-AU', { month: 'short' });
  const year  = date.getFullYear();
  return `${workType} - ${assetTypeName} - ${month} ${year}`;
}

// ─────────────────────────────────────────
// TRIGGER TYPES
// ─────────────────────────────────────────

async function listTriggerTypes() {
  const { rows } = await query(
    `SELECT * FROM pm_trigger_types ORDER BY category, label`
  );
  return rows;
}

// ─────────────────────────────────────────
// SCHEDULE CRUD
// ─────────────────────────────────────────

async function listSchedules(requestingUser, filters = {}) {
  assertCanManage(requestingUser);

  const conditions = [];
  const params     = [];
  let   idx        = 1;

  if (requestingUser.role !== 'help_desk_agent') {
    conditions.push(`s.company_id = $${idx++}`);
    params.push(requestingUser.company_id);
  }
  if (filters.asset_graph_id) {
    conditions.push(`s.asset_graph_id = $${idx++}`);
    params.push(filters.asset_graph_id);
  }
  if (filters.is_active !== undefined) {
    conditions.push(`s.is_active = $${idx++}`);
    params.push(filters.is_active);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT s.*,
            tt.code         AS trigger_type_code,
            tt.label        AS trigger_type_label,
            tt.category     AS trigger_category,
            at.name         AS asset_type_name,
            u.full_name     AS created_by_name
     FROM pm_schedules s
     JOIN pm_trigger_types tt ON tt.id = s.trigger_type_id
     JOIN asset_types at      ON at.id = s.asset_type_id
     JOIN users u             ON u.id  = s.created_by
     ${where}
     ORDER BY s.name`,
    params
  );
  return rows;
}

async function getSchedule(scheduleId, requestingUser) {
  assertCanManage(requestingUser);

  const { rows } = await query(
    `SELECT s.*,
            tt.code         AS trigger_type_code,
            tt.label        AS trigger_type_label,
            tt.category     AS trigger_category,
            at.name         AS asset_type_name,
            u.full_name     AS created_by_name,
            aci.label       AS runtime_item_label
     FROM pm_schedules s
     JOIN pm_trigger_types tt    ON tt.id  = s.trigger_type_id
     JOIN asset_types at         ON at.id  = s.asset_type_id
     JOIN users u                ON u.id   = s.created_by
     LEFT JOIN asset_checklist_items aci ON aci.id = s.runtime_checklist_item_id
     WHERE s.id = $1`,
    [scheduleId]
  );
  if (rows.length === 0) fail(404, 'NOT_FOUND', 'PM schedule not found');

  const schedule = rows[0];
  assertCompanyAccess(schedule.company_id, requestingUser);

  // Load upcoming generated WOs
  const upcoming = await query(
    `SELECT pwo.due_date, wo.id AS work_order_id, wo.status, wo.title
     FROM pm_generated_work_orders pwo
     JOIN work_orders wo ON wo.id = pwo.work_order_id
     WHERE pwo.schedule_id = $1
       AND pwo.due_date >= CURRENT_DATE
     ORDER BY pwo.due_date
     LIMIT 24`,
    [scheduleId]
  );
  schedule.upcoming_work_orders = upcoming.rows;

  return schedule;
}

async function createSchedule(data, requestingUser) {
  assertCanManage(requestingUser);

  const {
    asset_graph_id,
    asset_type_id,
    name,
    work_type,
    trigger_type_id,
    interval_value,
    runtime_threshold,
    runtime_checklist_item_id,
    starts_on,
    ends_on,
  } = data;

  if (!asset_graph_id)    fail(400, 'VALIDATION_ERROR', 'asset_graph_id is required');
  if (!asset_type_id)     fail(400, 'VALIDATION_ERROR', 'asset_type_id is required');
  if (!name)              fail(400, 'VALIDATION_ERROR', 'name is required');
  if (!work_type)         fail(400, 'VALIDATION_ERROR', 'work_type is required');
  if (!trigger_type_id)   fail(400, 'VALIDATION_ERROR', 'trigger_type_id is required');
  if (!starts_on)         fail(400, 'VALIDATION_ERROR', 'starts_on is required');

  if (!VALID_WORK_TYPES.includes(work_type)) {
    fail(400, 'INVALID_WORK_TYPE',
      `Invalid work_type '${work_type}'. Must be one of: ${VALID_WORK_TYPES.join(', ')}`
    );
  }

  // Verify asset type belongs to requester's company
  const { rows: atRows } = await query(
    `SELECT id, company_id FROM asset_types WHERE id = $1`, [asset_type_id]
  );
  if (atRows.length === 0) fail(404, 'NOT_FOUND', 'Asset type not found');
  const companyId = atRows[0].company_id;
  assertCompanyAccess(companyId, requestingUser);

  // Verify trigger type exists
  const { rows: ttRows } = await query(
    `SELECT id, code, category FROM pm_trigger_types WHERE id = $1`, [trigger_type_id]
  );
  if (ttRows.length === 0) fail(404, 'NOT_FOUND', 'Trigger type not found');
  const triggerType = ttRows[0];

  // Validate trigger-specific fields
  if (triggerType.category === 'calendar' && !interval_value) {
    fail(400, 'VALIDATION_ERROR', 'interval_value is required for calendar trigger types');
  }
  if (triggerType.category === 'runtime' && !runtime_threshold) {
    fail(400, 'VALIDATION_ERROR', 'runtime_threshold is required for runtime trigger types');
  }

  // Validate runtime checklist item if provided
  if (runtime_checklist_item_id) {
    const { rows: itemRows } = await query(
      `SELECT id, is_runtime_trigger FROM asset_checklist_items WHERE id = $1`,
      [runtime_checklist_item_id]
    );
    if (itemRows.length === 0) fail(404, 'NOT_FOUND', 'Runtime checklist item not found');
    if (!itemRows[0].is_runtime_trigger) {
      fail(400, 'VALIDATION_ERROR', 'runtime_checklist_item_id must reference an item with is_runtime_trigger = true');
    }
  }

  // Validate dates
  if (ends_on && new Date(ends_on) <= new Date(starts_on)) {
    fail(400, 'VALIDATION_ERROR', 'ends_on must be after starts_on');
  }

  // Set last_generated_date to day before starts_on so first cron run
  // picks up the starts_on date correctly
  const startsOnDate     = new Date(starts_on);
  const lastGenDate      = new Date(startsOnDate);
  lastGenDate.setDate(lastGenDate.getDate() - 1);

  const { rows } = await query(
    `INSERT INTO pm_schedules
       (company_id, asset_graph_id, asset_type_id, name, work_type,
        trigger_type_id, interval_value, runtime_threshold,
        runtime_checklist_item_id, starts_on, ends_on,
        last_generated_date, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      companyId, asset_graph_id, asset_type_id, name, work_type,
      trigger_type_id, interval_value || null, runtime_threshold || null,
      runtime_checklist_item_id || null, starts_on, ends_on || null,
      formatDate(lastGenDate), requestingUser.id,
    ]
  );
  return rows[0];
}

async function updateSchedule(scheduleId, data, requestingUser) {
  assertCanManage(requestingUser);
  const schedule = await getSchedule(scheduleId, requestingUser);
  assertCompanyAccess(schedule.company_id, requestingUser);

  const {
    name, work_type, interval_value, runtime_threshold,
    runtime_checklist_item_id, starts_on, ends_on, is_active,
  } = data;

  if (work_type && !VALID_WORK_TYPES.includes(work_type)) {
    fail(400, 'INVALID_WORK_TYPE',
      `Invalid work_type '${work_type}'. Must be one of: ${VALID_WORK_TYPES.join(', ')}`
    );
  }

  const fields = [];
  const params = [];
  let   idx    = 1;

  if (name                      !== undefined) { fields.push(`name = $${idx++}`);                       params.push(name); }
  if (work_type                 !== undefined) { fields.push(`work_type = $${idx++}`);                  params.push(work_type); }
  if (interval_value            !== undefined) { fields.push(`interval_value = $${idx++}`);             params.push(interval_value); }
  if (runtime_threshold         !== undefined) { fields.push(`runtime_threshold = $${idx++}`);          params.push(runtime_threshold); }
  if (runtime_checklist_item_id !== undefined) { fields.push(`runtime_checklist_item_id = $${idx++}`);  params.push(runtime_checklist_item_id); }
  if (starts_on                 !== undefined) { fields.push(`starts_on = $${idx++}`);                  params.push(starts_on); }
  if (ends_on                   !== undefined) { fields.push(`ends_on = $${idx++}`);                    params.push(ends_on); }
  if (is_active                 !== undefined) { fields.push(`is_active = $${idx++}`);                  params.push(is_active); }

  if (fields.length === 0) fail(400, 'VALIDATION_ERROR', 'No fields to update');

  params.push(scheduleId);
  const { rows } = await query(
    `UPDATE pm_schedules SET ${fields.join(', ')}
     WHERE id = $${idx} RETURNING *`,
    params
  );
  return rows[0];
}

async function deleteSchedule(scheduleId, requestingUser) {
  assertCanManage(requestingUser);
  const schedule = await getSchedule(scheduleId, requestingUser);
  assertCompanyAccess(schedule.company_id, requestingUser);

  // Soft delete — deactivate only
  await query(
    `UPDATE pm_schedules SET is_active = FALSE WHERE id = $1`, [scheduleId]
  );
  return { message: 'PM schedule deactivated' };
}

// ─────────────────────────────────────────
// WO GENERATION (called by cron + manually)
// ─────────────────────────────────────────

/**
 * Generate work orders for a single schedule up to the rolling window.
 * Returns { generated: number, skipped: number, errors: string[] }
 */
async function generateForSchedule(schedule) {
  const result = { generated: 0, skipped: 0, errors: [] };

  // Only process calendar schedules
  if (schedule.trigger_category !== 'calendar') return result;

  const windowEnd = new Date();
  windowEnd.setMonth(windowEnd.getMonth() + ROLLING_WINDOW_MONTHS);

  // Respect ends_on if set
  const effectiveEnd = schedule.ends_on
    ? new Date(Math.min(windowEnd.getTime(), new Date(schedule.ends_on).getTime()))
    : windowEnd;

  const startFrom = new Date(schedule.last_generated_date);
  const dueDates  = calculateDueDates(
    schedule.trigger_type_code,
    schedule.interval_value,
    startFrom,
    effectiveEnd
  );

  if (dueDates.length === 0) return result;

  // Load asset type name for WO title
  const { rows: atRows } = await query(
    `SELECT name FROM asset_types WHERE id = $1`, [schedule.asset_type_id]
  );
  const assetTypeName = atRows.length > 0 ? atRows[0].name : 'Asset';

  // Find all active checklists for this asset
  const { rows: checklists } = await query(
    `SELECT id, name FROM asset_checklists
     WHERE asset_graph_id = $1
       AND company_id = $2
       AND is_active = TRUE`,
    [schedule.asset_graph_id, schedule.company_id]
  );

  for (const dueDate of dueDates) {
    const dueDateStr = formatDate(dueDate);

    try {
      // Check for existing WO on this date (duplicate prevention)
      const { rows: existing } = await query(
        `SELECT id FROM pm_generated_work_orders
         WHERE schedule_id = $1 AND due_date = $2`,
        [schedule.id, dueDateStr]
      );
      if (existing.length > 0) { result.skipped++; continue; }

      // Generate WO title
      const title = generateWOTitle(schedule.work_type, assetTypeName, dueDate);

      // Create work order
      const { rows: woRows } = await query(
        `INSERT INTO work_orders
           (company_id, title, description, status, priority,
            asset_graph_id, created_by)
         VALUES ($1,$2,$3,'open','medium',$4,$5)
         RETURNING id`,
        [
          schedule.company_id,
          title,
          `Preventive maintenance generated by schedule: ${schedule.name}. Due: ${dueDateStr}`,
          schedule.asset_graph_id,
          schedule.created_by,
        ]
      );
      const workOrderId = woRows[0].id;

      // Create checklist_execution task for each active checklist on the asset
      let taskSequence = 1;
      for (const checklist of checklists) {
        await query(
          `INSERT INTO work_order_tasks
             (work_order_id, sequence, title, task_type, asset_checklist_id)
           VALUES ($1,$2,$3,'checklist_execution',$4)`,
          [
            workOrderId,
            taskSequence++,
            `Execute checklist: ${checklist.name}`,
            checklist.id,
          ]
        );
      }

      // Record in junction table (prevents future duplicates)
      await query(
        `INSERT INTO pm_generated_work_orders
           (schedule_id, work_order_id, due_date)
         VALUES ($1,$2,$3)`,
        [schedule.id, workOrderId, dueDateStr]
      );

      result.generated++;
    } catch (err) {
      result.errors.push(`${dueDateStr}: ${err.message}`);
    }
  }

  // Update last_generated_date to the furthest date processed
  if (dueDates.length > 0) {
    const maxDate = formatDate(dueDates[dueDates.length - 1]);
    await query(
      `UPDATE pm_schedules SET last_generated_date = $1 WHERE id = $2`,
      [maxDate, schedule.id]
    );
  }

  return result;
}

/**
 * Run the rolling window generation for ALL active calendar schedules.
 * Called by the cron job daily.
 * Returns a summary of what was generated.
 */
async function runScheduler() {
  const { rows: schedules } = await query(
    `SELECT s.*,
            tt.code     AS trigger_type_code,
            tt.category AS trigger_category
     FROM pm_schedules s
     JOIN pm_trigger_types tt ON tt.id = s.trigger_type_id
     WHERE s.is_active = TRUE
       AND tt.category = 'calendar'`
  );

  const summary = {
    ran_at:    new Date().toISOString(),
    schedules: schedules.length,
    total_generated: 0,
    total_skipped:   0,
    results: [],
  };

  for (const schedule of schedules) {
    const result = await generateForSchedule(schedule);
    summary.total_generated += result.generated;
    summary.total_skipped   += result.skipped;
    summary.results.push({
      schedule_id:   schedule.id,
      schedule_name: schedule.name,
      ...result,
    });
  }

  return summary;
}

/**
 * Manually trigger generation for a single schedule.
 * Useful for testing and for the admin "generate now" action.
 */
async function generateNow(scheduleId, requestingUser) {
  assertCanManage(requestingUser);
  const schedule = await getSchedule(scheduleId, requestingUser);
  assertCompanyAccess(schedule.company_id, requestingUser);

  if (!schedule.is_active) {
    fail(400, 'INVALID_OPERATION', 'Cannot generate WOs for an inactive schedule');
  }
  if (schedule.trigger_category !== 'calendar') {
    fail(400, 'INVALID_OPERATION', 'Manual generation is only supported for calendar schedules');
  }

  // Attach trigger fields needed by generateForSchedule
  schedule.trigger_type_code = schedule.trigger_type_code;
  schedule.trigger_category  = schedule.trigger_category;

  return generateForSchedule(schedule);
}

/**
 * List generated work orders for a schedule.
 */
async function listGeneratedWorkOrders(scheduleId, requestingUser) {
  assertCanManage(requestingUser);
  const schedule = await getSchedule(scheduleId, requestingUser);
  assertCompanyAccess(schedule.company_id, requestingUser);

  const { rows } = await query(
    `SELECT pwo.id, pwo.due_date, pwo.generated_at,
            wo.id       AS work_order_id,
            wo.title,
            wo.status,
            wo.assigned_to,
            u.full_name AS assigned_to_name
     FROM pm_generated_work_orders pwo
     JOIN work_orders wo      ON wo.id = pwo.work_order_id
     LEFT JOIN users u        ON u.id  = wo.assigned_to
     WHERE pwo.schedule_id = $1
     ORDER BY pwo.due_date DESC`,
    [scheduleId]
  );
  return rows;
}

module.exports = {
  listTriggerTypes,
  listSchedules,
  getSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  generateNow,
  runScheduler,
  listGeneratedWorkOrders,
  VALID_WORK_TYPES,
  ROLLING_WINDOW_MONTHS,
};
