import { z } from 'zod';

const optionalInvoiceFileUrl = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.string().url('URL file tagihan tidak valid').optional(),
);

export const UploadInvoiceDto = z
  .object({
    orderId: z.string().min(1, 'Order ID wajib'),
    invoiceFileUrl: optionalInvoiceFileUrl,
    invoiceAmount: z.coerce.number().positive('Nominal tagihan harus > 0'),
    paymentMethod: z.enum(['CBD', 'COD', 'TERMIN']),
    paymentDueDate: z.string().datetime().optional(),
  })
  .refine(
    (data) => {
      if (data.paymentMethod === 'TERMIN') {
        return !!data.paymentDueDate;
      }
      return true;
    },
    {
      message: 'Tanggal jatuh tempo wajib diisi untuk metode TERMIN',
      path: ['paymentDueDate'],
    },
  );

export const UpdateInvoiceDto = z.object({
  invoiceFileUrl: optionalInvoiceFileUrl,
  invoiceAmount: z.coerce.number().positive().optional(),
  paymentMethod: z.enum(['CBD', 'COD', 'TERMIN']).optional(),
  paymentDueDate: z.string().datetime().optional().nullable(),
});

export const SupplierAckDto = z.object({
  notes: z.string().optional(),
});

export const SupplierRejectDto = z.object({
  reason: z.string().min(1, 'Alasan penolakan wajib diisi').max(1000),
});

export const FilterInvoiceDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z
    .enum(['DRAFT', 'SENT_TO_SUPPLIER', 'APPROVED_BY_SUPPLIER', 'REJECTED_BY_SUPPLIER', 'all'])
    .optional()
    .default('all'),
  paymentMethod: z.enum(['CBD', 'COD', 'TERMIN', 'all']).optional().default('all'),
});

export type UploadInvoiceDtoType = z.infer<typeof UploadInvoiceDto>;
export type UpdateInvoiceDtoType = z.infer<typeof UpdateInvoiceDto>;
export type SupplierAckDtoType = z.infer<typeof SupplierAckDto>;
export type SupplierRejectDtoType = z.infer<typeof SupplierRejectDto>;
export type FilterInvoiceDtoType = z.infer<typeof FilterInvoiceDto>;
