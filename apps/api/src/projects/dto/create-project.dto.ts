import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const createProjectSchema = z.object({
  projectCode: z.string()
    .min(5, 'Project code must enforce minimal tracking entropy')
    .regex(/^PRJ-\d{4}-\d{3}$/, 'Strict regex violation: Project code must match PRJ-YYYY-NNN format'),
  namaProyek: z.string()
    .min(3, 'Project name requires minimal classification bounds'),
  regionalArea: z.enum(['SUMATERA', 'JAWA', 'BALI', 'SULAWESI']),
  lokasiProyek: z.string()
    .min(3, 'Project location requires minimal classification bounds'),
  noPO: z.string()
    .min(3, 'PO number requires minimal classification bounds'),
  namaPelaksana: z.string()
    .min(3, 'Contractor name requires minimal classification bounds'),
  status: z.enum(['PERMIT', 'SURVEY', 'DESIGN', 'IMPLEMENTATION', 'ATP', 'CLOSING']),
  tanggalPerjanjian: z.string().datetime({ message: 'tanggalPerjanjian strictly evaluates against ISO string paradigms' })
});

// Leverage dynamic NestJS proxy resolving typescript signatures structurally based on run-time payload Zod evaluations
export class CreateProjectDto extends createZodDto(createProjectSchema) {}
