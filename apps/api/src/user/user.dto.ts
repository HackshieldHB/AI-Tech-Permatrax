import { z } from 'zod';
import { Role, FiberType } from '@prisma/client';
import { PaginationQuerySchema } from '../common/dto/pagination.dto';

const FIBER_ROLES: Role[] = [
  Role.PM_FTTH,
  Role.PM_FTTB,
  Role.PM_FTTT,
  Role.SURVEYOR_FTTH,
  Role.SURVEYOR_FTTB,
  Role.SURVEYOR_FTTT,
];

export function isFiberRoleType(role: Role): boolean {
  return FIBER_ROLES.includes(role);
}

export const CreateUserSchema = z
  .object({
    email: z.string().email(),
    name: z.string().min(2).max(100),
    password: z
      .string()
      .min(8)
      .regex(/[A-Z]/, 'Harus ada huruf kapital')
      .regex(/[0-9]/, 'Harus ada angka'),
    role: z.nativeEnum(Role),
    fiberType: z.nativeEnum(FiberType).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (isFiberRoleType(data.role) && (data.fiberType === undefined || data.fiberType === null)) {
      ctx.addIssue({ code: 'custom', message: 'Fiber type wajib untuk role PM/Surveyor', path: ['fiberType'] });
    }
  });

export const UpdateUserSchema = z
  .object({
    name: z.string().min(2).max(100).optional(),
    role: z.nativeEnum(Role).optional(),
    fiberType: z.nativeEnum(FiberType).optional().nullable(),
    isActive: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role !== undefined && isFiberRoleType(data.role) && (data.fiberType === undefined || data.fiberType === null)) {
      ctx.addIssue({ code: 'custom', message: 'Fiber type wajib untuk role PM/Surveyor', path: ['fiberType'] });
    }
  });

export const ChangePasswordSchema = z.object({
  newPassword: z
    .string()
    .min(8)
    .regex(/[A-Z]/, 'Harus ada huruf kapital')
    .regex(/[0-9]/, 'Harus ada angka'),
});

// Self-service: user ganti password sendiri — wajib verifikasi currentPassword
export const SelfChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Password saat ini wajib diisi'),
    newPassword: z
      .string()
      .min(8, 'Minimal 8 karakter')
      .regex(/[A-Z]/, 'Harus ada huruf kapital')
      .regex(/[0-9]/, 'Harus ada angka'),
    confirmPassword: z.string().min(1, 'Konfirmasi password wajib diisi'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Password baru dan konfirmasi tidak cocok',
    path: ['confirmPassword'],
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'Password baru tidak boleh sama dengan password lama',
    path: ['newPassword'],
  });

export const UserListFilterSchema = PaginationQuerySchema.merge(z.object({
  role: z.nativeEnum(Role).optional(),
  fiberType: z.nativeEnum(FiberType).optional(),
  isActive: z.coerce.boolean().optional(),
  search: z.string().optional(),
}));

export type CreateUserDto = z.infer<typeof CreateUserSchema>;
export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;
export type ChangePasswordDto = z.infer<typeof ChangePasswordSchema>;
export type SelfChangePasswordDto = z.infer<typeof SelfChangePasswordSchema>;
export type UserListFilterDto = z.infer<typeof UserListFilterSchema>;
export type UserFilterDto = UserListFilterDto;
