/* =========================================================
   PB Tools — frontend
   ========================================================= */

// ── Session state ──────────────────────────────────────────
const SESSION_KEY = 'pb_token';
const EU_KEY      = 'pb_eu';

let token  = sessionStorage.getItem(SESSION_KEY) || '';
let useEu  = sessionStorage.getItem(EU_KEY) === 'true';

// Import state (companies tool)
let parsedCSV    = null; // { raw: string, headers: string[], rowCount: number }
let customFields = [];   // [{ id, name, type }]
let lastExportCSV = null;
let lastExportFilename = 'companies.csv';

// ── DOM helpers ────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const show  = (id) => $(id).classList.remove('hidden');
const hide  = (id) => $(id).classList.add('hidden');
const setText = (id, t) => { $(id).textContent = t; };

// ── Screen management ───────────────────────────────────────
// Screens: 'auth' | 'home' | 'tool'

let pendingEu = null; // pre-select DC on next auth screen visit

function showScreen(screen) {
  // Hide everything first
  hide('auth-screen');
  hide('home-view');
  hide('tool-view');
  hide('topbar-breadcrumb');
  // app-screen (topbar+views) visible for home and tool
  const inApp = screen === 'home' || screen === 'tool';
  $('app-screen').classList.toggle('hidden', !inApp);

  if (screen === 'auth') {
    show('auth-screen');
    // Pre-select datacenter if coming from a DC switch
    if (pendingEu !== null) {
      $('auth-eu').checked = pendingEu;
      pendingEu = null;
    }
    $('auth-token').value = '';
    $('auth-submit').disabled = false;
    hide('auth-error');
  } else if (screen === 'home') {
    show('home-view');
    updateDcToggle();
  } else if (screen === 'tool') {
    show('tool-view');
    show('topbar-breadcrumb');
    updateDcToggle();
  }
}

function updateDcToggle() {
  $('dc-us').classList.toggle('active', !useEu);
  $('dc-eu').classList.toggle('active', useEu);
}

// ── Boot ───────────────────────────────────────────────────
function boot() {
  if (token) {
    showScreen('home');
  } else {
    showScreen('auth');
  }
}

// ── "PB Tools" home button ─────────────────────────────────
$('btn-home').addEventListener('click', () => {
  if (token) showScreen('home');
});

// ── DC toggle ──────────────────────────────────────────────
$('dc-us').addEventListener('click', () => switchDatacenter(false));
$('dc-eu').addEventListener('click', () => switchDatacenter(true));

function switchDatacenter(newEu) {
  if (newEu === useEu) return; // already on this datacenter
  const label = newEu ? 'EU' : 'US';
  if (!confirm(`Switching to the ${label} datacenter requires re-authentication (tokens are region-bound). Continue?`)) return;
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(EU_KEY);
  token = '';
  useEu = false;
  pendingEu = newEu;
  showScreen('auth');
}

// ── Tool cards ─────────────────────────────────────────────
document.querySelectorAll('.tool-card:not(.tool-card-soon)').forEach((card) => {
  card.addEventListener('click', () => {
    const tool = card.dataset.tool;
    if (tool) loadTool(tool);
  });
});

function loadTool(toolName) {
  const names = { companies: 'Companies', notes: 'Notes' };
  setText('topbar-tool-name', names[toolName] || toolName);
  showScreen('tool');

  // Show the correct sidebar section
  $('sidebar-companies').classList.toggle('hidden', toolName !== 'companies');
  $('sidebar-notes').classList.toggle('hidden', toolName !== 'notes');

  document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));

  if (toolName === 'companies') {
    $('nav-export').classList.add('active');
    showView('export');
  }

  if (toolName === 'notes') {
    $('nav-notes-export').classList.add('active');
    showView('notes-export');
  }
}

// ── Auth screen ────────────────────────────────────────────
$('auth-submit').addEventListener('click', async () => {
  const t = $('auth-token').value.trim();
  const eu = $('auth-eu').checked;
  if (!t) return;

  $('auth-submit').disabled = true;
  hide('auth-error');

  // Quick validation: try fetching custom fields with the token
  try {
    const res = await fetch('/api/fields', {
      headers: buildHeaders(t, eu),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      showAuthError(err.error || `Authentication failed (${res.status})`);
      return;
    }
    // Token works — save and go to home
    token = t;
    useEu = eu;
    sessionStorage.setItem(SESSION_KEY, token);
    sessionStorage.setItem(EU_KEY, String(useEu));
    showScreen('home');
  } catch (e) {
    showAuthError('Could not connect. Check your network and token.');
  } finally {
    $('auth-submit').disabled = false;
  }
});

$('auth-token').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('auth-submit').click();
});

function showAuthError(msg) {
  setText('auth-error-msg', msg);
  show('auth-error');
}

// ── Disconnect ─────────────────────────────────────────────
$('btn-disconnect').addEventListener('click', () => {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(EU_KEY);
  token = '';
  useEu = false;
  showScreen('auth');
});

// ── Tool nav (inside tool view) ─────────────────────────────
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    showView(btn.dataset.view);
  });
});

function showView(view) {
  [
    'export', 'import',
    'companies-delete-csv', 'companies-delete-all',
    'notes-export', 'notes-import', 'notes-delete-csv', 'notes-delete-all', 'notes-migrate',
  ].forEach((v) => {
    const el = $(`view-${v}`);
    if (el) el.classList.toggle('hidden', v !== view);
  });
}

// ── Helpers ─────────────────────────────────────────────────
function buildHeaders(t = token, eu = useEu) {
  const h = { 'Content-Type': 'application/json', 'x-pb-token': t };
  if (eu) h['x-pb-eu'] = 'true';
  return h;
}

function subscribeSSE(url, body, { onProgress, onComplete, onError, onLog = null }) {
  // SSE over POST: read the response body as a stream and parse SSE frames manually
  const ctrl = new AbortController();

  fetch(url, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(body),
    signal: ctrl.signal,
  }).then(async (res) => {
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      onError(err.error || `Request failed (${res.status})`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // Parse SSE events from buffer
      const parts = buf.split('\n\n');
      buf = parts.pop(); // keep incomplete last part

      for (const part of parts) {
        const lines = part.split('\n');
        let eventType = 'message';
        let dataLine = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) eventType = line.slice(7).trim();
          if (line.startsWith('data: '))  dataLine  = line.slice(6).trim();
        }
        if (!dataLine) continue;
        try {
          const data = JSON.parse(dataLine);
          if (eventType === 'progress')       onProgress(data);
          else if (eventType === 'complete')  onComplete(data);
          else if (eventType === 'error')     onError(data.message);
          else if (eventType === 'log' && onLog) onLog(data);
        } catch (_) {}
      }
    }
  }).catch((e) => {
    // AbortError = user clicked Stop — not a real error
    if (e.name !== 'AbortError') onError(e.message);
  });

  return ctrl;
}

// ══════════════════════════════════════════════════════════
// EXPORT
// ══════════════════════════════════════════════════════════
function resetExport() {
  show('export-idle');
  hide('export-running');
  hide('export-done');
  hide('export-error');
}

$('btn-export').addEventListener('click', startExport);
$('btn-export-again').addEventListener('click', resetExport);
$('btn-export-retry').addEventListener('click', startExport);

function startExport() {
  show('export-running');
  hide('export-idle');
  hide('export-done');
  hide('export-error');

  setExportProgress('Starting…', 0);

  subscribeSSE('/api/export', {}, {
    onProgress: ({ message, percent }) => setExportProgress(message, percent),
    onComplete: (data) => {
      hide('export-running');
      if (!data.csv && data.count === 0) {
        showExportError('No companies found in this workspace.');
        return;
      }
      lastExportCSV = data.csv;
      lastExportFilename = data.filename || 'companies.csv';
      show('export-done');
      setText('export-done-msg', `Exported ${data.count} companies. Ready to download.`);
    },
    onError: (msg) => {
      hide('export-running');
      showExportError(msg);
    },
  });
}

