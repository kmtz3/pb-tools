/** ===========================================================
 * Notes Import/Export Tool - Sidebar UI Bridge
 *
 * This file contains the bridge functions between the HTML sidebar
 * and the backend Notes operations.
 * =========================================================== */

/**
 * Show the Notes sidebar UI
 */
function showNotesSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar_Notes')
    .setTitle('Notes Import/Export')
    .setWidth(350);
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Get snapshot of current workspace state for UI
 * @returns {Object} Snapshot with settings, sheet status, and batch status
 */
function NotesSidebar_getSnapshot() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('PB_API_TOKEN') || '';
  const workspaceName = props.getProperty('WORKSPACE_NAME') || '';
  const useEuDatacenter = props.getProperty('USE_EU_DATACENTER') === 'true';
  const migrationFieldUuid = props.getProperty('MIGRATION_FIELD_UUID') || '';

  // Check if sheets exist
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const notesSheet = ss.getSheetByName(NOTES_SHEET);
  const runLogSheet = ss.getSheetByName(RUN_LOG_SHEET);

  // Get batch queue status
  const batchStatus = BatchQueue_getStatus();
  const summary = batchStatus ? BatchQueue_getSummary() : null;

  return {
    hasToken: !!token,
    maskedToken: token ? maskToken_(token) : '',
    workspaceName: workspaceName,
    useEuDatacenter: useEuDatacenter,
    migrationFieldUuid: migrationFieldUuid,
    hasNotesSheet: !!notesSheet,
    hasRunLogSheet: !!runLogSheet,
    batchStatus: summary,
    isActive: summary ? !summary.isComplete : false
  };
}

/**
 * Save settings from UI
 * @param {Object} settings - Settings object
 * @returns {Object} Result with success status
 */
function NotesSidebar_saveSettings(settings) {
  const props = PropertiesService.getScriptProperties();

  if (settings.apiToken) {
    props.setProperty('PB_API_TOKEN', settings.apiToken);
  }

  if (settings.workspaceName !== undefined) {
    props.setProperty('WORKSPACE_NAME', settings.workspaceName);
  }

  if (settings.useEuDatacenter !== undefined) {
    if (settings.useEuDatacenter) {
      props.setProperty('USE_EU_DATACENTER', 'true');
    } else {
      props.deleteProperty('USE_EU_DATACENTER');
    }
  }

  if (settings.migrationFieldUuid !== undefined) {
    if (settings.migrationFieldUuid) {
      props.setProperty('MIGRATION_FIELD_UUID', settings.migrationFieldUuid);
    } else {
      props.deleteProperty('MIGRATION_FIELD_UUID');
    }
  }

  // Clear cache when settings change
  clearConfigCache_();

  return { success: true, message: 'Settings saved successfully' };
}

/**
 * Run an action from the sidebar
 * @param {Object} request - Request object with action and parameters
 * @returns {Object} Result object
 */
function NotesSidebar_runAction(request) {
  const action = request.action;

  try {
    switch (action) {
      case 'setup-notes-sheet':
        return { success: true, result: SetupNotesSheet_(true) };

      case 'delete-notes-sheet':
        return { success: true, result: deleteNotesSheet_() };

      case 'export-notes':
        const exportResult = ExportNotes_({
          replaceData: request.replaceData !== undefined ? request.replaceData : true
        });
        if (exportResult.batchStarted) return exportResult;
        return { success: true, result: exportResult };

      case 'prepare-migration':
        const prepResult = PrepareMigration_({
          sourceName: request.sourceName
        });
        return { success: prepResult.success, result: prepResult };

      case 'detect-migration-field':
        const detectResult = detectMigrationCustomField_();
        return { success: true, fieldId: detectResult.fieldId, fieldKey: detectResult.fieldKey, debugInfo: detectResult.debugInfo };

      case 'link-notes-to-hierarchy':
        const linkResult = LinkNotesToHierarchy_({
          migrationMode: request.migrationMode || false
        });
        return { success: linkResult.success, result: linkResult };

      case 'validate-notes':
        const validateResult = ValidateNotes_();
        return { success: validateResult.success, result: validateResult };

      case 'import-notes':
        const importResult = ImportNotes_();
        if (importResult.batchStarted) return importResult;
        return { success: importResult.success, result: importResult };

      case 'delete-all-notes':
        const deleteResult = DeleteAllNotes_();
        if (deleteResult.batchStarted) return deleteResult;
        return { success: deleteResult.success, result: deleteResult };

      case 'batch-next':
        return BatchQueue_processNext();

      case 'batch-clear':
        BatchQueue_clear();
        return { success: true, message: 'Batch queue cleared' };

      case 'clear-cache':
        return clearConfigCache_();

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (err) {
    Logger.log(`Error in action ${action}: ${err}`);
    return {
      success: false,
      error: String(err),
      message: `Error: ${err.message || err}`
    };
  }
}

/**
 * Get batch queue status for polling
 * @returns {Object} Status object
 */
function NotesSidebar_getBatchStatus() {
  const summary = BatchQueue_getSummary();
  return {
    status: summary,
    isActive: summary ? !summary.isComplete : false
  };
}

/**
 * Show confirmation dialog for note deletion
 * @returns {boolean} True if user confirmed, false otherwise
 */
function NotesSidebar_showDeleteConfirmation() {
  const ui = SpreadsheetApp.getUi();

  // Count notes to delete
  const sheet = getOrCreateNotesSheet_();
  const data = readNotesSheet_(sheet);
  const notesToDelete = data.filter(row => row.pb_id && UUID_PATTERN.test(row.pb_id));

  const message = notesToDelete.length > 0
    ? `You are about to delete ${notesToDelete.length} note(s) from Productboard.\n\nThis action CANNOT be undone.\n\nAre you sure you want to proceed?`
    : 'No notes with valid pb_id found to delete.';

  if (notesToDelete.length === 0) {
    ui.alert('Delete Notes', message, ui.ButtonSet.OK);
    return false;
  }

  const response = ui.alert(
    'Delete Notes - Confirmation Required',
    message,
    ui.ButtonSet.YES_NO
  );

  return response === ui.Button.YES;
}

/**
 * Activate the Run Log sheet
 * Called from sidebar when a status message mentions "Check Run Log"
 */
function NotesSidebar_activateRunLogSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const runLogSheet = ss.getSheetByName(RUN_LOG_SHEET);

  if (runLogSheet) {
    runLogSheet.activate();
    Logger.log('Run Log sheet activated');
  }
}
