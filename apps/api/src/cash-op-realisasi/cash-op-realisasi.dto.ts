import { z } from 'zod';

export const RealisasiItemSchema = z.object({
  itemNumber: z.coerce.number().int().min(1, 'Nomor urut harus >= 1'),
  description: z.string().min(1, 'Keterangan wajib diisi').max(500),
  paymentDate: z.string().datetime({ message: 'Format tanggal pembayaran tidak valid' }),
  amount: z.coerce.number().positive('Nominal harus lebih dari 0'),
  photoUrl: z.string().url().optional().nullable(),
});

export const RealisasiDraftDto = z
  .object({
    items: z.array(RealisasiItemSchema).min(1, 'Minimal satu item harus diisi'),
  })
  .refine(
    (data) => {
      const numbers = data.items.map((i) => i.itemNumber);
      return new Set(numbers).size === numbers.length;
    },
    { message: 'Nomor urut item harus unik' },
  );

export const RealisasiApproveDto = z.object({
  notes: z.string().optional(),
  hasilCheckingFinance: z.string().optional(),
});

export const RealisasiRejectDto = z.object({
  reason: z.string().min(1, 'Alasan penolakan wajib diisi').max(1000),
});

export type RealisasiDraftDtoType = z.infer<typeof RealisasiDraftDto>;
export type RealisasiApproveDtoType = z.infer<typeof RealisasiApproveDto>;
export type RealisasiRejectDtoType = z.infer<typeof RealisasiRejectDto>;
