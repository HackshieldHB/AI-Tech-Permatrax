import { z } from 'zod';
import { BudgetLedgerCategory, BudgetLedgerEntryType, FinanceProjectStatus } from '@prisma/client';
import { PaginationQuerySchema } from '../common/dto/pagination.dto';

export const CreateFinanceProjectDto = z
  .object({
    code: z.string().min(3).max(20).regex(/^[A-Za-z0-9-]+$/).optional(),
    name: z.string().min(3).max(100),
    description: z.string().optional(),
    totalBudget: z.coerce.number().nonnegative(),
    materialBudget: z.coerce.number().nonnegative().optional(),
    jasaBudget: z.coerce.number().nonnegative().optional(),
    endDate: z.string().datetime().optional(),
  })
  .refine(
    (data) => {
      if (data.materialBudget != null && data.jasaBudget != null) {
        return data.materialBudget + data.jasaBudget <= data.totalBudget;
      }
      return true;
    },
    { message: 'Material + Jasa budget tidak boleh melebihi Total Budget' },
  );

export type CreateFinanceProjectInput = z.infer<typeof CreateFinanceProjectDto>;

export const UpdateFinanceProjectDto = z.object({
  name: z.string().min(3).max(100).optional(),
  description: z.string().nullable().optional(),
  status: z.nativeEnum(FinanceProjectStatus).optional(),
  endDate: z.string().datetime().nullable().optional(),
});

export type UpdateFinanceProjectInput = z.infer<typeof UpdateFinanceProjectDto>;

export const UpdateBudgetDto = z
  .object({
    totalBudget: z.coerce.number().nonnegative(),
    materialBudget: z.coerce.number().nonnegative().nullable().optional(),
    jasaBudget: z.coerce.number().nonnegative().nullable().optional(),
    reason: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.materialBudget != null && data.jasaBudget != null) {
        return data.materialBudget + data.jasaBudget <= data.totalBudget;
      }
      return true;
    },
    { message: 'Material + Jasa budget tidak boleh melebihi Total Budget' },
  );

export type UpdateBudgetInput = z.infer<typeof UpdateBudgetDto>;

export const FinanceProjectFilterDto = PaginationQuerySchema.merge(
  z.object({
    search: z.string().optional(),
    status: z.enum(['ACTIVE', 'CLOSED', 'ARCHIVED']).optional().transform(v => v as FinanceProjectStatus | undefined),
    includeArchived: z.coerce.boolean().optional(),
    sortBy: z.enum(['createdAt', 'updatedAt', 'name', 'code']).optional(),
  }),
);

export type FinanceProjectFilterInput = z.infer<typeof FinanceProjectFilterDto>;

export const LedgerFilterDto = PaginationQuerySchema.merge(
  z.object({
    entryType: z.nativeEnum(BudgetLedgerEntryType).optional(),
    category: z.nativeEnum(BudgetLedgerCategory).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    sortBy: z.enum(['createdAt', 'amount']).optional(),
  }),
);

export type LedgerFilterInput = z.infer<typeof LedgerFilterDto>;

export const PlanningItemSchema = z.object({
  month: z.coerce.number().min(1).max(12),
  year: z.coerce.number().min(2000).max(2100),
  plannedAmount: z.coerce.number().nonnegative(),
});

export const UpdatePlanningDto = z.object({
  plannings: z.array(PlanningItemSchema),
});

export type UpdatePlanningInput = z.infer<typeof UpdatePlanningDto>;
