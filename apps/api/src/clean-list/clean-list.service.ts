import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import {
  CreateCleanListDtoType,
  BulkImportCleanListDtoType,
  CleanListFilterDtoType,
} from './clean-list.dto';
import { paginate, PaginatedResponse } from '../common/dto/pagination.dto';
import { FiberType, Prisma, Role } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';

// NEW: CleanListService — manages ISP cluster data for the fiber rollout portal
@Injectable()
export class CleanListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
    private readonly notifications: NotificationsService,
  ) {}

  // MODIFIED: paginated list with filters — standard { data, meta }
  async findAll(filters: CleanListFilterDtoType): Promise<PaginatedResponse<unknown>> {
    const { ispCustomer, fiberType, status, search, page, limit, hasExistingFiber, sortBy, sortOrder } = filters;
    const skip = (page - 1) * limit;

    const where: Prisma.CleanListWhereInput = {};
    if (ispCustomer?.trim()) {
      where.ispCustomer = { equals: ispCustomer.trim(), mode: 'insensitive' };
    }
    if (fiberType)   where.fiberType = fiberType;
    if (status)      where.status = status as any;
    if (hasExistingFiber !== undefined) where.hasExistingFiber = hasExistingFiber;
    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        { rwCode:    { contains: q, mode: 'insensitive' } },
        { kelurahan: { contains: q, mode: 'insensitive' } },
        { kecamatan: { contains: q, mode: 'insensitive' } },
      ];
    }

    const orderBy: Prisma.CleanListOrderByWithRelationInput = sortBy && ['createdAt', 'rwCode', 'kelurahan'].includes(sortBy)
      ? { [sortBy]: sortOrder }
      : { createdAt: sortOrder };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.cleanList.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          importer: { select: { id: true, name: true } },
          _count: { select: { visitRequests: true } },
        },
      }),
      this.prisma.cleanList.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  // NEW: Single entry by ID
  async findOne(id: string) {
    const entry = await this.prisma.cleanList.findUnique({
      where: { id },
      include: {
        visitRequests: {
          select: { id: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
        importer: { select: { id: true, name: true, email: true } },
      },
    });
    if (!entry) throw new NotFoundException('Clean list entry tidak ditemukan');
    return entry;
  }

  // NEW: Single import entry with duplicate check
  async create(dto: CreateCleanListDtoType, importedBy: string) {
    const existing = await this.prisma.cleanList.findFirst({
      where: {
        rwCode:      dto.rwCode,
        kelurahan:   dto.kelurahan,
        ispCustomer: dto.ispCustomer,
        fiberType:   dto.fiberType,
      },
    });
    if (existing) {
      throw new ConflictException(
        `Cluster RW ${dto.rwCode} - ${dto.kelurahan} untuk ${dto.ispCustomer} sudah ada`
      );
    }

    return this.prisma.cleanList.create({
      data: {
        ispCustomer:   dto.ispCustomer,
        fiberType:     dto.fiberType,
        rwCode:        dto.rwCode,
        kelurahan:     dto.kelurahan,
        kecamatan:     dto.kecamatan,
        kotaKabupaten: dto.kotaKabupaten,
        homepasCount:  dto.homepasCount ?? 0,
        importedBy,
      },
    });
  }

  // NEW: Bulk import with upsert — skips duplicates
  async bulkImport(dto: BulkImportCleanListDtoType, importedBy: string) {
    let created = 0;
    let skipped = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const row of dto.rows) {
        const existing = await tx.cleanList.findFirst({
          where: {
            rwCode:      row.rwCode,
            kelurahan:   row.kelurahan,
            ispCustomer: dto.ispCustomer,
            fiberType:   dto.fiberType,
          },
        });

        if (existing) {
          skipped++;
          continue;
        }

        await tx.cleanList.create({
          data: {
            ispCustomer:   dto.ispCustomer,
            fiberType:     dto.fiberType,
            rwCode:        row.rwCode,
            kelurahan:     row.kelurahan,
            kecamatan:     row.kecamatan,
            kotaKabupaten: row.kotaKabupaten,
            homepasCount:  row.homepasCount ?? 0,
            importedBy,
          },
        });
        created++;
      }
    });

    if (created > 0) {
      const surveyorRole =
        dto.fiberType === FiberType.FTTB
          ? Role.SURVEYOR_FTTB
          : dto.fiberType === FiberType.FTTT
            ? Role.SURVEYOR_FTTT
            : Role.SURVEYOR_FTTH;
      await this.notifications.createForRole(surveyorRole, {
        title: 'Cluster baru tersedia',
        message: `${created} baris clean list baru (${dto.ispCustomer}) siap ditinjau`,
        type: 'CLEAN_LIST',
        link: '/clean-list',
      }); // FIX: Step 1 — surveyor notified after PM import
    }

    return { created, skipped, total: dto.rows.length };
  }

  // NEW: Mark cluster as having existing fiber — triggers GIS update via Socket.IO
  async markExistingFiber(id: string, operatorName: string, userId: string) {
    const entry = await this.prisma.cleanList.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Clean list entry tidak ditemukan');

    const updated = await this.prisma.cleanList.update({
      where: { id },
      data: {
        hasExistingFiber: true,
        existingOperator: operatorName,
        existingMarkedAt: new Date(),
        status:           'HAS_EXISTING_FIBER',
      },
    });

    // NEW: Emit GIS update event so MapLibre refreshes the layer in real-time
    this.gateway.emitToAll('gis:markedExisting', {
      cleanListId:  id,
      rwCode:       updated.rwCode,
      operatorName: operatorName,
    });

    return updated;
  }

  // NEW: Summary statistics grouped by ISP for dashboard cards
  async getIspSummary() {
    const [total, available, inProgress, hasExistingFiber, completed] =
      await this.prisma.$transaction([
        this.prisma.cleanList.count(),
        this.prisma.cleanList.count({ where: { status: 'AVAILABLE' } }),
        this.prisma.cleanList.count({ where: { status: 'IN_PROGRESS' } }),
        this.prisma.cleanList.count({ where: { status: 'HAS_EXISTING_FIBER' } }),
        this.prisma.cleanList.count({ where: { status: 'COMPLETED' } }),
      ]);

    const byIsp = await this.prisma.cleanList.groupBy({
      by: ['ispCustomer', 'status'],
      _count: true,
    });

    return { total, available, inProgress, hasExistingFiber, completed, byIsp };
  }

  async getDashboardStats(_userRole: string, _userId: string) {
    const [totalAvailable, totalInProgress, totalExistingFiber, totalCompleted, byCity, byPermitStatus, totalHP, recentlyAdded] = await Promise.all([
      this.prisma.cleanList.count({ where: { status: 'AVAILABLE' } }),
      this.prisma.cleanList.count({ where: { status: 'IN_PROGRESS' } }),
      this.prisma.cleanList.count({ where: { hasExistingFiber: true } }),
      this.prisma.cleanList.count({ where: { status: 'COMPLETED' } }),
      this.prisma.cleanList.groupBy({
        by: ['kotaKabupaten'],
        _count: { _all: true },
        _sum: { homepasCount: true },
        orderBy: { _count: { kotaKabupaten: 'desc' } },
        take: 10,
      }),
      this.prisma.cleanList.groupBy({
        by: ['permitStatus'],
        _count: { _all: true },
        where: { permitStatus: { not: null } },
      }),
      this.prisma.cleanList.aggregate({ _sum: { homepasCount: true, actualHP: true } }),
      this.prisma.cleanList.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, siteName: true, rwCode: true, kotaKabupaten: true, homepasCount: true, permitStatus: true, status: true, createdAt: true },
      }),
    ]);
    return {
      summary: { totalAvailable, totalInProgress, totalExistingFiber, totalCompleted, totalSites: totalAvailable + totalInProgress + totalExistingFiber + totalCompleted },
      homepasses: {
        totalPlanned: totalHP._sum.homepasCount || 0,
        totalActual: totalHP._sum.actualHP || 0,
        achievementRate: totalHP._sum.homepasCount ? Math.round(((totalHP._sum.actualHP || 0) / totalHP._sum.homepasCount) * 100) : 0,
      },
      byCity: byCity.map((c) => ({ city: c.kotaKabupaten, count: c._count._all, totalHP: c._sum.homepasCount || 0 })),
      byPermitStatus: byPermitStatus.map((s) => ({ status: s.permitStatus, count: s._count._all })),
      recentlyAdded,
    };
  }

  async bulkImportFromExcel(
    rows: ParsedExcelRow[],
    importedBy: string,
    ispCustomer: string,
    fiberType: FiberType,
  ): Promise<{ created: number; skipped: number; errors: string[] }> {
    let created = 0;
    let skipped = 0;
    const errors: string[] = [];
    const batchSize = 50;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      await this.prisma.$transaction(async (tx) => {
        for (const row of batch) {
          try {
            const rwCode = row.rwCode || this.parseRwCode(row.siteName) || row.siteName.substring(0, 50);
            const existing = await tx.cleanList.findFirst({
              where: { rwCode, kelurahan: row.kelurahan || '', ispCustomer },
            });
            if (existing) {
              await tx.cleanList.update({
                where: { id: existing.id },
                data: {
                  siteName: row.siteName,
                  homepasCount: row.homepasCount,
                  actualHP: row.actualHP,
                  hpHldApproved: row.hpHldApproved,
                  permitStatus: row.permitStatus,
                  implStatus: row.implStatus,
                  picPermit: row.picPermit,
                  projectType: row.projectType,
                  coordinates: row.coordinates,
                  hasExistingFiber: row.hasExistingFiber ?? false,
                  remark: row.remark,
                  sourceSheet: row.sourceSheet,
                  externalCode: row.externalCode,
                  lastUpdate: row.lastUpdate ? new Date(row.lastUpdate) : undefined,
                },
              });
              skipped++;
            } else {
              await tx.cleanList.create({
                data: {
                  rwCode,
                  ispCustomer,
                  fiberType,
                  siteName: row.siteName,
                  kelurahan: row.kelurahan || '',
                  kecamatan: row.kecamatan || '',
                  kotaKabupaten: row.kotaKabupaten,
                  homepasCount: row.homepasCount,
                  actualHP: row.actualHP,
                  hpHldApproved: row.hpHldApproved,
                  permitStatus: row.permitStatus,
                  implStatus: row.implStatus,
                  picPermit: row.picPermit,
                  projectType: row.projectType,
                  coordinates: row.coordinates,
                  hasExistingFiber: row.hasExistingFiber ?? false,
                  remark: row.remark,
                  sourceSheet: row.sourceSheet,
                  externalCode: row.externalCode,
                  lastUpdate: row.lastUpdate ? new Date(row.lastUpdate) : undefined,
                  status: 'AVAILABLE',
                  importedBy,
                },
              });
              created++;
            }
          } catch (err) {
            errors.push(`Row "${row.siteName}": ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        }
      });
    }
    return { created, skipped, errors };
  }

  private parseRwCode(siteName: string): string | null {
    const match = siteName.match(/RW\s*(\d+)/i);
    if (match) return `RW-${match[1].padStart(3, '0')}`;
    return null;
  }
}

export interface ParsedExcelRow {
  siteName: string;
  kotaKabupaten: string;
  kelurahan?: string;
  kecamatan?: string;
  rwCode?: string;
  homepasCount: number;
  actualHP?: number;
  hpHldApproved?: number;
  permitStatus?: string;
  implStatus?: string;
  picPermit?: string;
  projectType?: string;
  coordinates?: string;
  hasExistingFiber?: boolean;
  lastUpdate?: string;
  remark?: string;
  sourceSheet: 'MASTER' | 'POTENSIAL_CBN';
  externalCode?: string;
}
