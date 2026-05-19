import { z } from 'zod';

export const CreateSupplierDto = z.object({
  name: z.string().min(1, 'Nama supplier wajib diisi').max(200),
  npwp: z.string().optional(),
  email: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.string().email('Format email tidak valid').optional(),
  ),
  phone: z.string().optional(),
  address: z.string().optional(),
  bankAccount: z.string().optional(),
  bankName: z.string().optional(),
  contactPerson: z.string().optional(),
  notes: z.string().optional(),
});

export const UpdateSupplierDto = CreateSupplierDto.partial();

export const FilterSupplierDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  isActive: z.enum(['true', 'false', 'all']).optional().default('all'),
});

export type CreateSupplierDtoType = z.infer<typeof CreateSupplierDto>;
export type UpdateSupplierDtoType = z.infer<typeof UpdateSupplierDto>;
export type FilterSupplierDtoType = z.infer<typeof FilterSupplierDto>;
