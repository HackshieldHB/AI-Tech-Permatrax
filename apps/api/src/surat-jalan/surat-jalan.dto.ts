import { z } from 'zod';
import { PaginationQuerySchema } from '../common/dto/pagination.dto';

// MODIFIED: list filters + pagination
export const SuratJalanFilterDto = PaginationQuerySchema.merge(z.object({
  type:     z.enum(['OUT', 'IN']).optional(),
  status:   z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo:   z.string().optional(),
  search:   z.string().optional(),
}));

export type SuratJalanFilterDtoType = z.infer<typeof SuratJalanFilterDto>;