function setExportProgress(msg, pct) {
  setText('export-progress-msg', msg);
  setText('export-progress-pct', `${pct}%`);
  $('export-progress-bar').style.width = `${pct}%`;
}

function showExportError(msg) {
  setText('export-error-msg', msg);
  show('export-error');
}

$('btn-download-csv').addEventListener('click', () => {
  if (!lastExportCSV) return;
  const blob = new Blob([lastExportCSV], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = lastExportFilename;
  a.click();
  URL.revokeObjectURL(url);
});

// ══════════════════════════════════════════════════════════
// IMPORT — Step 1: Upload
// ══════════════════════════════════════════════════════════
const dropzone  = $('dropzone');
const fileInput = $('file-input');

dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) loadCSVFile(e.target.files[0]);
});

dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) loadCSVFile(file);
});

function loadCSVFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    const lines = text.trim().split('\n');
    if (lines.length < 2) {
      alert('CSV file appears empty or has no data rows.');
      return;
    }
    parsedCSV = { raw: text, headers: parseCSVHeaders(text), rowCount: lines.length - 1 };
    showMappingStep();
  };
  reader.readAsText(file);
}

function parseCSVHeaders(csvText) {
  const firstLine = csvText.split('\n')[0];
  return firstLine.split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
}

// ══════════════════════════════════════════════════════════
// IMPORT — Step 2: Map columns
// ══════════════════════════════════════════════════════════
async function showMappingStep() {
  hide('import-step-validate');
  hide('import-step-run');
  show('import-step-map');
  setText('map-subtitle', `${parsedCSV.rowCount} rows detected · ${parsedCSV.headers.length} columns`);

  buildBaseMappingTable();
  await loadAndBuildCustomFieldTable();
}

function buildBaseMappingTable() {
  const tbody = $('base-field-map-rows');
  tbody.innerHTML = '';

  const baseFields = [
    { id: 'map-pb-id',         label: 'PB Company UUID',   required: false, hint: 'If present → PATCH, else use domain lookup' },
    { id: 'map-name',          label: 'Company Name',       required: true  },
    { id: 'map-domain',        label: 'Domain',             required: true  },
    { id: 'map-desc',          label: 'Description',        required: false },
    { id: 'map-source-origin', label: 'Source Origin',      required: false },
    { id: 'map-source-record', label: 'Source Record ID',   required: false },
  ];

  for (const f of baseFields) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        ${f.label}
        ${f.hint ? `<div class="text-sm text-muted">${f.hint}</div>` : ''}
      </td>
      <td>${buildColumnSelect(f.id, !f.required)}</td>
      <td>${f.required ? '<span class="badge badge-danger">required</span>' : '<span class="badge badge-muted">optional</span>'}</td>
    `;
    tbody.appendChild(tr);
  }

  autoDetectBaseMappings();
}

function buildColumnSelect(id, includeNone = true) {
  const options = includeNone
    ? '<option value="">— not mapped —</option>'
    : '<option value="">— select column —</option>';

  const colOptions = parsedCSV.headers
    .map((h) => `<option value="${esc(h)}">${esc(h)}</option>`)
    .join('');

  return `<select id="${id}">${options}${colOptions}</select>`;
}

function autoDetectBaseMappings() {
  const hints = {
    'map-pb-id':         ['pb_id', 'id', 'uuid', 'company id', 'pb company id'],
    'map-name':          ['name', 'company name', 'company_name'],
    'map-domain':        ['domain', 'website', 'url'],
    'map-desc':          ['description', 'desc', 'notes'],
    'map-source-origin': ['sourceorigin', 'source_origin', 'source origin'],
    'map-source-record': ['sourcerecordid', 'source_record_id', 'source record id'],
  };

  for (const [selectId, candidates] of Object.entries(hints)) {
    const sel = $(selectId);
    if (!sel) continue;
    for (const candidate of candidates) {
      const match = parsedCSV.headers.find((h) => h.toLowerCase() === candidate);
      if (match) { sel.value = match; break; }
    }
  }
}

async function loadAndBuildCustomFieldTable() {
  $('custom-fields-loading').textContent = 'Loading custom fields from Productboard…';
  show('custom-fields-loading');
  hide('custom-field-table');

  try {
    const res = await fetch('/api/fields', { headers: buildHeaders() });
    const data = await res.json();
    customFields = data.fields || [];

    hide('custom-fields-loading');

    if (customFields.length === 0) {
      $('custom-fields-loading').textContent = 'No custom fields found in this workspace.';
      show('custom-fields-loading');
      return;
    }

    buildCustomFieldTable();
    show('custom-field-table');
  } catch (e) {
    $('custom-fields-loading').textContent = `Failed to load custom fields: ${e.message}`;
  }
}

function buildCustomFieldTable() {
  const tbody = $('custom-field-map-rows');
  tbody.innerHTML = '';

  for (const field of customFields) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(field.name)}</td>
      <td><span class="badge badge-muted">${field.type}</span></td>
      <td>${buildColumnSelect(`cf-${field.id}`, true)}</td>
    `;
    tbody.appendChild(tr);

    const sel = $(`cf-${field.id}`);
    const match = parsedCSV.headers.find(
      (h) => h.toLowerCase() === field.name.toLowerCase()
    );
    if (match) sel.value = match;
  }
}

$('btn-reupload').addEventListener('click', () => {
  parsedCSV = null;
  fileInput.value = '';
  hide('import-step-map');
  hide('import-step-validate');
  hide('import-step-run');
});

// ── Check for unmapped custom fields ────────────────────────
function checkUnmappedWarning() {
  const unmappedCustom = customFields
    .filter((f) => !$(`cf-${f.id}`)?.value)
    .map((f) => f.name);

  if (unmappedCustom.length > 0) {
    setText('unmapped-warning-msg',
      `${unmappedCustom.length} custom field(s) not mapped and will be skipped: ${unmappedCustom.join(', ')}.`
    );
    show('unmapped-warning');
  } else {
    hide('unmapped-warning');
  }
}

$('btn-validate').addEventListener('click', () => {
  checkUnmappedWarning();
  runValidation();
});
$('btn-run-import').addEventListener('click', () => {
  checkUnmappedWarning();
  runImport();
});

