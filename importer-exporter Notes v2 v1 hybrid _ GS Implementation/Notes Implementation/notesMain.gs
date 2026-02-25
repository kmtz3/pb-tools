/** ===========================================================
 * Notes Import/Export Tool - Main Logic (Foundation)
 *
 * This file contains the foundational code for Notes import/export:
 * - Constants and configuration
 * - UI menus
 * - Authentication and API communication (v1 and v2)
 * - Rate limiting with adaptive throttling
 * - Configuration caching
 * - Shared utilities
 *
 * Notes-specific export logic is in notesExporter.gs
 * Notes-specific import logic is in notesImporter.gs
 * =========================================================== */

/** =========================
 *  SHARED CONSTANTS
 * ========================= */

// Productboard API v1 configuration for Notes
const PB_NOTES_V1 = {
  VERSION: '1',
  LIST_NOTES: '/notes',
  GET_NOTE: '/notes/{id}',
  CREATE_NOTE: '/notes',
  UPDATE_NOTE: '/notes/{id}',
  DELETE_NOTE: '/notes/{id}',
  LIST_USERS: '/users',
  GET_USER: '/users/{id}',
  LIST_COMPANIES: '/companies',
  GET_COMPANY: '/companies/{id}'
};

// Productboard API v2 configuration for Notes
const PB_NOTES_V2 = {
  LIST_NOTES: '/v2/notes',
  GET_NOTE: '/v2/notes/{id}',
  UPDATE_NOTE: '/v2/notes/{id}',
  DELETE_NOTE: '/v2/notes/{id}',
  GET_RELATIONSHIPS: '/v2/notes/{id}/relationships',
  CREATE_RELATIONSHIP: '/v2/notes/{id}/relationships',
  DELETE_RELATIONSHIP: '/v2/notes/{id}/relationships/{targetType}/{targetId}'
};

/**
 * Gets the appropriate API base URL based on datacenter setting
 * @returns {string} The base URL (US or EU datacenter)
 */
function getApiBaseUrl_() {
  const props = PropertiesService.getScriptProperties();
  const useEuDatacenter = props.getProperty('USE_EU_DATACENTER') === 'true';
  return useEuDatacenter ? 'https://api.eu.productboard.com' : 'https://api.productboard.com';
}

// Three-row header layout
const HEADER_ROWS = 3;

// Sheet names
const NOTES_SHEET = '📝 Notes';
const RUN_LOG_SHEET = '🧾 Run Log';
const EXPORT_CACHE_SHEET = '_ExportCache';  // Temporary sheet for export caches

// Configuration cache TTL in seconds (6 hours = 21600 seconds)
const CONFIG_CACHE_TTL = 21600;

// Batching Thresholds
const BATCH_THRESHOLD_EXPORT = 1000;
const BATCH_THRESHOLD_IMPORT = 100;
const CHUNK_SIZE_EXPORT = 200;
const CHUNK_SIZE_IMPORT = 50;
const RELATIONSHIP_FETCH_BATCH_SIZE = 5;

// Validation Patterns
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_PATTERN = /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/i;

// Note base fields (non-custom)
const NOTE_BASE_FIELDS = [
  'pb_id',              // Productboard internal ID
  'ext_id',             // External ID (maps to source.record_id)
  'type',               // Note type (simple, conversation, opportunity)
  'title',              // Note title (required)
  'content',            // Note content
  'display_url',        // Display URL
  'user_email',         // User email for relationship
  'company_domain',     // Company domain for relationship
  'owner_email',        // Owner email
  'creator_email',      // Creator email
  'tags',               // Comma-separated tags
  'source_origin',      // Source origin
  'source_record_id',   // Source record ID
  'archived',           // Archived status (boolean)
  'processed'           // Processed status (boolean)
];

/** =========================
 *  UI MENU
 * ========================= */

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🚀 PB Notes')
    .addItem('📊 Open Notes panel', 'showNotesSidebar')
    .addToUi();
}

/** =========================
 *  AUTHENTICATION
 * ========================= */

/**
 * Get the Productboard API token from Script Properties.
 * @returns {string} API token or empty string
 */
function getApiToken_() {
  const p = PropertiesService.getScriptProperties();
  return p.getProperty('PB_API_TOKEN') || '';
}

/**
 * Mask API token for display (show first 5 and last 5 chars).
 * @param {string} token - Full token
 * @returns {string} Masked token
 */
function maskToken_(token) {
  if (!token || token.length < 15) return '***';
  return token.substring(0, 5) + '***' + token.substring(token.length - 5);
}

/**
 * Get workspace name from Script Properties.
 * @returns {string} Workspace name or empty string
 */
