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

---

## Entities importer (Cloud Run) — implementation plan

### Objectives & scope
- Rebuild the legacy Apps Script importer with the existing Cloud Run stack (Express API + SSE + vanilla JS UI) while keeping behavior parity for objectives → releases.
- Operate on CSV inputs only (no multi-sheet XLSX) and mirror the companies/notes mapping workflow so users stay in a familiar flow.
- Preserve key workflows: per-entity imports/exports, “import all” multi-entity runs, relationships-only pass, and the UUID → type+number migration helper.

### Source-of-truth inputs
1. **Per-entity CSVs**: each entity type gets its own CSV with a single header row using human-readable format: `Field Name [FieldType] [fieldUuid]`. Canonical key format (`custom__{id}`) is internal only — the mapping UI translates headers to API fields. Standard columns (`ext_key`, `pb_id`, `title`, `archived`, `phase`, `health`, `workProgress`, etc.) use fixed labels. Import preview/run expect one CSV per entity. The importer accepts:
   - A single entity run (one CSV upload + mapping).
   - A multi-entity run where the user supplies multiple CSVs in one request (one file picker per entity in the UI). Backend processes the subset supplied while respecting dependency order.
2. **Templates**: server exposes download endpoints that emit ready-to-edit CSVs per entity. Each single-entity template downloads as `entities-template-{entity}.csv` (e.g., `entities-template-features.csv`). “Download all templates” returns `pb-tools-entities-templates-{YYYYMMDD-HHmm}.zip` containing those CSVs plus a manifest. No spreadsheet validation rows. Each header cell follows `Field Name [FieldType] [fieldUuid]` (e.g., `Business Value [Number] [8b54dcf8-4b1e-4550-b490-d7f985c734e8]`) so users can cross-reference Productboard UI labels/types.
3. **Entity metadata & configs**: port `ENT`, `TYPE_CODE`, `ENTITY_STATUS_DEFINITIONS`, and type abbreviation map (feature→FEAT, etc.) into `meta.js`. Config is fetched per-request (no TTL cache): `GET /v2/entities/configurations/{type}` (v2) + `GET /hierarchy-entities/custom-fields?type=dropdown|multi-dropdown` (v1) + `GET /feature-statuses` (v1). These power template generation, validators, and import payload builders.

### Backend architecture
1. **Routes** (`src/routes/entities.js`):
   - `POST /api/entities/preview` — body `{ files, mappings, options }`. Returns validation errors grouped by entity + row + field. Fetches config (two-pass v2+v1) to validate select field values.
   - `POST /api/entities/run` — same payload; streams SSE progress/logs, enforces entity processing order, reports per-entity stats. SSE `complete` includes `newIdsCsv` (CSV string, not a token) when ext_key auto-generation is enabled.
   - `POST /api/entities/relationships` — same CSV payload as `/run`; runs relationship pass only (upsert skipped). User re-uploads CSVs; mappings pre-filled from localStorage.
   - `POST /api/entities/normalize-keys` — pure CSV transform, no API calls. Accepts CSV + workspace code; returns CSV with UUID ext_keys rewritten to `WORKSPACE-TYPE-NNN`. Used for pre-import migration cleanup.
   - `GET /api/entities/templates/:type` — download one CSV template (human-readable headers); `GET /api/entities/templates.zip` bundles all entity templates.
   - `POST /api/entities/export/:type` — SSE export for one entity type; CSV string in `complete` event, downloaded client-side. `migrationMode` flag in body rewrites relationship columns to ext_key strings.
   - `POST /api/entities/export-all` — SSE job; sequentially exports all types, optionally in migration mode; returns `pb-tools-entities-export-{YYYYMMDD-HHmm}.zip`.
