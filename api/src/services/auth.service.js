// src/services/auth.service.js
const { query, withTransaction } = require('../db/pool');
const { verifyPassword, hashPassword, validatePasswordPolicy, isPasswordExpired } = require('../utils/password');
const { generateToken, hashToken, sessionExpiresAt } = require('../utils/token');

/**
 * Load system config (cached after first load)
 */
let _systemConfig = null;

async function getSystemConfig() {
  if (_systemConfig) return _systemConfig;
  const result = await query('SELECT * FROM system_config LIMIT 1');
  if (result.rows.length === 0) {
    throw new Error('System has not been configured. Please run installation.');
  }
  _systemConfig = result.rows[0];
  return _systemConfig;
}

// Exported for testing / forced refresh
function clearSystemConfigCache() {
  _systemConfig = null;
}

/**
 * Login with email and password.
 * Returns session token on success.
 * Throws structured errors on failure.
 */
async function login(email, password, ipAddress, userAgent) {
  const config = await getSystemConfig();

  if (config.auth_mode !== 'internal') {
    throw { status: 400, code: 'WRONG_AUTH_MODE', message: 'This system uses Azure AD authentication' };
  }

  // Look up user by email
  const userResult = await query(
    `SELECT u.*, c.is_help_desk
     FROM users u
     JOIN companies c ON c.id = u.company_id
     WHERE u.email = $1`,
    [email.toLowerCase().trim()]
  );

  const user = userResult.rows[0];

  // Use a generic message to prevent user enumeration
  const invalidCredentials = {
    status: 401,
    code: 'INVALID_CREDENTIALS',
    message: 'Invalid email or password',
  };

  if (!user) throw invalidCredentials;
  if (!user.is_active) {
    throw { status: 403, code: 'ACCOUNT_INACTIVE', message: 'Your account has been deactivated' };
  }

  // Check account lockout
  const recentFailures = await query(
    `SELECT COUNT(*) AS count
     FROM failed_login_attempts
     WHERE user_id = $1
       AND attempted_at > NOW() - INTERVAL '15 minutes'`,
    [user.id]
  );

  const failureCount = parseInt(recentFailures.rows[0].count, 10);
  if (failureCount >= config.max_failed_login_attempts) {
    throw {
      status: 429,
      code: 'ACCOUNT_LOCKED',
      message: `Account temporarily locked due to ${failureCount} failed login attempts. Try again in 15 minutes.`,
    };
  }

  // Verify password — handle both bcrypt (npm) and pgcrypto bf hashes
  // Seed data uses pgcrypto crypt() which produces a different prefix ($2a$ vs bf/)
  let passwordValid = false;
  if (user.password_hash) {
    if (user.password_hash.startsWith('$2b$') || user.password_hash.startsWith('$2a$')) {
      // Standard bcrypt hash — created by the Node.js bcrypt library
      passwordValid = await verifyPassword(password, user.password_hash);
    } else {
      // pgcrypto bf hash from seed data — verify via DB
      const verifyResult = await query(
        `SELECT (password_hash = crypt($1, password_hash)) AS valid FROM users WHERE id = $2`,
        [password, user.id]
      );
      passwordValid = verifyResult.rows[0]?.valid === true;

      // Migrate hash to bcrypt format so future logins use the Node.js path
      if (passwordValid) {
        const newHash = await hashPassword(password);
        await query(
          'UPDATE users SET password_hash = $1 WHERE id = $2',
          [newHash, user.id]
        );
      }
    }
  }
  if (!passwordValid) {
    // Record failed attempt
    await query(
      `INSERT INTO failed_login_attempts (user_id, ip_address) VALUES ($1, $2)`,
      [user.id, ipAddress]
    );
    throw invalidCredentials;
  }

  // Clear failed attempts on success
  await query('DELETE FROM failed_login_attempts WHERE user_id = $1', [user.id]);

  // Check password expiry
  if (isPasswordExpired(user.password_changed_at, config.password_expiry_days)) {
    // Still create session but flag must_change_password
    await query(
      'UPDATE users SET must_change_password = TRUE WHERE id = $1',
      [user.id]
    );
    user.must_change_password = true;
  }

  // Create session
  const { raw, hash } = generateToken();
  const expiresAt = sessionExpiresAt(config.session_timeout_minutes);

  await query(
    `INSERT INTO user_sessions (user_id, token_hash, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.id, hash, ipAddress, userAgent, expiresAt]
  );

  // Update last_seen_at
  await query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [user.id]);

  return {
    token: raw,
    expires_at: expiresAt,
    must_change_password: user.must_change_password || false,
    user: sanitiseUser(user),
  };
}

/**
 * Logout — revoke the current session token
 */
async function logout(tokenRaw) {
  const hash = hashToken(tokenRaw);
  await query(
    `UPDATE user_sessions SET revoked_at = NOW()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hash]
  );
}

