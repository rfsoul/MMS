// src/routes/work-order-tasks.routes.js
'use strict';

const express = require('express');
const router  = express.Router({ mergeParams: true }); // mergeParams to access :workOrderId
const svc     = require('../services/work-order-tasks.service');
const { requireAuth, requirePasswordCurrent, requireCompanyUser } = require('../middleware/auth.middleware');

router.use(requireAuth, requirePasswordCurrent, requireCompanyUser);

// ─────────────────────────────────────────
// TASKS
// All routes are under /work-orders/:workOrderId/tasks
// ─────────────────────────────────────────

// GET /work-orders/:workOrderId/tasks
router.get('/', async (req, res, next) => {
  try {
    const tasks = await svc.listTasks(req.params.workOrderId, req.user);
    res.json({ tasks });
  } catch (err) { next(err); }
});

// POST /work-orders/:workOrderId/tasks
// Body: { title, description?, task_type, asset_checklist_id?, sequence?, estimated_duration_minutes? }
router.post('/', async (req, res, next) => {
  try {
    const task = await svc.createTask(req.params.workOrderId, req.body, req.user);
    res.status(201).json({ message: 'Task created', task });
  } catch (err) { next(err); }
});

// GET /work-orders/:workOrderId/tasks/:taskId
router.get('/:taskId', async (req, res, next) => {
  try {
    const task = await svc.getTask(req.params.workOrderId, req.params.taskId, req.user);
    res.json({ task });
  } catch (err) { next(err); }
});

// PATCH /work-orders/:workOrderId/tasks/:taskId
// Body: { title?, description?, sequence?, estimated_duration_minutes? }
router.patch('/:taskId', async (req, res, next) => {
  try {
    const task = await svc.updateTask(
      req.params.workOrderId, req.params.taskId, req.body, req.user
    );
    res.json({ task });
  } catch (err) { next(err); }
});

// DELETE /work-orders/:workOrderId/tasks/:taskId
router.delete('/:taskId', async (req, res, next) => {
  try {
    const result = await svc.deleteTask(
      req.params.workOrderId, req.params.taskId, req.user
    );
    res.json(result);
  } catch (err) { next(err); }
});

// POST /work-orders/:workOrderId/tasks/:taskId/start
// Transition: pending → in_progress
router.post('/:taskId/start', async (req, res, next) => {
  try {
    const task = await svc.transitionTask(
      req.params.workOrderId, req.params.taskId, 'in_progress', req.body, req.user
    );
    res.json({ task });
  } catch (err) { next(err); }
});

// POST /work-orders/:workOrderId/tasks/:taskId/complete
// Transition: in_progress → completed
// Body: { actual_duration_minutes? }
router.post('/:taskId/complete', async (req, res, next) => {
  try {
    const task = await svc.transitionTask(
      req.params.workOrderId, req.params.taskId, 'completed', req.body, req.user
    );
    res.json({ task });
  } catch (err) { next(err); }
});

// POST /work-orders/:workOrderId/tasks/:taskId/skip
// Transition: pending|in_progress → skipped
router.post('/:taskId/skip', async (req, res, next) => {
  try {
    const task = await svc.transitionTask(
      req.params.workOrderId, req.params.taskId, 'skipped', req.body, req.user
    );
    res.json({ task });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────
// CHECKLIST RESPONSES
// Under /work-orders/:workOrderId/tasks/:taskId/responses
// Sole owner of response submission — checklists.routes.js is admin/config only.
// ─────────────────────────────────────────

// GET /work-orders/:workOrderId/tasks/:taskId/responses
// Returns all checklist items with their current responses (null if not yet answered).
// Includes is_reportable so the mobile UI can distinguish measurement fields
// from procedural steps if needed.
router.get('/:taskId/responses', async (req, res, next) => {
  try {
    const responses = await svc.listResponses(
      req.params.workOrderId, req.params.taskId, req.user
    );
    res.json({ responses });
  } catch (err) { next(err); }
});

// GET /work-orders/:workOrderId/tasks/:taskId/responses/summary
// Returns completion counts: total, answered, required_answered, out_of_range.
// Useful for progress indicators in the mobile UI.
router.get('/:taskId/responses/summary', async (req, res, next) => {
  try {
    const summary = await svc.getResponseSummary(
      req.params.workOrderId, req.params.taskId, req.user
    );
    res.json({ summary });
  } catch (err) { next(err); }
});

// POST /work-orders/:workOrderId/tasks/:taskId/responses
// Bulk upsert — submit one or more item responses in a single call.
// Designed for offline-first: tech fills entire checklist offline,
// submits all responses as one batch on reconnect.
// Calling again for the same (item, task) pair updates the existing response.
// is_out_of_range is set automatically by the DB trigger on each response.
//
// Body: {
//   responses: [{
//     asset_checklist_item_id: uuid,
//     numeric_value?:  number,   -- for 'measurement' items
//     boolean_value?:  boolean,  -- for 'true_false' / 'step' items
//     text_value?:     string,   -- for 'text' items
//     photo_url?:      string,   -- for 'photo' items
//     notes?:          string    -- optional note on any item
//   }]
// }
router.post('/:taskId/responses', async (req, res, next) => {
  try {
    if (!Array.isArray(req.body.responses) || req.body.responses.length === 0) {
      return res.status(400).json({
        code:    'VALIDATION_ERROR',
        message: 'responses must be a non-empty array',
      });
    }
    const result = await svc.submitResponses(
      req.params.workOrderId, req.params.taskId, req.body.responses, req.user
    );
    res.status(201).json({ message: 'Responses recorded', ...result });
  } catch (err) { next(err); }
});

// DELETE /work-orders/:workOrderId/tasks/:taskId/responses/:responseId
router.delete('/:taskId/responses/:responseId', async (req, res, next) => {
  try {
    const result = await svc.deleteResponse(
      req.params.workOrderId, req.params.taskId, req.params.responseId, req.user
    );
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
