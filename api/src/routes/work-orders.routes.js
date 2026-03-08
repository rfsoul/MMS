const express = require('express');
const router = express.Router();
const workOrdersService = require('../services/work-orders.service');
const pool = require('../db/pool');
const { requireAuth, requireRole, requirePasswordCurrent, requireCompanyUser } = require('../middleware/auth.middleware');

router.use(requireAuth, requirePasswordCurrent, requireCompanyUser);

// ─────────────────────────────────────────
// LIST & CREATE
// ─────────────────────────────────────────

// GET /work-orders
// ?status=open|assigned|in_progress|on_hold|completed
// ?priority=low|medium|high|critical
// ?assigned_to=<userId>
// ?asset_graph_id=<graphNodeId>
// ?issue_id=<issueId>
router.get('/', async (req, res, next) => {
  try {
    const filters = {
      status:         req.query.status,
      priority:       req.query.priority,
      assigned_to:    req.query.assigned_to,
      asset_graph_id: req.query.asset_graph_id,
      issue_id:       req.query.issue_id,
    };
    const workOrders = await workOrdersService.listWorkOrders(req.user, filters);
    res.status(200).json({ work_orders: workOrders });
  } catch (err) { next(err); }
});

// POST /work-orders
// admin / manager: can assign to any active company user
// technician: self-assigns automatically
router.post('/',
  requireRole('admin', 'manager', 'technician'),
  async (req, res, next) => {
    try {
      const workOrder = await workOrdersService.createWorkOrder(req.body, req.user);
      res.status(201).json({ message: 'Work order created', work_order: workOrder });
    } catch (err) { next(err); }
  }
);

// ─────────────────────────────────────────
// SINGLE WORK ORDER
// ─────────────────────────────────────────

// GET /work-orders/:id — returns work order + updates[]
router.get('/:id', async (req, res, next) => {
  try {
    const workOrder = await workOrdersService.getWorkOrder(req.params.id, req.user);
    res.status(200).json({ work_order: workOrder });
  } catch (err) { next(err); }
});

// PATCH /work-orders/:id — update fields (not status)
router.patch('/:id',
  requireRole('admin', 'manager', 'technician'),
  async (req, res, next) => {
    try {
      const workOrder = await workOrdersService.updateWorkOrder(req.params.id, req.body, req.user);
      res.status(200).json({ message: 'Work order updated', work_order: workOrder });
    } catch (err) { next(err); }
  }
);

// ─────────────────────────────────────────
// STATUS TRANSITIONS
// ─────────────────────────────────────────

// POST /work-orders/:id/assign
// Body: { assigned_to: UUID, notes?: string }
// Admin / manager only
router.post('/:id/assign',
  requireRole('admin', 'manager'),
  async (req, res, next) => {
    try {
      const { assigned_to, notes } = req.body;
      if (!assigned_to) {
        return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'assigned_to is required' });
      }
      const workOrder = await workOrdersService.assignWorkOrder(req.params.id, assigned_to, req.user, notes);
      res.status(200).json({ message: 'Work order assigned', work_order: workOrder });
    } catch (err) { next(err); }
  }
);

// POST /work-orders/:id/start — open|assigned|on_hold → in_progress
// Body: { notes?: string }
router.post('/:id/start',
  requireRole('admin', 'manager', 'technician'),
  async (req, res, next) => {
    try {
      const workOrder = await workOrdersService.transitionStatus(
        req.params.id, 'in_progress', req.user, { notes: req.body.notes }
      );
      res.status(200).json({ message: 'Work order started', work_order: workOrder });
    } catch (err) { next(err); }
  }
);

// POST /work-orders/:id/hold — in_progress → on_hold
// Body: { notes?: string }
router.post('/:id/hold',
  requireRole('admin', 'manager', 'technician'),
  async (req, res, next) => {
    try {
      const workOrder = await workOrdersService.transitionStatus(
        req.params.id, 'on_hold', req.user, { notes: req.body.notes }
      );
      res.status(200).json({ message: 'Work order put on hold', work_order: workOrder });
    } catch (err) { next(err); }
  }
);

