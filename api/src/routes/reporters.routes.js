// src/routes/reporters.routes.js
'use strict';

const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { requireAuth, requirePasswordCurrent, requireRole } = require('../middleware/auth.middleware');

// requireCompanyUser omitted — reporters routes are help_desk_agent only.
router.use(requireAuth, requirePasswordCurrent);

function fail(status, code, message) {
  const err  = new Error(message);
  err.status = status;
  err.code   = code;
  throw err;
}

// GET /reporters
// help_desk_agent only — reporters are a global lookup, not company-scoped
router.get('/',
  requireRole('help_desk_agent'),
  async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, full_name, email, phone, organisation, created_at
         FROM reporters
         ORDER BY full_name ASC`
      );
      res.status(200).json({ reporters: rows });
    } catch (err) { next(err); }
  }
);

// POST /reporters
// Create a reporter on-the-fly while raising an issue
router.post('/',
  requireRole('help_desk_agent'),
  async (req, res, next) => {
    try {
      const { full_name, email, phone, organisation } = req.body;

      if (!full_name || !full_name.trim()) {
        fail(400, 'VALIDATION_ERROR', 'full_name is required');
      }

      const { rows } = await pool.query(
        `INSERT INTO reporters (full_name, email, phone, organisation)
         VALUES ($1, $2, $3, $4)
         RETURNING id, full_name, email, phone, organisation, created_at`,
        [full_name.trim(), email ?? null, phone ?? null, organisation ?? null]
      );

      res.status(201).json({ message: 'Reporter created', reporter: rows[0] });
    } catch (err) { next(err); }
  }
);

module.exports = router;