// ══════════════════════════════════════════════════════════
// IMPORT — Step 3: Validate
// ══════════════════════════════════════════════════════════
async function runValidation() {
  const mapping = buildMapping();
  if (!validateRequiredMappings(mapping)) return;

  show('import-step-validate');
  hide('validate-ok');
  hide('validate-errors');
  setText('validate-ok-msg', '');
  $('validate-error-rows').innerHTML = '';

  try {
    const res = await fetch('/api/import/preview', {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ csvText: parsedCSV.raw, mapping }),
    });
    const data = await res.json();

    if (data.valid) {
      setText('validate-ok-msg', `All ${data.totalRows} rows passed validation. Ready to import.`);
      show('validate-ok');
    } else {
      const summary = `${data.errors.length} error(s) found in ${data.totalRows} rows. Fix the CSV and re-upload.`;
      setText('validate-error-summary', summary);
      const tbody = $('validate-error-rows');
      for (const err of data.errors) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${err.row ?? '—'}</td>
          <td><span class="col-tag">${esc(err.field || '')}</span></td>
          <td class="text-danger">${esc(err.message)}</td>
        `;
        tbody.appendChild(tr);
      }
      show('validate-errors');
    }
  } catch (e) {
    setText('validate-error-summary', `Validation request failed: ${e.message}`);
    show('validate-errors');
  }
}

$('btn-run-after-validate').addEventListener('click', runImport);
$('btn-back-to-map').addEventListener('click', () => hide('import-step-validate'));
$('btn-back-to-map2').addEventListener('click', () => hide('import-step-validate'));

// ══════════════════════════════════════════════════════════
// IMPORT — Step 4: Run
// ══════════════════════════════════════════════════════════

let importController = null; // AbortController for the active import stream
let logCounts = { success: 0, error: 0, warn: 0, info: 0 };

function runImport() {
  const mapping = buildMapping();
  if (!validateRequiredMappings(mapping)) return;

  hide('import-step-validate');
  show('import-step-run');
  setText('import-run-title', 'Importing…');
  show('import-running');
  hide('import-results');
  setImportProgress('Starting…', 0);

  // Reset live log
  $('live-log-entries').innerHTML = '';
  hide('import-live-log');
  logCounts = { success: 0, error: 0, warn: 0, info: 0 };
  setText('live-log-counts', '');

  show('btn-stop-import');

  const clearEmpty = $('clear-empty-fields').checked;

  importController = subscribeSSE(
    '/api/import/run',
    { csvText: parsedCSV.raw, mapping, clearEmptyFields: clearEmpty },
    {
      onProgress: ({ message, percent }) => setImportProgress(message, percent),

      onLog: (entry) => appendLogEntry(entry),

      onComplete: (data) => {
        hide('btn-stop-import');
        hide('import-running');
        show('import-results');

        const stopped = data.stopped;
        const hasErrors = data.errors > 0;
        const title = stopped ? 'Import stopped' : hasErrors ? 'Import complete (with errors)' : 'Import complete';
        setText('import-run-title', title);

        const alertClass = stopped ? 'alert-warn' : hasErrors ? 'alert-warn' : 'alert-ok';
        const icon = stopped ? '⏹' : hasErrors ? '⚠️' : '✅';
        const rows = data.processed ?? data.total;
        const msg = stopped
          ? `Stopped after ${rows} rows — ${data.created} created · ${data.updated} updated · ${data.errors} error(s)`
          : `${data.created} created · ${data.updated} updated · ${data.errors} error(s) · ${data.total} rows`;

        $('import-summary-alert').innerHTML = `
          <div class="alert ${alertClass}">
            <span class="alert-icon">${icon}</span>
            <span>${msg}</span>
          </div>`;
      },

      onError: (msg) => {
        hide('btn-stop-import');
        hide('import-running');
        show('import-results');
        setText('import-run-title', 'Import failed');
        $('import-summary-alert').innerHTML = `
          <div class="alert alert-danger">
            <span class="alert-icon">⚠️</span>
            <span>${esc(msg)}</span>
          </div>`;
      },
    }
  );
}

function appendLogEntry({ level, message, detail, ts }) {
  const log = $('import-live-log');
  const entries = $('live-log-entries');

  if (log.classList.contains('hidden')) show('import-live-log');

  if (logCounts[level] !== undefined) logCounts[level]++;
  const parts = [];
  if (logCounts.success) parts.push(`<span style="color:#34d399">${logCounts.success} ok</span>`);
  if (logCounts.error)   parts.push(`<span style="color:#f87171">${logCounts.error} err</span>`);
  if (logCounts.warn)    parts.push(`<span style="color:#fbbf24">${logCounts.warn} warn</span>`);
  setText('live-log-counts', '');
  $('live-log-counts').innerHTML = parts.join(' · ');

  const time = ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  entry.innerHTML = `
    <span class="log-ts">${esc(time)}</span>
    <span class="log-msg">${esc(message)}</span>
    ${detail ? `<span class="log-detail" title="${esc(detail)}">${esc(detail)}</span>` : ''}
  `;
  entries.appendChild(entry);
  entries.scrollTop = entries.scrollHeight;
}

function setImportProgress(msg, pct) {
  setText('import-progress-msg', msg);
  setText('import-progress-pct', `${pct}%`);
  $('import-progress-bar').style.width = `${pct}%`;
}

$('btn-stop-import').addEventListener('click', () => {
  if (importController) {
    importController.abort();
    importController = null;
  }
  hide('btn-stop-import');
  hide('import-running');
  show('import-results');
  setText('import-run-title', 'Import stopped');
  $('import-summary-alert').innerHTML = `
    <div class="alert alert-warn">
      <span class="alert-icon">⏹</span>
      <span>Import stopped — ${logCounts.success} row(s) succeeded · ${logCounts.error} failed</span>
    </div>`;
});

$('btn-import-again').addEventListener('click', () => {
  parsedCSV = null;
  fileInput.value = '';
  hide('import-step-map');
  hide('import-step-run');
});

// ── Mapping helpers ─────────────────────────────────────────
function buildMapping() {
  return {
    pbIdColumn:       $('map-pb-id')?.value        || null,
    nameColumn:       $('map-name')?.value          || null,
    domainColumn:     $('map-domain')?.value        || null,
    descColumn:       $('map-desc')?.value          || null,
    sourceOriginCol:  $('map-source-origin')?.value || null,
    sourceRecordCol:  $('map-source-record')?.value || null,
    customFields: customFields
      .map((f) => ({
        csvColumn: $(`cf-${f.id}`)?.value || '',
        fieldId:   f.id,
        fieldType: f.type,
      }))
      .filter((cf) => cf.csvColumn),
  };
}

function validateRequiredMappings(mapping) {
  if (!mapping.nameColumn) {
    alert('Please map the "Company Name" column before continuing.');
    return false;
  }
  if (!mapping.domainColumn) {
    alert('Please map the "Domain" column before continuing.');
    return false;
  }
  return true;
}

// ── Escape HTML ─────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ══════════════════════════════════════════════════════════
// NOTES — Export
// ══════════════════════════════════════════════════════════

let lastNotesExportCSV = null;
let lastNotesExportFilename = 'notes.csv';

function resetNotesExport() {
  show('notes-export-idle');
  hide('notes-export-running');
  hide('notes-export-done');
  hide('notes-export-error');
}

$('btn-notes-export').addEventListener('click', startNotesExport);
$('btn-notes-export-again').addEventListener('click', resetNotesExport);
$('btn-notes-export-retry').addEventListener('click', startNotesExport);

document.querySelectorAll('input[name="notes-date-filter"]').forEach(r => {
  r.addEventListener('change', () => {
    hide('notes-filter-range');
    hide('notes-filter-dynamic');
    if (r.value === 'range')   show('notes-filter-range');
    if (r.value === 'dynamic') show('notes-filter-dynamic');
  });
});

function resolveNotesDateFilter() {
  const mode = document.querySelector('input[name="notes-date-filter"]:checked')?.value;
  if (!mode || mode === 'none') return {};

  if (mode === 'range') {
    const from = document.getElementById('notes-filter-from').value;  // 'YYYY-MM-DD' or ''
    const to   = document.getElementById('notes-filter-to').value;
    return {
      createdFrom: from ? `${from}T00:00:00Z` : undefined,
      createdTo:   to   ? `${to}T23:59:59Z`   : undefined,
    };
  }

  if (mode === 'dynamic') {
    const n      = parseInt(document.getElementById('notes-filter-n').value, 10) || 7;
    const period = document.getElementById('notes-filter-period').value;
    const now    = new Date();
    const from   = new Date(now);
    if (period === 'days')   from.setDate(now.getDate() - n);
    if (period === 'weeks')  from.setDate(now.getDate() - n * 7);
    if (period === 'months') from.setMonth(now.getMonth() - n);
    return { createdFrom: from.toISOString(), createdTo: now.toISOString() };
  }

  return {};
}

function startNotesExport() {
  const filters = resolveNotesDateFilter();

  if (filters.createdFrom && filters.createdTo && filters.createdFrom > filters.createdTo) {
    hide('notes-export-idle');
    setNotesExportError('"From" date must be before "To" date.');
    return;
  }

  hide('notes-export-idle');
  show('notes-export-running');
  hide('notes-export-done');
  hide('notes-export-error');
  setNotesExportProgress('Starting…', 0);

  subscribeSSE('/api/notes/export', filters, {
    onProgress: ({ message, percent }) => setNotesExportProgress(message, percent),
    onComplete: (data) => {
      hide('notes-export-running');
      if (!data.csv && data.count === 0) {
        setNotesExportError('No notes found matching your filters.');
        return;
      }
      lastNotesExportCSV = data.csv;
      lastNotesExportFilename = data.filename || 'notes-export.csv';
      show('notes-export-done');
      setText('notes-export-done-msg', `Exported ${data.count} notes. Ready to download.`);
    },
    onError: (msg) => {
      hide('notes-export-running');
      setNotesExportError(msg);
    },
  });
}

function setNotesExportProgress(msg, pct) {
  setText('notes-export-progress-msg', msg);
  setText('notes-export-progress-pct', `${pct}%`);
  $('notes-export-progress-bar').style.width = `${pct}%`;
}

function setNotesExportError(msg) {
  setText('notes-export-error-msg', msg);
  show('notes-export-error');
}

$('btn-notes-download-csv').addEventListener('click', () => {
  if (!lastNotesExportCSV) return;
  downloadCSV(lastNotesExportCSV, lastNotesExportFilename);
});

function downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ══════════════════════════════════════════════════════════
// NOTES — Import Step 1: Upload
// ══════════════════════════════════════════════════════════

let notesParsedCSV = null; // { raw, headers, rowCount }

const notesDropzone  = $('notes-dropzone');
const notesFileInput = $('notes-file-input');

notesDropzone.addEventListener('click', () => notesFileInput.click());
notesFileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) loadNotesCSV(e.target.files[0]);
});
notesDropzone.addEventListener('dragover', (e) => { e.preventDefault(); notesDropzone.classList.add('drag-over'); });
notesDropzone.addEventListener('dragleave', () => notesDropzone.classList.remove('drag-over'));
notesDropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  notesDropzone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) loadNotesCSV(file);
});

function loadNotesCSV(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    const lines = text.trim().split('\n');
    if (lines.length < 2) { alert('CSV file appears empty or has no data rows.'); return; }
    notesParsedCSV = { raw: text, headers: parseCSVHeaders(text), rowCount: lines.length - 1 };
    showNotesMappingStep();
  };
  reader.readAsText(file);
}

// ══════════════════════════════════════════════════════════
// NOTES — Import Step 2: Map columns
// ══════════════════════════════════════════════════════════

const NOTES_FIELDS = [
  { id: 'notes-map-pb-id',          label: 'PB Note UUID',       key: 'pbIdColumn',          required: false, hint: 'If present → update note in-place' },
  { id: 'notes-map-ext-id',         label: 'External ID',        key: 'extIdColumn',          required: false, hint: 'Matches by source.recordId — creates if not found' },
  { id: 'notes-map-type',           label: 'Note Type',          key: 'typeColumn',           required: false, hint: 'simple, conversation, or opportunity' },
  { id: 'notes-map-title',          label: 'Title',              key: 'titleColumn',          required: true  },
  { id: 'notes-map-content',        label: 'Content',            key: 'contentColumn',        required: false },
  { id: 'notes-map-display-url',    label: 'Display URL',        key: 'displayUrlColumn',     required: false },
  { id: 'notes-map-user-email',     label: 'User Email',         key: 'userEmailColumn',      required: false },
  { id: 'notes-map-company-domain', label: 'Company Domain',     key: 'companyDomainColumn',  required: false, hint: 'Used when user_email is not set' },
  { id: 'notes-map-owner-email',    label: 'Owner Email',        key: 'ownerEmailColumn',     required: false },
  { id: 'notes-map-creator-email',  label: 'Creator Email',      key: 'creatorEmailColumn',   required: false, hint: 'Set via v2 backfill after creation' },
  { id: 'notes-map-tags',           label: 'Tags',               key: 'tagsColumn',           required: false, hint: 'Comma-separated list' },
  { id: 'notes-map-source-origin',  label: 'Source Origin',      key: 'sourceOriginColumn',   required: false },
  { id: 'notes-map-source-record',  label: 'Source Record ID',   key: 'sourceRecordIdColumn', required: false },
  { id: 'notes-map-archived',       label: 'Archived',           key: 'archivedColumn',       required: false, hint: 'TRUE/FALSE — set via v2 backfill' },
  { id: 'notes-map-processed',      label: 'Processed',          key: 'processedColumn',      required: false, hint: 'TRUE/FALSE — set via v2 backfill' },
  { id: 'notes-map-linked-ents',    label: 'Linked Entities',    key: 'linkedEntitiesColumn', required: false, hint: 'Comma-separated feature/component UUIDs' },
];

const NOTES_AUTODETECT = {
  'notes-map-pb-id':          ['pb_id', 'pb note id', 'note id', 'uuid'],
  'notes-map-ext-id':         ['ext_id', 'external id', 'source_record_id'],
  'notes-map-type':           ['type', 'note type'],
  'notes-map-title':          ['title', 'name', 'subject'],
  'notes-map-content':        ['content', 'body', 'description'],
  'notes-map-display-url':    ['display_url', 'display url', 'url'],
  'notes-map-user-email':     ['user_email', 'user email', 'email'],
  'notes-map-company-domain': ['company_domain', 'company domain', 'domain'],
  'notes-map-owner-email':    ['owner_email', 'owner email'],
  'notes-map-creator-email':  ['creator_email', 'creator email'],
  'notes-map-tags':           ['tags'],
  'notes-map-source-origin':  ['source_origin', 'source origin'],
  'notes-map-source-record':  ['source_record_id', 'source record id'],
  'notes-map-archived':       ['archived'],
  'notes-map-processed':      ['processed'],
  'notes-map-linked-ents':    ['linked_entities', 'linked entities', 'features'],
};

function showNotesMappingStep() {
  hide('notes-import-step-validate');
  hide('notes-import-step-run');
  show('notes-import-step-map');
  setText('notes-map-subtitle', `${notesParsedCSV.rowCount} rows · ${notesParsedCSV.headers.length} columns`);
  buildNotesMappingTable();
}

function buildNotesMappingTable() {
  const tbody = $('notes-field-map-rows');
  tbody.innerHTML = '';

  for (const f of NOTES_FIELDS) {
    const tr = document.createElement('tr');
    const opts = (f.required ? '' : '<option value="">— not mapped —</option>') +
      notesParsedCSV.headers.map((h) => `<option value="${esc(h)}">${esc(h)}</option>`).join('');
    tr.innerHTML = `
      <td>
        ${esc(f.label)}
        ${f.hint ? `<div class="text-sm text-muted">${esc(f.hint)}</div>` : ''}
      </td>
      <td><select id="${f.id}">${opts}</select></td>
      <td>${f.required ? '<span class="badge badge-danger">required</span>' : '<span class="badge badge-muted">optional</span>'}</td>
    `;
    tbody.appendChild(tr);
  }

  // Auto-detect
  for (const [selectId, candidates] of Object.entries(NOTES_AUTODETECT)) {
    const sel = $(selectId);
    if (!sel) continue;
    for (const c of candidates) {
      const match = notesParsedCSV.headers.find((h) => h.toLowerCase() === c);
      if (match) { sel.value = match; break; }
    }
  }
}

function buildNotesMapping() {
  const mapping = {};
  for (const f of NOTES_FIELDS) {
    mapping[f.key] = $(f.id)?.value || null;
  }
  return mapping;
}

function validateNotesRequiredMappings(mapping) {
  if (!mapping.titleColumn) { alert('Please map the "Title" column before continuing.'); return false; }
  return true;
}

$('btn-notes-reupload').addEventListener('click', () => {
  notesParsedCSV = null;
  notesFileInput.value = '';
  hide('notes-import-step-map');
  hide('notes-import-step-validate');
  hide('notes-import-step-run');
});

// Toggle migration field row visibility
$('notes-migration-mode').addEventListener('change', () => {
  if ($('notes-migration-mode').checked) {
    show('notes-migration-field-row');
  } else {
    hide('notes-migration-field-row');
    setText('notes-migration-field-status', '');
  }
});

// Detect migration custom field
$('btn-notes-detect-field').addEventListener('click', async () => {
  const fieldName = $('notes-migration-field-name').value.trim();
  if (!fieldName) { alert('Enter a field name first.'); return; }

  const btn = $('btn-notes-detect-field');
  const statusEl = $('notes-migration-field-status');
  btn.disabled = true;
  setText('notes-migration-field-status', 'Checking…');

  try {
    const res = await fetch('/api/notes/detect-migration-field', {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ fieldName }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      statusEl.textContent = `Error: ${data.error || res.status}`;
      statusEl.style.color = 'var(--color-danger, #e53e3e)';
    } else if (data.found) {
      statusEl.textContent = `✅ Found — text field "${data.fieldName}" exists on entities`;
      statusEl.style.color = 'var(--color-success, #38a169)';
    } else {
      statusEl.textContent = `❌ Not found — no text field named "${data.fieldName}" on entities`;
      statusEl.style.color = 'var(--color-danger, #e53e3e)';
    }
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
    statusEl.style.color = 'var(--color-danger, #e53e3e)';
  } finally {
    btn.disabled = false;
  }
});

$('btn-notes-validate').addEventListener('click', () => {
  const mapping = buildNotesMapping();
  if (!validateNotesRequiredMappings(mapping)) return;
  runNotesValidation(mapping);
});

$('btn-notes-run-import').addEventListener('click', () => {
  const mapping = buildNotesMapping();
  if (!validateNotesRequiredMappings(mapping)) return;
  runNotesImport(mapping);
});

// ══════════════════════════════════════════════════════════
// NOTES — Import Step 3: Validate
// ══════════════════════════════════════════════════════════

async function runNotesValidation(mapping) {
  show('notes-import-step-validate');
  hide('notes-validate-ok');
  hide('notes-validate-errors');

  try {
    const res = await fetch('/api/notes/import/preview', {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ csvText: notesParsedCSV.raw, mapping }),
    });
    const data = await res.json();

    if (data.valid) {
      setText('notes-validate-ok-msg', `All ${data.totalRows} rows passed validation. Ready to import.`);

      // Show warnings if any
      if (data.warnings?.length) {
        setText('notes-validate-warnings-summary', `${data.warnings.length} warning(s) — import will still proceed`);
        const tbody = $('notes-validate-warning-rows');
        tbody.innerHTML = '';
        for (const w of data.warnings) {
          const tr = document.createElement('tr');
          tr.innerHTML = `<td>${w.row ?? '—'}</td><td><span class="col-tag">${esc(w.field || '')}</span></td><td class="text-muted">${esc(w.message)}</td>`;
          tbody.appendChild(tr);
        }
        show('notes-validate-warnings-section');
      } else {
        hide('notes-validate-warnings-section');
      }

      show('notes-validate-ok');
    } else {
      setText('notes-validate-error-summary', `${data.errors.length} error(s) in ${data.totalRows} rows. Fix and re-upload.`);
      const tbody = $('notes-validate-error-rows');
      tbody.innerHTML = '';
      for (const e of data.errors) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${e.row ?? '—'}</td><td><span class="col-tag">${esc(e.field || '')}</span></td><td class="text-danger">${esc(e.message)}</td>`;
        tbody.appendChild(tr);
      }
      show('notes-validate-errors');
    }
  } catch (e) {
    setText('notes-validate-error-summary', `Validation failed: ${e.message}`);
    show('notes-validate-errors');
  }
}

