import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3001/api';
const TOKEN = __ENV.JWT_TOKEN || '';

export const options = {
  vus: 10,
  duration: '90s',
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1500'],
  },
};

/**
 * Placeholder: sesuaikan dengan alur API order (list → detail).
 * Wajib JWT_TOKEN user dengan role yang punya akses order.
 */
export default function () {
  if (!TOKEN) {
    sleep(1);
    return;
  }
  const headers = { Authorization: `Bearer ${TOKEN}` };
  const res = http.get(`${BASE_URL}/orders?page=1&limit=20`, { headers });
  check(res, { '2xx': (r) => r.status >= 200 && r.status < 300 });
  sleep(2);
}
