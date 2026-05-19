import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/** Standard web-map MVT zoom range (MapLibre / Mapbox). */
const MVT_Z_MIN = 0;
const MVT_Z_MAX = 22;
/** Max tile index at max zoom (x/y cannot exceed this for any valid z). */
const MVT_XY_MAX = 2 ** MVT_Z_MAX - 1;

/** Path segments must be base-10 digits only — rejects decimals, scientific notation, injection. */
const pathSegmentToNonNegInt = (label: string, min: number, max: number) =>
  z
    .string()
    .regex(/^[0-9]+$/, { message: `${label} must be a non-negative integer (digits 0-9 only)` })
    .transform((s) => parseInt(s, 10))
    .pipe(z.number().int().min(min).max(max));

/**
 * Path/query params for `tiles/:z/:x/:y.pbf` — Zod validates before DB access.
 */
export const mvtTilePathParamsSchema = z
  .object({
    z: pathSegmentToNonNegInt('z', MVT_Z_MIN, MVT_Z_MAX),
    x: pathSegmentToNonNegInt('x', 0, MVT_XY_MAX),
    y: pathSegmentToNonNegInt('y', 0, MVT_XY_MAX),
  })
  .superRefine((val, ctx) => {
    const maxCoord = 2 ** val.z - 1;
    if (val.x > maxCoord) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Tile x out of range for zoom ${val.z} (max ${maxCoord})`,
        path: ['x'],
      });
    }
    if (val.y > maxCoord) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Tile y out of range for zoom ${val.z} (max ${maxCoord})`,
        path: ['y'],
      });
    }
  });

export type MvtTilePathParams = z.infer<typeof mvtTilePathParamsSchema>;

export function parseMvtTilePathParams(input: {
  z: string;
  x: string;
  y: string;
}): MvtTilePathParams {
  const result = mvtTilePathParamsSchema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException(result.error.flatten());
  }
  return result.data;
}

/**
 * Defense-in-depth after controller Zod — rejects non-integers and OOB tiles.
 */
export function assertMvtTileCoordinates(z: number, x: number, y: number): void {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) {
    throw new BadRequestException('Tile coordinates must be integers');
  }
  if (z < MVT_Z_MIN || z > MVT_Z_MAX || x < 0 || y < 0) {
    throw new BadRequestException('Tile coordinates out of valid range');
  }
  const maxCoord = 2 ** z - 1;
  if (x > maxCoord || y > maxCoord) {
    throw new BadRequestException('Tile coordinates out of range for zoom level');
  }
}
