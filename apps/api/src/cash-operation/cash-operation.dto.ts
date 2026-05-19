import { z } from 'zod';

const lineItemRecord = z.record(z.unknown());

// FIX: CA Stage 1 + reimbursement; CA requires periode (ISO-8601 datetime string)
export const CreateCashOpDto = z
  .object({
    type: z.enum(['CASH_ADVANCE', 'REIMBURSEMENT']).default('CASH_ADVANCE'),
    title: z.string().min(1, 'Judul wajib diisi').max(500).optional(),
    description: z.string().min(1).max(500).optional(),
    notes: z.string().optional(),
    amount: z.coerce.number().optional(),
    totalAmount: z.coerce.number().nonnegative().optional(),
    periodeFrom: z.string().datetime({ message: 'periodeFrom harus ISO-8601 datetime' }).optional(),
    periodeTo: z.string().datetime({ message: 'periodeTo harus ISO-8601 datetime' }).optional(),
    lineItems: z.array(lineItemRecord).optional(),
    photoUrls: z.array(z.string().url('URL foto tidak valid')).optional(),
    category: z.string().optional(),
    projectRef: z.string().optional(),
    fileUrl: z.string().nullable().optional(),
    financeProjectId: z.string().optional(),
    // Issue C: Requester's bank account number
    nomorRekeningPengaju: z.string().optional(),
  })
  .refine((d) => !!(d.title?.trim() || d.description?.trim()), {
    message: 'Judul atau deskripsi wajib diisi',
    path: ['title'],
  })
  .refine((d) => (d.amount ?? d.totalAmount ?? 0) > 0, {
    message: 'Jumlah harus lebih dari 0',
    path: ['amount'],
  })
  .refine(
    (d) => {
      if (d.type !== 'CASH_ADVANCE') return true;
      if (!d.periodeFrom || !d.periodeTo) return false;
      return new Date(d.periodeFrom).getTime() <= new Date(d.periodeTo).getTime();
    },
    {
      message: 'Cash Advance memerlukan periode (dari–sampai) yang valid',
      path: ['periodeTo'],
    },
  )
  .refine((d) => d.type !== 'REIMBURSEMENT' || (d.photoUrls?.length ?? 0) > 0, {
    message: 'Reimbursement memerlukan minimal 1 foto bukti',
    path: ['photoUrls'],
  });

export const ApproveStepDto = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('APPROVE'),
    notes: z.string().optional(),
    approvedAmount: z.coerce
      .number()
      .positive('Nominal disetujui harus lebih dari 0')
      .optional(),
  }),
  z.object({
    action: z.literal('REJECT'),
    notes: z.string().optional(),
  }),
]);

export const DisburseDto = z.object({
  disbursedAmount: z.number().positive(),
  notes: z.string().optional(),
});

export const FilterCashOpDto = z.object({
  type: z.enum(['CASH_ADVANCE', 'REIMBURSEMENT']).optional(),
  status: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(20),
});

export const UploadAttachmentDto = z.object({
  fileName: z.string().min(1),
  fileUrl: z.string().url(),
  fileSize: z.number().int().positive().optional(),
  mimeType: z.string().optional(),
});

export type CreateCashOpDto = z.infer<typeof CreateCashOpDto>;
export type ApproveStepDto = z.infer<typeof ApproveStepDto>;
export type DisburseDto = z.infer<typeof DisburseDto>;
export type FilterCashOpDto = z.infer<typeof FilterCashOpDto>;
export type UploadAttachmentDto = z.infer<typeof UploadAttachmentDto>;
