/** =========================
 *  Batch Queue Management
 *
 *  Handles batching of long-running operations (sheet setup, export, import)
 *  to avoid 360s timeout limits. Each job runs in a separate execution,
 *  coordinated via Script Properties.
 * ========================= */

/**
 * Creates a new batch queue with the given jobs
 * @param {Array<Object>} jobs - Array of job objects with { type, ...params }
 * @param {string} batchType - Type of batch (e.g., 'export-companies', 'import-companies')
 * @returns {Object} The created queue object
 */
function BatchQueue_create(jobs, batchType) {
  const props = PropertiesService.getScriptProperties();

  const queue = {
    batchType: batchType || 'unknown',
    jobs: jobs.map((j, i) => ({
      id: i,
      ...j,
      status: 'pending',
      startedAt: null,
      completedAt: null,
      result: null
    })),
    currentIndex: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    completedCount: 0,
    failedCount: 0,
    totalJobs: jobs.length,
    totalErrors: 0,
    totalWarnings: 0,
    totalDeleted: 0,  // For delete operations
    totalCreated: 0,  // For import operations
    totalUpdated: 0   // For import operations
  };

  props.setProperty('BATCH_QUEUE', JSON.stringify(queue));
  Logger.log(`Created batch queue: ${batchType} with ${jobs.length} jobs`);
  return queue;
}

/**
 * Gets the current queue status
 * @returns {Object|null} The queue object or null if no queue exists
 */
function BatchQueue_getStatus() {
  const props = PropertiesService.getScriptProperties();
  const json = props.getProperty('BATCH_QUEUE');
  return json ? JSON.parse(json) : null;
}

/**
 * Marks a job as complete (success or failure)
 * @param {number} jobId - The job ID to mark complete
 * @param {Object} result - Result object { success: boolean, message: string, error?: string, details?: Object }
 * @returns {Object|null} Updated queue object
 */
function BatchQueue_markComplete(jobId, result) {
  const queue = BatchQueue_getStatus();
  if (!queue) return null;

  const job = queue.jobs.find(j => j.id === jobId);
  if (!job) {
    Logger.log(`Warning: Job ${jobId} not found in queue`);
    return queue;
  }

  job.status = result.error ? 'failed' : 'completed';
  job.completedAt = new Date().toISOString();
  job.result = result;

  if (result.error) {
    queue.failedCount++;
  } else {
    queue.completedCount++;
  }

  // Accumulate errors, warnings, and operation counts from job details
  if (result.details) {
    const errors = result.details.errors || 0;
    const warnings = result.details.warnings || 0;
    const deleted = result.details.deleted || 0;
    const created = result.details.created || 0;
    const updated = result.details.updated || 0;

    queue.totalErrors = (queue.totalErrors || 0) + errors;
    queue.totalWarnings = (queue.totalWarnings || 0) + warnings;
    queue.totalDeleted = (queue.totalDeleted || 0) + deleted;
    queue.totalCreated = (queue.totalCreated || 0) + created;
    queue.totalUpdated = (queue.totalUpdated || 0) + updated;

    Logger.log(`Job ${jobId} results: ${deleted} deleted, ${created} created, ${updated} updated, ${errors} errors, ${warnings} warnings`);
    Logger.log(`Batch totals: ${queue.totalDeleted} deleted, ${queue.totalCreated} created, ${queue.totalUpdated} updated, ${queue.totalErrors} errors, ${queue.totalWarnings} warnings`);
  }

  queue.currentIndex++;

  // Check if all jobs are done
  const allDone = queue.jobs.every(j => j.status === 'completed' || j.status === 'failed');
  if (allDone) {
    queue.completedAt = new Date().toISOString();

    // Write final summary to Run Log based on batch type
    writeBatchSummaryToLog_(queue);
  }

  PropertiesService.getScriptProperties().setProperty('BATCH_QUEUE', JSON.stringify(queue));

  Logger.log(`Job ${jobId} marked as ${job.status}. Progress: ${queue.completedCount + queue.failedCount}/${queue.totalJobs}`);

  return queue;
}

