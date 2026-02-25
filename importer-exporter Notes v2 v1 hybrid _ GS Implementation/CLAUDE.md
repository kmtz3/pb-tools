# Project Guidelines for Claude

This file contains important guidelines and constraints for working on this Google Sheets Add-on project that integrates with Productboard's API.

## Productboard API Guidelines

When working with Productboard API v2, always wrap request bodies in a `data` object. Search endpoints use a specific format — never guess payload structures. When a field should be removed, use the `delete` operation instead of setting the value to `null` (the API rejects null values). Always refer to existing working API calls in the codebase before constructing new ones.

## Google Apps Script Constraints

- Sidebar code runs synchronously — do NOT build frontend progress bars or async UI updates that depend on real-time backend communication. Use sheet-based logging (e.g., Run Log sheet) for progress tracking instead.
- Always use the retry-enabled API request function (not raw UrlFetchApp) for API calls that may fail.
- After editing .gs files, check for duplicate variable declarations and syntax errors before considering the task complete.

## Debugging & Fix Protocol

When fixing bugs: 1) Read the actual error logs the user provides before proposing a fix. 2) Identify the root cause, not just the surface symptom. 3) Do NOT revert to planning mode when implementation is requested. 4) When a fix doesn't work, re-examine assumptions rather than applying incremental patches to the same wrong approach.
