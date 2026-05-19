import { z } from 'zod';
import { FiberType, OrderTrigger } from '@prisma/client';
import { PaginationQuerySchema } from '../common/dto/pagination.dto';

// NEW: Single line item in an order
const OrderItemSchema = z.object({
  stockItemId:  z.string().cuid().nullable().optional(),
  itemName:     z.string().min(1, 'Nama barang wajib diisi'),
  itemCode:     z.string().optional(),
  category:     z.string().optional(),
  unit:         z.string().min(1, 'Satuan wajib diisi'),
  requestedQty: z.number().int().min(1, 'Jumlah minimal 1'),
  unitPrice:    z.number().min(0).optional(),
}).superRefine((row, ctx) => {
  const sid = row.stockItemId;
  const noCatalog = sid === null || sid === undefined;
  if (noCatalog && (row.unitPrice === undefined || row.unitPrice === null)) {
    ctx.addIssue({ code: 'custom', message: 'Harga satuan wajib untuk barang di luar katalog', path: ['unitPrice'] });
  }
});

// NEW: CreateOrderDto — PM fills this (alur stok katalog)
export const CreateOrderDto = z.object({
  fiberType:  z.nativeEnum(FiberType),
  projectRef: z.string().trim().min(1, 'Referensi Proyek wajib diisi'), // FIX: mandatory
  notes:      z.string().optional(),
  financeProjectId: z.string().optional(),
  orderTrigger: z.nativeEnum(OrderTrigger).optional().default(OrderTrigger.PROJECT_REQUEST),
  items:      z.array(OrderItemSchema).min(1, 'Minimal satu barang'),
});

// FIX: pengajuan lewat approval chain (Admin Stok → Ops → GM → Finance)
export const CreateApprovalOrderDto = z.object({
  requestedItems: z.array(z.object({
    name:     z.string().min(1),
    quantity: z.number().int().min(1),
    unit:     z.string().min(1),
    notes:    z.string().optional(),
  })).min(1, 'Minimal 1 item'),
  fiberType:  z.nativeEnum(FiberType).optional(),
  projectRef: z.string().trim().min(1, 'Referensi Proyek wajib diisi'), // FIX: mandatory
  notes:      z.string().optional(),
  financeProjectId: z.string().optional(),
  orderTrigger: z.nativeEnum(OrderTrigger).optional().default(OrderTrigger.PROJECT_REQUEST),
});

// MODIFIED: list filters + pagination + search
export const OrderFilterDto = PaginationQuerySchema.merge(z.object({
  status:        z.string().optional(),
  fiberType:     z.nativeEnum(FiberType).optional(),
  orderTrigger:  z.nativeEnum(OrderTrigger).optional(),
  dateFrom:      z.string().optional(),
  dateTo:        z.string().optional(),
  search:        z.string().optional(),
}));

// NEW: ConfirmReceiptDto — ADMIN_STOCK uses this to confirm received items
export const ConfirmReceiptDto = z.object({
  suratJalanId: z.string().cuid(),
  notes:        z.string().optional(),
  items:        z.array(z.object({
    orderItemId:  z.string().cuid(),
    receivedQty:  z.number().int().min(0),
  })),
});

// Phase 3 — restock gudang (Admin Stock); optional project override (Q6)
export const CreateRestockOrderDto = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1, 'ID produk wajib'),
        qty: z.coerce.number().int().positive(),
        notes: z.string().optional(),
      }),
    )
    .min(1, 'Minimal satu item'),
  notes: z.string().optional(),
  financeProjectId: z.string().optional(),
});

export const CancelOrderDto = z.object({
  reason: z.string().trim().min(1, 'Alasan pembatalan wajib diisi').max(1000),
});

/** Finance: bukti pembayaran saja (deduct budget di gmApprove) */
export const FinanceProcessDto = z.object({
  notes: z.string().optional(),
  receiptUrl: z.string().url().optional(),
  /** Legacy: ignored; deduct runs at GM approve */
  amount: z.number().optional(),
});

export type CreateOrderDtoType = z.infer<typeof CreateOrderDto>;
export type CreateApprovalOrderDtoType = z.infer<typeof CreateApprovalOrderDto>;
export type OrderFilterDtoType = z.infer<typeof OrderFilterDto>;
export type ConfirmReceiptDtoType = z.infer<typeof ConfirmReceiptDto>;
export type CreateRestockOrderDtoType = z.infer<typeof CreateRestockOrderDto>;
export type CancelOrderDtoType = z.infer<typeof CancelOrderDto>;
export type FinanceProcessDtoType = z.infer<typeof FinanceProcessDto>;
