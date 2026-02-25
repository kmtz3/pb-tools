/** ===========================================================
 * Notes Import/Export Tool - Import & Sheet Management
 *
 * This file contains:
 * - Sheet setup and management functions
 * - Header generation (3-row format)
 * - Data validation functions
 * - Import workflow (v1 API + v2 status backfill)
 * - Note matching logic
 * - User email validation
 * =========================================================== */

/** =========================
 *  SHEET SETUP & MANAGEMENT
 * ========================= */

/**
 * Build the 3-row header structure for Notes sheet
 * @returns {Object} Object with row1Keys, row2Labels, row3Types arrays
 */
function buildNotesHeaders_() {
  const baseFields = [
    { key: 'pb_id', label: 'PB Note ID', type: 'id' },
    { key: 'ext_id', label: 'External ID (for matching)', type: 'text' },
    { key: 'type', label: 'Note Type', type: 'select' },
    { key: 'title', label: 'Title', type: 'text *' },
    { key: 'content', label: 'Content', type: 'text *' },
    { key: 'display_url', label: 'Display URL', type: 'url' },
    { key: 'user_email', label: 'User Email', type: 'email' },
    { key: 'company_domain', label: 'Company Domain', type: 'domain' },
    { key: 'owner_email', label: 'Owner Email', type: 'email' },
    { key: 'creator_email', label: 'Creator Email', type: 'email' },
    { key: 'tags', label: 'Tags (comma-separated)', type: 'array' },
    { key: 'source_origin', label: 'Source Origin', type: 'text' },
    { key: 'source_record_id', label: 'Source Record ID', type: 'text' },
    { key: 'archived', label: 'Archived', type: 'boolean' },
    { key: 'processed', label: 'Processed', type: 'boolean' },
    { key: 'linked_entities', label: 'Linked Entities (comma-separated UUIDs)', type: 'text' }
  ];

  const row1Keys = baseFields.map(f => f.key);
  const row2Labels = baseFields.map(f => f.label);
  const row3Types = baseFields.map(f => f.type);

  return { row1Keys, row2Labels, row3Types };
}

/**
 * Set up the Notes sheet with 3-row headers
 * @param {boolean} forceRefresh - Force refresh even if sheet exists
 * @returns {Object} Result object with success status and message
 */
function SetupNotesSheet_(forceRefresh) {
  try {
    BatchQueue_setSubProgress('Building sheet structure...', 10);

    const sheet = getOrCreateNotesSheet_();
    const headers = buildNotesHeaders_();

    // Preserve existing data if force refresh
    let existingData = null;
    if (forceRefresh && sheet.getLastRow() > HEADER_ROWS) {
      BatchQueue_setSubProgress('Preserving existing data...', 20);
      const dataStartRow = HEADER_ROWS + 1;
      const dataRows = sheet.getLastRow() - HEADER_ROWS;
      const dataCols = sheet.getLastColumn();

      if (dataRows > 0 && dataCols > 0) {
        existingData = sheet.getRange(dataStartRow, 1, dataRows, dataCols).getValues();
        Logger.log(`Preserved ${dataRows} rows of existing data`);
      }
    }

    // Clear existing headers and formatting if force refresh
    if (forceRefresh && sheet.getLastRow() > 0) {
      // Only clear the header rows, not the data
      if (sheet.getLastRow() >= HEADER_ROWS) {
        sheet.getRange(1, 1, HEADER_ROWS, sheet.getMaxColumns()).clear();
      }
    }

    // Ensure minimum rows
    if (sheet.getMaxRows() < HEADER_ROWS) {
      sheet.insertRows(1, HEADER_ROWS - sheet.getMaxRows());
    }
    sheet.setFrozenRows(HEADER_ROWS);

    BatchQueue_setSubProgress('Writing headers...', 40);

    // Write headers
    const numCols = headers.row1Keys.length;
    sheet.getRange(1, 1, 1, numCols).setValues([headers.row1Keys]);
    sheet.getRange(2, 1, 1, numCols).setValues([headers.row2Labels]);
    sheet.getRange(3, 1, 1, numCols).setValues([headers.row3Types]);

    BatchQueue_setSubProgress('Applying formatting...', 50);

    applyHeaderFormatting_(sheet, numCols);
    protectHeaderRows_(sheet);

    // Add data validation for type column (column C)
    const typeColumn = 3; // Column C (1-indexed)
    const maxRows = sheet.getMaxRows();
    if (maxRows > HEADER_ROWS) {
      const typeRange = sheet.getRange(HEADER_ROWS + 1, typeColumn, maxRows - HEADER_ROWS, 1);
      const typeRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(['simple', 'conversation', 'opportunity'], true)
        .setAllowInvalid(false)
        .setHelpText('Select note type: simple, conversation, or opportunity')
        .build();
      typeRange.setDataValidation(typeRule);
    }

    // Restore preserved data
    if (existingData && existingData.length > 0) {
      BatchQueue_setSubProgress('Restoring data...', 80);
      const dataStartRow = HEADER_ROWS + 1;
      const dataRows = existingData.length;
      const dataCols = existingData[0].length;

      // Ensure we have enough columns in the sheet
      const colsNeeded = Math.max(numCols, dataCols);
      if (sheet.getMaxColumns() < colsNeeded) {
        sheet.insertColumnsAfter(sheet.getMaxColumns(), colsNeeded - sheet.getMaxColumns());
      }

      // Write data back
      sheet.getRange(dataStartRow, 1, dataRows, dataCols).setValues(existingData);
      Logger.log(`Restored ${dataRows} rows of data`);
    }

    BatchQueue_setSubProgress('Sheet setup complete', 100);

    const message = existingData
      ? `Notes sheet refreshed with ${numCols} columns. ${existingData.length} rows of data preserved.`
      : `Notes sheet ready with ${numCols} columns.`;

    return {
      success: true,
      message: message
    };
  } catch (err) {
    Logger.log('Error setting up Notes sheet: ' + err);
    throw err;
  }
}

/**
 * Apply formatting to header rows
 * @param {Sheet} sheet - The sheet to format
 * @param {number} numCols - Number of columns
 */
