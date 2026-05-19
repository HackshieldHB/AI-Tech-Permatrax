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
  console.log(JSON.stringify(users, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