function getWorkspaceName_() {
  const p = PropertiesService.getScriptProperties();
  return p.getProperty('WORKSPACE_NAME') || '';
}

/** =========================
 *  HTTP & RATE LIMITING
 * ========================= */

// Global rate limiter state (shared across all requests)
const RATE_LIMITER = {
  lastRequestTime: 0,
  requestCount: 0,
  resetTime: 0,
  remaining: null,
  limit: 50,  // Default: 50 requests per second
  minDelay: 20  // Minimum 20ms between requests (allows 50/sec)
};

/**
 * Make an HTTP request to Productboard API (v1 or v2) with authentication and rate limiting.
 * @param {string} method - HTTP method (get, post, patch, put, delete)
 * @param {string} path - API path (absolute or relative)
 * @param {object} body - Request body (will be JSON stringified)
 * @param {object} customHeaders - Additional headers to include
 * @returns {object} Parsed JSON response
 * @throws {Error} If request fails
 */
function pbFetch_(method, path, body, customHeaders) {
  const token = getApiToken_();
  if (!token) {
    throw new Error('Missing Productboard API token. Configure token in Settings.');
  }

  // Apply throttling before making request
  throttleRequest_();

  const isV2 = path.startsWith('/v2/');
  const url = absoluteUrl_(path);

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    ...(customHeaders || {})
  };

  // Add X-Version header only for v1
  if (!isV2) {
    headers['X-Version'] = '1';
  }

  const opt = {
    method,
    muteHttpExceptions: true,
    headers
  };

  if (body !== undefined) opt.payload = JSON.stringify(body);

  const res = UrlFetchApp.fetch(url, opt);
  const code = res.getResponseCode();
  const txt = res.getContentText() || '';

  // Update rate limiter state from response headers
  updateRateLimitState_(res);

  if (code >= 200 && code < 300) return txt ? JSON.parse(txt) : {};

  // Include Retry-After header in error for better retry handling
  const responseHeaders = res.getHeaders();
  const retryAfter = responseHeaders['retry-after'] || responseHeaders['Retry-After'];
  const error = new Error(`PB ${method} ${url} → ${code}: ${txt}`);
  if (retryAfter) error.retryAfter = parseInt(retryAfter, 10);
  throw error;
}

/**
 * Throttle requests to stay within rate limits.
 * Implements smart throttling based on remaining quota and time since last request.
 */
function throttleRequest_() {
  const now = Date.now();
  const timeSinceLastRequest = now - RATE_LIMITER.lastRequestTime;

  // Calculate delay needed based on rate limit state
  let delay = RATE_LIMITER.minDelay;

  // If we know we're running low on quota, slow down more aggressively
  if (RATE_LIMITER.remaining !== null && RATE_LIMITER.remaining < 10) {
    // When under 10 requests remaining, add extra delay
    delay = Math.max(100, RATE_LIMITER.minDelay * 5);
    Logger.log(`Rate limit low (${RATE_LIMITER.remaining} remaining), throttling to ${delay}ms`);
  } else if (RATE_LIMITER.remaining !== null && RATE_LIMITER.remaining < 20) {
    // When under 20 requests remaining, double the delay
    delay = RATE_LIMITER.minDelay * 2;
  }

  // Ensure minimum delay between requests
  if (timeSinceLastRequest < delay) {
    const sleepTime = delay - timeSinceLastRequest;
    Utilities.sleep(sleepTime);
  }

  RATE_LIMITER.lastRequestTime = Date.now();
  RATE_LIMITER.requestCount++;
}

/**
 * Update rate limiter state from API response headers.
 * @param {HTTPResponse} response - The HTTP response object
 */
function updateRateLimitState_(response) {
  const headers = response.getHeaders();

  // Read rate limit headers - Productboard uses these formats:
  // - ratelimit-limit, ratelimit-remaining, ratelimit-reset (general)
  // - x-ratelimit-limit-second, x-ratelimit-remaining-second (per-second)
  const limit = headers['ratelimit-limit'] ||
                headers['x-ratelimit-limit-second'] ||
                headers['X-RateLimit-Limit'];

  const remaining = headers['ratelimit-remaining'] ||
                    headers['x-ratelimit-remaining-second'] ||
                    headers['X-RateLimit-Remaining'];

  if (limit) {
    RATE_LIMITER.limit = parseInt(limit, 10);
  }

  if (remaining !== undefined && remaining !== null) {
    RATE_LIMITER.remaining = parseInt(remaining, 10);

    // Log when we're getting close to the limit
    if (RATE_LIMITER.remaining < 10 && RATE_LIMITER.requestCount % 5 === 0) {
      Logger.log(`Rate limit warning: ${RATE_LIMITER.remaining}/${RATE_LIMITER.limit} requests remaining`);
    }
  }
}

