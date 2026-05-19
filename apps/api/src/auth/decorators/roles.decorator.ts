import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

// MODIFIED: Now typed against Prisma Role enum for compile-time safety
export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
