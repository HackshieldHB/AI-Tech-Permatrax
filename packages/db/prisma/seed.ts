import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient, Role, FiberType, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

/** Snapshot exported from DB — regenerate with: npx tsx scripts/generate-seed-users-json.ts */
type SeedUserRecord = {
  id: string;
  name: string;
  email: string;
  password: string;
  role: string;
  signatureUrl: string | null;
  avatarUrl: string | null;
  phone: string | null;
  address: string | null;
  fiberType: string | null;
  isActive: boolean;
  createdBy: string | null;
};

const SEED_USERS: SeedUserRecord[] = JSON.parse(
  readFileSync(join(__dirname, 'seed-users.json'), 'utf8'),
) as SeedUserRecord[];

function buildUserData(user: SeedUserRecord) {
  return {
    name: user.name,
    password: user.password,
    role: user.role as Role,
    isActive: user.isActive,
    // Conditional spread for optional fields — safe if columns don't exist yet
    ...(user.phone != null ? { phone: user.phone } : {}),
    ...(user.avatarUrl != null ? { avatarUrl: user.avatarUrl } : {}),
    ...(user.signatureUrl != null ? { signatureUrl: user.signatureUrl } : {}),
    ...(user.fiberType != null ? { fiberType: user.fiberType as FiberType } : {}),
    ...(user.address != null ? { address: user.address } : {}),
    ...(user.createdBy != null ? { createdBy: user.createdBy } : {}),
  };
}

/** Seed users with stable IDs and createdBy FK order (parents before children). */
async function seedUsers() {
  const seededIds = new Set<string>();
  let pending = [...SEED_USERS];
  let pass = 0;

  while (pending.length > 0 && pass < 25) {
    const nextPass: SeedUserRecord[] = [];

    for (const user of pending) {
      if (user.createdBy && !seededIds.has(user.createdBy)) {
        const parentExists = await prisma.user.findUnique({
          where: { id: user.createdBy },
          select: { id: true },
        });
        if (!parentExists) {
          nextPass.push(user);
          continue;
        }
      }

      const data = buildUserData(user);
      const upserted = await prisma.user.upsert({
        where: { email: user.email },
        update: data,
        create: {
          id: user.id,
          email: user.email,
          ...data,
        },
      });

      seededIds.add(upserted.id);
    }

    if (nextPass.length === pending.length) {
      for (const user of nextPass) {
        const data = { ...buildUserData(user), createdBy: undefined };
        const upserted = await prisma.user.upsert({
          where: { email: user.email },
          update: data,
          create: {
            id: user.id,
            email: user.email,
            ...data,
          },
        });
        seededIds.add(upserted.id);
        console.warn(`[seed] createdBy missing for ${user.email} — seeded without createdBy FK`);
      }
      break;
    }

    pending = nextPass;
    pass++;
  }

  const rows = await prisma.user.findMany({
    where: { email: { in: SEED_USERS.map((u) => u.email) } },
    select: { name: true, email: true, role: true },
    orderBy: { email: 'asc' },
  });

  console.log('\n| Name | Email | Role |');
  console.log('|------|-------|------|');
  for (const row of rows) {
    console.log(`| ${row.name} | ${row.email} | ${row.role} |`);
  }

  console.log(`\nTotal users seeded: ${rows.length}`);
  return rows.length;
}

