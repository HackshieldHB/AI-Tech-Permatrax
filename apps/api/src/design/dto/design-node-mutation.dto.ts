import { z } from 'zod';

export const CreateDesignNodeSchema = z.object({
  refId: z.string().min(1),
  type: z.enum(['OLT', 'ODC', 'ODP', 'SPLITTER', 'SPLICE', 'POLE', 'CONNECTOR']),
  origin: z.enum(['AUTO', 'MANUAL', 'MODIFIED']).default('MANUAL'),
  coordinates: z.tuple([z.number(), z.number()]),
  properties: z.record(z.unknown()).default({}),
});

export type CreateDesignNodeInput = z.infer<typeof CreateDesignNodeSchema>;

export const PatchDesignNodeSchema = z
  .object({
    coordinates: z.tuple([z.number(), z.number()]).optional(),
    origin: z.enum(['AUTO', 'MANUAL', 'MODIFIED']).optional(),
    properties: z.record(z.unknown()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one field must be provided');

export type PatchDesignNodeInput = z.infer<typeof PatchDesignNodeSchema>;
