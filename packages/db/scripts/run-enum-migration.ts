/**
 * NEW: Executes manual Role enum SQL via Prisma CLI (handles DO $$ blocks — no naive `;` split).
 */
import { execSync } from 'child_process';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting Role enum migration...');
  const root = path.join(__dirname, '..');
  const sqlPath = path.join(root, 'prisma', 'migrations', 'manual_role_enum_fix', 'migration.sql');
  const schemaPath = path.join(root, 'prisma', 'schema.prisma');

  try {
    execSync(`npx prisma db execute --schema "${schemaPath}" --file "${sqlPath}"`, {
      cwd: root,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env },
    });

    const distribution = await prisma.$queryRaw<
      { role: string; count: bigint }[]
    >`SELECT role::text as role, COUNT(*)::bigint as count FROM "User" GROUP BY role ORDER BY role`;
    console.log('Role distribution after migration:', distribution);
    console.log('Migration completed successfully!');
  } catch (e) {
    console.error('Migration failed:', e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
