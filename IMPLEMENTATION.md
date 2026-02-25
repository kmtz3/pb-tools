# Implementation Notes

Reference for adding and maintaining modules in pb-tools.

---

## Project structure

```
pb-tools/
├── src/
│   ├── server.js              # Express entry point — mounts all routers
│   ├── lib/
│   │   ├── pbClient.js        # Productboard API client
│   │   ├── csvUtils.js        # papaparse wrappers
│   │   └── sse.js             # Server-Sent Events helper
│   └── routes/
│       ├── fields.js          # GET  /api/fields
│       ├── export.js          # POST /api/export
│       ├── import.js          # POST /api/import/preview + /run
│       └── notes.js           # POST /api/notes/* (export, import, delete, migrate)
├── public/
│   ├── index.html             # All HTML views, inline
│   ├── app.js                 # All frontend JS, no framework
│   └── style.css              # CSS custom properties design system
├── Dockerfile
└── package.json
```

---

## Adding a new module (checklist)

### 1. Backend route file — `src/routes/{module}.js`

```js
const express = require('express');
const { createClient } = require('../lib/pbClient');
const { startSSE } = require('../lib/sse');

const router = express.Router();

router.post('/run', async (req, res) => {
  const token = req.headers['x-pb-token'];
  const useEu  = req.headers['x-pb-eu'] === 'true';
  if (!token) return res.status(400).json({ error: 'Missing x-pb-token header' });

  const sse = startSSE(res);
  const { pbFetch, withRetry } = createClient(token, useEu);

  try {
    // ... work ...
    sse.complete({ ... });
  } catch (err) {
    sse.error(err.message || 'Operation failed');
  } finally {
    sse.done();
  }
});

module.exports = router;
```

### 2. Register in `src/server.js`

```js
const notesRouter = require('./routes/notes');
app.use('/api/notes', notesRouter);
```

### 3. Home card in `public/index.html`

Remove `tool-card-soon` class and add `data-tool="{name}"` to activate the card:

```html
<!-- Before (placeholder) -->
<div class="tool-card tool-card-soon">

<!-- After (active) -->
<div class="tool-card" data-tool="notes">
```

The home screen JS already picks up all `.tool-card:not(.tool-card-soon)` elements via `querySelectorAll` — no other JS change needed for the card click.

### 4. Sidebar nav items in `public/index.html`

Add inside `.sidebar-nav`:

```html
<button class="nav-item" data-view="notes-export" id="nav-notes-export">
  <span class="icon">📤</span> Export notes
</button>
<button class="nav-item" data-view="notes-delete" id="nav-notes-delete">
  <span class="icon">🗑️</span> Delete notes
</button>
```

### 5. View panels in `public/index.html`

Add inside `#view-area`:

```html
<div id="view-notes-export" class="hidden">
  <div class="panel">
    ...
  </div>
</div>
```

### 6. Frontend JS in `public/app.js`

**Extend `showView()`** — add new view names to the array:

```js
function showView(view) {
  ['export', 'import', 'notes-export', 'notes-delete'].forEach((v) => {
    const el = $(`view-${v}`);
    if (el) el.classList.toggle('hidden', v !== view);
  });
}
```

**Extend `loadTool()`** — add the tool name and default view:

```js
function loadTool(toolName) {
  const names = { companies: 'Companies', notes: 'Notes' };
  setText('topbar-tool-name', names[toolName] || toolName);
  showScreen('tool');

  if (toolName === 'companies') { ... }
  if (toolName === 'notes') {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    $('nav-notes-export').classList.add('active');
    showView('notes-export');
  }
}
```

**Add event listeners** for buttons in the new views, following the same patterns as the companies module.

---

## Productboard API conventions

### Headers (backend)

Every route reads these from the request:

```js
const token = req.headers['x-pb-token'];   // required
const useEu  = req.headers['x-pb-eu'] === 'true'; // optional
```

The frontend sends them via `buildHeaders()` in `app.js`.

### Request body wrapping

| Method | Body shape |
|---|---|
| POST (create) | `pbFetch('post', '/resource', body)` — the client sends body as-is; Productboard does NOT require a `data` wrapper on create calls |
| PATCH (update) | `pbFetch('patch', '/resource/id', { data: body })` — **must** wrap in `data` |
| PUT (custom field value) | `pbFetch('put', '/companies/{id}/custom-fields/{fid}/value', { data: { type, value } })` |
| DELETE (clear value) | `pbFetch('delete', '/resource')` — no body |

> **Never set a field to `null` to clear it.** The API rejects null values. Use DELETE instead.

### Pagination

