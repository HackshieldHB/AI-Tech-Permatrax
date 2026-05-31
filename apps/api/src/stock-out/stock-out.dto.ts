import { z } from 'zod';

export const StockOutItemDto = z.object({
  stockItemId: z.string().min(1, 'Stock item wajib'),
  qty: z.coerce.number().int().positive('Qty harus > 0'),
  notes: z.string().optional(),
});

export const CreateStockOutDto = z.object({
  items: z.array(StockOutItemDto).min(1, 'Minimal satu item'),
  permitClusterId: z.string().optional(),
  recipient: z.string().min(1, 'Penerima wajib diisi'),
  notes: z.string().optional(),
});

export const AdminStockApproveDto = z.object({
  doNumber: z.string().min(1, 'DO Number wajib diisi'),
});

export const ReturnForRevisionDto = z.object({
  reason: z.string().min(1, 'Alasan pengembalian wajib diisi').max(1000),
});

export const RejectStockOutDto = z.object({
  reason: z.string().min(1, 'Alasan penolakan wajib diisi').max(1000),
});

export const FilterStockOutDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['DRAFT', 'PENDING', 'PENDING_PM_CONFIRM', 'PENDING_FINANCE', 'FULFILLED', 'REJECTED', 'all']).default('all'),
  scope: z.enum(['mine', 'inbox', 'all']).default('inbox'),
});

export type CreateStockOutDtoType = z.infer<typeof CreateStockOutDto>;
export type AdminStockApproveDtoType = z.infer<typeof AdminStockApproveDto>;
export type ReturnForRevisionDtoType = z.infer<typeof ReturnForRevisionDto>;
export type RejectStockOutDtoType = z.infer<typeof RejectStockOutDto>;
export type FilterStockOutDtoType = z.infer<typeof FilterStockOutDto>;
