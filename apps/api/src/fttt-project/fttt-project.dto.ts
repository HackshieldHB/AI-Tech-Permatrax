import { z } from 'zod';
import { FtttCompany, FtttDocType, FtttJaminanType, FtttDocumentType, FtttImplLogType } from '@prisma/client';

// ─── Phase lifecycle config (hardcoded per company) ──────────────────────────
import { FtttPhase } from '@prisma/client';

export const FTTT_PHASES_BY_COMPANY: Record<FtttCompany, FtttPhase[]> = {
  TELKOM_INFRA: [
    FtttPhase.INITIATION,
    // SURVEY is skipped for Telkom Infra
    FtttPhase.PREPARATION,
    FtttPhase.IMPLEMENTATION,
    FtttPhase.DOCUMENTATION,
    FtttPhase.RECONCILIATION,
    FtttPhase.CLOSING,
  ],
  IFORTE: [
    FtttPhase.INITIATION,
    FtttPhase.SURVEY,
    FtttPhase.PREPARATION,
    FtttPhase.IMPLEMENTATION,
    FtttPhase.DOCUMENTATION,
    FtttPhase.RECONCILIATION,
    FtttPhase.CLOSING,
  ],
  PST: [
    FtttPhase.INITIATION,
    FtttPhase.SURVEY,
    FtttPhase.PREPARATION,
    FtttPhase.IMPLEMENTATION,
    FtttPhase.DOCUMENTATION,
    FtttPhase.RECONCILIATION,
    FtttPhase.CLOSING,
  ],
};

export const PHASE_LABELS: Record<FtttPhase, string> = {
  INITIATION:     'Project Initiation',
  SURVEY:         'Validation & Survey',
  PREPARATION:    'Project Preparation',
  IMPLEMENTATION: 'Implementation',
  DOCUMENTATION:  'Documentation & Acceptance',
  RECONCILIATION: 'Reconciliation & Billing',
  CLOSING:        'Project Closing',
};

export const COMPANY_LABELS: Record<FtttCompany, string> = {
  TELKOM_INFRA: 'Telkom Infra',
  IFORTE:       'iForte',
  PST:          'PST',
};

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export const CreateFtttProjectDto = z.object({
  ftttCompany:   z.nativeEnum(FtttCompany),
  triggerDocType: z.nativeEnum(FtttDocType),
  cleanListId:   z.string().optional(),
  projectName:   z.string().min(1).max(200).optional(),
  notes:         z.string().max(1000).optional(),
});
export type CreateFtttProjectDtoType = z.infer<typeof CreateFtttProjectDto>;

export const AdvancePhaseDto = z.object({
  notes: z.string().max(1000).optional(),
});
export type AdvancePhaseDtoType = z.infer<typeof AdvancePhaseDto>;

export const UploadSurveyDto = z.object({
  fileType: z.enum(['photo', 'supporting_file', 'survey_evidence', 'operational_notes']),
  caption:  z.string().max(500).optional(),
});
export type UploadSurveyDtoType = z.infer<typeof UploadSurveyDto>;

export const UploadDrmDocDto = z.object({
  docType: z.enum(['BOQ_INITIAL', 'TOS_INITIAL', 'DRM_RESULT', 'ACTUAL']),
  notes:   z.string().max(1000).optional(),
});
export type UploadDrmDocDtoType = z.infer<typeof UploadDrmDocDto>;

export const SubmitSanggahDto = z.object({
  reason: z.string().min(10, 'Alasan minimal 10 karakter').max(2000),
});
export type SubmitSanggahDtoType = z.infer<typeof SubmitSanggahDto>;

export const ResolveSanggahDto = z.object({
  status:        z.enum(['ACCEPTED', 'REJECTED']),
  responseNotes: z.string().max(2000).optional(),
});
export type ResolveSanggahDtoType = z.infer<typeof ResolveSanggahDto>;

export const AddJaminanDto = z.object({
  jaminanType: z.nativeEnum(FtttJaminanType),
  amount:      z.coerce.number().positive().optional(),
  issuer:      z.string().max(200).optional(),
  issueDate:   z.coerce.date().optional(),
  expiryDate:  z.coerce.date().optional(),
  notes:       z.string().max(1000).optional(),
});
export type AddJaminanDtoType = z.infer<typeof AddJaminanDto>;

export const UploadDocumentDto = z.object({
  docType: z.nativeEnum(FtttDocumentType),
  notes:   z.string().max(1000).optional(),
});
export type UploadDocumentDtoType = z.infer<typeof UploadDocumentDto>;

export const ApproveDocumentDto = z.object({
  approved: z.boolean(),
  notes:    z.string().max(500).optional(),
});
export type ApproveDocumentDtoType = z.infer<typeof ApproveDocumentDto>;

// Implementation phase log (photo/doc/note)
export const AddImplLogDto = z.object({
  logType: z.nativeEnum(FtttImplLogType),
  caption: z.string().max(500).optional(),
  notes:   z.string().max(2000).optional(),
});
export type AddImplLogDtoType = z.infer<typeof AddImplLogDto>;

export const FtttProjectFilterDto = z.object({
  company:  z.nativeEnum(FtttCompany).optional(),
  phase:    z.nativeEnum(FtttPhase).optional(),
  status:   z.enum(['ACTIVE', 'COMPLETED', 'ON_HOLD', 'CANCELLED', 'all']).default('all'),
  page:     z.coerce.number().int().positive().default(1),
  limit:    z.coerce.number().int().positive().max(100).default(20),
});
export type FtttProjectFilterDtoType = z.infer<typeof FtttProjectFilterDto>;
