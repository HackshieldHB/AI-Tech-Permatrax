import { z } from 'zod';

const routeSourceSchema = z.enum(['osrm', 'valhalla', 'haversine', 'manual']);

export const CreateDesignEdgeSchema = z.object({
  refId: z.string().min(1),
  fromRef: z.string().min(1),
  toRef: z.string().min(1),
  type: z.enum(['FEEDER', 'DISTRIBUTION', 'DROP']),
  origin: z.enum(['AUTO', 'MANUAL', 'MODIFIED']).default('MANUAL'),
  coordinates: z.array(z.tuple([z.number(), z.number()])).min(2),
  properties: z.record(z.unknown()).default({}),
  length_m: z.number(),
  route_source: routeSourceSchema,
});

export type CreateDesignEdgeInput = z.infer<typeof CreateDesignEdgeSchema>;

export const PatchDesignEdgeSchema = z
  .object({
    coordinates: z.array(z.tuple([z.number(), z.number()])).min(2).optional(),
    fromRef: z.string().min(1).optional(),
    toRef: z.string().min(1).optional(),
    origin: z.enum(['AUTO', 'MANUAL', 'MODIFIED']).optional(),
    properties: z.record(z.unknown()).optional(),
    length_m: z.number().optional(),
    route_source: routeSourceSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one field must be provided');

export type PatchDesignEdgeInput = z.infer<typeof PatchDesignEdgeSchema>;
