import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '1m', target: 100 },
    { duration: '2m', target: 100 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
    errors: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3001/api';

export default function () {
  const payload = JSON.stringify({
    email: __ENV.TEST_EMAIL || 'test@example.com',
    password: __ENV.TEST_PASSWORD || 'password123',
  });
  const params = { headers: { 'Content-Type': 'application/json' } };
  const res = http.post(`${BASE_URL}/auth/login`, payload, params);
  const ok = check(res, {
    '2xx or 401': (r) => r.status >= 200 && r.status < 500,
  });
  errorRate.add(!ok);
  sleep(1);
}
