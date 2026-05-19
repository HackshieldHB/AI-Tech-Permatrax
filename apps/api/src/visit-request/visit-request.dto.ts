import { z } from 'zod';
import { FiberType, StakeholderResponse } from '@prisma/client';
import { PaginationQuerySchema } from '../common/dto/pagination.dto';

/** Surveyor: minimal create (schedule + notes only; no lapangan/stakeholder yet). */
export const CreateVisitRequestDto = z.object({
  cleanListId: z.string().min(1),
  fiberType: z.nativeEnum(FiberType),
  visitDate: z.string().datetime(),
  surveyNotes: z.string().optional(),
});

/** PM / PM Senior: approve or reject visit schedule before fieldwork. */
export const PmVisitReviewDto = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('APPROVE'),
    notes: z.string().optional(),
  }),
  z.object({
    action: z.literal('REJECT'),
    rejectionReason: z.string().min(1, 'Alasan penolakan wajib diisi'),
    notes: z.string().optional(),
  }),
]);

/** Surveyor: submit lapangan + stakeholder + bukti when APPROVED_PENDING_DATA. */
export const SubmitSurveyDataDto = z.object({
  rtContact: z.string().optional(),
  rwContact: z.string().optional(),
  pengelolaContact: z.string().optional(),
  areaCondition: z.string().optional(),
  existingNetworkFound: z.boolean().default(false),
  existingOperator: z.string().optional(),
  stakeholderResponse: z.nativeEnum(StakeholderResponse),
  surveyNotes: z.string().optional(),
  evidencePhotos: z.array(z.string()).optional().default([]),
});

/** PM / PM Senior / Admin: survey result & downstream gates (unchanged semantics). */
export const ReviewVisitRequestDto = z
  .object({
    action: z.enum(['APPROVE', 'REJECT']),
    notes: z.string().optional(),
  })
  .refine(
    (d) => d.action !== 'REJECT' || (d.notes !== undefined && d.notes.trim().length > 0),
    { message: 'Catatan wajib untuk penolakan', path: ['notes'] },
  );

export const VisitRequestFilterDto = PaginationQuerySchema.merge(
  z.object({
    status: z.string().optional(),
    fiberType: z.nativeEnum(FiberType).optional(),
    ispCustomer: z.string().optional(),
    requestedBy: z.string().optional(),
    search: z.string().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
  }),
);

/** Survey PATCH when DRAFT (incl. setelah visit-gate reject): jadwal + catatan visit only. */
export const PatchVisitDraftDto = z
  .object({
    visitDate: z.string().datetime().optional(),
    surveyNotes: z.string().optional(),
  })
  .strict();

/** Survey PATCH when REJECTED (survey gate): lapangan fields only, not visitDate. */
export const PatchVisitRejectedSurveyDto = z
  .object({
    rtContact: z.string().optional(),
    rwContact: z.string().optional(),
    pengelolaContact: z.string().optional(),
    areaCondition: z.string().optional(),
    existingNetworkFound: z.boolean().optional(),
    existingOperator: z.string().optional(),
    stakeholderResponse: z.nativeEnum(StakeholderResponse).optional(),
    surveyNotes: z.string().optional(),
    evidencePhotos: z.array(z.string()).optional(),
  })
  .strict();

export type CreateVisitRequestDtoType = z.infer<typeof CreateVisitRequestDto>;
export type PmVisitReviewDtoType = z.infer<typeof PmVisitReviewDto>;
export type SubmitSurveyDataDtoType = z.infer<typeof SubmitSurveyDataDto>;
export type ReviewVisitRequestDtoType = z.infer<typeof ReviewVisitRequestDto>;
export type VisitRequestFilterDtoType = z.infer<typeof VisitRequestFilterDto>;
export type PatchVisitDraftDtoType = z.infer<typeof PatchVisitDraftDto>;
export type PatchVisitRejectedSurveyDtoType = z.infer<typeof PatchVisitRejectedSurveyDto>;
