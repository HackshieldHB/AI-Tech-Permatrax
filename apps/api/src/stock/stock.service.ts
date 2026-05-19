import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import {
  CreateStockItemDtoType,
  UpdateStockItemDtoType,
  AdjustStockDtoType,
  StockFilterDtoType,
} from './stock.dto';
import { paginate, PaginatedResponse } from '../common/dto/pagination.dto';

// NEW: StockService — manages the material inventory catalog
@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
  ) {}

  // MODIFIED: DB-level pagination; lowStock uses raw id filter + computed flags on rows
  async findAll(filters: StockFilterDtoType): Promise<PaginatedResponse<unknown>> {
    const { search, category, lowStock, isActive, page, limit, sortBy, sortOrder } = filters;
    const skip = (page - 1) * limit;

    const where: Prisma.StockItemWhereInput = { isActive };

    if (category?.trim()) {
      where.category = { contains: category.trim(), mode: 'insensitive' };
    }

    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (lowStock) {
      const lowRows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "StockItem"
        WHERE "currentQty" <= "minStockQty"
        AND "isActive" = ${isActive}
      `;
      const ids = lowRows.map((r) => r.id);
      if (!ids.length) {
        return paginate([], 0, page, limit);
      }
      where.id = { in: ids };
    }

    const orderBy: Prisma.StockItemOrderByWithRelationInput =
      sortBy && ['name', 'code', 'currentQty', 'createdAt'].includes(sortBy)
        ? { [sortBy]: sortOrder }
        : lowStock
          ? { currentQty: 'asc' }
          : { name: 'asc' };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.stockItem.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          _count: { select: { stockLogs: true } },
        },
      }),
      this.prisma.stockItem.count({ where }),
    ]);

    const data = rows.map((item) => ({
      ...item,
      isLowStock: item.currentQty <= item.minStockQty,
      isOutOfStock: item.currentQty === 0,
    }));

    return paginate(data, total, page, limit);
  }

  // NEW: Single item with last 10 stock log entries
  async findOne(id: string) {
    const item = await this.prisma.stockItem.findUnique({
      where:   { id },
      include: {
        creator:   { select: { id: true, name: true, email: true } },
        stockLogs: {
          orderBy: { createdAt: 'desc' },
          take:    10,
          include: { actor: { select: { id: true, name: true } } },
        },
      },
    });
    if (!item) throw new NotFoundException('Barang tidak ditemukan');
    return { ...item, isLowStock: item.currentQty <= item.minStockQty };
  }

  // NEW: Real-time search autocomplete for order form — top 10 results
  async search(query: string) {
    const items = await this.prisma.stockItem.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { code: { contains: query, mode: 'insensitive' } },
        ],
      },
      take:    10,
      select: {
        id:         true,
        name:       true,
        code:       true,
        unit:       true,
        category:   true,
        currentQty: true,
        minStockQty: true,
      },
    });
    return items.map((i) => ({ ...i, isLowStock: i.currentQty <= i.minStockQty }));
  }

  // NEW: Create new stock item — check unique code
  async create(dto: CreateStockItemDtoType, createdBy: string) {
    const existing = await this.prisma.stockItem.findUnique({ where: { code: dto.code } });
    if (existing) throw new ConflictException(`Kode barang "${dto.code}" sudah digunakan`);

    const item = await this.prisma.stockItem.create({
      data: {
        name:        dto.name,
        code:        dto.code,
        category:    dto.category,
        unit:        dto.unit,
        currentQty:  dto.currentQty ?? 0,
        minStockQty: dto.minStockQty ?? 0,
        description: dto.description,
        createdBy,
      },
    });

    // NEW: If initial qty > 0, create an ADJUSTMENT log to document it
    if (dto.currentQty > 0) {
      await this.prisma.stockLog.create({
        data: {
          stockItemId: item.id,
          type:        'ADJUSTMENT',
          qtyBefore:   0,
          qtyChange:   dto.currentQty,
          qtyAfter:    dto.currentQty,
          notes:       'Stok awal saat item dibuat',
          actorId:     createdBy,
        },
      });
    }

    return item;
  }

  // NEW: Update item metadata only (NOT qty — qty only via adjustStock)
  async update(id: string, dto: UpdateStockItemDtoType, actorId: string) {
    const item = await this.prisma.stockItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Barang tidak ditemukan');
    return this.prisma.stockItem.update({ where: { id }, data: dto });
  }

  // NEW: Manual stock adjustment — creates StockLog + emits Socket.IO event
  async adjustStock(dto: AdjustStockDtoType, actorId: string) {
    const item = await this.prisma.stockItem.findUnique({ where: { id: dto.stockItemId } });
    if (!item) throw new NotFoundException('Barang tidak ditemukan');

    const qtyChange = dto.newQty - item.currentQty;

    const updated = await this.prisma.$transaction(async (tx) => {
      // NEW: Update the stock item quantity
      const updatedItem = await tx.stockItem.update({
        where: { id: dto.stockItemId },
        data:  { currentQty: dto.newQty },
      });

      // NEW: Create audit log entry
      await tx.stockLog.create({
        data: {
          stockItemId: dto.stockItemId,
          type:        'ADJUSTMENT',
          qtyBefore:   item.currentQty,
          qtyChange,
          qtyAfter:    dto.newQty,
          notes:       dto.reason,
          actorId,
        },
      });

      return updatedItem;
    });

    // NEW: Emit real-time event to admins and GM
    this.gateway.emitToRoom('role:ADMIN_STOCK', 'stock:adjusted', {
      itemId:    dto.stockItemId,
      itemName:  item.name,
      qtyBefore: item.currentQty,
      qtyAfter:  dto.newQty,
      adjustedBy: actorId,
    });
    this.gateway.emitToRoom('role:GENERAL_MANAGER', 'stock:adjusted', {
      itemId:    dto.stockItemId,
      itemName:  item.name,
      qtyBefore: item.currentQty,
      qtyAfter:  dto.newQty,
    });

    // NEW: Emit low-stock alert if applicable
    if (dto.newQty <= item.minStockQty && item.minStockQty > 0) {
      const alertPayload = {
        itemId:      dto.stockItemId,
        itemName:    item.name,
        currentQty:  dto.newQty,
        minStockQty: item.minStockQty,
        unit:        item.unit,
      };
      this.gateway.emitToRoom('role:ADMIN_STOCK', 'stock:lowAlert', alertPayload);
      this.gateway.emitToRoom('role:GENERAL_MANAGER', 'stock:lowAlert', alertPayload);
    }

    return updated;
  }

  // NEW: Check availability of multiple items — used by OrderService
  async checkAvailability(items: Array<{ stockItemId: string; requestedQty: number }>) {
    const results = await Promise.all(
      items.map(async ({ stockItemId, requestedQty }) => {
        const stock = await this.prisma.stockItem.findUnique({
          where:  { id: stockItemId },
          select: { id: true, name: true, currentQty: true, unit: true },
        });
        if (!stock) {
          return { stockItemId, name: 'Unknown', requestedQty, availableQty: 0, sufficient: false };
        }
        return {
          stockItemId,
          name:         stock.name,
          unit:         stock.unit,
          requestedQty,
          availableQty: stock.currentQty,
          sufficient:   stock.currentQty >= requestedQty,
        };
      }),
    );

    const allAvailable  = results.every((r) => r.sufficient);
    const noneAvailable = results.every((r) => !r.sufficient);

    return {
      items: results,
      summary: {
        allAvailable,
        noneAvailable,
        partialAvailable: !allAvailable && !noneAvailable,
      },
    };
  }

  /**
   * Deduction inside an existing transaction — StockOut fulfill shares OUT_ORDER audit + qty rules.
   */
  async deductInsideTransaction(
    tx: Prisma.TransactionClient,
    stockItemId: string,
    qty: number,
    actorId: string,
    reference: string,
  ): Promise<{
    itemId: string;
    itemName: string;
    newQty: number;
    minStockQty: number;
    unit: string;
  }> {
    const item = await tx.stockItem.findUnique({
      where: { id: stockItemId },
      select: { id: true, name: true, currentQty: true, minStockQty: true, unit: true },
    });
    if (!item) throw new NotFoundException('Barang tidak ditemukan');

    if (item.currentQty < qty) {
      throw new BadRequestException(
        `Stok ${item.name} tidak mencukupi. Tersedia: ${item.currentQty}, diminta: ${qty}`,
      );
    }

    const newQty = item.currentQty - qty;

    await tx.stockItem.update({
      where: { id: stockItemId },
      data: { currentQty: newQty },
    });
    await tx.stockLog.create({
      data: {
        stockItemId,
        type: 'OUT_ORDER',
        qtyBefore: item.currentQty,
        qtyChange: -qty,
        qtyAfter: newQty,
        reference,
        actorId,
      },
    });

    return {
      itemId: item.id,
      itemName: item.name,
      newQty,
      minStockQty: item.minStockQty,
      unit: item.unit,
    };
  }

  /** Socket low-stock alerts after qty change (reuse OUT_ORDER deduct behavior). */
  emitLowStockIfNeeded(payload: {
    itemId: string;
    itemName: string;
    currentQty: number;
    minStockQty: number;
    unit: string;
  }): void {
    if (payload.currentQty <= payload.minStockQty && payload.minStockQty > 0) {
      const alertPayload = {
        itemId: payload.itemId,
        itemName: payload.itemName,
        currentQty: payload.currentQty,
        minStockQty: payload.minStockQty,
        unit: payload.unit,
      };
      this.gateway.emitToRoom('role:ADMIN_STOCK', 'stock:lowAlert', alertPayload);
      this.gateway.emitToRoom('role:GENERAL_MANAGER', 'stock:lowAlert', alertPayload);
    }
  }

  // NEW: Deduct stock for a fulfilled order item — used by OrderService
  async deductStock(
    stockItemId: string,
    qty: number,
    actorId: string,
    reference: string,
  ) {
    const item = await this.prisma.stockItem.findUnique({ where: { id: stockItemId } });
    if (!item) return;

    const newQty = Math.max(0, item.currentQty - qty);

    await this.prisma.$transaction(async (tx) => {
      await tx.stockItem.update({ where: { id: stockItemId }, data: { currentQty: newQty } });
      await tx.stockLog.create({
        data: {
          stockItemId,
          type:      'OUT_ORDER',
          qtyBefore: item.currentQty,
          qtyChange: -qty,
          qtyAfter:  newQty,
          reference,
          actorId,
        },
      });
    });

    // NEW: Emit low-stock alert after deduction if threshold crossed
    if (newQty <= item.minStockQty && item.minStockQty > 0) {
      const alertPayload = {
        itemId: stockItemId, itemName: item.name,
        currentQty: newQty, minStockQty: item.minStockQty, unit: item.unit,
      };
      this.gateway.emitToRoom('role:ADMIN_STOCK', 'stock:lowAlert', alertPayload);
      this.gateway.emitToRoom('role:GENERAL_MANAGER', 'stock:lowAlert', alertPayload);
    }
  }

  // NEW: Add stock when goods received — used by SuratJalanService
  async receiveStock(
    stockItemId: string,
    qty: number,
    actorId: string,
    reference: string,
  ) {
    const item = await this.prisma.stockItem.findUnique({ where: { id: stockItemId } });
    if (!item) return;

    const newQty = item.currentQty + qty;

    await this.prisma.$transaction(async (tx) => {
      await tx.stockItem.update({ where: { id: stockItemId }, data: { currentQty: newQty } });
      await tx.stockLog.create({
        data: {
          stockItemId,
          type:      'IN_PURCHASE',
          qtyBefore: item.currentQty,
          qtyChange: qty,
          qtyAfter:  newQty,
          reference,
          actorId,
        },
      });
    });
  }

  // NEW: Low stock alerts dashboard widget
  async getLowStockAlerts() {
    const items = await this.prisma.stockItem.findMany({ where: { isActive: true } });
    return items
      .filter((i) => i.currentQty <= i.minStockQty)
      .map((i) => ({ ...i, isOutOfStock: i.currentQty === 0 }))
      .sort((a, b) => a.currentQty - b.currentQty);
  }

  // NEW: Dashboard summary card data
  async getStockSummary() {
    const items = await this.prisma.stockItem.findMany({ where: { isActive: true } });
    const totalItems     = items.length;
    const lowStockCount  = items.filter((i) => i.currentQty <= i.minStockQty && i.currentQty > 0).length;
    const outOfStockCount = items.filter((i) => i.currentQty === 0).length;
    const totalStockQty  = items.reduce((sum, i) => sum + i.currentQty, 0);

    return {
      totalItems,
      totalStockQty,
      lowStockCount,
      outOfStockCount,
      totalValue: 0,
    };
  }

  // NEW: Soft delete — sets isActive = false
  async softDelete(id: string) {
    const item = await this.prisma.stockItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Barang tidak ditemukan');
    return this.prisma.stockItem.update({ where: { id }, data: { isActive: false } });
  }
}
