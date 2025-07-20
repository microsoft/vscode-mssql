/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

/**
 * Enhanced logging utility for build scripts
 * Provides consistent, colored terminal output with meaningful icons
 */
const logger = {
  /**
   * Log informational messages (blue info icon)
   * @param {string} message - The message to log
   */
  info: (message) => console.log(`${colors.blue}ℹ${colors.reset} ${message}`),

  /**
   * Log success messages (green checkmark)
   * @param {string} message - The message to log
   */
  success: (message) => console.log(`${colors.green}✓${colors.reset} ${message}`),

  /**
   * Log warning messages (yellow warning icon)
   * @param {string} message - The message to log
   */
  warning: (message) => console.log(`${colors.yellow}⚠${colors.reset} ${message}`),

  /**
   * Log error messages (red X icon)
   * @param {string} message - The message to log
   */
  error: (message) => console.log(`${colors.red}✗${colors.reset} ${message}`),

  /**
   * Log process step messages (cyan arrow with bold text)
   * @param {string} message - The message to log
   */
  step: (message) => console.log(`${colors.cyan}▶${colors.reset} ${colors.bright}${message}${colors.reset}`),

  /**
   * Log debug messages (magenta dot)
   * @param {string} message - The message to log
   */
  debug: (message) => console.log(`${colors.magenta}●${colors.reset} ${message}`),

  /**
   * Log a separator line for visual organization
   */
  separator: () => console.log(`${colors.cyan}${'─'.repeat(60)}${colors.reset}`),

  /**
   * Log a header with separator lines above and below
   * @param {string} title - The header title
   */
  header: (title) => {
    logger.separator();
    console.log(`${colors.cyan}${colors.bright}  ${title}${colors.reset}`);
    logger.separator();
  },

  /**
   * Log a blank line for spacing
   */
  newline: () => console.log('')
};

module.exports = logger;