// POST /work-orders/:id/complete
// Accepts completion from any active status (open, assigned, on_hold, in_progress).
// The mobile client submits work orders directly without a separate start call.
//
// Body:
//   notes?:                   string
//   actual_duration_minutes?: number   — auto-calculated from timestamps if absent
//   started_at?:              ISO 8601 — device-recorded start time (overrides trigger)
//   completed_at?:            ISO 8601 — device-recorded completion time (overrides trigger)
//
// Timestamp override behaviour:
//   The DB trigger stamps started_at / completed_at using IS NULL guards, so values
//   written by the application layer before the trigger fires are preserved.
//   The force-to-in_progress step writes started_at only when the client supplies one,
//   so the trigger still fires for the normal (no override) case.
//
// Validation:
//   - If both timestamps supplied, started_at must be before completed_at.
//   - actual_duration_minutes is auto-calculated (round minutes) when absent and both
//     timestamps are present. Explicit value is always honoured as-is.
router.post('/:id/complete',
  requireRole('admin', 'manager', 'technician'),
  async (req, res, next) => {
    try {
      const { notes, started_at, completed_at } = req.body;
      let { actual_duration_minutes } = req.body;

      // Validate timestamp ordering if both supplied
      if (started_at && completed_at) {
        const s = new Date(started_at);
        const c = new Date(completed_at);
        if (isNaN(s.getTime()) || isNaN(c.getTime())) {
          return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'started_at and completed_at must be valid ISO 8601 timestamps' });
        }
        if (s >= c) {
          return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'started_at must be before completed_at' });
        }
        // Auto-calculate duration when not explicitly provided
        if (actual_duration_minutes === undefined) {
          actual_duration_minutes = Math.round((c - s) / 60000);
        }
      }

      // Force the WO into in_progress if it isn't already, so the
      // transitionStatus state machine accepts the completed transition.
      // This handles on_hold, open, and assigned statuses from mobile submit.
      // Note: this UPDATE uses only company_id for the WHERE clause, bypassing
      // the technician assignment check. This is intentional — the bypass only
      // covers the intermediate status coercion. The subsequent transitionStatus
      // call enforces assertWriteAccess which includes the technician assignment
      // check, so an unauthorised technician will still be rejected on the
      // final transition.
      //
      // If the client supplies started_at, write it here so the trigger sees a
      // non-null value and leaves it alone. Otherwise the trigger stamps NOW().
      // completed_at cannot be pre-set this way (the force-to-in_progress step
      // runs first; completed_at is set after the completed transition below).
      const startFields = started_at ? `, started_at = $3` : '';
      const startParams = started_at
        ? [req.params.id, req.user.company_id, started_at]
        : [req.params.id, req.user.company_id];

      await pool.query(
        `UPDATE work_orders
         SET status = 'in_progress', updated_at = NOW()${startFields}
         WHERE id = $1
           AND company_id = $2
           AND status NOT IN ('in_progress', 'completed')`,
        startParams
      );

      const workOrder = await workOrdersService.transitionStatus(
        req.params.id, 'completed', req.user, {
          notes,
          actual_duration_minutes,
        }
      );

      // If the client supplied completed_at, overwrite the trigger-stamped value.
      // The trigger fires on the transitionStatus UPDATE above; it stamps NOW()
      // because completed_at was NULL at that point (we set it here after).
      // This is acceptable — the trigger guard only prevents double-stamping on
      // re-transition; a deliberate post-transition override is fine.
      if (completed_at) {
        await pool.query(
          `UPDATE work_orders SET completed_at = $1 WHERE id = $2 AND company_id = $3`,
          [completed_at, req.params.id, req.user.company_id]
        );
        workOrder.completed_at = completed_at;
      }

      res.status(200).json({ message: 'Work order completed', work_order: workOrder });
    } catch (err) { next(err); }
  }
);

// ─────────────────────────────────────────
// UPDATES (field notes + photos)
// ─────────────────────────────────────────

// POST /work-orders/:id/updates
// Body: { notes?: string, photo_urls?: string[] }
router.post('/:id/updates',
  requireRole('admin', 'manager', 'technician'),
  async (req, res, next) => {
    try {
      const update = await workOrdersService.addUpdate(req.params.id, req.body, req.user);
      res.status(201).json({ message: 'Update added', update });
    } catch (err) { next(err); }
  }
);

// ─────────────────────────────────────────
// SWM DOCUMENT
// ─────────────────────────────────────────

// POST /work-orders/:id/swm
// Body: { swm_document_url: string, swm_document_name?: string }
// Admin / manager only
router.post('/:id/swm',
  requireRole('admin', 'manager'),
  async (req, res, next) => {
    try {
      const workOrder = await workOrdersService.setSWMDocument(req.params.id, req.body, req.user);
      res.status(200).json({ message: 'SWM document recorded', work_order: workOrder });
    } catch (err) { next(err); }
  }
);

module.exports = router;
