/**
 * Server-Sent Events helper.
 * Sets the correct headers and provides typed event emitters.
 */

/**
 * Start an SSE response.
 * @param {import('express').Response} res
 * @returns {{ progress, complete, error, done }}
 */
function startSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  return {
    /** Send a progress update */
    progress: (message, percent, detail = null) =>
      send('progress', { message, percent, detail }),

    /** Send a per-row log entry (streamed in real time during import) */
    log: (level, message, detail = null) =>
      send('log', { level, message, detail, ts: new Date().toISOString() }),

    /** Send completion event with result payload */
    complete: (data) => send('complete', { ...data }),

    /** Send an error event */
    error: (message, detail = null) => send('error', { message, detail }),

    /** End the SSE stream */
    done: () => res.end(),
  };
}

module.exports = { startSSE };
