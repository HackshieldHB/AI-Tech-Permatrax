import { BadRequestException } from '@nestjs/common';
import {
  assertMvtTileCoordinates,
  mvtTilePathParamsSchema,
  parseMvtTilePathParams,
} from './map-tile-params';

describe('mvtTilePathParamsSchema', () => {
  it('accepts valid coordinates', () => {
    const r = mvtTilePathParamsSchema.safeParse({ z: '10', x: '512', y: '300' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual({ z: 10, x: 512, y: 300 });
    }
  });

  it('rejects non-integer z (decimal string)', () => {
    const r = mvtTilePathParamsSchema.safeParse({ z: '3.14', x: '0', y: '0' });
    expect(r.success).toBe(false);
  });

  it('rejects integer-like z with trailing decimal (not digits-only)', () => {
    const r = mvtTilePathParamsSchema.safeParse({ z: '10.0', x: '0', y: '0' });
    expect(r.success).toBe(false);
  });

  it('rejects non-integer x and y (decimal string)', () => {
    expect(
      mvtTilePathParamsSchema.safeParse({ z: '10', x: '512.5', y: '300' }).success,
    ).toBe(false);
    expect(
      mvtTilePathParamsSchema.safeParse({ z: '10', x: '512', y: '300.1' }).success,
    ).toBe(false);
  });

  it('rejects negative z string', () => {
    const r = mvtTilePathParamsSchema.safeParse({ z: '-1', x: '0', y: '0' });
    expect(r.success).toBe(false);
  });

  it('rejects negative x', () => {
    const r = mvtTilePathParamsSchema.safeParse({ z: '2', x: '-1', y: '0' });
    expect(r.success).toBe(false);
  });

  it('rejects z above max zoom', () => {
    const r = mvtTilePathParamsSchema.safeParse({ z: '23', x: '0', y: '0' });
    expect(r.success).toBe(false);
  });

  it('rejects x out of range for zoom (z=2 max tile index 3)', () => {
    const r = mvtTilePathParamsSchema.safeParse({ z: '2', x: '4', y: '0' });
    expect(r.success).toBe(false);
  });

  it('rejects y out of range for zoom', () => {
    const r = mvtTilePathParamsSchema.safeParse({ z: '1', x: '0', y: '2' });
    expect(r.success).toBe(false);
  });

  it('rejects SQL injection attempt in z', () => {
    const r = mvtTilePathParamsSchema.safeParse({
      z: "1; DROP TABLE \"Homepass\"--",
      x: '0',
      y: '0',
    });
    expect(r.success).toBe(false);
  });

  it('rejects SQL injection attempt in x and y', () => {
    expect(
      mvtTilePathParamsSchema.safeParse({
        z: '10',
        x: "0 OR 1=1--",
        y: '0',
      }).success,
    ).toBe(false);
    expect(
      mvtTilePathParamsSchema.safeParse({
        z: '10',
        x: '0',
        y: '1; DELETE FROM \"Homepass\"--',
      }).success,
    ).toBe(false);
  });
});

describe('parseMvtTilePathParams', () => {
  it('returns parsed numbers for valid path', () => {
    expect(parseMvtTilePathParams({ z: '0', x: '0', y: '0' })).toEqual({
      z: 0,
      x: 0,
      y: 0,
    });
  });

  it('throws BadRequestException when invalid', () => {
    expect(() => parseMvtTilePathParams({ z: '10', x: '99999', y: '0' })).toThrow(
      BadRequestException,
    );
  });
});

describe('assertMvtTileCoordinates', () => {
  it('allows boundary tile at max zoom edge', () => {
    expect(() => assertMvtTileCoordinates(22, 0, 0)).not.toThrow();
  });

  it('throws on non-integer', () => {
    expect(() => assertMvtTileCoordinates(10.1, 0, 0)).toThrow(BadRequestException);
    expect(() => assertMvtTileCoordinates(10, NaN, 0)).toThrow(BadRequestException);
  });

  it('throws when x exceeds 2^z-1', () => {
    expect(() => assertMvtTileCoordinates(2, 4, 0)).toThrow(BadRequestException);
  });
});