2. **Services** (`src/services/entities/`):
   - `meta.js`: ENT ordering, status definitions, column presets, type abbreviation map (feature→FEAT, objective→OBJ, etc.).
   - `configCache.js`: per-request two-pass fetch — `GET /v2/entities/configurations/{type}` v2 + `GET /hierarchy-entities/custom-fields?type=dropdown|multi-dropdown` v1 + `GET /feature-statuses` v1. No in-memory TTL.
   - `csvParser.js`: PapaParse wrapper, normalizes rows, trims values, coerces numbers/dates.
   - `validator.js`: enforces required columns, duplicate ext_keys, select/multi-select value validation against config (blocks on unallowed), parent resolution pre-check (hard error for unresolvable CREATE parents), skips status validation for objective/keyResult/initiative/release.
   - `importCoordinator.js`: orchestrates per-entity queues in dependency order (objectives → releases), seeds idCache in preflight from CSV `pb_id` columns, shares ID caches between entity files, attaches SSE events, emits row count warning at 50k rows.
   - `fieldBuilder.js`: builds create/patch payloads. Both PATCH shapes (`{ data: { fields } }` for set, `{ data: { patch: [...] } }` for addItems/removeItems). Entity-type branching for `team`/`teams`. `bypassEmptyCells` applied per-field. Handles `archived`, `phase`, `health`, `workProgress`. HTML sanitization with allowed tag set; `bypassHtmlFormatter` skips it. Ref: `mainLogicImporter.gs:buildFieldsObject_`, `buildPatchOperations_`.
   - `relationWriter.js`: `PUT /v2/entities/{id}/relationships/parent` for parent; `POST` for connected. Swallows 409s. Ref: `mainLogicImporter.gs:writeRelations_`.
   - `idCache.js`: ext_key → pb_id map. Pre-seeded in preflight from CSV rows with both `ext_key` and `pb_id`. No live PB lookup fallback.
   - `templateBuilder.js`: generates CSV header strings in `Field Name [FieldType] [fieldUuid]` format from config; `buildAllTemplatesZip()` uses `archiver`.
   - `exporter.js`: uses `POST /v2/entities/search` + cursor pagination. Reads relationship data inline if available; else fetches per-entity in batches of 20. Normal mode: relationship columns = UUIDs. Migration mode: relationship columns = ext_key strings. Warns at 50k rows.
   - `migrationHelper.js`: (1) export mode — rewrite UUID ext_keys to `WORKSPACE-TYPE-NNN` and adjust relationship columns; (2) normalize mode — pure CSV transform for `normalize-keys` endpoint, no API calls.
3. **Shared utilities**: keep using existing SSE + pbClient helpers; extend the HTML sanitizer when needed; store multi-entity upload metadata in memory per request to keep state simple.

### Import pipeline blueprint
1. **Preflight**
   - Receive `{ files, mappings, options }`, reject if no files provided.
   - Parse each CSV independently, attach `_entityType`, `_row`, `_fileName`.
   - Fetch config for all entity types present (two-pass v2+v1 per request).
   - **Seed idCache** from all CSV rows where both `ext_key` and `pb_id` are present before any upsert begins.
2. **Validation phase**
   - Run `validator` per entity; accumulate issues into `{ entity, fileName, row, field, message }`.
   - Stop run if any blocking errors exist; warnings bubble up but do not block.
3. **Execution phase**
   - Determine execution order: objectives → keyResults → initiatives → products → components → features → subfeatures → releaseGroups → releases.
   - For each entity with provided CSV:
     - Build/create/patch rows: `pb_id` present → PATCH; no `pb_id` → CREATE.
     - **Parent rules:** CREATE without resolvable parent → hard validation error (blocked). PATCH with empty parent column → existing parent unchanged. PATCH with parent column value → PUT new parent (allows reparenting). UUID parent references passed directly to API.
     - Buffer pb_id assignments for newly created ext_keys. If `autoGenerateExtKeys` is enabled, generate `ABBREV-{entity_number}` from each PB response and buffer for `newIdsCsv`.
     - Share ID cache across entity types so later files can resolve parents created earlier in the same run.
   - Track per-entity metrics and emit SSE logs (start/finish for each file + row-level warnings).
4. **Relationship + migration pass**
   - After upserts, run `relationWriter` for parent + connected links, respecting requirements (component/feature/subfeature/release parents).
   - Offer optional `migrationHelper` action that rekeys ext_keys and exports the mapping so cross-workspace migrations preserve relationships.
5. **Completion**
   - SSE `complete` payload includes `summary`, `perEntityStats`, `newIdsCsv` (CSV string embedded directly in the event; absent if no new entities were created — frontend downloads via `Blob` + `URL.createObjectURL`), and `warnings`.

### Frontend integration plan
1. **Card + sidebar**
   - Activate the Entities card + `#sidebar-entities` nav grouping once backend endpoints exist. Provide nav buttons for `Import`, `Export`, `Templates`, `Migration`, and `Relationships`.
