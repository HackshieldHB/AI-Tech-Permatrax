import { SetMetadata } from '@nestjs/common';

/** Override global TimeoutInterceptor (ms). Use on slow GIS Overpass/OSRM routes. */
export const TIMEOUT_MS_KEY = 'timeout_ms';
export const TimeoutMs = (ms: number) => SetMetadata(TIMEOUT_MS_KEY, ms);
