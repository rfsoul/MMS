// src/middleware/auth.middleware.js
const { validateSession } = require('../services/auth.service');

/**
 * Require a valid session token on the request.
 * Attaches req.user for downstream handlers.
 */
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        code: 'MISSING_TOKEN',
        message: 'Authentication token is required',
      });
    }

    const token = authHeader.slice(7); // strip 'Bearer '
    const user = await validateSession(token);

    if (!user) {
      return res.status(401).json({
        code: 'INVALID_TOKEN',
        message: 'Session token is invalid or has expired',
      });
    }

    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Require the authenticated user to have one of the specified roles.
 * Must be used after requireAuth.
 * Usage: requireRole('admin', 'manager')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: `This action requires one of the following roles: ${roles.join(', ')}`,
      });
    }

    next();
  };
}

/**
 * Require that the user belongs to the help desk company.
 * Must be used after requireAuth.
 */
function requireHelpDesk(req, res, next) {
  if (!req.user?.is_help_desk) {
    return res.status(403).json({
      code: 'FORBIDDEN',
      message: 'This action is restricted to help desk users',
    });
  }
  next();
}

/**
 * Require that the user does NOT belong to the help desk company.
 * Must be used after requireAuth.
 */
function requireCompanyUser(req, res, next) {
  if (req.user?.is_help_desk) {
    return res.status(403).json({
      code: 'FORBIDDEN',
      message: 'This action is restricted to company users',
    });
  }
  next();
}

/**
 * Block access if user must change their password first.
 * Exempt routes: /auth/change-password, /auth/logout
 */
function requirePasswordCurrent(req, res, next) {
  const exemptPaths = ['/auth/change-password', '/auth/logout', '/auth/me'];
  if (req.user?.must_change_password && !exemptPaths.includes(req.path)) {
    return res.status(403).json({
      code: 'PASSWORD_CHANGE_REQUIRED',
      message: 'You must change your password before continuing',
    });
  }
  next();
}

module.exports = {
  requireAuth,
  requireRole,
  requireHelpDesk,
  requireCompanyUser,
  requirePasswordCurrent,
};
