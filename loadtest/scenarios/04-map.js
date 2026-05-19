import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3001/api';
const TOKEN = __ENV.JWT_TOKEN || '';

export const options = {
  vus: 15,
  duration: '2m',
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1200'],
  },
};

/** Bbox Jakarta ± contoh — samakan dengan area uji Anda. */
const BBOX = __ENV.MAP_BBOX || '106.7,-6.35,107.0,-6.1';

export default function () {
  if (!TOKEN) {
    sleep(1);
    return;
  }
  const headers = { Authorization: `Bearer ${TOKEN}` };
  const q = `/map/clusters?bbox=${encodeURIComponent(BBOX)}&limit=200`;
  const res = http.get(`${BASE_URL}${q}`, { headers });
  check(res, { '2xx': (r) => r.status >= 200 && r.status < 300 });
  sleep(1);
}
