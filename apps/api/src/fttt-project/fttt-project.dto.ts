import { z } from 'zod';
import { FtttCompany, FtttDocType, FtttJaminanType, FtttDocumentType, FtttImplLogType, FtttClosingLogType, FtttSpanLogCategory } from '@prisma/client';

// ─── Phase lifecycle config (hardcoded per company) ──────────────────────────
import { FtttPhase } from '@prisma/client';

export const FTTT_PHASES_BY_COMPANY: Record<FtttCompany, FtttPhase[]> = {
  TELKOM_INFRA: [
    FtttPhase.INITIATION,
    FtttPhase.SITE_INITIATION, // Integra V1: Bulky Project → add Sites (parallel with Survey+)
    FtttPhase.SURVEY,     // C7-TI4: Validation & Survey restored for Telkom Infra
    FtttPhase.PREPARATION,
    FtttPhase.IMPLEMENTATION,
    FtttPhase.DOCUMENTATION,
    FtttPhase.RECONCILIATION,
    FtttPhase.CLOSING,
  ],
  IFORTE: [
    FtttPhase.INITIATION,
    FtttPhase.SITE_INITIATION,
    FtttPhase.SURVEY,
    FtttPhase.PREPARATION,
    FtttPhase.IMPLEMENTATION,
    FtttPhase.DOCUMENTATION,
    FtttPhase.RECONCILIATION,
    FtttPhase.CLOSING,
  ],
  PST: [
    FtttPhase.INITIATION,
    FtttPhase.SITE_INITIATION,
    FtttPhase.SURVEY,
    FtttPhase.PREPARATION,
    FtttPhase.PROCUREMENT,   // PST: PM uploads PO after Preparation
    FtttPhase.IMPLEMENTATION,
    FtttPhase.DOCUMENTATION,
    FtttPhase.RECONCILIATION,
    FtttPhase.CLOSING,
  ],
};

export const PHASE_LABELS: Record<FtttPhase, string> = {
  INITIATION:      'Project Initiation',
  SITE_INITIATION: 'Site Initiation',
  SURVEY:          'Validation & Survey',
  PREPARATION:     'Project Preparation',
  PROCUREMENT:     'Procurement',
  IMPLEMENTATION:  'Implementation',
  DOCUMENTATION:   'Documentation & Acceptance',
  RECONCILIATION:  'Reconciliation & Billing',
  CLOSING:         'Project Closing',
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
  // JLM: link to a Finance Project (Project Type = FTTT) — mandatory so budget &
  // monitoring always follow a Finance Project (no more random/unlinked projects)
  // Integra V1: every FTTT project created here is a Bulky Project, and this field
  // must resolve to a Finance SEGMENT (a Finance SITE is auto-resolved to its parent
  // Segment). The field name is kept for backward compatibility with existing callers.
  financeProjectId: z
    .string({ required_error: 'Nama Project (dari Finance Project) harus diisi' })
    .min(1, 'Nama Project (dari Finance Project) harus diisi'),
  notes:         z.string().max(1000).optional(),
});
export type CreateFtttProjectDtoType = z.infer<typeof CreateFtttProjectDto>;

// Integra V1: PM adds a Site (operational unit) under a Bulky Project during Site Initiation
export const AddSiteToBulkyDto = z.object({
  financeProjectId: z
    .string({ required_error: 'Finance Site harus dipilih' })
    .min(1, 'Finance Site harus dipilih'),
});
export type AddSiteToBulkyDtoType = z.infer<typeof AddSiteToBulkyDto>;

/** URGENT: Beginning Site → Ending Site relationships (Site Initiation) */
export const AddBeginningGroupDto = z.object({
  beginningFinanceSiteId: z
    .string({ required_error: 'Beginning Site harus dipilih' })
    .min(1, 'Beginning Site harus dipilih'),
});
export type AddBeginningGroupDtoType = z.infer<typeof AddBeginningGroupDto>;

export const CompleteBeginningEndingsDto = z.object({
  endingFinanceSiteIds: z
    .array(z.string().min(1))
    .min(1, 'Pilih minimal satu Ending Site'),
});
export type CompleteBeginningEndingsDtoType = z.infer<typeof CompleteBeginningEndingsDto>;

