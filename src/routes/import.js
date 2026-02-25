/**
 * Import routes
 *
 * POST /api/import/preview
 *   Parses the CSV and mapping, validates rows, returns errors before any API call.
 *   Body: { csvText: string, mapping: Mapping, clearEmptyFields: boolean }
 *   Headers: x-pb-token
 *   Response: { valid: boolean, totalRows: number, errors: RowError[] }
 *
 * POST /api/import/run
 *   Runs the import (create/patch companies + custom fields) with SSE progress.
 *   Body: { csvText: string, mapping: Mapping, clearEmptyFields: boolean }
 *   Headers: x-pb-token, x-pb-eu
 *
 * Mapping shape:
 *   {
 *     pbIdColumn:      string | null,   // CSV column → pb_id (uuid). null = all POST/domain-only
 *     nameColumn:      string,          // CSV column → name (required)
 *     domainColumn:    string,          // CSV column → domain (required)
 *     descColumn:      string | null,
 *     sourceOriginCol: string | null,
 *     sourceRecordCol: string | null,
 *     customFields: [
 *       { csvColumn: string, fieldId: string, fieldType: 'text' | 'number' }
 *     ]
 *   }
 */

const express = require('express');
const { createClient } = require('../lib/pbClient');
const { parseCSV } = require('../lib/csvUtils');
const { startSSE } = require('../lib/sse');

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Productboard Entity API supported richtext tags for description.
// Unsupported tags cause a 400 response — validate before sending.
const SUPPORTED_HTML_TAGS = new Set([
  'h1', 'h2', 'p', 'b', 'i', 'u', 'code',
  'ul', 'ol', 'li', 'a', 'hr', 'pre', 'blockquote', 's', 'span',
]);

/** Returns an array of unsupported tag names found in a string, or [] if all clean. */
function findUnsupportedHtmlTags(text) {
  const found = new Set();
  for (const [, tag] of String(text).matchAll(/<\/?([a-z][a-z0-9]*)\b/gi)) {
    if (!SUPPORTED_HTML_TAGS.has(tag.toLowerCase())) found.add(tag.toLowerCase());
  }
  return [...found];
}

// ---------------------------------------------------------------------------
// Preview / validate (no API calls, fast)
// ---------------------------------------------------------------------------

router.post('/preview', async (req, res) => {
  const token = req.headers['x-pb-token'];
  if (!token) return res.status(400).json({ error: 'Missing x-pb-token header' });

  const { csvText, mapping } = req.body;
  if (!csvText || !mapping) return res.status(400).json({ error: 'Missing csvText or mapping' });

  const { rows, errors: parseErrors } = parseCSV(csvText);

  if (parseErrors.length) {
    return res.json({ valid: false, totalRows: 0, errors: parseErrors.map((e) => ({ row: null, message: e })) });
  }

  const errors = [];
  const domainsSeen = new Set();

  rows.forEach((row, i) => {
    const rowNum = i + 1;
    const name = cell(row, mapping.nameColumn);
    const domain = cell(row, mapping.domainColumn);
    const pbId = cell(row, mapping.pbIdColumn);

    const validPbId = pbId && UUID_RE.test(pbId.trim());

    // UUID present → row will PATCH by ID, so domain is not needed and duplicates are fine
    if (!name) errors.push({ row: rowNum, field: mapping.nameColumn, message: 'Company name is required' });
    if (!domain && !validPbId) {
      errors.push({ row: rowNum, field: mapping.domainColumn, message: 'Domain is required when no UUID is provided' });
    }

    // Only enforce domain uniqueness for rows that don't have a UUID (they'd use domain to decide create vs update)
    if (domain && !validPbId) {
      const d = domain.toLowerCase();
      if (domainsSeen.has(d)) {
        errors.push({ row: rowNum, field: mapping.domainColumn, message: `Duplicate domain '${d}' — add a UUID column to PATCH these rows individually` });
      }
      domainsSeen.add(d);
    }

    if (pbId && !UUID_RE.test(pbId.trim())) {
      errors.push({ row: rowNum, field: mapping.pbIdColumn, message: `Invalid UUID format: '${pbId}'` });
    }

    // Validate description: PB Entity API returns 400 for unsupported HTML tags
    if (mapping.descColumn) {
      const desc = cell(row, mapping.descColumn);
      if (desc) {
        const badTags = findUnsupportedHtmlTags(desc);
        if (badTags.length > 0) {
          errors.push({
            row: rowNum,
            field: mapping.descColumn,
            message: `Description contains unsupported HTML tag(s): <${badTags.join('>, <')}>. Productboard will reject this row. Supported tags: h1, h2, p, b, i, u, code, ul, ol, li, a, hr, pre, blockquote, s, span.`,
          });
        }
      }
    }

    // Validate mapped custom fields
    for (const cf of mapping.customFields || []) {
      const val = cell(row, cf.csvColumn);
      if (val && cf.fieldType === 'number' && isNaN(Number(val))) {
        errors.push({ row: rowNum, field: cf.csvColumn, message: `'${cf.csvColumn}' must be a number (got '${val}')` });
      }
      if (val && cf.fieldType === 'text' && val.length > 1024) {
        errors.push({ row: rowNum, field: cf.csvColumn, message: `'${cf.csvColumn}' exceeds 1024 characters` });
      }
    }
  });

  res.json({
    valid: errors.length === 0,
    totalRows: rows.length,
    errors,
  });
});

