import { z } from 'zod';
import { FiberType } from '@prisma/client';
import { PaginationQuerySchema } from '../common/dto/pagination.dto';

// MODIFIED: list filters + pagination
export const BaOpenListFilterDto = PaginationQuerySchema.merge(z.object({
  status:      z.string().optional(),
  ispCustomer: z.string().optional(),
  fiberType:   z.nativeEnum(FiberType).optional(),
  dateFrom:    z.string().optional(),
  dateTo:      z.string().optional(),
  search:      z.string().optional(),
}));

export type BaOpenListFilterDtoType = z.infer<typeof BaOpenListFilterDto>;

export const CreateBaOpenDto = z.object({
  visitRequestId: z.string().cuid(), // NEW: linked visit request id
  tanggal: z.string().datetime(), // NEW: BA open meeting datetime
  tempat: z.string().min(2, 'Tempat wajib diisi'), // NEW: BA open place
  topik: z.string().min(3, 'Topik wajib diisi'), // NEW: BA open topic
  description: z.string().min(5, 'Deskripsi wajib diisi'), // NEW: BA open issue description
  existingFiber: z.boolean().optional(),
  existingOperator: z.string().nullable().optional(),
});

export type CreateBaOpenDtoType = z.infer<typeof CreateBaOpenDto>;