All list endpoints use offset pagination. The pattern:

```js
let offset = 0;
const limit = 100;
let hasMore = true;

while (hasMore) {
  const response = await withRetry(
    () => pbFetch('get', `/resource?pageLimit=${limit}&pageOffset=${offset}`),
    `fetch label offset ${offset}`
  );

  if (response.data?.length) items.push(...response.data);

  // Some endpoints use pagination object, some use links.next
  if (response.pagination) {
    const { offset: off, limit: lim, total } = response.pagination;
    hasMore = (off + lim) < (total ?? 0);
  } else {
    hasMore = !!(response.links?.next);
  }

  offset += limit;
  if (items.length >= 10000) break; // safety cap
}
```

### Error extraction from PB responses

```js
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
```

This helper lives in `import.js` and should be copied/shared when needed by other route files.

### 404 on field value endpoints

A 404 from `/resource/{id}/custom-fields/{fid}/value` means the value is not set — this is normal, not an error. Pattern:

```js
try {
  await pbFetch('delete', `...`);
} catch (err) {
  if (err.status !== 404) throw err;
}
```

---

## SSE helper

`startSSE(res)` in `src/lib/sse.js` returns:

```js
sse.progress(message, percent, detail = null)  // event: progress
sse.log(level, message, detail = null)         // event: log  (level: 'success'|'info'|'warn'|'error')
sse.complete(data)                             // event: complete
sse.error(message, detail = null)              // event: error
sse.done()                                     // ends the stream (always call in finally)
```

Always call `sse.done()` in a `finally` block so the stream closes even on unexpected errors.

---

## Frontend SSE

```js
const ctrl = subscribeSSE('/api/endpoint', bodyObject, {
  onProgress: ({ message, percent }) => { ... },
  onLog:      (entry) => { ... },       // optional
  onComplete: (data) => { ... },
  onError:    (msg) => { ... },
});

// To abort:
ctrl.abort();
```

`subscribeSSE` uses `fetch` with a `ReadableStream` reader — this is a manual SSE-over-POST implementation since `EventSource` only supports GET.

The `AbortController` returned is used for the Stop button pattern. When aborted, the backend detects `req.on('close', ...)` and sets an `aborted` flag checked between rows.

---

## Frontend state and DOM helpers

```js
const $ = (id) => document.getElementById(id);
const show  = (id) => $(id).classList.remove('hidden');
const hide  = (id) => $(id).classList.add('hidden');
const setText = (id, t) => { $(id).textContent = t; };
```

Session state lives in module-level variables (`token`, `useEu`) backed by `sessionStorage`. New modules should follow the same pattern — use module-level variables for any state that needs to persist between view switches.

---

## CSS design system

All colours and spacing are CSS custom properties defined in `:root` in `style.css`. Key tokens:

| Token | Use |
|---|---|
| `--c-brand` | Primary interactive colour (indigo) |
| `--c-danger` | Destructive actions, errors |
| `--c-warn` | Warnings, partial success |
| `--c-ok` | Success |
| `--c-muted` | Secondary text |
| `--c-border` | Borders and dividers |
| `--c-surface` | Card/panel background (white) |
| `--c-bg` | Page background (off-white) |

Utility classes: `.hidden`, `.mt-{4|8|12|16|20}`, `.mb-16`, `.flex`, `.gap-8`, `.items-center`, `.justify-between`, `.text-sm`, `.text-muted`, `.text-danger`, `.font-mono`

Component classes: `.panel`, `.panel-header`, `.panel-title`, `.panel-subtitle`, `.panel-body`, `.panel-divider`, `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-ghost`, `.btn-sm`, `.btn-full`, `.badge`, `.alert`, `.alert-ok/.warn/.danger/.info`, `.progress-wrap`, `.progress-bar`, `.dropzone`, `.mapping-table`, `.live-log`, `.log-entry`

---

## Known quirks and gotchas

- **`createCompany` does not wrap in `data`** — the POST to `/companies` sends the body directly (not `{ data: body }`). This is an intentional inconsistency in the PB API; PATCH requires `{ data: ... }` but POST does not. Verify for each new resource type before assuming the wrapper is always needed.

- **Domain is immutable after creation** — `patchCompany` intentionally does not send `domain` or `source` fields because the API ignores or rejects changes to these after the company is created.

- **`parseCSVHeaders` in `app.js` is a naive implementation** — it splits on `,` and strips quotes. It is only used to populate the mapping dropdowns; the actual parsing for import uses `papaparse` on the server. If headers contain quoted commas, the frontend display may be slightly off but the import will still be correct.

