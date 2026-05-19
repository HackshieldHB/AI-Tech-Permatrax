import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const r = await p.financeProject.findUnique({ where: { code: 'GENERAL' } });
console.log(JSON.stringify(r, null, 2));
await p.$disconnect();
