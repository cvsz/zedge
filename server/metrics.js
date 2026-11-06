/** Prometheus-compatible metrics for Zedge console.
 * All counters/gauges are in-memory and reset on restart.
 * No personal data, credentials, or tokens are ever recorded in metric labels.
 *
 * Metrics are created per app instance (createMetrics()) so that tests that boot()
 * several apps do not share counters (X4). Each app owns its own state.
 */

const BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]; // ms

export function createMetrics() {
  let requestCount = 0;
  let errorCount = 0;
  const statusCounts = {};
  let cfCallCount = 0;
  let cfErrorCount = 0;
  let loginFailureCount = 0;
  let rateLimitCount = 0;
  const latencyBuckets = {};
  BUCKETS.forEach((b) => { latencyBuckets[b] = 0; });
  let latencyCount = 0;
  let latencySum = 0;

  const startTime = Date.now();

  /** Record one finished HTTP request. latencyBuckets[b] already holds the
   * cumulative count of observations with latencyMs <= b, so getMetrics() must
   * not cumulate it again (X1). */
  function recordMetric(statusCode, latencyMs) {
    requestCount++;
    if (statusCode >= 400) { errorCount++; }
    statusCounts[statusCode] = (statusCounts[statusCode] || 0) + 1;

    latencyCount++;
    latencySum += latencyMs;
    for (const b of BUCKETS) {
      if (latencyMs <= b) { latencyBuckets[b]++; }
    }
  }

  function recordCfCall(success) {
    cfCallCount++;
    if (!success) { cfErrorCount++; }
  }

  function recordLoginFailure() {
    loginFailureCount++;
  }

  /** Count only requests that were actually rate-limited (HTTP 429). */
  function recordRateLimit() {
    rateLimitCount++;
  }

  function getMetrics(store) {
    const users = store ? store.listUsers().length : 0;
    const auditCount = store && typeof store.auditCount === 'function' ? store.auditCount() : 0;

    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

    // Latency histogram (cumulative LE buckets). latencyBuckets[b] is already
    // cumulative from recordMetric(); do not re-cumulate here (X1).
    const latencyLines = [];
    for (const b of BUCKETS) {
      latencyLines.push(`zedge_http_request_duration_seconds_bucket{le="${b / 1000}"} ${latencyBuckets[b]}`);
    }
    latencyLines.push(`zedge_http_request_duration_seconds_bucket{le="+Inf"} ${latencyCount}`);
    latencyLines.push(`zedge_http_request_duration_seconds_count ${latencyCount}`);
    latencyLines.push(`zedge_http_request_duration_seconds_sum ${latencySum / 1000}`);

    const lines = [
      '# HELP zedge_http_requests_total Total HTTP requests received',
      '# TYPE zedge_http_requests_total counter',
      `zedge_http_requests_total ${requestCount}`,
      '# HELP zedge_http_errors_total Total HTTP error responses (>= 400)',
      '# TYPE zedge_http_errors_total counter',
      `zedge_http_errors_total ${errorCount}`,
      '# HELP zedge_http_request_duration_seconds HTTP request latency histogram (seconds)',
      '# TYPE zedge_http_request_duration_seconds histogram',
      ...latencyLines,
      '# HELP zedge_cloudflare_calls_total Total Cloudflare API calls',
      '# TYPE zedge_cloudflare_calls_total counter',
      `zedge_cloudflare_calls_total ${cfCallCount}`,
      '# HELP zedge_cloudflare_errors_total Total Cloudflare API errors',
      '# TYPE zedge_cloudflare_errors_total counter',
      `zedge_cloudflare_errors_total ${cfErrorCount}`,
      '# HELP zedge_login_failures_total Total failed login attempts',
      '# TYPE zedge_login_failures_total counter',
      `zedge_login_failures_total ${loginFailureCount}`,
      '# HELP zedge_rate_limited_total Total requests rate-limited (HTTP 429)',
      '# TYPE zedge_rate_limited_total counter',
      `zedge_rate_limited_total ${rateLimitCount}`,
      '# HELP zedge_users_total Total number of registered users',
      '# TYPE zedge_users_total gauge',
      `zedge_users_total ${users}`,
      '# HELP zedge_audit_logs_total Total number of audit log entries',
      '# TYPE zedge_audit_logs_total gauge',
      `zedge_audit_logs_total ${auditCount}`,
      '# HELP zedge_uptime_seconds Uptime in seconds',
      '# TYPE zedge_uptime_seconds gauge',
      `zedge_uptime_seconds ${uptimeSeconds}`,
      '# HELP zedge_http_responses_by_status HTTP responses by status code',
      '# TYPE zedge_http_responses_by_status counter',
    ];

    for (const [code, count] of Object.entries(statusCounts)) {
      lines.push(`zedge_http_responses_by_status{status="${code}"} ${count}`);
    }

    return lines.join('\n') + '\n';
  }

  return { recordMetric, recordCfCall, recordLoginFailure, recordRateLimit, getMetrics };
}
