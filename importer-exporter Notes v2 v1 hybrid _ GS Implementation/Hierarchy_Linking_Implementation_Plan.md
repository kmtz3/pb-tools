# Implementation Plan: Hierarchy Links Export and Migration Support

## Context

This change adds support for exporting note-to-hierarchy entity relationships and implementing a migration workflow to transfer notes and their relationships between Productboard workspaces. Currently, the system only exports customer relationships (user/company) but ignores product link relationships (features, components, etc.) that are already being fetched from the API.

**Why this is needed:**
- Enable workspace-to-workspace migration of notes with their hierarchy connections preserved
- Both notes and hierarchy entities receive new UUIDs in the target workspace, requiring a mapping strategy
- Need to capture existing hierarchy links during export to recreate them after migration

## Recommended Approach: API Version Selection

### **Use v2 API for pulling hierarchy links** ✅

**Rationale:**
1. **Already implemented**: The code already fetches v2 relationships via `/v2/notes/{id}/relationships` in `fetchRelationshipsForNotes_()` (notesExporter.gs:477-540)
2. **Single endpoint**: Returns ALL relationship types (customer AND product links) in one call
3. **More complete data**: v2 includes customer relationships that v1 doesn't provide
4. **Future-proof**: v2 is the current API standard

**Current state:**
- Relationships are fetched but only `customer` type is parsed (notesExporter.gs:559-581)
- Product link relationships (`type: "link"`) exist in the data but are discarded
- **No code changes needed for fetching** - only for parsing and storing

**v1 API alternative (not recommended):**
- Would require separate `/notes/{noteId}/links` calls
- Doesn't include customer relationships
- Adds unnecessary complexity

## Migration Strategy Analysis

### Approach

**For Hierarchy Entities:**
- ✅ Store original UUID in a custom text field in target workspace
- ✅ Use this field as a lookup key during note import

**For Notes:**
- ✅ Use `source: "Productboard-us"` and `sourceRecordId: <original_uuid>`
- ✅ The v2 API already supports filtering by `source[recordId]` for efficient lookups

**Migration Mode Toggle:**
- ✅ Add checkbox in sidebar to enable special lookup behavior during import
- When enabled, resolve hierarchy UUIDs by querying custom field values instead of using literal UUIDs from sheet

### Potential Concerns & Mitigations

**1. Custom field performance:**
- ⚠️ **Concern**: Looking up entities by custom field value requires fetching all entities and filtering locally (no API filter for custom fields)
- ✅ **Mitigation**: Build a lookup cache at start of import operation (similar to existing `buildUserLookupCache_()`)
- ✅ **Implementation**: `buildHierarchyMigrationCache_()` function to map original UUIDs → new UUIDs

**2. Multiple hierarchy entity types:**
- ⚠️ **Concern**: Notes can link to features, components, products, subfeatures, etc. - need to scan all entity types
- ✅ **Mitigation**: Build unified cache by scanning all entity types during cache build phase
- ✅ **Implementation**: Single cache with `{originalUuid → newUuid}` mapping (no entity type needed for v2 API!)

**3. sourceRecordId uniqueness:**
- ✅ **Already handled**: The validation logic auto-generates unique sourceRecordIds if missing (notesImporter.gs:388-426)
- ✅ **Format**: `{sourceOrigin}-{counter}` ensures uniqueness per source system

