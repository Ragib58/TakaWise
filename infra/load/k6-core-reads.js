/* global __ENV */
// k6 load test for the hottest reads (Phase 7): dashboard, transaction list
// (with filters), cash-flow and category reports. Target: p95 < 500 ms.
//
//   docker run --rm -i -e API=http://host.docker.internal:4000/api/v1 \
//     -e EMAIL=loadtest@takawise.local -e PASSWORD="load test passphrase 2026" \
//     grafana/k6 run - < infra/load/k6-core-reads.js
//
// The API must run with THROTTLE_ENABLED=false (one synthetic client would
// otherwise be rate-limited at 120 requests/min).
import http from 'k6/http';
import { check, group, sleep } from 'k6';

// THINK=1 models real users (1–3 s pause between screens); THINK=0 is a stress test.
const THINK = __ENV.THINK === '0' ? 0 : 1;

const API = __ENV.API || 'http://host.docker.internal:4000/api/v1';

export const options = {
  scenarios: {
    reads: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 20),
      duration: __ENV.DURATION || '60s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{endpoint:dashboard}': ['p(95)<500'],
    'http_req_duration{endpoint:transactions}': ['p(95)<500'],
    'http_req_duration{endpoint:transactions_filtered}': ['p(95)<500'],
    'http_req_duration{endpoint:cash_flow}': ['p(95)<500'],
    'http_req_duration{endpoint:categories}': ['p(95)<500'],
  },
};

export function setup() {
  const res = http.post(
    `${API}/auth/login`,
    JSON.stringify({ email: __ENV.EMAIL, password: __ENV.PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(res, { 'logged in': (r) => r.status === 200 });
  return { token: res.json('data.accessToken') };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

export default function (data) {
  const params = (endpoint) => ({
    headers: { Authorization: `Bearer ${data.token}` },
    tags: { endpoint },
  });
  const now = new Date();
  const to = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}`;
  const fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const from = `${fromDate.getUTCFullYear()}-${pad(fromDate.getUTCMonth() + 1)}`;

  group('reads', () => {
    check(http.get(`${API}/dashboard/overview`, params('dashboard')), {
      dashboard: (r) => r.status === 200,
    });
    check(
      http.get(
        `${API}/transactions?pageSize=20&page=${1 + Math.floor(Math.random() * 50)}`,
        params('transactions'),
      ),
      {
        transactions: (r) => r.status === 200,
      },
    );
    check(
      http.get(
        `${API}/transactions?type=EXPENSE&q=expense&pageSize=20`,
        params('transactions_filtered'),
      ),
      {
        filtered: (r) => r.status === 200,
      },
    );
    check(http.get(`${API}/reports/cash-flow?from=${from}&to=${to}`, params('cash_flow')), {
      cashFlow: (r) => r.status === 200,
    });
    check(http.get(`${API}/reports/categories?from=${from}-01&to=${to}-28`, params('categories')), {
      categories: (r) => r.status === 200,
    });
  });
  if (THINK) sleep(1 + Math.random() * 2);
}
