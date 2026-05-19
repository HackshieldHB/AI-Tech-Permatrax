import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const calcInputsSchema = z.object({
  areaType: z.enum(['URBAN', 'SUBURBAN', 'RURAL']),
  areaRadiusMeters: z.number(),
  polygonAreaSqM: z.number().optional(),
  backbonePoint: z.tuple([z.number(), z.number()]),
  targetPoint: z.tuple([z.number(), z.number()]),
  polygonCentroid: z.tuple([z.number(), z.number()]).optional(),
});

const featureCollectionSchema = z
  .object({
    type: z.literal('FeatureCollection'),
    features: z.array(z.unknown()),
  })
  .superRefine((fc, ctx) => {
    fc.features.forEach((raw, i) => {
      const base = z
        .object({
          type: z.literal('Feature'),
          geometry: z.unknown(),
          properties: z.unknown(),
        })
        .safeParse(raw);
      if (!base.success) {
        base.error.issues.forEach((issue) => ctx.addIssue({ ...issue, path: ['features', i, ...issue.path] }));
        return;
      }
      const feat = base.data;
      const props = feat.properties;
      if (typeof props !== 'object' || props === null || !('kind' in props)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Each feature must have object properties with kind',
          path: ['features', i, 'properties'],
        });
        return;
      }
      const kind = (props as { kind: unknown }).kind;
      const geom = feat.geometry as { type?: string; coordinates?: unknown };

      if (geom?.type === 'Point') {
        if (kind !== 'node') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Point features must have properties.kind "node"',
            path: ['features', i, 'properties', 'kind'],
          });
          return;
        }
        const coords = geom.coordinates;
        const ok =
          Array.isArray(coords) &&
          coords.length >= 2 &&
          typeof coords[0] === 'number' &&
          typeof coords[1] === 'number';
        if (!ok) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Point geometry must have [lng, lat] coordinates',
            path: ['features', i, 'geometry'],
          });
          return;
        }
        const t = (props as { type?: unknown }).type;
        if (typeof t !== 'string') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Node feature requires string properties.type',
            path: ['features', i, 'properties', 'type'],
          });
          return;
        }
        const phase2Node = ['SPLITTER', 'POLE', 'SPLICE', 'CONNECTOR'];
        if (phase2Node.includes(t)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `NodeType ${t} is reserved for Phase 2`,
            path: ['features', i, 'properties', 'type'],
          });
          return;
        }
        if (!['OLT', 'ODC', 'ODP'].includes(t)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid node type: ${t}`,
            path: ['features', i, 'properties', 'type'],
          });
          return;
        }
        const refId = (props as { refId?: unknown }).refId;
        if (typeof refId !== 'string' || refId.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Node feature requires properties.refId',
            path: ['features', i, 'properties', 'refId'],
          });
        }
      } else if (geom?.type === 'LineString') {
        if (kind !== 'edge') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'LineString features must have properties.kind "edge"',
            path: ['features', i, 'properties', 'kind'],
          });
          return;
        }
        const coords = geom.coordinates;
        const ok =
          Array.isArray(coords) &&
          coords.length >= 2 &&
          coords.every(
            (c: unknown) =>
              Array.isArray(c) && c.length >= 2 && typeof c[0] === 'number' && typeof c[1] === 'number',
          );
        if (!ok) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'LineString geometry must have at least two [lng, lat] positions',
            path: ['features', i, 'geometry'],
          });
          return;
        }
        const t = (props as { type?: unknown }).type;
        if (typeof t !== 'string') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Edge feature requires string properties.type',
            path: ['features', i, 'properties', 'type'],
          });
          return;
        }
        if (t === 'DROP') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'EdgeType DROP is reserved for Phase 2',
            path: ['features', i, 'properties', 'type'],
          });
          return;
        }
        if (!['FEEDER', 'DISTRIBUTION'].includes(t)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid edge type: ${t}`,
            path: ['features', i, 'properties', 'type'],
          });
          return;
        }
        for (const key of ['fromRef', 'toRef'] as const) {
          const v = (props as Record<string, unknown>)[key];
          if (typeof v !== 'string' || v.length === 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Edge feature requires properties.${key}`,
              path: ['features', i, 'properties', key],
            });
          }
        }
        const len = (props as { length_m?: unknown }).length_m;
        if (typeof len !== 'number' || Number.isNaN(len)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Edge feature requires numeric properties.length_m',
            path: ['features', i, 'properties', 'length_m'],
          });
        }
        const rs = (props as { route_source?: unknown }).route_source;
        if (rs !== 'osrm' && rs !== 'valhalla' && rs !== 'haversine' && rs !== 'manual') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Edge feature requires properties.route_source in osrm | valhalla | haversine | manual',
            path: ['features', i, 'properties', 'route_source'],
          });
        }
      } else {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Each feature geometry must be Point or LineString',
          path: ['features', i, 'geometry'],
        });
      }
    });
  });

export const CreateDesignSchema = z.object({
  projectId: z.string().min(1),
  calcInputs: calcInputsSchema,
  baseTopology: z.record(z.unknown()),
  geometry: featureCollectionSchema,
  sketchTopology: z.any().optional(),
});

export type CreateDesignInput = z.infer<typeof CreateDesignSchema>;

export class CreateDesignDto extends createZodDto(CreateDesignSchema) {}