2. **Import UI**
   - File picker grid (one per entity type). Each picker shows status pill (no file / file name + row count). Row count warning shown inline if file exceeds 50,000 rows.
   - **Tabbed mapping UI**: one tab per uploaded entity type. Tab header: entity name, file name, row count, status pill (valid/warnings/errors/unmapped). Active tab shows column mapping drawer (reuses companies/notes component). Allowed select values shown as helper text per mapped field. Mappings persisted in `localStorage` keyed by entity type + column name.
   - Shared options panel: multi-select mode radio, bypass empty cells toggle, bypass HTML formatter toggle, `fiscal_year_start_month` input (1–12, default 1), "Auto-generate ext_keys" checkbox + workspace code field.
   - Buttons: `Validate selected` (calls preview; surfaces errors in mapping tabs) and `Run import` (SSE). Live log panel + per-entity summary table on completion.
3. **Export UI**
   - Per-entity export buttons trigger `POST /api/entities/export/:type` (SSE); CSV delivered in `complete` event and downloaded client-side. Consistent with export-all.
   - “Export all entities” → SSE job returning ZIP.
   - “Migration mode” toggle: when enabled, relationship columns are rewritten to ext_key strings (`WORKSPACE-TYPE-NNN`) instead of PB UUIDs. Workspace code field required. Helper copy explains cross-workspace import use case.
4. **Templates UI**
   - Buttons to download single-entity CSV templates and a “Download all templates (ZIP)” shortcut.
5. **Migration UI**
   - “Migration mode” toggle for exports (linked to Export view).
   - “Normalize ext_keys” action: user uploads CSV + enters workspace code; `POST /api/entities/normalize-keys` returns transformed CSV with UUID ext_keys rewritten to `WORKSPACE-TYPE-NNN`. Pure CSV transform, no API calls.
6. **Relationships UI**
   - File picker grid (same layout as Import view) for re-uploading CSVs. Mappings pre-filled from `localStorage`. Entity type checklist + “Select all.” “Fix relationships” CTA triggers `POST /api/entities/relationships` SSE — only relationship pass runs (upsert skipped). 409s logged as “already linked.”
7. **Progress + logs**
   - Reuse live log panel; include per-entity subsections so multi-file runs remain understandable. Display dependency order and highlight entities skipped due to missing files.

### Rate limit & concurrency strategy
- Reuse the existing `pbClient` throttle + retry logic from companies/notes: sequential requests per Cloud Run instance with adaptive delay (`minDelay` 20 ms, slower when remaining quota <20) and exponential backoff (up to 6 attempts) on 429/5xx.
- Import/export loops run row-by-row (no parallel API calls) to ensure the shared ID cache stays consistent and PB rate limits stay predictable.
- If future workloads demand more throughput, we can add an env-driven concurrency cap to process multiple entities in parallel, but the default plan keeps the safer single-worker execution model.

### Delivery phases
1. **Metadata & templates**: add `archiver` dependency; port entity constants/meta (including type abbreviation map) to `meta.js`; build per-request config fetch helper; implement template endpoints (single + ZIP). Unblocks template downloads immediately.
2. **Validator & preview endpoint**: build `csvParser.js` + `validator.js` (two-pass config fetch, select value validation, parent resolution pre-check); add `/api/entities/preview` and `POST /api/entities/normalize-keys`; wire Import view with tabbed mapping UI, allowed-value hints, and shared options panel.
3. **Importer SSE + relationships**: implement `idCache.js` (preflight seeding), `importCoordinator.js`, `fieldBuilder.js` (both PATCH shapes, team branching, archived/phase/health/workProgress), `relationWriter.js` (PUT parent, POST connected, 409 swallow); add `/api/entities/run` + `/api/entities/relationships`; implement ext_key auto-generation; expose SSE logs + Relationships view.
4. **Exporters**: implement `exporter.js` (`POST /v2/entities/search` + cursor pagination; inline vs separate relationship fetch verified against live API); add `POST /api/entities/export/:type` + `POST /api/entities/export-all`; wire Export view.
5. **Migration + launch**: integrate `migrationHelper.js` export mode (ext_key and relationship rewriting); wire Migration view "Normalize ext_keys" action; QA with real CSV fixtures; activate Entities card.

### Reference implementation
- Legacy Google Apps Script logic lives under `importer-exporter Entities/` in this repo. Use it as a behavioral reference (validation rules, relationship ordering, migration helper details) whenever requirements are unclear, and confirm any ambiguities directly with the stakeholder before diverging.