// ---------------------------------------------------------------------------
// Run import with SSE
// ---------------------------------------------------------------------------

router.post('/run', async (req, res) => {
  const token = req.headers['x-pb-token'];
  const useEu = req.headers['x-pb-eu'] === 'true';
  if (!token) return res.status(400).json({ error: 'Missing x-pb-token header' });

  const { csvText, mapping, clearEmptyFields = false } = req.body;
  if (!csvText || !mapping) return res.status(400).json({ error: 'Missing csvText or mapping' });

  const sse = startSSE(res);
  const { pbFetch, withRetry } = createClient(token, useEu);

  // Abort flag: set when the client disconnects (user clicked Stop).
  // Must listen on `res` (the SSE response stream), not `req`.
  // On HTTP/2 (Cloud Run), req 'close' fires as soon as the request body is
  // fully received (half-close), which is before any rows are processed.
  // res 'close' only fires when the client actually disconnects from the stream.
  let aborted = false;
  res.on('close', () => { aborted = true; });

  try {
    const { rows } = parseCSV(csvText);
    const total = rows.length;

    if (total === 0) {
      sse.complete({ created: 0, updated: 0, errors: 0, total: 0, stopped: false });
      sse.done();
      return;
    }

    // Step 1: Build domain → id cache from PB
    sse.progress('Building domain cache from Productboard…', 5);
    const domainCache = await buildDomainCache(pbFetch, withRetry);
    sse.progress(`Domain cache built (${Object.keys(domainCache).length} companies)`, 12);

    // Step 2: Process each row
    let created = 0;
    let updated = 0;
    let errorCount = 0;
    let processed = 0;

    for (let i = 0; i < rows.length; i++) {
      // Check abort flag before each row
      if (aborted) {
        sse.log('warn', `Import stopped after ${processed} rows.`);
        break;
      }

      const row = rows[i];
      const rowNum = i + 1;
      const pct = 12 + Math.round((i / total) * 80);
      sse.progress(`Processing row ${rowNum}/${total}…`, pct);

      const pbId   = cell(row, mapping.pbIdColumn)?.trim();
      const name   = cell(row, mapping.nameColumn)?.trim();
      const domain = cell(row, mapping.domainColumn)?.trim().toLowerCase();
      const label  = name || domain || `row ${rowNum}`;

      let companyId = null;
      let action = null;

      try {
        if (pbId && UUID_RE.test(pbId)) {
          // pb_id present → always PATCH
          await withRetry(
            () => patchCompany(pbFetch, pbId, row, mapping),
            `patch company row ${rowNum}`
          );
          companyId = pbId;
          action = 'updated';
          updated++;
          sse.log('success', `Row ${rowNum}: Updated "${label}"`, companyId);
        } else if (domain && domainCache[domain]) {
          // Domain exists in PB → PATCH by cached id
          const existingId = domainCache[domain];
          await withRetry(
            () => patchCompany(pbFetch, existingId, row, mapping),
            `patch by domain row ${rowNum}`
          );
          companyId = existingId;
          action = 'updated';
          updated++;
          sse.log('success', `Row ${rowNum}: Updated "${label}" by domain match`, existingId);
        } else {
          // Neither → POST (create)
          const created_ = await withRetry(
            () => createCompany(pbFetch, row, mapping),
            `create company row ${rowNum}`
          );
          companyId = created_.id;
          action = 'created';
          domainCache[domain] = companyId; // update local cache
          created++;
          sse.log('success', `Row ${rowNum}: Created "${label}"`, companyId);
        }

        // Handle custom fields for this company
        if (companyId && mapping.customFields?.length) {
          await importCustomFields(pbFetch, withRetry, companyId, row, mapping.customFields, clearEmptyFields);
          sse.log('info', `Row ${rowNum}: Custom fields updated`, null);
        }

      } catch (err) {
        errorCount++;
        const detail = parseApiError(err);
        sse.log('error', `Row ${rowNum}: Failed for "${label}" — ${detail}`, null);
        console.error(`Row ${rowNum} error: ${err.message}`);
      }

      processed++;
    }

    const stopped = aborted;
    if (!stopped) sse.progress('Import complete!', 100);

    sse.complete({
      total,
      processed,
      created,
      updated,
      errors: errorCount,
      stopped,
    });
  } catch (err) {
    console.error('import/run error:', err.message);
    sse.error(err.message || 'Import failed');
  } finally {
    sse.done();
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely read a cell value from a CSV row by column name. Returns '' if column is null/missing. */
function cell(row, colName) {
  if (!colName || !row) return '';
  const val = row[colName];
  return val == null ? '' : String(val).trim();
}

/** Build domain → companyId map from all companies in PB */
async function buildDomainCache(pbFetch, withRetry) {
  const map = {};
  let offset = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    const response = await withRetry(
      () => pbFetch('get', `/companies?pageLimit=${limit}&pageOffset=${offset}`),
      `domain cache fetch offset ${offset}`
    );

    for (const company of response.data || []) {
      if (company.domain) {
        map[String(company.domain).toLowerCase()] = company.id;
      }
    }

    if (response.pagination) {
      const { offset: off, limit: lim, total } = response.pagination;
      hasMore = (off + lim) < (total ?? 0);
    } else {
      hasMore = !!(response.links?.next);
    }

    offset += limit;
    if (Object.keys(map).length >= 10000) break;
  }

  return map;
}

/** POST /companies — create a new company */
async function createCompany(pbFetch, row, mapping) {
  const body = {
    name:   cell(row, mapping.nameColumn),
    domain: cell(row, mapping.domainColumn).toLowerCase(),
  };

  const desc = cell(row, mapping.descColumn);
  if (desc) body.description = desc;

  const origin = cell(row, mapping.sourceOriginCol);
  const recordId = cell(row, mapping.sourceRecordCol);
  if (origin || recordId) {
    body.source = {};
    if (origin) body.source.origin = origin;
    if (recordId) body.source.record_id = recordId;
  }

  const response = await pbFetch('post', '/companies', body);
  return response.data;
}

/** PATCH /companies/{id} — update existing company */
async function patchCompany(pbFetch, companyId, row, mapping) {
  const body = {};

  const name = cell(row, mapping.nameColumn);
  if (name) body.name = name;

  const desc = cell(row, mapping.descColumn);
  if (desc) body.description = desc;
  // Note: domain and source fields are immutable after creation — not patched

  await pbFetch('patch', `/companies/${companyId}`, { data: body });
}

/** Import custom field values for one company */
async function importCustomFields(pbFetch, withRetry, companyId, row, customFieldMappings, clearEmptyFields) {
  for (const cf of customFieldMappings) {
    const rawVal = cell(row, cf.csvColumn);

    if (rawVal !== '') {
      const value = cf.fieldType === 'number' ? Number(rawVal) : rawVal;
      await withRetry(
        () => pbFetch('put', `/companies/${companyId}/custom-fields/${cf.fieldId}/value`, {
          data: { type: cf.fieldType, value },
        }),
        `set custom field ${cf.fieldId}`
      );
    } else if (clearEmptyFields) {
      try {
        await withRetry(
          () => pbFetch('delete', `/companies/${companyId}/custom-fields/${cf.fieldId}/value`),
          `delete custom field ${cf.fieldId}`
        );
      } catch (err) {
        if (err.status !== 404) throw err; // 404 = already empty, fine
      }
    }
  }
}

/** Extract a readable message from a PB API error */
function parseApiError(err) {
  const msg = err.message || String(err);
  // Try to extract the PB JSON error body
  const jsonMatch = msg.match(/\{[\s\S]*"errors"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const first = parsed.errors?.[0];
      if (first) return first.detail || first.title || msg;
    } catch (_) {}
  }
  return msg;
}

module.exports = router;
