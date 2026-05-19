import { z } from 'zod';
import { FiberType } from '@prisma/client';
import { PaginationQuerySchema } from '../common/dto/pagination.dto';

// MODIFIED: completed clusters list filters + pagination
export const DocumentListFilterDto = PaginationQuerySchema.merge(z.object({
  fiberType:   z.nativeEnum(FiberType).optional(),
  ispCustomer: z.string().optional(),
  dateFrom:    z.string().optional(),
  dateTo:      z.string().optional(),
  search:      z.string().optional(),
  bakpIspApproved: z.coerce.boolean().optional(),
}));

export type DocumentListFilterDtoType = z.infer<typeof DocumentListFilterDto>;
