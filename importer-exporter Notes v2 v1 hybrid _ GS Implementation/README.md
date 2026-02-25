# Productboard Notes Import/Export Tool

**Version:** 2.2 (Hybrid v1/v2 Implementation)
**Platform:** Google Apps Script for Google Sheets
**API:** Productboard API v1 & v2
**Last Updated:** February 7, 2026

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Features](#features)
4. [Installation](#installation)
5. [File Structure](#file-structure)
6. [Configuration](#configuration)
7. [Usage Guide](#usage-guide)
8. [API Integration](#api-integration)
9. [Data Schema](#data-schema)
10. [Batch Processing](#batch-processing)
11. [Error Handling](#error-handling)
12. [Rate Limiting](#rate-limiting)
13. [Troubleshooting](#troubleshooting)
14. [Development Guide](#development-guide)

---

## Overview

This tool provides a robust, enterprise-grade solution for importing and exporting Productboard Notes via Google Sheets. It leverages a hybrid API approach:

- **v2 API** for efficient export (cursor-based pagination, batch relationship fetching)
- **v1 API** for reliable import (stable CRUD operations)
- **v2 API** for backfilling fields not supported in v1 (archived, processed, creator)

### Why Hybrid v1/v2?

- **v1 API**: More stable for write operations (POST/PATCH), handles tags as strings
- **v2 API**: Better for read operations, required for status fields (archived/processed)
- **Best of Both**: Combines reliability of v1 writes with efficiency of v2 reads

---

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                       Google Sheets UI                       │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐│
│  │  📝 Notes      │  │  🧾 Run Log    │  │  Sidebar UI    ││
│  │  Sheet         │  │  Sheet         │  │  (HTML/JS)     ││
│  └────────────────┘  └────────────────┘  └────────────────┘│
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│              Google Apps Script Backend (.gs)                │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  notesMain.gs - Core Foundation                      │  │
│  │  • Constants & Config                                │  │
│  │  • Authentication                                    │  │
│  │  • Rate Limiting (Adaptive Throttling)              │  │
│  │  • HTTP Communication (pbFetch_)                    │  │
│  │  • Retry Logic (Exponential Backoff)                │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  notesExporter.gs - Export Workflow                  │  │
│  │  • User/company cache building (v1 bulk fetch)      │  │
│  │  • Sheet-based cache storage/retrieval              │  │
│  │  • Cursor-based pagination (v2)                     │  │
│  │  • Parallel relationship fetching                   │  │
│  │  • Sheet writing with batching                      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  notesImporter.gs - Import Workflow                  │  │
│  │  • Sheet setup & validation                         │  │
│  │  • Note matching (pb_id, ext_id)                    │  │
│  │  • Create/Update via v1 API                         │  │
│  │  • Status backfill via v2 API                       │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  notesBatchQueue.gs - Batch Processing               │  │
│  │  • Job queue management                             │  │
│  │  • Progress tracking                                │  │
│  │  • Auto-polling coordination                        │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  notesErrorHandling.gs - Error Management            │  │
│  │  • Standardized error objects                       │  │
│  │  • Category-based error handling                    │  │
│  │  • Detailed logging                                 │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  notesSidebar.gs - UI Bridge                         │  │
│  │  • Backend → Frontend communication                 │  │
│  │  • Action routing                                   │  │
│  │  • State management                                 │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                    Productboard API                          │
│  ┌────────────────────┐  ┌────────────────────┐            │
│  │  v1 API            │  │  v2 API            │            │
│  │  • POST /notes     │  │  • GET /v2/notes   │            │
│  │  • PATCH /notes/id │  │  • PATCH /v2/notes │            │
│  │  • GET /notes      │  │  • Relationships   │            │
│  └────────────────────┘  └────────────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

#### Export Flow
1. User clicks "Export Notes" → `ExportNotes_()`
2. Check dataset size (v2 pagination cursor count)
3. **Small dataset (<1000)**: Direct execution
   - Build user/company lookup caches (v1 API bulk fetch)
   - Fetch all notes with cursor pagination (v2 API)
   - Fetch relationships in parallel batches (5 at a time)
   - Transform to sheet format with cache lookups for user_email/company_domain
   - Write to Notes sheet (replace or append based on user choice)
4. **Large dataset (≥1000)**: Batch processing
   - Build and store user/company caches in hidden sheet (first chunk only)
   - Create batch queue with chunks (200 notes each)
   - Process chunks sequentially via `BatchQueue_processNext()`
   - Retrieve caches from sheet for subsequent chunks
   - Delete cache sheet on completion or error
   - Sidebar auto-polls for progress updates
5. Log all operations to Run Log sheet
6. Auto-activate Run Log sheet when status mentions "Check Run Log"

#### Import Flow
1. User clicks "Import Notes" → `ImportNotes_()`
2. Run validation → `ValidateNotes_()`
   - Auto-fix display URLs (add https://)
   - Auto-generate source_record_id if missing
   - Highlight error rows in red, warning rows in yellow
3. Read Notes sheet data
4. **Small dataset (<100)**: Direct execution
   - For each row: Match → Create/Update → Track for backfill
   - Backfill status fields via v2 API
5. **Large dataset (≥100)**: Batch processing
   - Create batch queue with chunks (50 notes each)
   - Process chunks sequentially
   - Backfill per chunk
6. Write pb_id back to sheet for new notes
7. Log all operations to Run Log sheet

---

## Features

### Core Features

✅ **Export from Productboard**
- Exports all notes with complete data (v2 API)
- Parallel relationship fetching (users, companies)
- Bulk user/company cache building for efficient email/domain lookups
- Sheet-based cache storage for batch operations (no Script Properties size limits)
- Properly populates user_email and company_domain columns
- Cursor-based pagination for efficient data retrieval
- Automatic batching for large datasets (1000+ notes)
- Replace or append mode (user choice)
- Infinity loop prevention with safety limits

✅ **Import to Productboard**
- Create new notes or update existing ones
- Match by `pb_id` (Productboard ID) or `ext_id` (external system ID)
- v1 API for stable write operations
- v2 API backfill for unsupported fields (archived, processed, creator)

✅ **Data Validation**
- Pre-import dry-run validation
- Auto-fix common issues:
  - Display URLs (add https:// prefix)
  - Source record IDs (auto-generate numbered IDs)
- Visual highlighting (error rows = red, warning rows = yellow)
- Comprehensive error reporting in Run Log

✅ **Batch Processing**
- Automatic batching for large datasets
- Real-time progress tracking with sub-progress
- Graceful timeout handling (Google Apps Script 6-minute limit)
- Batch queue management (pause, resume, clear)

✅ **Rate Limiting**
- Adaptive throttling based on API response headers
- Exponential backoff for 429 errors
- Respects Retry-After headers
- Prevents rate limit exhaustion

✅ **Error Handling**
- Centralized error management
- Categorized errors (API, Validation, Sheet, etc.)
- Detailed logging with context
- Non-blocking errors (continue on failures)

✅ **User Experience**
- Clean sidebar UI with real-time status updates
- Color-coded status messages (info, success, warning, error)
- Auto-activate Run Log sheet when status mentions "Check Run Log"
- Clear all status messages when starting new actions (prevents confusion)
- Progress bars for batch operations
- Always-available "Clear Queue" button during batch operations
- Batch summary logging (single final row with totals)
- Comprehensive Run Log for audit trail

### Advanced Features

🔧 **Configuration Management**
- API token storage (Script Properties)
- Workspace name tracking
- EU datacenter support
- Configuration caching (6-hour TTL)

🔧 **Sheet Management**
- 3-row header format (machine keys, human labels, field types)
- Protected headers (prevent accidental edits)
- Data validation (note type dropdown)
- Optimized column widths

🔧 **Field Mapping**
- Customer relationships (user email vs. company domain)
- Owner and creator assignment
- Tags (comma-separated strings)
- Source tracking (origin + record ID)
- Status fields (archived, processed)

---

## Installation

### Step 1: Create Google Sheet

1. Open [Google Sheets](https://sheets.google.com)
2. Create a new blank spreadsheet
3. Name it (e.g., "Productboard Notes Import/Export")

### Step 2: Open Apps Script Editor

1. In your Google Sheet: **Extensions** → **Apps Script**
2. Delete any default code in the editor

### Step 3: Add Script Files

Create the following files in the Apps Script editor (File → New → Script file):

1. **notesMain.gs**
   - Copy contents from `Notes Implementation/notesMain.gs`

2. **notesExporter.gs**
   - Copy contents from `Notes Implementation/notesExporter.gs`

3. **notesImporter.gs**
   - Copy contents from `Notes Implementation/notesImporter.gs`

4. **notesBatchQueue.gs**
   - Copy contents from `Notes Implementation/notesBatchQueue.gs`

5. **notesErrorHandling.gs**
   - Copy contents from `Notes Implementation/notesErrorHandling.gs`

6. **notesSidebar.gs**
   - Copy contents from `Notes Implementation/notesSidebar.gs`

### Step 4: Add HTML File

1. In Apps Script editor: **File** → **New** → **HTML file**
2. Name it **Sidebar_Notes**
3. Copy contents from `Notes Implementation/Sidebar_Notes.html`

### Step 5: Save and Authorize

1. Click **Save** (💾) icon
2. Refresh your Google Sheet
3. You should see a new menu: **🚀 PB Notes**
4. Click **🚀 PB Notes** → **📊 Open Notes panel**
5. Grant required permissions when prompted

---

## File Structure

```
Notes Implementation/
├── notesMain.gs              # Core foundation & API communication
├── notesExporter.gs           # Export workflow (v2 API)
├── notesImporter.gs           # Import workflow (v1 + v2 backfill)
├── notesBatchQueue.gs         # Batch processing engine
├── notesErrorHandling.gs      # Error management
├── notesSidebar.gs            # UI bridge
└── Sidebar_Notes.html         # User interface

API Documentation/
├── apiv1.yaml                 # v1 API spec
├── entities.yaml              # Entity definitions
└── notes.yaml                 # Notes schema

Documentation/
├── README.md                  # This file
├── TESTING_GUIDE.md           # Comprehensive testing guide
└── API_ANALYSIS_FINDINGS.md   # API research notes
```

---

## Configuration

### Required Settings

#### 1. API Token

**How to get your API token:**
1. Log into Productboard
2. Go to **Settings** → **Integrations** → **Public API**
3. Generate a new token or copy existing token
4. Token needs these permissions:
   - `notes:read` - Read notes
   - `notes:write` - Create and modify notes
   - `users:read` - Validate owner/creator emails

**How to configure:**
1. Open sidebar: **🚀 PB Notes** → **📊 Open Notes panel**
2. Scroll to **⚙️ Settings** section
3. Paste token in **API Token** field
4. Click **Save Settings**

#### 2. Workspace Name (Optional)

- Used for display/tracking purposes
- Not required for API operations
- Enter in Settings section

#### 3. Datacenter Selection

- **US Datacenter** (default): `https://api.productboard.com`
- **EU Datacenter**: `https://api.eu.productboard.com`
- Check "Use EU Datacenter" if your workspace is in the EU region

### Settings Storage

Settings are stored in **Script Properties** (persistent, secure):
- `PB_API_TOKEN` - API token
- `WORKSPACE_NAME` - Workspace name
- `USE_EU_DATACENTER` - Boolean flag

---

## Usage Guide

### Export Notes from Productboard

**Purpose:** Fetch all notes from Productboard and populate the Notes sheet.

**Steps:**
1. Open sidebar: **🚀 PB Notes** → **📊 Open Notes panel**
2. Click **Refresh Notes Sheet** (if sheet doesn't exist)
3. Click **Export Notes**
4. Wait for completion (progress shown in sidebar and Run Log)

**What happens:**
- Fetches all notes from v2 API (cursor pagination)
- Fetches customer relationships in parallel
- Transforms to sheet format
- Writes to **📝 Notes** sheet
- Logs progress to **🧾 Run Log** sheet

**Performance:**
- Small datasets (<1000): Direct execution, <5 minutes
- Large datasets (≥1000): Batch processing, ~200 notes per chunk

### Validate Import Data

**Purpose:** Dry-run validation to catch errors before importing.

**Steps:**
1. Ensure Notes sheet has data (exported or manually entered)
2. Click **Validate Import Data**
3. Review Run Log for errors/warnings
4. Check Notes sheet for highlighted rows:
   - **Red background** = Error rows (must fix before import)
   - **Yellow background** = Warning rows (optional fixes)

**Auto-Fixes Applied:**
- Display URLs: Adds `https://` prefix if missing
- Source Record IDs: Generates numbered IDs if origin provided but ID missing

**Validation Checks:**
- Required fields (title, content)
- Format validation (UUID, email, domain)
- Duplicate detection (pb_id, ext_id)
- Field pairing (source_origin ↔ source_record_id)
- Relationship warnings (user_email vs. company_domain)

### Import Notes to Productboard

**Purpose:** Create new notes or update existing notes in Productboard.

**Steps:**
1. Ensure data is validated (click **Validate Import Data** first)
2. Click **Import Notes**
3. Monitor progress in sidebar
4. Check Run Log for detailed results

**Matching Logic:**

1. **Priority 1: ext_id** (External ID)
   - Matches against `source.record_id` in Productboard
   - Used for migrations from external systems
   - Searches all notes to find match

2. **Priority 2: pb_id** (Productboard ID)
   - Direct match by UUID
   - Fast lookup via API

3. **Priority 3: Create**
   - If no match found, creates new note

**Import Process:**

1. **v1 API (POST/PATCH /notes)**
   - Creates or updates note
   - Sets: title, content, display_url, tags, user/company relationship, owner
   - ⚠️ Cannot set: archived, processed, creator

2. **v2 API Backfill (PATCH /v2/notes)**
   - Backfills unsupported fields
   - Sets: archived, processed, creator, owner (if v1 rejected)

3. **Write Back**
   - New notes: pb_id written to column A
   - Enables future updates by pb_id

**Performance:**
- Small datasets (<100): Direct execution, ~1 note per second
- Large datasets (≥100): Batch processing, 50 notes per chunk

### Delete Notes

**⚠️ Destructive Operation - Use with Caution**

**Purpose:** Delete notes from Productboard that are listed in the Notes sheet.

**Steps:**
1. Ensure Notes sheet contains notes with pb_id (column A)
2. Click **Delete All Notes** (in sidebar, below Import section)
3. Confirm deletion in dialog
4. Monitor progress

**What happens:**
- Only deletes notes with valid pb_id
- Uses v2 API DELETE endpoint
- Clears pb_id from sheet after successful deletion
- Logs all deletions to Run Log

---

## API Integration

### API Version Strategy

| Operation | API Version | Endpoint | Reason |
|-----------|-------------|----------|--------|
| **Export** | v2 | `GET /v2/notes` | Cursor pagination, efficient fetching |
| **Relationships** | v2 | `GET /v2/notes/{id}/relationships` | Only available in v2 |
| **Create** | v1 | `POST /notes` | Stable, handles tags as strings |
| **Update** | v1 | `PATCH /notes/{id}` | Stable, supports all writable fields |
| **Status Backfill** | v2 | `PATCH /v2/notes/{id}` | Required for archived/processed |
| **Delete** | v2 | `DELETE /v2/notes/{id}` | Standard delete operation |

### Field Mapping: v2 → Sheet

| v2 API Field | Sheet Column | Transform |
|--------------|--------------|-----------|
| `id` | `pb_id` | Direct |
| `fields.source.recordId` | `ext_id` | Direct |
| `type` | `type` | Direct (simple, conversation, opportunity) |
| `fields.name` | `title` | Direct |
| `fields.content` | `content` | Direct |
| `fields.displayUrl` | `display_url` | Direct |
| `relationships[type=customer]` → `target.email` | `user_email` | Extract email from relationship |
| `relationships[type=customer]` → `target.domain` | `company_domain` | Extract domain from relationship |
| `fields.owner.email` | `owner_email` | Direct |
| `fields.creator.email` | `creator_email` | Direct |
| `fields.tags[]` | `tags` | Join with ", " |
| `fields.source.origin` | `source_origin` | Direct |
| `fields.source.recordId` | `source_record_id` | Direct |
| `fields.archived` | `archived` | Boolean → "TRUE"/"FALSE" |
| `fields.processed` | `processed` | Boolean → "TRUE"/"FALSE" |

### Field Mapping: Sheet → v1 API

| Sheet Column | v1 API Field | Notes |
|--------------|--------------|-------|
| `title` | `title` | Required (v1 uses "title" not "name") |
| `content` | `content` | Required (v1 requires content field) |
| `display_url` | `display_url` | Auto-add https:// if missing |
| `user_email` | `user.email` | Customer relationship (user) |
| `company_domain` | `company.domain` | Customer relationship (company) |
| `owner_email` | `owner.email` | Owner assignment |
| `tags` | `tags[]` | Array of strings (comma-split) |
| `source_origin` | `source.origin` | Immutable after creation |
| `source_record_id` | `source.record_id` | Immutable after creation |

### Field Mapping: Sheet → v2 API (Backfill)

| Sheet Column | v2 API Patch Op | Notes |
|--------------|-----------------|-------|
| `archived` | `{ op: "set", path: "archived", value: boolean }` | Status field |
| `processed` | `{ op: "set", path: "processed", value: boolean }` | Status field |
| `creator_email` | `{ op: "set", path: "creator", value: { email } }` | Not supported in v1 |
| `owner_email` | `{ op: "set", path: "owner", value: { email } }` | Retry if v1 rejected |

---

## Data Schema

### Notes Sheet Structure

**Header Format (3 rows):**

| Row | Content | Purpose |
|-----|---------|---------|
| 1 | Machine keys | Field identifiers (pb_id, ext_id, etc.) |
| 2 | Human labels | User-friendly names (PB Note ID, External ID, etc.) |
| 3 | Field types | Data types for validation (id, text, email, etc.) |

**Columns (15 total):**

| # | Key | Label | Type | Required | Description |
|---|-----|-------|------|----------|-------------|
| A | `pb_id` | PB Note ID | id | - | Productboard UUID (auto-filled on create) |
| B | `ext_id` | External ID | text | - | External system ID for matching |
| C | `type` | Note Type | select | ✅ | simple, conversation, or opportunity |
| D | `title` | Title | text * | ✅ | Note title (required) |
| E | `content` | Content | text * | ✅ | Note content (required, can be empty string) |
| F | `display_url` | Display URL | url | - | Source URL (auto-adds https://) |
| G | `user_email` | User Email | email | - | User relationship (takes priority) |
| H | `company_domain` | Company Domain | domain | - | Company relationship |
| I | `owner_email` | Owner Email | email | - | Note owner |
| J | `creator_email` | Creator Email | email | - | Note creator (backfilled via v2) |
| K | `tags` | Tags | array | - | Comma-separated tags |
| L | `source_origin` | Source Origin | text | - | Source system identifier |
| M | `source_record_id` | Source Record ID | text | - | Source system record ID |
| N | `archived` | Archived | boolean | - | TRUE/FALSE (backfilled via v2) |
| O | `processed` | Processed | boolean | - | TRUE/FALSE (backfilled via v2) |

### Run Log Sheet Structure

**Columns:**
1. **Timestamp** - ISO datetime of log entry
2. **Entity** - Entity type (always "Notes")
3. **Row** - Sheet row number (if applicable)
4. **Status** - INFO, SUCCESS, WARN, ERROR
5. **Message** - Human-readable message
6. **Details** - Additional context

**Color Coding:**
- **Blue** (INFO) - Informational messages
- **Green** (SUCCESS) - Successful operations
- **Yellow** (WARN) - Warnings (non-blocking)
- **Red** (ERROR) - Errors

---

## Batch Processing

### Batching Strategy

**When batching is triggered:**

| Operation | Threshold | Chunk Size | Trigger Condition |
|-----------|-----------|------------|-------------------|
| Export | 1000 notes | 200 notes | Estimated total ≥ 1000 OR pagination cursor exists |
| Import | 100 rows | 50 rows | Data row count ≥ 100 |
| Delete | 100 notes | 50 notes | Notes with pb_id count ≥ 100 |

**Why batching?**
- Google Apps Script has 6-minute execution timeout
- Large operations risk timeout and data loss
- Batching provides:
  - Predictable chunk execution times
  - Progress tracking
  - Graceful error handling
  - Resumable operations

### Batch Queue Architecture

**Queue Structure:**
```javascript
{
  batchType: "export-notes" | "import-notes" | "delete-notes",
  jobs: [
    {
      id: 0,
      type: "export-notes-chunk",
      pageCursor: "abc123..." | null,
      chunkIndex: 0,
      status: "pending" | "running" | "completed" | "failed",
      startedAt: "2024-01-01T00:00:00Z",
      completedAt: "2024-01-01T00:05:00Z",
      result: { success: true, message: "..." }
    }
  ],
  currentIndex: 0,
  totalJobs: 10,
  completedCount: 5,
  failedCount: 0,
  startedAt: "2024-01-01T00:00:00Z",
  completedAt: null
}
```

**Queue Lifecycle:**

1. **Creation** (`BatchQueue_create`)
   - Split operation into chunks
   - Store queue in Script Properties
   - Return batch started status

2. **Processing** (`BatchQueue_processNext`)
   - Called by sidebar auto-polling (every 2 seconds)
   - Gets next pending job
   - Executes job function
   - Marks job complete
   - Returns progress summary

3. **Progress Tracking** (`BatchQueue_getSummary`)
   - Overall progress (completed/total)
   - Sub-progress (within current job)
   - Error/warning counts
   - Estimated completion

4. **Completion**
   - All jobs marked completed or failed
   - Queue remains for inspection
   - User can clear queue manually

### Sub-Progress Tracking

**Purpose:** Show detailed progress within a long-running job.

**Usage:**
```javascript
BatchQueue_setSubProgress('Fetching notes...', 10);    // 10% of job
BatchQueue_setSubProgress('Fetching relationships...', 50);  // 50% of job
BatchQueue_setSubProgress('Writing to sheet...', 90);  // 90% of job
BatchQueue_setSubProgress('Complete', 100);            // 100% of job
```

**Display:**
- Main progress bar shows job-level progress (e.g., "3/10 jobs complete")
- Sub-progress text shows operation-level detail (e.g., "Fetching relationships...")

---

## Error Handling

### Error Categories

| Category | Description | Examples | Severity |
|----------|-------------|----------|----------|
| **API** | Productboard API errors | 400, 401, 404, 429, 500 | ERROR/CRITICAL |
| **VALIDATION** | Data validation failures | Invalid email, missing field | ERROR |
| **SHEET** | Google Sheets operations | Permission denied, invalid range | ERROR |
| **CONFIGURATION** | Settings/config issues | Missing API token | CRITICAL |
| **PARSING** | Data transformation errors | JSON parse error | ERROR |
| **PERMISSION** | Authorization errors | No access to sheet | CRITICAL |

### Error Severities

| Severity | Meaning | Action |
|----------|---------|--------|
| **INFO** | Informational | Log only |
| **WARNING** | Non-blocking issue | Log, continue execution |
| **ERROR** | Operation failed | Log, skip item, continue batch |
| **CRITICAL** | System-level failure | Log, stop execution |

### Error Handling Strategy

**Principles:**
1. **Fail Gracefully** - One error shouldn't stop entire batch
2. **Log Everything** - Comprehensive audit trail in Run Log
3. **User-Friendly Messages** - Clear, actionable error messages
4. **Context Preservation** - Include row numbers, field names, etc.

**Implementation:**

```javascript
// Centralized error handling
function handleApiError_(error, operation, context) {
  // Parse HTTP status code
  // Extract Productboard API error details
  // Create standardized error object
  // Log to Run Log with context
}

// Example usage in import loop
chunkData.forEach((row, index) => {
  try {
    // Import note
    createNote_(row, rowNum);
    result.created++;
  } catch (err) {
    result.errors++;
    const errorMsg = handleApiError_(err, 'import note', {
      sheet: NOTES_SHEET,
      row: rowNum
    });
    logToRunLog_('Notes', rowNum, 'ERROR', errorMsg.message, errorMsg.details);
    // Continue to next note
  }
});
```

### Common Errors & Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| **Missing API token** | No token configured | Go to Settings, enter API token |
| **401 Unauthorized** | Invalid/expired token | Generate new token in Productboard |
| **403 Forbidden** | Insufficient permissions | Check token has `notes:read`, `notes:write` |
| **404 Not Found** | Note doesn't exist | Check pb_id is correct, note may be deleted |
| **400 Bad Request (validation)** | Invalid field value | Check Run Log for field details, fix data |
| **429 Rate Limit** | Too many requests | Adaptive throttling should prevent this; wait and retry |
| **Title is required** | Empty title field | Fill title in column D |
| **Content is required** | Empty content field | Fill content in column E (can be empty string) |
| **Duplicate pb_id** | Same pb_id in multiple rows | Remove duplicates, each pb_id should be unique |
| **Owner email not found** | Email doesn't exist in workspace | Fix email or remove from owner_email column |

---

## Rate Limiting

### Productboard API Rate Limits

**Documented Limits:**
- **50 requests per second** (per API token)
- Headers returned:
  - `ratelimit-limit`: Total limit
  - `ratelimit-remaining`: Remaining requests
  - `ratelimit-reset`: Reset timestamp
  - `retry-after`: Seconds to wait (on 429)

### Adaptive Throttling Implementation

**Strategy:**
1. **Base Delay**: 20ms between requests (allows 50/sec)
2. **Adaptive Slowdown**:
   - < 20 requests remaining: 2x delay (40ms)
   - < 10 requests remaining: 5x delay (100ms)
3. **Header Monitoring**: Read rate limit headers from every response
4. **Exponential Backoff**: On 429 errors, exponentially increase delay

**Code:**
```javascript
function throttleRequest_() {
  const now = Date.now();
  const timeSinceLastRequest = now - RATE_LIMITER.lastRequestTime;

  let delay = RATE_LIMITER.minDelay; // 20ms

  if (RATE_LIMITER.remaining < 10) {
    delay = 100; // Slow down significantly
  } else if (RATE_LIMITER.remaining < 20) {
    delay = 40; // Slow down moderately
  }

  if (timeSinceLastRequest < delay) {
    Utilities.sleep(delay - timeSinceLastRequest);
  }

  RATE_LIMITER.lastRequestTime = Date.now();
}
```

### Retry Logic

**Retryable Errors:**
- **429** (Rate Limit Exceeded) - Respects `retry-after` header
- **5xx** (Server Errors) - Exponential backoff

**Retry Strategy:**
```javascript
function pbCallWithRetry_(fn, label) {
  const maxRetries = 6;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return fn();
    } catch (e) {
      const is429 = / 429: /.test(String(e));
      const is5xx = / 5\d{2}: /.test(String(e));

      if (!is429 && !is5xx) throw e; // Not retryable
      if (i === maxRetries - 1) throw e; // Max retries

      // Calculate delay
      let delay;
      if (is429 && e.retryAfter) {
        delay = e.retryAfter * 1000; // Honor retry-after
      } else {
        delay = Math.pow(2, i) * 250 + Math.random() * 200; // Exponential
      }

      Utilities.sleep(delay);
    }
  }
}
```

---

## Troubleshooting

### Issue: Import creates duplicates instead of updating

**Symptoms:**
- New notes created when you expected updates
- Multiple notes with same title

**Cause:**
- `pb_id` column is empty or incorrect
- Note doesn't exist in Productboard (may have been deleted)

**Solution:**
1. Export notes first to get correct `pb_id` values
2. For existing notes, ensure column A (pb_id) has valid UUID
3. For ext_id matching, ensure `ext_id` matches `source.record_id` in Productboard

### Issue: Status fields (archived/processed) not set

**Symptoms:**
- Note created but archived/processed remains FALSE

**Cause:**
- v2 backfill failed
- Note not yet available in v2 API (propagation delay)

**Solution:**
1. Check Run Log for "Backfilling status..." messages
2. Look for warnings about v2 PATCH failures
3. If "404 not found", note may need time to propagate
4. Re-run import for those notes after 30 seconds

### Issue: Owner/Creator not assigned

**Symptoms:**
- Note created but owner/creator not set

**Cause:**
- Email doesn't exist in Productboard workspace
- Email has typo or wrong case

**Solution:**
1. Check Run Log for "Owner email not found" warnings
2. Verify email exists in Productboard (Settings → Users)
3. Fix email in sheet and re-import

### Issue: Validation fails with "Content is required"

**Symptoms:**
- Red error in validation for content field

**Cause:**
- v1 API requires `content` field (even if empty)

**Solution:**
1. Fill content column (E) with at least empty string
2. Content can be blank but cell must have value

### Issue: Rate limit errors (429)

**Symptoms:**
- Import/export fails with 429 errors
- "Rate limit exceeded" messages

**Cause:**
- Too many concurrent operations
- Adaptive throttling not working correctly

**Solution:**
1. This shouldn't happen with adaptive throttling
2. Wait 60 seconds for rate limit to reset
3. Re-run operation (batching will resume from checkpoint)
4. If persistent, report as bug

### Issue: Batch progress stuck

**Symptoms:**
- Progress bar stops updating
- No new log entries in Run Log

**Cause:**
- Execution timeout (6-minute limit)
- Script error in batch job

**Solution:**
1. Check Apps Script execution log (Extensions → Apps Script → Executions)
2. Look for errors in last execution
3. Click "Clear Queue" in sidebar
4. Re-run operation (fresh batch queue)

### Issue: Display URL validation error

**Symptoms:**
- Warning about display_url format

**Cause:**
- URL missing protocol (http:// or https://)

**Solution:**
1. Auto-fix should handle this during validation
2. If not fixed, manually add `https://` prefix to URLs in column F
3. Re-run validation

---

## Development Guide

### Code Organization

**Module Responsibilities:**

| File | Responsibility | Key Functions |
|------|---------------|--------------|
| `notesMain.gs` | Foundation | `pbFetch_`, `throttleRequest_`, `getApiToken_` |
| `notesExporter.gs` | Export logic | `ExportNotes_`, `fetchAllNotesV2_` |
| `notesImporter.gs` | Import logic | `ImportNotes_`, `createNote_`, `updateNote_` |
| `notesBatchQueue.gs` | Batch management | `BatchQueue_create`, `BatchQueue_processNext` |
| `notesErrorHandling.gs` | Error handling | `handleApiError_`, `createError_` |
| `notesSidebar.gs` | UI bridge | `NotesSidebar_runAction` |

### Adding New Features

**Example: Add a new import field**

1. **Update Constants** (notesMain.gs)
   ```javascript
   const NOTE_BASE_FIELDS = [
     // ... existing fields
     'my_new_field'  // Add here
   ];
   ```

2. **Update Sheet Headers** (notesImporter.gs)
   ```javascript
   function buildNotesHeaders_() {
     const baseFields = [
       // ... existing fields
       { key: 'my_new_field', label: 'My New Field', type: 'text' }
     ];
   }
   ```

3. **Update Export Transform** (notesExporter.gs)
   ```javascript
   function transformNotesToSheetFormat_(notes) {
     return notes.map(note => {
       // ... existing fields
       row.push(note.fields?.myNewField || '');  // Add here
     });
   }
   ```

4. **Update Import Mapping** (notesImporter.gs)
   ```javascript
   function createNote_(row, rowNum) {
     const payload = {
       // ... existing fields
       my_new_field: row.my_new_field
     };
   }
   ```

### Testing Checklist

Before deploying changes:

- [ ] Test export with small dataset (10 notes)
- [ ] Test export with large dataset (1000+ notes)
- [ ] Test import create operation
- [ ] Test import update operation
- [ ] Test validation with errors
- [ ] Test batch processing
- [ ] Test error handling (invalid data)
- [ ] Test rate limiting (rapid operations)
- [ ] Check Run Log formatting
- [ ] Verify no data loss

### Debugging Tips

**Enable Verbose Logging:**
```javascript
// Add at start of function
Logger.log('DEBUG: Function started with params:', params);

// Add throughout function
Logger.log('DEBUG: Variable value:', variableName);
```

**View Logs:**
1. Apps Script Editor → **Executions**
2. Click on execution row to see logs
3. Or use `Logger.log()` and view in **View → Logs** (Cmd+Enter)

**Common Debug Points:**
- API responses: `Logger.log('API response:', JSON.stringify(response));`
- Rate limiter state: `Logger.log('Rate limiter:', getRateLimiterStats_());`
- Batch queue: `Logger.log('Queue status:', BatchQueue_getSummary());`

---

## API Reference

### Key Functions

#### Export Functions

**`ExportNotes_(options)`**
- **Purpose**: Export notes from Productboard v2 API
- **Parameters**: `{ replaceData: boolean }` (default: true)
- **Returns**: `{ fetched: number, written: number, message: string }` or `{ batchStarted: true, message: string }`

**`ExportNotesChunk_(pageCursor, chunkIndex, replaceData)`**
- **Purpose**: Export a chunk of notes (for batch processing)
- **Parameters**:
  - `pageCursor`: Pagination cursor (null for first chunk)
  - `chunkIndex`: Chunk index for logging
  - `replaceData`: Replace existing data (true for first chunk)
- **Returns**: `{ written: number, nextCursor: string|null, message: string }`

#### Import Functions

**`ImportNotes_()`**
- **Purpose**: Import notes to Productboard (v1 API + v2 backfill)
- **Returns**: `{ success: boolean, created: number, updated: number, message: string }` or `{ batchStarted: true, message: string }`

**`ImportNotesChunk_(startRow, endRow)`**
- **Purpose**: Import a chunk of notes (for batch processing)
- **Parameters**:
  - `startRow`: Start row number (1-indexed)
  - `endRow`: End row number (1-indexed)
- **Returns**: `{ success: boolean, created: number, updated: number, errors: number, summary: string }`

**`ValidateNotes_()`**
- **Purpose**: Validate notes data before import (dry-run)
- **Returns**: `{ success: boolean, errors: number, warnings: number, autoFixed: number, totalRows: number, summary: string }`

#### Sheet Functions

**`SetupNotesSheet_(forceRefresh)`**
- **Purpose**: Set up Notes sheet with 3-row headers
- **Parameters**: `forceRefresh` - Force refresh even if sheet exists
- **Returns**: `{ success: boolean, message: string }`

**`readNotesSheet_(sheet)`**
- **Purpose**: Read data from Notes sheet and parse into objects
- **Parameters**: `sheet` - The Notes sheet
- **Returns**: Array of note objects with `_row` property

#### Batch Queue Functions

**`BatchQueue_create(jobs, batchType)`**
- **Purpose**: Create a new batch queue
- **Parameters**:
  - `jobs`: Array of job objects `{ type, ...params }`
  - `batchType`: Type of batch (e.g., 'export-notes')
- **Returns**: Queue object

**`BatchQueue_processNext()`**
- **Purpose**: Process the next job in the queue
- **Returns**: `{ hasMore: boolean, completed: boolean, jobResult: object, summary: object }`

**`BatchQueue_getSummary()`**
- **Purpose**: Get batch queue summary for display
- **Returns**: `{ batchType, total, completed, succeeded, failed, percent, isComplete, subProgress }`

---

## License & Support

**License:** Internal tool - Not for public distribution

**Support:**
- Report issues to development team
- Check Run Log for detailed error messages
- Refer to TESTING_GUIDE.md for test scenarios

**Version History:**
- **v2.0** (2025-02-07) - Hybrid v1/v2 implementation with batch processing
- **v1.0** (2025-01-15) - Initial v2 API implementation

---

## Appendix

### Google Apps Script Limits

| Limit | Value | Notes |
|-------|-------|-------|
| Execution timeout | 6 minutes | Per execution (trigger or manual) |
| Script Properties | 500 KB | For settings, batch queue |
| UrlFetchApp calls | 20,000/day | Per user |
| Spreadsheet cells | 10 million | Per spreadsheet |

### Productboard API Limits

| Limit | Value | Notes |
|-------|-------|-------|
| Rate limit | 50 req/sec | Per API token |
| Pagination | 100 items/page | v1 API (offset-based) |
| Pagination | Cursor-based | v2 API (no item limit) |
| Request timeout | 30 seconds | Server-side |

### Performance Benchmarks

| Operation | Dataset Size | Expected Time |
|-----------|--------------|---------------|
| Export | 10 notes | <10s |
| Export | 100 notes | <60s |
| Export | 1,000 notes | <5min |
| Import | 10 notes | <30s |
| Import | 100 notes | <2min |
| Import | 1,000 notes | <20min |
| Validation | 1,000 rows | <10s |

---

**End of README** | Last updated: 2025-02-07 | Version: 2.0
