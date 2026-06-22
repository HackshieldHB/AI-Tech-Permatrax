import { z } from 'zod';
import { PaginationQuerySchema } from '../common/dto/pagination.dto';

export const MITRA_OPTIONS = ['FiberStar', 'iForte', 'Lintasarta', 'Icon+', 'Integra Lintas Teknologi (ILT)', 'Lainnya'] as const;
export type MitraOption = (typeof MITRA_OPTIONS)[number];

// NEW: DTO for creating a stock item
export const CreateStockItemDto = z.object({
  name:         z.string().min(1, 'Nama barang wajib diisi'),
  code:         z.string().min(1, 'Kode barang wajib diisi').toUpperCase(),
  category:     z.string().min(1, 'Kategori wajib diisi'),
  unit:         z.string().min(1, 'Satuan wajib diisi'),
  mitra:        z.string().min(1, 'Mitra wajib diisi'),
  currentQty:   z.number().int().min(0).default(0),
  minStockQty:  z.number().int().min(0).default(0),
  description:  z.string().optional(),
});

// NEW: DTO for updating stock item metadata (NOT quantity)
export const UpdateStockItemDto = z.object({
  name:         z.string().min(1).optional(),
  category:     z.string().min(1).optional(),
  unit:         z.string().min(1).optional(),
  mitra:        z.string().min(1).optional(),
  minStockQty:  z.number().int().min(0).optional(),
  description:  z.string().optional(),
  isActive:     z.boolean().optional(),
});

// NEW: DTO for manual stock adjustment — only ADMIN_STOCK can call
export const AdjustStockDto = z.object({
  stockItemId:  z.string().cuid('ID barang tidak valid'),
  newQty:       z.number().int().min(0, 'Jumlah tidak boleh negatif'),
  reason:       z.string().min(1, 'Alasan penyesuaian wajib diisi'),
});

// MODIFIED: list filters + pagination
export const StockFilterDto = PaginationQuerySchema.merge(z.object({
  search:    z.string().optional(),
  category:  z.string().optional(),
  mitra:     z.string().optional(),
  lowStock:  z.coerce.boolean().optional(),
  isActive:  z.coerce.boolean().default(true),
}));

export type CreateStockItemDtoType = z.infer<typeof CreateStockItemDto>;
export type UpdateStockItemDtoType = z.infer<typeof UpdateStockItemDto>;
export type AdjustStockDtoType     = z.infer<typeof AdjustStockDto>;
export type StockFilterDtoType     = z.infer<typeof StockFilterDto>;
