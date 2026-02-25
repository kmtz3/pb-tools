/** ===========================================================
 * Centralized Error Handling for Notes Import/Export
 *
 * Provides consistent error handling, logging, and user messaging
 * across all Notes operations.
 * =========================================================== */

/**
 * Error severity levels
 */
const ErrorSeverity = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL'
};

/**
 * Error categories for better organization and debugging
 */
const ErrorCategory = {
  API: 'API',
  VALIDATION: 'VALIDATION',
  SHEET: 'SHEET',
  CONFIGURATION: 'CONFIGURATION',
  PARSING: 'PARSING',
  PERMISSION: 'PERMISSION'
};

/**
 * Standardized error object
 * @typedef {Object} StandardError
 * @property {string} severity - Error severity (INFO, WARNING, ERROR, CRITICAL)
 * @property {string} category - Error category
 * @property {string} message - Human-readable error message
 * @property {string} [details] - Additional error details
 * @property {string} [sheet] - Sheet name where error occurred
 * @property {number} [row] - Row number where error occurred
 * @property {string} [field] - Field name where error occurred
 * @property {Error} [originalError] - Original JavaScript error object
 * @property {string} timestamp - ISO timestamp
 */

/**
 * Create a standardized error object
 * @param {Object} options - Error options
 * @returns {StandardError} Standardized error object
 */
function createError_(options) {
  const {
    severity = ErrorSeverity.ERROR,
    category = ErrorCategory.ERROR,
    message,
    details,
    sheet,
    row,
    field,
    originalError
  } = options;

  return {
    severity,
    category,
    message,
    details: details || (originalError ? String(originalError) : undefined),
    sheet,
    row,
    field,
    originalError,
    timestamp: new Date().toISOString()
  };
}

/**
 * Handle API errors with retry logic and user-friendly messages
 * @param {Error} error - Original error
 * @param {string} operation - Operation being performed (e.g., 'fetch notes')
 * @param {Object} context - Additional context (noteId, etc.)
 * @returns {StandardError} Standardized error
 */
function handleApiError_(error, operation, context = {}) {
  const errorStr = String(error);
  let message = `API error during ${operation}`;
  let severity = ErrorSeverity.ERROR;

  // Parse HTTP status code if available
  const statusMatch = errorStr.match(/\b(4\d{2}|5\d{2})\b/);
  const statusCode = statusMatch ? parseInt(statusMatch[1]) : null;

  // Try to parse ProductBoard API JSON error response
  let parsedError = null;
  const jsonMatch = errorStr.match(/\{[\s\S]*"errors"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      parsedError = JSON.parse(jsonMatch[0]);
    } catch (e) {
      // If JSON parsing fails, continue with basic error handling
    }
  }

  if (statusCode) {
    switch (statusCode) {
      case 400:
        // Enhanced error message for validation errors
        if (parsedError && parsedError.errors && parsedError.errors.length > 0) {
          const firstError = parsedError.errors[0];
          const errorCode = firstError.code || '';
          const errorDetail = firstError.detail || '';
          const errorTitle = firstError.title || 'Bad request';
          const fieldPath = firstError.source && firstError.source.pointer ? firstError.source.pointer : '';

          // Extract field name from path (e.g., "/data/name" -> "name")
          const fieldMatch = fieldPath.match(/\/data\/([^\/]+)/);
          const fieldName = fieldMatch ? fieldMatch[1] : 'unknown field';

          if (errorCode === 'validation.error') {
            message = `Validation failed in '${fieldName}' field`;
            if (errorDetail && errorDetail.length < 200) {
              message += ` - ${errorDetail}`;
            }
          } else {
            // Other validation errors
            message = `${errorTitle} in '${fieldName}' field`;
            if (errorDetail && errorDetail.length < 200) {
              message += ` - ${errorDetail}`;
            }
          }
        } else {
          message = `Bad request during ${operation}. Check field values and format.`;
        }
        severity = ErrorSeverity.ERROR;
        break;
      case 401:
        message = `Authentication failed during ${operation}. Check API token.`;
        severity = ErrorSeverity.CRITICAL;
        break;
      case 403:
        message = `Permission denied during ${operation}. Check API token permissions.`;
        severity = ErrorSeverity.CRITICAL;
        break;
      case 404:
        message = `Resource not found during ${operation}. Note may have been deleted.`;
        severity = ErrorSeverity.WARNING;
        break;
      case 409:
        message = `Conflict during ${operation}. Note may already exist.`;
        severity = ErrorSeverity.WARNING;
        break;
      case 429:
        message = `Rate limit exceeded during ${operation}. Please wait and retry.`;
        severity = ErrorSeverity.WARNING;
        break;
      case 500:
      case 502:
      case 503:
        message = `Server error during ${operation}. Productboard API may be temporarily unavailable.`;
        severity = ErrorSeverity.ERROR;
        break;
      default:
        message = `HTTP ${statusCode} error during ${operation}`;
    }
  }

  return createError_({
    severity,
    category: ErrorCategory.API,
    message,
    details: errorStr,
    ...context,
    originalError: error
  });
}

