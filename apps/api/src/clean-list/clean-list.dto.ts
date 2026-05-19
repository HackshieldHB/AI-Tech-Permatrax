import { z } from 'zod';
import { FiberType } from '@prisma/client';
import { PaginationQuerySchema } from '../common/dto/pagination.dto';

// NEW: DTO for importing a single clean list entry
export const CreateCleanListDto = z.object({
  ispCustomer:   z.string().min(1),
  fiberType:     z.nativeEnum(FiberType),
  rwCode:        z.string().min(1),
  kelurahan:     z.string().min(1),
  kecamatan:     z.string().min(1),
  kotaKabupaten: z.string().min(1),
  homepasCount:  z.number().int().min(0).default(0),
});

// NEW: DTO for bulk import
export const BulkImportCleanListDto = z.object({
  ispCustomer: z.string().min(1),
  fiberType:   z.nativeEnum(FiberType),
  rows: z.array(z.object({
    rwCode:        z.string().min(1),
    kelurahan:     z.string().min(1),
    kecamatan:     z.string().min(1),
    kotaKabupaten: z.string().min(1),
    homepasCount:  z.number().int().min(0).default(0),
  })),
});

// MODIFIED: extends PaginationDto + filters
export const CleanListFilterDto = PaginationQuerySchema.merge(z.object({
  ispCustomer: z.string().optional(),
  fiberType:   z.nativeEnum(FiberType).optional(),
  status:      z.string().optional(),
  search:      z.string().optional(),
  hasExistingFiber: z.coerce.boolean().optional(),
}));

export type CreateCleanListDtoType = z.infer<typeof CreateCleanListDto>;
export type BulkImportCleanListDtoType = z.infer<typeof BulkImportCleanListDto>;
export type CleanListFilterDtoType = z.infer<typeof CleanListFilterDto>;
