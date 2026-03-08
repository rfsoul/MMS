// src/routes/asset-types.routes.js
const express = require('express');
const router = express.Router();
const { query } = require('../db/pool');
const { requireAuth, requireRole, requirePasswordCurrent, requireCompanyUser } = require('../middleware/auth.middleware');

router.use(requireAuth, requirePasswordCurrent, requireCompanyUser);

// GET /asset-types
router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, name, description, created_at
       FROM asset_types
       WHERE company_id = $1
       ORDER BY name ASC`,
      [req.user.company_id]
    );
    res.status(200).json({ asset_types: result.rows });
  } catch (err) { next(err); }
});

// POST /asset-types
router.post('/',
  requireRole('admin', 'manager'),
  async (req, res, next) => {
    try {
      const { name, description } = req.body;
      if (!name) {
        return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'name is required' });
      }
      const result = await query(
        `INSERT INTO asset_types (company_id, name, description)
         VALUES ($1, $2, $3)
         RETURNING id, name, description, created_at`,
        [req.user.company_id, name, description || null]
      );
      res.status(201).json({ message: 'Asset type created', asset_type: result.rows[0] });
    } catch (err) { next(err); }
  }
);

// PATCH /asset-types/:id
router.patch('/:id',
  requireRole('admin', 'manager'),
  async (req, res, next) => {
    try {
      const { name, description } = req.body;
      const result = await query(
        `UPDATE asset_types
         SET name = COALESCE($1, name),
             description = COALESCE($2, description)
         WHERE id = $3 AND company_id = $4
         RETURNING id, name, description, created_at`,
        [name || null, description || null, req.params.id, req.user.company_id]
      );
      if (!result.rows.length) {
        return res.status(404).json({ code: 'NOT_FOUND', message: 'Asset type not found' });
      }
      res.status(200).json({ message: 'Asset type updated', asset_type: result.rows[0] });
    } catch (err) { next(err); }
  }
);

// DELETE /asset-types/:id
router.delete('/:id',
  requireRole('admin'),
  async (req, res, next) => {
    try {
      await query(
        'DELETE FROM asset_types WHERE id = $1 AND company_id = $2',
        [req.params.id, req.user.company_id]
      );
      res.status(200).json({ message: 'Asset type deleted' });
    } catch (err) { next(err); }
  }
);

module.exports = router;