/**
 * Validate a session token and return the associated user.
 * Used by the auth middleware on every protected request.
 */
async function validateSession(tokenRaw) {
  const hash = hashToken(tokenRaw);

  const result = await query(
    `SELECT u.*, s.id AS session_id, s.expires_at, c.name AS company_name, c.is_help_desk
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     JOIN companies c ON c.id = u.company_id
     WHERE s.token_hash = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > NOW()`,
    [hash]
  );

  if (result.rows.length === 0) return null;

  const user = result.rows[0];
  if (!user.is_active) return null;

  return sanitiseUser(user);
}

/**
 * Change password for authenticated user
 */
async function changePassword(userId, currentPassword, newPassword) {
  const config = await getSystemConfig();

  const userResult = await query(
    'SELECT * FROM users WHERE id = $1',
    [userId]
  );
  const user = userResult.rows[0];
  if (!user) throw { status: 404, code: 'USER_NOT_FOUND', message: 'User not found' };

  // Verify current password
  const valid = await verifyPassword(currentPassword, user.password_hash);
  if (!valid) {
    throw { status: 401, code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect' };
  }

  // Validate new password against policy
  const policy = validatePasswordPolicy(newPassword, config);
  if (!policy.valid) {
    throw { status: 400, code: 'PASSWORD_POLICY_VIOLATION', message: policy.errors.join('. ') };
  }

  const newHash = await hashPassword(newPassword);

  await query(
    `UPDATE users
     SET password_hash = $1,
         password_changed_at = NOW(),
         must_change_password = FALSE,
         updated_at = NOW()
     WHERE id = $2`,
    [newHash, userId]
  );
}

/**
 * Generate a password reset token and return it (caller is responsible for emailing it)
 */
async function forgotPassword(email) {
  const userResult = await query(
    'SELECT id FROM users WHERE email = $1 AND is_active = TRUE',
    [email.toLowerCase().trim()]
  );

  // Always return success to prevent user enumeration
  if (userResult.rows.length === 0) return null;

  const userId = userResult.rows[0].id;

  // Invalidate any existing reset tokens for this user
  await query(
    `UPDATE password_reset_tokens SET used_at = NOW()
     WHERE user_id = $1 AND used_at IS NULL`,
    [userId]
  );

  const { raw, hash } = generateToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, hash, expiresAt]
  );

  return { userId, resetToken: raw };
}

/**
 * Reset password using a valid reset token
 */
async function resetPassword(resetToken, newPassword) {
  const config = await getSystemConfig();
  const hash = hashToken(resetToken);

  const tokenResult = await query(
    `SELECT prt.*, u.id AS user_id
     FROM password_reset_tokens prt
     JOIN users u ON u.id = prt.user_id
     WHERE prt.token_hash = $1
       AND prt.used_at IS NULL
       AND prt.expires_at > NOW()`,
    [hash]
  );

  if (tokenResult.rows.length === 0) {
    throw { status: 400, code: 'INVALID_RESET_TOKEN', message: 'Reset token is invalid or has expired' };
  }

  const { id: tokenId, user_id: userId } = tokenResult.rows[0];

  // Validate new password against policy
  const policy = validatePasswordPolicy(newPassword, config);
  if (!policy.valid) {
    throw { status: 400, code: 'PASSWORD_POLICY_VIOLATION', message: policy.errors.join('. ') };
  }

  const newHash = await hashPassword(newPassword);

  await withTransaction(async (client) => {
    // Update password
    await client.query(
      `UPDATE users
       SET password_hash = $1,
           password_changed_at = NOW(),
           must_change_password = FALSE,
           updated_at = NOW()
       WHERE id = $2`,
      [newHash, userId]
    );

    // Mark token as used
    await client.query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1',
      [tokenId]
    );

    // Revoke all active sessions (force re-login after password reset)
    await client.query(
      `UPDATE user_sessions SET revoked_at = NOW()
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId]
    );
  });
}

/**
 * Strip sensitive fields before returning user data to the client
 */
function sanitiseUser(user) {
  const { password_hash, azure_oid, ...safe } = user;
  return safe;
}

module.exports = {
  login,
  logout,
  validateSession,
  changePassword,
  forgotPassword,
  resetPassword,
  getSystemConfig,
  clearSystemConfigCache,
};