$('btn-notes-run-after-validate').addEventListener('click', () => {
  const mapping = buildNotesMapping();
  if (!validateNotesRequiredMappings(mapping)) return;
  runNotesImport(mapping);
});
$('btn-notes-back-to-map').addEventListener('click',  () => hide('notes-import-step-validate'));
$('btn-notes-back-to-map2').addEventListener('click', () => hide('notes-import-step-validate'));

// ══════════════════════════════════════════════════════════
// NOTES — Import Step 4: Run
// ══════════════════════════════════════════════════════════

let notesImportController = null;
let notesLogCounts = { success: 0, error: 0, warn: 0, info: 0 };

function runNotesImport(mapping) {
  hide('notes-import-step-validate');
  show('notes-import-step-run');
  setText('notes-import-run-title', 'Importing notes…');
  show('notes-import-running');
  hide('notes-import-results');
  setNotesImportProgress('Starting…', 0);

  $('notes-live-log-entries').innerHTML = '';
  hide('notes-import-live-log');
  notesLogCounts = { success: 0, error: 0, warn: 0, info: 0 };
  setText('notes-live-log-counts', '');

  show('btn-stop-notes-import');

  const migrationMode = $('notes-migration-mode').checked;
  const migrationFieldName = migrationMode
    ? ($('notes-migration-field-name').value.trim() || 'original_uuid')
    : 'original_uuid';

  notesImportController = subscribeSSE(
    '/api/notes/import/run',
    { csvText: notesParsedCSV.raw, mapping, migrationMode, migrationFieldName },
    {
      onProgress: ({ message, percent }) => setNotesImportProgress(message, percent),

      onLog: (entry) => appendNotesLogEntry(entry),

      onComplete: (data) => {
        hide('btn-stop-notes-import');
        hide('notes-import-running');
        show('notes-import-results');

        const stopped = data.stopped;
        const hasErrors = data.errors > 0;
        const title = stopped ? 'Import stopped' : hasErrors ? 'Import complete (with errors)' : 'Import complete';
        setText('notes-import-run-title', title);

        const alertClass = stopped || hasErrors ? 'alert-warn' : 'alert-ok';
        const icon = stopped ? '⏹' : hasErrors ? '⚠️' : '✅';
        const msg = stopped
          ? `Stopped after ${data.created + data.updated} notes — ${data.created} created · ${data.updated} updated · ${data.errors} error(s)`
          : `${data.created} created · ${data.updated} updated · ${data.errors} error(s) · ${data.total} rows total`;

        $('notes-import-summary-alert').innerHTML = `<div class="alert ${alertClass}"><span class="alert-icon">${icon}</span><span>${msg}</span></div>`;
      },

      onError: (msg) => {
        hide('btn-stop-notes-import');
        hide('notes-import-running');
        show('notes-import-results');
        setText('notes-import-run-title', 'Import failed');
        $('notes-import-summary-alert').innerHTML = `<div class="alert alert-danger"><span class="alert-icon">⚠️</span><span>${esc(msg)}</span></div>`;
      },
    }
  );
}