// Integra V1 / Stable v1: Financial Request review (Finance) — Tanggal Persetujuan date-only
export const AcceptFinancialRequestDto = z.object({
  scheduledReleaseAt: z.string().min(1, 'Tanggal Persetujuan wajib diisi'),
});
export type AcceptFinancialRequestDtoType = z.infer<typeof AcceptFinancialRequestDto>;

export const DeclineFinancialRequestDto = z.object({
  declinedReason: z.string().min(1, 'Alasan penolakan wajib diisi').max(1000),
});
export type DeclineFinancialRequestDtoType = z.infer<typeof DeclineFinancialRequestDto>;

// Stable v1: Approval Dana inbox filters
export const FinancialRequestInboxFilterDto = z.object({
  filter: z.enum(['all', 'unread', 'pending', 'accepted', 'disbursed', 'declined']).default('all'),
  search: z.string().max(200).optional(),
  page:   z.coerce.number().int().positive().default(1),
  limit:  z.coerce.number().int().positive().max(100).default(20),
});
export type FinancialRequestInboxFilterDtoType = z.infer<typeof FinancialRequestInboxFilterDto>;

// JLM: Implementation Transaction Log entry (PM FTTT)
// Integra V1: Financial Request fields — expectedNeedDate + reason drive priority/routing
export const AddFtttTransactionDto = z.object({
  category:  z.enum(['PERIZINAN', 'MATERIAL', 'JASA', 'LAIN_LAIN']),
  aktivitas: z.string().min(1).max(300),
  uom:       z.string().max(50).optional(),
  qty:       z.coerce.number().positive(),
  price:     z.coerce.number().nonnegative(),
  remarks:   z.string().min(1).max(1000),  // mandatory
  expectedNeedDate: z.string().min(1, 'Tanggal Kebutuhan wajib diisi'),
  reason:           z.string().min(1, 'Alasan/justifikasi wajib diisi').max(1000),
});
export type AddFtttTransactionDtoType = z.infer<typeof AddFtttTransactionDto>;

// Stage 2 / Stable v1 — Finance confirms Tanggal Dana Keluar + Bukti Transfer
export const DisburseFtttTransactionDto = z.object({
  disbursedAt: z.string().min(1, 'Tanggal Dana Keluar wajib diisi'),
});
export type DisburseFtttTransactionDtoType = z.infer<typeof DisburseFtttTransactionDto>;

export const AdvancePhaseDto = z.object({
  notes: z.string().max(1000).optional(),
});
export type AdvancePhaseDtoType = z.infer<typeof AdvancePhaseDto>;

export const UploadSurveyDto = z.object({
  // C7.1: 'photo' removed; 'operational_notes' is text-only (no file)
  fileType:  z.enum(['photo', 'supporting_file', 'survey_evidence', 'operational_notes']),
  caption:   z.string().max(2000).optional(),
  textOnly:  z.boolean().optional(),  // true for operational_notes
  siteId: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.string().cuid().optional(),
  ),
});
export type UploadSurveyDtoType = z.infer<typeof UploadSurveyDto>;

export const UpsertSurveySiteDto = z.object({
  name:  z.string().min(1).max(200),
  code:  z.string().max(50).optional(),
  notes: z.string().max(1000).optional(),
});
export type UpsertSurveySiteDtoType = z.infer<typeof UpsertSurveySiteDto>;

export const MarkSurveySiteDto = z.object({
  status: z.enum(['PENDING', 'DONE']),
  notes:  z.string().max(1000).optional(),
});
export type MarkSurveySiteDtoType = z.infer<typeof MarkSurveySiteDto>;

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
  docType:     z.nativeEnum(FtttDocumentType),
  notes:       z.string().max(1000).optional(),
  formContent: z.string().optional(),  // filled text for Generate Form mode docs
});
export type UploadDocumentDtoType = z.infer<typeof UploadDocumentDto>;

export const ApproveDocumentDto = z.object({
  approved:       z.boolean(),
  notes:          z.string().max(500).optional(),
  rejectionNotes: z.string().min(1).max(1000).optional(),  // mandatory when approved=false
});
export type ApproveDocumentDtoType = z.infer<typeof ApproveDocumentDto>;

