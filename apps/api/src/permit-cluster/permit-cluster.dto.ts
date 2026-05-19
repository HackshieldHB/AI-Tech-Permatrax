import { z } from 'zod';
import { FiberType, PermitClusterStatus, PermitPhase } from '@prisma/client';
import { PaginationQuerySchema } from '../common/dto/pagination.dto';

// MODIFIED: list filters + pagination
export const PermitClusterFilterDto = PaginationQuerySchema.merge(z.object({
  fiberType:    z.nativeEnum(FiberType).optional(),
  status:       z.nativeEnum(PermitClusterStatus).optional(),
  currentPhase: z.nativeEnum(PermitPhase).optional(),
  ispCustomer:  z.string().optional(),
  search:       z.string().optional(),
}));

export type PermitClusterFilterDtoType = z.infer<typeof PermitClusterFilterDto>;
