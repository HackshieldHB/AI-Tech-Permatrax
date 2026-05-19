import { z } from 'zod';
import { Role } from '@prisma/client';

export const UpdateFeatureFlagSchema = z.object({
  roles: z.array(z.nativeEnum(Role)),
  isEnabled: z.boolean(),
});

export type UpdateFeatureFlagDto = z.infer<typeof UpdateFeatureFlagSchema>;
