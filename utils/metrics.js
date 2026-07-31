/**
 * In-process metrics for probes and basic alerting.
 * Prometheus text exposition at GET /api/metrics (no extra deps).
 */
const startedAt = Date.now();

const counters = {
  httpRequestsTotal: 0,
  httpResponses2xx: 0,
  httpResponses4xx: 0,
  httpResponses5xx: 0,
  httpByStatus: new Map(), // status -> count
};

export function recordHttpResponse(statusCode) {
  const code = Number(statusCode) || 0;
  counters.httpRequestsTotal += 1;
  if (code >= 500) counters.httpResponses5xx += 1;
  else if (code >= 400) counters.httpResponses4xx += 1;
  else if (code >= 200 && code < 400) counters.httpResponses2xx += 1;
  if (code > 0) {
    counters.httpByStatus.set(code, (counters.httpByStatus.get(code) || 0) + 1);
  }
}

export function getMetricsSnapshot() {
  const byStatus = {};
  for (const [k, v] of counters.httpByStatus.entries()) {
    byStatus[String(k)] = v;
  }
  return {
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    http_requests_total: counters.httpRequestsTotal,
    http_responses_2xx: counters.httpResponses2xx,
    http_responses_4xx: counters.httpResponses4xx,
    http_responses_5xx: counters.httpResponses5xx,
    http_by_status: byStatus,
    process_memory_rss_bytes: process.memoryUsage().rss,
    process_memory_heap_used_bytes: process.memoryUsage().heapUsed,
  };
}

/** Prometheus text format (subset). */
export function renderPrometheusMetrics({ mongoReady = false } = {}) {
  const s = getMetricsSnapshot();
  const lines = [
    '# HELP asli_up Process is running',
    '# TYPE asli_up gauge',
    'asli_up 1',
    '# HELP asli_mongo_ready MongoDB readyState===1',
    '# TYPE asli_mongo_ready gauge',
    `asli_mongo_ready ${mongoReady ? 1 : 0}`,
    '# HELP asli_http_requests_total Total HTTP responses observed',
    '# TYPE asli_http_requests_total counter',
    `asli_http_requests_total ${s.http_requests_total}`,
    '# HELP asli_http_responses_5xx_total HTTP 5xx responses',
    '# TYPE asli_http_responses_5xx_total counter',
    `asli_http_responses_5xx_total ${s.http_responses_5xx}`,
    '# HELP asli_http_responses_4xx_total HTTP 4xx responses',
    '# TYPE asli_http_responses_4xx_total counter',
    `asli_http_responses_4xx_total ${s.http_responses_4xx}`,
    '# HELP asli_http_responses_2xx_total HTTP 2xx/3xx responses',
    '# TYPE asli_http_responses_2xx_total counter',
    `asli_http_responses_2xx_total ${s.http_responses_2xx}`,
    '# HELP asli_process_resident_memory_bytes RSS',
    '# TYPE asli_process_resident_memory_bytes gauge',
    `asli_process_resident_memory_bytes ${s.process_memory_rss_bytes}`,
    '# HELP asli_process_heap_used_bytes Heap used',
    '# TYPE asli_process_heap_used_bytes gauge',
    `asli_process_heap_used_bytes ${s.process_memory_heap_used_bytes}`,
    '# HELP asli_process_uptime_seconds Process uptime',
    '# TYPE asli_process_uptime_seconds gauge',
    `asli_process_uptime_seconds ${s.uptimeSec}`,
  ];
  for (const [code, count] of Object.entries(s.http_by_status)) {
    lines.push(`asli_http_responses_by_status_total{code="${code}"} ${count}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Express middleware — count finished responses (skip OPTIONS). */
export function metricsMiddleware(req, res, next) {
  res.on('finish', () => {
    if (String(req.method || '').toUpperCase() === 'OPTIONS') return;
    recordHttpResponse(res.statusCode);
  });
  next();
}

/** Reset counters (tests only). */
export function resetMetricsForTests() {
  counters.httpRequestsTotal = 0;
  counters.httpResponses2xx = 0;
  counters.httpResponses4xx = 0;
  counters.httpResponses5xx = 0;
  counters.httpByStatus.clear();
}