function applyHeaderFormatting_(sheet, numCols) {
  // Row 1: Machine keys (light gray background, small font)
  const row1Range = sheet.getRange(1, 1, 1, numCols);
  row1Range.setBackground('#e8e8e8')
    .setFontSize(9)
    .setFontColor('#666666')
    .setFontWeight('normal')
    .setVerticalAlignment('middle');

  // Row 2: Human labels (dark background, bold, white text)
  const row2Range = sheet.getRange(2, 1, 1, numCols);
  row2Range.setBackground('#4a86e8')
    .setFontWeight('bold')
    .setFontColor('#ffffff')
    .setVerticalAlignment('middle');

  // Row 3: Field types (light blue background, italic)
  const row3Range = sheet.getRange(3, 1, 1, numCols);
  row3Range.setBackground('#c9daf8')
    .setFontStyle('italic')
    .setFontSize(9)
    .setFontColor('#666666')
    .setVerticalAlignment('middle');

  // Set column widths for better readability
  sheet.setColumnWidth(1, 280);  // pb_id (UUID)
  sheet.setColumnWidth(2, 150);  // ext_id
  sheet.setColumnWidth(3, 100);  // type
  sheet.setColumnWidth(4, 250);  // title
  sheet.setColumnWidth(5, 300);  // content
  sheet.setColumnWidth(6, 200);  // display_url
  sheet.setColumnWidth(7, 200);  // user_email
  sheet.setColumnWidth(8, 200);  // company_domain
  sheet.setColumnWidth(9, 200);  // owner_email
  sheet.setColumnWidth(10, 200); // creator_email
  sheet.setColumnWidth(11, 200); // tags
  sheet.setColumnWidth(12, 150); // source_origin
  sheet.setColumnWidth(13, 150); // source_record_id
  sheet.setColumnWidth(14, 80);  // archived
  sheet.setColumnWidth(15, 80);  // processed

  // Auto-resize rows for better readability
  sheet.setRowHeights(1, 3, 25);
}

/**
 * Protect header rows from editing
 * @param {Sheet} sheet - The sheet to protect
 */
function protectHeaderRows_(sheet) {
  try {
    // Remove existing protections on header rows
    const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
    protections.forEach(protection => {
      const range = protection.getRange();
      if (range.getRow() <= HEADER_ROWS) {
        protection.remove();
      }
    });

    // Protect the header rows
    const headerRange = sheet.getRange(1, 1, HEADER_ROWS, sheet.getMaxColumns());
    const protection = headerRange.protect().setDescription('Header rows (protected)');

    // Ensure the current user can edit (but others cannot)
    if (protection.canDomainEdit()) {
      protection.setDomainEdit(false);
    }

    // Allow all editors of the sheet to edit the rest
    const me = Session.getEffectiveUser();
    protection.addEditor(me);
    protection.removeEditors(protection.getEditors());
    if (protection.canDomainEdit()) {
      protection.setDomainEdit(false);
    }

    Logger.log('Header rows protected successfully');
  } catch (err) {
    Logger.log('Warning: Could not protect header rows: ' + err);
    // Non-fatal error, continue
  }
}

/**
 * Read data from Notes sheet and parse into objects
 * @param {Sheet} sheet - The Notes sheet
 * @returns {Array<Object>} Array of note objects with _row property
 */
function readNotesSheet_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= HEADER_ROWS) {
    Logger.log('No data rows found in Notes sheet');
    return [];
  }

  const lastCol = sheet.getLastColumn();
  const headerKeys = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const dataValues = sheet.getRange(HEADER_ROWS + 1, 1, lastRow - HEADER_ROWS, lastCol).getValues();

  const notes = dataValues.map((row, index) => {
    const obj = { _row: HEADER_ROWS + 1 + index };
    headerKeys.forEach((key, colIndex) => {
      if (key) {
        const value = row[colIndex];
        // Convert empty strings to null for cleaner processing
        obj[key] = (value === '' || value === null || value === undefined) ? null : value;
      }
    });
    return obj;
  }).filter(obj => obj.title || obj.pb_id); // Skip completely empty rows

  Logger.log(`Read ${notes.length} note rows from sheet`);
  return notes;
}

/**
 * Delete the Notes sheet
 * @returns {Object} Result object
 */
function deleteNotesSheet_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(NOTES_SHEET);

    if (!sheet) {
      return {
        success: false,
        message: 'Notes sheet does not exist.'
      };
    }

    // Prevent deletion if it's the only sheet
    if (ss.getSheets().length === 1) {
      return {
        success: false,
        message: 'Cannot delete the only sheet in the spreadsheet.'
      };
    }

    ss.deleteSheet(sheet);
    Logger.log('Notes sheet deleted');

    return {
      success: true,
      message: 'Notes sheet deleted successfully.'
    };
  } catch (err) {
    Logger.log('Error deleting Notes sheet: ' + err);
    return {
      success: false,
      message: `Failed to delete Notes sheet: ${err.message || err}`
    };
  }
}

/** =========================
 *  VALIDATION FUNCTIONS
 * ========================= */

/**
 * Validate notes data before import (dry-run)
 * @returns {Object} Validation result with errors, warnings, and summary
 */
