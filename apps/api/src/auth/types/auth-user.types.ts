import { FiberType, Role } from '@prisma/client';

/** Claims attached to `req.user` by JwtStrategy.validate */
export type AuthUser = {
  userId: string;
  email?: string;
  role: Role;
  jti?: string;
  fiberType: FiberType | null;
  exp?: number;
};
