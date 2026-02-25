# PB Tools

A web-based toolkit for bulk operations on Productboard data. Currently supports exporting and importing **Companies** (including custom fields). Notes and Entities modules are planned.

---

## Running the app

**Requirements:** Node >= 18

```bash
npm install
npm run dev      # development (nodemon, auto-restart)
npm start        # production
```

The app runs on `http://localhost:8080` by default. Set a `PORT` environment variable to override.

### Docker / Cloud Run

```bash
docker build -t pb-tools .
docker run -p 8080:8080 pb-tools
```

The Dockerfile targets Cloud Run (`ENV PORT=8080`).

---

## Authentication

Open the app in a browser. You will be prompted for a **Productboard API token** before anything else is accessible.

- The token lives only in `sessionStorage` — it is never persisted to disk or sent anywhere except directly to the Productboard API.
- Select **EU datacenter** if your Productboard workspace is hosted on `api.eu.productboard.com`. Tokens are region-bound; switching datacenter requires re-authentication.
- The token is validated immediately on connect by making a test call to `/api/fields`. An incorrect token shows an error before you can proceed.

To disconnect, click **Disconnect** in the top-right corner. This clears the session.

---

## Tools

### Companies

Accessible from the home screen. Two operations are available via the left sidebar.

#### Export companies

Fetches all companies from your Productboard workspace and generates a downloadable CSV.

**What is exported:**

| CSV Column | Source |
|---|---|
| PB Company ID | `company.id` |
| Company Name | `company.name` |
| Domain | `company.domain` |
| Description | `company.description` |
| Source Origin | `company.source.origin` |
| Source Record ID | `company.source.record_id` |
| *(one column per custom field)* | fetched per company |

Custom field values are fetched individually per company in parallel batches of 5. Progress is streamed in real time.

The filename is `companies-YYYY-MM-DD.csv`.

#### Import companies

A four-step guided flow:

**Step 1 — Upload CSV**
Drag-and-drop or click to browse. Accepts `.csv` files. The file is read in the browser; nothing is uploaded to the server until you start the import.

**Step 2 — Map columns**
Map your CSV columns to Productboard fields. Required fields are marked. Auto-detection matches common column names (e.g. `name`, `domain`, `uuid`). Custom fields are loaded from the API and can each be mapped to a CSV column.

Base fields available for mapping:

| PB Field | Required | Notes |
|---|---|---|
| PB Company UUID | No | If present, row will PATCH by UUID regardless of domain |
| Company Name | Yes | |
| Domain | Yes* | *Not required if every row has a UUID |
| Description | No | Supports a subset of HTML tags (see below) |
| Source Origin | No | |
| Source Record ID | No | |

**Step 3 — Validate (optional)**
Runs client-side and server-side validation before touching the API. Checks:
- Name and domain are present where required
- Duplicate domains in the CSV (only flagged for rows without a UUID)
- UUID format validity
- Unsupported HTML tags in Description (Productboard rejects these with a 400)
- Custom field type mismatches (e.g. text in a number field)
- Custom field text values exceeding 1024 characters

Supported HTML tags in Description: `h1 h2 p b i u code ul ol li a hr pre blockquote s span`

**Step 4 — Run**
Processes each row sequentially with a live log:

- Row has a UUID → **PATCH** that company directly
- Row has no UUID but the domain exists in Productboard → **PATCH** the matched company
- Row has no UUID and domain is new → **POST** (create new company)

After the company record is created/updated, any mapped custom fields are applied:
- Non-empty value → PUT the value
- Empty value + "Clear empty custom field values" checkbox checked → DELETE the value from Productboard

A **Stop** button is available during import. Clicking it immediately cancels the stream and shows a stopped summary with the row counts accumulated so far (visible in the live log above the summary). The server will also stop processing once it detects the disconnection.

The summary shows total rows processed, created, updated, and error count.

---

## API rate limiting

All Productboard API calls go through a shared client that:
- Respects `X-RateLimit-Remaining` headers, throttling automatically as the limit approaches
- Retries on `429 Too Many Requests` (honouring `Retry-After`) and `5xx` errors
- Uses exponential backoff with jitter, up to 6 attempts

---

## Planned modules

| Module | Status | Description |
|---|---|---|
| Companies | Live | Export and import companies with custom fields |
| Notes | Planned | Export, import, and delete notes |
| Entities | Planned | Import and delete features, stories, and more |
