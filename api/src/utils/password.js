// src/utils/password.js
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 12;

/**
 * Hash a plain text password
 */
async function hashPassword(plainText) {
  return bcrypt.hash(plainText, SALT_ROUNDS);
}

/**
 * Compare a plain text password against a stored hash
 */
async function verifyPassword(plainText, hash) {
  return bcrypt.compare(plainText, hash);
}

/**
 * Validate a password against the system policy loaded from system_config.
 * Returns { valid: true } or { valid: false, errors: [...] }
 */
function validatePasswordPolicy(password, policy) {
  const errors = [];

  if (password.length < policy.password_min_length) {
    errors.push(`Password must be at least ${policy.password_min_length} characters long`);
  }

  if (policy.password_require_upper && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (policy.password_require_number && !/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (policy.password_require_special && !/[^A-Za-z0-9]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return errors.length === 0
    ? { valid: true }
    : { valid: false, errors };
}

/**
 * Check if a password has expired based on policy and last changed date
 */
function isPasswordExpired(passwordChangedAt, expiryDays) {
  if (!expiryDays || !passwordChangedAt) return false;
  const expiryMs = expiryDays * 24 * 60 * 60 * 1000;
  return Date.now() - new Date(passwordChangedAt).getTime() > expiryMs;
}

module.exports = {
  hashPassword,
  verifyPassword,
  validatePasswordPolicy,
  isPasswordExpired,
};
