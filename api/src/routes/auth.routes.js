// src/routes/auth.routes.js
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authService = require('../services/auth.service');
const { requireAuth, requirePasswordCurrent } = require('../middleware/auth.middleware');

// Rate limiter for login and password reset endpoints
// Stricter than global rate limit to slow brute force attempts.
// Skipped entirely in non-production environments so the test harness
// (which makes ~30+ auth calls from a single IP) is never blocked.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  skip: () => process.env.NODE_ENV !== 'production',
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: 'RATE_LIMITED',
    message: 'Too many requests, please try again in 15 minutes',
  },
});

// ─────────────────────────────────────────
// POST /auth/login
// ─────────────────────────────────────────
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Email and password are required',
      });
    }

    const ipAddress = req.ip || req.socket?.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = await authService.login(email, password, ipAddress, userAgent);

    res.status(200).json({
      message: 'Login successful',
      token: result.token,
      expires_at: result.expires_at,
      must_change_password: result.must_change_password,
      user: result.user,
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────
// POST /auth/logout
// ─────────────────────────────────────────
router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await authService.logout(req.token);
    res.status(200).json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────
// GET /auth/me
// ─────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  res.status(200).json({ user: req.user });
});

// ─────────────────────────────────────────
// POST /auth/change-password
// ─────────────────────────────────────────
router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'current_password and new_password are required',
      });
    }

    if (current_password === new_password) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'New password must be different from current password',
      });
    }

    await authService.changePassword(req.user.id, current_password, new_password);

    res.status(200).json({ message: 'Password changed successfully' });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────
// POST /auth/forgot-password
// ─────────────────────────────────────────
router.post('/forgot-password', authLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Email is required',
      });
    }

    const result = await authService.forgotPassword(email);

    // Always return 200 to prevent user enumeration
    // In production the reset token would be emailed — log here for now
    if (result) {
      console.log(`[DEV] Password reset token for ${email}: ${result.resetToken}`);
    }

    res.status(200).json({
      message: 'If an account exists for this email, a password reset link has been sent',
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────
// POST /auth/reset-password
// ─────────────────────────────────────────
router.post('/reset-password', authLimiter, async (req, res, next) => {
  try {
    const { token, new_password } = req.body;

    if (!token || !new_password) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'token and new_password are required',
      });
    }

    await authService.resetPassword(token, new_password);

    res.status(200).json({
      message: 'Password reset successfully. Please log in with your new password.',
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
