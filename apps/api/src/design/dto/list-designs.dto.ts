import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ListDesignsQuerySchema = z.object({
  // FIX: Make projectId optional - when not provided, returns ALL designs for the user
  projectId: z.string().min(1).optional(),
  includeArchived: z.coerce.boolean().optional(),
  createdBy: z.string().optional(),
});

export type ListDesignsQueryInput = z.infer<typeof ListDesignsQuerySchema>;

export class ListDesignsQueryDto extends createZodDto(ListDesignsQuerySchema) {}