/**
 * Handle validation errors
 * @param {string} message - Validation error message
 * @param {Object} context - Context (sheet, row, field, etc.)
 * @returns {StandardError} Standardized error
 */
function handleValidationError_(message, context = {}) {
  return createError_({
    severity: ErrorSeverity.ERROR,
    category: ErrorCategory.VALIDATION,
    message,
    ...context
  });
}

/**
 * Handle sheet operation errors
 * @param {Error} error - Original error
 * @param {string} operation - Operation being performed
 * @param {Object} context - Context (sheet name, etc.)
 * @returns {StandardError} Standardized error
 */
function handleSheetError_(error, operation, context = {}) {
  return createError_({
    severity: ErrorSeverity.ERROR,
    category: ErrorCategory.SHEET,
    message: `Sheet error during ${operation}`,
    details: String(error),
    ...context,
    originalError: error
  });
}

/**
 * Handle parsing/transformation errors
 * @param {Error} error - Original error
 * @param {string} operation - Operation being performed
 * @param {Object} context - Context (field, value, etc.)
 * @returns {StandardError} Standardized error
 */
function handleParsingError_(error, operation, context = {}) {
  return createError_({
    severity: ErrorSeverity.ERROR,
    category: ErrorCategory.PARSING,
    message: `Parsing error during ${operation}`,
    details: String(error),
    ...context,
    originalError: error
  });
}

/**
 * Log standardized error to Logger
 * @param {StandardError} error - Standardized error object
 */
function logError_(error) {
  const prefix = `[${error.severity}] [${error.category}]`;
  const location = error.sheet
    ? `${error.sheet}${error.row ? ':' + error.row : ''}${error.field ? ' field:' + error.field : ''}`
    : '';
  const message = `${prefix} ${error.message}${location ? ' at ' + location : ''}`;

  Logger.log(message);
  if (error.details) {
    Logger.log(`  Details: ${error.details}`);
  }
}

/**
 * Format error for user display (run log)
 * @param {StandardError} error - Standardized error object
 * @returns {Object} Object with sheet, row, status, msg for logging
 */
function formatErrorForLog_(error) {
  const statusMap = {
    [ErrorSeverity.INFO]: 'INFO',
    [ErrorSeverity.WARNING]: 'WARN',
    [ErrorSeverity.ERROR]: 'ERROR',
    [ErrorSeverity.CRITICAL]: 'ERROR'
  };

  return {
    sheet: error.sheet || '',
    row: error.row || '',
    status: statusMap[error.severity] || 'ERROR',
    msg: error.message + (error.field ? ` (field: ${error.field})` : '')
  };
}

/**
 * Try-catch wrapper with standardized error handling
 * @param {Function} fn - Function to execute
 * @param {Object} errorContext - Context for error creation
 * @returns {*} Function result or throws standardized error
 */
function tryCatch_(fn, errorContext) {
  try {
    return fn();
  } catch (error) {
    const standardError = createError_({
      severity: ErrorSeverity.ERROR,
      message: `Error in ${errorContext.operation || 'operation'}`,
      details: String(error),
      originalError: error,
      ...errorContext
    });
    logError_(standardError);
    throw standardError;
  }
}

/**
 * Safely execute a function and return result or error
 * Does not throw - returns {success, result, error}
 * @param {Function} fn - Function to execute
 * @param {Object} errorContext - Context for error creation
 * @returns {Object} { success: boolean, result?: any, error?: StandardError }
 */
function safeExecute_(fn, errorContext) {
  try {
    const result = fn();
    return { success: true, result };
  } catch (error) {
    const standardError = createError_({
      severity: ErrorSeverity.ERROR,
      message: `Error in ${errorContext.operation || 'operation'}`,
      details: String(error),
      originalError: error,
      ...errorContext
    });
    logError_(standardError);
    return { success: false, error: standardError };
  }
}