function appendNotesLogEntry({ level, message, detail, ts }) {
  const log     = $('notes-import-live-log');
  const entries = $('notes-live-log-entries');

  if (log.classList.contains('hidden')) show('notes-import-live-log');

  if (notesLogCounts[level] !== undefined) notesLogCounts[level]++;
  const parts = [];
  if (notesLogCounts.success) parts.push(`<span style="color:#34d399">${notesLogCounts.success} ok</span>`);
  if (notesLogCounts.error)   parts.push(`<span style="color:#f87171">${notesLogCounts.error} err</span>`);
  if (notesLogCounts.warn)    parts.push(`<span style="color:#fbbf24">${notesLogCounts.warn} warn</span>`);
  $('notes-live-log-counts').innerHTML = parts.join(' · ');

  const time = ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  entry.innerHTML = `
    <span class="log-ts">${esc(time)}</span>
    <span class="log-msg">${esc(message)}</span>
    ${detail ? `<span class="log-detail" title="${esc(detail)}">${esc(detail)}</span>` : ''}
  `;
  entries.appendChild(entry);
  entries.scrollTop = entries.scrollHeight;
}

function setNotesImportProgress(msg, pct) {
  setText('notes-import-progress-msg', msg);
  setText('notes-import-progress-pct', `${pct}%`);
  $('notes-import-progress-bar').style.width = `${pct}%`;
}

