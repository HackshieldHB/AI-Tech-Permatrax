import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateDesignDto } from './dto/create-design.dto';
import type { CreateDesignEdgeInput, PatchDesignEdgeInput } from './dto/design-edge-mutation.dto';
import type { CreateDesignNodeInput, PatchDesignNodeInput } from './dto/design-node-mutation.dto';
import type { ListDesignsQueryInput } from './dto/list-designs.dto';
import type { UpdateDesignInput } from './dto/update-design.dto';

type GeoJsonPoint = { type: 'Point'; coordinates: number[] };
type GeoJsonLineString = { type: 'LineString'; coordinates: number[][] };

type NodeRow = {
  id: string;
  type: string;
  origin: string;
  geom: unknown;
  properties: unknown;
};

type EdgeRow = {
  id: string;
  type: string;
  origin: string;
  geom: unknown;
  properties: unknown;
};

type GeoFeature = {
  type: 'Feature';
  geometry: GeoJsonPoint | GeoJsonLineString;
  properties: Record<string, unknown>;
};

type MutationFeatureResponse = {
  feature: GeoFeature;
  designUpdatedAt: Date;
};

@Injectable()
export class DesignService {
  constructor(private readonly prisma: PrismaService) {}

  async createFromCalc(input: CreateDesignDto, createdBy: string) {
    let project = await this.prisma.project.findUnique({
      where: { id: input.projectId },
      select: { id: true },
    });
    if (!project) {
      // User typed a random/new ID -> Auto create it!
      project = await this.prisma.project.create({
        data: {
          id: input.projectId,
          projectCode: `AUTO-${input.projectId}-${Date.now()}`,
          namaProyek: `Project ${input.projectId}`,
          regionalArea: 'AUTO-CREATED',
          lokasiProyek: 'AUTO-CREATED',
          noPO: 'N/A',
          namaPelaksana: 'System Auto-Create',
          tanggalPerjanjian: new Date(),
          status: 'DESIGN',
        },
        select: { id: true }
      });
    }

    const fc = input.geometry as {
      type: 'FeatureCollection';
      features: Array<{ type: string; geometry: unknown; properties: Record<string, unknown> }>;
    };

    const nodeFeatures = fc.features.filter(
      (f) =>
        f.type === 'Feature' &&
        typeof f.geometry === 'object' &&
        f.geometry !== null &&
        (f.geometry as { type?: string }).type === 'Point',
    );

    const edgeFeatures = fc.features.filter(
      (f) =>
        f.type === 'Feature' &&
        typeof f.geometry === 'object' &&
        f.geometry !== null &&
        (f.geometry as { type?: string }).type === 'LineString',
    );

    const refToDbId = new Map<string, string>();
    const seenRefs = new Set<string>();

    for (const f of nodeFeatures) {
      const refId = f.properties.refId;
      if (typeof refId !== 'string') continue;
      if (seenRefs.has(refId)) {
        throw new BadRequestException(`Duplicate node refId: ${refId}`);
      }
      seenRefs.add(refId);
    }

    for (const f of edgeFeatures) {
      const fromRef = f.properties.fromRef;
      const toRef = f.properties.toRef;
      if (typeof fromRef !== 'string' || typeof toRef !== 'string') continue;
      if (!seenRefs.has(fromRef)) {
        throw new BadRequestException(`Edge fromRef "${fromRef}" does not match any Point refId`);
      }
      if (!seenRefs.has(toRef)) {
        throw new BadRequestException(`Edge toRef "${toRef}" does not match any Point refId`);
      }
    }

    try {
      const createdId = await this.prisma.$transaction(async (tx) => {
        const design = await tx.networkDesign.create({
          data: {
            projectId: input.projectId,
            calcInputs: input.calcInputs as Prisma.InputJsonValue,
            baseTopology: input.baseTopology as Prisma.InputJsonValue,
            createdBy,
            status: 'DRAFT',
            version: 1,
          },
        });

        const designId = design.id;

        for (const f of nodeFeatures) {
          const coords = (f.geometry as GeoJsonPoint).coordinates;
          const lng = coords[0]!;
          const lat = coords[1]!;
          const nodeType = String(f.properties.type);
          const propsJson = JSON.stringify(f.properties);
          const nodeId = randomUUID();

          await tx.$executeRaw`
            INSERT INTO "NetworkNode" ("id", "designId", "type", "origin", "geom", "properties")
            VALUES (
              ${nodeId},
              ${designId},
              ${nodeType}::"NodeType",
              'AUTO'::"NodeOrigin",
              ST_SetSRID(ST_MakePoint(${lng}::double precision, ${lat}::double precision), 4326),
              ${propsJson}::jsonb
            )
          `;

          const refId = f.properties.refId;
          if (typeof refId === 'string') {
            refToDbId.set(refId, nodeId);
          }
        }

        for (const f of edgeFeatures) {
          const fromRef = f.properties.fromRef as string;
          const toRef = f.properties.toRef as string;
          const fromNodeId = refToDbId.get(fromRef);
          const toNodeId = refToDbId.get(toRef);
          if (!fromNodeId || !toNodeId) {
            throw new BadRequestException(`Could not resolve endpoints for edge ${fromRef} → ${toRef}`);
          }

          const edgeType = String(f.properties.type);
          const lineJson = JSON.stringify(f.geometry);
          const edgePropsJson = JSON.stringify(f.properties);
          const edgeId = randomUUID();

          await tx.$executeRaw`
            INSERT INTO "NetworkEdge" ("id", "designId", "fromNodeId", "toNodeId", "type", "origin", "geom", "properties")
            VALUES (
              ${edgeId},
              ${designId},
              ${fromNodeId},
              ${toNodeId},
              ${edgeType}::"EdgeType",
              'AUTO'::"NodeOrigin",
              ST_SetSRID(ST_GeomFromGeoJSON(${lineJson}::text), 4326),
              ${edgePropsJson}::jsonb
            )
          `;
        }

        return designId;
      });

      return this.findOneByIdWithGeometry(createdId);
    } catch (error: any) {
      // Handle specific Prisma errors
      if (error.code === 'P2002') {
        throw new BadRequestException(
          'Desain dengan data ini sudah ada.'
        );
      }
      if (error.code === 'P2025') {
        throw new NotFoundException(
          'Data yang direferensikan tidak ditemukan. ' +
          'Pastikan Project ID valid.'
        );
      }
      if (error.code === 'P2003') {
        throw new BadRequestException(
          'Project ID tidak valid atau tidak ditemukan.'
        );
      }
      // Log unexpected errors
      console.error('[DesignService.createFromCalc] Error:', {
        code: error.code,
        message: error.message,
        meta: error.meta,
      });
      throw new InternalServerErrorException(
        'Gagal menyimpan desain. Silakan coba lagi.'
      );
    }
  }

