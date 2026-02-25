# Productboard API Analysis: Notes v1 vs v2 & Sample Implementation

**Analysis Date:** February 7, 2026
**Scope:** Productboard Notes API (v1 & v2) and Companies Import/Export Sample Implementation

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [API v2 - Notes Endpoints](#api-v2---notes-endpoints)
3. [API v1 - Companies Pattern Analysis](#api-v1---companies-pattern-analysis)
4. [Sample Implementation Architecture](#sample-implementation-architecture)
5. [Key Findings & Differences](#key-findings--differences)
6. [Recommendations for Notes Tool](#recommendations-for-notes-tool)
7. [Technical Considerations](#technical-considerations)

---

## Executive Summary

### What We Found

**API v2 Notes** provides a modern, configuration-driven approach with:
- Dynamic field discovery via `/v2/notes/configurations` endpoint
- Support for multiple note types (simple, conversation, opportunity)
- Rich relationship management (customers, product links)
- Granular patch operations for updates

**API v1 Companies** (from sample implementation) uses:
- Hardcoded endpoints with custom fields as separate resources
- Domain-based matching for updates
- Separate custom field value endpoints (GET/PUT/DELETE per field)
- Simple REST operations (GET, POST, PATCH, DELETE)

**Sample Implementation** demonstrates:
- Robust batching system for large datasets (>50-100 records)
- Adaptive rate limiting with quota monitoring
- 3-row header format for Google Sheets
- Validation before import
- Configuration caching for performance

---

## API v2 - Notes Endpoints

### Base URL
```
https://api.productboard.com/v2
https://api.eu.productboard.com/v2  (EU datacenter)
```

### Authentication
```
Authorization: Bearer {API_TOKEN}
Content-Type: application/json
```

### Core Endpoints

#### 1. Configuration Discovery

**GET /v2/notes/configurations**
- **Purpose:** Discover available fields, note types, and validation rules
- **Response:** Configuration metadata for all note types (simple, conversation, opportunity)
- **Query Parameters:**
  - `type[]` (array) - Filter by note types (recommended format)
  - `type` (string) - Comma-separated types (legacy format)
- **Example:** `/v2/notes/configurations?type[]=simple&type[]=conversation`
- **Use Case:** Call this first to understand workspace configuration before creating/updating notes

**GET /v2/notes/configurations/{type}**
- **Purpose:** Get configuration for a specific note type
- **Path Parameters:** `type` (simple | conversation | opportunity)
- **Use Case:** Get detailed schema for a single note type

#### 2. Notes CRUD Operations

**POST /v2/notes**
- **Purpose:** Create a new note
- **Required Fields:**
  - `data.type` (simple | conversation) - Note type
  - `data.fields.name` - Note name (required)
- **Optional Fields:**
  - `data.fields.content` - Note content (string for simple, array for conversation)
  - `data.fields.tags` - Array of tags
  - `data.fields.owner` - Owner object with email or id
  - `data.fields.creator` - Creator object with email or id
  - `data.fields.source` - Source object (id, origin, url)
  - `data.relationships` - Array of relationships to create atomically
- **Note:** Opportunity notes cannot be created via API
- **Rate Limit:** 100 requests per minute
- **Response:** 201 with note reference (id, type, links)

**GET /v2/notes**
- **Purpose:** List all notes with filtering and pagination
- **Query Parameters:**
  - `pageCursor` - Pagination cursor
  - `archived` (boolean) - Filter by archived status
  - `processed` (boolean) - Filter by processed status
  - `owner[id]` - Filter by owner UUID
  - `owner[email]` - Filter by owner email
  - `creator[id]` - Filter by creator UUID
  - `creator[email]` - Filter by creator email
  - `source[recordId]` - Filter by external source record ID
  - `createdFrom` - ISO-8601 date-time (inclusive)
  - `createdTo` - ISO-8601 date-time (inclusive)
  - `updatedFrom` - ISO-8601 date-time (inclusive)
  - `updatedTo` - ISO-8601 date-time (inclusive)
  - `fields` - Specify which fields to return (default: all non-null)
- **Filtering Rules:**
  - No parameters = All notes
  - `archived=true, processed=true` = None (archived notes always return processed=false)
  - `archived=true, processed=false` = Archived
  - `archived=false, processed=true` = Processed
  - `archived=false, processed=false` = Unprocessed
- **Response:** Paginated list with cursor for next page
- **Sorting:** By creation date, newest first

**GET /v2/notes/{id}**
- **Purpose:** Retrieve a single note by UUID
- **Path Parameters:** `id` (UUID)
- **Query Parameters:** `fields` - Specify which fields to return
- **Response:** Full note object with all fields and relationships
- **Use Case:** Get complete note details for display or editing

**PATCH /v2/notes/{id}**
- **Purpose:** Update an existing note
- **Methods:**
  1. **Field Updates** - Replace entire field values via `data.fields`
  2. **Patch Operations** - Granular updates via `data.patch` array
- **Patch Operations:**
  - `set` - Set field value (all fields)
  - `clear` - Reset to default (owner, tags)
  - `addItems` - Add to array (tags, conversation content)
  - `removeItems` - Remove from array (tags, conversation content)
- **Known Limitations:**
  - Cannot update content if note has linked features (422 error)
  - Unarchiving (`archived: false`) automatically sets `processed: true`
- **Example Patch:**
  ```json
  {
    "data": {
      "patch": [
        { "op": "set", "path": "owner", "value": { "email": "john@example.com" } },
        { "op": "addItems", "path": "tags", "value": [{ "name": "urgent" }] }
      ]
    }
  }
  ```

**DELETE /v2/notes/{id}**
- **Purpose:** Delete a note
- **Response:** 204 No Content
- **Use Case:** Remove notes that are no longer needed

#### 3. Relationship Management

**GET /v2/notes/{id}/relationships**
- **Purpose:** Retrieve all relationships for a note
- **Returns:**
  - Customer relationships (User or Company) - **one maximum**
  - Product link relationships (features, initiatives, etc.) - **multiple allowed**
- **Customer Rules:**
  - If note has User with Company → returns User only
  - If note has User without Company → returns User
  - If note has Company → returns Company
  - One customer maximum per note
- **Query Parameters:**
  - `pageCursor` - Pagination cursor
  - `limit` - Max relationships per page

**POST /v2/notes/{id}/relationships**
- **Purpose:** Create a new relationship
- **Request Body:**
  ```json
  {
    "data": {
      "type": "customer",  // or "link"
      "target": {
        "id": "uuid",
        "type": "user"  // or "company", "feature", etc.
      }
    }
  }
  ```
- **Behavior:** Customer relationships replace existing ones
- **Response:** 201 with created relationship

**PUT /v2/notes/{id}/relationships/customer**
- **Purpose:** Set or replace customer relationship
- **Behavior:** Replaces existing customer relationship
- **Use Case:** Update customer attribution

**PATCH /v2/notes/{id}/relationships/customer**
- **Purpose:** Patch customer relationship
- **operationId:** patchNoteCustomerRelationship

**DELETE /v2/notes/{id}/relationships/{targetType}/{targetId}**
- **Purpose:** Delete a specific relationship
- **Path Parameters:**
  - `targetType` - Type of relationship (customer, link)
  - `targetId` - UUID of target entity
- **Use Case:** Remove customer or product link associations

### Note Types

#### Simple Notes
- **Purpose:** Plain, unstructured feedback
- **Key Fields:**
  - `name` (required) - Note title
  - `content` (string) - HTML or plain text content
  - `tags` (array) - Tag objects with `name` property
  - `owner`, `creator` - User references
  - `source` - External source tracking
  - `processed` (boolean) - Processing status
  - `archived` (boolean) - Archive status

#### Conversation Notes
- **Purpose:** Structured messages from chat, email, support systems
- **Key Fields:**
  - `name` (required) - Conversation title
  - `content` (array) - Array of conversation parts:
    - `externalId` - External message ID
    - `content` - Message text
    - `authorName` - Author name
    - `authorType` - "agent" or "customer"
    - `timestamp` - ISO-8601 date-time
  - `tags`, `owner`, `creator`, `source` - Same as simple notes
- **Patch Operations:** Supports `addItems`/`removeItems` on content array

#### Opportunity Notes
- **Purpose:** Sales opportunities (from integrations)
- **Key Fields:**
  - `name` (required) - Opportunity name
  - `content` (array) - Custom field values:
    - `id` - Field UUID
    - `name` - Field name
    - `value` - Field value (string)
    - `fieldType` - "string" or "number"
  - `tags`, `owner`, `creator` - Same as simple notes
- **Note:** Cannot be created via API (read-only from integrations)

### Field Selection

**Default Behavior:**
- Returns all non-null fields

**Optimized Queries:**
- `fields=name,tags` - Return only specific fields
- `fields=all` - Include all fields, even null values

### Rate Limits

- **Default:** 50 requests per second
- **POST /v2/notes:** 100 requests per minute
- **Headers:**
  - `X-RateLimit-Limit` - Total requests allowed
  - `X-RateLimit-Remaining` - Requests remaining
  - `Retry-After` - Seconds to wait (on 429 response)

### Error Responses

- `400` - Bad Request (invalid parameters)
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found (note doesn't exist)
- `408` - Request Timeout
- `422` - Unprocessable Entity (validation errors, e.g., updating linked content)
- `429` - Too Many Requests (rate limit exceeded)
- `500` - Internal Server Error

### OAuth2 Scopes

- `notes:read` - Read access to notes
- `notes:write` - Create and modify notes
- `notes:delete` - Delete notes

---

## API v1 - Companies Pattern Analysis

Based on the sample implementation in [companiesMain.gs](Sample Implementation/companiesMain.gs:20-34), here's the v1 pattern:

### Base URL
```
https://api.productboard.com
https://api.eu.productboard.com  (EU datacenter)
```

### Authentication
```
Authorization: Bearer {API_TOKEN}
X-Version: 1
```

### Companies Endpoints (v1 Pattern)

```javascript
const PB_COMPANIES = {
  VERSION: '1',
  LIST_COMPANIES: '/companies',
  GET_COMPANY: '/companies/{id}',
  CREATE_COMPANY: '/companies',
  UPDATE_COMPANY: '/companies/{id}',
  DELETE_COMPANY: '/companies/{id}',
  LIST_CUSTOM_FIELDS: '/companies/custom-fields',
  CREATE_CUSTOM_FIELD: '/companies/custom-fields',
  GET_CUSTOM_FIELD: '/companies/custom-fields/{id}',
  UPDATE_CUSTOM_FIELD: '/companies/custom-fields/{id}',
  DELETE_CUSTOM_FIELD: '/companies/custom-fields/{id}',
  GET_CUSTOM_FIELD_VALUE: '/companies/{companyId}/custom-fields/{fieldId}/value',
  SET_CUSTOM_FIELD_VALUE: '/companies/{companyId}/custom-fields/{fieldId}/value',
  DELETE_CUSTOM_FIELD_VALUE: '/companies/{companyId}/custom-fields/{fieldId}/value'
};
```

### Key Patterns

#### 1. Base Entity Operations
- **GET /companies** - List with pagination (`pageOffset`, `pageLimit`)
- **GET /companies/{id}** - Get single company
- **POST /companies** - Create new company
- **PATCH /companies/{id}** - Update company
- **DELETE /companies/{id}** - Delete company

#### 2. Custom Fields (Separate Resources)
- **GET /companies/custom-fields** - List field definitions
- **POST /companies/custom-fields** - Create field definition
- **GET /companies/custom-fields/{id}** - Get field definition
- **PATCH /companies/custom-fields/{id}** - Update field definition
- **DELETE /companies/custom-fields/{id}** - Delete field definition

#### 3. Custom Field Values (Nested Operations)
- **GET /companies/{companyId}/custom-fields/{fieldId}/value** - Get value
- **PUT /companies/{companyId}/custom-fields/{fieldId}/value** - Set value
- **DELETE /companies/{companyId}/custom-fields/{fieldId}/value** - Clear value

#### 4. Immutable Fields (v1 Constraints)
- **domain** - Cannot be updated after creation (used as unique identifier)
- **sourceOrigin, sourceRecordId** - Can only be set during creation

### V1 Response Format
```json
{
  "data": [...],
  "pagination": {
    "total": 150,
    "offset": 0,
    "limit": 100
  }
}
```

---

## Sample Implementation Architecture

### Overview

The sample tool in [Sample Implementation/](Sample Implementation/) is a Google Apps Script for bidirectional company sync between Productboard and Google Sheets.

### File Structure

1. **[companiesMain.gs](Sample Implementation/companiesMain.gs)** (~537 lines)
   - API authentication and configuration
   - Rate limiting with adaptive throttling
   - HTTP helpers and retry logic
   - Settings management (API token, workspace, datacenter)
   - Shared utilities

2. **[companiesExporter.gs](Sample Implementation/companiesExporter.gs)** (~411 lines)
   - Export workflow orchestration
   - Company and custom field fetching
   - Data transformation (API → Sheet format)
   - Batch export for large datasets (>100 companies)

3. **[companiesImporter.gs](Sample Implementation/companiesImporter.gs)** (~1009 lines)
   - Import workflow orchestration
   - Validation (dry-run)
   - Domain-based matching
   - Company create/update operations
   - Custom field import
   - Batch import for large datasets (>50 companies)

4. **[companiesSidebar.gs](Sample Implementation/companiesSidebar.gs)** (~235 lines)
   - UI bridge between HTML sidebar and backend
   - Action dispatcher for button clicks
   - Snapshot data provider for UI
   - Batch operation triggers

5. **[companiesBatchQueue.gs](Sample Implementation/companiesBatchQueue.gs)** (~289 lines)
   - Batch processing queue system
   - Job management (create, process, complete)
   - Progress tracking
   - Timeout prevention (Google Apps Script 360s limit)

6. **[companiesErrorHandling.gs](Sample Implementation/companiesErrorHandling.gs)** (~300 lines)
   - Centralized error handling
   - API error parsing and formatting
   - User-friendly error messages
   - Run Log integration

### Key Design Patterns

#### 1. Three-Row Header Format

```
Row 1 (Machine keys):    pb_id | domain | name | custom__<uuid1> | custom__<uuid2>
Row 2 (Human labels):    PB Company ID | Company Domain | Company Name | Field Label | Field Label
Row 3 (Field types):     id | text * | text * | number | text
                                 ↑ asterisk = required field
```

**Benefits:**
- Machine-readable keys for code
- Human-readable labels for users
- Type information for validation
- Required field markers

#### 2. Domain-Based Matching

**Strategy:**
1. Build domain→ID cache from Productboard
2. For each sheet row:
   - If `domain` exists in PB → **UPDATE**
   - If `pb_id` exists but domain doesn't match → **UPDATE by ID, sync domain to sheet**
   - If neither → **CREATE**

**Rationale:**
- Domain is immutable in v1 API (can't be changed after creation)
- Domain is unique identifier for companies
- Fallback to `pb_id` handles edge cases

#### 3. Batching System

**Problem:** Google Apps Script has 360-second execution limit

**Solution:** Automatic job queue for large datasets

**Thresholds:**
- **Import:** >50 companies → batch (50 per chunk)
- **Export:** >100 companies → batch (100 per chunk)

**Flow:**
```
1. Main function detects dataset size
2. If > threshold → create batch jobs in Script Properties
3. Return { batchStarted: true } to UI
4. UI polls every 2 seconds to process next job
5. Each job processes one chunk
6. Continue until all jobs complete
```

**Storage:** Jobs stored in Script Properties as JSON

#### 4. Rate Limiting (Adaptive Throttling)

**Algorithm:**
```javascript
Base delay: 20ms (allows 50 req/sec)

If remaining < 20:
  delay = minDelay * 2 (40ms)

If remaining < 10:
  delay = max(100ms, minDelay * 5) (100ms)

On 429 response:
  respect Retry-After header

On error:
  exponential backoff: 250ms → 500ms → 1s → 2s → 4s → 8s
  max 6 retries
```

**Rate Limit Tracking:**
- Monitors `X-RateLimit-Remaining` header
- Logs warnings when approaching limit
- Automatically adjusts request pacing

#### 5. Configuration Caching

**Cache Strategy:**
- Custom field definitions cached for 6 hours (21600 seconds)
- Stored in Cache Service with TTL
- Force refresh option available

**Benefits:**
- Reduces API calls
- Faster operations
- Lower rate limit consumption

#### 6. Validation Before Import

**Validation Checks:**
- Required fields present (name, domain)
- No duplicate domains within sheet
- Data type validation (text vs number)
- Text field length (max 1024 characters)
- UUID format validation for pb_id

**Output:** Detailed error log in "Run Log" sheet

#### 7. Empty Field Control

**Checkbox Option:** "Clear empty custom field values"

**Behavior:**
- **Unchecked (default):** Empty cells ignored, existing PB values preserved
- **Checked:** Empty cells trigger DELETE calls, clearing PB values

**Use Cases:**
- Partial updates without affecting other fields
- Batch cleanup of multiple field values

### Constants & Configuration

```javascript
// Sheet Configuration
const HEADER_ROWS = 3;
const COMPANIES_SHEET = '🏢 Companies';
const RUN_LOG_SHEET = '🧾 Run Log';

// Caching
const CONFIG_CACHE_TTL = 21600;  // 6 hours

// Rate Limiting
const RATE_LIMITER = {
  minDelay: 20,    // 20ms = 50 req/sec
  limit: 50        // Default limit
};

// Batching
const BATCH_THRESHOLD = 50;   // Import threshold
const CHUNK_SIZE = 50;        // Import chunk size
// Export uses 100 for both

// Validation
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
```

### Data Flow

#### Export Flow
```
1. Fetch custom field definitions (cached 6 hours)
2. Check dataset size → batch if >100 companies
3. Fetch all companies (pagination)
4. Fetch custom field values (parallel batch)
5. Transform to sheet format
6. Write to sheet (3-row headers + data)
```

#### Import Flow
```
1. Run validation (dry-run) → check all rules
2. Check dataset size → batch if >50 companies
3. Build domain→ID cache from PB
4. For each row:
   a. Match by domain or pb_id
   b. CREATE or UPDATE company
   c. Set base fields
5. Import custom field values (second pass)
6. Log results to Run Log sheet
```

### Error Handling

**Centralized Error Handler:**
```javascript
function handleApiError_(err, context) {
  // Parse error message
  // Extract status code
  // Format user-friendly message
  // Log to Run Log sheet
  // Return structured error object
}
```

**Retry Logic:**
- Exponential backoff on transient errors
- Respect Retry-After on 429
- Max 6 retries
- Configurable per operation

### UI Components

**Sidebar Sections:**
1. **Export** - Button to export companies from PB
2. **Validate** - Dry-run validation before import
3. **Import** - Import companies to PB with options
4. **Settings** - API token, workspace name, datacenter, clear cache
5. **Batch Progress** - Real-time progress bar and status

**Status Updates:**
- Real-time progress via `BatchQueue_setSubProgress()`
- Success/error messages
- Batch job tracking

---

## Key Findings & Differences

### API v2 vs v1 Comparison

| Feature | v2 (Notes) | v1 (Companies) |
|---------|-----------|----------------|
| **Configuration Discovery** | ✅ `/v2/notes/configurations` | ❌ No dynamic discovery |
| **Field Definitions** | Dynamic from config | Hardcoded in code |
| **Custom Fields** | Embedded in note fields | Separate value endpoints |
| **Relationships** | Built-in relationship endpoints | Not applicable |
| **Patch Operations** | Granular (set, clear, addItems, removeItems) | Simple PATCH |
| **Field Selection** | `fields` query parameter | Not shown in v1 |
| **Rate Limits** | Header-based tracking | Header-based tracking |
| **Date Filtering** | `createdFrom/To`, `updatedFrom/To` | Not shown in v1 |
| **Pagination** | Cursor-based (`pageCursor`) | Offset-based (`pageOffset`, `pageLimit`) |
| **Source Tracking** | `fields.source` object | `sourceOrigin`, `sourceRecordId` fields |
| **Immutable Fields** | Varies by field | `domain`, `sourceOrigin`, `sourceRecordId` |

### V2 Advantages

1. **Configuration-Driven:**
   - No need to hardcode field definitions
   - Automatically adapts to workspace changes
   - Single source of truth from API

2. **Relationships:**
   - Native support for customer and product links
   - Can create relationships atomically with notes
   - Dedicated endpoints for relationship management

3. **Granular Updates:**
   - Patch operations for incremental changes
   - Array operations (add/remove items)
   - Field-level control

4. **Better Filtering:**
   - Rich query parameters (archived, processed, owner, creator, source)
   - Date range filtering
   - Multiple filter combinations

5. **Field Flexibility:**
   - Request only needed fields
   - Include null values when needed
   - Optimize bandwidth

### V1 Patterns to Consider

1. **Custom Field Separation:**
   - v1 treats custom fields as separate resources
   - Requires multiple API calls per entity (GET/PUT/DELETE per field)
   - More complex but more explicit

2. **Domain as Identifier:**
   - Immutable domain field for matching
   - Simple update logic (match by domain)
   - Good pattern for entities with unique identifiers

3. **Offset Pagination:**
   - Allows total count calculation
   - Easier to batch process
   - Can jump to specific pages

---

## Recommendations for Notes Tool

Based on the analysis, here are recommendations for building a Notes import/export tool:

### 1. Use V2 API with Configuration Discovery

**Approach:**
```javascript
// Step 1: Fetch configurations
const configs = await fetch('/v2/notes/configurations?type[]=simple&type[]=conversation');

// Step 2: Build dynamic headers
configs.data.forEach(config => {
  config.fields.forEach(field => {
    // Add to header structure
  });
});

// Step 3: Use configurations for validation
// No need to hardcode field definitions
```

**Benefits:**
- Automatically supports new fields
- Adapts to workspace configuration changes
- Single source of truth

### 2. Hybrid Matching Strategy

Since Notes don't have a `domain` field like Companies, use:

**Primary Key:** `source.recordId` (if syncing from external system)
**Fallback:** Note ID (`pb_id` in sheet)

**Logic:**
```javascript
// For imports:
if (row.sourceRecordId) {
  // Search by source[recordId] query parameter
  const existing = await fetch(`/v2/notes?source[recordId]=${row.sourceRecordId}`);
  if (existing.data.length > 0) {
    // UPDATE via PATCH /v2/notes/{id}
  } else {
    // CREATE via POST /v2/notes
  }
} else if (row.pb_id) {
  // UPDATE via PATCH /v2/notes/{id}
} else {
  // CREATE via POST /v2/notes
}
```

### 3. Sheet Structure

**Three-Row Header (Same Pattern):**
```
Row 1: pb_id | type | name | content | tags | owner_email | source_origin | source_recordId | ...
Row 2: PB Note ID | Note Type | Name * | Content | Tags | Owner Email | Source Origin | Source Record ID | ...
Row 3: id | select | text * | text | array | email | text | text | ...
```

**Note Type Handling:**
- Add a `type` column (simple | conversation | opportunity)
- Use dropdown validation for type selection
- Filter configuration fields by type

### 4. Relationships Management

**Option A: Separate Relationships Sheet**
```
Sheet: 🔗 Note Relationships
Columns: note_id | relationship_type | target_id | target_type

Example:
note-123 | customer | user-456 | user
note-123 | link | feat-789 | feature
```

**Option B: Inline Columns (Simpler)**
```
Columns: customer_id | customer_type | feature_ids (comma-separated)

Example:
user-456 | user | feat-789,feat-101
```

**Recommendation:** Start with Option B (inline) for simplicity, add Option A if needed for complex use cases.

### 5. Batching & Performance

**Thresholds (Similar to Companies):**
- **Import:** >50 notes → batch (50 per chunk)
- **Export:** >100 notes → batch (100 per chunk)

**Optimization:**
- Use `fields` parameter to request only needed fields
- Cache configurations (6 hours)
- Parallel requests where possible (fetching relationships)

### 6. Note Type Specific Handling

**Simple Notes:**
- Single `content` string field
- Straightforward import/export

**Conversation Notes:**
- Content is array of parts
- Handle `addItems`/`removeItems` for updates
- Track `externalId` for message matching

**Opportunity Notes:**
- Read-only (cannot create via API)
- Export only
- Custom field array format

### 7. Validation Rules

**Pre-Import Validation:**
```javascript
// Required fields
- name (all types)
- type (simple | conversation | opportunity)

// Type-specific validation
if (type === 'conversation') {
  // Validate content is array
  // Validate conversation parts have required fields
}

// Relationship validation
if (customer_id) {
  // Validate UUID format
  // Validate customer_type is 'user' or 'company'
}

// Source validation
if (source_origin && source_recordId) {
  // Both must be present together
  // Check for duplicates in sheet
}
```

### 8. Error Handling

**Same Patterns as Companies Tool:**
- Centralized error handler
- Parse API errors
- User-friendly messages
- Detailed logging to Run Log sheet
- Retry logic with exponential backoff

### 9. Rate Limiting

**Adaptive Throttling (Same as Companies):**
```javascript
const RATE_LIMITER = {
  minDelay: 20,     // 50 req/sec
  limit: 50,
  remaining: null
};

// Adjust based on X-RateLimit-Remaining
if (remaining < 20) delay = minDelay * 2;
if (remaining < 10) delay = 100;
```

**Special Consideration:**
- POST /v2/notes has rate limit of 100/minute (stricter than standard)
- Add extra throttling for note creation

### 10. Features to Implement

**Phase 1: Core Functionality**
- ✅ Export notes (all types) with basic fields
- ✅ Import simple notes (create/update)
- ✅ Validation before import
- ✅ Batching for large datasets
- ✅ Configuration caching

**Phase 2: Advanced Features**
- ✅ Import conversation notes
- ✅ Relationship management (customer, product links)
- ✅ Tag management
- ✅ Owner/creator assignment
- ✅ Source tracking

**Phase 3: Polish**
- ✅ Filtering (archived, processed, owner, date ranges)
- ✅ Partial field updates (patch operations)
- ✅ Conflict resolution UI
- ✅ Export to CSV option

---

## Technical Considerations

### 1. Google Apps Script Limitations

**Execution Time:**
- Max 360 seconds per execution
- Use batching for >50-100 records
- Store job queue in Script Properties

**Memory:**
- Limited memory for large datasets
- Process in chunks
- Don't load all data at once

**Rate Limits:**
- UrlFetchApp: 20,000 calls/day (free), 100,000/day (workspace)
- Cache Service: 10 MB total, items expire after 6 hours max

### 2. API Constraints

**V2 Notes Specific:**
- Cannot create opportunity notes
- Cannot update content if note has linked features (422 error)
- Unarchiving automatically sets processed=true
- Customer relationship: one per note (replaces on update)
- Product links: multiple allowed

**Rate Limits:**
- Default: 50 req/sec
- POST /v2/notes: 100 req/min
- Varies by Productboard plan

### 3. Data Consistency

**Challenges:**
- Notes can be updated in PB while import is running
- Sheet may have stale data

**Solutions:**
- Timestamp tracking (last export time)
- Conflict detection (compare updatedAt)
- User choice on conflicts (prefer sheet vs prefer PB)

### 4. Custom Field Handling

**V2 Approach (Predicted based on v1):**
- Likely embedded in note fields (not separate like v1)
- Use configuration endpoint to discover custom fields
- Validate against field schema before import

**V1 Pattern (Companies):**
- Separate custom field definition endpoints
- Separate value endpoints (GET/PUT/DELETE per field)
- Requires multiple API calls

**If V2 Notes follows v1 pattern:**
- May need similar implementation as Companies tool
- Batch fetch custom field values
- Handle empty values (clear vs preserve)

### 5. Pagination Strategy

**V2 (Cursor-based):**
```javascript
let cursor = null;
do {
  const url = `/v2/notes${cursor ? `?pageCursor=${cursor}` : ''}`;
  const response = await fetch(url);
  notes.push(...response.data);
  cursor = response.links?.next;
} while (cursor);
```

**V1 (Offset-based):**
```javascript
let offset = 0;
const limit = 100;
do {
  const response = await fetch(`/companies?pageOffset=${offset}&pageLimit=${limit}`);
  companies.push(...response.data);
  offset += limit;
} while (response.data.length === limit);
```

### 6. Authentication & Security

**Storage:**
- API token in Script Properties (encrypted by Google)
- Never log full tokens (mask in logs)
- Clear cache on token change

**Validation:**
- Test token on first use
- Handle 401 errors gracefully
- Prompt user to re-enter token

### 7. Testing Strategy

**Unit Tests:**
- Test data transformation functions
- Test validation logic
- Test pagination logic

**Integration Tests:**
- Test with small dataset (10 notes)
- Test with medium dataset (100 notes)
- Test with large dataset (1000+ notes)
- Test error scenarios (invalid token, rate limits, API errors)

**User Acceptance:**
- Test all note types (simple, conversation, opportunity)
- Test all operations (export, validate, import)
- Test relationship management
- Test batching with large datasets

---

## Appendix: Code Snippets

### Configuration Discovery
```javascript
/**
 * Fetch note configurations from API v2
 * @param {Array<string>} types - Note types to fetch (default: all)
 * @returns {Array} Array of configuration objects
 */
async function fetchNoteConfigurations(types = ['simple', 'conversation', 'opportunity']) {
  const typeParams = types.map(t => `type[]=${t}`).join('&');
  const url = `/v2/notes/configurations?${typeParams}`;
  const response = await pbFetch('get', url);
  return response.data;
}
```

### Note Creation
```javascript
/**
 * Create a simple note
 * @param {object} noteData - Note data from sheet
 * @returns {object} Created note reference
 */
async function createNote(noteData) {
  const payload = {
    data: {
      type: noteData.type || 'simple',
      fields: {
        name: noteData.name,
        content: noteData.content || '',
        tags: noteData.tags ? noteData.tags.split(',').map(t => ({ name: t.trim() })) : [],
        owner: noteData.owner_email ? { email: noteData.owner_email } : undefined,
        source: noteData.source_origin && noteData.source_recordId ? {
          origin: noteData.source_origin,
          recordId: noteData.source_recordId,
          url: noteData.source_url || undefined
        } : undefined
      },
      relationships: buildRelationships(noteData)
    }
  };

  const response = await pbFetch('post', '/v2/notes', payload);
  return response.data;
}

function buildRelationships(noteData) {
  const relationships = [];

  if (noteData.customer_id && noteData.customer_type) {
    relationships.push({
      type: 'customer',
      target: {
        id: noteData.customer_id,
        type: noteData.customer_type
      }
    });
  }

  if (noteData.feature_ids) {
    const featureIds = noteData.feature_ids.split(',');
    featureIds.forEach(id => {
      relationships.push({
        type: 'link',
        target: {
          id: id.trim(),
          type: 'link'
        }
      });
    });
  }

  return relationships;
}
```

### Batch Export
```javascript
/**
 * Export notes with batching for large datasets
 */
async function exportNotes() {
  // 1. Check dataset size
  const sizeCheck = await pbFetch('get', '/v2/notes?limit=1');
  // Note: v2 may not provide total count, need to paginate

  // 2. Fetch all notes with pagination
  const notes = [];
  let cursor = null;
  let count = 0;

  do {
    const url = `/v2/notes${cursor ? `?pageCursor=${cursor}` : '?fields=all'}`;
    const response = await pbFetch('get', url);
    notes.push(...response.data);
    cursor = response.links?.next?.split('pageCursor=')[1];
    count += response.data.length;

    // Batch processing if >100 notes
    if (count > 100 && count % 100 === 0) {
      // Write batch to sheet
      await writeBatchToSheet(notes.slice(-100));
      Logger.log(`Exported ${count} notes so far...`);
    }
  } while (cursor);

  // Write remaining notes
  if (notes.length % 100 !== 0) {
    await writeBatchToSheet(notes.slice(-(notes.length % 100)));
  }

  Logger.log(`Export complete: ${notes.length} notes`);
}
```

---

## Conclusion

The Productboard API v2 for Notes provides a modern, configuration-driven approach that is significantly more flexible than v1. The sample Companies implementation demonstrates robust patterns for:

1. **Batching** - Handle large datasets without timeouts
2. **Rate Limiting** - Adaptive throttling to respect API limits
3. **Validation** - Catch errors before making API calls
4. **Error Handling** - User-friendly messages and detailed logging
5. **Configuration Caching** - Reduce API calls and improve performance

A Notes tool should leverage v2's configuration discovery, relationship management, and granular patch operations while adopting the proven patterns from the Companies tool for batching, rate limiting, and user experience.

### Next Steps

1. **Design sheet structure** - Define 3-row headers for notes
2. **Implement configuration discovery** - Fetch and cache note configurations
3. **Build export workflow** - Fetch notes with pagination, transform to sheet format
4. **Build import workflow** - Validate, match by source.recordId or pb_id, create/update
5. **Add relationship management** - Handle customer and product link relationships
6. **Implement batching** - Queue system for large datasets
7. **Test thoroughly** - All note types, error cases, large datasets

---

**Document Version:** 1.0
**Last Updated:** February 7, 2026
**Author:** AI Analysis based on API documentation and sample implementation
