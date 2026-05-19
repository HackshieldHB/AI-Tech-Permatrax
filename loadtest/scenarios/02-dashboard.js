import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3001/api';
const TOKEN = __ENV.JWT_TOKEN || '';

export const options = {
  vus: 20,
  duration: '2m',
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1000'],
  },
};

/** Set JWT_TOKEN setelah login manual / skrip terpisah. */
export default function () {
  if (!TOKEN) {
    sleep(1);
    return;
  }
  const headers = { Authorization: `Bearer ${TOKEN}` };
  const paths = ['/dashboard', '/dashboard/gm', '/dashboard/finance'];
  const path = paths[Math.floor(Math.random() * paths.length)];
  const res = http.get(`${BASE_URL}${path}`, { headers });
  check(res, { '2xx': (r) => r.status >= 200 && r.status < 300 });
  sleep(1);
}
