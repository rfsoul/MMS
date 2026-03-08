// src/routes/users.routes.js
const express = require('express');
const router = express.Router();
const usersService = require('../services/users.service');
const { requireAuth, requireRole, requirePasswordCurrent } = require('../middleware/auth.middleware');

// All user routes require authentication and a current password
router.use(requireAuth, requirePasswordCurrent);

// ─────────────────────────────────────────
// GET /users
// Help desk sees all, company admins/managers see own company
// ─────────────────────────────────────────
router.get('/',
  requireRole('help_desk_agent', 'admin', 'manager'),
  async (req, res, next) => {
    try {
      const filters = {
        company_id: req.query.company_id,
        role: req.query.role,
        is_active: req.query.is_active !== undefined
          ? req.query.is_active === 'true'
          : undefined,
      };
      const users = await usersService.listUsers(req.user, filters);
      res.status(200).json({ users });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────
// POST /users
// Help desk or company admin can provision users
// ─────────────────────────────────────────
router.post('/',
  requireRole('help_desk_agent', 'admin'),
  async (req, res, next) => {
    try {
      const user = await usersService.createUser(req.body, req.user);
      res.status(201).json({ message: 'User provisioned successfully', user });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────
// GET /users/:id
// ─────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const user = await usersService.getUser(req.params.id, req.user);
    res.status(200).json({ user });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────
// PATCH /users/:id
// Users can update own profile, admins can update company users
// ─────────────────────────────────────────
router.patch('/:id', async (req, res, next) => {
  try {
    const user = await usersService.updateUser(req.params.id, req.body, req.user);
    res.status(200).json({ message: 'User updated successfully', user });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────
// DELETE /users/:id  (soft delete — deactivates)
// ─────────────────────────────────────────
router.delete('/:id',
  requireRole('help_desk_agent', 'admin'),
  async (req, res, next) => {
    try {
      const result = await usersService.deactivateUser(req.params.id, req.user);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────
// POST /users/:id/reset-password
// Admin resets a user's password and forces change on next login
// ─────────────────────────────────────────
router.post('/:id/reset-password',
  requireRole('help_desk_agent', 'admin'),
  async (req, res, next) => {
    try {
      const { new_password } = req.body;
      if (!new_password) {
        return res.status(400).json({
          code: 'VALIDATION_ERROR',
          message: 'new_password is required',
        });
      }
      const result = await usersService.resetUserPassword(req.params.id, new_password, req.user);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
