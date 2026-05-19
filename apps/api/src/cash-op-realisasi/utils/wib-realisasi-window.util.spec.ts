import { BadRequestException } from '@nestjs/common';
import {
  assertRealisasiWindowOpen,
  computeRealisasiOpenAtUtc,
  WIB_TIMEZONE,
} from './wib-realisasi-window.util';

describe('wib-realisasi-window.util', () => {
  describe('computeRealisasiOpenAtUtc', () => {
    it('2026-03-05T17:00:00Z → open 2026-03-06T17:00:00Z (07 Mar 00:00 WIB)', () => {
      const periodeTo = new Date('2026-03-05T17:00:00.000Z');
      const open = computeRealisasiOpenAtUtc(periodeTo);
      expect(open.toISOString()).toBe('2026-03-06T17:00:00.000Z');
    });

    it('2026-12-31T23:59:59Z → open Jan 2 00:00 WIB boundary (2027-01-01T17:00:00Z)', () => {
      const periodeTo = new Date('2026-12-31T23:59:59.000Z');
      const open = computeRealisasiOpenAtUtc(periodeTo);
      expect(open.toISOString()).toBe('2027-01-01T17:00:00.000Z');
    });

    it('2026-03-05T16:59:59Z → calendar day 5 Mar WIB → open 6 Mar 00:00 WIB', () => {
      const periodeTo = new Date('2026-03-05T16:59:59.000Z');
      const open = computeRealisasiOpenAtUtc(periodeTo);
      expect(open.toISOString()).toBe('2026-03-05T17:00:00.000Z');
    });

    it('Indonesia tidak DST — Juli vs Januari offset WIB sama (+7)', () => {
      const jan = computeRealisasiOpenAtUtc(new Date('2026-01-10T12:00:00.000Z'));
      const jul = computeRealisasiOpenAtUtc(new Date('2026-07-10T12:00:00.000Z'));
      expect(jan.getUTCHours()).toBe(jul.getUTCHours());
    });
  });

  describe('assertRealisasiWindowOpen', () => {
    it('periodeTo null → throw', () => {
      expect(() => assertRealisasiWindowOpen(null)).toThrow(BadRequestException);
      expect(() => assertRealisasiWindowOpen(null)).toThrow('Periode kunjungan belum ditentukan');
    });

    it('periodeTo in the past → no throw', () => {
      expect(() =>
        assertRealisasiWindowOpen(new Date('2020-01-01T00:00:00.000Z'), new Date('2026-01-01T00:00:00.000Z')),
      ).not.toThrow();
    });

    it('before openAt → throw with WIB hint', () => {
      const periodeTo = new Date('2026-06-01T10:00:00.000Z');
      const openAt = computeRealisasiOpenAtUtc(periodeTo);
      const justBefore = new Date(openAt.getTime() - 60_000);
      expect(() => assertRealisasiWindowOpen(periodeTo, justBefore)).toThrow(BadRequestException);
      expect(() => assertRealisasiWindowOpen(periodeTo, justBefore)).toThrow('Laporan realisasi baru dapat diajukan');
    });

    it('at/after openAt → no throw', () => {
      const periodeTo = new Date('2026-03-05T17:00:00.000Z');
      const openAt = computeRealisasiOpenAtUtc(periodeTo);
      expect(() => assertRealisasiWindowOpen(periodeTo, openAt)).not.toThrow();
      expect(() => assertRealisasiWindowOpen(periodeTo, new Date(openAt.getTime() + 60_000))).not.toThrow();
    });
  });

  it('WIB_TIMEZONE constant', () => {
    expect(WIB_TIMEZONE).toBe('Asia/Jakarta');
  });
});