- **Live log `detail` is truncated in the UI** — the `log-detail` span in CSS has `max-width: 200px` and `text-overflow: ellipsis`. The full value is in the `title` attribute (hover to see).

- **`showView()` must list all view names explicitly** — it toggles hidden/visible by iterating the array. When adding new views, add their names to the array or they will never be shown.

- **Tool card auto-detection** — `document.querySelectorAll('.tool-card:not(.tool-card-soon)')` runs once at page load. Adding a new active card requires the class to be correct in the HTML; there is no dynamic registration.

- **Sidebar is per-tool** — `#sidebar-companies` and `#sidebar-notes` are separate `<div>` wrappers inside `.sidebar-nav`. `loadTool()` shows/hides the correct one. When adding a new tool, add a `#sidebar-{tool}` wrapper and toggle it in `loadTool()`.

---

## Notes module — API reference

All Notes routes live in `src/routes/notes.js`.

### Endpoint table

| Route | Method | Type | Description |
|---|---|---|---|
| `/api/notes/export` | POST | SSE | Export all notes to CSV |
| `/api/notes/import/preview` | POST | JSON | Validate CSV before import |
| `/api/notes/import/run` | POST | SSE | Import notes |
| `/api/notes/delete/by-csv` | POST | SSE | Delete notes by UUID from CSV |
| `/api/notes/delete/all` | POST | SSE | Delete every note in workspace |
| `/api/notes/migrate-prep` | POST | JSON | Transform CSV for cross-workspace migration |

### Productboard API conventions for notes

| Operation | API | Endpoint | Body wrapper |
|---|---|---|---|
| List notes (with relationships inline) | v2 | `GET /v2/notes` | none |
| Create note | v1 | `POST /notes` | **none** |
| Update note | v1 | `PATCH /notes/{id}` | **none** |
| Backfill archived/processed/creator/owner | v2 | `PATCH /v2/notes/{id}` | `{ data: { patch: [...] } }` |
| Link to hierarchy entity | v2 | `POST /v2/notes/{id}/relationships` | `{ data: { type: 'link', target: { id, type: 'link' } } }` |
| Delete note | v2 | `DELETE /v2/notes/{id}` | none (returns 204) |
| Search by source.recordId | v2 | `GET /v2/notes?source[recordId]=X` | none |
| List users (for export cache) | v1 | `GET /users?pageLimit=100&pageOffset=N` | none |
| List notes (v1, for source enrichment) | v1 | `GET /notes?pageLimit=100&pageCursor=X` | cursor from `response.pageCursor` |

### v2 pagination vs v1 pagination

- **v2 cursor**: extracted from `response.links?.next` URL using `extractCursor()` helper
- **v1 cursor**: read directly from `response.pageCursor`

### Export pipeline

1. Paginate `GET /v2/notes` — each note includes `relationships` inline (no per-note calls needed)
2. Build user UUID → email cache from `GET /users`
3. Build company UUID → domain cache from `GET /companies`
4. Build v1 source map from `GET /notes` — fills gaps where `fields.source.origin` is missing in v2
5. Transform each note → CSV row using `buildNoteRow()`, then `generateCSV()`

**Key field paths in v2 response:**
- `note.fields.name` — title
- `note.fields.displayUrl` — display URL
- `note.fields.source.origin` / `note.fields.source.id` — source data
- `note.fields.owner.email` / `note.fields.creator.email` — direct emails (no UUID lookup needed)
- `note.relationships` — array of `{ type: 'customer'|'link', target: { id, type, links } }`
- Customer relationship target is UUID only — resolved via user/company caches

### Import pipeline (per row)

1. Match: `pb_id` present → UPDATE directly; `ext_id` present → `GET /v2/notes?source[recordId]=ext_id` → UPDATE if found, else CREATE; neither → CREATE
2. CREATE via v1 `POST /notes` (no wrapper). Owner rejection → retry without owner, set `ownerRejected = true`
3. UPDATE via v1 `PATCH /notes/{id}` (no wrapper). Same owner retry pattern
4. Backfill via v2 `PATCH /v2/notes/{id}` for: `archived`, `processed`, `creator`, `owner` (when ownerRejected). On 404: retry up to 3× with 1s delay (v1→v2 propagation)
5. Hierarchy links via `POST /v2/notes/{id}/relationships`. In migration mode, map old UUID → new UUID via `original_uuid` custom field on entities

### Content format

- simple notes: `fields.content` is a plain string
- conversation notes: `fields.content` is an array of message objects → **JSON.stringify** in CSV
- On import: if content column is a JSON string starting with `[`, it is sent as-is to v1 (v1 accepts JSON string for conversation content)
