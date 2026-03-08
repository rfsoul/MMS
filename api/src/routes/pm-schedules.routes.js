// src/routes/pm-schedules.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const svc     = require('../services/pm-schedules.service');
const { requireAuth, requirePasswordCurrent, requireCompanyUser, requireRole } = require('../middleware/auth.middleware');

router.use(requireAuth, requirePasswordCurrent, requireCompanyUser);

// ─────────────────────────────────────────
// TRIGGER TYPES (reference data)
// ─────────────────────────────────────────

// GET /pm/trigger-types
// Returns all trigger types — used to populate dropdowns in the UI
router.get('/trigger-types', async (req, res, next) => {
  try {
    const triggerTypes = await svc.listTriggerTypes();
    res.json({ trigger_types: triggerTypes });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────
// PM SCHEDULES
// ─────────────────────────────────────────

// GET /pm/schedules
// ?asset_graph_id=<id>  ?is_active=true|false
router.get('/schedules', async (req, res, next) => {
  try {
    const filters = {
      asset_graph_id: req.query.asset_graph_id,
      is_active: req.query.is_active !== undefined
        ? req.query.is_active !== 'false' : undefined,
    };
    const schedules = await svc.listSchedules(req.user, filters);
    res.json({ schedules });
  } catch (err) { next(err); }
});

// POST /pm/schedules
// Body: { asset_graph_id, asset_type_id, name, work_type, trigger_type_id,
//         interval_value?, runtime_threshold?, runtime_checklist_item_id?,
//         asset_checklist_id?,   -- checklist to execute when WO is generated (nullable)
//         starts_on, ends_on? }
router.post('/schedules',
  requireRole('admin', 'manager'),
  async (req, res, next) => {
    try {
      const schedule = await svc.createSchedule(req.body, req.user);
      res.status(201).json({ message: 'PM schedule created', schedule });
    } catch (err) { next(err); }
  }
);

// GET /pm/schedules/:id
router.get('/schedules/:id', async (req, res, next) => {
  try {
    const schedule = await svc.getSchedule(req.params.id, req.user);
    res.json({ schedule });
  } catch (err) { next(err); }
});

// PATCH /pm/schedules/:id
// Body may include asset_checklist_id to update or clear the linked checklist
router.patch('/schedules/:id',
  requireRole('admin', 'manager'),
  async (req, res, next) => {
    try {
      const schedule = await svc.updateSchedule(req.params.id, req.body, req.user);
      res.json({ schedule });
    } catch (err) { next(err); }
  }
);

// DELETE /pm/schedules/:id  — soft deactivate
router.delete('/schedules/:id',
  requireRole('admin', 'manager'),
  async (req, res, next) => {
    try {
      const result = await svc.deleteSchedule(req.params.id, req.user);
      res.json(result);
    } catch (err) { next(err); }
  }
);

// ─────────────────────────────────────────
// GENERATION
// ─────────────────────────────────────────

// POST /pm/schedules/:id/generate
// Manually trigger WO generation for a single schedule
// Useful for testing and for admin "generate now" actions
router.post('/schedules/:id/generate',
  requireRole('admin', 'manager'),
  async (req, res, next) => {
    try {
      const result = await svc.generateNow(req.params.id, req.user);
      res.json({ message: 'Generation complete', result });
    } catch (err) { next(err); }
  }
);

// GET /pm/schedules/:id/work-orders
// List all generated work orders for a schedule
router.get('/schedules/:id/work-orders', async (req, res, next) => {
  try {
    const workOrders = await svc.listGeneratedWorkOrders(req.params.id, req.user);
    res.json({ work_orders: workOrders });
  } catch (err) { next(err); }
});

// POST /pm/run
// Admin only: manually trigger the full scheduler run across all active schedules
// In production this is called by node-cron — this endpoint allows manual trigger
router.post('/run',
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const summary = await svc.runScheduler();
      res.json({ message: 'Scheduler run complete', summary });
    } catch (err) { next(err); }
  }
);

module.exports = router;