function ValidateNotes_() {
  clearRunLog_();
  logToRunLog_('Notes', null, 'INFO', 'Starting validation (dry-run)...', '');

  const sheet = getOrCreateNotesSheet_();
  const data = readNotesSheet_(sheet);

  const result = {
    errors: 0,
    warnings: 0,
    autoFixed: 0,
    totalRows: data.length,
    success: true
  };

  if (data.length === 0) {
    result.summary = 'No data rows to validate';
    logToRunLog_('Notes', null, 'INFO', result.summary, '');
    return result;
  }

  const extIdsSeen = new Set();
  const pbIdsSeen = new Set();
  const sourceOriginCounters = {}; // Track counters per source_origin
  const rowsWithErrors = []; // Track rows that have errors
  const rowsWithWarnings = []; // Track rows that have warnings (but no errors)

  data.forEach((row, index) => {
    const rowNum = row._row;
    const errors = [];
    const warnings = [];

    // Required fields
    if (!row.title || String(row.title).trim() === '') {
      errors.push('Title is required');
    }

    // Content is required and must not be empty (v1 API requirement)
    if (!row.content || String(row.content).trim() === '') {
      errors.push('Content is required and cannot be empty');
    }

    // Format validation
    if (row.pb_id && !UUID_PATTERN.test(row.pb_id)) {
      errors.push('pb_id must be a valid UUID');
    }

    if (row.user_email && !EMAIL_PATTERN.test(row.user_email)) {
      errors.push('user_email must be a valid email');
    }

    if (row.owner_email && !EMAIL_PATTERN.test(row.owner_email)) {
      errors.push('owner_email must be a valid email');
    }

    if (row.creator_email && !EMAIL_PATTERN.test(row.creator_email)) {
      errors.push('creator_email must be a valid email');
    }

    if (row.company_domain && !DOMAIN_PATTERN.test(row.company_domain)) {
      errors.push('company_domain must be a valid domain');
    }

    if (row.type && !['simple', 'conversation', 'opportunity'].includes(row.type)) {
      errors.push('type must be "simple", "conversation", or "opportunity"');
    }

    // Auto-fix display_url protocol
    if (row.display_url && String(row.display_url).trim()) {
      const url = String(row.display_url).trim();
      if (!/^https?:\/\//i.test(url)) {
        const fixedUrl = 'https://' + url;
        // Find column index for display_url
        const headerKeys = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
        const displayUrlCol = headerKeys.indexOf('display_url') + 1;
        if (displayUrlCol > 0) {
          sheet.getRange(rowNum, displayUrlCol).setValue(fixedUrl);
          row.display_url = fixedUrl;
          result.autoFixed++;
          logToRunLog_('Notes', rowNum, 'INFO', `Auto-fixed display_url: added https:// prefix`, `${url} → ${fixedUrl}`);
        }
      }
    }

    // Auto-generate source_record_id if missing
    const hasOrigin = row.source_origin && String(row.source_origin).trim();
    const hasRecordId = row.source_record_id && String(row.source_record_id).trim();

    if (hasOrigin && !hasRecordId) {
      const origin = String(row.source_origin).trim();

      // Initialize counter for this origin if not exists
      if (!sourceOriginCounters[origin]) {
        sourceOriginCounters[origin] = 1;
      }

      // Generate numbered ID
      const generatedId = `${origin}-${sourceOriginCounters[origin]}`;
      sourceOriginCounters[origin]++;

      // Write to sheet
      const headerKeys = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const recordIdCol = headerKeys.indexOf('source_record_id') + 1;
      if (recordIdCol > 0) {
        sheet.getRange(rowNum, recordIdCol).setValue(generatedId);
        row.source_record_id = generatedId;
        result.autoFixed++;
        logToRunLog_('Notes', rowNum, 'INFO', `Auto-generated source_record_id: ${generatedId}`, `Origin: ${origin}`);
      }
    }

    if (hasRecordId && !hasOrigin) {
      errors.push('source_record_id requires source_origin');
    }

    // Relationship priority warning
    if (row.user_email && row.company_domain) {
      warnings.push('Both user_email and company_domain filled. user_email will take priority.');
    }

    // Duplicate ext_id check
    if (row.ext_id && String(row.ext_id).trim()) {
      const extId = String(row.ext_id).trim();
      if (extIdsSeen.has(extId)) {
        errors.push(`Duplicate ext_id: ${extId}`);
      } else {
        extIdsSeen.add(extId);
      }
    }

    // Duplicate pb_id check
    if (row.pb_id && UUID_PATTERN.test(row.pb_id)) {
      const pbId = String(row.pb_id).trim();
      if (pbIdsSeen.has(pbId)) {
        errors.push(`Duplicate pb_id: ${pbId}`);
      } else {
        pbIdsSeen.add(pbId);
      }
    }

    // Validate linked_entities format
    if (row.linked_entities && String(row.linked_entities).trim()) {
      const linkedEntitiesStr = String(row.linked_entities).trim();
      const uuids = linkedEntitiesStr.split(',').map(s => s.trim()).filter(Boolean);
      const invalidUuids = uuids.filter(uuid => !isValidUuid(uuid));

      if (invalidUuids.length > 0) {
        errors.push(`Invalid UUID format in linked_entities: ${invalidUuids.join(', ')}`);
      }
    }

    // Log errors and warnings
    errors.forEach(err => {
      logToRunLog_('Notes', rowNum, 'ERROR', err, '');
      result.errors++;
    });

    warnings.forEach(warn => {
      logToRunLog_('Notes', rowNum, 'WARN', warn, '');
      result.warnings++;
    });

    // Track rows for visual highlighting
    if (errors.length > 0) {
      rowsWithErrors.push(rowNum);
    } else if (warnings.length > 0) {
      rowsWithWarnings.push(rowNum);
    }
  });

  // Apply visual highlighting to rows with errors and warnings
  if (rowsWithErrors.length > 0 || rowsWithWarnings.length > 0) {
    const numCols = sheet.getLastColumn();

    // Light red background for error rows
    rowsWithErrors.forEach(rowNum => {
      const range = sheet.getRange(rowNum, 1, 1, numCols);
      range.setBackground('#f4cccc'); // Light red
    });

    // Light yellow background for warning rows
    rowsWithWarnings.forEach(rowNum => {
      const range = sheet.getRange(rowNum, 1, 1, numCols);
      range.setBackground('#fff2cc'); // Light yellow
    });

    logToRunLog_('Notes', null, 'INFO', `Applied visual highlighting: ${rowsWithErrors.length} error rows (red), ${rowsWithWarnings.length} warning rows (yellow)`, '');
  }

  // Summary
  if (result.errors === 0) {
    result.success = true;
    result.summary = `Validation complete: ${result.totalRows} rows, ${result.autoFixed} auto-fixes, ${result.warnings} warnings, no errors.`;
  } else {
    result.success = false;
    result.summary = `Validation failed: ${result.errors} errors, ${result.autoFixed} auto-fixes, ${result.warnings} warnings in ${result.totalRows} rows.`;
  }

  logToRunLog_('Notes', null, result.success ? 'SUCCESS' : 'ERROR', result.summary, '');

  // Format Run Log with color coding
  formatRunLog_();

  return result;
}

/** =========================
 *  MIGRATION PREPARATION
 * ========================= */

/**
 * Prepares notes sheet for migration to a new workspace
 * Copies pb_id → source_record_id, sets source_origin, clears pb_id
 * Preserves linked_entities for hierarchy mapping
 * @param {Object} options - { sourceName: string }
 * @returns {Object} - { success: boolean, processedCount: number, sourceName: string }
 */
function PrepareMigration_(options) {
  clearRunLog_();

  // Activate Run Log sheet for user to watch progress
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const runLogSheet = ss.getSheetByName(RUN_LOG_SHEET);
  if (runLogSheet) {
    runLogSheet.activate();
  }

  const sourceName = options.sourceName;

  if (!sourceName) {
    throw new Error('Migration source name is required');
  }

  logToRunLog_('Notes', null, 'INFO', 'Starting migration preparation...', `Source: ${sourceName}`);

  const sheet = getOrCreateNotesSheet_();
  const data = sheet.getDataRange().getValues();
  const headers = data[0]; // Machine keys row

  // Find column indices
  const pbIdCol = headers.indexOf('pb_id');
  const sourceOriginCol = headers.indexOf('source_origin');
  const sourceRecordIdCol = headers.indexOf('source_record_id');

  if (pbIdCol === -1 || sourceOriginCol === -1 || sourceRecordIdCol === -1) {
    const errorMsg = 'Required columns not found in sheet';
    logToRunLog_('Notes', null, 'ERROR', errorMsg, 'Missing: pb_id, source_origin, or source_record_id');
    throw new Error(errorMsg);
  }

  let processedCount = 0;
  let skippedCount = 0;
  const updates = [];

  logToRunLog_('Notes', null, 'INFO', 'Scanning notes for migration preparation...', '');

  // Process each data row (skip 3 header rows)
  for (let i = 3; i < data.length; i++) {
    const row = data[i];
    const pbId = row[pbIdCol];

    if (!pbId) {
      skippedCount++;
      continue; // Skip rows without pb_id
    }

    // Copy pb_id to source_record_id (preserves original UUID)
    row[sourceRecordIdCol] = pbId;

    // Set source_origin to migration source name
    row[sourceOriginCol] = sourceName;

    // Clear pb_id (makes it look like a new note for import)
    row[pbIdCol] = '';

    // Note: linked_entities column is NOT touched (preserves old hierarchy UUIDs for mapping)

    updates.push(row);
    processedCount++;
  }

  // Write updates back to sheet
  if (updates.length > 0) {
    logToRunLog_('Notes', null, 'INFO', `Writing changes to ${updates.length} rows...`, '');
    const range = sheet.getRange(4, 1, updates.length, headers.length); // Start at row 4 (after 3 header rows)
    range.setValues(updates);
  }

  const message = `Prepared ${processedCount} notes for migration. ${skippedCount} rows skipped (no pb_id).`;
  logToRunLog_('Notes', null, 'SUCCESS', 'Migration preparation complete', message);

  // Format Run Log with color coding
  formatRunLog_();

  return {
    success: true,
    processedCount: processedCount,
    skippedCount: skippedCount,
    sourceName: sourceName
  };
}

