# Productboard Notes Import/Export - Testing Guide

**Version:** 2.2 (Hybrid v1/v2 Implementation)
**Last Updated:** February 7, 2026
**Tool:** Google Apps Script for Google Sheets

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Test Environment Setup](#test-environment-setup)
3. [Test Data Preparation](#test-data-preparation)
4. [Functional Testing](#functional-testing)
5. [Integration Testing](#integration-testing)
6. [Performance Testing](#performance-testing)
7. [Error Handling Testing](#error-handling-testing)
8. [Edge Case Testing](#edge-case-testing)
9. [Regression Testing](#regression-testing)
10. [Test Results Documentation](#test-results-documentation)

---

## Prerequisites

### Required Access

✅ **Productboard Account**
- Active workspace with API access
- Ability to create/delete test notes
- Recommended: Separate test workspace

✅ **API Token with Permissions**
- `notes:read` - Read notes
- `notes:write` - Create and modify notes
- `users:read` - Validate owner/creator emails

✅ **Google Account**
- Access to Google Sheets
- Permission to install Apps Script projects

✅ **Test Data**
- At least 10 existing notes in Productboard (for export tests)
- List of valid user emails from workspace
- List of valid company domains

### Recommended Test Setup

```
Test Workspace Structure:
├── Test Notes (10-20 notes)
│   ├── Simple notes
│   ├── Conversation notes
│   ├── Opportunity notes
│   ├── Notes with user relationships
│   ├── Notes with company relationships
│   ├── Notes with tags
│   ├── Notes with source tracking
│   └── Archived/processed notes
├── Test Users (3-5 users)
│   └── Known email addresses for owner/creator testing
└── Test Companies (2-3 companies)
    └── Known domains for relationship testing
```

---

## Test Environment Setup

### Step 1: Create Test Spreadsheet

1. Open [Google Sheets](https://sheets.google.com)
2. Create new blank spreadsheet
3. Name it: **"Notes Import/Export - TEST"**
4. Add a label in cell A1: "⚠️ TEST ENVIRONMENT - Do not use for production"

### Step 2: Install Script

1. **Extensions** → **Apps Script**
2. Create all required script files:
   - `notesMain.gs`
   - `notesExporter.gs`
   - `notesImporter.gs`
   - `notesBatchQueue.gs`
   - `notesErrorHandling.gs`
   - `notesSidebar.gs`
   - `Sidebar_Notes.html`
3. Save project
4. Refresh Google Sheet
5. Authorize permissions when prompted

### Step 3: Configure Settings

1. Open sidebar: **🚀 PB Notes** → **📊 Open Notes panel**
2. Scroll to **⚙️ Settings** section
3. Enter **TEST API token** (from test workspace)
4. Enter **Test Workspace Name** (e.g., "Test Workspace - QA")
5. Select datacenter (US/EU)
6. Click **Save Settings**
7. Verify success message appears

### Step 4: Verify Installation

**Check 1: Menu Exists**
- ✅ Menu **🚀 PB Notes** appears in toolbar
- ❌ If missing: Refresh page, check script authorization

**Check 2: Sidebar Opens**
- ✅ Sidebar displays with 4 sections: Export, Validate, Import, Settings
- ❌ If missing: Check browser console for errors (F12)

**Check 3: Settings Persist**
- ✅ Close and reopen sidebar, settings remain
- ❌ If not persisting: Check Script Properties permissions

---

## Test Data Preparation

### Create Test Notes in Productboard

**Purpose:** Ensure consistent test data for export tests

**Required Test Notes:**

| # | Title | Type | Content | Relationship | Tags | Source | Status |
|---|-------|------|---------|--------------|------|--------|--------|
| 1 | Test Simple Note 1 | simple | Basic test note | None | test, simple | None | Active |
| 2 | Test Conversation 1 | conversation | Customer feedback | user@example.com | feedback | zendesk:123 | Active |
| 3 | Test Opportunity 1 | opportunity | Sales opportunity | company.com | sales, opportunity | salesforce:456 | Active |
| 4 | Test Archived Note | simple | Archived test | None | test | None | Archived |
| 5 | Test Processed Note | simple | Processed test | None | test | None | Processed |
| 6 | Test Multi-Tag Note | simple | Multiple tags test | None | tag1, tag2, tag3 | None | Active |
| 7 | Test User Relation | simple | User relationship test | user1@example.com | test | None | Active |
| 8 | Test Company Relation | simple | Company relationship test | example.com | test | None | Active |
| 9 | Test with URL | simple | Has display URL | None | test | None | Active |
| 10 | Test with Owner | simple | Has owner assigned | None | test | None | Active |

**How to create:**
1. Log into test Productboard workspace
2. Create notes manually or via API
3. Assign relationships, tags, source tracking as specified
4. Keep note IDs handy for reference

### Prepare Test Data in Sheet

**Purpose:** Consistent data for import tests

**Template Rows (for copy/paste):**

```csv
pb_id,ext_id,type,title,content,display_url,user_email,company_domain,owner_email,creator_email,tags,source_origin,source_record_id,archived,processed
,,"simple","Import Test 1","Test content 1",,,,,,test,,,FALSE,FALSE
,,"conversation","Import Test 2","Test content 2",,,user@example.com,,,feedback,zendesk,ZD-001,FALSE,FALSE
,,"opportunity","Import Test 3","Test content 3",,,,company.com,,sales,salesforce,SF-001,FALSE,FALSE
,,"simple","Import Test 4","Test content 4",https://example.com,,,,,test,,,FALSE,FALSE
,,"simple","Import Test 5","Test content 5",,,,,owner@example.com,,test,,,FALSE,FALSE
```

---

## Functional Testing

### Test Suite 1: Sheet Setup

#### Test 1.1: Create Notes Sheet

**Objective:** Verify Notes sheet creation with correct structure

**Steps:**
1. Open sidebar
2. Click **Refresh Notes Sheet**
3. Verify sheet **📝 Notes** is created

**Expected Results:**
- ✅ Sheet named **📝 Notes** exists
- ✅ 3 header rows present:
  - Row 1: Machine keys (pb_id, ext_id, type, ...)
  - Row 2: Human labels (PB Note ID, External ID, ...)
  - Row 3: Field types (id, text, select, ...)
- ✅ 15 columns total
- ✅ Headers are protected (locked with lock icon)
- ✅ Frozen rows = 3
- ✅ Column C (type) has dropdown: simple, conversation, opportunity
- ✅ Column widths optimized for readability

**Pass Criteria:** ✅ All expected results met

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 1.2: Refresh Preserves Data

**Objective:** Verify sheet refresh preserves existing data

**Steps:**
1. Ensure Notes sheet has data (export some notes first)
2. Note row count and first few pb_id values
3. Click **Refresh Notes Sheet**
4. Verify data still present

**Expected Results:**
- ✅ Headers refreshed (formatting reapplied)
- ✅ All data rows preserved
- ✅ No data loss
- ✅ pb_id values unchanged

**Pass Criteria:** ✅ All data preserved

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

### Test Suite 2: Export Operations

#### Test 2.1: Export Small Dataset (<10 notes)

**Objective:** Export ≤10 notes (direct execution)

**Prerequisites:**
- Productboard has 5-10 test notes

**Steps:**
1. Clear Notes sheet (if has data)
2. Click **Export Notes**
3. Wait for completion
4. Observe sidebar status and Run Log

**Expected Results:**
- ✅ Status: "Exporting notes..." (blue info message)
- ✅ No batch progress bar appears
- ✅ Success message: "Exported X notes." (green)
- ✅ Notes sheet populated with X rows (starting at row 4)
- ✅ All 15 columns filled correctly
- ✅ pb_id column has valid UUIDs (36 chars with dashes)
- ✅ Relationships extracted:
  - user_email OR company_domain populated (if note has customer)
  - Both columns empty if no customer relationship
- ✅ archived/processed show TRUE or FALSE (not blank)
- ✅ Tags comma-separated (e.g., "tag1, tag2, tag3")
- ✅ Run Log shows:
  - INFO: "Starting export..."
  - INFO: "Fetched X notes"
  - INFO: "Fetching relationships..."
  - SUCCESS: "Export complete"
- ✅ Run Log formatted with colors
- ✅ Export completes in <10 seconds

**Pass Criteria:** ✅ All notes exported correctly within time limit

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 2.2: Export Medium Dataset (50-100 notes)

**Objective:** Export 50-100 notes (direct execution)

**Prerequisites:**
- Productboard has 50-100 notes

**Steps:**
1. Clear Notes sheet
2. Click **Export Notes**
3. Observe progress

**Expected Results:**
- ✅ Direct execution (no batch queue)
- ✅ Progress logged to Run Log every 50 notes
- ✅ All notes exported
- ✅ Relationships fetched in parallel batches (5 at a time)
- ✅ Data accuracy 100%
- ✅ Export completes in <60 seconds

**Pass Criteria:** ✅ Export completes successfully with all data accurate

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 2.3: Export Large Dataset (1000+ notes)

**Objective:** Export ≥1000 notes (automatic batching)

**Prerequisites:**
- Productboard has 1000+ notes (or mock cursor for testing)

**Steps:**
1. Click **Export Notes**
2. Observe batch progress bar
3. Wait for completion

**Expected Results:**
- ✅ Message: "Export batch started (estimated X+ notes)"
- ✅ Batch progress bar appears in sidebar
- ✅ Auto-polling every 2 seconds
- ✅ Progress updates: "X/Y jobs complete"
- ✅ Main progress bar shows percentage (0% → 100%)
- ✅ Sub-progress shows operation detail:
  - "Fetching chunk X..."
  - "Fetching relationships for chunk X..."
  - "Writing chunk X to sheet..."
- ✅ Each chunk exports ~200 notes
- ✅ Sheet appends data after each chunk (not replace)
- ✅ Export completes in <5 minutes for 1000 notes
- ✅ All data present and accurate
- ✅ Alert: "Batch processing complete!" when done
- ✅ Can click "Clear Queue" to stop

**Pass Criteria:** ✅ Large export completes via batching without errors

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 2.4: Export with Customer Relationships

**Objective:** Verify customer relationships extracted correctly

**Prerequisites:**
- Create 3 test notes in Productboard:
  - Note A: Linked to User (email: test-user@example.com)
  - Note B: Linked to Company (domain: test-company.com)
  - Note C: No relationship (anonymous)

**Steps:**
1. Export notes
2. Find rows for Note A, B, C in Notes sheet
3. Check columns G (user_email) and H (company_domain)

**Expected Results:**
- ✅ Note A: user_email = `test-user@example.com`, company_domain = empty
- ✅ Note B: user_email = empty, company_domain = `test-company.com`
- ✅ Note C: Both columns empty
- ✅ Relationship priority respected (if both exist, user takes precedence)

**Pass Criteria:** ✅ All relationships extracted correctly

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 2.5: Export Replace vs Append Mode

**Objective:** Verify export can replace or append data

**Prerequisites:**
- Productboard has 10 test notes

**Steps:**
1. Export notes with "Replace" checkbox CHECKED (default)
2. Verify Notes sheet has 10 rows
3. Export again with "Replace" checkbox UNCHECKED
4. Verify Notes sheet now has 20 rows (appended)
5. Export again with "Replace" checkbox CHECKED
6. Verify Notes sheet has 10 rows (replaced)

**Expected Results:**
- ✅ Replace mode: Clears existing data before writing new data
- ✅ Append mode: Adds new data after existing rows
- ✅ Checkbox defaults to checked (replace behavior)
- ✅ Run Log shows "Cleared X existing rows" for replace mode
- ✅ No data loss during append operations

**Pass Criteria:** ✅ Both modes work correctly

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 2.6: Export User/Company Cache Building

**Objective:** Verify bulk fetch + reconcile caching for relationships

**Prerequisites:**
- Productboard workspace has 50+ users and 20+ companies
- Create notes with various user/company relationships

**Steps:**
1. Click **Export Notes**
2. Check Run Log for cache building messages
3. Verify Notes sheet has user_email and company_domain populated

**Expected Results:**
- ✅ Run Log shows: "Fetching all users for email lookup..."
- ✅ Run Log shows: "User cache built: X users"
- ✅ Run Log shows: "Fetching all companies for domain lookup..."
- ✅ Run Log shows: "Company cache built: X companies"
- ✅ All user_email values populated correctly for notes with user relationships
- ✅ All company_domain values populated correctly for notes with company relationships
- ✅ No warnings about missing UUIDs in cache (unless entity was deleted)
- ✅ Cache building completes in 5-15 seconds for typical workspace

**Pass Criteria:** ✅ Caches built successfully and all relationship data populated

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 2.7: Export Batch with Cache Sheet Storage

**Objective:** Verify sheet-based cache storage for large exports

**Prerequisites:**
- Productboard has 1000+ notes (triggers batching)

**Steps:**
1. Click **Export Notes**
2. Watch for hidden `_ExportCache` sheet appearing
3. Wait for export to complete
4. Verify cache sheet is deleted after completion

**Expected Results:**
- ✅ Batch processing starts automatically
- ✅ `_ExportCache` sheet created during first chunk (hidden from user view)
- ✅ Caches built only once (first chunk)
- ✅ All subsequent chunks retrieve data from cache sheet
- ✅ No repeated cache building logged
- ✅ `_ExportCache` sheet deleted after final chunk
- ✅ No leftover cache sheets after export completes
- ✅ All user_email and company_domain values populated correctly across all chunks

**Pass Criteria:** ✅ Cache sheet used efficiently and cleaned up properly

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 2.8: Auto-activate Run Log Sheet

**Objective:** Verify Run Log sheet auto-activation on relevant status messages

**Prerequisites:**
- Start on any sheet (not Run Log)

**Steps:**
1. Click **Export Notes**
2. Observe which sheet becomes active when status shows "Check Run Log"
3. Repeat for other operations (Import, Validate, Delete)

**Expected Results:**
- ✅ When status shows "Check Run Log sheet for progress", Run Log sheet automatically activates
- ✅ Works for all operations: Export, Import, Validate, Delete, Batch operations
- ✅ User doesn't need to manually navigate to Run Log sheet
- ✅ Seamless UX - user immediately sees progress/details

**Pass Criteria:** ✅ Run Log sheet auto-activates on all relevant status messages

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 2.9: UI Status Clarity

**Objective:** Verify old status messages are cleared when starting new actions

**Prerequisites:**
- Complete an export operation first

**Steps:**
1. After export completes, status shows "Exported X notes"
2. Click **Import Notes**
3. Observe whether old "export" status is cleared
4. Repeat for other operations

**Expected Results:**
- ✅ When clicking any action button, all old status messages are cleared
- ✅ Only the current action's status message is visible
- ✅ No confusion from seeing multiple status messages from different operations
- ✅ Clear visual separation between operations

**Pass Criteria:** ✅ Status messages cleared correctly on each new action

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 2.10: Clear Queue Button Always Available

**Objective:** Verify Clear Queue button remains enabled during batch operations

**Prerequisites:**
- Productboard has 1000+ notes (triggers batching)

**Steps:**
1. Click **Export Notes** (starts batch processing)
2. During batch progress, verify button states
3. Click **Clear Queue** to stop the operation

**Expected Results:**
- ✅ During batch processing, all action buttons are disabled
- ✅ "Clear Queue" button remains enabled during batch processing
- ✅ User can click "Clear Queue" at any time during batch operation
- ✅ Clicking "Clear Queue" stops processing and re-enables buttons
- ✅ Critical for stopping long-running operations

**Pass Criteria:** ✅ Clear Queue button always available during batch operations

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

### Test Suite 3: Validation Operations

#### Test 3.1: Validation - Valid Data

**Objective:** Verify validation passes for correct data

**Prerequisites:**
- Notes sheet has valid data (from export or manual entry)
- All required fields filled
- No duplicate pb_id or ext_id

**Steps:**
1. Click **Validate Import Data**
2. Wait for completion
3. Check status message
4. Check Run Log sheet

**Expected Results:**
- ✅ Status: "Validation complete: X rows, 0 warnings, no errors." (green)
- ✅ Run Log shows:
  - INFO: "Starting validation..."
  - SUCCESS: "Validation complete..."
- ✅ No ERROR entries in Run Log
- ✅ No rows highlighted in red
- ✅ Validation completes in <5 seconds

**Pass Criteria:** ✅ Validation passes with no errors

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 3.2: Validation - Missing Required Field (Title)

**Objective:** Catch missing title (required field)

**Prerequisites:**
- Add test row with empty title:
  - Row 4: type=simple, title=EMPTY, content="Test"

**Steps:**
1. Click **Validate Import Data**
2. Check status and Run Log

**Expected Results:**
- ✅ Status: "Validation failed: 1 errors..." (red)
- ✅ Run Log shows ERROR for row 4:
  - ERROR: "Title is required"
- ✅ Row 4 highlighted in red background
- ✅ Row number (4) indicated in log

**Pass Criteria:** ✅ Missing title caught and reported

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 3.3: Validation - Missing Required Field (Content)

**Objective:** Catch missing content (v1 API requirement)

**Prerequisites:**
- Add test row with empty content:
  - Row 5: type=simple, title="Test", content=EMPTY

**Steps:**
1. Click **Validate Import Data**
2. Check Run Log

**Expected Results:**
- ✅ Run Log shows ERROR for row 5:
  - ERROR: "Content is required and cannot be empty"
- ✅ Row 5 highlighted in red

**Pass Criteria:** ✅ Missing content caught

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 3.4: Validation - Invalid Formats

**Objective:** Catch invalid email, UUID, domain formats

**Prerequisites:**
- Add test rows with invalid data:
  - Row 6: pb_id = `invalid-uuid-format`
  - Row 7: user_email = `not-an-email`
  - Row 8: company_domain = `invalid domain with spaces`

**Steps:**
1. Click **Validate Import Data**
2. Check Run Log

**Expected Results:**
- ✅ Validation fails: 3 errors
- ✅ Error for row 6: "pb_id must be a valid UUID"
- ✅ Error for row 7: "user_email must be a valid email"
- ✅ Error for row 8: "company_domain must be a valid domain"
- ✅ All 3 rows highlighted in red
- ✅ All errors logged with row numbers

**Pass Criteria:** ✅ All format errors caught

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 3.5: Validation - Duplicate IDs

**Objective:** Catch duplicate pb_id and ext_id within sheet

**Prerequisites:**
- Add duplicate rows:
  - Row 9 and 10: Both have ext_id = `TEST-001`
  - Row 11 and 12: Both have pb_id = `12345678-1234-1234-1234-123456789abc`

**Steps:**
1. Click **Validate Import Data**
2. Check Run Log

**Expected Results:**
- ✅ Error: "Duplicate ext_id: TEST-001" (for row 10)
- ✅ Error: "Duplicate pb_id: 12345678-..." (for row 12)
- ✅ Both duplicates flagged
- ✅ Validation fails

**Pass Criteria:** ✅ Duplicates caught and reported

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 3.6: Validation - Source Field Pairing

**Objective:** Ensure source_origin and source_record_id are paired

**Prerequisites:**
- Add unpaired rows:
  - Row 13: source_origin = `test-system`, source_record_id = EMPTY
  - Row 14: source_origin = EMPTY, source_record_id = `123`

**Steps:**
1. Click **Validate Import Data**

**Expected Results:**
- ✅ Error for row 13: "source_record_id requires source_origin" (auto-generated)
  - OR auto-fix generates `test-system-1` for row 13
- ✅ Error for row 14: "source_record_id requires source_origin"

**Pass Criteria:** ✅ Unpaired source fields caught or auto-fixed

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 3.7: Validation - Auto-Fix Display URL

**Objective:** Auto-fix display_url missing protocol

**Prerequisites:**
- Add row with URL missing protocol:
  - Row 15: display_url = `example.com/path`

**Steps:**
1. Click **Validate Import Data**
2. Check cell F15 (display_url column)
3. Check Run Log

**Expected Results:**
- ✅ Cell F15 value updated to: `https://example.com/path`
- ✅ Run Log shows INFO:
  - INFO (row 15): "Auto-fixed display_url: added https:// prefix"
- ✅ Validation shows "1 auto-fix"
- ✅ Validation passes (auto-fix is not an error)

**Pass Criteria:** ✅ URL auto-fixed correctly

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 3.8: Validation - Auto-Generate Source Record ID

**Objective:** Auto-generate source_record_id when origin provided

**Prerequisites:**
- Add rows with origin but no record_id:
  - Row 16: source_origin = `zendesk`, source_record_id = EMPTY
  - Row 17: source_origin = `zendesk`, source_record_id = EMPTY
  - Row 18: source_origin = `jira`, source_record_id = EMPTY

**Steps:**
1. Click **Validate Import Data**
2. Check column M (source_record_id) for rows 16-18
3. Check Run Log

**Expected Results:**
- ✅ Row 16: source_record_id = `zendesk-1`
- ✅ Row 17: source_record_id = `zendesk-2`
- ✅ Row 18: source_record_id = `jira-1`
- ✅ Run Log shows INFO for each:
  - INFO (row 16): "Auto-generated source_record_id: zendesk-1"
  - INFO (row 17): "Auto-generated source_record_id: zendesk-2"
  - INFO (row 18): "Auto-generated source_record_id: jira-1"
- ✅ Validation shows "3 auto-fixes"

**Pass Criteria:** ✅ IDs auto-generated with correct numbering per origin

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 3.9: Validation - Relationship Warning

**Objective:** Warn when both user_email and company_domain filled

**Prerequisites:**
- Add row with both relationship fields:
  - Row 19: user_email = `user@example.com`, company_domain = `example.com`

**Steps:**
1. Click **Validate Import Data**
2. Check Run Log

**Expected Results:**
- ✅ WARNING (not error): "Both user_email and company_domain filled. user_email will take priority."
- ✅ Row 19 highlighted in yellow background (warning, not error)
- ✅ Validation passes (warnings don't block import)
- ✅ Row number (19) indicated

**Pass Criteria:** ✅ Warning logged but validation passes

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

### Test Suite 4: Import Operations

#### Test 4.1: Import - Create New Notes (Small Dataset)

**Objective:** Create 5-10 new notes via import

**Prerequisites:**
- Clear Notes sheet (or delete all data rows)
- Add 5-10 test rows:
  - Leave pb_id and ext_id EMPTY (signals new notes)
  - Fill title, content, type
  - Include 1-2 with user_email (valid email from workspace)
  - Include 1-2 with tags

**Steps:**
1. Click **Validate Import Data** (should pass)
2. Click **Import Notes**
3. Wait for completion
4. Check Run Log
5. Check column A (pb_id) - should be filled
6. Check Productboard workspace

**Expected Results:**
- ✅ Status: "X created, 0 updated, 0 errors" (green)
- ✅ Run Log shows SUCCESS for each row:
  - SUCCESS (row 4): "Created note: [title]"
  - SUCCESS (row 5): "Created note: [title]"
  - ...
- ✅ Column A (pb_id) auto-filled with new UUIDs
- ✅ Notes exist in Productboard with correct data:
  - Titles match
  - Content matches
  - Types match
  - User relationships assigned correctly
  - Tags created and attached
- ✅ Import completes in <30 seconds
- ✅ No errors in Run Log

**Pass Criteria:** ✅ All notes created successfully

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 4.2: Import - Update Existing Notes (by pb_id)

**Objective:** Update existing notes using pb_id matching

**Prerequisites:**
- Export existing notes first (to get pb_id values)
- Modify 5 rows:
  - Keep pb_id unchanged
  - Change title: "Test Note 1" → "Test Note 1 UPDATED"
  - Change content
  - Change tags

**Steps:**
1. Click **Import Notes**
2. Wait for completion
3. Check Productboard workspace

**Expected Results:**
- ✅ Status: "0 created, 5 updated, 0 errors"
- ✅ Run Log shows SUCCESS with "Updated note":
  - SUCCESS (row X): "Updated note: [new title]"
- ✅ All changes reflected in Productboard:
  - Titles updated
  - Content updated
  - Tags updated
- ✅ pb_id unchanged (same UUIDs)
- ✅ No duplicate notes created
- ✅ Note IDs in Productboard match pb_id in sheet

**Pass Criteria:** ✅ All notes updated correctly via pb_id

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 4.3: Import - Update via ext_id (Migration Mode)

**Objective:** Update notes by matching ext_id (source.record_id)

**Prerequisites:**
1. Create notes in Productboard with source tracking:
   - Note 1: source.origin = `test-system`, source.record_id = `EXT-001`
   - Note 2: source.origin = `test-system`, source.record_id = `EXT-002`
2. In Notes sheet, create rows:
   - Row 4: pb_id = EMPTY, ext_id = `EXT-001`, title = "Updated via ext_id 1"
   - Row 5: pb_id = EMPTY, ext_id = `EXT-002`, title = "Updated via ext_id 2"

**Steps:**
1. Click **Import Notes**
2. Observe Run Log messages
3. Check Productboard
4. Check column A (pb_id) in sheet

**Expected Results:**
- ✅ Run Log shows:
  - INFO: "Match by ext_id: EXT-001 → [note UUID]"
  - SUCCESS: "Updated note: Updated via ext_id 1"
  - INFO: "Match by ext_id: EXT-002 → [note UUID]"
  - SUCCESS: "Updated note: Updated via ext_id 2"
- ✅ Status: "0 created, 2 updated, 0 errors"
- ✅ Existing notes updated (not duplicated)
- ✅ Column A (pb_id) filled with matched UUIDs
- ✅ Import searches through all notes to find matches

**Pass Criteria:** ✅ Notes matched by ext_id and updated

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 4.4: Import - Mixed Create/Update

**Objective:** Process mix of new and existing notes

**Prerequisites:**
- Add 10 rows to Notes sheet:
  - 5 rows with valid pb_id (from export - existing notes)
  - 5 rows with empty pb_id (new notes)
- Modify titles for all rows

**Steps:**
1. Click **Import Notes**
2. Check Run Log

**Expected Results:**
- ✅ Status: "5 created, 5 updated, 0 errors"
- ✅ Run Log shows mixed CREATE and UPDATE actions:
  - SUCCESS: "Created note: ..."
  - SUCCESS: "Updated note: ..."
- ✅ All notes processed correctly
- ✅ No duplicates created
- ✅ pb_id column filled for new notes

**Pass Criteria:** ✅ Mixed operations handled correctly

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 4.5: Import - Status Backfill (archived/processed)

**Objective:** Verify archived/processed status set via v2 after v1 import

**Prerequisites:**
- Add test rows with status fields:
  - Row 20: title="Test Archived", archived=TRUE, processed=FALSE
  - Row 21: title="Test Processed", archived=FALSE, processed=TRUE
  - Row 22: title="Test Both", archived=TRUE, processed=TRUE

**Steps:**
1. Click **Import Notes**
2. Wait for completion
3. Check Run Log for backfill messages
4. Check Productboard note status

**Expected Results:**
- ✅ Notes created via v1 API first
- ✅ Run Log shows:
  - SUCCESS (row 20): "Created note: Test Archived"
  - SUCCESS (row 21): "Created note: Test Processed"
  - SUCCESS (row 22): "Created note: Test Both"
  - INFO: "Starting v2 backfill for 3 notes..."
  - SUCCESS: "v2 backfill: [note-id-1]" (Details: "Patched: archived=true, processed=false")
  - SUCCESS: "v2 backfill: [note-id-2]" (Details: "Patched: archived=false, processed=true")
  - SUCCESS: "v2 backfill: [note-id-3]" (Details: "Patched: archived=true, processed=true")
  - SUCCESS: "v2 backfill complete: 3 succeeded, 0 failed"
- ✅ In Productboard:
  - Note 1: archived=true, processed=false
  - Note 2: archived=false, processed=true
  - Note 3: archived=true, processed=true
- ✅ Status set via v2 PATCH operation
- ✅ 2-second delay before backfill (propagation time)

**Pass Criteria:** ✅ Status fields backfilled successfully

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 4.6: Import - Creator Assignment (v2 backfill)

**Objective:** Verify creator set via v2 (not supported in v1)

**Prerequisites:**
- Add test row:
  - Row 23: title="Test Creator", creator_email=[valid user email]

**Steps:**
1. Click **Import Notes**
2. Check Run Log
3. Check Productboard note

**Expected Results:**
- ✅ Note created via v1 API (without creator)
- ✅ Run Log shows:
  - SUCCESS: "Created note: Test Creator"
  - INFO: "Starting v2 backfill for 1 notes..."
  - SUCCESS: "v2 backfill: [note-id]" (Details: "Patched: creator=[email]")
- ✅ In Productboard: Note has creator assigned

**Pass Criteria:** ✅ Creator set via v2 backfill

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 4.7: Import - Owner Backfill (v1 rejected)

**Objective:** Retry owner assignment via v2 if v1 rejects

**Prerequisites:**
- Add test row:
  - Row 24: title="Test Owner Backfill", owner_email=[email that v1 might reject]

**Steps:**
1. Click **Import Notes**
2. Check Run Log

**Expected Results:**
- ✅ If v1 rejects owner:
  - WARN: "Owner email rejected by API: [email]. Will backfill via v2."
  - SUCCESS: "Created note: Test Owner Backfill" (without owner)
  - SUCCESS: "v2 backfill: [note-id]" (Details: "Patched: owner=[email]")
- ✅ If v1 accepts owner:
  - SUCCESS: "Created note: Test Owner Backfill"
  - No backfill needed for owner

**Pass Criteria:** ✅ Owner assigned (either via v1 or v2 backfill)

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 4.8: Import - Large Dataset (Batch Processing)

**Objective:** Import ≥100 notes with automatic batching

**Prerequisites:**
- Prepare 150 test rows (or copy existing data)
- Mix of create and update operations

**Steps:**
1. Click **Import Notes**
2. Observe batch progress bar
3. Wait for completion

**Expected Results:**
- ✅ Message: "Import batch started (3 chunks, 150 notes)"
- ✅ Batch progress bar appears in sidebar
- ✅ Auto-polling every 2 seconds
- ✅ Progress: "1/3 jobs complete" → "2/3" → "3/3"
- ✅ Main progress bar: 0% → 33% → 67% → 100%
- ✅ Sub-progress shows:
  - "Importing note X/50..."
  - "Backfilling status..."
- ✅ Each chunk processes ~50 notes
- ✅ Status backfill runs per chunk
- ✅ Import completes in <5 minutes
- ✅ Alert: "Batch processing complete!"
- ✅ All notes created/updated
- ✅ Run Log shows results for all 150 notes

**Pass Criteria:** ✅ Large import completes via batching

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 4.9: Import - Error Handling (Partial Failure)

**Objective:** Verify errors logged and import continues

**Prerequisites:**
- Add 5 rows with mixed valid/invalid data:
  - Row 25: Valid data
  - Row 26: Invalid data (title too long, 10000 chars)
  - Row 27: Valid data
  - Row 28: Invalid email format (will fail validation first - fix for test)
  - Row 29: Valid data

**Steps:**
1. Click **Import Notes**
2. Check Run Log

**Expected Results:**
- ✅ Rows 25, 27, 29: SUCCESS
- ✅ Row 26: ERROR with API error details
- ✅ Status: "3 created/updated, 1 errors"
- ✅ Import continues despite error (doesn't stop at row 26)
- ✅ Error messages descriptive (show what went wrong)

**Pass Criteria:** ✅ Errors logged but don't stop entire import

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 4.10: Import - Tags Creation

**Objective:** Verify tags created from comma-separated string

**Prerequisites:**
- Add test row:
  - Row 30: title="Test Tags", tags="urgent, bug, customer-feedback"

**Steps:**
1. Import note
2. Check Productboard

**Expected Results:**
- ✅ Note created with 3 tags
- ✅ Tags: "urgent", "bug", "customer-feedback"
- ✅ Tags auto-created in Productboard if don't exist
- ✅ Whitespace trimmed correctly (no leading/trailing spaces)
- ✅ Tags appear in Productboard note detail

**Pass Criteria:** ✅ Tags created and attached correctly

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

### Test Suite 5: Delete Operations

#### Test 5.1: Delete Notes - Small Dataset

**Objective:** Delete 5-10 notes from Productboard

**Prerequisites:**
- Notes sheet has 5-10 rows with valid pb_id (from export or import)

**Steps:**
1. Note pb_id values for verification
2. Click **Delete All Notes** (button in sidebar)
3. Confirm deletion in dialog
4. Wait for completion
5. Check Productboard

**Expected Results:**
- ✅ Confirmation dialog shows: "You are about to delete X note(s)..."
- ✅ User clicks YES to confirm
- ✅ Status: "Deleted X notes, 0 errors"
- ✅ Run Log shows SUCCESS for each note:
  - SUCCESS (row X): "Deleted note (v2): [note-id]"
- ✅ Column A (pb_id) cleared for deleted notes
- ✅ Notes no longer exist in Productboard (verify by ID)
- ✅ Deletion uses v2 API DELETE endpoint

**Pass Criteria:** ✅ All notes deleted successfully

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 5.2: Delete Notes - Cancel Operation

**Objective:** Verify user can cancel deletion

**Steps:**
1. Click **Delete All Notes**
2. Click NO in confirmation dialog

**Expected Results:**
- ✅ Dialog closes
- ✅ No deletion occurs
- ✅ No log entries added
- ✅ Notes remain in Productboard

**Pass Criteria:** ✅ Deletion cancelled cleanly

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 5.3: Batch Delete Summary Logging

**Objective:** Verify single summary row logged after all batch delete jobs complete

**Prerequisites:**
- Import 150 notes (triggers batching for delete)
- Notes sheet has 150 rows with valid pb_id values

**Steps:**
1. Click **Delete All Notes** and confirm
2. Wait for all batch jobs to complete
3. Check Run Log for summary entry

**Expected Results:**
- ✅ Individual chunk successes logged during processing
- ✅ ONE final summary row appears in Run Log after all batches complete:
  ```
  Batch delete complete: 150 notes deleted over 3 batch(es)
  Success: 150, Errors: 0, Warnings: 0
  ```
- ✅ Summary shows cumulative totals across all batches
- ✅ Status is SUCCESS (green) if no errors, WARN (yellow) if errors occurred
- ✅ Summary is the final entry in Run Log for this operation

**Pass Criteria:** ✅ Single summary row with accurate totals logged after batch completion

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

### Test Suite 6: Batch Queue Management

#### Test 6.1: Batch Queue - Progress Tracking

**Objective:** Verify real-time progress tracking

**Prerequisites:**
- Large dataset to trigger batching (100+ notes)

**Steps:**
1. Start large import or export
2. Observe progress bar and messages
3. Monitor updates every 2 seconds

**Expected Results:**
- ✅ Progress bar appears immediately
- ✅ Progress bar animates smoothly
- ✅ Percentage updates accurately: 0% → 10% → ... → 100%
- ✅ Main progress text: "X/Y jobs complete"
- ✅ Sub-progress text updates:
  - "Fetching notes..."
  - "Importing note 5/50..."
  - "Backfilling status..."
- ✅ Auto-polling works (updates every ~2 seconds)
- ✅ Progress matches actual completion
- ✅ Final alert: "Batch processing complete!"

**Pass Criteria:** ✅ Progress updates accurate and smooth

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 6.2: Batch Queue - Clear Queue

**Objective:** Test clearing batch queue mid-operation

**Prerequisites:**
- Large import/export in progress

**Steps:**
1. Start large operation (batched)
2. After 1 chunk completes, click **Clear Queue**
3. Confirm

**Expected Results:**
- ✅ Batch progress bar disappears
- ✅ Polling stops (no more updates)
- ✅ Alert: "Batch queue cleared"
- ✅ Partial data imported/exported (first chunk)
- ✅ No errors from cancellation
- ✅ Sheet remains in consistent state
- ✅ Can start new operation after clearing

**Pass Criteria:** ✅ Queue clears cleanly without errors

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

## Integration Testing

### Test Suite 7: End-to-End Workflows

#### Test 7.1: Full Export-Import Cycle

**Objective:** Export notes, modify, re-import

**Steps:**
1. **Export**: Export all notes from Productboard
2. **Modify**: Change 5 note titles in sheet (keep pb_id)
3. **Validate**: Run validation (should pass)
4. **Import**: Import modified notes
5. **Verify**: Check Productboard for updates

**Expected Results:**
- ✅ Export: All notes exported successfully
- ✅ Modify: Titles changed in sheet
- ✅ Validate: No errors, ready to import
- ✅ Import: 5 updated, 0 created, 0 errors
- ✅ Verify: Productboard shows updated titles
- ✅ No duplicates created
- ✅ Other fields unchanged

**Pass Criteria:** ✅ Full cycle completes without data loss

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 7.2: Migration Workflow (External System)

**Objective:** Simulate migration from external system using ext_id

**Steps:**
1. **Prepare**: Create 10 rows with:
   - pb_id = EMPTY
   - ext_id = `ZENDESK-001`, `ZENDESK-002`, ..., `ZENDESK-010`
   - source_origin = `zendesk`
   - source_record_id = same as ext_id
   - Valid title, content
2. **First Import**: Import notes (should create all)
3. **Verify**: Check Productboard, notes have source tracking
4. **Clear Sheet**: Delete pb_id values (simulate fresh import)
5. **Second Import**: Import same rows again (should update via ext_id)
6. **Verify**: No duplicates, existing notes updated

**Expected Results:**
- ✅ First import: 10 created, 0 updated
- ✅ Productboard: Notes have source.origin=zendesk, source.record_id=ZENDESK-XXX
- ✅ Clear: pb_id column empty in sheet
- ✅ Second import: 0 created, 10 updated
- ✅ Run Log shows: "Match by ext_id: ZENDESK-001 → [uuid]"
- ✅ No duplicates in Productboard
- ✅ Notes updated correctly

**Pass Criteria:** ✅ Migration workflow works with ext_id matching

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

## Performance Testing

### Test Suite 8: Performance Benchmarks

#### Test 8.1: Export Performance

**Objective:** Measure export performance for various dataset sizes

**Test Cases:**

| Dataset Size | Expected Time | Actual Time | Pass/Fail |
|--------------|---------------|-------------|-----------|
| 10 notes | <10s | | |
| 50 notes | <30s | | |
| 100 notes | <60s | | |
| 500 notes | <3min | | |
| 1000 notes | <5min | | |

**How to Measure:**
1. Note start time (check clock or Run Log timestamp)
2. Start export
3. Note end time
4. Calculate duration
5. Record in table above

**Pass Criteria:** ✅ All exports complete within expected time

---

#### Test 8.2: Import Performance

**Objective:** Measure import performance for various dataset sizes

**Test Cases:**

| Dataset Size | Expected Time | Actual Time | Pass/Fail |
|--------------|---------------|-------------|-----------|
| 10 notes | <30s | | |
| 50 notes | <90s | | |
| 100 notes | <2min | | |
| 500 notes | <10min | | |
| 1000 notes | <20min | | |

**Notes:**
- Import is slower than export (includes validation + API writes)
- Includes status backfill time

**Pass Criteria:** ✅ All imports complete within expected time

---

#### Test 8.3: Validation Performance

**Objective:** Measure validation performance

**Test Cases:**

| Dataset Size | Expected Time | Actual Time | Pass/Fail |
|--------------|---------------|-------------|-----------|
| 100 rows | <5s | | |
| 500 rows | <10s | | |
| 1000 rows | <15s | | |

**Notes:**
- Validation is local (no API calls)
- Auto-fix may add slight overhead

**Pass Criteria:** ✅ Validation completes quickly for all sizes

---

## Error Handling Testing

### Test Suite 9: API Error Scenarios

#### Test 9.1: Invalid API Token

**Objective:** Handle invalid/expired API token

**Steps:**
1. Go to Settings
2. Enter invalid API token: `invalid-token-12345`
3. Click Save Settings
4. Try to export or import

**Expected Results:**
- ✅ Error status (red)
- ✅ Message: "Authentication failed... Check API token."
- ✅ Run Log shows ERROR with 401 status
- ✅ Operation stops gracefully
- ✅ No sheet corruption

**Pass Criteria:** ✅ Clear error message, graceful failure

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 9.2: Insufficient Permissions

**Objective:** Handle token with insufficient permissions

**Steps:**
1. Use token without `notes:write` permission
2. Try to import notes

**Expected Results:**
- ✅ Error status (red)
- ✅ Message: "Permission denied... Check API token permissions."
- ✅ Run Log shows ERROR with 403 status
- ✅ Specific permission mentioned if API provides it

**Pass Criteria:** ✅ Clear permission error message

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 9.3: Network Interruption

**Objective:** Handle temporary network failures

**Steps:**
1. Start large import
2. Temporarily disable network (airplane mode or network off)
3. Wait 10 seconds
4. Re-enable network

**Expected Results:**
- ✅ Retry logic kicks in (exponential backoff)
- ✅ Run Log shows: "Rate limited... Using backoff: Xms"
- ✅ Operation resumes after network restored
- ✅ Import/export completes successfully
- ✅ No data loss

**Pass Criteria:** ✅ Transient failures handled with retries

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 9.4: 404 Not Found

**Objective:** Handle note not found (deleted externally)

**Steps:**
1. Export notes
2. Delete one note directly in Productboard
3. Try to import (update) that note using old pb_id

**Expected Results:**
- ✅ ERROR in Run Log for that row:
  - ERROR (row X): "Resource not found... Note may have been deleted."
- ✅ Other notes import successfully
- ✅ Import continues (doesn't stop on 404)

**Pass Criteria:** ✅ 404 handled gracefully, operation continues

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

### Test Suite 10: Rate Limiting

#### Test 10.1: Adaptive Throttling

**Objective:** Verify rate limiter prevents 429 errors

**Steps:**
1. Start large import/export (1000+ operations)
2. Monitor Run Log for rate limit warnings
3. Watch for 429 errors

**Expected Results:**
- ✅ No 429 errors occur
- ✅ Run Log may show:
  - INFO: "Rate limit low (X remaining), throttling to Xms"
  - INFO: "Rate limit warning: X/50 requests remaining"
- ✅ Operations slow down when quota low
- ✅ Operations complete successfully
- ✅ Adaptive throttling prevents hitting limit

**Pass Criteria:** ✅ No 429 errors, adaptive throttling works

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

## Edge Case Testing

### Test Suite 11: Edge Cases

#### Test 11.1: Empty Sheet Import

**Objective:** Handle import with no data gracefully

**Steps:**
1. Clear all data rows (keep headers)
2. Click Import Notes

**Expected Results:**
- ✅ Status: "No data to import" (success)
- ✅ No errors thrown
- ✅ Completes instantly
- ✅ No API calls made

**Pass Criteria:** ✅ Empty import handled gracefully

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 11.2: Very Long Content

**Objective:** Test maximum content length

**Prerequisites:**
- Add row with content = 10,000 characters

**Steps:**
1. Import note
2. Check Productboard

**Expected Results:**
- ✅ Note created successfully OR
- ✅ Error logged with API limit message
- ✅ No crash or hang
- ✅ Other notes continue to import

**Pass Criteria:** ✅ Long content handled appropriately

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 11.3: Special Characters & Unicode

**Objective:** Test Unicode, emojis, special characters

**Prerequisites:**
- Add row with:
  - title: `Test 🚀 Note with émojis & spëcial çhars`
  - content: Contains quotes "", apostrophes '', <> & symbols
  - tags: `测试, тест, 🔥`

**Steps:**
1. Import note
2. Export note
3. Compare data

**Expected Results:**
- ✅ All special characters preserved
- ✅ Emojis display correctly
- ✅ No encoding issues
- ✅ Round-trip data integrity (import → export → same data)

**Pass Criteria:** ✅ Special characters handled correctly

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

#### Test 11.4: Maximum Column Width

**Objective:** Test very long field values

**Prerequisites:**
- Add row with:
  - title: 500 characters
  - tags: 50 tags (comma-separated)

**Steps:**
1. Import note
2. Export note
3. Check sheet formatting

**Expected Results:**
- ✅ Long values handled
- ✅ No cell overflow issues
- ✅ Sheet remains readable
- ✅ Data preserved

**Pass Criteria:** ✅ Long values handled gracefully

**Actual Results:**
- [ ] Pass
- [ ] Fail - Notes:

---

## Regression Testing

### Test Suite 12: Regression Scenarios

**Purpose:** Re-run critical tests after code changes

**Critical Tests to Re-Run:**
- [ ] Test 1.1: Create Notes Sheet
- [ ] Test 2.1: Export Small Dataset
- [ ] Test 2.3: Export Large Dataset (batching)
- [ ] Test 3.1: Validation - Valid Data
- [ ] Test 3.7: Auto-Fix Display URL
- [ ] Test 4.1: Import - Create New Notes
- [ ] Test 4.2: Import - Update by pb_id
- [ ] Test 4.5: Import - Status Backfill
- [ ] Test 4.8: Import - Batch Processing
- [ ] Test 7.1: Full Export-Import Cycle
- [ ] Test 9.1: Invalid API Token
- [ ] Test 10.1: Adaptive Throttling

**Regression Test Log:**

| Test # | Test Name | Date | Pass/Fail | Notes |
|--------|-----------|------|-----------|-------|
| | | | | |

---

## Test Results Documentation

### Test Summary Template

```
Test Run Summary
================
Date: [YYYY-MM-DD]
Tester: [Name]
Environment: [Test/Staging/Production]
Version: [Tool version]

Results:
--------
Total Tests: X
Passed: X
Failed: X
Skipped: X
Pass Rate: X%

Failed Tests:
-------------
1. Test X.X: [Test Name]
   - Issue: [Description]
   - Severity: [Critical/High/Medium/Low]
   - Action: [Fix required/Known issue/Won't fix]

2. ...

Notes:
------
[Any additional observations]

Sign-off:
---------
Tester: [Name] [Date]
Reviewer: [Name] [Date]
```

### Bug Report Template

```
Bug Report
==========
Bug ID: BUG-XXXX
Date: [YYYY-MM-DD]
Tester: [Name]

Summary:
--------
[One-line description]

Test Case:
----------
Test X.X: [Test Name]

Steps to Reproduce:
-------------------
1. [Step 1]
2. [Step 2]
3. [Step 3]

Expected Result:
----------------
[What should happen]

Actual Result:
--------------
[What actually happened]

Severity:
---------
[ ] Critical - System unusable
[ ] High - Major feature broken
[ ] Medium - Feature partially broken
[ ] Low - Minor issue

Logs:
-----
[Paste relevant Run Log entries or error messages]

Screenshots:
------------
[Attach if applicable]

Environment:
------------
- Google Sheets version: [version]
- Browser: [Chrome/Firefox/Safari] [version]
- OS: [Windows/Mac/Linux]

Additional Notes:
-----------------
[Any other relevant information]
```

---

## Appendix

### Quick Test Data

**Valid User Emails for Testing:**
```
user1@example.com
user2@example.com
owner@example.com
creator@example.com
```

**Valid Company Domains for Testing:**
```
example.com
testcompany.com
acmecorp.com
```

**Sample Tags:**
```
test, demo, urgent, bug, feature, feedback, sales, support
```

**Sample Source Origins:**
```
zendesk, salesforce, jira, intercom, hubspot, custom-system
```

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Open Apps Script | Alt+T, E |
| View Logs | Ctrl+Enter (in Apps Script editor) |
| Refresh Sheet | Ctrl+R or Cmd+R |
| Find in Sheet | Ctrl+F or Cmd+F |

### Useful Apps Script Commands

**View Execution Log:**
```
1. Apps Script Editor → Executions
2. Click on execution to see logs
```

**Clear Script Properties (reset settings):**
```javascript
PropertiesService.getScriptProperties().deleteAllProperties();
```

**Get Rate Limiter Stats:**
```javascript
getRateLimiterStats_(); // Run in Apps Script editor
```

---

**End of Testing Guide** | Version: 2.0 | Last Updated: 2026-02-07

**Next Steps:**
1. Set up test environment
2. Run functional tests (Test Suites 1-6)
3. Document results
4. Report bugs
5. Re-test after fixes
6. Run regression tests before release
