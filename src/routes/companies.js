/**
 * Companies routes
 *
 * POST /api/companies/delete/by-csv
 *   Delete companies by UUID column in CSV. SSE stream.
 *   Body: { csvText, uuidColumn }
 *
 * POST /api/companies/delete/all
 *   Delete every company in the workspace. SSE stream.
 *
 * --- API conventions ---
 * v1 list:   GET    /companies?pageLimit=100&pageOffset=N
 *            pagination via offset (break when r.data.length < limit)
 * v1 delete: DELETE /companies/{id}  → 204 response
 */

const express = require('express');
const { createClient } = require('../lib/pbClient');
const { parseCSV } = require('../lib/csvUtils');
const { startSSE } = require('../lib/sse');

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cell(row, col) {
  if (!col) return '';
  const v = row[col];
  return v === undefined || v === null ? '' : String(v).trim();
}

function parseApiError(err) {
  const msg = err.message || String(err);
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

// ---------------------------------------------------------------------------
// Route 1: Delete by CSV (SSE)
// ---------------------------------------------------------------------------

router.post('/delete/by-csv', async (req, res) => {
  const token = req.headers['x-pb-token'];
  const useEu = req.headers['x-pb-eu'] === 'true';
  if (!token) return res.status(400).json({ error: 'Missing x-pb-token header' });

  const { csvText, uuidColumn } = req.body;
  if (!csvText || !uuidColumn) return res.status(400).json({ error: 'Missing csvText or uuidColumn' });

  const sse = startSSE(res);
  const { pbFetch, withRetry } = createClient(token, useEu);

  let aborted = false;
  res.on('close', () => { aborted = true; });

  try {
    const { rows } = parseCSV(csvText);

    const uuids = rows
      .map((r) => cell(r, uuidColumn))
      .filter((id) => UUID_RE.test(id));

    if (uuids.length === 0) {
      sse.complete({ total: 0, deleted: 0, errors: 0 });
      sse.done();
      return;
    }

    let deleted = 0;
    let errors = 0;

    for (let i = 0; i < uuids.length; i++) {
      if (aborted) break;
      const id = uuids[i];
      const pct = Math.round(((i + 1) / uuids.length) * 100);

      try {
        await withRetry(() => pbFetch('delete', `/companies/${id}`), `delete company ${id}`);
        deleted++;
        sse.log('success', `Deleted company ${id}`, '');
      } catch (err) {
        if (err.status === 404) {
          sse.log('warn', `Company ${id} not found — skipped`, '');
        } else {
          errors++;
          sse.log('error', `Failed to delete ${id}: ${parseApiError(err)}`, '');
        }
      }

      sse.progress(`Deleted ${deleted} of ${uuids.length}…`, pct);
    }

    sse.complete({ total: uuids.length, deleted, errors });
  } catch (err) {
    sse.error(parseApiError(err));
  } finally {
    sse.done();
  }
});

// ---------------------------------------------------------------------------
// Route 2: Delete all (SSE)
// ---------------------------------------------------------------------------

router.post('/delete/all', async (req, res) => {
  const token = req.headers['x-pb-token'];
  const useEu = req.headers['x-pb-eu'] === 'true';
  if (!token) return res.status(400).json({ error: 'Missing x-pb-token header' });

  const sse = startSSE(res);
  const { pbFetch, withRetry } = createClient(token, useEu);

  let aborted = false;
  res.on('close', () => { aborted = true; });

  try {
    // Phase 1: Collect all company IDs using offset-based pagination
    sse.progress('Collecting all company IDs…', 5);
    const allIds = [];
    const limit = 100;
    let offset = 0;

    while (true) {
      const r = await withRetry(
        () => pbFetch('get', `/companies?pageLimit=${limit}&pageOffset=${offset}`),
        `fetch companies offset ${offset}`
      );
      if (!r.data?.length) break;
      allIds.push(...r.data.map((c) => c.id));
      if (r.data.length < limit) break;
      offset += limit;
    }

    if (allIds.length === 0) {
      sse.complete({ total: 0, deleted: 0, errors: 0 });
      sse.done();
      return;
    }

    // Phase 2: Delete each company sequentially
    sse.progress(`Found ${allIds.length} companies. Beginning deletion…`, 10);

    let deleted = 0;
    let errors = 0;

    for (let i = 0; i < allIds.length; i++) {
      if (aborted) break;
      const id = allIds[i];
      const pct = 10 + Math.round(((i + 1) / allIds.length) * 90);

      try {
        await withRetry(() => pbFetch('delete', `/companies/${id}`), `delete company ${id}`);
        deleted++;
        if (deleted % 50 === 0) sse.log('info', `Deleted ${deleted}/${allIds.length} companies…`, '');
      } catch (err) {
        if (err.status === 404) {
          // Already deleted — count as success
          deleted++;
        } else {
          errors++;
          sse.log('error', `Failed to delete ${id}: ${parseApiError(err)}`, '');
        }
      }

      sse.progress(`Deleted ${deleted} of ${allIds.length}…`, pct);
    }

    sse.complete({ total: allIds.length, deleted, errors });
  } catch (err) {
    sse.error(parseApiError(err));
  } finally {
    sse.done();
  }
});

module.exports = router;
