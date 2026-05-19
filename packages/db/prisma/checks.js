const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://postgres:password@127.0.0.1:5432/permatrack?schema=public"
    }
  }
});

async function main() {
  console.log('--- CHECK 1 — Existing Realisasi Records ---');
  try {
    // Note: Checking realisasiStatus in CashOperationRequest as per schema.prisma
    const counts = await prisma.cashOperationRequest.groupBy({
      by: ['realisasiStatus'],
      _count: { id: true },
      where: { realisasiStatus: { not: null } }
    });
    console.log(JSON.stringify(counts, null, 2));
  } catch (e) {
    console.log('Error CHECK 1:', e.message);
  }

  console.log('\n--- CHECK 2 — Current RealisasiStatus enum values ---');
  try {
    const enums = await prisma.$queryRawUnsafe('SELECT unnest(enum_range(NULL::"RealisasiStatus")) as value');
    console.log(JSON.stringify(enums, null, 2));
  } catch (e) {
    console.log('Error CHECK 2:', e.message);
  }

  console.log('\n--- CHECK 3 — Intermediate states ---');
  try {
    // Intermediate = not DRAFT, DONE, APPROVED, or REJECTED
    // Note: APPROVED is not in the current enum, but added to match user's logic
    const intermediate = await prisma.cashOperationRequest.findMany({
      where: {
        realisasiStatus: {
          notIn: ['DRAFT', 'DONE', 'APPROVED', 'REJECTED']
        }
      },
      select: { id: true, realisasiStatus: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 10
    });
    console.log(JSON.stringify(intermediate, null, 2));
  } catch (e) {
    console.log('Error CHECK 3:', e.message);
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
