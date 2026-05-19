/**
 * Regenerate prisma/seed-users.json from the current database.
 * Run: npx tsx scripts/generate-seed-users-json.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      password: true,
      role: true,
      signatureUrl: true,
      avatarUrl: true,
      phone: true,
      address: true,
      fiberType: true,
      isActive: true,
      createdBy: true,
    },
    orderBy: { email: 'asc' },
  });

  const outPath = join(__dirname, '..', 'prisma', 'seed-users.json');
  writeFileSync(outPath, JSON.stringify(users, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${users.length} users to ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