/** =========================
 *  HIERARCHY LINKING
 * ========================= */

/**
 * Auto-detects custom field named "original_uuid" in target workspace
 * @returns {{fieldId: string|null, fieldKey: string|null}}
 */
function detectMigrationCustomField_() {
  // Don't catch errors here — let them propagate so the sidebar failure handler shows them.
  const response = pbFetch_('get', '/v2/entities/configurations/feature');

  // Response is {data: {type, fields: {fieldId: fieldConfig, ...}, links}} — fields are nested under data.fields.
  const fieldsMap = (response && response.data && response.data.fields) ? response.data.fields : {};
  const fields = Object.values(fieldsMap);

  Logger.log(`detectMigrationCustomField_: found ${fields.length} fields`);
  if (fields.length > 0) {
    Logger.log(`detectMigrationCustomField_: field names = ${fields.map(f => `${f.name}(${f.schema})`).join(', ')}`);
  }

  // Find the field named "original_uuid" with a text schema
  const origUuidField = fields.find(f =>
    f.name === 'original_uuid' &&
    f.schema === 'TextFieldValue'
  );

  if (origUuidField) {
    Logger.log(`Auto-detected migration field: ${origUuidField.name} (${origUuidField.id})`);
    logToRunLog_('Notes', null, 'INFO', `Auto-detected migration custom field: ${origUuidField.name}`, origUuidField.id);
    return {
      fieldId: origUuidField.id,
      fieldKey: origUuidField.name
    };
  }

  const fieldSummary = fields.map(f => `${f.name}(${f.schema})`).join(', ') || 'none';
  Logger.log(`detectMigrationCustomField_: no "original_uuid" TextFieldValue found. Available: ${fieldSummary}`);
  logToRunLog_('Notes', null, 'WARN', 'Auto-detect: no "original_uuid" custom field found', `Available fields: ${fieldSummary}`);
  return { fieldId: null, fieldKey: null, debugInfo: `Available fields: ${fieldSummary}` };
}

/**
 * Builds lookup cache for migrated hierarchy entities
 * Maps original UUID (from custom field) → new UUID in target workspace
 * @param {string} customFieldId - UUID of the custom field containing original UUIDs
 * @returns {Map<string, string>}
 */
function buildHierarchyMigrationCache_(customFieldId) {
  const cache = new Map();

  // Fetch all entity types that notes can link to
  const entityTypes = ['feature', 'component', 'product', 'subfeature'];

  entityTypes.forEach(entityType => {
    const baseEndpoint = `/v2/entities?type=${entityType}`;
    let cursor = null;
    let entityCount = 0;

    do {
      const url = cursor ? `${baseEndpoint}&pageCursor=${cursor}` : baseEndpoint;
      const response = pbFetch_('get', url);

      (response.data || []).forEach(entity => {
        // Custom fields are keyed directly by UUID in entity.fields
        const fieldValue = (entity.fields || {})[customFieldId];

        if (fieldValue) {
          // Map: original UUID → new UUID in target workspace
          cache.set(fieldValue, entity.id);
          entityCount++;
        }
      });

      cursor = extractCursor_(response.links?.next);
    } while (cursor);

    Logger.log(`Scanned ${entityType}: found ${entityCount} with migration field`);
    logToRunLog_('Notes', null, 'INFO', `Scanned ${entityType}`, `Found ${entityCount} entities with migration field`);
  });

  Logger.log(`Built migration cache with ${cache.size} total hierarchy entity mappings`);
  logToRunLog_('Notes', null, 'INFO', 'Migration cache built', `${cache.size} total hierarchy entity mappings`);
  return cache;
}

/**
 * Helper function to validate UUID format
 * @param {string} str - String to validate
 * @returns {boolean}
 */
function isValidUuid(str) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Creates hierarchy relationships for notes using parallel batch processing
 * @param {Array} notesData - Array of note data with pb_id and linked_entities
 * @param {boolean} migrationMode - If true, map UUIDs via lookup cache
 * @param {string} customFieldId - UUID of custom field for migration lookup
 */
function linkNotesToHierarchy_(notesData, migrationMode, customFieldId) {
  logToRunLog_('Notes', null, 'INFO', 'Starting hierarchy linking...', '');

  // Reset rate limiter for fresh tracking
  resetRateLimiter_();

  // Build migration cache if in migration mode
  const migrationCache = migrationMode ? buildHierarchyMigrationCache_(customFieldId) : null;

  // Build list of all relationships to create
  const relationshipsToCreate = [];
  const entityMapping = new Map(); // Track original → target UUID mapping

  notesData.forEach(noteData => {
    if (!noteData.pb_id) return;

    const linkedEntitiesStr = noteData.linked_entities || '';
    if (!linkedEntitiesStr.trim()) return;

    const entityUuids = linkedEntitiesStr.split(',').map(s => s.trim()).filter(Boolean);

    entityUuids.forEach(originalUuid => {
      // Map UUID if in migration mode
      let targetUuid;
      if (migrationMode && migrationCache) {
        targetUuid = migrationCache.get(originalUuid);
        if (!targetUuid) {
          logToRunLog_('Notes', noteData.pb_id, 'WARN',
            `Entity ${originalUuid} not found in target workspace`, 'Skipped');
          return;
        }
        entityMapping.set(originalUuid, targetUuid);
      } else {
        targetUuid = originalUuid;
      }

      relationshipsToCreate.push({
        noteId: noteData.pb_id,
        entityId: targetUuid,
        originalEntityId: originalUuid
      });
    });
  });

  if (relationshipsToCreate.length === 0) {
    logToRunLog_('Notes', null, 'INFO', 'No relationships to create', '');
    return { success: true, successCount: 0, skipCount: 0, errors: [] };
  }

  logToRunLog_('Notes', null, 'INFO',
    `Creating ${relationshipsToCreate.length} relationships...`, '');

  // Sequential creation to avoid Google Apps Script bandwidth quota
  let successCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const errors = [];

  for (let i = 0; i < relationshipsToCreate.length; i++) {
    const rel = relationshipsToCreate[i];

    try {
      pbCallWithRetry_(() => {
        return pbFetch_('post', `/v2/notes/${rel.noteId}/relationships`, {
          data: {
            type: 'link',
            target: {
              id: rel.entityId,
              type: 'link'
            }
          }
        });
      }, `link note ${rel.noteId} → entity ${rel.entityId}`);

      successCount++;
      logToRunLog_('Notes', rel.noteId, 'SUCCESS',
        `Linked to entity ${rel.entityId}`,
        migrationMode ? `(was: ${rel.originalEntityId})` : '');
    } catch (err) {
      const errMsg = String(err.message || err);

      // 422 "already linked" → safe to skip on reruns
      if (errMsg.includes('422') && errMsg.includes('already linked')) {
        skippedCount++;
        logToRunLog_('Notes', rel.noteId, 'INFO',
          `Already linked to entity ${rel.entityId} — skipped`, '');
      } else {
        failedCount++;
        errors.push(`Note ${rel.noteId} → Entity ${rel.originalEntityId}: ${errMsg}`);
        logToRunLog_('Notes', rel.noteId, 'ERROR',
          `Failed to link to entity ${rel.entityId}`, errMsg);
      }
    }

    // Log progress every 50 relationships
    if ((i + 1) % 50 === 0 || (i + 1) === relationshipsToCreate.length) {
      const rateLimitStats = getRateLimiterStats_();
      Logger.log(`Processed relationships: ${i + 1}/${relationshipsToCreate.length}`);
      logToRunLog_('Notes', null, 'INFO',
        `Linking progress: ${i + 1}/${relationshipsToCreate.length}`,
        `${successCount} linked, ${skippedCount} already existed, ${failedCount} failed — rate limit remaining: ${rateLimitStats.remaining || '?'}`);
    }
  }

  // Final summary
  const success = errors.length === 0;
  const message = success
    ? `${successCount} linked, ${skippedCount} already existed`
    : `${successCount} linked, ${skippedCount} already existed, ${failedCount} failed`;

  logToRunLog_('Notes', null, success ? 'SUCCESS' : 'WARN',
    'Hierarchy linking complete', message);

  return {
    success: success,
    successCount: successCount,
    skipCount: failedCount,
    errors: errors
  };
}

