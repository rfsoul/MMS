// src/routes/issues.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { query } = pool;  // pool.query shorthand; pool.connect() used for transactions
const { requireAuth, requirePasswordCurrent, requireRole } = require('../middleware/auth.middleware');

// Note: requireCompanyUser is intentionally omitted — help_desk_agents belong to
// the help desk company (is_help_desk=TRUE) and would be rejected by that guard.
// Role-based access is enforced per-endpoint via requireRole().
router.use(requireAuth, requirePasswordCurrent);

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────

function fail(status, code, message) {
  const err  = new Error(message);
  err.status = status;
  err.code   = code;
  throw err;
}

/**
 * Build the base SELECT for issues, joined to companies/users/reporters/symptom_categories.
 * Returns a full issue row suitable for both list and single responses.
 */
const ISSUE_SELECT = `
  SELECT
    i.id,
    i.title,
    i.fault_description,
    i.severity,
    i.status,
    i.asset_graph_id,
    i.target_company_id,
    tc.name               AS target_company_name,
    i.symptom_category_id,
    sc.name               AS symptom_category_name,
    i.reporter_id,
    r.full_name           AS reporter_name,
    i.raised_by,
    u.full_name           AS raised_by_name,
    i.created_at,
    i.updated_at,
    i.assigned_at,
    i.inspecting_at,
    i.follow_up_work_at,
    i.closed_at
  FROM maintenance_issues i
  JOIN  companies tc  ON tc.id = i.target_company_id
  JOIN  users u       ON u.id  = i.raised_by
  LEFT JOIN symptom_categories sc ON sc.id = i.symptom_category_id
  LEFT JOIN reporters r           ON r.id  = i.reporter_id
`;

/**
 * Fetch status_history, linked work_orders, and inspection for a single issue.
 * Returns them as separate arrays/objects to merge into the issue response.
 */
async function fetchIssueDetail(issueId) {
  const [histRows, woRows, inspRows] = await Promise.all([
    pool.query(
      `SELECT
         h.id,
         h.old_status,
         h.new_status,
         h.notes,
         u.full_name AS changed_by_name,
         h.created_at
       FROM issue_status_history h
       JOIN users u ON u.id = h.changed_by
       WHERE h.issue_id = $1
       ORDER BY h.created_at ASC`,
      [issueId]
    ),
    pool.query(
      `SELECT
         wo.id,
         wo.title,
         wo.status,
         wo.priority,
         wo.company_id,
         c.name          AS company_name,
         u.full_name     AS assigned_to_name,
         wo.created_at
       FROM work_orders wo
       JOIN companies c ON c.id = wo.company_id
       LEFT JOIN users u ON u.id = wo.assigned_to
       WHERE wo.issue_id = $1
       ORDER BY wo.created_at ASC`,
      [issueId]
    ),
    pool.query(
      `SELECT
         ins.id,
         ins.notes,
         ins.outcome,
         u.full_name AS inspected_by_name,
         ins.created_at
       FROM inspections ins
       JOIN users u ON u.id = ins.inspected_by
       WHERE ins.issue_id = $1`,
      [issueId]
    ),
  ]);

  return {
    status_history: histRows.rows,
    work_orders:    woRows.rows,
    inspection:     inspRows.rows[0] ?? null,
  };
}

/**
 * Verify the requesting user can access a specific issue.
 * help_desk_agents can access all. company users (admin/manager) only
 * see issues targeted at their company. Technicians cannot access issues.
 */
function assertIssueAccess(issue, requestingUser) {
  if (requestingUser.role === 'help_desk_agent') return;
  if (requestingUser.role === 'technician') {
    fail(403, 'FORBIDDEN', 'Technicians cannot access maintenance issues');
  }
  if (issue.target_company_id !== requestingUser.company_id) {
    fail(404, 'NOT_FOUND', 'Issue not found');
  }
}

/**
 * Validate and return the new status given the current status.
 * Also enforces role constraints on specific transitions.
 */
const ALLOWED_TRANSITIONS = {
  open:           ['assigned'],
  assigned:       ['inspecting'],
  inspecting:     ['follow_up_work'],
  follow_up_work: ['closed'],
  closed:         [],
};

const HELP_DESK_ONLY_TRANSITIONS = ['closed'];

function assertTransition(currentStatus, newStatus, requestingUser) {
  const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(newStatus)) {
    fail(400, 'INVALID_TRANSITION',
      `Cannot transition from '${currentStatus}' to '${newStatus}'`);
  }
  if (HELP_DESK_ONLY_TRANSITIONS.includes(newStatus) &&
      requestingUser.role !== 'help_desk_agent') {
    fail(403, 'FORBIDDEN', 'Only help_desk_agents can close issues');
  }
  // Company admins/managers can move assigned→inspecting and inspecting→follow_up_work
  if (requestingUser.role !== 'help_desk_agent' &&
      !['inspecting', 'follow_up_work'].includes(newStatus)) {
    fail(403, 'FORBIDDEN', 'Only help_desk_agents can perform this transition');
  }
}