  /**
   * Returns the design with its geometry as a FeatureCollection.
   *
   * Round-trip contract: the `geometry` field returned by this method can be
   * POSTed verbatim as the `geometry` field of a new CreateDesignDto. The other
   * top-level fields (`id`, `status`, `version`, `createdBy`, `createdAt`,
   * `updatedAt`) are read-only and must be omitted when creating a new design.
   *
   * Phase 2 will use this to support "duplicate design" and "fork from snapshot".
   */
  async findOneByIdWithGeometry(id: string) {
    const design = await this.prisma.networkDesign.findUnique({
      where: { id },
    });
    if (!design) {
      throw new NotFoundException(`NetworkDesign ${id} not found`);
    }

    const geometry = await this.buildFeatureCollectionForDesign(id);

    return {
      id: design.id,
      projectId: design.projectId,
      status: design.status,
      version: design.version,
      createdBy: design.createdBy,
      createdAt: design.createdAt,
      updatedAt: design.updatedAt,
      calcInputs: design.calcInputs,
      baseTopology: design.baseTopology,
      geometry,
      sketchTopology: design.sketchTopology,
    };
  }

  async listByProject(query: ListDesignsQueryInput) {
    const where: Prisma.NetworkDesignWhereInput = {};

    // FIX: Only filter by projectId when explicitly provided
    // When not provided, return ALL designs for the user (filtered by createdBy)
    if (query.projectId) {
      where.projectId = query.projectId;
    }

    if (!query.includeArchived) {
      where.status = { not: 'ARCHIVED' };
    }
    // FIX 2: Filter by user ID so users only see their own drafts
    if (query.createdBy) {
      where.createdBy = query.createdBy;
    }

    return this.prisma.networkDesign.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        projectId: true,
        status: true,
        version: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async update(id: string, input: UpdateDesignInput) {
    await this.assertDesignMutable(id);
    return this.prisma.networkDesign.update({
      where: { id },
      data: {
        ...(input.geometry && { baseTopology: input.geometry as unknown as Prisma.InputJsonObject }),
        ...(input.sketchTopology && { sketchTopology: input.sketchTopology as unknown as Prisma.InputJsonObject }),
        updatedAt: new Date(),
      },
    });
  }

  async archiveDesign(id: string) {
    const result = await this.prisma.networkDesign.updateMany({
      where: { id },
      data: { status: 'ARCHIVED' },
    });
    if (result.count === 0) {
      throw new NotFoundException(`NetworkDesign ${id} not found`);
    }
    return this.findOneByIdWithGeometry(id);
  }

  async createNode(designId: string, input: CreateDesignNodeInput): Promise<MutationFeatureResponse> {
    await this.assertDesignMutable(designId);
    const nodeId = randomUUID();
    const propsJson = JSON.stringify({ ...input.properties, refId: input.refId });

    const response = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "NetworkNode"
        WHERE "designId" = ${designId}
          AND "properties"->>'refId' = ${input.refId}
        LIMIT 1
      `;
      if (existing.length > 0) {
        throw new BadRequestException(`Node refId "${input.refId}" already exists in design`);
      }

      await tx.$executeRaw`
        INSERT INTO "NetworkNode" ("id", "designId", "type", "origin", "geom", "properties")
        VALUES (
          ${nodeId},
          ${designId},
          ${input.type}::"NodeType",
          ${input.origin}::"NodeOrigin",
          ST_SetSRID(ST_MakePoint(${input.coordinates[0]}::double precision, ${input.coordinates[1]}::double precision), 4326),
          ${propsJson}::jsonb
        )
      `;

      const updatedAt = await this.bumpDesignUpdatedAtTx(tx, designId);
      const feature = await this.getNodeFeatureByIdTx(tx, designId, nodeId);
      return { feature, designUpdatedAt: updatedAt };
    });

    return response;
  }

  async updateNode(
    designId: string,
    refId: string,
    input: PatchDesignNodeInput,
  ): Promise<MutationFeatureResponse> {
    await this.assertDesignMutable(designId);

    return this.prisma.$transaction(async (tx) => {
      const existing = await this.getNodeRowByRefIdTx(tx, designId, refId);
      if (!existing) throw new NotFoundException(`Node refId ${refId} not found`);
      const nodeId = existing.id;

      const prevProps = typeof existing.properties === 'object' && existing.properties !== null
        ? (existing.properties as Record<string, unknown>)
        : {};
      const nextProps = input.properties ? { ...prevProps, ...input.properties } : prevProps;
      const propsJson = JSON.stringify(nextProps);

      await tx.$executeRaw`
        UPDATE "NetworkNode"
        SET
          "origin" = ${input.origin ?? existing.origin}::"NodeOrigin",
          "properties" = ${propsJson}::jsonb,
          "geom" = ${
            input.coordinates
              ? Prisma.sql`ST_SetSRID(ST_MakePoint(${input.coordinates[0]}::double precision, ${input.coordinates[1]}::double precision), 4326)`
              : Prisma.sql`"geom"`
          }
        WHERE "id" = ${nodeId} AND "designId" = ${designId}
      `;

      const updatedAt = await this.bumpDesignUpdatedAtTx(tx, designId);
      const feature = await this.getNodeFeatureByIdTx(tx, designId, nodeId);
      return { feature, designUpdatedAt: updatedAt };
    });
  }

  async deleteNode(
    designId: string,
    refId: string,
  ): Promise<{ deletedNodeRefId: string; deletedEdgeRefIds: string[]; designUpdatedAt: Date }> {
    await this.assertDesignMutable(designId);

    return this.prisma.$transaction(async (tx) => {
      const existingNode = await this.getNodeRowByRefIdTx(tx, designId, refId);
      if (!existingNode) throw new NotFoundException(`Node refId ${refId} not found`);
      const nodeId = existingNode.id;
      const nodeProps = typeof existingNode.properties === 'object' && existingNode.properties !== null
        ? (existingNode.properties as Record<string, unknown>)
        : {};
      const deletedNodeRefId = typeof nodeProps.refId === 'string' ? nodeProps.refId : nodeId;

      // Phase 1 TODO follow-up: node deletion must cascade to connected edges atomically.
      const connectedEdges = await tx.$queryRaw<Array<{ id: string; refId: string | null }>>`
        SELECT
          e."id",
          e."properties"->>'refId' AS "refId"
        FROM "NetworkEdge" e
        WHERE e."designId" = ${designId}
          AND (e."fromNodeId" = ${nodeId} OR e."toNodeId" = ${nodeId})
      `;
      const connectedEdgeIds = connectedEdges.map((edge) => edge.id);
      const deletedEdgeRefIds = connectedEdges.map((edge) => edge.refId ?? edge.id);

      if (connectedEdgeIds.length > 0) {
        await tx.networkEdge.deleteMany({
          where: { id: { in: connectedEdgeIds }, designId },
        });
      }

      await tx.networkNode.deleteMany({
        where: { id: nodeId, designId },
      });

      const designUpdatedAt = await this.bumpDesignUpdatedAtTx(tx, designId);
      return { deletedNodeRefId, deletedEdgeRefIds, designUpdatedAt };
    });
  }

  async createEdge(designId: string, input: CreateDesignEdgeInput): Promise<MutationFeatureResponse> {
    await this.assertDesignMutable(designId);
    const edgeId = randomUUID();

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "NetworkEdge"
        WHERE "designId" = ${designId}
          AND "properties"->>'refId' = ${input.refId}
        LIMIT 1
      `;
      if (existing.length > 0) {
        throw new BadRequestException(`Edge refId "${input.refId}" already exists in design`);
      }

      const fromNodeId = await this.resolveNodeDbIdByRefTx(tx, designId, input.fromRef);
      const toNodeId = await this.resolveNodeDbIdByRefTx(tx, designId, input.toRef);
      if (!fromNodeId || !toNodeId) {
        throw new BadRequestException(`Could not resolve edge endpoints ${input.fromRef} -> ${input.toRef}`);
      }

      const lineJson = JSON.stringify({ type: 'LineString', coordinates: input.coordinates });
      const edgePropsJson = JSON.stringify({
        ...input.properties,
        refId: input.refId,
        fromRef: input.fromRef,
        toRef: input.toRef,
        length_m: input.length_m,
        route_source: input.route_source,
      });

      await tx.$executeRaw`
        INSERT INTO "NetworkEdge" ("id", "designId", "fromNodeId", "toNodeId", "type", "origin", "geom", "properties")
        VALUES (
          ${edgeId},
          ${designId},
          ${fromNodeId},
          ${toNodeId},
          ${input.type}::"EdgeType",
          ${input.origin}::"NodeOrigin",
          ST_SetSRID(ST_GeomFromGeoJSON(${lineJson}::text), 4326),
          ${edgePropsJson}::jsonb
        )
      `;

      const updatedAt = await this.bumpDesignUpdatedAtTx(tx, designId);
      const feature = await this.getEdgeFeatureByIdTx(tx, designId, edgeId);
      return { feature, designUpdatedAt: updatedAt };
    });
  }

  async updateEdge(
    designId: string,
    refId: string,
    input: PatchDesignEdgeInput,
  ): Promise<MutationFeatureResponse> {
    await this.assertDesignMutable(designId);

    return this.prisma.$transaction(async (tx) => {
      const existing = await this.getEdgeRowByRefIdTx(tx, designId, refId);
      if (!existing) throw new NotFoundException(`Edge refId ${refId} not found`);
      const edgeId = existing.id;

      const prevProps = typeof existing.properties === 'object' && existing.properties !== null
        ? (existing.properties as Record<string, unknown>)
        : {};
      const currentFromRef = typeof prevProps.fromRef === 'string' ? prevProps.fromRef : '';
      const currentToRef = typeof prevProps.toRef === 'string' ? prevProps.toRef : '';
      const nextFromRef = input.fromRef ?? currentFromRef;
      const nextToRef = input.toRef ?? currentToRef;
      if (!nextFromRef || !nextToRef) {
        throw new BadRequestException('Edge requires fromRef and toRef');
      }

      const fromNodeId = await this.resolveNodeDbIdByRefTx(tx, designId, nextFromRef);
      const toNodeId = await this.resolveNodeDbIdByRefTx(tx, designId, nextToRef);
      if (!fromNodeId || !toNodeId) {
        throw new BadRequestException(`Could not resolve edge endpoints ${nextFromRef} -> ${nextToRef}`);
      }

      const nextProps = {
        ...prevProps,
        ...(input.properties ?? {}),
        fromRef: nextFromRef,
        toRef: nextToRef,
      } as Record<string, unknown>;
      if (typeof input.length_m === 'number') nextProps.length_m = input.length_m;
      if (typeof input.route_source === 'string') nextProps.route_source = input.route_source;
      const propsJson = JSON.stringify(nextProps);
      const lineJson =
        input.coordinates && input.coordinates.length >= 2
          ? JSON.stringify({ type: 'LineString', coordinates: input.coordinates })
          : null;

      await tx.$executeRaw`
        UPDATE "NetworkEdge"
        SET
          "fromNodeId" = ${fromNodeId},
          "toNodeId" = ${toNodeId},
          "origin" = ${input.origin ?? existing.origin}::"NodeOrigin",
          "properties" = ${propsJson}::jsonb,
          "geom" = ${
            lineJson
              ? Prisma.sql`ST_SetSRID(ST_GeomFromGeoJSON(${lineJson}::text), 4326)`
              : Prisma.sql`"geom"`
          }
        WHERE "id" = ${edgeId} AND "designId" = ${designId}
      `;

      const updatedAt = await this.bumpDesignUpdatedAtTx(tx, designId);
      const feature = await this.getEdgeFeatureByIdTx(tx, designId, edgeId);
      return { feature, designUpdatedAt: updatedAt };
    });
  }

  async deleteEdge(
    designId: string,
    refId: string,
  ): Promise<{ deletedEdgeRefId: string; designUpdatedAt: Date }> {
    await this.assertDesignMutable(designId);

    return this.prisma.$transaction(async (tx) => {
      const existing = await this.getEdgeRowByRefIdTx(tx, designId, refId);
      if (!existing) throw new NotFoundException(`Edge refId ${refId} not found`);
      const edgeId = existing.id;
      const props = typeof existing.properties === 'object' && existing.properties !== null
        ? (existing.properties as Record<string, unknown>)
        : {};
      const deletedEdgeRefId = typeof props.refId === 'string' ? props.refId : edgeId;

      await tx.networkEdge.deleteMany({
        where: { id: edgeId, designId },
      });

      const designUpdatedAt = await this.bumpDesignUpdatedAtTx(tx, designId);
      return { deletedEdgeRefId, designUpdatedAt };
    });
  }

  private async assertDesignMutable(designId: string): Promise<void> {
    const design = await this.prisma.networkDesign.findUnique({
      where: { id: designId },
      select: { id: true, status: true },
    });
    if (!design) throw new NotFoundException(`NetworkDesign ${designId} not found`);
    if (design.status === 'ARCHIVED') {
      throw new BadRequestException('Archived design cannot be modified');
    }
  }

  private async bumpDesignUpdatedAtTx(
    tx: Prisma.TransactionClient,
    designId: string,
  ): Promise<Date> {
    const updated = await tx.networkDesign.update({
      where: { id: designId },
      data: { updatedAt: new Date() },
      select: { updatedAt: true },
    });
    return updated.updatedAt;
  }

  private async getNodeRowByIdTx(
    tx: Prisma.TransactionClient,
    designId: string,
    nodeId: string,
  ): Promise<NodeRow | null> {
    const rows = await tx.$queryRaw<NodeRow[]>`
      SELECT
        "id",
        "type"::text AS "type",
        "origin"::text AS "origin",
        ST_AsGeoJSON("geom")::json AS "geom",
        "properties"
      FROM "NetworkNode"
      WHERE "id" = ${nodeId} AND "designId" = ${designId}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  private async getNodeRowByRefIdTx(
    tx: Prisma.TransactionClient,
    designId: string,
    refId: string,
  ): Promise<NodeRow | null> {
    const rows = await tx.$queryRaw<NodeRow[]>`
      SELECT
        "id",
        "type"::text AS "type",
        "origin"::text AS "origin",
        ST_AsGeoJSON("geom")::json AS "geom",
        "properties"
      FROM "NetworkNode"
      WHERE "designId" = ${designId}
        AND "properties"->>'refId' = ${refId}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  private async getEdgeRowByIdTx(
    tx: Prisma.TransactionClient,
    designId: string,
    edgeId: string,
  ): Promise<EdgeRow | null> {
    const rows = await tx.$queryRaw<EdgeRow[]>`
      SELECT
        "id",
        "type"::text AS "type",
        "origin"::text AS "origin",
        ST_AsGeoJSON("geom")::json AS "geom",
        "properties"
      FROM "NetworkEdge"
      WHERE "id" = ${edgeId} AND "designId" = ${designId}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  private async getEdgeRowByRefIdTx(
    tx: Prisma.TransactionClient,
    designId: string,
    refId: string,
  ): Promise<EdgeRow | null> {
    const rows = await tx.$queryRaw<EdgeRow[]>`
      SELECT
        "id",
        "type"::text AS "type",
        "origin"::text AS "origin",
        ST_AsGeoJSON("geom")::json AS "geom",
        "properties"
      FROM "NetworkEdge"
      WHERE "designId" = ${designId}
        AND "properties"->>'refId' = ${refId}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  private async getNodeFeatureByIdTx(
    tx: Prisma.TransactionClient,
    designId: string,
    nodeId: string,
  ): Promise<GeoFeature> {
    const row = await this.getNodeRowByIdTx(tx, designId, nodeId);
    if (!row) throw new NotFoundException(`Node ${nodeId} not found`);
    const props = typeof row.properties === 'object' && row.properties !== null ? { ...row.properties } : {};
    return {
      type: 'Feature',
      geometry: row.geom as GeoJsonPoint,
      properties: {
        ...props,
        kind: 'node',
        type: row.type,
      },
    };
  }

  private async getEdgeFeatureByIdTx(
    tx: Prisma.TransactionClient,
    designId: string,
    edgeId: string,
  ): Promise<GeoFeature> {
    const row = await this.getEdgeRowByIdTx(tx, designId, edgeId);
    if (!row) throw new NotFoundException(`Edge ${edgeId} not found`);
    const props = typeof row.properties === 'object' && row.properties !== null ? { ...row.properties } : {};
    return {
      type: 'Feature',
      geometry: row.geom as GeoJsonLineString,
      properties: {
        ...props,
        kind: 'edge',
        type: row.type,
      },
    };
  }

  private async resolveNodeDbIdByRefTx(
    tx: Prisma.TransactionClient,
    designId: string,
    refId: string,
  ): Promise<string | null> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "NetworkNode"
      WHERE "designId" = ${designId}
        AND "properties"->>'refId' = ${refId}
      LIMIT 1
    `;
    return rows[0]?.id ?? null;
  }

  private async buildFeatureCollectionForDesign(designId: string): Promise<{
    type: 'FeatureCollection';
    features: GeoFeature[];
  }> {
    const nodes = await this.prisma.$queryRaw<NodeRow[]>`
      SELECT
        "id",
        "type"::text AS "type",
        "origin"::text AS "origin",
        ST_AsGeoJSON("geom")::json AS "geom",
        "properties"
      FROM "NetworkNode"
      WHERE "designId" = ${designId}
    `;

    const edges = await this.prisma.$queryRaw<EdgeRow[]>`
      SELECT
        "id",
        "type"::text AS "type",
        "origin"::text AS "origin",
        ST_AsGeoJSON("geom")::json AS "geom",
        "properties"
      FROM "NetworkEdge"
      WHERE "designId" = ${designId}
    `;

    const nodeFeatures: GeoFeature[] = nodes
      .sort((a, b) => {
        const ra = (a.properties as { refId?: string })?.refId ?? a.id;
        const rb = (b.properties as { refId?: string })?.refId ?? b.id;
        return ra.localeCompare(rb);
      })
      .map((row) => {
        const geom = row.geom as GeoJsonPoint;
        const props = typeof row.properties === 'object' && row.properties !== null ? { ...row.properties } : {};
        return {
          type: 'Feature' as const,
          geometry: geom,
          properties: {
            ...props,
            kind: 'node' as const,
            type: row.type,
          },
        };
      });

    const edgeFeatures: GeoFeature[] = edges
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((row) => {
        const geom = row.geom as GeoJsonLineString;
        const props = typeof row.properties === 'object' && row.properties !== null ? { ...row.properties } : {};
        return {
          type: 'Feature' as const,
          geometry: geom,
          properties: {
            ...props,
            kind: 'edge' as const,
            type: row.type,
          },
        };
      });

    return {
      type: 'FeatureCollection',
      features: [...nodeFeatures, ...edgeFeatures],
    };
  }
}
