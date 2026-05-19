/**
 * seed-users.ts
 * -------------
 * Seed script untuk membuat user dari data Email User.xlsx (sheet INTEGRA).
 *
 * Jalankan dengan:
 *   npx ts-node -r tsconfig-paths/register src/scripts/seed-users.ts
 *
 * Pastikan DATABASE_URL sudah terset di .env sebelum menjalankan script ini.
 *
 * Default password: Permatrack1  (wajib diganti setelah login pertama)
 * Password harus memenuhi: min 8 karakter, ada huruf kapital, ada angka.
 */

import { PrismaClient, Role, FiberType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const SALT_ROUNDS = 10;
const DEFAULT_PASSWORD = 'Permatrack1';

// ─── Data User dari Excel (sheet INTEGRA) ─────────────────────────────────────
// Email sudah dibersihkan: hapus zero-width chars (⁠), trim spasi
// fiberType hanya diisi untuk role PM_* dan SURVEYOR_*
// ──────────────────────────────────────────────────────────────────────────────

interface UserSeed {
  name: string;
  email: string;
  role: Role;
  fiberType?: FiberType | null;
}

// ── GM dulu (mereka akan menjadi createdBy untuk user lainnya) ──────────────
const GM_USERS: UserSeed[] = [
  { name: 'Liana Tjandra', email: 'liana.tjandra@ilt.co.id',  role: Role.GENERAL_MANAGER },
  { name: 'Elfri Jufri',   email: 'elfri.jufri@ilt.co.id',   role: Role.GENERAL_MANAGER },
];

// ── Semua user lainnya ──────────────────────────────────────────────────────
const OTHER_USERS: UserSeed[] = [
  // ── All Access → ADMIN ──────────────────────────────────────────────────
  { name: 'Ikrar Adinata', email: 'ikraradinataarin@ilt.co.id',  role: Role.ADMIN },
  { name: 'Kevin',         email: 'Kevin.Julian@ilt.co.id',      role: Role.ADMIN },
  { name: 'Adel',          email: 'Adelya.indahwati@ilt.co.id',  role: Role.ADMIN },
  { name: 'Nadjwa',        email: 'Nadjwa.fazira@ilt.co.id',     role: Role.ADMIN },

  // ── PM SENIOR ────────────────────────────────────────────────────────────
  { name: 'Ahmad',         email: 'ahmad.triantok@ilt.co.id',    role: Role.PM_SENIOR },

  // ── Finance & Purchasing → PURCHASING ────────────────────────────────────
  { name: 'Meliyani',      email: 'meliyani@ilt.co.id',          role: Role.PURCHASING },

  // ── Designer ─────────────────────────────────────────────────────────────
  { name: 'Rosyid',        email: 'rosyid@ilt.co.id',            role: Role.DESIGNER },
  { name: 'Gufran',        email: 'gufran.setiawan@ilt.co.id',   role: Role.DESIGNER },

  // ── Surveyor (default FTTH) ───────────────────────────────────────────────
  { name: 'Kasto',         email: 'kasto@ilt.co.id',             role: Role.SURVEYOR_FTTH, fiberType: FiberType.FTTH },
  { name: 'Dede',          email: 'dede.muhidin@ilt.co.id',      role: Role.SURVEYOR_FTTH, fiberType: FiberType.FTTH },
  { name: 'Anggih',        email: 'anggih.marselly@ilt.co.id',   role: Role.SURVEYOR_FTTH, fiberType: FiberType.FTTH },
  { name: 'Ibnu',          email: 'ibnu.suhada@ilt.co.id',       role: Role.SURVEYOR_FTTH, fiberType: FiberType.FTTH },
  { name: 'Nurdin',        email: 'nurdin@ilt.co.id',            role: Role.SURVEYOR_FTTH, fiberType: FiberType.FTTH },
  { name: 'Asep',          email: 'asep.awaludin@ilt.co.id',     role: Role.SURVEYOR_FTTH, fiberType: FiberType.FTTH },

  // ── PM dengan fiber type spesifik ─────────────────────────────────────────
  { name: 'Yanuar',        email: 'yanuarwijanarko@ilt.co.id',   role: Role.PM_FTTT, fiberType: FiberType.FTTT },
  { name: 'Aris',          email: 'muhamad.aristya@ilt.co.id',   role: Role.PM_FTTH, fiberType: FiberType.FTTH },

  // ── PM tanpa spesifik fiber → default FTTH ───────────────────────────────
  { name: 'Yusuf',         email: 'muhamad.yusuf@ilt.co.id',     role: Role.PM_FTTH, fiberType: FiberType.FTTH },
  { name: 'Suyitno',       email: 'suyitno@ilt.co.id',           role: Role.PM_FTTH, fiberType: FiberType.FTTH },

  // ── Finance ───────────────────────────────────────────────────────────────
  { name: 'Arif',          email: 'arif@ilt.co.id',              role: Role.FINANCE },
  { name: 'Andres',        email: 'andrespurnama@ilt.co.id',     role: Role.FINANCE },
  { name: 'Eko',           email: 'eko.firdha@ilt.co.id',        role: Role.FINANCE },

  // ── Operational Manager ───────────────────────────────────────────────────
  { name: 'Hadsih',        email: 'dede.hadsih@ilt.co.id',       role: Role.OPERATIONAL_MANAGER },

  // ── Marketing ─────────────────────────────────────────────────────────────
  { name: 'Adityo',        email: 'pradono.adityo@ilt.co.id',    role: Role.MARKETING },

  // ── Marketing Head ────────────────────────────────────────────────────────
  { name: 'Cece',          email: 'dessy.anggraeni@ilt.co.id',   role: Role.MARKETING_HEAD },

  // ── Admin ─────────────────────────────────────────────────────────────────
  { name: 'Ferry',         email: 'ferry.surya@ilt.co.id',       role: Role.ADMIN },
  { name: 'Alfiah',        email: 'alfiah@ilt.co.id',            role: Role.ADMIN },
  { name: 'Tari',          email: 'sri.lestari@ilt.co.id',       role: Role.ADMIN },
  { name: 'Annisa',        email: 'annisa.dzulfani@ilt.co.id',   role: Role.ADMIN },
  { name: 'Gres',          email: 'gresilda.ivahenda@ilt.co.id', role: Role.ADMIN },
  { name: 'Anita',         email: 'anita.ayu@ilt.co.id',         role: Role.ADMIN },
  { name: 'Reza',          email: 'reza.respati@ilt.co.id',       role: Role.ADMIN },
  { name: 'Kartika',       email: 'kartika@ilt.co.id',           role: Role.ADMIN },

  // ── Admin Stock ───────────────────────────────────────────────────────────
  { name: 'Alika',         email: 'alika.fatmala@ilt.co.id',     role: Role.ADMIN_STOCK },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

async function upsertUser(
  seed: UserSeed,
  createdById: string,
  passwordHash: string,
): Promise<void> {
  const email = seed.email.toLowerCase().trim();

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    console.log(`  ⏭️  Skip (sudah ada): ${email}`);
    return;
  }

  await prisma.user.create({
    data: {
      name:      seed.name,
      email,
      password:  passwordHash,
      role:      seed.role,
      fiberType: seed.fiberType ?? null,
      isActive:  true,
      createdBy: createdById,
    },
  });

  console.log(`  ✅ Dibuat: ${seed.name} <${email}> → ${seed.role}${seed.fiberType ? ` [${seed.fiberType}]` : ''}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 Mulai seed users dari Email User.xlsx (sheet INTEGRA)...\n');

  const passwordHash = await hashPassword(DEFAULT_PASSWORD);
  console.log(`🔐 Default password: "${DEFAULT_PASSWORD}" (hash: ${passwordHash.slice(0, 20)}...)\n`);

  // ── Step 1: Buat GM users dulu (sebagai createdBy) ──────────────────────
  console.log('── [1/2] Membuat GM users...');
  for (const gm of GM_USERS) {
    const email = gm.email.toLowerCase().trim();
    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      console.log(`  ⏭️  GM sudah ada: ${email} (id: ${existing.id})`);
    } else {
      await prisma.user.create({
        data: {
          name:     gm.name,
          email,
          password: passwordHash,
          role:     gm.role,
          isActive: true,
          // GM pertama tidak ada createdBy (bootstrap)
        },
      });
      console.log(`  ✅ GM dibuat: ${gm.name} <${email}>`);
    }
  }

  // Ambil ID GM pertama untuk dipakai sebagai createdBy
  const primaryGm = await prisma.user.findUnique({
    where: { email: GM_USERS[0].email.toLowerCase() },
    select: { id: true, name: true },
  });

  if (!primaryGm) {
    throw new Error('Gagal mendapatkan GM user sebagai createdBy.');
  }

  console.log(`\n  👤 createdBy → ${primaryGm.name} (id: ${primaryGm.id})\n`);

  // ── Step 2: Buat semua user lainnya ─────────────────────────────────────
  console.log('── [2/2] Membuat user lainnya...');
  for (const user of OTHER_USERS) {
    await upsertUser(user, primaryGm.id, passwordHash);
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  const total = await prisma.user.count();
  const byRole = await prisma.user.groupBy({
    by: ['role'],
    _count: { _all: true },
    orderBy: { _count: { role: 'desc' } },
  });

  console.log(`\n✅ Selesai! Total user di database: ${total}`);
  console.log('📊 Distribusi per role:');
  byRole.forEach((r) =>
    console.log(`   ${r.role.padEnd(25)} : ${r._count._all}`),
  );

  console.log('\n⚠️  PENTING: Minta semua user ganti password setelah login pertama!');
  console.log(`   Default password: ${DEFAULT_PASSWORD}\n`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