/**
 * Wrapper function for linking notes to hierarchy entities
 * @param {Object} options - Options object with migrationMode
 * @returns {Object} Result with success counts and errors
 */
function LinkNotesToHierarchy_(options) {
  clearRunLog_();

  // Activate Run Log sheet for user to watch progress
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const runLogSheet = ss.getSheetByName(RUN_LOG_SHEET);
  if (runLogSheet) {
    runLogSheet.activate();
  }

  const migrationMode = options.migrationMode || false;

  // Validate migration mode requirements
  if (migrationMode) {
    const customFieldId = getSettings_().migrationFieldUuid;
    if (!customFieldId) {
      throw new Error('Migration mode requires custom field UUID. Please configure in Settings.');
    }
  }

  // Read notes from sheet
  const sheet = getOrCreateNotesSheet_();
  const data = sheet.getDataRange().getValues();
  const headers = data[0]; // Machine keys row

  // Parse sheet data
  const notesData = [];
  for (let i = 3; i < data.length; i++) { // Skip 3 header rows
    const row = data[i];
    const noteData = {
      pb_id: row[headers.indexOf('pb_id')],
      linked_entities: row[headers.indexOf('linked_entities')]
    };

    if (noteData.pb_id) {
      notesData.push(noteData);
    }
  }

  // Get custom field ID for migration mode
  const customFieldId = migrationMode ? getSettings_().migrationFieldUuid : null;

  // Create relationships
  const result = linkNotesToHierarchy_(notesData, migrationMode, customFieldId);

  // Format Run Log for color coding
  formatRunLog_();

  return result;
}

/** =========================
 *  IMPORT WORKFLOW
 * ========================= */

/**
 * Import notes to Productboard (v1 API with v2 status backfill)
 * @returns {Object} Result with created, updated counts and message
 */
function ImportNotes_() {
  clearRunLog_();
  logToRunLog_('Notes', null, 'INFO', 'Starting import...', '');

  // Validation
  const validation = ValidateNotes_();
  if (!validation.success) {
    return {
      success: false,
      message: `Validation failed: ${validation.errors} errors. Check Run Log.`
    };
  }

  const sheet = getOrCreateNotesSheet_();
  const data = readNotesSheet_(sheet);

  if (data.length === 0) {
    return { success: true, created: 0, updated: 0, message: 'No data to import' };
  }

  // Batching decision
  if (data.length > BATCH_THRESHOLD_IMPORT) {
    Logger.log(`Large dataset (${data.length} notes), using batch queue...`);

    const jobs = [];
    for (let i = 0; i < data.length; i += CHUNK_SIZE_IMPORT) {
      const startRow = HEADER_ROWS + 1 + i;
      const endRow = Math.min(HEADER_ROWS + data.length, startRow + CHUNK_SIZE_IMPORT - 1);

      jobs.push({
        type: 'import-notes-chunk',
        startRow: startRow,
        endRow: endRow,
        chunkIndex: Math.floor(i / CHUNK_SIZE_IMPORT)
      });
    }

    BatchQueue_create(jobs, 'import-notes');

    return {
      batchStarted: true,
      message: `Import batch started (${jobs.length} chunks, ${data.length} notes)`
    };
  }

  // Small dataset - direct execution
  const result = ImportNotesChunk_(HEADER_ROWS + 1, HEADER_ROWS + data.length);

  return result;
}

/**
 * Import a chunk of notes (batch processor)
 * @param {number} startRow - Start row number (1-indexed)
 * @param {number} endRow - End row number (1-indexed)
 * @returns {Object} Result with created, updated, error counts
 */
function ImportNotesChunk_(startRow, endRow) {
  Logger.log(`Importing notes chunk: rows ${startRow}-${endRow}`);
  resetRateLimiter_();

  const result = {
    success: true,
    errors: 0,
    created: 0,
    updated: 0,
    totalRows: 0
  };

  try {
    const sheet = getOrCreateNotesSheet_();
    const allData = readNotesSheet_(sheet);
    const chunkData = allData.filter(row => row._row >= startRow && row._row <= endRow);

    if (chunkData.length === 0) {
      return { ...result, summary: `No data in rows ${startRow}-${endRow}` };
    }

    result.totalRows = chunkData.length;

    // Track notes needing v2 backfill (status, creator, owner if v1 rejected it)
    const notesForBackfill = [];

    // Process each note
    chunkData.forEach((row, index) => {
      const rowNum = row._row;
      const progressPercent = 5 + Math.round((index / chunkData.length) * 70);
      BatchQueue_setSubProgress(`Importing note ${index + 1}/${chunkData.length}...`, progressPercent);

      try {
        // Match note
        const match = matchNote_(row);

        // Create or update
        let noteId;
        let ownerRejected = false;

        if (match.action === 'CREATE') {
          const createResult = createNote_(row, rowNum);
          noteId = createResult.id;
          ownerRejected = createResult.ownerRejected || false;
          result.created++;
        } else {
          const updateResult = updateNote_(match.noteId, row, rowNum);
          noteId = match.noteId;
          ownerRejected = updateResult.ownerRejected || false;
          result.updated++;
        }

        // Track for v2 backfill if any of these fields need to be set:
        // 1. Status fields (archived/processed)
        // 2. Creator (not supported in v1)
        // 3. Owner (if v1 rejected it)

        // Helper to check if value is truthy (handles boolean true, string 'TRUE', 'true', etc.)
        const isTruthy = (val) => val === true || val === 'TRUE' || val === 'true';

        const needsBackfill = isTruthy(row.archived) || isTruthy(row.processed) ||
                             row.creator_email || (ownerRejected && row.owner_email);

        if (needsBackfill) {
          notesForBackfill.push({
            id: noteId,
            archived: isTruthy(row.archived),
            processed: isTruthy(row.processed),
            creator_email: row.creator_email || null,
            owner_email: (ownerRejected && row.owner_email) ? row.owner_email : null
          });
        }

      } catch (err) {
        result.errors++;
        const errorMsg = handleApiError_(err, 'import note', { sheet: NOTES_SHEET, row: rowNum });
        logToRunLog_('Notes', rowNum, 'ERROR', errorMsg.message, errorMsg.details);
      }
    });

    // Backfill status via v2
    if (notesForBackfill.length > 0) {
      BatchQueue_setSubProgress('Backfilling status...', 80);
      // Add delay to allow v1 notes to propagate to v2 API
      Logger.log(`Waiting 2 seconds for v1 notes to propagate before v2 backfill...`);
      Utilities.sleep(2000);
      backfillStatusBatch_(notesForBackfill);
    }

    result.success = result.errors === 0;
    result.summary = `Chunk ${startRow}-${endRow}: ${result.created} created, ${result.updated} updated, ${result.errors} errors.`;

    logToRunLog_('Notes', null, result.success ? 'SUCCESS' : 'WARN', result.summary, '');

    // Format Run Log with color coding
    formatRunLog_();

    return result;

  } catch (err) {
    Logger.log(`Error importing chunk: ${err}`);
    result.errors++;
    result.success = false;
    result.summary = `Chunk error: ${err.message}`;
    return result;
  }
}

