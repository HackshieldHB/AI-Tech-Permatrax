import { z } from 'zod';
import { BudgetTransferStatus } from '@prisma/client';
import { PaginationQuerySchema } from '../common/dto/pagination.dto';

export const SubmitBudgetTransferDto = z
  .object({
    sourceFinanceProjectId: z.string().min(1),
    targetFinanceProjectId: z.string().min(1),
    sourceCategory: z.enum(['MATERIAL', 'JASA']),
    targetCategory: z.enum(['MATERIAL', 'JASA']),
    amount: z.coerce.number().positive(),
    reason: z.string().min(10, 'Alasan minimal 10 karakter'),
  })
  .refine((data) => data.sourceFinanceProjectId !== data.targetFinanceProjectId, {
    message: 'Source dan target project tidak boleh sama',
    path: ['targetFinanceProjectId'],
  });

export type SubmitBudgetTransferInput = z.infer<typeof SubmitBudgetTransferDto>;

export const BudgetTransferFilterDto = PaginationQuerySchema.merge(
  z.object({
    status: z.nativeEnum(BudgetTransferStatus).optional(),
    sourceFinanceProjectId: z.string().optional(),
    targetFinanceProjectId: z.string().optional(),
    submittedById: z.string().optional(),
  }),
);

export type BudgetTransferFilterInput = z.infer<typeof BudgetTransferFilterDto>;

export const ApproveBudgetTransferDto = z.object({
  notes: z.string().optional(),
});

export const RejectBudgetTransferDto = z.object({
  reason: z.string().min(5, 'Alasan penolakan minimal 5 karakter'),
});