**4. Relationship creation timing:**
- ⚠️ **Concern**: Must create notes first, then create relationships (can't be done atomically in v1 API)
- ✅ **Current pattern**: Import uses two-phase approach (create/update via v1, then backfill via v2)
- ✅ **Solution**: Add third phase for relationship creation after notes exist

**5. Missing entities in target workspace:**
- ⚠️ **Concern**: Sheet may reference hierarchy entities that don't exist yet in target workspace
- ✅ **Mitigation**: Validate relationships before creation; log skipped relationships with clear error messages
- ✅ **UX**: Show validation summary before import starts

## Implementation Plan

### Phase 0: Prepare Migration

**Purpose**: One-click preparation of exported notes for migration to a new workspace.

**File**: `Notes Implementation/notesImporter.gs` and `Sidebar_Notes.html`

#### 0.1 Add migration preparation UI

**Location**: `Sidebar_Notes.html` - Add new section after Export section

```html
<div class="section">
  <h2>🔄 Migration Preparation</h2>

  <label>
    Migration Source Name:
    <input type="text" id="migration-source-name" placeholder="e.g., ProductboardUS">
  </label>

  <button onclick="prepareMigration()">Prepare for Migration</button>

  <div id="migration-prep-status" class="status"></div>

  <div class="help-text">
    Prepares notes for migration by copying pb_id to source_record_id and clearing pb_id.
    This allows notes to be imported as NEW in the target workspace while preserving the original IDs for mapping.
    Linked entities are retained for hierarchy mapping.
  </div>
</div>
```

**JavaScript function**:
```javascript
function prepareMigration() {
  const sourceName = document.getElementById('migration-source-name').value.trim();

  if (!sourceName) {
    showStatus('migration-prep-status', '✗ Please enter a migration source name', 'error');
    return;
  }

  clearAllStatuses();
  showStatus('migration-prep-status', 'Preparing migration...', 'info');
  disableButtons(true);

  google.script.run
    .withSuccessHandler(result => {
      showStatus('migration-prep-status',
        `✓ Migration prepared! ${result.result.processedCount} notes ready. pb_id cleared, source tracking added.`,
        'success');
      disableButtons(false);
    })
    .withFailureHandler(err => {
      showStatus('migration-prep-status', `✗ Error: ${err.message}`, 'error');
      disableButtons(false);
    })
    .NotesSidebar_runAction({
      action: 'prepare-migration',
      sourceName: sourceName
    });
}
```

#### 0.2 Implement migration preparation logic

**New function** in `notesImporter.gs`:

```javascript
/**
 * Prepares notes sheet for migration to a new workspace
 * Copies pb_id → source_record_id, sets source_origin, clears pb_id
 * Preserves linked_entities for hierarchy mapping
 * @param {Object} options - { sourceName: string }
 * @returns {Object} - { success: boolean, processedCount: number, sourceName: string }
 */
function PrepareMigration_(options) {
  const sourceName = options.sourceName;

  if (!sourceName) {
    throw new Error('Migration source name is required');
  }

  const sheet = getNotesSheet_();
  const data = sheet.getDataRange().getValues();
  const headers = data[0]; // Machine keys row

  // Find column indices
  const pbIdCol = headers.indexOf('pb_id');
  const sourceOriginCol = headers.indexOf('source_origin');
  const sourceRecordIdCol = headers.indexOf('source_record_id');

  if (pbIdCol === -1 || sourceOriginCol === -1 || sourceRecordIdCol === -1) {
    throw new Error('Required columns not found in sheet');
  }

  let processedCount = 0;
  const updates = [];

  // Process each data row (skip 3 header rows)
  for (let i = 3; i < data.length; i++) {
    const row = data[i];
    const pbId = row[pbIdCol];

    if (!pbId) {
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
    const range = sheet.getRange(4, 1, updates.length, headers.length); // Start at row 4 (after 3 header rows)
    range.setValues(updates);
  }

  logResult_({
    operation: 'Prepare Migration',
    success: true,
    details: `Prepared ${processedCount} notes for migration. Source: ${sourceName}`
  });

  return {
    success: true,
    processedCount: processedCount,
    sourceName: sourceName
  };
}
```

#### 0.3 Add action handler

**Update** `notesSidebar.gs:84-137` to add new action case:

```javascript
case 'prepare-migration':
  const prepResult = PrepareMigration_({
    sourceName: request.sourceName
  });
  return { success: prepResult.success, result: prepResult };
```

**Key Features:**
- ✅ **Preserves original UUID**: Copied to `source_record_id` before clearing `pb_id`
- ✅ **Enables create logic**: Empty `pb_id` triggers note creation during import
- ✅ **Rerunnable**: If import fails, filled `pb_id` = patch, empty = create
- ✅ **Keeps hierarchy links**: `linked_entities` column unchanged for mapping

---

### Phase 1: Export - Pull Hierarchy Links (Base Functionality)

**File**: `Notes Implementation/notesExporter.gs`

#### 1.1 Add new sheet column for hierarchy links

**Location**: `notesImporter.gs:21-45` in `buildNotesHeaders_()`

Add new field after existing columns:
```javascript
{ key: 'linked_entities', label: 'Linked Entities (comma-separated UUIDs)', type: 'text' }
```

**Format**: `uuid1,uuid2,uuid3` (comma-delimited list of hierarchy entity UUIDs)

#### 1.2 Parse product link relationships

**Location**: `notesExporter.gs:553-602` in `transformNotesToSheetFormat_()`

Currently only parses `type: 'customer'` relationships. Add parsing for `type: 'link'`:

```javascript
// After existing customer relationship parsing (line ~581)
// Extract product link relationships
const productLinks = (note._relationships || [])
  .filter(r => r.type === 'link' && r.target && r.target.id)
  .map(r => r.target.id);

// Add to row data
row.push(productLinks.join(',') || ''); // linked_entities column
```

**Validation**:
- Filter out malformed relationships (missing target or id)
- Handle empty arrays gracefully (write empty string to sheet)

#### 1.3 Update export to include new column

The existing `writeNotesToSheet_()` function (notesExporter.gs:614-648) will automatically handle the new column since it writes all columns from the header definition.

**Testing**: Export notes and verify comma-delimited UUIDs appear in new column

---

### Phase 2: Link Notes to Hierarchy (Separate Operation)

**Important**: This is a SEPARATE operation from note import. Users run this AFTER importing notes.

**File**: `Notes Implementation/notesImporter.gs`

#### 2.1 Add custom field configuration with auto-detection

Add a text input in Settings section for the custom field UUID used to store original UUIDs:

```html
<label>
  Migration Custom Field UUID:
  <input type="text" id="migration-field-uuid" placeholder="Auto-detected or enter UUID">
  <button class="secondary" onclick="autoDetectMigrationField()">Auto-Detect</button>
</label>
<div id="field-detect-status" class="status"></div>
```

**Auto-detection function**:
```javascript
function autoDetectMigrationField() {
  showStatus('field-detect-status', 'Searching for custom fields...', 'info');

  google.script.run
    .withSuccessHandler(result => {
      if (result.success && result.fieldId) {
        document.getElementById('migration-field-uuid').value = result.fieldId;
        showStatus('field-detect-status',
          `✓ Found custom field "${result.fieldKey}" (${result.fieldId})`,
          'success');
      } else {
        showStatus('field-detect-status',
          '✗ No "original_uuid" custom field found. Please enter UUID manually.',
          'warning');
      }
    })
    .withFailureHandler(err => {
      showStatus('field-detect-status', `✗ Error: ${err.message}`, 'error');
    })
    .NotesSidebar_runAction({ action: 'detect-migration-field' });
}
```

**Backend auto-detection** (add to notesSidebar.gs):
```javascript
case 'detect-migration-field':
  const detectResult = detectMigrationCustomField_();
  return { success: true, fieldId: detectResult.fieldId, fieldKey: detectResult.fieldKey };
```

**Detection function** (add to notesImporter.gs):
```javascript
/**
 * Auto-detects custom field named "original_uuid" in target workspace
 * @returns {{fieldId: string|null, fieldKey: string|null}}
 */
function detectMigrationCustomField_() {
  try {
    // Query custom fields configuration
    const response = pbFetch_('get', '/v2/custom-fields');
    const customFields = response.data || [];

    // Look for field with key "original_uuid" and type "text"
    const origUuidField = customFields.find(f =>
      f.key === 'original_uuid' &&
      f.type === 'text'
    );

    if (origUuidField) {
      logProgress_(`Auto-detected migration field: ${origUuidField.key} (${origUuidField.id})`);
      return {
        fieldId: origUuidField.id,
        fieldKey: origUuidField.key
      };
    }

    return { fieldId: null, fieldKey: null };

  } catch (err) {
    Logger.log(`Failed to auto-detect migration field: ${err.message}`);
    return { fieldId: null, fieldKey: null };
  }
}
```

Save to Script Properties in `NotesSidebar_saveSettings()` (notesSidebar.gs:54-77) - store as `MIGRATION_FIELD_UUID`

#### 2.3 Build hierarchy migration lookup cache

**New function** in `notesImporter.gs`:

```javascript
/**
 * Builds lookup cache for migrated hierarchy entities
 * Maps original UUID (from custom field) → new UUID in target workspace
 * @param {string} customFieldId - UUID of the custom field containing original UUIDs
 * @returns {Map<string, string>}
 */
function buildHierarchyMigrationCache_(customFieldId) {
  const cache = new Map();

  // Fetch all entity types that notes can link to
  const entityTypes = ['features', 'components', 'products', 'subfeatures'];

  entityTypes.forEach(entityType => {
    const endpoint = `/v2/${entityType}`;
    let cursor = null;
    let entityCount = 0;

    do {
      const url = cursor ? `${endpoint}?pageCursor=${cursor}` : endpoint;
      const response = pbFetch_('get', url);

      (response.data || []).forEach(entity => {
        // Look for custom field containing original UUID
        const customFields = entity.customFields || [];
        const origUuidField = customFields.find(f => f.id === customFieldId);

        if (origUuidField && origUuidField.value) {
          // Map: original UUID → new UUID in target workspace
          cache.set(origUuidField.value, entity.id);
          entityCount++;
        }
      });

      cursor = response.links?.next ? extractCursor(response.links.next) : null;
    } while (cursor);

    logProgress_(`Scanned ${entityType}: found ${entityCount} with migration field`);
  });

  logProgress_(`Built migration cache with ${cache.size} total hierarchy entity mappings`);
  return cache;
}
```

**Note**: Entity types are not stored in cache since v2 API doesn't require them for relationship creation

#### 2.4 Create relationships after note import (with batching & progress tracking)

**New function** in `notesImporter.gs`:

**Important**: This uses the same batching pattern as `fetchRelationshipsForNotes_()` (notesExporter.gs:477-540) for consistency.

```javascript
/**
 * Creates hierarchy relationships for notes using parallel batch processing
 * Follows same pattern as fetchRelationshipsForNotes_() in exporter
 * @param {Array} notesData - Array of note data with pb_id and linked_entities
 * @param {boolean} migrationMode - If true, map UUIDs via lookup cache
 * @param {string} customFieldId - UUID of custom field for migration lookup
 */
function linkNotesToHierarchy_(notesData, migrationMode, customFieldId) {
  logToRunLog_('Notes', null, 'INFO', 'Starting hierarchy linking...', '');

  // Reset rate limiter for fresh tracking (matches existing pattern)
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

  // Batch creation with parallel execution (similar to fetchRelationshipsForNotes_)
  const BATCH_SIZE = 5; // Match RELATIONSHIP_FETCH_BATCH_SIZE
  let successCount = 0;
  let failedCount = 0;
  const errors = [];

  for (let i = 0; i < relationshipsToCreate.length; i += BATCH_SIZE) {
    const batch = relationshipsToCreate.slice(i, i + BATCH_SIZE);

    // Build parallel POST requests
    const requests = batch.map(rel => ({
      url: absoluteUrl_(`/v2/notes/${rel.noteId}/relationships`),
      method: 'post',
      headers: {
        'Authorization': `Bearer ${getApiToken_()}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({
        data: {
          type: 'link',
          target: {
            id: rel.entityId
          }
        }
      }),
      muteHttpExceptions: true
    }));

    // Execute batch in parallel
    const responses = UrlFetchApp.fetchAll(requests);

    // Process responses and check rate limits
    responses.forEach((response, index) => {
      const rel = batch[index];
      const code = response.getResponseCode();

      // Update rate limiter state from response headers (matches existing pattern)
      updateRateLimitState_(response);

      if (code >= 200 && code < 300) {
        successCount++;
      } else {
        failedCount++;
        const errorMsg = `Note ${rel.noteId} → Entity ${rel.originalEntityId}: HTTP ${code}`;
        errors.push(errorMsg);

        if (errors.length <= 10) { // Log first 10 errors to Run Log
          logToRunLog_('Notes', rel.noteId, 'ERROR',
            `Failed to link to entity ${rel.originalEntityId}`, `HTTP ${code}`);
        }
      }
    });

    // Adaptive throttling between batches (respects rate limits)
    if (i + BATCH_SIZE < relationshipsToCreate.length) {
      // Check rate limit state and adjust delay dynamically
      const rateLimitStats = getRateLimiterStats_();
      let delay = 500; // Default 500ms

      if (rateLimitStats.remaining !== null && rateLimitStats.remaining < 10) {
        // Under 10 remaining: slow down significantly
        delay = 2000;
        Logger.log(`Rate limit low (${rateLimitStats.remaining} remaining), increasing delay to ${delay}ms`);
      } else if (rateLimitStats.remaining !== null && rateLimitStats.remaining < 20) {
        // Under 20 remaining: moderate slowdown
        delay = 1000;
      }

      Utilities.sleep(delay);
      const progress = Math.min(i + BATCH_SIZE, relationshipsToCreate.length);
      Logger.log(`Created relationships: ${progress}/${relationshipsToCreate.length}`);

      // Log to Run Log every 50 relationships
      if (progress % 50 === 0 || progress === relationshipsToCreate.length) {
        logToRunLog_('Notes', null, 'INFO',
          `Linking progress: ${progress}/${relationshipsToCreate.length}`,
          `${failedCount} failures so far, ${rateLimitStats.remaining || '?'} rate limit remaining`);
      }
    }
  }

  // Final summary
  const success = errors.length === 0;
  const message = success
    ? `All ${successCount} relationships created successfully`
    : `${successCount} succeeded, ${failedCount} failed`;

  logToRunLog_('Notes', null, success ? 'INFO' : 'WARN',
    'Hierarchy linking complete', message);

  return {
    success: success,
    successCount: successCount,
    skipCount: failedCount,
    errors: errors
  };
}
```

**Key improvements matching existing patterns:**
- ✅ **Parallel execution**: Uses `UrlFetchApp.fetchAll()` with batch size of 5 (matches `RELATIONSHIP_FETCH_BATCH_SIZE`)
- ✅ **Run Log tracking**: Logs to Run Log sheet every 50 relationships via `logToRunLog_()`
- ✅ **Rate limiting**: Checks rate limit headers via `updateRateLimitState_()` and adaptively adjusts delays
  - Calls `resetRateLimiter_()` at start (like other operations)
  - Uses `getRateLimiterStats_()` to check remaining quota
  - Increases delay to 1000ms when < 20 remaining, 2000ms when < 10 remaining
- ✅ **Throttling**: Adaptive delay between batches (500ms-2000ms based on rate limits)
- ✅ **Error handling**: Continues on failure, logs first 10 errors to Run Log
- ✅ **Performance**: Creates multiple relationships simultaneously instead of sequentially

#### 2.5 Add new import action for linking

**Update** `notesSidebar.gs:84-137` to add new action case:

```javascript
case 'link-notes-to-hierarchy':
  const linkResult = LinkNotesToHierarchy_({
    migrationMode: request.migrationMode || false
  });
  return { success: linkResult.success, result: linkResult };
