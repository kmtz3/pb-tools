/**
 * GET /api/fields
 * Returns all company custom field definitions from the PB API.
 * Used by the frontend to populate the import field mapping UI.
 *
 * Headers:
 *   x-pb-token:    Productboard API token (required)
 *   x-pb-eu:       "true" to use EU datacenter (optional)
 */
const express = require('express');
const { createClient } = require('../lib/pbClient');

const router = express.Router();

router.get('/', async (req, res) => {
  const token = req.headers['x-pb-token'];
  const useEu = req.headers['x-pb-eu'] === 'true';

  if (!token) {
    return res.status(400).json({ error: 'Missing x-pb-token header' });
  }

  const { pbFetch, withRetry } = createClient(token, useEu);

  try {
    const fields = [];
    let offset = 0;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const response = await withRetry(
        () => pbFetch('get', `/companies/custom-fields?pageLimit=${limit}&pageOffset=${offset}`),
        `fetch custom fields (offset ${offset})`
      );

      if (response.data?.length) {
        fields.push(...response.data);
      }

      hasMore = !!(response.links?.next) && fields.length < 1000;
      offset += limit;
    }

    // Return minimal shape: id, name, type
    const simplified = fields.map((f) => ({
      id: f.id,
      name: f.name || f.id,
      type: f.type || 'text', // 'text' | 'number'
    }));

    res.json({ fields: simplified });
  } catch (err) {
    console.error('fields route error:', err.message);
    const status = err.status || 500;
    res.status(status).json({
      error: err.message || 'Failed to fetch custom fields',
    });
  }
});

module.exports = router;
