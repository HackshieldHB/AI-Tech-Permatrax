const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const counts = await prisma.permitCluster.groupBy({
    by: ['status'],
    _count: { id: true },
  });
  console.log(JSON.stringify(counts, null, 2));
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
