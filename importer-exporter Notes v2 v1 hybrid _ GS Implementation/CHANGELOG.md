# Changelog - Notes Import/Export Tool

## [2.2] - 2026-02-07

### Added

#### 1. Auto-activate Run Log Sheet
- **Feature**: Automatically switch to Run Log sheet when status message mentions "Check Run Log"
- **Files Changed**: `notesSidebar.gs`, `Sidebar_Notes.html`
- **Details**:
  - New backend function `NotesSidebar_activateRunLogSheet()` to activate the Run Log sheet
  - Modified `showStatus()` function to detect messages containing "Check Run Log"
  - When detected, automatically calls backend to activate Run Log sheet
  - Provides seamless UX - users no longer need to manually navigate to Run Log sheet
  - Works for all status messages: export, import, delete, validate, batch operations

### Fixed

#### 2. Export Relationship Data Population (user_email, company_domain)
- **Issue**: Export was not populating `user_email` and `company_domain` columns
- **Root Cause**: v2 API `/v2/notes/{id}/relationships` endpoint returns only entity references (UUID, type, links) but NOT the actual email/domain fields
- **Solution**: Implemented bulk fetch + reconcile pattern with sheet-based caching
- **Files Changed**: `notesMain.gs`, `notesExporter.gs`
- **Details**:
  - Added v1 company endpoints to `PB_NOTES_V1` constant (`LIST_COMPANIES`, `GET_COMPANY`)
  - Added `EXPORT_CACHE_SHEET` constant for temporary cache storage
  - New function `buildUserLookupCache_()` - fetches all users via v1 `/users` endpoint, builds Map of UUID → email
  - New function `buildCompanyLookupCache_()` - fetches all companies via v1 `/companies` endpoint, builds Map of UUID → domain
  - New function `storeCacheInSheet_()` - creates hidden `_ExportCache` sheet and stores caches as JSON
  - New function `getCacheFromSheet_()` - retrieves and deserializes caches from sheet
  - New function `deleteCacheSheet_()` - cleans up cache sheet after export completes
  - Updated `ExportNotes_()` to build caches before fetching notes (direct execution)
  - Updated `ExportNotesChunk_()` to build/store caches only on first chunk, retrieve from sheet for subsequent chunks, delete on completion or error
  - Updated `transformNotesToSheetFormat_()` to accept cache parameters and use UUID lookups instead of direct field access

**How It Works**:
- **Direct Export**: Builds both caches, uses them during transformation, no sheet storage needed
- **Batch Export**:
  - Chunk 0: Builds caches, stores in hidden `_ExportCache` sheet
  - Chunks 1+: Retrieves caches from sheet
  - Final chunk or error: Deletes `_ExportCache` sheet

**Benefits**:
- No Script Properties size limits (can handle 10,000+ users/companies)
- Efficient bulk fetching (100 entities per API call vs 1 per call)
- Cleaner persistence across batch chunks
- Automatic cleanup on completion or error
- Properly populates `user_email` and `company_domain` columns that were previously empty

---

## [2.1] - 2026-02-07

### Added

#### 4. UI Status Clarity Improvements
- **Feature**: Clear all status messages when starting a new action
- **Files Changed**: `Sidebar_Notes.html`
- **Details**:
  - New function `clearAllStatuses()` clears all status divs (export, validate, import, delete, settings)
  - Called automatically at the start of every action button (Export, Validate, Import, Delete, Setup Sheet, Delete Sheet)
  - Prevents confusion from seeing old status messages when starting a new operation
  - Example: Clicking "Import" clears the old "Export complete" message

#### 5. Clear Queue Button Always Available
- **Feature**: Keep "Clear Queue" button enabled during batch operations
- **Files Changed**: `Sidebar_Notes.html`
- **Details**:
  - Modified `disableButtons()` to exclude the "Clear Queue" button from disabling
  - During batch processing, all buttons are disabled EXCEPT "Clear Queue"
  - Allows user to stop a running batch operation at any time
  - Critical for long-running operations that need to be cancelled

### Added (from earlier in session)

#### 1. Batch Summary Logging for Delete Operations
- **Feature**: Final summary log entry after all batch jobs complete
- **Files Changed**: `notesBatchQueue.gs`
- **Details**:
  - Added cumulative tracking for `totalDeleted`, `totalCreated`, `totalUpdated` in batch queue
  - New function `writeBatchSummaryToLog_()` writes a single summary row to Run Log after all jobs complete
  - Summary format for delete operations:
    ```
    Batch delete complete: X notes deleted over Y batch(es)
    Success: X, Errors: Y, Warnings: Z
    ```
  - Summary format for import operations:
    ```
    Batch import complete: X created, Y updated over Z batch(es)
    Success: X, Errors: Y, Warnings: Z
    ```
  - Summary is written with status SUCCESS or WARN based on error count

