// src/services/users.service.js
const { query, withTransaction } = require('../db/pool');
const { hashPassword, validatePasswordPolicy } = require('../utils/password');
const { getSystemConfig } = require('./auth.service');

/**
 * List users
 * - Help desk sees all users across all companies
 * - Company admins/managers see users in their own company
 * - Technicians cannot list users
 */
async function listUsers(requestingUser, filters = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (!requestingUser.is_help_desk) {
    conditions.push(`u.company_id = $${idx++}`);
    params.push(requestingUser.company_id);
  }

  if (filters.company_id) {
    conditions.push(`u.company_id = $${idx++}`);
    params.push(filters.company_id);
  }

  if (filters.role) {
    conditions.push(`u.role = $${idx++}`);
    params.push(filters.role);
  }

  if (filters.is_active !== undefined) {
    conditions.push(`u.is_active = $${idx++}`);
    params.push(filters.is_active);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query(`
    SELECT
      u.id,
      u.company_id,
      c.name AS company_name,
      u.email,
      u.full_name,
      u.role,
      u.is_active,
      u.must_change_password,
      u.last_seen_at,
      u.created_at,
      u.updated_at
    FROM users u
    JOIN companies c ON c.id = u.company_id
    ${where}
    ORDER BY c.name ASC, u.full_name ASC
  `, params);

  return result.rows;
}

/**
 * Get a single user by ID
 */
async function getUser(id, requestingUser) {
  const result = await query(`
    SELECT
      u.id,
      u.company_id,
      c.name AS company_name,
      c.is_help_desk,
      u.email,
      u.full_name,
      u.role,
      u.is_active,
      u.must_change_password,
      u.last_seen_at,
      u.created_at,
      u.updated_at
    FROM users u
    JOIN companies c ON c.id = u.company_id
    WHERE u.id = $1
  `, [id]);

  if (result.rows.length === 0) {
    throw { status: 404, code: 'NOT_FOUND', message: 'User not found' };
  }

  const user = result.rows[0];

  // Company users can only view users in their own company
  if (!requestingUser.is_help_desk && user.company_id !== requestingUser.company_id) {
    throw { status: 403, code: 'FORBIDDEN', message: 'You can only view users in your own company' };
  }

  return user;
}

/**
 * Provision a new user
 * - Help desk agents can create users in any company
 * - Company admins can create users in their own company only
 * - Role assignment is validated against the target company type
 */
async function createUser(data, requestingUser) {
  const config = await getSystemConfig();
  const { email, full_name, role, company_id, password } = data;

  // Validate required fields
  if (!email || !role || !company_id) {
    throw { status: 400, code: 'VALIDATION_ERROR', message: 'email, role and company_id are required' };
  }

  // Company admins can only create users in their own company
  if (!requestingUser.is_help_desk && company_id !== requestingUser.company_id) {
    throw { status: 403, code: 'FORBIDDEN', message: 'You can only create users in your own company' };
  }

  // Verify target company exists
  const companyResult = await query(
    'SELECT id, is_help_desk FROM companies WHERE id = $1',
    [company_id]
  );
  if (companyResult.rows.length === 0) {
    throw { status: 404, code: 'NOT_FOUND', message: 'Target company not found' };
  }

  const targetCompany = companyResult.rows[0];

  // Validate role against company type
  if (targetCompany.is_help_desk && role !== 'help_desk_agent') {
    throw {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Only help_desk_agent role is allowed in the help desk company',
    };
  }
  if (!targetCompany.is_help_desk && role === 'help_desk_agent') {
    throw {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'help_desk_agent role is only allowed in the help desk company',
    };
  }

  // Company admins cannot create other admins (only help desk can)
  if (requestingUser.role === 'admin' && role === 'admin' && !requestingUser.is_help_desk) {
    throw {
      status: 403,
      code: 'FORBIDDEN',
      message: 'Company admins cannot create other admin users',
    };
  }

  // Handle password for internal auth
  let passwordHash = null;
  let mustChangePassword = true;

  if (config.auth_mode === 'internal') {
    if (!password) {
      throw { status: 400, code: 'VALIDATION_ERROR', message: 'password is required for internal authentication' };
    }
    const policyCheck = validatePasswordPolicy(password, config);
    if (!policyCheck.valid) {
      throw { status: 400, code: 'PASSWORD_POLICY_VIOLATION', message: policyCheck.errors.join('. ') };
    }
    passwordHash = await hashPassword(password);
  }

  const result = await query(`
    INSERT INTO users (
      company_id, email, full_name, role,
      password_hash, must_change_password,
      password_changed_at, is_active
    )
    VALUES ($1, $2, $3, $4, $5, $6, NOW(), TRUE)
    RETURNING
      id, company_id, email, full_name, role,
      is_active, must_change_password, created_at
  `, [
    company_id,
    email.toLowerCase().trim(),
    full_name || null,
    role,
    passwordHash,
    mustChangePassword,
  ]);

  return result.rows[0];
}

/**
 * Update a user's details or role
 */
async function updateUser(id, data, requestingUser) {
  const targetUser = await getUser(id, requestingUser);

  // Users can update their own profile (name only)
  // Admins can update users in their company
  // Help desk can update anyone
  const isSelf = requestingUser.id === id;
  const canManage = requestingUser.is_help_desk ||
    (requestingUser.role === 'admin' && requestingUser.company_id === targetUser.company_id);

  if (!isSelf && !canManage) {
    throw { status: 403, code: 'FORBIDDEN', message: 'You do not have permission to update this user' };
  }

  const { full_name, role, is_active } = data;

  // Only admins and help desk can change roles or active status
  if ((role !== undefined || is_active !== undefined) && !canManage) {
    throw { status: 403, code: 'FORBIDDEN', message: 'You do not have permission to change role or status' };
  }

  // Validate new role if provided
  if (role !== undefined) {
    if (targetUser.is_help_desk && role !== 'help_desk_agent') {
      throw { status: 400, code: 'VALIDATION_ERROR', message: 'Help desk users must have help_desk_agent role' };
    }
    if (!targetUser.is_help_desk && role === 'help_desk_agent') {
      throw { status: 400, code: 'VALIDATION_ERROR', message: 'help_desk_agent role is only for the help desk company' };
    }
  }

  // Prevent deactivating yourself
  if (isSelf && is_active === false) {
    throw { status: 400, code: 'VALIDATION_ERROR', message: 'You cannot deactivate your own account' };
  }

  const updates = [];
  const params = [];
  let idx = 1;

  if (full_name !== undefined) { updates.push(`full_name = $${idx++}`); params.push(full_name); }
  if (role !== undefined)      { updates.push(`role = $${idx++}`);      params.push(role); }
  if (is_active !== undefined) { updates.push(`is_active = $${idx++}`); params.push(is_active); }

  if (updates.length === 0) {
    throw { status: 400, code: 'VALIDATION_ERROR', message: 'No fields to update' };
  }

  updates.push(`updated_at = NOW()`);
  params.push(id);

  const result = await query(`
    UPDATE users SET ${updates.join(', ')}
    WHERE id = $${idx}
    RETURNING
      id, company_id, email, full_name, role,
      is_active, must_change_password, last_seen_at,
      created_at, updated_at
  `, params);

  return result.rows[0];
}

/**
 * Deactivate a user (soft delete)
 */
async function deactivateUser(id, requestingUser) {
  const targetUser = await getUser(id, requestingUser);

  if (requestingUser.id === id) {
    throw { status: 400, code: 'VALIDATION_ERROR', message: 'You cannot deactivate your own account' };
  }

  const canManage = requestingUser.is_help_desk ||
    (requestingUser.role === 'admin' && requestingUser.company_id === targetUser.company_id);

  if (!canManage) {
    throw { status: 403, code: 'FORBIDDEN', message: 'You do not have permission to deactivate this user' };
  }

  await withTransaction(async (client) => {
    // Deactivate user
    await client.query(
      'UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1',
      [id]
    );
    // Revoke all active sessions
    await client.query(
      `UPDATE user_sessions SET revoked_at = NOW()
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [id]
    );
  });

  return { message: 'User deactivated successfully' };
}

/**
 * Reset a user's password (admin action — sets a temp password)
 */
async function resetUserPassword(id, newPassword, requestingUser) {
  const config = await getSystemConfig();
  const targetUser = await getUser(id, requestingUser);

  const canManage = requestingUser.is_help_desk ||
    (requestingUser.role === 'admin' && requestingUser.company_id === targetUser.company_id);

  if (!canManage) {
    throw { status: 403, code: 'FORBIDDEN', message: 'You do not have permission to reset this user\'s password' };
  }

  const policyCheck = validatePasswordPolicy(newPassword, config);
  if (!policyCheck.valid) {
    throw { status: 400, code: 'PASSWORD_POLICY_VIOLATION', message: policyCheck.errors.join('. ') };
  }

  const hash = await hashPassword(newPassword);

  await withTransaction(async (client) => {
    await client.query(`
      UPDATE users SET
        password_hash = $1,
        password_changed_at = NOW(),
        must_change_password = TRUE,
        updated_at = NOW()
      WHERE id = $2
    `, [hash, id]);

    // Revoke existing sessions so user must log in with new password
    await client.query(
      `UPDATE user_sessions SET revoked_at = NOW()
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [id]
    );
  });

  return { message: 'Password reset successfully. User must change password on next login.' };
}

module.exports = {
  listUsers,
  getUser,
  createUser,
  updateUser,
  deactivateUser,
  resetUserPassword,
};