```

**New wrapper function** in `notesImporter.gs`:

```javascript
function LinkNotesToHierarchy_(options) {
  const migrationMode = options.migrationMode || false;

  // Validate migration mode requirements
  if (migrationMode) {
    const customFieldId = getSettings_().migrationFieldUuid;
    if (!customFieldId) {
      throw new Error('Migration mode requires custom field UUID. Please configure in Settings.');
    }
  }

  // Read notes from sheet
  const sheet = getNotesSheet_();
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

  // Log results
  logResult_({
    operation: 'Link Notes to Hierarchy',
    success: result.success,
    details: `${result.successCount} links created, ${result.skipCount} skipped`,
    errors: result.errors.slice(0, 10) // Log first 10 errors
  });

  return result;
}
```

#### 2.6 Add separate linking section in sidebar

**File**: `Sidebar_Notes.html`

**Location**: Add new section AFTER Import section (not inside it - this is a separate operation)

```html
<div class="section">
  <h2>🔗 Link Notes to Hierarchy Items</h2>

  <label class="checkbox-label">
    <input type="checkbox" id="link-migration-mode">
    Migration mode (map UUIDs via custom field)
  </label>

  <button onclick="linkNotesToHierarchy()">Link Notes to Hierarchy Items</button>

  <div id="link-status" class="status"></div>

  <div class="help-text">
    <strong>Run this AFTER importing notes.</strong> Creates relationships between notes
    and hierarchy items (features, components, products, etc.) based on UUIDs in the
    "Linked Entities" column. This is a separate operation from note import.
  </div>