$('btn-stop-notes-import').addEventListener('click', () => {
  if (notesImportController) {
    notesImportController.abort();
    notesImportController = null;
  }
  hide('btn-stop-notes-import');
  appendNotesLogEntry({ level: 'warn', message: 'Stop requested — waiting for current row to finish…', ts: new Date().toISOString() });
});

$('btn-notes-import-again').addEventListener('click', () => {
  notesParsedCSV = null;
  notesFileInput.value = '';
  hide('notes-import-step-map');
  hide('notes-import-step-run');
});

// ══════════════════════════════════════════════════════════
// NOTES — Delete from CSV
// ══════════════════════════════════════════════════════════

let notesDeleteParsedCSV = null;
let notesDeleteController = null;

const notesDeleteDropzone  = $('notes-delete-dropzone');
const notesDeleteFileInput = $('notes-delete-file-input');

notesDeleteDropzone.addEventListener('click', () => notesDeleteFileInput.click());
notesDeleteFileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) loadNotesDeleteCSV(e.target.files[0]);
});
notesDeleteDropzone.addEventListener('dragover', (e) => { e.preventDefault(); notesDeleteDropzone.classList.add('drag-over'); });
notesDeleteDropzone.addEventListener('dragleave', () => notesDeleteDropzone.classList.remove('drag-over'));
notesDeleteDropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  notesDeleteDropzone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) loadNotesDeleteCSV(file);
});

function loadNotesDeleteCSV(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    const lines = text.trim().split('\n');
    if (lines.length < 2) { alert('CSV appears empty.'); return; }
    const headers = parseCSVHeaders(text);
    notesDeleteParsedCSV = { raw: text, headers, rowCount: lines.length - 1 };

    // Populate column picker
    const sel = $('notes-delete-uuid-column');
    sel.innerHTML = headers.map((h) => `<option value="${esc(h)}">${esc(h)}</option>`).join('');

    // Auto-select pb_id column
    const auto = headers.find((h) => ['pb_id', 'pb note id', 'id', 'uuid'].includes(h.toLowerCase()));
    if (auto) sel.value = auto;

    setText('notes-delete-csv-subtitle', `${notesDeleteParsedCSV.rowCount} rows · ${headers.length} columns`);
    updateDeleteCSVPreview();
    show('notes-delete-csv-step-confirm');
  };
  reader.readAsText(file);
}

$('notes-delete-uuid-column').addEventListener('change', updateDeleteCSVPreview);

function updateDeleteCSVPreview() {
  const col = $('notes-delete-uuid-column').value;
  if (!notesDeleteParsedCSV || !col) return;

  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const headers = parseCSVHeaders(notesDeleteParsedCSV.raw);
  const colIdx = headers.indexOf(col);
  if (colIdx < 0) return;

  // Extract first 5 valid UUIDs for preview
  const lines = notesDeleteParsedCSV.raw.trim().split('\n').slice(1);
  const uuids = lines
    .map((l) => l.split(',')[colIdx]?.trim().replace(/^"|"$/g, ''))
    .filter((v) => UUID_PATTERN.test(v))
    .slice(0, 5);

  const preview = $('notes-delete-csv-preview');
  if (uuids.length > 0) {
    preview.textContent = `First UUIDs: ${uuids.join(', ')}${lines.length > 5 ? ', …' : ''}`;
    show('notes-delete-csv-preview');
  } else {
    preview.textContent = 'No valid UUIDs found in this column.';
    show('notes-delete-csv-preview');
  }
}

$('btn-notes-delete-reupload').addEventListener('click', () => {
  notesDeleteParsedCSV = null;
  notesDeleteFileInput.value = '';
  hide('notes-delete-csv-step-confirm');
  hide('notes-delete-csv-step-run');
});

$('btn-notes-delete-csv-run').addEventListener('click', () => {
  const col = $('notes-delete-uuid-column').value;
  if (!col || !notesDeleteParsedCSV) return;
  startNotesDeleteCSV(col);
});

function startNotesDeleteCSV(uuidColumn) {
  hide('notes-delete-csv-step-confirm');
  show('notes-delete-csv-step-run');
  setText('notes-delete-csv-run-title', 'Deleting notes…');
  show('notes-delete-csv-running');
  hide('notes-delete-csv-results');
  setNotesDeleteCSVProgress('Starting…', 0);

  $('notes-delete-csv-log-entries').innerHTML = '';
  hide('notes-delete-csv-live-log');

  show('btn-stop-notes-delete-csv');

  notesDeleteController = subscribeSSE(
    '/api/notes/delete/by-csv',
    { csvText: notesDeleteParsedCSV.raw, uuidColumn },
    {
      onProgress: ({ message, percent }) => setNotesDeleteCSVProgress(message, percent),

      onLog: (entry) => {
        const logEl = $('notes-delete-csv-live-log');
        const entries = $('notes-delete-csv-log-entries');
        if (logEl.classList.contains('hidden')) show('notes-delete-csv-live-log');
        const e = document.createElement('div');
        e.className = `log-entry ${entry.level}`;
        e.innerHTML = `<span class="log-msg">${esc(entry.message)}</span>`;
        entries.appendChild(e);
        entries.scrollTop = entries.scrollHeight;
      },

      onComplete: (data) => {
        hide('btn-stop-notes-delete-csv');
        hide('notes-delete-csv-running');
        show('notes-delete-csv-results');
        setText('notes-delete-csv-run-title', 'Deletion complete');
        const hasErrors = data.errors > 0;
        const alertClass = hasErrors ? 'alert-warn' : 'alert-ok';
        const icon = hasErrors ? '⚠️' : '✅';
        $('notes-delete-csv-summary-alert').innerHTML = `
          <div class="alert ${alertClass}"><span class="alert-icon">${icon}</span>
          <span>${data.deleted} deleted · ${data.errors} error(s) · ${data.total} in CSV</span></div>`;
      },

      onError: (msg) => {
        hide('btn-stop-notes-delete-csv');
        hide('notes-delete-csv-running');
        show('notes-delete-csv-results');
        setText('notes-delete-csv-run-title', 'Deletion failed');
        $('notes-delete-csv-summary-alert').innerHTML = `<div class="alert alert-danger"><span class="alert-icon">⚠️</span><span>${esc(msg)}</span></div>`;
      },
    }
  );
}

function setNotesDeleteCSVProgress(msg, pct) {
  setText('notes-delete-csv-progress-msg', msg);
  setText('notes-delete-csv-progress-pct', `${pct}%`);
  $('notes-delete-csv-progress-bar').style.width = `${pct}%`;
}

$('btn-stop-notes-delete-csv').addEventListener('click', () => {
  if (notesDeleteController) { notesDeleteController.abort(); notesDeleteController = null; }
  hide('btn-stop-notes-delete-csv');
});

$('btn-notes-delete-csv-again').addEventListener('click', () => {
  notesDeleteParsedCSV = null;
  notesDeleteFileInput.value = '';
  hide('notes-delete-csv-step-confirm');
  hide('notes-delete-csv-step-run');
});

// ══════════════════════════════════════════════════════════
// NOTES — Delete All
// ══════════════════════════════════════════════════════════

let notesDeleteAllController = null;

$('notes-delete-all-confirm-input').addEventListener('input', (e) => {
  $('btn-notes-delete-all-run').disabled = e.target.value.trim() !== 'DELETE';
});

$('btn-notes-delete-all-run').addEventListener('click', () => {
  if ($('notes-delete-all-confirm-input').value.trim() !== 'DELETE') return;
  startNotesDeleteAll();
});