/**
 * Reset rate limiter state.
 * Call this at the start of large batch operations to ensure fresh tracking.
 */
function resetRateLimiter_() {
  RATE_LIMITER.lastRequestTime = 0;
  RATE_LIMITER.requestCount = 0;
  RATE_LIMITER.resetTime = 0;
  RATE_LIMITER.remaining = null;
  Logger.log('Rate limiter state reset');
}

/**
 * Get current rate limiter statistics.
 * Useful for debugging and monitoring.
 * @returns {object} Rate limiter state
 */
function getRateLimiterStats_() {
  return {
    requestCount: RATE_LIMITER.requestCount,
    remaining: RATE_LIMITER.remaining,
    limit: RATE_LIMITER.limit,
    minDelay: RATE_LIMITER.minDelay
  };
}

/**
 * Convert relative or absolute path to absolute URL.
 * @param {string} path - API path
 * @returns {string} Absolute URL
 */
function absoluteUrl_(path) {
  const baseUrl = getApiBaseUrl_();
  if (!path) return baseUrl;
  if (/^https?:\/\//i.test(path)) return path;
  if (!path.startsWith('/')) path = '/' + path;
  return baseUrl + path;
}

/**
 * Retry a function with exponential backoff on 429/5xx errors.
 * Respects Retry-After header from API when available.
 * @param {function} fn - Function to retry
 * @param {string} label - Label for logging
 * @returns {*} Return value of fn
 * @throws {Error} If all retries fail
 */
function pbCallWithRetry_(fn, label) {
  const max = 6;
  for (let i = 0; i < max; i++) {
    try {
      return fn();
    } catch (e) {
      const m = String(e);
      const is429 = / 429: /.test(m);
      const is5xx = / (\b5\d{2}\b): /.test(m);
      const isBandwidthQuota = m.includes('Bandwidth quota exceeded');
      const retryable = is429 || is5xx || isBandwidthQuota;

      if (!retryable || i === max - 1) throw e;

      // Use Retry-After header if available (from 429 responses)
      let delay;
      if (isBandwidthQuota) {
        delay = 10000; // 10s pause for GAS bandwidth quota
        Logger.log(`${label}: GAS bandwidth quota exceeded, waiting 10s (attempt ${i + 1}/${max})`);
      } else if (e.retryAfter && is429) {
        // API told us exactly how long to wait (in seconds)
        delay = e.retryAfter * 1000;
        Logger.log(`${label}: Rate limited (429). Respecting Retry-After: ${e.retryAfter}s`);
      } else {
        // Use exponential backoff for other retryable errors
        delay = Math.floor((Math.pow(2, i) * 250) + Math.random() * 200);
        if (is429) {
          Logger.log(`${label}: Rate limited (429, no Retry-After). Using backoff: ${delay}ms`);
        }
      }

      Utilities.sleep(delay);
    }
  }
}

/**
 * Check if an error is a 404 not found error.
 * @param {Error} err - Error to check
 * @returns {boolean} True if not found
 */
function isNotFoundError_(err) {
  const msg = String(err);
  return / 404: /.test(msg);
}

/**
 * Check if an error is a 409 conflict error (duplicate).
 * @param {Error} err - Error to check
 * @returns {boolean} True if conflict
 */
function isConflictError_(err) {
  const msg = String(err);
  return / 409: /.test(msg);
}

/**
 * Check if a note exists by ID.
 * @param {string} noteId - Note UUID
 * @returns {boolean} True if note exists
 */
function noteExists_(noteId) {
  try {
    pbFetch_('get', `/notes/${noteId}`);
    return true;
  } catch (e) {
    if (isNotFoundError_(e)) return false;
    throw e;
  }
}

/** =========================
 *  CONFIGURATION CACHING
 * ========================= */

/**
 * Clear configuration cache.
 */
function clearConfigCache_() {
  const cache = CacheService.getScriptCache();
  cache.remove('notes_config');
  cache.remove('notes_users');
  Logger.log('Configuration cache cleared');
  return { success: true, message: 'Configuration cache cleared' };
}

/** =========================
 *  SETTINGS MANAGEMENT
 * ========================= */

/**
 * Get all settings for display in UI.
 * @returns {object} Settings object
 */
function getSettings_() {
  const props = PropertiesService.getScriptProperties();
  const token = getApiToken_();
  const workspaceName = getWorkspaceName_();
  const useEuDatacenter = props.getProperty('USE_EU_DATACENTER') === 'true';
  const migrationFieldUuid = props.getProperty('MIGRATION_FIELD_UUID') || '';

  return {
    tokenMasked: maskToken_(token),
    hasToken: !!token,
    workspaceName: workspaceName,
    useEuDatacenter: useEuDatacenter,
    migrationFieldUuid: migrationFieldUuid
  };
}

/**
 * Save settings from UI.
 * @param {object} settings - Settings to save
 * @returns {object} Result
 */
function saveSettings_(settings) {
  const props = PropertiesService.getScriptProperties();

  if (typeof settings.token === 'string' && settings.token.trim()) {
    props.setProperty('PB_API_TOKEN', settings.token.trim());
  }

  if (typeof settings.workspaceName === 'string') {
    if (settings.workspaceName.trim()) {
      props.setProperty('WORKSPACE_NAME', settings.workspaceName.trim());
    } else {
      props.deleteProperty('WORKSPACE_NAME');
    }
  }

  if ('useEuDatacenter' in settings) {
    if (settings.useEuDatacenter === true) {
      props.setProperty('USE_EU_DATACENTER', 'true');
    } else {
      props.deleteProperty('USE_EU_DATACENTER');
    }
  }

  // Clear cache when settings change
  clearConfigCache_();

  return { success: true, message: 'Settings saved successfully' };
}

/**
 * Reset all settings to defaults.
 * @returns {object} Result
 */
function resetSettings_() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('PB_API_TOKEN');
  props.deleteProperty('WORKSPACE_NAME');
  props.deleteProperty('USE_EU_DATACENTER');
  clearConfigCache_();
  return { success: true, message: 'All settings reset to defaults' };
}

