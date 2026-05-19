const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- IspCustomer ---');
  const customers = await prisma.$queryRaw`SELECT id, name FROM "IspCustomer" ORDER BY name`;
  console.log(JSON.stringify(customers, null, 2));

  console.log('\n--- FiberType Enum ---');
  const fiberTypes = await prisma.$queryRaw`SELECT unnest(enum_range(NULL::"FiberType")) as type`;
  console.log(JSON.stringify(fiberTypes, null, 2));
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
