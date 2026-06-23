import { z } from 'zod';

/** Request a password-reset email. Always answered generically (no account enumeration). */
export const ForgotPasswordSchema = z.object({
  email: z.string().email('Email tidak valid'),
});

/** Complete a password reset using the token from the emailed link. */
export const ResetPasswordSchema = z.object({
  token: z.string().min(1, 'Token reset wajib diisi'),
  newPassword: z
    .string()
    .min(8, 'Minimal 8 karakter')
    .regex(/[A-Z]/, 'Harus ada huruf kapital')
    .regex(/[0-9]/, 'Harus ada angka'),
});

export type ForgotPasswordDto = z.infer<typeof ForgotPasswordSchema>;
export type ResetPasswordDto = z.infer<typeof ResetPasswordSchema>;