/**
 * Gets the next pending job and marks it as running
 * @returns {Object|null} The next job to process, or null if no jobs remaining
 */
function BatchQueue_getNextJob() {
  const queue = BatchQueue_getStatus();
  if (!queue) return null;

  const nextJob = queue.jobs.find(j => j.status === 'pending');
  if (!nextJob) return null;

  nextJob.status = 'running';
  nextJob.startedAt = new Date().toISOString();

  PropertiesService.getScriptProperties().setProperty('BATCH_QUEUE', JSON.stringify(queue));

  Logger.log(`Started job ${nextJob.id}: ${nextJob.type}`);

  return nextJob;
}

/**
 * Clears the current batch queue
 */
function BatchQueue_clear() {
  PropertiesService.getScriptProperties().deleteProperty('BATCH_QUEUE');
  Logger.log('Batch queue cleared');
}

/**
 * Checks if there are more pending jobs in the queue
 * @returns {boolean} True if there are pending jobs
 */
function BatchQueue_hasMore() {
  const queue = BatchQueue_getStatus();
  if (!queue) return false;
  return queue.jobs.some(j => j.status === 'pending');
}

/**
 * Gets a summary of the queue for display
 * @returns {Object} Summary object with counts and progress info
 */
function BatchQueue_getSummary() {
  const queue = BatchQueue_getStatus();
  if (!queue) return null;

  const completed = queue.completedCount + queue.failedCount;
  const percent = queue.totalJobs > 0 ? Math.round((completed / queue.totalJobs) * 100) : 0;

  // Get sub-progress if available
  const subProgress = BatchQueue_getSubProgress();

  return {
    batchType: queue.batchType,
    total: queue.totalJobs,
    completed: completed,
    succeeded: queue.completedCount,
    failed: queue.failedCount,
    pending: queue.jobs.filter(j => j.status === 'pending').length,
    running: queue.jobs.filter(j => j.status === 'running').length,
    percent: percent,
    isComplete: completed === queue.totalJobs,
    startedAt: queue.startedAt,
    completedAt: queue.completedAt,
    subProgress: subProgress,
    totalErrors: queue.totalErrors || 0,
    totalWarnings: queue.totalWarnings || 0
  };
}

/**
 * Sets sub-progress for the current job (called by long-running operations)
 * @param {string} message - Progress message (e.g., "Fetching config...")
 * @param {number} percent - Progress percentage (0-100)
 */
function BatchQueue_setSubProgress(message, percent) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('BATCH_SUB_PROGRESS', JSON.stringify({
    message: message,
    percent: Math.round(percent),
    timestamp: new Date().toISOString()
  }));
}

/**
 * Gets the current sub-progress
 * @returns {Object|null} Sub-progress object or null
 */
function BatchQueue_getSubProgress() {
  const props = PropertiesService.getScriptProperties();
  const json = props.getProperty('BATCH_SUB_PROGRESS');
  return json ? JSON.parse(json) : null;
}

/**
 * Clears sub-progress (called when job completes)
 */
function BatchQueue_clearSubProgress() {
  PropertiesService.getScriptProperties().deleteProperty('BATCH_SUB_PROGRESS');
}

/**
 * Write batch summary to Run Log after all jobs complete
 * @param {Object} queue - The completed queue object
 */
function writeBatchSummaryToLog_(queue) {
  const batchType = queue.batchType;
  const totalJobs = queue.totalJobs;
  const totalErrors = queue.totalErrors || 0;
  const totalWarnings = queue.totalWarnings || 0;

  let summaryMessage = '';
  let details = '';

  if (batchType === 'delete-notes') {
    const totalDeleted = queue.totalDeleted || 0;
    summaryMessage = `Batch delete complete: ${totalDeleted} notes deleted over ${totalJobs} batch(es)`;
    details = `Success: ${totalDeleted}, Errors: ${totalErrors}, Warnings: ${totalWarnings}`;

  } else if (batchType === 'import-notes') {
    const totalCreated = queue.totalCreated || 0;
    const totalUpdated = queue.totalUpdated || 0;
    summaryMessage = `Batch import complete: ${totalCreated} created, ${totalUpdated} updated over ${totalJobs} batch(es)`;
    details = `Success: ${totalCreated + totalUpdated}, Errors: ${totalErrors}, Warnings: ${totalWarnings}`;

  } else if (batchType === 'export-notes') {
    summaryMessage = `Batch export complete: ${totalJobs} batch(es) processed`;
    details = `Errors: ${totalErrors}, Warnings: ${totalWarnings}`;

  } else {
    summaryMessage = `Batch ${batchType} complete: ${totalJobs} batch(es) processed`;
    details = `Errors: ${totalErrors}, Warnings: ${totalWarnings}`;
  }

  const status = totalErrors > 0 ? 'WARN' : 'SUCCESS';
  logToRunLog_('Notes', null, status, summaryMessage, details);
  Logger.log(`Batch summary logged: ${summaryMessage} | ${details}`);
}

