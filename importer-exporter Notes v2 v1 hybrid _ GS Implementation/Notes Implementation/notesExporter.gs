/** ===========================================================
 * Notes Import/Export Tool - Export Workflow
 *
 * This file contains:
 * - Export orchestration (v2 API)
 * - Cursor-based pagination
 * - Parallel relationship fetching
 * - Data transformation
 * - Sheet writing with batching support
 * =========================================================== */

/** =========================
 *  EXPORT MAIN FUNCTION
 * ========================= */

/**
 * Export notes from Productboard v2 API with relationships
 * @param {Object} options - Export options
 * @param {boolean} options.replaceData - Replace existing data (default: true)
 * @returns {Object} Result with fetched count, written count, and message
 */
function ExportNotes_(options) {
  clearRunLog_();
  options = options || {};
  const replaceData = options.replaceData !== false;

  Logger.log('Starting export of notes...');
  logToRunLog_('Notes', null, 'INFO', 'Starting export from Productboard v2 API...', '');
  resetRateLimiter_();

  try {
    BatchQueue_setSubProgress('Checking dataset size...', 5);
    logToRunLog_('Notes', null, 'INFO', 'Checking dataset size...', '');

    // Estimate size by fetching first page to check if we need batching
    let estimatedTotal = 0;
    let cursor = null;
    const sampleLimit = 1000;

    // Fetch sample to estimate total
    do {
      const url = `/v2/notes${cursor ? `?pageCursor=${cursor}` : ''}`;
      const response = pbCallWithRetry_(() => pbFetch_('get', url), 'estimate dataset size');

      estimatedTotal += response.data.length;
      cursor = extractCursor_(response.links?.next);

      if (estimatedTotal >= sampleLimit) break;
    } while (cursor);

    logToRunLog_('Notes', null, 'INFO', `Dataset size: ${estimatedTotal}${cursor ? '+' : ''} notes`, '');

    // Batching decision
    if (estimatedTotal >= BATCH_THRESHOLD_EXPORT || cursor) {
      Logger.log(`Large dataset (${estimatedTotal}+ notes), using batch queue...`);
      logToRunLog_('Notes', null, 'INFO', `Large dataset detected (${estimatedTotal}+ notes). Using batch processing...`, '');

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
    logToRunLog_('Notes', null, 'INFO', 'Direct export mode (dataset under batch threshold)', '');

    // Build lookup caches before fetching notes
    BatchQueue_setSubProgress('Building user/company caches...', 5);
    const userLookup = buildUserLookupCache_();
    const companyLookup = buildCompanyLookupCache_();

    BatchQueue_setSubProgress('Fetching notes...', 10);
    logToRunLog_('Notes', null, 'INFO', 'Fetching all notes from v2 API...', '');
    const notes = fetchAllNotesV2_();

    if (notes.length === 0) {
      logToRunLog_('Notes', null, 'WARN', 'No notes found in Productboard', '');
      return { fetched: 0, written: 0, message: 'No notes found.' };
    }

    logToRunLog_('Notes', null, 'INFO', `Fetched ${notes.length} notes`, '');

    BatchQueue_setSubProgress('Fetching relationships...', 50);
    logToRunLog_('Notes', null, 'INFO', `Fetching relationships for ${notes.length} notes...`, '');
    fetchRelationshipsForNotes_(notes);

    BatchQueue_setSubProgress('Transforming data...', 80);
    logToRunLog_('Notes', null, 'INFO', 'Transforming notes to sheet format...', '');
    const rows = transformNotesToSheetFormat_(notes, userLookup, companyLookup);

    BatchQueue_setSubProgress('Writing to sheet...', 90);
    logToRunLog_('Notes', null, 'INFO', `Writing ${rows.length} rows to ${NOTES_SHEET} sheet...`, '');
    const sheet = getOrCreateNotesSheet_();
    writeNotesToSheet_(sheet, rows, replaceData);

    BatchQueue_setSubProgress('Enriching source origins from v1...', 93);
    enrichNotesSourceFromV1_(sheet);

    BatchQueue_setSubProgress('Export complete', 100);
    logToRunLog_('Notes', null, 'SUCCESS', `Export complete: ${notes.length} notes exported successfully`, '');

    // Format Run Log with color coding
    formatRunLog_();

    return {
      fetched: notes.length,
      written: rows.length,
      message: `Exported ${notes.length} notes successfully.`
    };
  } catch (err) {
    Logger.log('Error during export: ' + err);
    logToRunLog_('Notes', null, 'ERROR', 'Export failed', String(err));
    throw err;
  }
}

/**
 * Export a chunk of notes (for batch processing)
 * @param {string} pageCursor - Pagination cursor (null for first chunk)
 * @param {number} chunkIndex - Chunk index for logging
 * @param {boolean} replaceData - Replace existing data
 * @returns {Object} Result with nextCursor and written count
 */
function ExportNotesChunk_(pageCursor, chunkIndex, replaceData) {
  Logger.log(`Exporting notes chunk ${chunkIndex}...`);
  logToRunLog_('Notes', null, 'INFO', `Starting chunk ${chunkIndex} export...`, pageCursor ? `Cursor: ${pageCursor.substring(0, 20)}...` : 'First chunk');
  resetRateLimiter_();

  let userLookup, companyLookup;

  try {
    // Build caches only for first chunk, store in sheet
    if (chunkIndex === 0) {
      BatchQueue_setSubProgress('Building user/company caches...', 5);
      userLookup = buildUserLookupCache_();
      companyLookup = buildCompanyLookupCache_();

      // Store caches in sheet for subsequent chunks
      storeCacheInSheet_(userLookup, companyLookup);
    } else {
      // Retrieve caches from sheet for subsequent chunks
      const caches = getCacheFromSheet_();
      userLookup = caches.userLookup;
      companyLookup = caches.companyLookup;
    }

    BatchQueue_setSubProgress(`Fetching chunk ${chunkIndex}...`, 10);

    // Fetch one chunk of notes
    const chunkSize = CHUNK_SIZE_EXPORT;
    const notes = [];
    let cursor = pageCursor;
    let fetched = 0;
    let previousCursor = null;

    while (fetched < chunkSize) {
      const url = `/v2/notes${cursor ? `?pageCursor=${cursor}` : ''}`;
      const response = pbCallWithRetry_(() => pbFetch_('get', url), `fetch notes chunk ${chunkIndex}`);

      if (!response.data || response.data.length === 0) {
        break;
      }

      notes.push(...response.data);
      fetched += response.data.length;
      previousCursor = cursor;
      cursor = extractCursor_(response.links?.next);

      // Safety check: prevent infinite loop if API returns same cursor
      if (cursor && cursor === previousCursor) {
        Logger.log(`WARNING: API returned same cursor twice. Breaking to prevent infinite loop.`);
        logToRunLog_('Notes', null, 'WARN', `Chunk ${chunkIndex}: API returned duplicate cursor`, 'Stopping chunk to prevent infinite loop. This may indicate an API issue.');
        cursor = null; // Force stop
        break;
      }

      if (!cursor) break;
    }

    if (notes.length === 0) {
      logToRunLog_('Notes', null, 'INFO', `Chunk ${chunkIndex}: No more notes to export`, '');
      return {
        written: 0,
        nextCursor: null,
        message: `Chunk ${chunkIndex}: No more notes to export`
      };
    }

    logToRunLog_('Notes', null, 'INFO', `Chunk ${chunkIndex}: Fetched ${notes.length} notes`, '');

    BatchQueue_setSubProgress(`Fetching relationships for chunk ${chunkIndex}...`, 40);
    fetchRelationshipsForNotes_(notes);

    BatchQueue_setSubProgress(`Transforming chunk ${chunkIndex}...`, 70);
    const rows = transformNotesToSheetFormat_(notes, userLookup, companyLookup);

    BatchQueue_setSubProgress(`Writing chunk ${chunkIndex} to sheet...`, 90);
    const sheet = getOrCreateNotesSheet_();
    writeNotesToSheet_(sheet, rows, replaceData && chunkIndex === 0);

    logToRunLog_('Notes', null, 'SUCCESS', `Chunk ${chunkIndex}: Exported ${notes.length} notes`, cursor ? 'More chunks to follow' : 'Final chunk');

    // Format Run Log and delete cache on final chunk
    if (!cursor) {
      formatRunLog_();
      deleteCacheSheet_(); // Clean up cache sheet
      // Enrich source origins from v1 API after all chunks are written
      BatchQueue_setSubProgress('Enriching source origins from v1...', 95);
      enrichNotesSourceFromV1_(sheet);
    }

    // If there's more data, create next job (with safety limit)
    const MAX_EXPORT_CHUNKS = 500; // Safety limit: max 500 chunks * 200 notes = 100,000 notes
    if (cursor && chunkIndex < MAX_EXPORT_CHUNKS) {
      const nextJob = {
        type: 'export-notes-chunk',
        pageCursor: cursor,
        chunkIndex: chunkIndex + 1,
        replaceData: false
      };
      const queue = BatchQueue_getStatus();
      queue.jobs.push({
        id: queue.jobs.length,
        ...nextJob,
        status: 'pending',
        startedAt: null,
        completedAt: null,
        result: null
      });
      queue.totalJobs++;
      PropertiesService.getScriptProperties().setProperty('BATCH_QUEUE', JSON.stringify(queue));
    } else if (cursor && chunkIndex >= MAX_EXPORT_CHUNKS) {
      // Safety limit reached
      logToRunLog_('Notes', null, 'WARN', `Export stopped: reached maximum chunk limit (${MAX_EXPORT_CHUNKS} chunks)`, 'This is a safety limit to prevent infinite loops. Contact support if you need to export more than 100,000 notes.');
      Logger.log(`WARNING: Export stopped at chunk ${chunkIndex} due to safety limit`);
    }

    return {
      written: rows.length,
      nextCursor: cursor,
      message: `Chunk ${chunkIndex}: Exported ${notes.length} notes`
    };
  } catch (err) {
    Logger.log(`Error exporting chunk ${chunkIndex}: ${err}`);
    logToRunLog_('Notes', null, 'ERROR', `Chunk ${chunkIndex} failed`, String(err));

    // Clean up cache sheet on error
    deleteCacheSheet_();

    throw err;
  }
}

/** =========================
 *  V2 API FETCH FUNCTIONS
 * ========================= */

/**
 * Fetch all notes from v2 API using cursor pagination
 * @returns {Array} Array of note objects
 */
function fetchAllNotesV2_() {
  Logger.log('Fetching all notes from v2 API...');
  const notes = [];
  let cursor = null;

  do {
    const url = `/v2/notes${cursor ? `?pageCursor=${cursor}` : ''}`;
    const response = pbCallWithRetry_(() => pbFetch_('get', url), 'fetch notes');

    if (response.data && response.data.length > 0) {
      notes.push(...response.data);
      Logger.log(`Fetched ${notes.length} notes so far...`);
    }

    cursor = extractCursor_(response.links?.next);

  } while (cursor);

  Logger.log(`Fetched ${notes.length} notes total`);
  return notes;
}

/**
 * Extract cursor from pagination link
 * @param {string} nextLink - Next link URL
 * @returns {string|null} Cursor value or null
 */
function extractCursor_(nextLink) {
  if (!nextLink) return null;

  try {
    // Extract pageCursor parameter from URL
    const match = nextLink.match(/pageCursor=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch (e) {
    Logger.log('Warning: Could not extract cursor from link: ' + nextLink);
    return null;
  }
}

/**
 * Build a cache of user UUID → email mappings
 * @returns {Map} Map of UUID (string) → email (string)
 */
function buildUserLookupCache_() {
  Logger.log('Building user lookup cache for export...');
  logToRunLog_('Notes', null, 'INFO', 'Fetching all users for email lookup...', '');

  const userMap = new Map(); // UUID → email
  let pageOffset = 0;
  const pageLimit = 100;
  let totalFetched = 0;

  while (true) {
    try {
      const response = pbCallWithRetry_(() => {
        return pbFetch_('get', `/users?pageLimit=${pageLimit}&pageOffset=${pageOffset}`);
      }, `fetch users for cache (page ${pageOffset / pageLimit + 1})`);

      if (!response.data || response.data.length === 0) {
        break;
      }

      response.data.forEach(user => {
        if (user.id && user.email) {
          userMap.set(user.id, user.email);
          totalFetched++;
        }
      });

      if (response.data.length < pageLimit) {
        break; // Last page
      }
      pageOffset += pageLimit;

    } catch (err) {
      Logger.log(`Warning: Error fetching users: ${err}`);
      logToRunLog_('Notes', null, 'WARN', 'Partial user cache built', String(err));
      break;
    }
  }

  Logger.log(`User lookup cache built: ${userMap.size} users (UUID → email)`);
  logToRunLog_('Notes', null, 'INFO', `User cache built: ${userMap.size} users`, `Fetched from ${Math.ceil(totalFetched / pageLimit)} pages`);
  return userMap;
}

/**
 * Build a cache of company UUID → domain mappings
 * @returns {Map} Map of UUID (string) → domain (string)
 */
function buildCompanyLookupCache_() {
  Logger.log('Building company lookup cache for export...');
  logToRunLog_('Notes', null, 'INFO', 'Fetching all companies for domain lookup...', '');

  const companyMap = new Map(); // UUID → domain
  let pageOffset = 0;
  const pageLimit = 100;
  let totalFetched = 0;

  while (true) {
    try {
      const response = pbCallWithRetry_(() => {
        return pbFetch_('get', `/companies?pageLimit=${pageLimit}&pageOffset=${pageOffset}`);
      }, `fetch companies for cache (page ${pageOffset / pageLimit + 1})`);

      if (!response.data || response.data.length === 0) {
        break;
      }

      response.data.forEach(company => {
        if (company.id && company.domain) {
          companyMap.set(company.id, company.domain);
          totalFetched++;
        }
      });

      if (response.data.length < pageLimit) {
        break; // Last page
      }
      pageOffset += pageLimit;

    } catch (err) {
      Logger.log(`Warning: Error fetching companies: ${err}`);
      logToRunLog_('Notes', null, 'WARN', 'Partial company cache built', String(err));
      break;
    }
  }

  Logger.log(`Company lookup cache built: ${companyMap.size} companies (UUID → domain)`);
  logToRunLog_('Notes', null, 'INFO', `Company cache built: ${companyMap.size} companies`, `Fetched from ${Math.ceil(totalFetched / pageLimit)} pages`);
  return companyMap;
}

/**
 * Store user and company lookup caches in a temporary sheet
 * @param {Map} userLookup - Map of user UUID → email
 * @param {Map} companyLookup - Map of company UUID → domain
 */
function storeCacheInSheet_(userLookup, companyLookup) {
  Logger.log('Storing lookup caches in temporary sheet...');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let cacheSheet = ss.getSheetByName(EXPORT_CACHE_SHEET);

  // Create cache sheet if doesn't exist
  if (!cacheSheet) {
    cacheSheet = ss.insertSheet(EXPORT_CACHE_SHEET);
    cacheSheet.hideSheet(); // Hide from user view
  }

  cacheSheet.clear();

  // Convert Maps to arrays and store as JSON
  const userCacheData = Array.from(userLookup.entries());
  const companyCacheData = Array.from(companyLookup.entries());

  // Write to sheet (A1 = users, B1 = companies)
  cacheSheet.getRange(1, 1).setValue(JSON.stringify(userCacheData));
  cacheSheet.getRange(1, 2).setValue(JSON.stringify(companyCacheData));

  Logger.log(`Cache stored: ${userLookup.size} users, ${companyLookup.size} companies`);
}

/**
 * Retrieve user and company lookup caches from temporary sheet
 * @returns {Object} {userLookup: Map, companyLookup: Map}
 */
function getCacheFromSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cacheSheet = ss.getSheetByName(EXPORT_CACHE_SHEET);

  // If cache sheet doesn't exist, return empty Maps
  if (!cacheSheet) {
    Logger.log('Warning: Cache sheet not found, returning empty caches');
    return { userLookup: new Map(), companyLookup: new Map() };
  }

  try {
    // Read cache data from sheet
    const userCacheJson = cacheSheet.getRange(1, 1).getValue();
    const companyCacheJson = cacheSheet.getRange(1, 2).getValue();

    // Parse and convert back to Maps
    const userLookup = new Map(JSON.parse(userCacheJson || '[]'));
    const companyLookup = new Map(JSON.parse(companyCacheJson || '[]'));

    Logger.log(`Cache retrieved: ${userLookup.size} users, ${companyLookup.size} companies`);

    return { userLookup, companyLookup };
  } catch (err) {
    Logger.log(`Error retrieving cache from sheet: ${err}`);
    return { userLookup: new Map(), companyLookup: new Map() };
  }
}

/**
 * Delete the temporary cache sheet after export completes
 */
function deleteCacheSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cacheSheet = ss.getSheetByName(EXPORT_CACHE_SHEET);

  if (cacheSheet) {
    ss.deleteSheet(cacheSheet);
    Logger.log('Cache sheet deleted');
  }
}

/**
 * Fetch relationships for notes in parallel batches.
 * Falls back to sequential fetching if GAS bandwidth quota is exceeded.
 * @param {Array} notes - Array of note objects
 */
function fetchRelationshipsForNotes_(notes) {
  Logger.log(`Fetching relationships for ${notes.length} notes...`);
  const BATCH_SIZE = RELATIONSHIP_FETCH_BATCH_SIZE; // 5
  let fetchedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < notes.length; i += BATCH_SIZE) {
    const batch = notes.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    // Build parallel requests
    const requests = batch.map(note => ({
      url: absoluteUrl_(`/v2/notes/${note.id}/relationships`),
      method: 'get',
      headers: {
        'Authorization': `Bearer ${getApiToken_()}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      muteHttpExceptions: true
    }));

    // UrlFetchApp.fetchAll throws a runtime exception (not an HTTP error) on bandwidth quota
    // exceeded — muteHttpExceptions does not help here. Catch it and fall back to sequential.
    let responses;
    let usedSequentialFallback = false;

    try {
      responses = UrlFetchApp.fetchAll(requests);
    } catch (fetchErr) {
      if (!String(fetchErr).includes('Bandwidth quota exceeded')) {
        throw fetchErr; // Re-throw unexpected errors
      }
      Logger.log(`Bandwidth quota hit at batch ${batchNum}, pausing 5s then fetching sequentially...`);
      logToRunLog_('Notes', null, 'WARN', `Bandwidth quota hit (batch ${batchNum}), retrying sequentially after 5s pause`, '');
      Utilities.sleep(5000);

      batch.forEach(note => {
        try {
          const data = pbCallWithRetry_(
            () => pbFetch_('get', `/v2/notes/${note.id}/relationships`),
            `fetch relationships for ${note.id} (sequential fallback)`
          );
          note._relationships = data.data || [];
          fetchedCount++;
        } catch (seqErr) {
          Logger.log(`Warning: Sequential fallback failed for note ${note.id}: ${seqErr}`);
          note._relationships = [];
          failedCount++;
        }
      });
      usedSequentialFallback = true;
    }

    if (!usedSequentialFallback) {
      // Parse and store responses from the parallel fetch
      responses.forEach((response, index) => {
        const note = batch[index];
        const code = response.getResponseCode();

        if (code >= 200 && code < 300) {
          try {
            const data = JSON.parse(response.getContentText());
            note._relationships = data.data || [];
            fetchedCount++;
          } catch (e) {
            Logger.log(`Warning: Failed to parse relationships for note ${note.id}: ${e}`);
            note._relationships = [];
            failedCount++;
          }
        } else {
          Logger.log(`Warning: Failed to fetch relationships for note ${note.id}: ${code}`);
          note._relationships = [];
          failedCount++;
        }
      });
    }

    // Throttle between batches
    if (i + BATCH_SIZE < notes.length) {
      // Use a longer pause after quota recovery; otherwise 1000ms (up from 500ms)
      Utilities.sleep(usedSequentialFallback ? 3000 : 1000);
      const progress = Math.min(i + BATCH_SIZE, notes.length);
      Logger.log(`Fetched relationships: ${progress}/${notes.length}`);

      if (progress % 50 === 0 || progress === notes.length) {
        logToRunLog_('Notes', null, 'INFO', `Relationship progress: ${progress}/${notes.length} notes`, `${failedCount} failures`);
      }
      // Extra breathing room every 100 notes to stay within bandwidth quota
      if (progress % 100 === 0) {
        Utilities.sleep(2000);
      }
    }
  }

  Logger.log('Relationship fetching complete');
  if (failedCount > 0) {
    logToRunLog_('Notes', null, 'WARN', `Relationships fetched: ${fetchedCount} succeeded, ${failedCount} failed`, '');
  }
}

/** =========================
 *  DATA TRANSFORMATION
 * ========================= */

/**
 * Transform notes from API format to sheet format
 * @param {Array} notes - Array of note objects from v2 API
 * @param {Map} userLookup - Map of user UUID → email
 * @param {Map} companyLookup - Map of company UUID → domain
 * @returns {Array} Array of row arrays
 */
function transformNotesToSheetFormat_(notes, userLookup, companyLookup) {
  Logger.log(`Transforming ${notes.length} notes to sheet format...`);

  return notes.map(note => {
    const row = [];

    // Extract customer relationship UUID
    const customer = (note._relationships || []).find(r => r.type === 'customer');
    let userEmail = '';
    let companyDomain = '';

    if (customer && customer.target) {
      const targetId = customer.target.id; // UUID
      const targetType = customer.target.type; // 'user' or 'company'

      if (targetType === 'user' && targetId) {
        // Lookup user email from cache
        userEmail = userLookup.get(targetId) || '';
        if (!userEmail) {
          Logger.log(`Warning: User UUID ${targetId} not found in cache`);
        }
      } else if (targetType === 'company' && targetId) {
        // Lookup company domain from cache
        companyDomain = companyLookup.get(targetId) || '';
        if (!companyDomain) {
          Logger.log(`Warning: Company UUID ${targetId} not found in cache`);
        }
      }
    }

    // Extract product link relationships (hierarchy entities)
    const productLinks = (note._relationships || [])
      .filter(r => r.type === 'link' && r.target && r.target.id)
      .map(r => r.target.id);

    // Build row in exact order matching headers
    row.push(note.id || '');                                        // pb_id
    row.push(note.fields?.source?.recordId || '');                  // ext_id
    row.push(note.type || 'simple');                                // type
    row.push(note.fields?.name || '');                              // title
    row.push(note.fields?.content || '');                           // content
    row.push(note.fields?.displayUrl || '');                        // display_url
    row.push(userEmail);                                            // user_email
    row.push(companyDomain);                                        // company_domain
    row.push(note.fields?.owner?.email || '');                      // owner_email
    row.push(note.fields?.creator?.email || '');                    // creator_email
    row.push((note.fields?.tags || []).map(t => t.name).join(', ')); // tags
    row.push(note.fields?.source?.origin || '');                    // source_origin
    row.push(note.fields?.source?.recordId || '');                  // source_record_id
    row.push(note.fields?.archived ? 'TRUE' : 'FALSE');             // archived
    row.push(note.fields?.processed ? 'TRUE' : 'FALSE');            // processed
    row.push(productLinks.join(',') || '');                         // linked_entities

    return row;
  });
}

/** =========================
 *  V1 SOURCE ENRICHMENT
 * ========================= */

/**
 * Fetch all notes from v1 API and build a UUID → source map.
 * Used to fill gaps where v2 export is missing source origin/record_id.
 * @returns {Map} Map of note UUID → {origin: string|null, record_id: string|null}
 */
function fetchAllNotesV1SourceMap_() {
  Logger.log('Building v1 source map...');

  // v1 list response: {data: [...notes], pageCursor: "...", totalResults: N}
  // Uses cursor-based pagination — pageOffset is ignored by the API.
  const sourceMap = new Map();
  let pageCursor = null;
  const pageLimit = 100;
  const MAX_PAGES = 1000; // Safety: max 100,000 notes

  for (let page = 0; page < MAX_PAGES; page++) {
    let url = `/notes?pageLimit=${pageLimit}`;
    if (pageCursor) url += `&pageCursor=${encodeURIComponent(pageCursor)}`;

    let response;
    try {
      response = pbCallWithRetry_(() => {
        return pbFetch_('get', url);
      }, `fetch v1 notes for source map (page ${page + 1})`);
    } catch (err) {
      Logger.log(`Warning: Error fetching v1 notes page ${page + 1}: ${err}`);
      logToRunLog_('Notes', null, 'WARN', `v1 source map: error on page ${page + 1}`, String(err));
      break;
    }

    if (!response.data || response.data.length === 0) break;

    response.data.forEach(note => {
      if (note.id) {
        sourceMap.set(note.id, {
          origin: note.source?.origin || null,
          record_id: note.source?.record_id || null
        });
      }
    });

    const total = response.totalResults ? ` of ${response.totalResults}` : '';
    Logger.log(`v1 source map: fetched ${sourceMap.size}${total} unique notes so far...`);

    pageCursor = response.pageCursor || null;
    if (!pageCursor) break; // No more pages
  }

  Logger.log(`v1 source map built: ${sourceMap.size} notes`);
  logToRunLog_('Notes', null, 'INFO', `v1 source map built: ${sourceMap.size} notes`, '');
  return sourceMap;
}

/**
 * Enrich exported notes sheet with source_origin/source_record_id from v1 API.
 * Only fills rows where source_origin is currently empty (supplement only).
 * @param {Sheet} sheet - The Notes sheet
 */
function enrichNotesSourceFromV1_(sheet) {
  Logger.log('Enriching source origins from v1 API...');
  logToRunLog_('Notes', null, 'INFO', 'Fetching v1 notes to fill missing source origins...', '');

  const sourceMap = fetchAllNotesV1SourceMap_();

  if (sourceMap.size === 0) {
    logToRunLog_('Notes', null, 'WARN', 'v1 returned no notes, skipping source enrichment', '');
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= HEADER_ROWS) {
    Logger.log('No data rows to enrich');
    return;
  }

  const dataRowCount = lastRow - HEADER_ROWS;
  const startRow = HEADER_ROWS + 1;

  // Read pb_id (col A=1) and source columns (cols L-M = 12-13) efficiently
  const pbIds = sheet.getRange(startRow, 1, dataRowCount, 1).getValues();        // [[uuid], ...]
  const sourceData = sheet.getRange(startRow, 12, dataRowCount, 2).getValues();  // [[origin, recordId], ...]

  let updatedCount = 0;
  let anyUpdated = false;

  for (let i = 0; i < dataRowCount; i++) {
    const pbId = String(pbIds[i][0] || '').trim();
    const currentOrigin = String(sourceData[i][0] || '').trim();

    // Only fill gaps — skip rows that already have source_origin
    if (currentOrigin || !pbId) continue;

    const v1Source = sourceMap.get(pbId);
    if (!v1Source || !v1Source.origin) continue;

    sourceData[i][0] = v1Source.origin;

    // Also fill record_id if currently empty
    if (!String(sourceData[i][1] || '').trim() && v1Source.record_id) {
      sourceData[i][1] = v1Source.record_id;
    }

    updatedCount++;
    anyUpdated = true;
  }

  if (anyUpdated) {
    sheet.getRange(startRow, 12, dataRowCount, 2).setValues(sourceData);
    Logger.log(`Source enrichment: updated ${updatedCount} rows`);
    logToRunLog_('Notes', null, 'SUCCESS', `Source enrichment: filled ${updatedCount} rows with v1 source data`, '');
  } else {
    Logger.log('Source enrichment: no gaps found');
    logToRunLog_('Notes', null, 'INFO', 'Source enrichment: no gaps to fill (all rows already have source_origin)', '');
  }
}

/** =========================
 *  SHEET WRITING
 * ========================= */

/**
 * Write notes to sheet
 * @param {Sheet} sheet - The Notes sheet
 * @param {Array} rows - Array of row arrays
 * @param {boolean} replaceData - Replace existing data
 */
function writeNotesToSheet_(sheet, rows, replaceData) {
  if (rows.length === 0) {
    Logger.log('No rows to write');
    logToRunLog_('Notes', null, 'WARN', 'No rows to write to sheet', '');
    return;
  }

  Logger.log(`Writing ${rows.length} rows to sheet (replace: ${replaceData})...`);

  // Ensure sheet has headers
  if (sheet.getLastRow() < HEADER_ROWS) {
    SetupNotesSheet_(false);
  }

  if (replaceData) {
    // Clear existing data (keep headers)
    const lastRow = sheet.getLastRow();
    if (lastRow > HEADER_ROWS) {
      const rowsCleared = lastRow - HEADER_ROWS;
      sheet.getRange(HEADER_ROWS + 1, 1, rowsCleared, sheet.getMaxColumns()).clearContent();
      logToRunLog_('Notes', null, 'INFO', `Cleared ${rowsCleared} existing rows from sheet`, '');
    }
  }

  // Determine starting row
  const startRow = replaceData ? HEADER_ROWS + 1 : sheet.getLastRow() + 1;

  // Write data
  const numCols = rows[0].length;
  const range = sheet.getRange(startRow, 1, rows.length, numCols);
  range.setValues(rows);

  Logger.log(`Wrote ${rows.length} rows starting at row ${startRow}`);
  logToRunLog_('Notes', null, 'INFO', `Wrote ${rows.length} rows to sheet`, `Starting at row ${startRow}`);
}