async function seedFeatureFlags(gmUserId: string) {
  const featureFlags = [
    { featureKey: 'CLEAN_LIST', description: 'Manajemen clean list cluster ISP', roles: ['GENERAL_MANAGER', 'PM_SENIOR', 'PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'SURVEYOR_FTTH', 'SURVEYOR_FTTB', 'SURVEYOR_FTTT'] },
    { featureKey: 'VISIT_REQUEST', description: 'Request kunjungan lapangan', roles: ['GENERAL_MANAGER', 'PM_SENIOR', 'PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'SURVEYOR_FTTH', 'SURVEYOR_FTTB', 'SURVEYOR_FTTT', 'ADMIN'] },
    { featureKey: 'BA_OPEN', description: 'Berita Acara Kunjungan', roles: ['GENERAL_MANAGER', 'PM_SENIOR', 'PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'ADMIN', 'SURVEYOR_FTTH', 'SURVEYOR_FTTB', 'SURVEYOR_FTTT'] },
    { featureKey: 'STOCK_MODULE', description: 'Manajemen stok barang', roles: Object.values(Role) },
    { featureKey: 'ORDER_MODULE', description: 'Order barang untuk proyek', roles: ['GENERAL_MANAGER', 'PM_SENIOR', 'PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'ADMIN_STOCK', 'FINANCE', 'PURCHASING'] },
    { featureKey: 'SURAT_JALAN', description: 'Surat jalan keluar & masuk', roles: ['GENERAL_MANAGER', 'PM_SENIOR', 'PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'ADMIN_STOCK', 'FINANCE'] },
    { featureKey: 'PURCHASE_REQUEST', description: 'Permintaan pembelian ke Finance', roles: ['GENERAL_MANAGER', 'PM_SENIOR', 'PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'FINANCE'] },
    { featureKey: 'GIS_MAP', description: 'Peta GIS jaringan fiber', roles: Object.values(Role) },
    { featureKey: 'SETTINGS', description: 'Pengaturan sistem', roles: ['GENERAL_MANAGER'] },
    { featureKey: 'PERMIT_PIPELINE', description: 'Tracking pipeline perizinan', roles: ['PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'PM_SENIOR', 'ADMIN', 'GENERAL_MANAGER', 'SURVEYOR_FTTH', 'SURVEYOR_FTTB', 'SURVEYOR_FTTT', 'DESIGNER', 'OPERATIONAL_MANAGER'] },
    { featureKey: 'DOCUMENT_LIST', description: 'Daftar dokumen (akses terstandarisasi semua role operasional)', roles: ['ADMIN', 'ADMIN_STOCK', 'PM_SENIOR', 'GENERAL_MANAGER', 'PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'DESIGNER', 'SURVEYOR_FTTH', 'SURVEYOR_FTTB', 'SURVEYOR_FTTT', 'FINANCE', 'PURCHASING', 'OPERATIONAL_MANAGER'] },
    { featureKey: 'CASH_OPERATION', description: 'Cash advance & reimbursement', roles: Object.values(Role) },
  ];

  for (const flag of featureFlags) {
    await prisma.featureFlag.upsert({
      where: { featureKey: flag.featureKey },
      update: {
        description: flag.description,
        roles: flag.roles,
        isEnabled: true,
        updatedBy: gmUserId,
      },
      create: {
        ...flag,
        isEnabled: true,
        updatedBy: gmUserId,
      },
    });
  }
  console.log('[seed] Feature flags upserted.');
}

async function seedFinanceInventory(gmUserId: string) {
  const inventoryProject = await prisma.financeProject.upsert({
    where: { code: 'INVENTORY' },
    update: { status: 'ACTIVE', updatedById: gmUserId },
    create: {
      code: 'INVENTORY',
      name: 'Inventory / Restock Gudang',
      description: 'Default project untuk Order STOCK_RESTOCK',
      totalBudget: new Prisma.Decimal(0),
      materialBudget: null,
      jasaBudget: null,
      isDefaultUncategorized: false,
      status: 'ACTIVE',
      createdById: gmUserId,
      updatedById: gmUserId,
    },
  });

  const inventoryInit = await prisma.budgetLedger.findFirst({
    where: { financeProjectId: inventoryProject.id, entryType: 'BUDGET_INIT' },
  });
  if (!inventoryInit) {
    await prisma.budgetLedger.create({
      data: {
        id: 'clseedledgerinventory0001',
        financeProjectId: inventoryProject.id,
        entryType: 'BUDGET_INIT',
        amount: new Prisma.Decimal(0),
        sourceType: 'MANUAL_ADJUSTMENT',
        sourceId: inventoryProject.id,
        notes: 'Initial seed entry for INVENTORY / restock bucket',
        metadata: {
          isSeed: true,
          previousValues: { totalBudget: 0, materialBudget: null, jasaBudget: null },
          newValues: { totalBudget: 0, materialBudget: null, jasaBudget: null },
        },
        createdById: gmUserId,
      },
    });
  }
  console.log('[seed] INVENTORY finance project ready.');
}

async function main() {
  const count = await seedUsers();

  const gmUser =
    (await prisma.user.findUnique({ where: { email: 'gm@permatrax.com' } })) ??
    (await prisma.user.findUnique({ where: { email: 'liana.tjandra@ilt.co.id' } })) ??
    (await prisma.user.findFirst({ where: { role: Role.GENERAL_MANAGER } }));

  if (gmUser) {
    await seedFeatureFlags(gmUser.id);
    await seedFinanceInventory(gmUser.id);
  } else {
    console.warn('[seed] No GM user found — skipped feature flags and finance project.');
  }

  console.log(`\nSeed complete. ${count} users from seed-users.json (passwords preserved).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
