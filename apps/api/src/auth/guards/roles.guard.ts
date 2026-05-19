import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

// MODIFIED: Full rewrite — typed with Prisma Role enum, Indonesian error messages
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // NEW: No @Roles() decorator = route accessible to any authenticated user
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();

    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        `Akses ditolak. Role yang diizinkan: ${requiredRoles.join(', ')}`
      );
    }
    return true;
  }
}