// Reconciliation & Billing document upload / Generate Form
export const AddReconDocDto = z.object({
  docKey:      z.string().min(1).max(100),
  notes:       z.string().max(2000).optional(),
  formContent: z.string().optional(),  // JSON string for Generate Form mode
  // JLM: maintenance end date captured with Jaminan Pemeliharaan upload (ISO date string)
  maintenanceEndDate: z.string().optional(),
});
export type AddReconDocDtoType = z.infer<typeof AddReconDocDto>;

// JLM: PST implementation type selection
export const SetImplementationTypeDto = z.object({
  type: z.enum(['GALIAN', 'KU']),
});
export type SetImplementationTypeDtoType = z.infer<typeof SetImplementationTypeDto>;

// JLM: per-phase planned timeline for the S-Curve baseline
export const SetPhasePlanDto = z.object({
  plans: z.array(z.object({
    phase:          z.nativeEnum(FtttPhase),
    plannedEndDate: z.string().nullable().optional(),
    weight:         z.coerce.number().min(0).max(100).nullable().optional(),
  })).max(20),
});
export type SetPhasePlanDtoType = z.infer<typeof SetPhasePlanDto>;

// Implementation phase log (photo/doc/note)
export const AddImplLogDto = z.object({
  logType: z.nativeEnum(FtttImplLogType),
  caption: z.string().max(500).optional(),
  notes:   z.string().max(2000).optional(),
  // iFORTE: meter pekerjaan selesai — diakumulasi ke Progress (%)
  meterDone: z.coerce.number().nonnegative().optional(),
});
export type AddImplLogDtoType = z.infer<typeof AddImplLogDto>;

// Project Closing log (BAST II / evidence photo / note)
export const AddClosingLogDto = z.object({
  logType:     z.nativeEnum(FtttClosingLogType),
  caption:     z.string().max(500).optional(),
  notes:       z.string().max(2000).optional(),
  formContent: z.string().optional(),  // JSON string for Generate Form mode (BAST_II)
});
export type AddClosingLogDtoType = z.infer<typeof AddClosingLogDto>;

// Span-based Implementation Log (Telkom Infra)
export const AddSpanDto = z.object({
  spanNumber: z.string().min(1).max(100),
  // Integra V2: panjang folder (meter) — diisi sekali saat buat Span/KU
  lengthMeters: z.coerce.number().positive().optional(),
});
export type AddSpanDtoType = z.infer<typeof AddSpanDto>;

export const AddSpanLogDto = z.object({
  category: z.nativeEnum(FtttSpanLogCategory),
  caption:  z.string().max(500).optional(),
  // Legacy — Integra V2: panjang meter dipindah ke FtttSpan.lengthMeters; field tetap optional for back-compat
  meterDone: z.coerce.number().nonnegative().optional(),
});
export type AddSpanLogDtoType = z.infer<typeof AddSpanLogDto>;

// iFORTE GENERAL: total panjang pekerjaan (meter) per project
export const SetTotalPanjangDto = z.object({
  meters: z.coerce.number().positive('Total panjang pekerjaan harus lebih dari 0'),
});
export type SetTotalPanjangDtoType = z.infer<typeof SetTotalPanjangDto>;

// iFORTE Closing: monitoring status pembayaran invoice
export const SetPaymentStatusDto = z.object({
  status: z.enum(['UNPAID', 'PAID']),
});
export type SetPaymentStatusDtoType = z.infer<typeof SetPaymentStatusDto>;

export const FtttProjectFilterDto = z.object({
  company:  z.nativeEnum(FtttCompany).optional(),
  phase:    z.nativeEnum(FtttPhase).optional(),
  status:   z.enum(['ACTIVE', 'COMPLETED', 'ON_HOLD', 'CANCELLED', 'all']).default('all'),
  page:     z.coerce.number().int().positive().default(1),
  limit:    z.coerce.number().int().positive().max(100).default(20),
});
export type FtttProjectFilterDtoType = z.infer<typeof FtttProjectFilterDto>;
