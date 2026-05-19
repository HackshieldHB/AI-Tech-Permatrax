-- Network design persistence (GIS FTTH topology). PostGIS geometry types; extension already enabled on datasource.

-- CreateEnum
CREATE TYPE "NodeType" AS ENUM ('OLT', 'ODC', 'ODP', 'SPLITTER', 'POLE', 'SPLICE', 'CONNECTOR');

-- CreateEnum
CREATE TYPE "EdgeType" AS ENUM ('FEEDER', 'DISTRIBUTION', 'DROP');

-- CreateEnum
CREATE TYPE "NodeOrigin" AS ENUM ('AUTO', 'MANUAL', 'MODIFIED');

-- CreateEnum
CREATE TYPE "DesignStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "NetworkDesign" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "calcInputs" JSONB NOT NULL,
    "baseTopology" JSONB NOT NULL,
    "status" "DesignStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NetworkDesign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetworkNode" (
    "id" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "type" "NodeType" NOT NULL,
    "origin" "NodeOrigin" NOT NULL,
    "geom" geometry(Point, 4326) NOT NULL,
    "properties" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NetworkNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetworkEdge" (
    "id" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "type" "EdgeType" NOT NULL,
    "origin" "NodeOrigin" NOT NULL,
    "geom" geometry(LineString, 4326) NOT NULL,
    "properties" JSONB NOT NULL,

    CONSTRAINT "NetworkEdge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NetworkDesign_projectId_idx" ON "NetworkDesign"("projectId");

-- CreateIndex
CREATE INDEX "NetworkNode_designId_idx" ON "NetworkNode"("designId");

-- CreateIndex
CREATE INDEX "NetworkNode_geom_idx" ON "NetworkNode" USING GIST ("geom");

-- CreateIndex
CREATE INDEX "NetworkEdge_designId_idx" ON "NetworkEdge"("designId");

-- AddForeignKey
ALTER TABLE "NetworkDesign" ADD CONSTRAINT "NetworkDesign_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkDesign" ADD CONSTRAINT "NetworkDesign_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkNode" ADD CONSTRAINT "NetworkNode_designId_fkey" FOREIGN KEY ("designId") REFERENCES "NetworkDesign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkEdge" ADD CONSTRAINT "NetworkEdge_designId_fkey" FOREIGN KEY ("designId") REFERENCES "NetworkDesign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkEdge" ADD CONSTRAINT "NetworkEdge_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "NetworkNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkEdge" ADD CONSTRAINT "NetworkEdge_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "NetworkNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
