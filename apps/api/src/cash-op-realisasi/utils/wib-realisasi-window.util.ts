import { BadRequestException } from '@nestjs/common';
import { addDays, startOfDay } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

/** WIB — no DST; date-fns-tz stays consistent across future rule changes. */
export const WIB_TIMEZONE = 'Asia/Jakarta';

/**
 * UTC instant when the realisasi window opens: 00:00 WIB on the calendar day after `periodeTo`'s date in WIB.
 */
export function computeRealisasiOpenAtUtc(periodeTo: Date): Date {
  const wibLocal = toZonedTime(periodeTo, WIB_TIMEZONE);
  const nextDayWib = addDays(startOfDay(wibLocal), 1);
  return fromZonedTime(nextDayWib, WIB_TIMEZONE);
}

/**
 * @throws BadRequestException if the realisasi window is not yet open.
 */
export function assertRealisasiWindowOpen(periodeTo: Date | null, now: Date = new Date()): void {
  if (!periodeTo) {
    throw new BadRequestException('Periode kunjungan belum ditentukan');
  }
  const openAt = computeRealisasiOpenAtUtc(periodeTo);
  if (now < openAt) {
    const openAtWib = toZonedTime(openAt, WIB_TIMEZONE);
    throw new BadRequestException(
      `Laporan realisasi baru dapat diajukan mulai ${openAtWib.toLocaleString('id-ID', { timeZone: WIB_TIMEZONE })} WIB`,
    );
  }
}
