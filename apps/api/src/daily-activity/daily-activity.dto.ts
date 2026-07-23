import { z } from 'zod';
import { DailyActivityWorkStatus } from '@prisma/client';

export const DailyActivityWorkStatusEnum = z.nativeEnum(DailyActivityWorkStatus);

/** Internal params for other services to auto-log a Daily Activity row (e.g. FTTT implementation logs). */
export interface CreateDailyActivityAutoParams {
  actorId: string;
  scopeOfWork: string;
  financeProjectId?: string | null;
  ftttProjectId?: string | null;
  siteName?: string | null;
  workStatus?: DailyActivityWorkStatus;
  targetDoneAt?: Date | null;
  remarks?: string | null;
  evidenceUrl?: string | null;
}

export const FilterDailyActivityDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  workStatus: DailyActivityWorkStatusEnum.optional(),
  ftttProjectId: z.string().optional(),
  financeProjectId: z.string().optional(),
});

export const UpdateDailyActivityDto = z.object({
  workStatus: DailyActivityWorkStatusEnum.optional(),
  targetDoneAt: z.coerce.date().nullable().optional(),
  remarks: z.string().max(2000).nullable().optional(),
  evidenceUrl: z.string().min(1).nullable().optional(),
});

export const AttachEvidenceDto = z.object({
  evidenceUrl: z.string().min(1).optional(),
});

export type FilterDailyActivityDtoType = z.infer<typeof FilterDailyActivityDto>;
export type UpdateDailyActivityDtoType = z.infer<typeof UpdateDailyActivityDto>;
export type AttachEvidenceDtoType = z.infer<typeof AttachEvidenceDto>;
