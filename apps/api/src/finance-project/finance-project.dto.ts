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
    // JLM: project type + FTTT-only budget categories (Perizinan + Lain-Lain)
    projectType: z.enum(['FTTH', 'FTTT']).optional().default('FTTH'),
    // Integra V1: SEGMENT (FTTT parent) | SITE (under parentId) | STANDALONE (FTTH/default)
    hierarchyLevel: z.enum(['SEGMENT', 'SITE', 'STANDALONE']).optional(),
    parentId: z.string().cuid().optional(),
    budgetPerizinan: z.coerce.number().nonnegative().optional(),
    budgetLainLain: z.coerce.number().nonnegative().optional(),
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
  )
  .refine(
    (data) => {
      if (data.hierarchyLevel === 'SITE' || data.parentId) {
        return !!data.parentId;
      }
      return true;
    },
    { message: 'Site wajib memiliki parentId Segment' },
  );

export type CreateFinanceProjectInput = z.infer<typeof CreateFinanceProjectDto>;

export const CreateFinanceSiteDto = z.object({
  code: z.string().min(3).max(20).regex(/^[A-Za-z0-9-]+$/).optional(),
  name: z.string().min(3).max(100),
  description: z.string().optional(),
  budgetPerizinan: z.coerce.number().nonnegative().optional().default(0),
  materialBudget: z.coerce.number().nonnegative().optional().default(0),
  jasaBudget: z.coerce.number().nonnegative().optional().default(0),
  endDate: z.string().datetime().optional(),
});
export type CreateFinanceSiteInput = z.infer<typeof CreateFinanceSiteDto>;

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
    budgetPerizinan: z.coerce.number().nonnegative().nullable().optional(),
    budgetLainLain: z.coerce.number().nonnegative().nullable().optional(),
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

// JLM: FTTT S-Curve baseline timeline (milestones) — Finance-owned
export const SetTimelineDto = z.object({
  milestones: z.array(z.object({
    targetDate:         z.string(),
    plannedBudget:      z.coerce.number().nonnegative(),
    plannedProgressPct: z.coerce.number().min(0).max(100),
  })).max(60),
});
export type SetTimelineInput = z.infer<typeof SetTimelineDto>;

// Integra V3/V4: Finance submits PO Customer for GM approval
export const SubmitPoCustomerDto = z.object({
  amount: z.coerce.number().positive(),
  poNumber: z.string().trim().min(1, 'Nomor PO Customer wajib diisi').max(100),
  reason: z.string().max(500).optional(),
});
export type SubmitPoCustomerInput = z.infer<typeof SubmitPoCustomerDto>;

export const ReviewPoCustomerDto = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    reviewNote: z.string().max(500).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.decision === 'REJECT' && !data.reviewNote?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Alasan penolakan wajib diisi',
        path: ['reviewNote'],
      });
    }
  });
export type ReviewPoCustomerInput = z.infer<typeof ReviewPoCustomerDto>;

export const FinanceProjectFilterDto = PaginationQuerySchema.merge(
  z.object({
    search: z.string().optional(),
    status: z.enum(['ACTIVE', 'CLOSED', 'ARCHIVED']).optional().transform(v => v as FinanceProjectStatus | undefined),
    includeArchived: z.coerce.boolean().optional(),
    sortBy: z.enum(['createdAt', 'updatedAt', 'name', 'code']).optional(),
    // Integra V1: tree list defaults to roots (SEGMENT + STANDALONE); pass parentId for Sites under Segment
    hierarchyLevel: z.enum(['SEGMENT', 'SITE', 'STANDALONE']).optional(),
    parentId: z.string().cuid().optional(),
    rootsOnly: z.coerce.boolean().optional(),
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