#### 2. Export Replace/Append Option
- **Feature**: User can choose to replace or append data during export
- **Files Changed**: `Sidebar_Notes.html`, `notesSidebar.gs`
- **Details**:
  - Added checkbox in Export section: "Replace current Notes sheet data (uncheck to append)"
  - Checkbox defaults to checked (replace behavior)
  - Export function now passes `replaceData` parameter from UI to backend
  - When unchecked, exported data is appended to existing Notes sheet instead of replacing
  - Updated help text to reflect new option

### Fixed

#### 3. Infinity Loop Prevention
- **Issue**: Potential infinite loops in export and import operations
- **Files Changed**: `notesExporter.gs`, `notesImporter.gs`
- **Fixes Applied**:

  **Export Chunk Infinite Loop Prevention:**
  - Added `MAX_EXPORT_CHUNKS` safety limit (500 chunks = 100,000 notes max)
  - Prevents creation of new jobs beyond safety limit
  - Added duplicate cursor detection: if API returns same cursor twice, stops to prevent infinite loop
  - Logs warning to Run Log if safety limit reached

  **Import ext_id Search Infinite Loop Prevention:**
  - Added `MAX_PAGES` safety limit in `findNoteBySourceRecordId_()` (1000 pages = 100,000 notes max)
  - Added page counter to prevent infinite pagination
  - Logs warning to Run Log if safety limit reached
  - Prevents script from hanging if API pagination misbehaves

### Technical Details

#### Batch Queue Enhancements
- Batch queue now tracks:
  - `totalDeleted` - Cumulative count of deleted notes
  - `totalCreated` - Cumulative count of created notes
  - `totalUpdated` - Cumulative count of updated notes
  - `totalErrors` - Cumulative error count (existing)
  - `totalWarnings` - Cumulative warning count (existing)

- Summary is written automatically when `allDone` condition is met
- Summary message varies by `batchType`:
  - `delete-notes`: Shows total deleted
  - `import-notes`: Shows total created and updated
  - `export-notes`: Shows batch count
  - Other types: Generic message

#### Safety Limits
- Export: Max 500 chunks (100,000 notes at 200 per chunk)
- Import search: Max 1000 pages (100,000 notes at 100 per page)
- Duplicate cursor detection prevents API bugs from causing infinite loops
- All safety limits log warnings to Run Log for visibility

#### UI Improvements
- Export checkbox provides clear choice: replace vs append
- Checkbox label uses polished language: "Replace current Notes sheet data (uncheck to append)"
- Help text updated to mention the option
- Default behavior unchanged (replace = checked)

### Testing Recommendations

**Test 1: Batch Delete Summary**
1. Import 150 notes (triggers batching)
2. Delete all notes
3. Check Run Log - should see individual chunk successes PLUS one final summary:
   ```
   Batch delete complete: 150 notes deleted over 3 batch(es)
   Success: 150, Errors: 0, Warnings: 0
   ```

**Test 2: Export Replace vs Append**
1. Export 10 notes (checkbox checked - default)
2. Verify Notes sheet has 10 rows
3. Uncheck "Replace current Notes sheet data" checkbox
4. Export again
5. Verify Notes sheet has 20 rows (appended, not replaced)

**Test 3: Infinity Loop Prevention**
1. Large export test: Export 10,000+ notes
2. Monitor for completion without hanging
3. Check Run Log for safety limit warnings (if any)
4. Import test: Import notes with ext_id matching
5. Verify import completes without hanging

### Backward Compatibility
- All changes are backward compatible
- Default behaviors unchanged:
  - Export still replaces by default (checkbox checked)
  - Batch operations work as before
  - No breaking changes to API calls

### Known Limitations
- Safety limits are generous (100,000 notes) but may need adjustment for very large workspaces
- Duplicate cursor detection assumes API behaves correctly 99% of the time
- If workspace has more than 100,000 notes, export will stop at limit (can be increased if needed)

---

## [2.0] - 2026-02-07 (Initial Release)
- Hybrid v1/v2 API implementation
- Batch processing for large datasets
- Adaptive rate limiting
- Auto-fix validation
- Comprehensive error handling
- v2 status backfill
- Complete documentation

---

**Version Numbering:**
- Major version (X.0): Breaking changes
- Minor version (X.Y): New features, enhancements
- Patch version (X.Y.Z): Bug fixes only
