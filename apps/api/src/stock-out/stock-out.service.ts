import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, Role, StockOut, StockOutStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { StockService } from '../stock/stock.service';
import { runSerializableTransaction } from '../budget-ledger/transaction-retry.util';
import { paginate, PaginatedResponse } from '../common/dto/pagination.dto';
import type { CreateStockOutDtoType, FilterStockOutDtoType, RejectStockOutDtoType } from './stock-out.dto';

type StockOutItemJson = { stockItemId: string; qty: number; notes?: string; itemName?: string };

@Injectable()
export class StockOutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly gateway: NotificationsGateway,
    private readonly stock: StockService,
  ) {}

  async generateRequestNumber(tx?: Prisma.TransactionClient): Promise<string> {
    const client = tx ?? this.prisma;
    const year = new Date().getFullYear();
    const last = await client.stockOut.findFirst({
      where: { requestNumber: { startsWith: `SO-${year}-` } },
      orderBy: { requestNumber: 'desc' },
      select: { requestNumber: true },
    });

    const lastSeq = last?.requestNumber ? parseInt(last.requestNumber.split('-')[2] ?? '0', 10) : 0;
    const newSeq = (lastSeq + 1).toString().padStart(4, '0');
    return `SO-${year}-${newSeq}`;
  }

  async create(dto: CreateStockOutDtoType, requestedById: string): Promise<StockOut> {
    const created = await runSerializableTransaction(this.prisma, async (tx) => {
      const stockItemIds = dto.items.map((i) => i.stockItemId);
      const stockItems = await tx.stockItem.findMany({
        where: { id: { in: stockItemIds } },
      });

      if (stockItems.length !== stockItemIds.length) {
        const found = new Set(stockItems.map((s) => s.id));
        const missing = stockItemIds.filter((id) => !found.has(id));
        throw new BadRequestException(`Stock item tidak ditemukan: ${missing.join(', ')}`);
      }

      if (dto.permitClusterId) {
        const cluster = await tx.permitCluster.findUnique({ where: { id: dto.permitClusterId } });
        if (!cluster) throw new BadRequestException('Permit cluster tidak ditemukan');
      }

      const requestNumber = await this.generateRequestNumber(tx);

      // Build a name map so we can store itemName in the JSON for display in detail view
      const nameMap = new Map(stockItems.map((s) => [s.id, s.name]));
      const itemsWithName = dto.items.map((item) => ({
        stockItemId: item.stockItemId,
        qty: item.qty,
        notes: item.notes,
        itemName: nameMap.get(item.stockItemId) ?? null,
      }));

      return tx.stockOut.create({
        data: {
          requestNumber,
          requestedById,
          permitClusterId: dto.permitClusterId ?? null,
          items: itemsWithName as Prisma.InputJsonValue,
          notes: dto.notes ?? null,
          status: StockOutStatus.PENDING,
        },
        include: {
          requestedBy: { select: { id: true, name: true } },
        },
      });
    });

    await this.notifications.notifyUsersByRole(Role.ADMIN_STOCK, {
      title: 'Permintaan Stock Out Baru',
      message: `${created.requestedBy.name} request ambil barang dari gudang (${created.requestNumber})`,
      type: 'STOCK_OUT_REQUESTED',
      link: '/stock-out',
      entityId: created.id,
    });
    this.gateway.emitToRoom(`role:${Role.ADMIN_STOCK}`, 'stockOut:requested', {
      stockOutId: created.id,
      requestNumber: created.requestNumber,
    });

    return created;
  }

  async fulfill(id: string, fulfilledById: string): Promise<StockOut> {
    const fulfilled = await runSerializableTransaction(this.prisma, async (tx) => {
      const stockOut = await tx.stockOut.findUniqueOrThrow({
        where: { id },
        include: { requestedBy: { select: { id: true, name: true } } },
      });

      if (stockOut.status !== StockOutStatus.PENDING) {
        throw new BadRequestException(
          `StockOut tidak dalam status PENDING (current: ${stockOut.status})`,
        );
      }

      const items = stockOut.items as StockOutItemJson[];

      for (const item of items) {
        const stockItem = await tx.stockItem.findUniqueOrThrow({ where: { id: item.stockItemId } });
        const currentStock = stockItem.currentQty;
        if (currentStock < item.qty) {
          throw new BadRequestException(
            `Stok ${stockItem.name} tidak mencukupi. Tersedia: ${currentStock}, diminta: ${item.qty}`,
          );
        }
      }

      const lowMeta: Array<{
        itemId: string;
        itemName: string;
        newQty: number;
        minStockQty: number;
        unit: string;
      }> = [];

      for (const item of items) {
        const meta = await this.stock.deductInsideTransaction(
          tx,
          item.stockItemId,
          item.qty,
          fulfilledById,
          `StockOut:${id}`,
        );
        lowMeta.push(meta);
      }

      const updated = await tx.stockOut.update({
        where: { id },
        data: {
          status: StockOutStatus.FULFILLED,
          fulfilledById,
          fulfilledAt: new Date(),
        },
        include: {
          requestedBy: { select: { id: true, name: true } },
        },
      });

      return { updated, lowMeta };
    }).then(({ updated, lowMeta }) => {
      for (const m of lowMeta) {
        this.stock.emitLowStockIfNeeded({
          itemId: m.itemId,
          itemName: m.itemName,
          currentQty: m.newQty,
          minStockQty: m.minStockQty,
          unit: m.unit,
        });
      }
      return updated;
    });

    await this.notifications.createForUser(fulfilled.requestedById, {
      title: 'Permintaan Barang Dipenuhi',
      message: `Permintaan ${fulfilled.requestNumber} telah dipenuhi. Silakan ambil barang di gudang.`,
      type: 'STOCK_OUT_FULFILLED',
      link: `/stock-out/${fulfilled.id}`,
      entityId: fulfilled.id,
    });
    this.gateway.emitToRoom(`user:${fulfilled.requestedById}`, 'stockOut:fulfilled', {
      stockOutId: fulfilled.id,
      requestNumber: fulfilled.requestNumber,
    });

    return fulfilled;
  }

  async reject(id: string, dto: RejectStockOutDtoType, rejectedById: string): Promise<StockOut> {
    const stockOut = await this.prisma.stockOut.findUniqueOrThrow({
      where: { id },
    });

    if (stockOut.status !== StockOutStatus.PENDING) {
      throw new BadRequestException(
        `StockOut tidak dalam status PENDING (current: ${stockOut.status})`,
      );
    }

    const reqNumber = stockOut.requestNumber;
    const requesterId = stockOut.requestedById;

    const updated = await this.prisma.stockOut.update({
      where: { id },
      data: {
        status: StockOutStatus.REJECTED,
        fulfilledById: rejectedById,
        fulfilledAt: new Date(),
        rejectionReason: dto.reason,
      },
    });

    await this.notifications.createForUser(requesterId, {
      title: 'Permintaan Barang Ditolak',
      message: `Permintaan ${reqNumber} ditolak: ${dto.reason}`,
      type: 'STOCK_OUT_REJECTED',
      link: `/stock-out/${id}`,
      entityId: id,
    });
    this.gateway.emitToRoom(`user:${requesterId}`, 'stockOut:rejected', {
      stockOutId: id,
      requestNumber: reqNumber,
      reason: dto.reason,
    });

    return updated;
  }

  async findAll(
    filter: FilterStockOutDtoType,
    userId: string,
    userRole: Role,
  ): Promise<PaginatedResponse<StockOut & Record<string, unknown>>> {
    if (filter.scope === 'all') {
      const allowed: Role[] = [Role.ADMIN, Role.GENERAL_MANAGER, Role.ADMIN_STOCK];
      if (!allowed.includes(userRole)) throw new ForbiddenException();
    }

    const where: Prisma.StockOutWhereInput = {};

    if (filter.scope === 'all') {
      if (filter.status !== 'all') where.status = filter.status as StockOutStatus;
    } else if (filter.scope === 'inbox') {
      if (userRole === Role.ADMIN_STOCK) {
        where.status = StockOutStatus.PENDING;
      } else {
        where.requestedById = userId;
        if (filter.status !== 'all') where.status = filter.status as StockOutStatus;
      }
    } else {
      where.requestedById = userId;
      if (filter.status !== 'all') where.status = filter.status as StockOutStatus;
    }

    const [items, total] = await Promise.all([
      this.prisma.stockOut.findMany({
        where,
        include: {
          requestedBy: { select: { id: true, name: true } },
          fulfilledBy: { select: { id: true, name: true } },
          permitCluster: { select: { id: true, clusterCode: true } },
        },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.stockOut.count({ where }),
    ]);

    return paginate(items, total, filter.page, filter.limit);
  }

  async findOne(id: string, userId: string, userRole: Role): Promise<StockOut> {
    const stockOut = await this.prisma.stockOut.findUniqueOrThrow({
      where: { id },
      include: {
        requestedBy: { select: { id: true, name: true } },
        fulfilledBy: { select: { id: true, name: true } },
        permitCluster: true,
      },
    });

    const overseers: Role[] = [Role.ADMIN_STOCK, Role.ADMIN, Role.GENERAL_MANAGER];
    const canView = stockOut.requestedById === userId || overseers.includes(userRole);

    if (!canView) throw new ForbiddenException();

    return stockOut;
  }

  async getInboxCount(userRole: Role): Promise<number> {
    if (userRole !== Role.ADMIN_STOCK) return 0;
    return this.prisma.stockOut.count({ where: { status: StockOutStatus.PENDING } });
  }
}