/**
 * Processes the next job in the queue
 * This is called repeatedly by the sidebar polling mechanism
 * @returns {Object} Response object with job result and queue status
 */
function BatchQueue_processNext() {
  const nextJob = BatchQueue_getNextJob();

  if (!nextJob) {
    const queue = BatchQueue_getStatus();
    const summary = BatchQueue_getSummary();
    return {
      hasMore: false,
      completed: true,
      summary: summary,
      type: queue ? queue.batchType : 'unknown',
      success: queue ? queue.failedCount === 0 : true,
      message: queue
        ? `Batch complete: ${queue.completedCount} succeeded, ${queue.failedCount} failed.`
        : 'No active batch queue.'
    };
  }

  let result;

  try {
    // Route to appropriate handler based on job type
    switch (nextJob.type) {
      case 'setup-notes-sheet':
        SetupNotesSheet_(false);
        result = {
          success: true,
          message: `Notes sheet refreshed successfully.`
        };
        break;

      case 'export-notes':
        const exportResult = ExportNotes_({
          replaceData: nextJob.replaceData || false
        });
        result = {
          success: true,
          message: `Exported ${exportResult.fetched} notes (${exportResult.written} rows).`,
          details: exportResult
        };
        break;

      case 'validate-notes':
        const validateResult = ValidateNotes_();
        result = {
          success: validateResult.errors === 0,
          message: validateResult.summary,
          details: validateResult
        };
        break;

      case 'import-notes-chunk':
        const importResult = ImportNotesChunk_(
          nextJob.startRow,
          nextJob.endRow
        );
        result = {
          success: !importResult.errors || importResult.errors === 0,
          message: importResult.summary || `Import completed for rows ${nextJob.startRow}-${nextJob.endRow}.`,
          details: importResult
        };
        break;

      case 'export-notes-chunk':
        const exportChunkResult = ExportNotesChunk_(
          nextJob.pageCursor,
          nextJob.chunkIndex,
          nextJob.replaceData
        );
        result = {
          success: true,
          message: exportChunkResult.message || `Exported chunk ${nextJob.chunkIndex}.`,
          details: exportChunkResult
        };
        break;

      case 'delete-notes-chunk':
        const deleteResult = DeleteNotesChunk_(nextJob.notes);
        result = {
          success: !deleteResult.errors || deleteResult.errors === 0,
          message: deleteResult.summary || `Deleted chunk ${nextJob.chunkIndex}.`,
          details: deleteResult
        };
        break;

      default:
        throw new Error(`Unknown job type: ${nextJob.type}`);
    }

  } catch (err) {
    Logger.log(`Job ${nextJob.id} failed with error: ${err.message || String(err)}`);
    Logger.log(`Error stack: ${err.stack || 'No stack trace available'}`);
    result = {
      success: false,
      error: err.message || String(err),
      message: `Failed: ${err.message || String(err)}`
    };
  }

  // Mark job complete and get updated queue
  const queue = BatchQueue_markComplete(nextJob.id, result);
  const hasMore = BatchQueue_hasMore();

  // Clear sub-progress when job completes
  BatchQueue_clearSubProgress();

  return {
    hasMore: hasMore,
    completed: !hasMore,
    jobResult: result,
    summary: BatchQueue_getSummary(),
    message: result.message
  };
}
