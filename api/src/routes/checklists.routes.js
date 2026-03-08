// src/routes/checklists.routes.js
'use strict';

const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const svc      = require('../services/checklists.service');
const { requireAuth, requirePasswordCurrent, requireCompanyUser } = require('../middleware/auth.middleware');

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) cb(null, true);
    else cb(new Error('Only CSV files are accepted'));
  },
});

router.use(requireAuth, requirePasswordCurrent, requireCompanyUser);

// ─────────────────────────────────────────
// ASSET TYPE CHECKLIST TEMPLATES
// ─────────────────────────────────────────

// GET  /checklists/templates
// ?asset_type_id=<uuid>  ?is_active=true|false
router.get('/templates', async (req, res, next) => {
  try {
    const filters = {
      asset_type_id: req.query.asset_type_id,
      is_active: req.query.is_active !== undefined
        ? req.query.is_active !== 'false' : undefined,
    };
    const templates = await svc.listTemplates(req.user, filters);
    res.json({ templates });
  } catch (err) { next(err); }
});

// POST /checklists/templates  — JSON body
// Body: { asset_type_id, name, description?, items?: [{
//   sequence, label, item_type, unit?, min_value?, max_value?,
//   is_required?, is_runtime_trigger?, is_reportable?
// }] }
router.post('/templates', async (req, res, next) => {
  try {
    const template = await svc.createTemplate(req.body, req.user);
    res.status(201).json({ message: 'Checklist template created', template });
  } catch (err) { next(err); }
});

// POST /checklists/templates/import  — multipart CSV
// fields: file (CSV), asset_type_id, name, description?
router.post('/templates/import',
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'CSV file is required (field: file)' });
      }
      const { asset_type_id, name, description } = req.body;
      if (!asset_type_id) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'asset_type_id is required' });
      if (!name)          return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'name is required' });

      const template = await svc.importTemplateFromCsv(
        req.file.buffer.toString('utf8'),
        { asset_type_id, name, description },
        req.user
      );
      res.status(201).json({ message: 'Checklist template imported', template });
    } catch (err) { next(err); }
  }
);

// GET /checklists/templates/:id
router.get('/templates/:id', async (req, res, next) => {
  try {
    const template = await svc.getTemplate(req.params.id, req.user);
    res.json({ template });
  } catch (err) { next(err); }
});

// GET /checklists/templates/:id/export  — CSV download
router.get('/templates/:id/export', async (req, res, next) => {
  try {
    const { template, csv } = await svc.exportTemplateToCsv(req.params.id, req.user);
    const filename = `${template.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_template.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) { next(err); }
});

// DELETE /checklists/templates/:id  — soft-deactivate
router.delete('/templates/:id', async (req, res, next) => {
  try {
    const result = await svc.deactivateTemplate(req.params.id, req.user);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /checklists/templates/from-asset/:assetGraphId/:checklistId
// Promote an existing asset checklist to a reusable template.
// Body: { name?, description? }  — defaults to checklist name/description if omitted
// The resulting template is independent of the source checklist.
router.post('/templates/from-asset/:assetGraphId/:checklistId', async (req, res, next) => {
  try {
    const template = await svc.promoteChecklistToTemplate(
      req.params.checklistId, req.body, req.user
    );
    res.status(201).json({ message: 'Template created from asset checklist', template });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────
// ASSET CHECKLISTS
// Mounted under /checklists/assets/:assetGraphId
// ─────────────────────────────────────────

// GET /checklists/assets/:assetGraphId
// ?is_active=true|false
router.get('/assets/:assetGraphId', async (req, res, next) => {
  try {
    const checklists = await svc.listAssetChecklists(req.params.assetGraphId, req.user);
    res.json({ checklists });
  } catch (err) { next(err); }
});

// POST /checklists/assets/:assetGraphId
// Body: { asset_type_id, name, description?, source?, template_id?, items?: [{
//   sequence, label, item_type, unit?, min_value?, max_value?,
//   is_required?, is_runtime_trigger?, is_reportable?
// }] }
// source: 'scratch' (default) | 'template' | 'csv'
router.post('/assets/:assetGraphId', async (req, res, next) => {
  try {
    const checklist = await svc.createAssetChecklist(
      req.params.assetGraphId, req.body, req.user
    );
    res.status(201).json({ message: 'Asset checklist created', checklist });
  } catch (err) { next(err); }
});

// POST /checklists/assets/:assetGraphId/import  — multipart CSV
// fields: file (CSV), asset_type_id, name, description?
router.post('/assets/:assetGraphId/import',
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'CSV file is required (field: file)' });
      }
      const { asset_type_id, name, description } = req.body;
      if (!asset_type_id) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'asset_type_id is required' });
      if (!name)          return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'name is required' });

      const checklist = await svc.importAssetChecklistFromCsv(
        req.params.assetGraphId,
        req.file.buffer.toString('utf8'),
        { asset_type_id, name, description },
        req.user
      );
      res.status(201).json({ message: 'Asset checklist imported', checklist });
    } catch (err) { next(err); }
  }
);

// GET /checklists/assets/:assetGraphId/:id
router.get('/assets/:assetGraphId/:id', async (req, res, next) => {
  try {
    const checklist = await svc.getAssetChecklist(req.params.id, req.user);
    res.json({ checklist });
  } catch (err) { next(err); }
});

// GET /checklists/assets/:assetGraphId/:id/export  — CSV download
router.get('/assets/:assetGraphId/:id/export', async (req, res, next) => {
  try {
    const { checklist, csv } = await svc.exportAssetChecklistToCsv(req.params.id, req.user);
    const filename = `${checklist.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_checklist.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) { next(err); }
});

// PATCH /checklists/assets/:assetGraphId/:id
router.patch('/assets/:assetGraphId/:id', async (req, res, next) => {
  try {
    const checklist = await svc.updateAssetChecklist(req.params.id, req.body, req.user);
    res.json({ checklist });
  } catch (err) { next(err); }
});

// DELETE /checklists/assets/:assetGraphId/:id  — soft-deactivate
router.delete('/assets/:assetGraphId/:id', async (req, res, next) => {
  try {
    const result = await svc.deactivateAssetChecklist(req.params.id, req.user);
    res.json(result);
  } catch (err) { next(err); }
});


module.exports = router;