/** =========================
 *  NOTE MATCHING & CRUD
 * ========================= */

/**
 * Match note by ext_id or pb_id to determine create vs update
 * @param {Object} row - Sheet row data
 * @returns {Object} Match result with action and noteId
 */
function matchNote_(row) {
  // Priority 1: ext_id (source.record_id matching)
  if (row.ext_id && String(row.ext_id).trim()) {
    const extId = String(row.ext_id).trim();
    const existing = findNoteBySourceRecordId_(extId);
    if (existing) {
      Logger.log(`Match by ext_id: ${extId} → ${existing.id}`);
      return { action: 'UPDATE', noteId: existing.id, method: 'ext_id' };
    }
  }

  // Priority 2: pb_id (direct ID matching)
  if (row.pb_id && UUID_PATTERN.test(row.pb_id)) {
    const exists = noteExists_(row.pb_id);
    if (exists) {
      Logger.log(`Match by pb_id: ${row.pb_id}`);
      return { action: 'UPDATE', noteId: row.pb_id, method: 'pb_id' };
    }
  }

  // Priority 3: Create new note
  return { action: 'CREATE', noteId: null, method: 'new' };
}

/**
 * Search for note by source.record_id (ext_id)
 * @param {string} recordId - External record ID
 * @returns {Object|null} Note object or null if not found
 */
function findNoteBySourceRecordId_(recordId) {
  Logger.log(`Searching for note with source.record_id: ${recordId}`);

  let pageOffset = 0;
  const pageLimit = 100;
  let found = null;
  const MAX_PAGES = 1000; // Safety limit: max 1000 pages * 100 notes = 100,000 notes
  let pageCount = 0;

  while (true) {
    try {
      // Safety check: prevent infinite loop
      if (pageCount >= MAX_PAGES) {
        Logger.log(`WARNING: Stopped searching after ${MAX_PAGES} pages (safety limit)`);
        logToRunLog_('Notes', null, 'WARN', `Note search stopped: reached maximum page limit (${MAX_PAGES} pages)`, `Could not find note with ext_id: ${recordId}. This is a safety limit to prevent infinite loops.`);
        break;
      }

      const response = pbCallWithRetry_(() => {
        return pbFetch_('get', `/notes?pageLimit=${pageLimit}&pageOffset=${pageOffset}`);
      }, `search notes (page ${pageOffset / pageLimit + 1})`);

      if (!response.data || response.data.length === 0) {
        break;
      }

      // Search in current page
      for (const note of response.data) {
        if (note.source?.record_id === recordId) {
          found = note;
          break;
        }
      }

      if (found) break;

      // Continue to next page
      if (response.data.length < pageLimit) {
        break; // Last page
      }
      pageOffset += pageLimit;
      pageCount++;

    } catch (err) {
      Logger.log(`Error searching for note: ${err}`);
      break;
    }
  }

  if (found) {
    Logger.log(`Found note by ext_id: ${found.id}`);
  } else {
    Logger.log(`No note found with ext_id: ${recordId}`);
  }

  return found;
}

/**
 * Create a new note via v1 API
 * @param {Object} row - Sheet row data
 * @param {number} rowNum - Sheet row number
 * @returns {Object} Created note with id
 */
function createNote_(row, rowNum) {
  // NOTE: Do NOT generate or send UUID - Productboard generates it for us
  const payload = {
    title: row.title,  // REQUIRED - v1 API uses "title" not "name"
    content: row.content || ''  // REQUIRED - v1 API requires content field
  };

  // Optional fields
  if (row.display_url) {
    // Ensure display_url has protocol (API requires https://)
    let url = String(row.display_url).trim();
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }
    payload.display_url = url;
  }

  // Relationship (user takes priority) - no validation needed, API handles it
  if (row.user_email) {
    payload.user = { email: row.user_email };
  } else if (row.company_domain) {
    payload.company = { domain: row.company_domain };
  }

  // Owner - try with owner first, if rejected retry without
  let ownerRejected = false;
  if (row.owner_email) {
    payload.owner = { email: row.owner_email };
  }

  // NOTE: creator is NOT supported in v1 API - will backfill via v2

  // Tags - v1 API expects array of strings, not objects
  if (row.tags && String(row.tags).trim()) {
    payload.tags = String(row.tags).split(',').map(t => t.trim()).filter(t => t);
  }

  // Source (only on creation, immutable)
  if (row.source_origin && row.source_record_id) {
    payload.source = {
      origin: row.source_origin,
      record_id: row.source_record_id
    };
  }

  let response;
  try {
    response = pbCallWithRetry_(() => {
      return pbFetch_('post', '/notes', payload);
    }, `create note (row ${rowNum})`);
  } catch (err) {
    // Check if error is due to owner not existing
    const errMsg = String(err.message || err);
    if (row.owner_email && (errMsg.includes('owner') || errMsg.includes('User does not exist'))) {
      logToRunLog_('Notes', rowNum, 'WARN',
        `Owner email rejected by API: ${row.owner_email}. Will backfill via v2.`, errMsg);
      // Retry without owner
      delete payload.owner;
      ownerRejected = true;
      response = pbCallWithRetry_(() => {
        return pbFetch_('post', '/notes', payload);
      }, `create note without owner (row ${rowNum})`);
    } else {
      // Re-throw if it's not an owner validation error
      throw err;
    }
  }

  // Extract the note ID from the API response
  // Productboard generates and returns the UUID
  const noteId = response.id || response.data?.id;

  if (!noteId) {
    throw new Error('API did not return a note ID in the response');
  }

  Logger.log(`Note created with ID: ${noteId}`);

  // Write the Productboard-generated ID to the sheet
  const sheet = getOrCreateNotesSheet_();
  sheet.getRange(rowNum, 1).setValue(noteId);

  logToRunLog_('Notes', rowNum, 'SUCCESS', `Created note: ${row.title}`, `ID: ${noteId}`);

  return { id: noteId, ownerRejected: ownerRejected, ...response };
}

