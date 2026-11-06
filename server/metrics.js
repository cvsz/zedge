import { readFileSync, statSync } from 'node:fs';

let requestCount = 0;
let errorCount = 0;
const statusCounts = {};

export function recordMetric(statusCode) {
  requestCount++;
  if (statusCode >= 400) {errorCount++;}
  statusCounts[statusCode] = (statusCounts[statusCode] || 0) + 1;
}

export function getMetrics(store) {
  const users = store ? store.listUsers().length : 0;
  let auditCount = 0;
  try {
    if (store && typeof store.auditTail === 'function') {
      auditCount = store.auditTail(10000).length;
    }
  } catch { /* ignore - auditTail may not exist */ }
  
  const lines = [
    '# HELP zedge_http_requests_total Total HTTP requests received',
    '# TYPE zedge_http_requests_total counter',
    `zedge_http_requests_total ${requestCount}`,
    '# HELP zedge_http_errors_total Total HTTP error responses (>= 400)',
    '# TYPE zedge_http_errors_total counter',
    `zedge_http_errors_total ${errorCount}`,
    '# HELP zedge_users_total Total number of registered users',
    '# TYPE zedge_users_total gauge',
    `zedge_users_total ${users}`,
    '# HELP zedge_audit_logs_total Total number of audit log entries',
    '# TYPE zedge_audit_logs_total gauge',
    `zedge_audit_logs_total ${auditCount}`
  ];

  for (const [code, count] of Object.entries(statusCounts)) {
    lines.push(`zedge_http_responses_by_status{status="${code}"} ${count}`);
  }

  return lines.join('\n') + '\n';
}