function startNotesDeleteAll() {
  hide('notes-delete-all-idle');
  show('notes-delete-all-running');
  hide('notes-delete-all-results');
  setNotesDeleteAllProgress('Starting…', 0);

  $('notes-delete-all-log-entries').innerHTML = '';
  hide('notes-delete-all-live-log');

  notesDeleteAllController = subscribeSSE(
    '/api/notes/delete/all',
    {},
    {
      onProgress: ({ message, percent }) => setNotesDeleteAllProgress(message, percent),

      onLog: (entry) => {
        const logEl = $('notes-delete-all-live-log');
        const entries = $('notes-delete-all-log-entries');
        if (logEl.classList.contains('hidden')) show('notes-delete-all-live-log');
        const e = document.createElement('div');
        e.className = `log-entry ${entry.level}`;
        e.innerHTML = `<span class="log-msg">${esc(entry.message)}</span>`;
        entries.appendChild(e);
        entries.scrollTop = entries.scrollHeight;
      },

      onComplete: (data) => {
        hide('notes-delete-all-running');
        show('notes-delete-all-results');
        const hasErrors = data.errors > 0;
        const alertClass = hasErrors ? 'alert-warn' : 'alert-ok';
        const icon = hasErrors ? '⚠️' : '✅';
        $('notes-delete-all-summary-alert').innerHTML = `
          <div class="alert ${alertClass}"><span class="alert-icon">${icon}</span>
          <span>${data.deleted} notes deleted · ${data.errors} error(s)</span></div>`;
      },

      onError: (msg) => {
        hide('notes-delete-all-running');
        show('notes-delete-all-results');
        $('notes-delete-all-summary-alert').innerHTML = `<div class="alert alert-danger"><span class="alert-icon">⚠️</span><span>${esc(msg)}</span></div>`;
      },
    }
  );
}

function setNotesDeleteAllProgress(msg, pct) {
  setText('notes-delete-all-progress-msg', msg);
  setText('notes-delete-all-progress-pct', `${pct}%`);
  $('notes-delete-all-progress-bar').style.width = `${pct}%`;
}

$('btn-notes-delete-all-again').addEventListener('click', () => {
  $('notes-delete-all-confirm-input').value = '';
  $('btn-notes-delete-all-run').disabled = true;
  hide('notes-delete-all-running');
  hide('notes-delete-all-results');
  show('notes-delete-all-idle');
});

// ══════════════════════════════════════════════════════════
// COMPANIES — Delete from CSV
// ══════════════════════════════════════════════════════════

let companiesDeleteParsedCSV = null;
let companiesDeleteController = null;

const companiesDeleteDropzone  = $('companies-delete-dropzone');
const companiesDeleteFileInput = $('companies-delete-file-input');

companiesDeleteDropzone.addEventListener('click', () => companiesDeleteFileInput.click());
companiesDeleteFileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) loadCompaniesDeleteCSV(e.target.files[0]);
});
companiesDeleteDropzone.addEventListener('dragover', (e) => { e.preventDefault(); companiesDeleteDropzone.classList.add('drag-over'); });
companiesDeleteDropzone.addEventListener('dragleave', () => companiesDeleteDropzone.classList.remove('drag-over'));
companiesDeleteDropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  companiesDeleteDropzone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) loadCompaniesDeleteCSV(file);
});

function loadCompaniesDeleteCSV(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    const lines = text.trim().split('\n');
    if (lines.length < 2) { alert('CSV appears empty.'); return; }
    const headers = parseCSVHeaders(text);
    companiesDeleteParsedCSV = { raw: text, headers, rowCount: lines.length - 1 };

    // Populate column picker
    const sel = $('companies-delete-uuid-column');
    sel.innerHTML = headers.map((h) => `<option value="${esc(h)}">${esc(h)}</option>`).join('');

    // Auto-select id/pb_id/uuid column — export CSV uses 'id' as the UUID column
    const auto = headers.find((h) => ['pb_id', 'id', 'uuid'].includes(h.toLowerCase()));
    if (auto) sel.value = auto;

    setText('companies-delete-csv-subtitle', `${companiesDeleteParsedCSV.rowCount} rows · ${headers.length} columns`);
    updateCompaniesDeleteCSVPreview();
    show('companies-delete-csv-step-confirm');
  };
  reader.readAsText(file);
}

$('companies-delete-uuid-column').addEventListener('change', updateCompaniesDeleteCSVPreview);

function updateCompaniesDeleteCSVPreview() {
  const col = $('companies-delete-uuid-column').value;
  if (!companiesDeleteParsedCSV || !col) return;

  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const headers = parseCSVHeaders(companiesDeleteParsedCSV.raw);
  const colIdx = headers.indexOf(col);
  if (colIdx < 0) return;

  // Extract first 5 valid UUIDs for preview
  const lines = companiesDeleteParsedCSV.raw.trim().split('\n').slice(1);
  const uuids = lines
    .map((l) => l.split(',')[colIdx]?.trim().replace(/^"|"$/g, ''))
    .filter((v) => UUID_PATTERN.test(v))
    .slice(0, 5);

  const preview = $('companies-delete-csv-preview');
  if (uuids.length > 0) {
    preview.textContent = `First UUIDs: ${uuids.join(', ')}${lines.length > 5 ? ', …' : ''}`;
    show('companies-delete-csv-preview');
  } else {
    preview.textContent = 'No valid UUIDs found in this column.';
    show('companies-delete-csv-preview');
  }
}

$('btn-companies-delete-reupload').addEventListener('click', () => {
  companiesDeleteParsedCSV = null;
  companiesDeleteFileInput.value = '';
  hide('companies-delete-csv-step-confirm');
  hide('companies-delete-csv-step-run');
});

$('btn-companies-delete-csv-run').addEventListener('click', () => {
  const col = $('companies-delete-uuid-column').value;
  if (!col || !companiesDeleteParsedCSV) return;
  startCompaniesDeleteCSV(col);
});

function startCompaniesDeleteCSV(uuidColumn) {
  hide('companies-delete-csv-step-confirm');
  show('companies-delete-csv-step-run');
  setText('companies-delete-csv-run-title', 'Deleting companies…');
  show('companies-delete-csv-running');
  hide('companies-delete-csv-results');
  setCompaniesDeleteCSVProgress('Starting…', 0);

  $('companies-delete-csv-log-entries').innerHTML = '';
  hide('companies-delete-csv-live-log');

  show('btn-stop-companies-delete-csv');

  companiesDeleteController = subscribeSSE(
    '/api/companies/delete/by-csv',
    { csvText: companiesDeleteParsedCSV.raw, uuidColumn },
    {
      onProgress: ({ message, percent }) => setCompaniesDeleteCSVProgress(message, percent),

      onLog: (entry) => {
        const logEl = $('companies-delete-csv-live-log');
        const entries = $('companies-delete-csv-log-entries');
        if (logEl.classList.contains('hidden')) show('companies-delete-csv-live-log');
        const e = document.createElement('div');
        e.className = `log-entry ${entry.level}`;
        e.innerHTML = `<span class="log-msg">${esc(entry.message)}</span>`;
        entries.appendChild(e);
        entries.scrollTop = entries.scrollHeight;
      },

      onComplete: (data) => {
        hide('btn-stop-companies-delete-csv');
        hide('companies-delete-csv-running');
        show('companies-delete-csv-results');
        setText('companies-delete-csv-run-title', 'Deletion complete');
        const hasErrors = data.errors > 0;
        const alertClass = hasErrors ? 'alert-warn' : 'alert-ok';
        const icon = hasErrors ? '⚠️' : '✅';
        $('companies-delete-csv-summary-alert').innerHTML = `
          <div class="alert ${alertClass}"><span class="alert-icon">${icon}</span>
          <span>${data.deleted} deleted · ${data.errors} error(s) · ${data.total} in CSV</span></div>`;
      },

      onError: (msg) => {
        hide('btn-stop-companies-delete-csv');
        hide('companies-delete-csv-running');
        show('companies-delete-csv-results');
        setText('companies-delete-csv-run-title', 'Deletion failed');
        $('companies-delete-csv-summary-alert').innerHTML = `<div class="alert alert-danger"><span class="alert-icon">⚠️</span><span>${esc(msg)}</span></div>`;
      },
    }
  );
}

