-- GIS FTTT tower objects (existing / on progress / planning)

CREATE TYPE "GisTowerStatus" AS ENUM ('EXISTING', 'ON_PROGRESS', 'PLANNING');

CREATE TABLE "GisTower" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "status" "GisTowerStatus" NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GisTower_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GisTower_status_idx" ON "GisTower"("status");
CREATE INDEX "GisTower_createdById_idx" ON "GisTower"("createdById");

ALTER TABLE "GisTower" ADD CONSTRAINT "GisTower_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
