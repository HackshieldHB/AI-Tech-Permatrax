import { z } from 'zod';

export const SubmitPriceItemDto = z.object({
  orderItemId: z.string().cuid(),
  unitPrice: z.coerce.number().positive('Harga satuan harus > 0'),
});

export const SubmitPriceDto = z.object({
  supplierId: z.string().min(1, 'Supplier wajib dipilih'),
  items: z.array(SubmitPriceItemDto).min(1, 'Minimal satu item'),
  notes: z.string().optional(),
  ppnType: z.enum(['PERCENT', 'NOMINAL', '']).optional(),
  ppnValue: z.number().optional(),
});

export const PurchasingInboxFilterDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  orderTrigger: z.enum(['PROJECT_REQUEST', 'STOCK_RESTOCK', 'all']).optional().default('all'),
});

export type SubmitPriceDtoType = z.infer<typeof SubmitPriceDto>;
export type PurchasingInboxFilterDtoType = z.infer<typeof PurchasingInboxFilterDto>;