/**
 * Update an existing note via v1 API
 * @param {string} noteId - Note UUID
 * @param {Object} row - Sheet row data
 * @param {number} rowNum - Sheet row number
 * @returns {Object} API response
 */
function updateNote_(noteId, row, rowNum) {
  const payload = {};

  // Include fields that should be updated - v1 API uses "title" not "name"
  if (row.title) payload.title = row.title;
  if (row.content !== undefined) payload.content = row.content || '';  // Allow clearing content
  if (row.display_url) {
    // Ensure display_url has protocol (API requires https://)
    let url = String(row.display_url).trim();
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }
    payload.display_url = url;
  }

  // Relationship - no validation needed, API handles it
  if (row.user_email) {
    payload.user = { email: row.user_email };
  } else if (row.company_domain) {
    payload.company = { domain: row.company_domain };
  }

  // Owner - try with owner first, if rejected retry without
  let ownerRejected = false;
  if (row.owner_email) {
    payload.owner = { email: row.owner_email };
  }

  // NOTE: creator is NOT supported in v1 API - will backfill via v2

  // Tags - v1 API expects array of strings, not objects
  if (row.tags !== undefined) {
    const tagsStr = String(row.tags).trim();
    payload.tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(t => t) : [];
  }

  // NOTE: source is immutable, cannot be updated

  let response;
  try {
    response = pbCallWithRetry_(() => {
      return pbFetch_('patch', `/notes/${noteId}`, payload);
    }, `update note (row ${rowNum})`);
  } catch (err) {
    // Check if error is due to owner not existing
    const errMsg = String(err.message || err);
    if (row.owner_email && (errMsg.includes('owner') || errMsg.includes('User does not exist'))) {
      logToRunLog_('Notes', rowNum, 'WARN',
        `Owner email rejected by API: ${row.owner_email}. Will backfill via v2.`, errMsg);
      // Retry without owner
      delete payload.owner;
      ownerRejected = true;
      response = pbCallWithRetry_(() => {
        return pbFetch_('patch', `/notes/${noteId}`, payload);
      }, `update note without owner (row ${rowNum})`);
    } else {
      // Re-throw if it's not an owner validation error
      throw err;
    }
  }

  logToRunLog_('Notes', rowNum, 'SUCCESS', `Updated note: ${row.title}`, `ID: ${noteId}`);

  return { ownerRejected: ownerRejected, ...response };
}

/** =========================
 *  USER VALIDATION
 * ========================= */

/**
 * Build a cache of valid user emails for owner/creator validation
 * @returns {Set} Set of lowercase email strings
 */
function buildUserEmailCache_() {
  Logger.log('Building user email cache...');
  logToRunLog_('Notes', null, 'INFO', 'Building user email cache for owner/creator validation...', '');
  const users = new Set();

  let pageOffset = 0;
  const pageLimit = 100;
  let totalFetched = 0;

  while (true) {
    try {
      const response = pbCallWithRetry_(() => {
        return pbFetch_('get', `/users?pageLimit=${pageLimit}&pageOffset=${pageOffset}`);
      }, `fetch users (page ${pageOffset / pageLimit + 1})`);

      if (!response.data || response.data.length === 0) {
        break;
      }

      response.data.forEach(user => {
        if (user.email) {
          users.add(user.email.toLowerCase());
          totalFetched++;
        }
      });

      Logger.log(`Fetched ${response.data.length} users (page ${pageOffset / pageLimit + 1}), total: ${totalFetched}`);

      if (response.data.length < pageLimit) {
        break; // Last page
      }
      pageOffset += pageLimit;

    } catch (err) {
      Logger.log(`Error fetching users: ${err}`);
      logToRunLog_('Notes', null, 'ERROR', 'Failed to fetch users for validation', String(err));
      // If we got at least some users, continue with what we have
      if (users.size === 0) {
        logToRunLog_('Notes', null, 'WARN', 'No users fetched - owner/creator validation will be skipped', 'All owner/creator assignments will fail');
      }
      break;
    }
  }

  Logger.log(`User cache built: ${users.size} emails`);
  logToRunLog_('Notes', null, 'INFO', `User cache built: ${users.size} valid emails`, totalFetched > 0 ? `Fetched from ${Math.ceil(totalFetched / pageLimit)} pages` : 'No users retrieved');
  return users;
}

/** =========================
 *  STATUS BACKFILL (V2)
 * ========================= */

/**
 * Backfill fields via v2 API after v1 import
 * Handles: archived, processed, creator, owner
 * @param {Array} notes - Array of {id, archived, processed, creator_email, owner_email} objects
 */
