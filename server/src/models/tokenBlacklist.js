/**
 * Token Blacklist - In-Memory Implementation
 * For production, use Redis for distributed systems
 */

// In-memory Set to store blacklisted tokens
const blacklist = new Set();

/**
 * Add token to blacklist
 * @param {string} token - JWT token to blacklist
 */
const addToBlacklist = (token) => {
  blacklist.add(token);
  console.log('🚫 Token added to blacklist');
};

/**
 * Check if token is blacklisted
 * @param {string} token - JWT token to check
 * @returns {boolean} - true if blacklisted
 */
const isBlacklisted = (token) => {
  return blacklist.has(token);
};

/**
 * Remove token from blacklist (optional - for token expiration cleanup)
 * @param {string} token - JWT token to remove
 */
const removeFromBlacklist = (token) => {
  blacklist.delete(token);
  console.log('✅ Token removed from blacklist');
};

/**
 * Get blacklist size (for monitoring)
 * @returns {number} - number of blacklisted tokens
 */
const getBlacklistSize = () => {
  return blacklist.size;
};

/**
 * Clear all blacklisted tokens (for testing/maintenance)
 */
const clearBlacklist = () => {
  blacklist.clear();
  console.log('🗑️ Blacklist cleared');
};

module.exports = {
  addToBlacklist,
  isBlacklisted,
  removeFromBlacklist,
  getBlacklistSize,
  clearBlacklist,
};
