/** Prometheus-compatible metrics for Zedge console.
 * All counters/gauges are in-memory and reset on restart.
 * No personal data, credentials, or tokens are ever recorded in metric labels.
 */

const BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]; // ms

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

export function recordMetric(statusCode, latencyMs) {
  requestCount++;
  if (statusCode >= 400) {errorCount++;}
  statusCounts[statusCode] = (statusCounts[statusCode] || 0) + 1;

  // Latency histogram (bounded buckets)
  latencyCount++;
  latencySum += latencyMs;
  for (const b of BUCKETS) {
    if (latencyMs <= b) { latencyBuckets[b]++; }
  }
}

export function recordCfCall(success) {
  cfCallCount++;
  if (!success) { cfErrorCount++; }
}

export function recordLoginFailure() {
  loginFailureCount++;
}

export function recordRateLimit() {
  rateLimitCount++;
}

export function getMetrics(store) {
  const users = store ? store.listUsers().length : 0;
  let auditCount = 0;
  try {
    if (store && typeof store.auditTail === 'function') {
      auditCount = store.auditTail(10000).length;
    }
  } catch { /* ignore - auditTail may not exist */ }

  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

  // Build latency histogram lines (cumulative LE buckets)
  const latencyLines = [];
  let cumulative = 0;
  for (const b of BUCKETS) {
    cumulative += latencyBuckets[b];
    latencyLines.push(`zedge_http_request_duration_seconds_bucket{le="${b / 1000}"} ${cumulative}`);
  }
  cumulative += 0; // +Inf bucket = total count
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
    '# HELP zedge_rate_limited_total Total requests rate-limited',
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
  ];

  for (const [code, count] of Object.entries(statusCounts)) {
    lines.push(`zedge_http_responses_by_status{status="${code}"} ${count}`);
  }

  return lines.join('\n') + '\n';
}