function backfillStatusBatch_(notes) {
  if (notes.length === 0) return;

  Logger.log(`Backfilling fields for ${notes.length} notes via v2...`);
  logToRunLog_('Notes', null, 'INFO', `Starting v2 backfill for ${notes.length} notes...`, 'Fields: archived, processed, creator, owner');

  let backfilled = 0;
  let failed = 0;

  notes.forEach((note, index) => {
    const patchOps = [];

    // Status fields
    if (note.archived !== undefined) {
      patchOps.push({ op: 'set', path: 'archived', value: note.archived });
    }

    if (note.processed !== undefined) {
      patchOps.push({ op: 'set', path: 'processed', value: note.processed });
    }

    // Creator field (not supported in v1)
    if (note.creator_email) {
      patchOps.push({ op: 'set', path: 'creator', value: { email: note.creator_email } });
    }

    // Owner field (if v1 rejected it)
    if (note.owner_email) {
      patchOps.push({ op: 'set', path: 'owner', value: { email: note.owner_email } });
    }

    if (patchOps.length > 0) {
      try {
        // Retry logic for 404 errors (note not yet available in v2)
        let retryCount = 0;
        const maxRetries = 3;
        let success = false;

        while (!success && retryCount <= maxRetries) {
          try {
            pbCallWithRetry_(() => {
              return pbFetch_('patch', `/v2/notes/${note.id}`, {
                data: { patch: patchOps }
              });
            }, `backfill fields for note ${note.id}`);
            success = true;
            backfilled++;

            // Log successful backfill to Run Log
            const fieldsPatched = patchOps.map(op => op.path).join(', ');
            const fieldDetails = patchOps.map(op => {
              if (op.path === 'archived' || op.path === 'processed') {
                return `${op.path}=${op.value}`;
              } else if (op.path === 'creator' || op.path === 'owner') {
                return `${op.path}=${op.value.email}`;
              }
              return op.path;
            }).join(', ');
            logToRunLog_('Notes', null, 'SUCCESS', `v2 backfill: ${note.id}`, `Patched: ${fieldDetails}`);
          } catch (retryErr) {
            const errMsg = String(retryErr.message || retryErr);
            if (errMsg.includes('404') || errMsg.includes('not found')) {
              retryCount++;
              if (retryCount <= maxRetries) {
                Logger.log(`Note ${note.id} not found in v2 (404), retry ${retryCount}/${maxRetries} after delay...`);
                Utilities.sleep(1000 * retryCount); // Exponential backoff: 1s, 2s, 3s
              } else {
                throw retryErr; // Max retries exceeded
              }
            } else {
              throw retryErr; // Not a 404, throw immediately
            }
          }
        }
      } catch (err) {
        // If creator/owner failed, retry with just status fields
        const errMsg = String(err.message || err);
        if ((note.creator_email || note.owner_email) &&
            (errMsg.includes('creator') || errMsg.includes('owner') || errMsg.includes('User does not exist'))) {

          logToRunLog_('Notes', null, 'WARN',
            `Creator/Owner rejected for note ${note.id}, retrying with status only`, errMsg);

          try {
            // Retry with only status fields
            const statusOnlyOps = patchOps.filter(op => op.path === 'archived' || op.path === 'processed');
            if (statusOnlyOps.length > 0) {
              pbCallWithRetry_(() => {
                return pbFetch_('patch', `/v2/notes/${note.id}`, {
                  data: { patch: statusOnlyOps }
                });
              }, `backfill status only for note ${note.id}`);
              backfilled++;

              // Log successful status-only backfill
              const fieldDetails = statusOnlyOps.map(op => `${op.path}=${op.value}`).join(', ');
              logToRunLog_('Notes', null, 'SUCCESS', `v2 backfill (status only): ${note.id}`, `Patched: ${fieldDetails}`);
            }
          } catch (retryErr) {
            failed++;
            Logger.log(`Warning: Failed to backfill even status for note ${note.id}: ${retryErr}`);
            logToRunLog_('Notes', null, 'WARN',
              `Failed to backfill fields for note ${note.id}`, String(retryErr));
          }
        } else {
          failed++;
          Logger.log(`Warning: Failed to backfill fields for note ${note.id}: ${err}`);
          logToRunLog_('Notes', null, 'WARN',
            `Failed to backfill fields for note ${note.id}`, String(err));
        }
      }
    }

    // Log progress periodically
    if ((index + 1) % 10 === 0 || (index + 1) === notes.length) {
      Logger.log(`Backfilled ${index + 1}/${notes.length} notes...`);
    }
  });

  Logger.log(`Backfill complete: ${backfilled} succeeded, ${failed} failed`);

  // Log summary to Run Log
  const summaryStatus = failed === 0 ? 'SUCCESS' : 'WARN';
  logToRunLog_('Notes', null, summaryStatus, `v2 backfill complete: ${backfilled} succeeded, ${failed} failed`, `Total notes processed: ${notes.length}`);
}

/** =========================
 *  NOTE DELETION
 * ========================= */

/**
 * Delete all notes from Productboard that are listed in the Notes sheet
 * @returns {Object} Result with deleted count and message
 */
function DeleteAllNotes_() {
  clearRunLog_();
  logToRunLog_('Notes', null, 'INFO', 'Starting bulk note deletion...', '');

  const sheet = getOrCreateNotesSheet_();
  const data = readNotesSheet_(sheet);

  // Filter for notes that have a pb_id (only delete notes that exist in Productboard)
  const notesToDelete = data.filter(row => row.pb_id && UUID_PATTERN.test(row.pb_id));

  if (notesToDelete.length === 0) {
    const message = 'No notes with valid pb_id found to delete.';
    logToRunLog_('Notes', null, 'INFO', message, '');
    return {
      success: true,
      deleted: 0,
      errors: 0,
      message: message
    };
  }

  Logger.log(`Found ${notesToDelete.length} notes to delete`);
  logToRunLog_('Notes', null, 'INFO', `Found ${notesToDelete.length} notes with pb_id to delete`, '');

  // Batching decision
  if (notesToDelete.length > BATCH_THRESHOLD_IMPORT) {
    Logger.log(`Large dataset (${notesToDelete.length} notes), using batch queue...`);

    const jobs = [];
    for (let i = 0; i < notesToDelete.length; i += CHUNK_SIZE_IMPORT) {
      const chunk = notesToDelete.slice(i, Math.min(i + CHUNK_SIZE_IMPORT, notesToDelete.length));
      jobs.push({
        type: 'delete-notes-chunk',
        notes: chunk.map(n => ({ id: n.pb_id, row: n._row })),
        chunkIndex: Math.floor(i / CHUNK_SIZE_IMPORT)
      });
    }

    BatchQueue_create(jobs, 'delete-notes');

    return {
      batchStarted: true,
      message: `Deletion batch started (${jobs.length} chunks, ${notesToDelete.length} notes)`
    };
  }

  // Small dataset - direct execution
  const noteIds = notesToDelete.map(n => ({ id: n.pb_id, row: n._row }));
  const result = DeleteNotesChunk_(noteIds);

  return result;
}

/**
 * Delete a chunk of notes (batch processor)
 * @param {Array} noteIds - Array of {id, row} objects
 * @returns {Object} Result with deleted, error counts
 */
function DeleteNotesChunk_(noteIds) {
  Logger.log(`Deleting notes chunk: ${noteIds.length} notes`);
  resetRateLimiter_();

  const result = {
    success: true,
    errors: 0,
    deleted: 0,
    totalNotes: noteIds.length
  };

  noteIds.forEach((note, index) => {
    const progressPercent = 10 + Math.round((index / noteIds.length) * 80);
    BatchQueue_setSubProgress(`Deleting note ${index + 1}/${noteIds.length}...`, progressPercent);

    try {
      // Use v2 API endpoint for deletion
      pbCallWithRetry_(() => {
        return pbFetch_('delete', `/v2/notes/${note.id}`);
      }, `delete note ${note.id}`);

      result.deleted++;
      logToRunLog_('Notes', note.row, 'SUCCESS', `Deleted note (v2): ${note.id}`, '');

      // Clear pb_id from sheet after successful deletion
      const sheet = getOrCreateNotesSheet_();
      sheet.getRange(note.row, 1).setValue('');

    } catch (err) {
      result.errors++;
      const errorMsg = handleApiError_(err, 'delete note', { sheet: NOTES_SHEET, row: note.row });
      logToRunLog_('Notes', note.row, 'ERROR', errorMsg.message, errorMsg.details);
    }
  });

  result.success = result.errors === 0;
  result.summary = `Deleted ${result.deleted} notes, ${result.errors} errors.`;

  const summaryStatus = result.success ? 'SUCCESS' : 'WARN';
  logToRunLog_('Notes', null, summaryStatus, result.summary, `Total: ${result.totalNotes}`);

  // Format Run Log with color coding
  formatRunLog_();

  return result;
}
