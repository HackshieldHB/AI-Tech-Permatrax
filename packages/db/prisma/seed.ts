import { PrismaClient, Role, FiberType, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const users: Array<{
    email: string;
    name: string;
    role: Role;
    fiberType: FiberType | null;
    passwordPlain: string;
  }> = [
    {
      email: 'gm@permatrax.com',
      name: 'General Manager',
      role: Role.GENERAL_MANAGER,
      fiberType: null,
      passwordPlain: 'GMPassword123!',
    },
    {
      email: 'pm.senior@permatrax.com',
      name: 'Senior Project Manager',
      role: Role.PM_SENIOR,
      fiberType: null,
      passwordPlain: 'PMSPassword123!',
    },
    {
      email: 'pm.ftth@permatrax.com',
      name: 'PM FTTH',
      role: Role.PM_FTTH,
      fiberType: FiberType.FTTH,
      passwordPlain: 'PMPassword123!',
    },
    {
      email: 'pm.fttb@permatrax.com',
      name: 'PM FTTB',
      role: Role.PM_FTTB,
      fiberType: FiberType.FTTB,
      passwordPlain: 'PMPassword123!',
    },
    {
      email: 'pm.fttt@permatrax.com',
      name: 'PM FTTT',
      role: Role.PM_FTTT,
      fiberType: FiberType.FTTT,
      passwordPlain: 'PMPassword123!',
    },
    {
      email: 'surveyor.ftth@permatrax.com',
      name: 'Surveyor FTTH',
      role: Role.SURVEYOR_FTTH,
      fiberType: FiberType.FTTH,
      passwordPlain: 'SurveyPassword123!',
    },
    {
      email: 'surveyor.fttb@permatrax.com',
      name: 'Surveyor FTTB',
      role: Role.SURVEYOR_FTTB,
      fiberType: FiberType.FTTB,
      passwordPlain: 'SurveyPassword123!',
    },
    {
      email: 'surveyor.fttt@permatrax.com',
      name: 'Surveyor FTTT',
      role: Role.SURVEYOR_FTTT,
      fiberType: FiberType.FTTT,
      passwordPlain: 'SurveyPassword123!',
    },
    {
      email: 'admin@permatrax.com',
      name: 'System Admin',
      role: Role.ADMIN,
      fiberType: null,
      passwordPlain: 'AdminPassword123!',
    },
    {
      email: 'admin.stock@permatrax.com',
      name: 'Stock Admin',
      role: Role.ADMIN_STOCK,
      fiberType: null,
      passwordPlain: 'AdminPassword123!',
    },
    {
      email: 'finance@permatrax.com',
      name: 'Finance Controller',
      role: Role.FINANCE,
      fiberType: null,
      passwordPlain: 'FinancePassword123!',
    },
    {
      email: 'marketing@permatrax.com',
      name: 'Marketing Officer',
      role: Role.MARKETING,
      fiberType: null,
      passwordPlain: 'Marketing123!',
    },
    {
      email: 'marketing.head@permatrax.com',
      name: 'Marketing Head',
      role: Role.MARKETING_HEAD,
      fiberType: null,
      passwordPlain: 'MarketingHead123!',
    },
    {
      email: 'ops.manager@permatrax.com',
      name: 'Operational Manager',
      role: Role.OPERATIONAL_MANAGER,
      fiberType: null,
      passwordPlain: 'OpsManager123!',
    },
    {
      email: 'purchasing@permatrax.com',
      name: 'Purchasing',
      role: Role.PURCHASING,
      fiberType: null,
      passwordPlain: 'Purchasing123!',
    },
    {
      email: 'designer@permatrax.com', // FIX Issue 10: dedicated Designer seed for HLD/LLD uploads
      name: 'Design Team',
      role: Role.DESIGNER, // FIX Issue 10: new DESIGNER role
      fiberType: null,
      passwordPlain: 'DesignerPassword123!',
    },
  ];

  for (const user of users) {
    const { passwordPlain, ...rest } = user;
    const hashedPassword = await bcrypt.hash(passwordPlain, 10);

    const upserted = await prisma.user.upsert({
      where: { email: user.email },
      update: {
        name: rest.name,
        role: rest.role,
        fiberType: rest.fiberType,
        password: hashedPassword,
        isActive: true,
      },
      create: {
        email: rest.email,
        name: rest.name,
        role: rest.role,
        fiberType: rest.fiberType,
        password: hashedPassword,
        isActive: true,
      },
    });

    console.log(`Upserted user: ${upserted.email} [${upserted.role}] — ${upserted.name}`);
  }

  const testUser = await prisma.user.findUnique({ where: { email: 'admin@permatrax.com' } });
  if (testUser) {
    const valid = await bcrypt.compare('AdminPassword123!', testUser.password);
    console.log(`[Seed Verify] admin password hash valid: ${valid}`);
    if (!valid) {
      console.error('[Seed Verify] PASSWORD HASH MISMATCH — re-hashing all users...');
      const verifyUsers = [
        { email: 'gm@permatrax.com', password: 'GMPassword123!' },
        { email: 'pm.senior@permatrax.com', password: 'PMSPassword123!' },
        { email: 'pm.ftth@permatrax.com', password: 'PMPassword123!' },
        { email: 'pm.fttb@permatrax.com', password: 'PMPassword123!' },
        { email: 'pm.fttt@permatrax.com', password: 'PMPassword123!' },
        { email: 'admin@permatrax.com', password: 'AdminPassword123!' },
        { email: 'admin.stock@permatrax.com', password: 'AdminPassword123!' },
        { email: 'finance@permatrax.com', password: 'FinancePassword123!' },
        { email: 'surveyor.ftth@permatrax.com', password: 'SurveyPassword123!' },
        { email: 'surveyor.fttb@permatrax.com', password: 'SurveyPassword123!' },
        { email: 'surveyor.fttt@permatrax.com', password: 'SurveyPassword123!' },
      ];
      for (const u of verifyUsers) {
        const hashed = await bcrypt.hash(u.password, 10);
        await prisma.user.update({
          where: { email: u.email },
          data: { password: hashed },
        });
        console.log(`[Seed Verify] Re-hashed: ${u.email}`);
      }
    }
  }

  const gmUser = await prisma.user.findUnique({ where: { email: 'gm@permatrax.com' } });
  if (gmUser) {
    const featureFlags = [
      { featureKey: 'CLEAN_LIST', description: 'Manajemen clean list cluster ISP', roles: ['GENERAL_MANAGER', 'PM_SENIOR', 'PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'SURVEYOR_FTTH', 'SURVEYOR_FTTB', 'SURVEYOR_FTTT'] },
      { featureKey: 'VISIT_REQUEST', description: 'Request kunjungan lapangan', roles: ['GENERAL_MANAGER', 'PM_SENIOR', 'PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'SURVEYOR_FTTH', 'SURVEYOR_FTTB', 'SURVEYOR_FTTT', 'ADMIN'] },
      { featureKey: 'BA_OPEN', description: 'Berita Acara Kunjungan', roles: ['GENERAL_MANAGER', 'PM_SENIOR', 'PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'ADMIN', 'SURVEYOR_FTTH', 'SURVEYOR_FTTB', 'SURVEYOR_FTTT'] }, // FIX: align nav + RBAC with surveyor visibility
      { featureKey: 'STOCK_MODULE', description: 'Manajemen stok barang', roles: Object.values(Role) },
      { featureKey: 'ORDER_MODULE', description: 'Order barang untuk proyek', roles: ['GENERAL_MANAGER', 'PM_SENIOR', 'PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'ADMIN_STOCK', 'FINANCE', 'PURCHASING'] },
      { featureKey: 'SURAT_JALAN', description: 'Surat jalan keluar & masuk', roles: ['GENERAL_MANAGER', 'PM_SENIOR', 'PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'ADMIN_STOCK', 'FINANCE'] },
      { featureKey: 'PURCHASE_REQUEST', description: 'Permintaan pembelian ke Finance', roles: ['GENERAL_MANAGER', 'PM_SENIOR', 'PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'FINANCE'] },
      { featureKey: 'GIS_MAP', description: 'Peta GIS jaringan fiber', roles: Object.values(Role) },
      { featureKey: 'SETTINGS', description: 'Pengaturan sistem', roles: ['GENERAL_MANAGER'] },
      { featureKey: 'PERMIT_PIPELINE', description: 'Tracking pipeline perizinan', roles: ['PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'PM_SENIOR', 'ADMIN', 'GENERAL_MANAGER', 'SURVEYOR_FTTH', 'SURVEYOR_FTTB', 'SURVEYOR_FTTT', 'DESIGNER', 'OPERATIONAL_MANAGER'] }, // FIX Issue 8/10: include DESIGNER + OPS so pipeline opens without 403
      { featureKey: 'DOCUMENT_LIST', description: 'Daftar dokumen yang disetujui', roles: ['ADMIN', 'PM_SENIOR', 'GENERAL_MANAGER', 'PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'DESIGNER'] }, // FIX Issue 10: designer needs to see document list
      { featureKey: 'CASH_OPERATION', description: 'Cash advance & reimbursement', roles: Object.values(Role) },
    ];

    for (const flag of featureFlags) {
      await prisma.featureFlag.upsert({
        where: { featureKey: flag.featureKey },
        update: {
          description: flag.description,
          roles: flag.roles,
          isEnabled: true,
          updatedBy: gmUser.id,
        }, // FIX: re-seed updates role matrix so GM toggles stay in sync with code
        create: {
          ...flag,
          isEnabled: true,
          updatedBy: gmUser.id,
        },
      });
    }
    console.log('Feature flags seeded.');

    const inventoryProject = await prisma.financeProject.upsert({
      where: { code: 'INVENTORY' },
      update: {
        status: 'ACTIVE',
        updatedById: gmUser.id,
      },
      create: {
        code: 'INVENTORY',
        name: 'Inventory / Restock Gudang',
        description: 'Default project untuk Order STOCK_RESTOCK',
        totalBudget: new Prisma.Decimal(0),
        materialBudget: null,
        jasaBudget: null,
        isDefaultUncategorized: false,
        status: 'ACTIVE',
        createdById: gmUser.id,
        updatedById: gmUser.id,
      },
    });
    console.log('✓ INVENTORY project seeded:', inventoryProject.id);

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
          createdById: gmUser.id,
        },
      });
      console.log('✓ INVENTORY BUDGET_INIT ledger row created');
    }
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
