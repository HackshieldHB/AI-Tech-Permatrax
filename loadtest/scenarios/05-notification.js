import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3001/api';
const TOKEN = __ENV.JWT_TOKEN || '';

export const options = {
  vus: 25,
  duration: '2m',
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<800'],
  },
};

/** Polling inbox HTTP (bukan load WebSocket). Sesuaikan path controller notifikasi. */
export default function () {
  if (!TOKEN) {
    sleep(1);
    return;
  }
  const headers = { Authorization: `Bearer ${TOKEN}` };
  const res = http.get(`${BASE_URL}/notifications/my?limit=50`, { headers });
  check(res, {
    '2xx or 404': (r) => (r.status >= 200 && r.status < 300) || r.status === 404,
  });
  sleep(0.5);
}
