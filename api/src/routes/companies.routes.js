// src/routes/companies.routes.js
const express = require('express');
const router = express.Router();
const companiesService = require('../services/companies.service');
const { requireAuth, requireRole, requireHelpDesk, requirePasswordCurrent } = require('../middleware/auth.middleware');

// All company routes require authentication and a current password
router.use(requireAuth, requirePasswordCurrent);

// ─────────────────────────────────────────
// GET /companies
// ─────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const companies = await companiesService.listCompanies(req.user);
    res.status(200).json({ companies });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────
// POST /companies
// Help desk only — company users cannot create companies
// ─────────────────────────────────────────
router.post('/',
  requireHelpDesk,
  async (req, res, next) => {
    try {
      const company = await companiesService.createCompany(req.body);
      res.status(201).json({ message: 'Company created successfully', company });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────
// GET /companies/:id
// ─────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const company = await companiesService.getCompany(req.params.id, req.user);
    res.status(200).json({ company });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────
// PATCH /companies/:id
// Help desk or company admin
// ─────────────────────────────────────────
router.patch('/:id',
  requireRole('help_desk_agent', 'admin'),
  async (req, res, next) => {
    try {
      const company = await companiesService.updateCompany(req.params.id, req.body, req.user);
      res.status(200).json({ message: 'Company updated successfully', company });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