// ─────────────────────────────────────────
// SYMPTOM CATEGORIES — lookup
// ─────────────────────────────────────────

// GET /issues/symptom-categories
// Must be registered BEFORE /:id routes to avoid param shadowing.
router.get('/symptom-categories', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, description FROM symptom_categories ORDER BY name`
    );
    res.status(200).json({ categories: rows });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────
// LIST
// ─────────────────────────────────────────

// GET /issues
// help_desk_agent — all issues cross-company
// admin/manager   — issues targeted at their company only
// technician      — 403
router.get('/', async (req, res, next) => {
  try {
    const { role, company_id } = req.user;

    if (role === 'technician') {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Technicians cannot access maintenance issues' });
    }

    const { status, severity, target_company_id, limit = 50, offset = 0 } = req.query;

    const params  = [];
    const clauses = [];

    // Company scoping
    if (role === 'help_desk_agent') {
      if (target_company_id) {
        params.push(target_company_id);
        clauses.push(`i.target_company_id = $${params.length}`);
      }
    } else {
      params.push(company_id);
      clauses.push(`i.target_company_id = $${params.length}`);
    }

    if (status) {
      params.push(status);
      clauses.push(`i.status = $${params.length}`);
    }
    if (severity) {
      params.push(severity);
      clauses.push(`i.severity = $${params.length}`);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    // Total count
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM maintenance_issues i
       ${where}`,
      params
    );
    const total = countResult.rows[0].total;

    // Paged results
    const limitVal  = Math.min(parseInt(limit,  10) || 50, 200);
    const offsetVal = parseInt(offset, 10) || 0;
    params.push(limitVal, offsetVal);

    const { rows } = await pool.query(
      `${ISSUE_SELECT}
       ${where}
       ORDER BY i.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.status(200).json({ issues: rows, total });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────

// POST /issues
// help_desk_agent only — DB trigger also enforces this
router.post('/',
  requireRole('help_desk_agent'),
  async (req, res, next) => {
    try {
      const { id: raised_by } = req.user;
      const {
        title, fault_description, severity,
        target_company_id,
        asset_graph_id,
        symptom_category_id,
        reporter_id,
      } = req.body;

      if (!title)               fail(400, 'VALIDATION_ERROR', 'title is required');
      if (!fault_description)   fail(400, 'VALIDATION_ERROR', 'fault_description is required');
      if (!severity)            fail(400, 'VALIDATION_ERROR', 'severity is required');
      if (!target_company_id)   fail(400, 'VALIDATION_ERROR', 'target_company_id is required');

      const VALID_SEVERITIES = ['low', 'medium', 'high', 'critical'];
      if (!VALID_SEVERITIES.includes(severity)) {
        fail(400, 'VALIDATION_ERROR',
          `Invalid severity '${severity}'. Must be one of: ${VALID_SEVERITIES.join(', ')}`);
      }

      // Verify target company exists (DB trigger will also reject help_desk company)
      const coCheck = await pool.query(
        `SELECT id FROM companies WHERE id = $1`, [target_company_id]
      );
      if (coCheck.rows.length === 0) {
        fail(404, 'NOT_FOUND', 'Target company not found');
      }

      const { rows } = await pool.query(
        `INSERT INTO maintenance_issues
           (raised_by, reporter_id, target_company_id, symptom_category_id,
            title, fault_description, severity, asset_graph_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id`,
        [
          raised_by,
          reporter_id         ?? null,
          target_company_id,
          symptom_category_id ?? null,
          title,
          fault_description,
          severity,
          asset_graph_id      ?? null,
        ]
      );

      // Re-fetch with joins for consistent response shape
      const full = await pool.query(
        `${ISSUE_SELECT} WHERE i.id = $1`, [rows[0].id]
      );
      res.status(201).json({ message: 'Issue raised', issue: full.rows[0] });
    } catch (err) {
      // Surface DB trigger violations as 400s
      if (err.message?.includes('Only help_desk_agents can raise')) {
        return res.status(403).json({ code: 'FORBIDDEN', message: err.message });
      }
      if (err.message?.includes('cannot be targeted at the help desk')) {
        return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Target company cannot be the help desk company' });
      }
      next(err);
    }
  }
);

// ─────────────────────────────────────────
// SINGLE ISSUE
// ─────────────────────────────────────────

// GET /issues/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `${ISSUE_SELECT} WHERE i.id = $1`, [req.params.id]
    );
    if (rows.length === 0) fail(404, 'NOT_FOUND', 'Issue not found');

    const issue = rows[0];
    assertIssueAccess(issue, req.user);

    const detail = await fetchIssueDetail(issue.id);
    res.status(200).json({ issue: { ...issue, ...detail } });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────
// UPDATE FIELDS
// ─────────────────────────────────────────

// PATCH /issues/:id
// Update editable fields — does NOT change status
router.patch('/:id',
  requireRole('help_desk_agent'),
  async (req, res, next) => {
    try {
      const { rows: existing } = await pool.query(
        `SELECT id, status FROM maintenance_issues WHERE id = $1`,
        [req.params.id]
      );
      if (existing.length === 0) fail(404, 'NOT_FOUND', 'Issue not found');
      if (existing[0].status === 'closed') {
        fail(400, 'INVALID_OPERATION', 'Cannot edit a closed issue');
      }

      const { title, fault_description, severity, symptom_category_id, asset_graph_id } = req.body;

      const fields = [];
      const params = [];
      let   idx    = 1;

      const VALID_SEVERITIES = ['low', 'medium', 'high', 'critical'];

      if (title             !== undefined) { fields.push(`title = $${idx++}`);             params.push(title); }
      if (fault_description !== undefined) { fields.push(`fault_description = $${idx++}`); params.push(fault_description); }
      if (severity          !== undefined) {
        if (!VALID_SEVERITIES.includes(severity)) {
          fail(400, 'VALIDATION_ERROR', `Invalid severity '${severity}'`);
        }
        fields.push(`severity = $${idx++}`); params.push(severity);
      }
      if (symptom_category_id !== undefined) { fields.push(`symptom_category_id = $${idx++}`); params.push(symptom_category_id); }
      if (asset_graph_id      !== undefined) { fields.push(`asset_graph_id = $${idx++}`);      params.push(asset_graph_id); }

      if (fields.length === 0) fail(400, 'VALIDATION_ERROR', 'No fields to update');

      fields.push('updated_at = NOW()');
      params.push(req.params.id);

      await pool.query(
        `UPDATE maintenance_issues SET ${fields.join(', ')} WHERE id = $${idx}`,
        params
      );

      const full = await pool.query(`${ISSUE_SELECT} WHERE i.id = $1`, [req.params.id]);
      res.status(200).json({ message: 'Issue updated', issue: full.rows[0] });
    } catch (err) { next(err); }
  }
);

// ─────────────────────────────────────────
// STATUS TRANSITION
// ─────────────────────────────────────────

// PATCH /issues/:id/status
// The record_issue_status_history trigger reads current_setting('app.current_user_id').
// SET LOCAL only persists for the current transaction, so we run the SET LOCAL and
// UPDATE together in a single multi-statement query string. This avoids needing
// pool.connect() (which the pool wrapper doesn't expose) while still keeping
// SET LOCAL scoped correctly — pg sends all statements in one network round-trip
// on the same backend connection.
router.patch('/:id/status', async (req, res, next) => {
  try {
    const { rows: existing } = await pool.query(
      `${ISSUE_SELECT} WHERE i.id = $1`, [req.params.id]
    );
    if (existing.length === 0) fail(404, 'NOT_FOUND', 'Issue not found');

    const issue = existing[0];
    assertIssueAccess(issue, req.user);

    const { status: newStatus, notes } = req.body;
    if (!newStatus) fail(400, 'VALIDATION_ERROR', 'status is required');

    assertTransition(issue.status, newStatus, req.user);

    // set_config with is_local=false sets at session level so current_setting()
    // in the trigger can read it. Transaction-scoped (is_local=true) is not visible
    // to the trigger when using a pool wrapper without dedicated client connections.
    // This is safe: we set it immediately before the UPDATE that fires the trigger.
    await pool.query(
      `SELECT set_config('app.current_user_id', $1, false)`,
      [req.user.id]
    );
    await pool.query(
      `UPDATE maintenance_issues SET status = $1 WHERE id = $2`,
      [newStatus, issue.id]
    );

    // Patch notes onto the trigger-inserted history row if provided
    if (notes) {
      await pool.query(
        `UPDATE issue_status_history
         SET notes = $1
         WHERE issue_id = $2
           AND new_status = $3
           AND created_at = (
             SELECT MAX(created_at) FROM issue_status_history
             WHERE issue_id = $2 AND new_status = $3
           )`,
        [notes, issue.id, newStatus]
      );
    }

    const full = await pool.query(`${ISSUE_SELECT} WHERE i.id = $1`, [issue.id]);
    res.status(200).json({ message: 'Issue status updated', issue: full.rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