function setCompaniesDeleteCSVProgress(msg, pct) {
  setText('companies-delete-csv-progress-msg', msg);
  setText('companies-delete-csv-progress-pct', `${pct}%`);
  $('companies-delete-csv-progress-bar').style.width = `${pct}%`;
}

$('btn-stop-companies-delete-csv').addEventListener('click', () => {
  if (companiesDeleteController) { companiesDeleteController.abort(); companiesDeleteController = null; }
  hide('btn-stop-companies-delete-csv');
});

$('btn-companies-delete-csv-again').addEventListener('click', () => {
  companiesDeleteParsedCSV = null;
  companiesDeleteFileInput.value = '';
  hide('companies-delete-csv-step-confirm');
  hide('companies-delete-csv-step-run');
});

// ══════════════════════════════════════════════════════════
// COMPANIES — Delete All
// ══════════════════════════════════════════════════════════

let companiesDeleteAllController = null;

$('companies-delete-all-confirm-input').addEventListener('input', (e) => {
  $('btn-companies-delete-all-run').disabled = e.target.value.trim() !== 'DELETE';
});

$('btn-companies-delete-all-run').addEventListener('click', () => {
  if ($('companies-delete-all-confirm-input').value.trim() !== 'DELETE') return;
  startCompaniesDeleteAll();
});

function startCompaniesDeleteAll() {
  hide('companies-delete-all-idle');
  show('companies-delete-all-running');
  hide('companies-delete-all-results');
  setCompaniesDeleteAllProgress('Starting…', 0);

  $('companies-delete-all-log-entries').innerHTML = '';
  hide('companies-delete-all-live-log');

  companiesDeleteAllController = subscribeSSE(
    '/api/companies/delete/all',
    {},
    {
      onProgress: ({ message, percent }) => setCompaniesDeleteAllProgress(message, percent),

      onLog: (entry) => {
        const logEl = $('companies-delete-all-live-log');
        const entries = $('companies-delete-all-log-entries');
        if (logEl.classList.contains('hidden')) show('companies-delete-all-live-log');
        const e = document.createElement('div');
        e.className = `log-entry ${entry.level}`;
        e.innerHTML = `<span class="log-msg">${esc(entry.message)}</span>`;
        entries.appendChild(e);
        entries.scrollTop = entries.scrollHeight;
      },

      onComplete: (data) => {
        hide('companies-delete-all-running');
        show('companies-delete-all-results');
        const hasErrors = data.errors > 0;
        const alertClass = hasErrors ? 'alert-warn' : 'alert-ok';
        const icon = hasErrors ? '⚠️' : '✅';
        $('companies-delete-all-summary-alert').innerHTML = `
          <div class="alert ${alertClass}"><span class="alert-icon">${icon}</span>
          <span>${data.deleted} companies deleted · ${data.errors} error(s)</span></div>`;
      },

      onError: (msg) => {
        hide('companies-delete-all-running');
        show('companies-delete-all-results');
        $('companies-delete-all-summary-alert').innerHTML = `<div class="alert alert-danger"><span class="alert-icon">⚠️</span><span>${esc(msg)}</span></div>`;
      },
    }
  );
}

function setCompaniesDeleteAllProgress(msg, pct) {
  setText('companies-delete-all-progress-msg', msg);
  setText('companies-delete-all-progress-pct', `${pct}%`);
  $('companies-delete-all-progress-bar').style.width = `${pct}%`;
}

$('btn-companies-delete-all-again').addEventListener('click', () => {
  $('companies-delete-all-confirm-input').value = '';
  $('btn-companies-delete-all-run').disabled = true;
  hide('companies-delete-all-running');
  hide('companies-delete-all-results');
  show('companies-delete-all-idle');
});

// ══════════════════════════════════════════════════════════
// NOTES — Migration Prep
// ══════════════════════════════════════════════════════════

let notesMigrateParsedCSV = null;
let notesMigrateResultCSV = null;
let notesMigrateFilename  = 'notes-prepared.csv';

const notesMigrateDropzone  = $('notes-migrate-dropzone');
const notesMigrateFileInput = $('notes-migrate-file-input');

notesMigrateDropzone.addEventListener('click', () => notesMigrateFileInput.click());
notesMigrateFileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) loadNotesMigrateCSV(e.target.files[0]);
});
notesMigrateDropzone.addEventListener('dragover', (e) => { e.preventDefault(); notesMigrateDropzone.classList.add('drag-over'); });
notesMigrateDropzone.addEventListener('dragleave', () => notesMigrateDropzone.classList.remove('drag-over'));
notesMigrateDropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  notesMigrateDropzone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) loadNotesMigrateCSV(file);
});

function loadNotesMigrateCSV(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    const lines = text.trim().split('\n');
    if (lines.length < 2) { alert('CSV appears empty.'); return; }
    notesMigrateParsedCSV = { raw: text, rowCount: lines.length - 1 };
    show('notes-migrate-form');
    notesMigrateDropzone.querySelector('.dropzone-label').textContent = `${file.name} (${lines.length - 1} rows)`;
  };
  reader.readAsText(file);
}

$('btn-notes-migrate-run').addEventListener('click', async () => {
  if (!notesMigrateParsedCSV) { alert('Upload a CSV first.'); return; }
  const sourceOriginName = $('notes-migrate-source-name').value.trim();
  if (!sourceOriginName) { alert('Enter a migration source name.'); return; }

  $('btn-notes-migrate-run').disabled = true;

  try {
    const res = await fetch('/api/notes/migrate-prep', {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ csvText: notesMigrateParsedCSV.raw, sourceOriginName }),
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      hide('notes-migrate-idle');
      setText('notes-migrate-error-msg', data.error || `HTTP ${res.status}`);
      show('notes-migrate-error');
      return;
    }

    notesMigrateResultCSV = data.csv;
    const date = new Date().toISOString().slice(0, 10);
    notesMigrateFilename = `notes-migration-${sourceOriginName.replace(/[^a-zA-Z0-9-_]/g, '_')}-${date}.csv`;

    hide('notes-migrate-idle');
    hide('notes-migrate-error');
    setText('notes-migrate-done-msg', `${data.count} notes prepared for migration. Download and import into the target workspace.`);
    show('notes-migrate-done');
  } catch (e) {
    setText('notes-migrate-error-msg', e.message);
    show('notes-migrate-error');
    hide('notes-migrate-done');
  } finally {
    $('btn-notes-migrate-run').disabled = false;
  }
});

$('btn-notes-migrate-download').addEventListener('click', () => {
  if (notesMigrateResultCSV) downloadCSV(notesMigrateResultCSV, notesMigrateFilename);
});

$('btn-notes-migrate-again').addEventListener('click', () => {
  notesMigrateParsedCSV = null;
  notesMigrateResultCSV = null;
  notesMigrateFileInput.value = '';
  notesMigrateDropzone.querySelector('.dropzone-label').textContent = 'Drop your export CSV here';
  hide('notes-migrate-form');
  hide('notes-migrate-done');
  hide('notes-migrate-error');
  show('notes-migrate-idle');
});

$('btn-notes-migrate-retry').addEventListener('click', () => {
  hide('notes-migrate-error');
  show('notes-migrate-idle');
});

// ── Run ─────────────────────────────────────────────────────
boot();