</div>
```

**JavaScript function**:
```javascript
function linkNotesToHierarchy() {
  clearAllStatuses();
  showStatus('link-status', 'Linking notes to hierarchy...', 'info');
  disableButtons(true);

  const migrationMode = document.getElementById('link-migration-mode').checked;

  google.script.run
    .withSuccessHandler(result => {
      if (result.success) {
        showStatus('link-status',
          `✓ Linked notes successfully! ${result.result.successCount} links created, ${result.result.skipCount} skipped.`,
          'success');
      } else {
        showStatus('link-status',
          `✗ Some links failed. ${result.result.successCount} links created, ${result.result.skipCount} skipped. Check Run Log for details.`,
          'warning');
      }
      disableButtons(false);
    })
    .withFailureHandler(err => {
      showStatus('link-status', `✗ Error: ${err.message}`, 'error');
      disableButtons(false);
    })
    .NotesSidebar_runAction({
      action: 'link-notes-to-hierarchy',
      migrationMode: migrationMode
    });
}
```

---

### Phase 3: Validation & Error Handling

#### 3.1 Validate linked_entities column format

**Update** `ValidateNotes_()` in `notesImporter.gs:316-509`:

```javascript
// Add after existing validations (around line 450)
// Validate linked_entities format
if (linkedEntitiesStr && linkedEntitiesStr.trim()) {
  const uuids = linkedEntitiesStr.split(',').map(s => s.trim());
  const invalidUuids = uuids.filter(uuid => !isValidUuid(uuid));

  if (invalidUuids.length > 0) {
    addError(`Row ${i+1}: Invalid UUID format in linked_entities: ${invalidUuids.join(', ')}`);
  }
}
```

**Helper function**:
```javascript
function isValidUuid(str) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}
```

#### 3.2 Pre-flight validation for linking operation

Before creating relationships, validate:
1. All notes in sheet have valid `pb_id` (exist in Productboard)
2. In migration mode, all referenced UUIDs exist in migration cache
3. No duplicate relationships

**Add validation summary to UI** showing:
- Total notes with hierarchy links
- Total relationships to create
- Entities that couldn't be mapped (in migration mode)

---

### Phase 4: Documentation & Testing

#### 4.1 Update TESTING_GUIDE.md

Add new test scenarios:
- Export notes with hierarchy links
- Import with migration mode disabled (use literal UUIDs)
- Import with migration mode enabled (lookup via custom field)
- Error handling for missing entities

#### 4.2 Add inline help text

Update sidebar help text to explain:
- What the "Linked Entities" column contains
- When to use migration mode
- Prerequisites for migration (custom field setup)

---

## Critical Files to Modify

### Migration Prep (Phase 0):
1. `/Users/klaramartinez/pb-tools/importer-exporter Notes v2 v1 hybrid/Notes Implementation/notesImporter.gs`
   - Add `PrepareMigration_()` function
2. `/Users/klaramartinez/pb-tools/importer-exporter Notes v2 v1 hybrid/Notes Implementation/notesSidebar.gs`
   - Add 'prepare-migration' action case
3. `/Users/klaramartinez/pb-tools/importer-exporter Notes v2 v1 hybrid/Notes Implementation/Sidebar_Notes.html`
   - Add "Migration Preparation" section with input and button
   - Add JavaScript function `prepareMigration()`

### Export (Phase 1):
4. `/Users/klaramartinez/pb-tools/importer-exporter Notes v2 v1 hybrid/Notes Implementation/notesImporter.gs`
   - Update `buildNotesHeaders_()` to add `linked_entities` column
5. `/Users/klaramartinez/pb-tools/importer-exporter Notes v2 v1 hybrid/Notes Implementation/notesExporter.gs`
   - Update `transformNotesToSheetFormat_()` to parse product link relationships

### Import (Phase 2):
6. `/Users/klaramartinez/pb-tools/importer-exporter Notes v2 v1 hybrid/Notes Implementation/notesImporter.gs`
   - Add `detectMigrationCustomField_()` function
   - Add `buildHierarchyMigrationCache_()` function
   - Add `linkNotesToHierarchy_()` function
   - Add `LinkNotesToHierarchy_()` wrapper function
   - Add `isValidUuid()` helper function
   - Update `ValidateNotes_()` for UUID validation
7. `/Users/klaramartinez/pb-tools/importer-exporter Notes v2 v1 hybrid/Notes Implementation/notesSidebar.gs`
   - Add 'detect-migration-field' action case
   - Add 'link-notes-to-hierarchy' action case
   - Update `NotesSidebar_saveSettings()` to store migration field UUID
   - Update `NotesSidebar_getSnapshot()` to load migration field UUID
8. `/Users/klaramartinez/pb-tools/importer-exporter Notes v2 v1 hybrid/Notes Implementation/Sidebar_Notes.html`
   - Add migration mode checkbox in Import section
   - Add custom field UUID input with auto-detect button in Settings section
   - Add "Link Notes to Hierarchy" section with button and checkbox
   - Add JavaScript functions: `autoDetectMigrationField()`, `linkNotesToHierarchy()`

### Testing (Phase 4):
9. `/Users/klaramartinez/pb-tools/importer-exporter Notes v2 v1 hybrid/TESTING_GUIDE.md`
   - Add migration workflow test scenarios

---

## Migration Workflow Summary

### For Users Performing Migration:

**Step 1: Export from Source Workspace**
1. Export notes from source workspace
2. Sheet contains:
   - `pb_id` with original note UUIDs
   - `linked_entities` with old hierarchy entity UUIDs

**Step 2: Prepare Sheet for Migration**
1. In the exported sheet, enter migration source name (e.g., "ProductboardUS")
2. Click "Prepare for Migration" button
3. System automatically:
   - Copies `pb_id` → `source_record_id` (preserves original UUID)
   - Sets `source_origin` to your migration source name
   - **Clears `pb_id`** (makes them look like new notes for import)
   - **Keeps `linked_entities` unchanged** (old hierarchy UUIDs for later mapping)

**Step 3: Setup Target Workspace**
1. Import hierarchy entities (features, components, etc.) to target workspace FIRST
2. Add custom field "original_uuid" (text type) to hierarchy entities
3. Populate custom field with original UUID values from source workspace
4. In Google Sheets Settings, click "Auto-Detect" to find the custom field UUID (or enter manually)

**Step 4: Import Notes to Target Workspace**
1. Run Import Notes normally
2. Empty `pb_id` = system creates NEW notes in target workspace
3. **New `pb_id` values are automatically written back to sheet**
4. If some fail, fix errors and re-run:
   - Empty `pb_id` = create (new note)
   - Filled `pb_id` = patch (update existing note)

**Step 5: Link Notes to Hierarchy**
1. Enable "Migration mode" checkbox in the "Link Notes to Hierarchy" section
2. Click "Link Notes to Hierarchy" button
3. System automatically:
   - Reads old hierarchy UUIDs from `linked_entities` column
   - Maps old UUIDs → new UUIDs via custom field lookup
   - Creates relationships using new note UUID (from `pb_id`) and new entity UUIDs

---

## Implementation Order

1. ✅ **Phase 0** (Migration Prep) - ~1.5 hours
   - Add "Prepare Migration" UI and function
   - Copy pb_id → source_record_id, clear pb_id
   - Test migration preparation workflow
2. ✅ **Phase 1** (Export) - ~2 hours
   - Add column, parse relationships, test export
3. ✅ **Phase 2.1-2.3** (Link Notes to Hierarchy - Cache & Core Logic) - ~4 hours
   - Build migration cache, create linking function (SEPARATE from import)
4. ✅ **Phase 2.4-2.6** (Link Notes to Hierarchy - UI & Integration) - ~3 hours
   - Add separate sidebar section, wire up linking action (SEPARATE button from import)
5. ✅ **Phase 3** (Validation) - ~2 hours
   - UUID validation, pre-flight checks
6. ✅ **Phase 4** (Documentation & Testing) - ~2 hours
   - Update docs, test end-to-end workflow

**Total estimate**: ~14.5 hours of focused development time

---

## Decisions Made (Confirmed with User)

1. **Migration preparation workflow**: ✅
   - Add "Prepare Migration" button to automate pb_id → source_record_id copying
   - Clear pb_id after copying to enable create logic (empty pb_id = create, filled = patch)
   - Preserve linked_entities column with old hierarchy UUIDs for mapping
   - User specifies migration source name (e.g., "ProductboardUS") for tracking
   - Enables rerunnable imports: if some fail, re-run with filled pb_id → patch, empty → create

2. **Custom field configuration**: ✅
   - Require explicit UUID configuration in sidebar
   - Add auto-detect function to check if "original_uuid" custom field exists in target space
   - If found, auto-populate the field UUID setting (overwriteable by user)

3. **Entity type handling**: ✅
   - Store ONLY UUIDs in sheet (no entity type column needed)
   - v2 API `/v2/notes/{id}/relationships` only needs note UUID + entity UUID to link
   - Entity types are not required for creating relationships

4. **Relationship deletion**: ✅
   - Leave for future enhancement
   - Focus on MVP: creation only
   - Can iterate once working system is in place

5. **API endpoints**: ✅ CONFIRMED
   - v1: `GET /notes/{noteId}/links`, `POST /notes/{noteId}/links/{entityId}`
   - v2: `GET /v2/notes/{id}/relationships`, `POST /v2/notes/{id}/relationships`

---

## Risk Assessment

**Low Risk**:
- ✅ Export changes (read-only, no data modification)
- ✅ Adding new sheet column (doesn't affect existing data)

**Medium Risk**:
- ⚠️ Cache building (could be slow for large workspaces with many entities)
- **Mitigation**: Show progress messages, implement in chunks if needed

**Higher Risk**:
- ⚠️ Relationship creation (writes data, can't be easily undone)
- **Mitigation**:
  - Run validation before creation
  - Show summary of what will be created
  - Log all operations to Run Log sheet
  - Start with small test batches

---

## Success Metrics

- ✅ Export successfully captures all hierarchy links in comma-delimited format
- ✅ Migration mode correctly maps UUIDs via custom field lookup
- ✅ Non-migration mode (direct UUID usage) works for same-workspace operations
- ✅ Clear error messages for missing entities or invalid UUIDs
- ✅ Complete audit trail in Run Log sheet