/** =========================
 *  UTILITY FUNCTIONS
 * ========================= */

/**
 * Get or create the Notes sheet.
 * @returns {Sheet} Notes sheet
 */
function getOrCreateNotesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(NOTES_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(NOTES_SHEET);
  }
  return sheet;
}

/**
 * Get or create the Run Log sheet.
 * @returns {Sheet} Run Log sheet
 */
function getOrCreateRunLogSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(RUN_LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(RUN_LOG_SHEET);
    // Set up headers
    sheet.getRange(1, 1, 1, 6).setValues([['Timestamp', 'Entity', 'Row', 'Status', 'Message', 'Details']]);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#f0f0f0');
  }
  return sheet;
}

/**
 * Log a message to the Run Log sheet.
 * @param {string} entity - Entity type (e.g., 'Notes')
 * @param {number} row - Row number (if applicable)
 * @param {string} status - Status (INFO, SUCCESS, WARNING, ERROR)
 * @param {string} message - Message
 * @param {string} details - Additional details
 */
function logToRunLog_(entity, row, status, message, details) {
  try {
    const sheet = getOrCreateRunLogSheet_();
    const timestamp = new Date().toLocaleString();
    const rowData = [timestamp, entity, row || '', status, message, details || ''];
    sheet.appendRow(rowData);
  } catch (e) {
    Logger.log('Failed to write to Run Log: ' + e);
  }
}

/**
 * Clear the Run Log sheet.
 */
function clearRunLog_() {
  const sheet = getOrCreateRunLogSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 6).clearContent();
    // Also clear formatting
    sheet.getRange(2, 1, lastRow - 1, 6).setBackground(null);
  }
}

/**
 * Format the Run Log sheet with color coding based on status.
 * Colors: INFO (blue), SUCCESS (green), WARN (yellow), ERROR (red)
 * This is done in ONE efficient write operation.
 */
function formatRunLog_() {
  const sheet = getOrCreateRunLogSheet_();
  const lastRow = sheet.getLastRow();

  // Skip if only header row or empty
  if (lastRow <= 1) return;

  const numRows = lastRow - 1; // Exclude header
  const numCols = 6;

  // Read all data at once (excluding header)
  const dataRange = sheet.getRange(2, 1, numRows, numCols);
  const data = dataRange.getValues();

  // Create a 2D array of background colors
  const backgrounds = data.map(row => {
    const status = String(row[3]).toUpperCase(); // Column D (index 3) is status
    let color;

    switch (status) {
      case 'INFO':
        color = '#d0e1f9'; // Light blue
        break;
      case 'SUCCESS':
        color = '#d9ead3'; // Light green
        break;
      case 'WARN':
      case 'WARNING':
        color = '#fff2cc'; // Light yellow
        break;
      case 'ERROR':
        color = '#f4cccc'; // Light red
        break;
      default:
        color = '#ffffff'; // White (no color)
    }

    // Return array of same color for all columns in this row
    return [color, color, color, color, color, color];
  });

  // Apply all backgrounds in ONE write operation
  dataRange.setBackgrounds(backgrounds);

  Logger.log(`Formatted ${numRows} rows in Run Log with color coding`);
}
