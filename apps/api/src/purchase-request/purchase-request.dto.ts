import { z } from 'zod';
import { PurchaseRequestStatus } from '@prisma/client';
import { PaginationQuerySchema } from '../common/dto/pagination.dto';

export const UpdatePurchaseRequestStatusDto = z.object({
  status: z.nativeEnum(PurchaseRequestStatus),
  notes:  z.string().optional(),
});

export const UpdatePurchaseRequestItemsDto = z.object({
  items: z.array(z.object({
    itemId:    z.string().cuid(),
    unitPrice: z.number().min(0),
  })).min(1),
});

// MODIFIED: list filters + pagination (pendingCount via GET /purchase-requests/inbox-count)
export const PurchaseRequestListFilterDto = PaginationQuerySchema.merge(z.object({
  status:   z.string().optional(),
  search:   z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo:   z.string().optional(),
}));

export type UpdatePurchaseRequestStatusDtoType = z.infer<typeof UpdatePurchaseRequestStatusDto>;
export type PurchaseRequestListFilterDtoType = z.infer<typeof PurchaseRequestListFilterDto>;
