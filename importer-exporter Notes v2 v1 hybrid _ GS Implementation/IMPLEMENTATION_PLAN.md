# Notes Import/Export Tool - Implementation Plan

**Project:** Productboard Notes Import/Export for Google Apps Script
**Date:** February 7, 2026
**Based on:** Companies tool architecture + v2 export/v1 import hybrid approach

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture Decisions](#architecture-decisions)
3. [File Structure](#file-structure)
4. [Sheet Structure](#sheet-structure)
5. [Implementation Phases](#implementation-phases)
6. [Critical Functions Reference](#critical-functions-reference)
7. [API Call Sequences](#api-call-sequences)
8. [Testing Strategy](#testing-strategy)
9. [Deployment Checklist](#deployment-checklist)

---

## Project Overview

### Goals

- **Export** notes from Productboard (v2 API) with customer relationships
- **Import** notes to Productboard (v1 API) with automatic user/company assignment
- **Support** up to 5M notes with robust batching
- **Match** notes by pb_id or ext_id for updates
- **Backfill** archived/processed status via v2 after v1 import

### Key Requirements

| Requirement | Implementation |
|-------------|----------------|
| **Note Types** | Simple notes only (for now) |
| **Export API** | v2 (better filtering, relationships) |
| **Import API** | v1 (simpler user/company assignment) |
| **Matching** | pb_id (primary), ext_id/source.record_id (secondary) |
| **Relationships** | User email (priority) → company domain (fallback) → anonymous |
| **Data Volume** | 1K-5M notes, batching at 1K (export), 100 (import) |
| **UI/UX** | Same as Companies tool (sidebar, 3-row headers, validation) |

---

## Architecture Decisions

### Decision 1: ext_id Matching Strategy
**Chosen:** Search on-demand during import

**Implementation:**
```javascript
function findNoteBySourceRecordId_(recordId) {
  // Paginate through v1 GET /notes until match found
  let pageOffset = 0;
  const pageLimit = 100;

  while (true) {
    const response = pbFetch_('get', `/notes?pageLimit=${pageLimit}&pageOffset=${pageOffset}`);

    for (const note of response.data) {
      if (note.source?.record_id === recordId) {
        return note;
      }
    }

    if (response.data.length < pageLimit) break;
    pageOffset += pageLimit;
  }

  return null;
}
```

**Rationale:**
- Works for migration mode (external system → Productboard)
- No export dependency
- Simpler memory management

### Decision 2: Status Backfill Timing
**Chosen:** After each chunk (50 notes)

**Implementation:**
```javascript
function ImportNotesChunk_(startRow, endRow) {
  const notesForBackfill = [];

  // Phase 1: v1 import
  chunkData.forEach(row => {
    // ... create/update via v1 ...

    if (row.archived === 'TRUE' || row.processed === 'TRUE') {
      notesForBackfill.push({
        id: noteId,
        archived: row.archived === 'TRUE',
        processed: row.processed === 'TRUE'
      });
    }
  });

  // Phase 2: v2 backfill (grouped)
  if (notesForBackfill.length > 0) {
    backfillStatusBatch_(notesForBackfill);
  }
}
```

**Rationale:**
- Groups v2 calls for better rate limit utilization
- Shorter inconsistency window than end-of-import
- Simpler than per-note backfill

### Decision 3: Relationship Fetching
**Chosen:** Parallel batches of 5

**Implementation:**
```javascript
function fetchRelationshipsForNotes_(notes) {
  const BATCH_SIZE = 5;

  for (let i = 0; i < notes.length; i += BATCH_SIZE) {
    const batch = notes.slice(i, i + BATCH_SIZE);

    // Parallel fetch using UrlFetchApp.fetchAll()
    const requests = batch.map(note => ({
      url: absoluteUrl_(`/v2/notes/${note.id}/relationships`),
      method: 'get',
      headers: {
        'Authorization': `Bearer ${getApiToken_()}`,
        'Content-Type': 'application/json'
      },
      muteHttpExceptions: true
    }));

    const responses = UrlFetchApp.fetchAll(requests);

    // Parse responses
    responses.forEach((response, index) => {
      const note = batch[index];
      const data = JSON.parse(response.getContentText());
      note._relationships = data.data || [];
    });

    // Throttle between batches
    if (i + BATCH_SIZE < notes.length) {
      Utilities.sleep(500);
    }
  }
}
```

**Rationale:**
- Faster export (5x speedup vs sequential)
- Manageable rate limit impact (500ms between batches)
- Good for typical datasets (<50K notes)

### Decision 4: Empty Fields Handling
**Chosen:** Always skip empty cells (partial updates)

**Implementation:**
```javascript
function buildNotePayload_(row, isUpdate) {
  const payload = {};

  // Only include non-empty fields
  if (row.title) payload.name = row.title;
  if (row.content) payload.content = row.content;
  if (row.display_url) payload.display_url = row.display_url;

  // Relationship: user takes priority
  if (row.user_email) {
    payload.user = { email: row.user_email };
  } else if (row.company_domain) {
    payload.company = { domain: row.company_domain };
  }

  // Ownership
  if (row.owner_email) payload.owner = { email: row.owner_email };
  if (row.creator_email) payload.creator = { email: row.creator_email };

  // Tags
  if (row.tags) {
    payload.tags = row.tags.split(',').map(t => ({ name: t.trim() }));
  }

  // Source (only on creation, immutable)
  if (!isUpdate && row.source_origin && row.source_record_id) {
    payload.source = {
      origin: row.source_origin,
      record_id: row.source_record_id
    };
  }

  return payload;
}
```

**Rationale:**
- Simpler logic (no UI checkbox needed)
- Supports partial updates (change only some fields)
- Consistent with Companies tool default behavior

---

## File Structure

### Files to Create

```
/Notes Implementation/
├── notesMain.gs              (~650 lines)
│   ├── Constants (sheets, API paths, thresholds)
│   ├── UI Menu (onOpen)
│   ├── Authentication (token, workspace)
│   ├── HTTP & Rate Limiting (pbFetch_, throttle)
│   ├── Settings Management
│   └── Utilities (UUID, validation patterns)
│
├── notesExporter.gs          (~550 lines)
│   ├── ExportNotes_() - Main orchestrator
│   ├── fetchAllNotesV2_() - Cursor pagination
│   ├── fetchRelationshipsForNotes_() - Parallel fetch
│   ├── transformNotesToSheetFormat_() - Data transformation
│   ├── writeNotesToSheet_() - Batch write
│   └── ExportNotesChunk_() - Batch job processor
│
├── notesImporter.gs          (~1300 lines)
│   ├── Sheet Setup:
│   │   ├── SetupNotesSheet_()
│   │   ├── buildNotesHeaders_()
│   │   ├── readNotesSheet_()
│   │   └── deleteNotesSheet_()
│   ├── Validation:
│   │   ├── ValidateNotes_()
│   │   └── validateRow_()
│   ├── Import:
│   │   ├── ImportNotes_()
│   │   ├── ImportNotesChunk_()
│   │   ├── matchNote_()
│   │   ├── findNoteBySourceRecordId_()
│   │   ├── createNote_()
│   │   └── updateNote_()
│   ├── User Validation:
│   │   └── buildUserEmailCache_()
│   └── Status Backfill:
│       └── backfillStatusBatch_()
│
├── notesSidebar.gs           (~250 lines)
│   ├── showNotesSidebar()
│   ├── NotesSidebar_getSnapshot()
│   ├── NotesSidebar_saveSettings()
│   └── NotesSidebar_runAction()
│
├── notesBatchQueue.gs        (~300 lines)
│   └── [COPY DIRECTLY FROM COMPANIES]
│
├── notesErrorHandling.gs     (~320 lines)
│   └── [COPY FROM COMPANIES, s/Companies/Notes/g]
│
└── Sidebar_Notes.html        (~450 lines)
    └── [ADAPT FROM COMPANIES SIDEBAR]
```

### Reusability Matrix

| File | Reusable % | Source | Changes Needed |
|------|-----------|--------|----------------|
| notesBatchQueue.gs | 100% | companiesBatchQueue.gs | None - copy directly |
| notesErrorHandling.gs | 100% | companiesErrorHandling.gs | Search/replace "Companies"→"Notes" |
| notesMain.gs | 95% | companiesMain.gs | Update constants, add v2 header logic |
| notesSidebar.gs | 95% | companiesSidebar.gs | Rename functions, adapt actions |
| notesExporter.gs | 80% | companiesExporter.gs | v2 API calls, add relationships |
| notesImporter.gs | 80% | companiesImporter.gs | v1 API calls, add backfill phase |
| Sidebar_Notes.html | 90% | Sidebar_Companies.html | Update labels, entity name |

---

## Sheet Structure

### 3-Row Header Format

```
ROW 1 (Machine Keys - for code):
pb_id | ext_id | type | title | content | display_url | user_email | company_domain |
owner_email | creator_email | tags | source_origin | source_record_id | archived | processed

ROW 2 (Human Labels - for users):
PB Note ID | External ID (for matching) | Note Type | Title * | Content | Display URL |
User Email | Company Domain | Owner Email | Creator Email | Tags (comma-separated) |
Source Origin | Source Record ID | Archived | Processed

ROW 3 (Field Types - for validation):
id | text | select | text * | text | url | email | domain | email | email |
array | text | text | boolean | boolean
```

### Column Definitions

| Column | Machine Key | Type | Required | Description |
|--------|-------------|------|----------|-------------|
| A | pb_id | UUID | No | Productboard note ID (filled on export, used for updates) |
| B | ext_id | text | No | External ID for migration mode (maps to source.record_id) |
| C | type | select | No | Note type: simple \| conversation (default: simple) |
| D | title | text | Yes | Note title (v1: name, v2: fields.name) |
| E | content | text | No | Note content (HTML or plain text) |
| F | display_url | url | No | Display URL |
| G | user_email | email | No | User email (assigns note to user, auto-creates user+company) |
| H | company_domain | domain | No | Company domain (assigns note to company, used if no user_email) |
| I | owner_email | email | No | Owner email (must exist in workspace) |
| J | creator_email | email | No | Creator email (must exist in workspace) |
| K | tags | array | No | Comma-separated tags (auto-creates, replaces all) |
| L | source_origin | text | No | Source origin (immutable after creation) |
| M | source_record_id | text | No | Source record ID (immutable, used for ext_id matching) |
| N | archived | boolean | No | Archive status (backfilled via v2 after import) |
| O | processed | boolean | No | Processed status (backfilled via v2 after import) |

### Relationship Priority Logic

```
IF user_email is filled:
  → Assign to user (v1: user.email)
  → User auto-created if doesn't exist
  → Company auto-extracted from email domain
  → company_domain column is IGNORED

ELSE IF company_domain is filled:
  → Assign to company (v1: company.domain)
  → Company auto-created if doesn't exist

ELSE:
  → Anonymous note (no user or company)
```

### Sheet Setup Function

```javascript
function buildNotesHeaders_() {
  const baseFields = [
    { key: 'pb_id', label: 'PB Note ID', type: 'id' },
    { key: 'ext_id', label: 'External ID (for matching)', type: 'text' },
    { key: 'type', label: 'Note Type', type: 'select' },
    { key: 'title', label: 'Title', type: 'text *' },
    { key: 'content', label: 'Content', type: 'text' },
    { key: 'display_url', label: 'Display URL', type: 'url' },
    { key: 'user_email', label: 'User Email', type: 'email' },
    { key: 'company_domain', label: 'Company Domain', type: 'domain' },
    { key: 'owner_email', label: 'Owner Email', type: 'email' },
    { key: 'creator_email', label: 'Creator Email', type: 'email' },
    { key: 'tags', label: 'Tags (comma-separated)', type: 'array' },
    { key: 'source_origin', label: 'Source Origin', type: 'text' },
    { key: 'source_record_id', label: 'Source Record ID', type: 'text' },
    { key: 'archived', label: 'Archived', type: 'boolean' },
    { key: 'processed', label: 'Processed', type: 'boolean' }
  ];

  const row1Keys = baseFields.map(f => f.key);
  const row2Labels = baseFields.map(f => f.label);
  const row3Types = baseFields.map(f => f.type);

  return { row1Keys, row2Labels, row3Types };
}
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1)

**Goal:** Set up core infrastructure

**Tasks:**
1. Create `notesMain.gs` from `companiesMain.gs`
   - Update constants (sheet names, API paths)
   - Add v2 header handling to `pbFetch_()`
   - Keep all rate limiting, retry logic unchanged

2. Copy `notesBatchQueue.gs` directly from Companies
   - No changes needed

3. Copy `notesErrorHandling.gs` from Companies
   - Search/replace: "Companies" → "Notes"

**Constants to Define:**
```javascript
// Sheet Configuration
const HEADER_ROWS = 3;
const NOTES_SHEET = '📝 Notes';
const RUN_LOG_SHEET = '🧾 Run Log';

// API Endpoints v1
const PB_NOTES_V1 = {
  CREATE_NOTE: '/notes',
  UPDATE_NOTE: '/notes/{id}',
  GET_NOTE: '/notes/{id}',
  LIST_NOTES: '/notes'
};

// API Endpoints v2
const PB_NOTES_V2 = {
  LIST_NOTES: '/v2/notes',
  GET_NOTE: '/v2/notes/{id}',
  UPDATE_NOTE: '/v2/notes/{id}',
  GET_RELATIONSHIPS: '/v2/notes/{id}/relationships'
};

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
```

**Modified pbFetch_():**
```javascript
function pbFetch_(method, path, body, customHeaders) {
  const token = getApiToken_();
  if (!token) throw new Error('Missing API token');

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

  if (body !== undefined) {
    opt.payload = JSON.stringify(body);
  }

  const res = UrlFetchApp.fetch(url, opt);
  const code = res.getResponseCode();
  const txt = res.getContentText() || '';

  updateRateLimitState_(res);

  if (code >= 200 && code < 300) {
    return txt ? JSON.parse(txt) : {};
  }

  const retryAfter = res.getHeaders()['Retry-After'] || res.getHeaders()['retry-after'];
  const error = new Error(`PB ${method} ${url} → ${code}: ${txt}`);
  if (retryAfter) error.retryAfter = parseInt(retryAfter, 10);
  throw error;
}
```

**Testing:**
- ✅ Token validation (v1 and v2)
- ✅ Rate limiter with small requests
- ✅ Error handling and retry logic
- ✅ Batch queue creation

---

### Phase 2: Sheet Setup (Week 1-2)

**Goal:** Create Notes sheet with 3-row headers

**Tasks:**
1. Implement `SetupNotesSheet_(forceRefresh)` in `notesImporter.gs`
2. Implement `buildNotesHeaders_()`
3. Implement `getOrCreateNotesSheet_()`
4. Implement `readNotesSheet_(sheet)`
5. Implement `applyHeaderFormatting_(sheet, numCols)`
6. Implement `protectHeaderRows_(sheet)`
7. Implement `deleteNotesSheet_()`

**Key Functions:**

```javascript
function SetupNotesSheet_(forceRefresh) {
  try {
    BatchQueue_setSubProgress('Building sheet structure...', 10);

    const sheet = getOrCreateNotesSheet_();
    const headers = buildNotesHeaders_();

    // Ensure minimum rows
    if (sheet.getMaxRows() < HEADER_ROWS) {
      sheet.insertRows(1, HEADER_ROWS - sheet.getMaxRows());
    }
    sheet.setFrozenRows(HEADER_ROWS);

    // Write headers
    const numCols = headers.row1Keys.length;
    sheet.getRange(1, 1, 1, numCols).setValues([headers.row1Keys]);
    sheet.getRange(2, 1, 1, numCols).setValues([headers.row2Labels]);
    sheet.getRange(3, 1, 1, numCols).setValues([headers.row3Types]);

    BatchQueue_setSubProgress('Applying formatting...', 50);

    applyHeaderFormatting_(sheet, numCols);
    protectHeaderRows_(sheet);

    BatchQueue_setSubProgress('Sheet setup complete', 100);

    return {
      success: true,
      message: `Notes sheet ready with ${numCols} columns.`
    };
  } catch (err) {
    Logger.log('Error setting up Notes sheet: ' + err);
    throw err;
  }
}
```

```javascript
function readNotesSheet_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= HEADER_ROWS) return [];

  const lastCol = sheet.getLastColumn();
  const headerKeys = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const dataValues = sheet.getRange(HEADER_ROWS + 1, 1, lastRow - HEADER_ROWS, lastCol).getValues();

  return dataValues.map((row, index) => {
    const obj = { _row: HEADER_ROWS + 1 + index };
    headerKeys.forEach((key, colIndex) => {
      if (key) obj[key] = row[colIndex];
    });
    return obj;
  }).filter(obj => obj.title || obj.pb_id); // Skip empty rows
}
```

**Testing:**
- ✅ Create sheet and verify headers
- ✅ Read/write operations
- ✅ Protected header rows
- ✅ Dropdown validation for type column

---

### Phase 3: Export Workflow (Week 2-3)

**Goal:** Export notes via v2 API with relationships

**Tasks:**
1. Implement `ExportNotes_(options)` in `notesExporter.gs`
2. Implement `fetchAllNotesV2_()` with cursor pagination
3. Implement `fetchRelationshipsForNotes_()` with parallel batching
4. Implement `transformNotesToSheetFormat_(notes)`
5. Implement `writeNotesToSheet_(sheet, rows, replaceData)`
6. Implement `ExportNotesChunk_(pageCursor, chunkIndex, replaceData)`

**Export Main Function:**

```javascript
function ExportNotes_(options) {
  options = options || {};
  const replaceData = options.replaceData !== false;

  Logger.log('Starting export of notes...');
  resetRateLimiter_();

  try {
    BatchQueue_setSubProgress('Checking dataset size...', 5);

    // Estimate size by fetching first page
    let estimatedTotal = 0;
    let cursor = null;
    const sampleLimit = 1000;

    do {
      const url = `/v2/notes${cursor ? `?pageCursor=${cursor}` : ''}` +
                   `&fields=id,type,fields.name,fields.content,fields.display_url,` +
                   `fields.owner,fields.creator,fields.tags,fields.source,fields.archived,fields.processed`;
      const response = pbCallWithRetry_(() => pbFetch_('get', url), 'estimate dataset size');

      estimatedTotal += response.data.length;
      cursor = extractCursor_(response.links?.next);

      if (estimatedTotal >= sampleLimit) break;
    } while (cursor);

    // Batching decision
    if (estimatedTotal >= BATCH_THRESHOLD_EXPORT || cursor) {
      Logger.log(`Large dataset (${estimatedTotal}+ notes), using batch queue...`);

      const jobs = [{
        type: 'export-notes-chunk',
        pageCursor: null,
        chunkIndex: 0,
        replaceData: true
      }];

      BatchQueue_create(jobs, 'export-notes');

      return {
        batchStarted: true,
        message: `Export batch started (estimated ${estimatedTotal}+ notes)`
      };
    }

    // Small dataset - direct execution
    BatchQueue_setSubProgress('Fetching notes...', 10);
    const notes = fetchAllNotesV2_();

    if (notes.length === 0) {
      return { fetched: 0, written: 0, message: 'No notes found.' };
    }

    BatchQueue_setSubProgress('Fetching relationships...', 50);
    fetchRelationshipsForNotes_(notes);

    BatchQueue_setSubProgress('Transforming data...', 80);
    const rows = transformNotesToSheetFormat_(notes);

    BatchQueue_setSubProgress('Writing to sheet...', 90);
    const sheet = getOrCreateNotesSheet_();
    writeNotesToSheet_(sheet, rows, replaceData);

    BatchQueue_setSubProgress('Export complete', 100);

    return {
      fetched: notes.length,
      written: rows.length,
      message: `Exported ${notes.length} notes.`
    };
  } catch (err) {
    Logger.log('Error during export: ' + err);
    throw err;
  }
}
```

**Parallel Relationship Fetching:**

```javascript
function fetchRelationshipsForNotes_(notes) {
  Logger.log(`Fetching relationships for ${notes.length} notes...`);
  const BATCH_SIZE = RELATIONSHIP_FETCH_BATCH_SIZE; // 5

  for (let i = 0; i < notes.length; i += BATCH_SIZE) {
    const batch = notes.slice(i, i + BATCH_SIZE);

    // Build parallel requests
    const requests = batch.map(note => ({
      url: absoluteUrl_(`/v2/notes/${note.id}/relationships`),
      method: 'get',
      headers: {
        'Authorization': `Bearer ${getApiToken_()}`,
        'Content-Type': 'application/json'
      },
      muteHttpExceptions: true
    }));

    // Parallel fetch
    const responses = UrlFetchApp.fetchAll(requests);

    // Parse and store
    responses.forEach((response, index) => {
      const note = batch[index];
      const code = response.getResponseCode();

      if (code >= 200 && code < 300) {
        const data = JSON.parse(response.getContentText());
        note._relationships = data.data || [];
      } else {
        Logger.log(`Warning: Failed to fetch relationships for note ${note.id}: ${code}`);
        note._relationships = [];
      }
    });

    // Throttle between batches
    if (i + BATCH_SIZE < notes.length) {
      Utilities.sleep(500);
      Logger.log(`Fetched relationships: ${Math.min(i + BATCH_SIZE, notes.length)}/${notes.length}`);
    }
  }

  Logger.log('Relationship fetching complete');
}
```

**Data Transformation:**

```javascript
function transformNotesToSheetFormat_(notes) {
  return notes.map(note => {
    const row = [];

    // Extract customer relationship
    const customer = (note._relationships || []).find(r => r.type === 'customer');
    const userEmail = customer?.target?.type === 'user' ? (customer.target.email || '') : '';
    const companyDomain = customer?.target?.type === 'company' ? (customer.target.domain || '') : '';

    // Build row
    row.push(note.id);                                        // pb_id
    row.push(note.fields?.source?.recordId || '');            // ext_id
    row.push(note.type || 'simple');                          // type
    row.push(note.fields?.name || '');                        // title
    row.push(note.fields?.content || '');                     // content
    row.push(note.fields?.displayUrl || '');                  // display_url
    row.push(userEmail);                                      // user_email
    row.push(companyDomain);                                  // company_domain
    row.push(note.fields?.owner?.email || '');                // owner_email
    row.push(note.fields?.creator?.email || '');              // creator_email
    row.push((note.fields?.tags || []).map(t => t.name).join(', ')); // tags
    row.push(note.fields?.source?.origin || '');              // source_origin
    row.push(note.fields?.source?.recordId || '');            // source_record_id
    row.push(note.fields?.archived ? 'TRUE' : 'FALSE');       // archived
    row.push(note.fields?.processed ? 'TRUE' : 'FALSE');      // processed

    return row;
  });
}
```

**Testing:**
- ✅ Export 10 notes (direct)
- ✅ Export 100 notes (direct)
- ✅ Export 1000 notes (batched)
- ✅ Verify relationships extracted correctly
- ✅ Verify data transformation accuracy

---

### Phase 4: Validation (Week 3)

**Goal:** Pre-import validation with detailed error logging

**Tasks:**
1. Implement `ValidateNotes_()` in `notesImporter.gs`
2. Implement validation helper functions
3. Test with various error scenarios

**Validation Function:**

```javascript
function ValidateNotes_() {
  clearRunLog_();
  logToRunLog_('Notes', null, 'INFO', 'Starting validation (dry-run)...', '');

  const sheet = getOrCreateNotesSheet_();
  const data = readNotesSheet_(sheet);

  const result = {
    errors: 0,
    warnings: 0,
    totalRows: data.length,
    success: true
  };

  if (data.length === 0) {
    result.summary = 'No data rows to validate';
    return result;
  }

  const extIdsSeen = new Set();

  data.forEach((row, index) => {
    const rowNum = row._row;
    const errors = [];
    const warnings = [];

    // Required fields
    if (!row.title || String(row.title).trim() === '') {
      errors.push('Title is required');
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

    if (row.type && !['simple', 'conversation'].includes(row.type)) {
      errors.push('type must be "simple" or "conversation"');
    }

    // Logic validation
    const hasOrigin = row.source_origin && String(row.source_origin).trim();
    const hasRecordId = row.source_record_id && String(row.source_record_id).trim();

    if (hasOrigin && !hasRecordId) {
      errors.push('source_origin requires source_record_id');
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

    // Log errors and warnings
    errors.forEach(err => {
      logToRunLog_('Notes', rowNum, 'ERROR', err, '');
      result.errors++;
    });

    warnings.forEach(warn => {
      logToRunLog_('Notes', rowNum, 'WARN', warn, '');
      result.warnings++;
    });
  });

  // Summary
  if (result.errors === 0) {
    result.success = true;
    result.summary = `Validation complete: ${result.totalRows} rows, ${result.warnings} warnings, no errors.`;
  } else {
    result.success = false;
    result.summary = `Validation failed: ${result.errors} errors, ${result.warnings} warnings in ${result.totalRows} rows.`;
  }

  logToRunLog_('Notes', null, result.success ? 'SUCCESS' : 'ERROR', result.summary, '');

  return result;
}
```

**Testing:**
- ✅ Valid data (no errors)
- ✅ Missing required field (error)
- ✅ Invalid email format (error)
- ✅ Invalid UUID format (error)
- ✅ Duplicate ext_id (error)
- ✅ Source fields mismatch (error)
- ✅ Both user_email and company_domain (warning)

---

### Phase 5: Import Workflow - v1 (Week 4-5)

**Goal:** Import notes via v1 API with matching and user validation

**Tasks:**
1. Implement `ImportNotes_()`
2. Implement `ImportNotesChunk_(startRow, endRow)`
3. Implement `matchNote_(row)`
4. Implement `findNoteBySourceRecordId_(recordId)`
5. Implement `createNote_(row, rowNum)`
6. Implement `updateNote_(noteId, row, rowNum)`
7. Implement `buildUserEmailCache_()`

**Import Main Function:**

```javascript
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
```

**Import Chunk Function:**

```javascript
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

    // Build user email cache for owner validation
    BatchQueue_setSubProgress('Building user cache...', 5);
    const validUsers = buildUserEmailCache_();

    // Track notes needing status backfill
    const notesForBackfill = [];

    // Process each note
    chunkData.forEach((row, index) => {
      const rowNum = row._row;
      const progressPercent = 5 + Math.round((index / chunkData.length) * 70);
      BatchQueue_setSubProgress(`Importing note ${index + 1}/${chunkData.length}...`, progressPercent);

      try {
        // Validate owner/creator emails
        if (row.owner_email && !validUsers.has(row.owner_email.toLowerCase())) {
          logToRunLog_('Notes', rowNum, 'WARN',
            `Owner email not found: ${row.owner_email}. Skipping owner assignment.`, '');
          row.owner_email = null;
        }

        if (row.creator_email && !validUsers.has(row.creator_email.toLowerCase())) {
          logToRunLog_('Notes', rowNum, 'WARN',
            `Creator email not found: ${row.creator_email}. Skipping creator assignment.`, '');
          row.creator_email = null;
        }

        // Match note
        const match = matchNote_(row);

        // Create or update
        let noteId;
        if (match.action === 'CREATE') {
          const newNote = createNote_(row, rowNum);
          noteId = newNote.id;
          result.created++;
        } else {
          updateNote_(match.noteId, row, rowNum);
          noteId = match.noteId;
          result.updated++;
        }

        // Track for backfill if status fields present
        if (row.archived === 'TRUE' || row.processed === 'TRUE') {
          notesForBackfill.push({
            id: noteId,
            archived: row.archived === 'TRUE',
            processed: row.processed === 'TRUE'
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
      backfillStatusBatch_(notesForBackfill);
    }

    result.success = result.errors === 0;
    result.summary = `Chunk ${startRow}-${endRow}: ${result.created} created, ${result.updated} updated, ${result.errors} errors.`;

    logToRunLog_('Notes', null, result.success ? 'SUCCESS' : 'WARN', result.summary, '');

    return result;

  } catch (err) {
    Logger.log(`Error importing chunk: ${err}`);
    result.errors++;
    result.success = false;
    result.summary = `Chunk error: ${err.message}`;
    return result;
  }
}
```

**Matching Logic:**

```javascript
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
```

**Search by ext_id (on-demand):**

```javascript
function findNoteBySourceRecordId_(recordId) {
  Logger.log(`Searching for note with source.record_id: ${recordId}`);

  let pageOffset = 0;
  const pageLimit = 100;
  let found = null;

  while (true) {
    try {
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
```

**Create Note (v1):**

```javascript
function createNote_(row, rowNum) {
  const newId = Utilities.getUuid();

  const payload = {
    id: newId,  // REQUIRED for v1 POST
    name: row.title
  };

  // Only include non-empty fields
  if (row.content) payload.content = row.content;
  if (row.display_url) payload.display_url = row.display_url;

  // Relationship (user takes priority)
  if (row.user_email) {
    payload.user = { email: row.user_email };
  } else if (row.company_domain) {
    payload.company = { domain: row.company_domain };
  }

  // Ownership
  if (row.owner_email) payload.owner = { email: row.owner_email };
  if (row.creator_email) payload.creator = { email: row.creator_email };

  // Tags
  if (row.tags) {
    payload.tags = row.tags.split(',').map(t => ({ name: t.trim() }));
  }

  // Source (immutable, only on creation)
  if (row.source_origin && row.source_record_id) {
    payload.source = {
      origin: row.source_origin,
      record_id: row.source_record_id
    };
  }

  const response = pbCallWithRetry_(() => {
    return pbFetch_('post', '/notes', payload);
  }, `create note (row ${rowNum})`);

  // Write pb_id back to sheet
  const sheet = getOrCreateNotesSheet_();
  sheet.getRange(rowNum, 1).setValue(newId);

  logToRunLog_('Notes', rowNum, 'SUCCESS', `Created note: ${row.title}`, `ID: ${newId}`);

  return { id: newId, ...response };
}
```

**Update Note (v1):**

```javascript
function updateNote_(noteId, row, rowNum) {
  const payload = {};

  // Only include non-empty fields
  if (row.title) payload.name = row.title;
  if (row.content) payload.content = row.content;
  if (row.display_url) payload.display_url = row.display_url;

  // Relationship
  if (row.user_email) {
    payload.user = { email: row.user_email };
  } else if (row.company_domain) {
    payload.company = { domain: row.company_domain };
  }

  // Ownership
  if (row.owner_email) payload.owner = { email: row.owner_email };
  if (row.creator_email) payload.creator = { email: row.creator_email };

  // Tags
  if (row.tags) {
    payload.tags = row.tags.split(',').map(t => ({ name: t.trim() }));
  }

  // NOTE: source is immutable, cannot be updated

  const response = pbCallWithRetry_(() => {
    return pbFetch_('patch', `/notes/${noteId}`, payload);
  }, `update note (row ${rowNum})`);

  logToRunLog_('Notes', rowNum, 'SUCCESS', `Updated note: ${row.title}`, `ID: ${noteId}`);

  return response;
}
```

**User Email Cache:**

```javascript
function buildUserEmailCache_() {
  Logger.log('Building user email cache...');
  const users = new Set();

  let pageOffset = 0;
  const pageLimit = 100;

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
        }
      });

      if (response.data.length < pageLimit) {
        break;
      }
      pageOffset += pageLimit;

    } catch (err) {
      Logger.log(`Warning: Error fetching users: ${err}`);
      break;
    }
  }

  Logger.log(`User cache built: ${users.size} emails`);
  return users;
}
```

**Testing:**
- ✅ Create new notes
- ✅ Update by pb_id
- ✅ Update by ext_id (search)
- ✅ User email validation (skip if not found)
- ✅ Owner/creator email validation
- ✅ Relationship assignment (user vs company)
- ✅ Tags creation and update

---

### Phase 6: Status Backfill - v2 (Week 5)

**Goal:** Backfill archived/processed status after v1 import

**Tasks:**
1. Implement `backfillStatusBatch_(notes)`

**Backfill Function:**

```javascript
function backfillStatusBatch_(notes) {
  if (notes.length === 0) return;

  Logger.log(`Backfilling status for ${notes.length} notes via v2...`);

  let backfilled = 0;
  let failed = 0;

  notes.forEach((note, index) => {
    try {
      const patchOps = [];

      if (note.archived !== undefined) {
        patchOps.push({ op: 'set', path: 'archived', value: note.archived });
      }

      if (note.processed !== undefined) {
        patchOps.push({ op: 'set', path: 'processed', value: note.processed });
      }

      if (patchOps.length > 0) {
        pbCallWithRetry_(() => {
          return pbFetch_('patch', `/v2/notes/${note.id}`, {
            data: { patch: patchOps }
          });
        }, `backfill status for note ${note.id}`);

        backfilled++;
      }

      // Rate limit: Sleep every 20 notes
      if ((index + 1) % 20 === 0 && (index + 1) < notes.length) {
        Utilities.sleep(1000);
        Logger.log(`Backfilled ${index + 1}/${notes.length} notes...`);
      }

    } catch (err) {
      failed++;
      Logger.log(`Warning: Failed to backfill status for note ${note.id}: ${err}`);
      logToRunLog_('Notes', null, 'WARN',
        `Failed to backfill status for note ${note.id}`, String(err));
    }
  });

  Logger.log(`Status backfill complete: ${backfilled} succeeded, ${failed} failed`);
}
```

**Testing:**
- ✅ Backfill archived status
- ✅ Backfill processed status
- ✅ Backfill both statuses
- ✅ Handle errors gracefully
- ✅ Rate limiting (20 notes per second)

---

### Phase 7: Sidebar UI (Week 6)

**Goal:** Create sidebar UI for user interaction

**Tasks:**
1. Implement `notesSidebar.gs`
2. Create `Sidebar_Notes.html`
3. Implement action dispatcher
4. Test all UI interactions

**Sidebar Bridge:**

```javascript
function showNotesSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar_Notes')
    .setTitle('Notes Import/Export')
    .setWidth(350);
  SpreadsheetApp.getUi().showSidebar(html);
}

function NotesSidebar_getSnapshot() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('PB_API_TOKEN') || '';
  const workspaceName = props.getProperty('WORKSPACE_NAME') || '';
  const useEuDatacenter = props.getProperty('USE_EU_DATACENTER') === 'true';

  // Check if sheets exist
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const notesSheet = ss.getSheetByName(NOTES_SHEET);
  const runLogSheet = ss.getSheetByName(RUN_LOG_SHEET);

  // Get batch queue status
  const batchStatus = BatchQueue_getStatus();

  return {
    hasToken: !!token,
    maskedToken: token ? maskToken_(token) : '',
    workspaceName: workspaceName,
    useEuDatacenter: useEuDatacenter,
    hasNotesSheet: !!notesSheet,
    hasRunLogSheet: !!runLogSheet,
    batchStatus: batchStatus
  };
}

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

  return { success: true, message: 'Settings saved successfully' };
}

function NotesSidebar_runAction(request) {
  const action = request.action;

  try {
    switch (action) {
      case 'setup-notes-sheet':
        return { success: true, result: SetupNotesSheet_(true) };

      case 'delete-notes-sheet':
        return { success: true, result: deleteNotesSheet_() };

      case 'export-notes':
        const exportResult = ExportNotes_({ replaceData: request.replaceData });
        if (exportResult.batchStarted) return exportResult;
        return { success: true, result: exportResult };

      case 'validate-notes':
        const validateResult = ValidateNotes_();
        return { success: validateResult.success, result: validateResult };

      case 'import-notes':
        const importResult = ImportNotes_();
        if (importResult.batchStarted) return importResult;
        return { success: importResult.success, result: importResult };

      case 'batch-next':
        return BatchQueue_processNext();

      case 'batch-clear':
        BatchQueue_clear();
        return { success: true, message: 'Batch queue cleared' };

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
```

**HTML Sidebar (simplified structure):**

```html
<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <?!= HtmlService.createHtmlOutputFromFile('Shared_Style').getContent(); ?>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <h1>📝 Notes Import/Export</h1>
    </div>

    <!-- Export Section -->
    <div class="section">
      <h2>📥 Export</h2>
      <button onclick="exportNotes()">Export Notes</button>
      <div id="export-status" class="status"></div>
    </div>

    <!-- Validate Section -->
    <div class="section">
      <h2>✅ Validate</h2>
      <button onclick="validateNotes()">Validate Import</button>
      <div id="validate-status" class="status"></div>
    </div>

    <!-- Import Section -->
    <div class="section">
      <h2>📤 Import</h2>
      <button onclick="importNotes()">Import Notes</button>
      <div id="import-status" class="status"></div>
    </div>

    <!-- Batch Progress -->
    <div id="batch-section" class="section" style="display:none;">
      <h2>⏳ Batch Progress</h2>
      <div class="progress-bar">
        <div id="progress-fill" class="progress-fill"></div>
      </div>
      <p id="batch-progress-text">0%</p>
      <button onclick="processBatchNext()">Process Next Batch</button>
      <button onclick="clearBatch()">Clear Queue</button>
    </div>

    <!-- Settings -->
    <div class="section">
      <h2>⚙️ Settings</h2>
      <label>API Token:</label>
      <input type="password" id="api-token" placeholder="Enter token">
      <label>Workspace Name:</label>
      <input type="text" id="workspace-name" placeholder="Optional">
      <label>
        <input type="checkbox" id="eu-datacenter">
        EU Datacenter
      </label>
      <button onclick="saveSettings()">Save Settings</button>
    </div>
  </div>

  <?!= HtmlService.createHtmlOutputFromFile('Shared_Client').getContent(); ?>

  <script>
    // Load snapshot
    google.script.run
      .withSuccessHandler(snapshot => {
        if (snapshot.hasToken) {
          document.getElementById('api-token').placeholder = snapshot.maskedToken;
        }
        document.getElementById('workspace-name').value = snapshot.workspaceName || '';
        document.getElementById('eu-datacenter').checked = snapshot.useEuDatacenter || false;

        if (snapshot.batchStatus && snapshot.batchStatus.isActive) {
          showBatchProgress(snapshot.batchStatus);
        }
      })
      .NotesSidebar_getSnapshot();

    // Export
    function exportNotes() {
      showStatus('export-status', 'Exporting notes...', 'info');
      google.script.run
        .withSuccessHandler(result => {
          if (result.batchStarted) {
            showStatus('export-status', result.message, 'info');
            showBatchProgress({ isActive: true, percent: 0 });
            startBatchPolling();
          } else {
            showStatus('export-status', result.result.message, 'success');
          }
        })
        .withFailureHandler(err => {
          showStatus('export-status', 'Error: ' + err, 'error');
        })
        .NotesSidebar_runAction({ action: 'export-notes', replaceData: true });
    }

    // Validate
    function validateNotes() {
      showStatus('validate-status', 'Validating...', 'info');
      google.script.run
        .withSuccessHandler(result => {
          showStatus('validate-status', result.result.summary, result.success ? 'success' : 'error');
        })
        .withFailureHandler(err => {
          showStatus('validate-status', 'Error: ' + err, 'error');
        })
        .NotesSidebar_runAction({ action: 'validate-notes' });
    }

    // Import
    function importNotes() {
      showStatus('import-status', 'Importing notes...', 'info');
      google.script.run
        .withSuccessHandler(result => {
          if (result.batchStarted) {
            showStatus('import-status', result.message, 'info');
            showBatchProgress({ isActive: true, percent: 0 });
            startBatchPolling();
          } else {
            showStatus('import-status', result.result.summary, 'success');
          }
        })
        .withFailureHandler(err => {
          showStatus('import-status', 'Error: ' + err, 'error');
        })
        .NotesSidebar_runAction({ action: 'import-notes' });
    }

    // Batch processing
    function processBatchNext() {
      google.script.run
        .withSuccessHandler(result => {
          updateBatchProgress(result.status);
        })
        .NotesSidebar_runAction({ action: 'batch-next' });
    }

    function startBatchPolling() {
      const interval = setInterval(() => {
        processBatchNext();
      }, 2000);
    }

    function showBatchProgress(status) {
      document.getElementById('batch-section').style.display = 'block';
      updateBatchProgress(status);
    }

    function updateBatchProgress(status) {
      const percent = status.percent || 0;
      document.getElementById('progress-fill').style.width = percent + '%';
      document.getElementById('batch-progress-text').textContent = percent + '% - ' + (status.message || '');

      if (status.isComplete) {
        document.getElementById('batch-section').style.display = 'none';
      }
    }

    // Settings
    function saveSettings() {
      const apiToken = document.getElementById('api-token').value;
      const workspaceName = document.getElementById('workspace-name').value;
      const useEuDatacenter = document.getElementById('eu-datacenter').checked;

      google.script.run
        .withSuccessHandler(result => {
          alert(result.message);
        })
        .NotesSidebar_saveSettings({
          apiToken: apiToken || undefined,
          workspaceName: workspaceName,
          useEuDatacenter: useEuDatacenter
        });
    }

    function showStatus(elementId, message, type) {
      const el = document.getElementById(elementId);
      el.textContent = message;
      el.className = 'status ' + type;
    }
  </script>
</body>
</html>
```

**Testing:**
- ✅ All buttons functional
- ✅ Progress bar updates
- ✅ Settings save/load
- ✅ Batch polling works
- ✅ Error messages display

---

### Phase 8: Testing & Optimization (Week 7)

**Goal:** Comprehensive testing and performance optimization

**Test Scenarios:**

| Test | Dataset Size | Expected Result |
|------|--------------|-----------------|
| Export Small | 10 notes | Direct execution, <10s |
| Export Medium | 100 notes | Direct execution, <30s |
| Export Large | 1000 notes | Batch mode, 5 chunks |
| Export Very Large | 10,000 notes | Batch mode, 50 chunks |
| Import Create | 50 new notes | Direct execution, all created |
| Import Update (pb_id) | 50 existing notes | Direct execution, all updated |
| Import Update (ext_id) | 50 existing notes | Search matching, all updated |
| Import Mixed | 25 new + 25 existing | Direct execution, 25 created + 25 updated |
| Import Large | 500 notes | Batch mode, 10 chunks |
| Validation Errors | Invalid data | All errors caught, no import |
| Rate Limit | Rapid requests | Throttling prevents 429 errors |
| Owner Email Missing | Invalid owner | Gracefully skip owner, note created |
| Status Backfill | 50 notes with status | All statuses updated via v2 |

**Performance Benchmarks:**

| Operation | Baseline | Target | Actual |
|-----------|----------|--------|--------|
| Export 100 notes | 30s | <20s | ___ |
| Export 1000 notes | 5min | <3min | ___ |
| Import 100 notes | 2min | <90s | ___ |
| Import 1000 notes | 20min | <12min | ___ |
| Relationship fetch (100) | 60s | <30s | ___ |

**Optimization Checklist:**
- ✅ Batch size tuning (export: 200, import: 50)
- ✅ Relationship fetch parallelization (5 at a time)
- ✅ User cache built once per import
- ✅ Rate limiter adaptive throttling
- ✅ Minimal memory usage (stream to sheet)
- ✅ Error recovery (retry with backoff)

---

## Critical Functions Reference

### Core Infrastructure

| Function | File | Purpose |
|----------|------|---------|
| pbFetch_(method, path, body) | notesMain.gs | Unified HTTP helper (v1/v2) |
| throttleRequest_() | notesMain.gs | Rate limiting with adaptive throttling |
| pbCallWithRetry_() | notesMain.gs | Retry logic with exponential backoff |
| BatchQueue_create() | notesBatchQueue.gs | Create batch jobs |
| BatchQueue_processNext() | notesBatchQueue.gs | Process next job in queue |
| handleApiError_() | notesErrorHandling.gs | Parse and format API errors |

### Export Functions

| Function | File | Purpose |
|----------|------|---------|
| ExportNotes_(options) | notesExporter.gs | Main export orchestrator |
| fetchAllNotesV2_() | notesExporter.gs | Cursor pagination for v2 API |
| fetchRelationshipsForNotes_() | notesExporter.gs | Parallel relationship fetching |
| transformNotesToSheetFormat_() | notesExporter.gs | Transform API data to sheet rows |
| writeNotesToSheet_() | notesExporter.gs | Batch write to sheet |
| ExportNotesChunk_() | notesExporter.gs | Batch job processor |

### Import Functions

| Function | File | Purpose |
|----------|------|---------|
| ImportNotes_() | notesImporter.gs | Main import orchestrator |
| ValidateNotes_() | notesImporter.gs | Pre-import validation |
| ImportNotesChunk_() | notesImporter.gs | Batch job processor |
| matchNote_(row) | notesImporter.gs | Determine create vs update |
| findNoteBySourceRecordId_() | notesImporter.gs | Search by ext_id |
| createNote_() | notesImporter.gs | Create note via v1 |
| updateNote_() | notesImporter.gs | Update note via v1 |
| buildUserEmailCache_() | notesImporter.gs | Build user email validation cache |
| backfillStatusBatch_() | notesImporter.gs | Backfill archived/processed via v2 |

### Sheet Management

| Function | File | Purpose |
|----------|------|---------|
| SetupNotesSheet_() | notesImporter.gs | Create/refresh sheet with headers |
| buildNotesHeaders_() | notesImporter.gs | Build 3-row header arrays |
| readNotesSheet_() | notesImporter.gs | Read sheet data into objects |
| getOrCreateNotesSheet_() | notesImporter.gs | Get or create Notes sheet |
| deleteNotesSheet_() | notesImporter.gs | Delete Notes sheet |

### UI Bridge

| Function | File | Purpose |
|----------|------|---------|
| showNotesSidebar() | notesSidebar.gs | Show sidebar UI |
| NotesSidebar_getSnapshot() | notesSidebar.gs | Get workspace state |
| NotesSidebar_saveSettings() | notesSidebar.gs | Save settings |
| NotesSidebar_runAction() | notesSidebar.gs | Action dispatcher |

---

## API Call Sequences

### Export Sequence (v2)

```
1. Check dataset size
   GET /v2/notes?fields=id
   → Estimate total count by paginating sample

2. Fetch notes (paginated)
   GET /v2/notes?fields=id,type,fields.name,fields.content,fields.display_url,
                       fields.owner,fields.creator,fields.tags,fields.source,
                       fields.archived,fields.processed
   → Parse response
   → Extract pageCursor from links.next

   GET /v2/notes?pageCursor={cursor}&fields=...
   → Repeat until links.next is null

3. Fetch relationships (parallel batches)
   UrlFetchApp.fetchAll([
     GET /v2/notes/{id1}/relationships,
     GET /v2/notes/{id2}/relationships,
     GET /v2/notes/{id3}/relationships,
     GET /v2/notes/{id4}/relationships,
     GET /v2/notes/{id5}/relationships
   ])
   → Sleep 500ms
   → Repeat for next batch

4. Transform to sheet format (in-memory)

5. Write to sheet (batch)
```

### Import Sequence (v1 + v2)

```
1. Validation (local)
   → Read sheet data
   → Validate formats, required fields
   → Log errors to Run Log

2. Build user cache (v1)
   GET /users?pageLimit=100&pageOffset=0
   Headers: { X-Version: 1 }
   → Repeat pagination
   → Build Set of valid emails

3. For each note:

   3a. Match note
       IF ext_id exists:
         → Search: GET /notes?pageLimit=100&pageOffset=0
         → Iterate through pages to find match
       ELSE IF pb_id exists:
         → Check: GET /notes/{pb_id}
       ELSE:
         → CREATE new

   3b. Create note (v1)
       POST /notes
       Headers: { X-Version: 1 }
       Body: {
         "id": "generated-uuid",
         "name": "Title",
         "content": "Content",
         "user": { "email": "user@example.com" },
         "owner": { "email": "owner@example.com" },
         "tags": [{ "name": "tag1" }],
         "source": { "origin": "...", "record_id": "..." }
       }
       → Write pb_id back to sheet

   3c. Update note (v1)
       PATCH /notes/{id}
       Headers: { X-Version: 1 }
       Body: {
         "name": "Updated Title",
         "content": "Updated Content",
         "user": { "email": "new-user@example.com" },
         "tags": [{ "name": "tag1" }, { "name": "tag2" }]
       }

4. Status backfill (v2)
   For each note needing status update:

   PATCH /v2/notes/{id}
   Headers: { NO X-Version }
   Body: {
     "data": {
       "patch": [
         { "op": "set", "path": "archived", "value": true },
         { "op": "set", "path": "processed", "value": true }
       ]
     }
   }

   → Sleep 1s every 20 notes
```

---

## Testing Strategy

### Unit Tests

```javascript
// Test transformation
function test_transformNoteToSheetRow() {
  const note = {
    id: 'note-123',
    type: 'simple',
    fields: {
      name: 'Test',
      content: 'Content',
      tags: [{ name: 'tag1' }]
    },
    _relationships: [
      { type: 'customer', target: { type: 'user', email: 'user@example.com' } }
    ]
  };

  const row = transformNoteToSheetRow_(note);
  console.assert(row[0] === 'note-123');
  console.assert(row[3] === 'Test');
  console.assert(row[6] === 'user@example.com');
}

// Test matching
function test_matchNote() {
  const row1 = { ext_id: 'ext-123', pb_id: '' };
  const match1 = matchNote_(row1);
  console.assert(['UPDATE', 'CREATE'].includes(match1.action));
}

// Test validation
function test_validateNotes() {
  // Mock data with errors
  const result = ValidateNotes_();
  console.assert(typeof result.errors === 'number');
  console.assert(typeof result.success === 'boolean');
}
```

### Integration Tests

**Test 1: Export 100 Notes**
- Create 100 test notes in PB
- Run export
- Verify 100 rows in sheet
- Verify data accuracy
- Cleanup

**Test 2: Import 50 Notes (Create)**
- Write 50 test rows to sheet
- Run import
- Verify 50 notes created in PB
- Verify data accuracy
- Cleanup

**Test 3: Import 50 Notes (Update)**
- Export 50 existing notes
- Modify in sheet
- Run import
- Verify 50 notes updated
- Verify changes applied

**Test 4: Large Dataset Batch (1000 Notes)**
- Create 1000 test notes
- Run export (should batch)
- Verify batch jobs created
- Process all jobs
- Verify 1000 rows in sheet

**Test 5: Status Backfill**
- Import 50 notes with archived/processed
- Verify v1 import succeeds
- Verify v2 backfill succeeds
- Verify status values correct

### User Acceptance Testing

**Scenario 1: Export workflow**
1. User clicks "Export Notes"
2. Progress shows "Fetching notes..."
3. Sheet populates with data
4. Success message displays

**Scenario 2: Import workflow**
1. User modifies notes in sheet
2. User clicks "Validate"
3. Validation results show warnings
4. User clicks "Import"
5. Progress shows "Importing..."
6. Success message: "50 created, 50 updated"

**Scenario 3: Error handling**
1. User enters invalid email
2. Validation catches error
3. User fixes error
4. Import succeeds

---

## Deployment Checklist

### Pre-Deployment

- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] UAT scenarios completed
- [ ] Performance benchmarks met
- [ ] Documentation complete
- [ ] Code reviewed

### Deployment Steps

1. [ ] Create Google Apps Script project
2. [ ] Copy all `.gs` files
3. [ ] Copy all `.html` files
4. [ ] Configure OAuth scopes
5. [ ] Test token validation
6. [ ] Test small export (10 notes)
7. [ ] Test small import (10 notes)
8. [ ] Test validation
9. [ ] Test batching (1000 notes)
10. [ ] Deploy to users

### Post-Deployment

- [ ] Monitor error logs
- [ ] Track API rate limit usage
- [ ] Collect user feedback
- [ ] Document known issues
- [ ] Plan next iterations

---

## Summary

This implementation plan provides a complete roadmap for building a Notes Import/Export tool that:

✅ **Reuses** 95% of proven Companies tool patterns
✅ **Leverages** v2 API for export (better filtering, relationships)
✅ **Leverages** v1 API for import (simpler user/company assignment)
✅ **Scales** to 5M notes with robust batching
✅ **Validates** data before import (catch errors early)
✅ **Backfills** archived/processed status via v2 after v1 import
✅ **Handles** errors gracefully (owner email validation, rate limits)
✅ **Provides** user-friendly UI (same as Companies)

**Total Timeline:** 7 weeks (6 weeks implementation + 1 week testing)

**Success Metrics:**
- Export 1000 notes in <3 minutes
- Import 1000 notes in <12 minutes
- Zero data loss or corruption
- <1% error rate on valid data
- User satisfaction: "Works like Companies tool"

---

**Ready to implement!** 🚀
