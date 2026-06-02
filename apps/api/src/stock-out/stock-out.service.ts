import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, Role, StockOut, StockOutStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { StockService } from '../stock/stock.service';
import { SuratJalanService } from '../surat-jalan/surat-jalan.service';
import { runSerializableTransaction } from '../budget-ledger/transaction-retry.util';
import { paginate, PaginatedResponse } from '../common/dto/pagination.dto';
import type {
  CreateStockOutDtoType,
  FilterStockOutDtoType,
  RejectStockOutDtoType,
  AdminStockApproveDtoType,
  ReturnForRevisionDtoType,
} from './stock-out.dto';

type StockOutItemJson = { stockItemId: string; qty: number; notes?: string; itemName?: string };

const PM_ROLES: Role[] = [Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR];

@Injectable()
export class StockOutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly gateway: NotificationsGateway,
    private readonly stock: StockService,
    private readonly suratJalan: SuratJalanService,
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

  // Step 1: PM creates request
  async create(dto: CreateStockOutDtoType, requestedById: string): Promise<StockOut> {
    const created = await runSerializableTransaction(this.prisma, async (tx) => {
      const stockItemIds = dto.items.map((i) => i.stockItemId);
      const stockItems = await tx.stockItem.findMany({ where: { id: { in: stockItemIds } } });

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
          recipient: dto.recipient,
          recipientCompany: dto.recipientCompany ?? null,
          recipientAddress: dto.recipientAddress ?? null,
          recipientTelp: dto.recipientTelp ?? null,
          items: itemsWithName as Prisma.InputJsonValue,
          notes: dto.notes ?? null,
          status: StockOutStatus.PENDING,
        },
        include: { requestedBy: { select: { id: true, name: true } } },
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

  // PM revises a DRAFT request and resubmits
  async resubmit(id: string, dto: CreateStockOutDtoType, requestedById: string): Promise<StockOut> {
    const stockOut = await this.prisma.stockOut.findUniqueOrThrow({
      where: { id },
      include: { requestedBy: { select: { id: true, name: true } } },
    });

    if (stockOut.requestedById !== requestedById) throw new ForbiddenException();
    if (stockOut.status !== StockOutStatus.DRAFT) {
      throw new BadRequestException(`Hanya DRAFT yang dapat di-resubmit (current: ${stockOut.status})`);
    }

    const stockItems = await this.prisma.stockItem.findMany({
      where: { id: { in: dto.items.map((i) => i.stockItemId) } },
    });
    const nameMap = new Map(stockItems.map((s) => [s.id, s.name]));
    const itemsWithName = dto.items.map((item) => ({
      stockItemId: item.stockItemId,
      qty: item.qty,
      notes: item.notes,
      itemName: nameMap.get(item.stockItemId) ?? null,
    }));

    const updated = await this.prisma.stockOut.update({
      where: { id },
      data: {
        items: itemsWithName as Prisma.InputJsonValue,
        recipient: dto.recipient,
        recipientCompany: dto.recipientCompany ?? null,
        recipientAddress: dto.recipientAddress ?? null,
        recipientTelp: dto.recipientTelp ?? null,
        permitClusterId: dto.permitClusterId ?? null,
        notes: dto.notes ?? null,
        status: StockOutStatus.PENDING,
        revisionNotes: null,
      },
      include: { requestedBy: { select: { id: true, name: true } } },
    });

    await this.notifications.notifyUsersByRole(Role.ADMIN_STOCK, {
      title: 'Revisi Stock Out',
      message: `${updated.requestedBy.name} telah merevisi permintaan (${updated.requestNumber})`,
      type: 'STOCK_OUT_REQUESTED',
      link: '/stock-out',
      entityId: updated.id,
    });
    this.gateway.emitToRoom(`role:${Role.ADMIN_STOCK}`, 'stockOut:requested', {
      stockOutId: updated.id,
      requestNumber: updated.requestNumber,
    });

    return updated;
  }

  // Step 2a: Admin Stock approves (adds DO number) → PENDING_PM_CONFIRM
  async adminStockApprove(id: string, dto: AdminStockApproveDtoType, actorId: string): Promise<StockOut> {
    const stockOut = await this.prisma.stockOut.findUniqueOrThrow({
      where: { id },
      include: { requestedBy: { select: { id: true, name: true } } },
    });

    if (stockOut.status !== StockOutStatus.PENDING) {
      throw new BadRequestException(`Hanya PENDING yang dapat diapprove Admin Stock (current: ${stockOut.status})`);
    }

    const updated = await this.prisma.stockOut.update({
      where: { id },
      data: {
        status: StockOutStatus.PENDING_PM_CONFIRM,
        doNumber: dto.doNumber,
        adminStockApprovedById: actorId,
        adminStockApprovedAt: new Date(),
        revisionNotes: null,
      },
      include: { requestedBy: { select: { id: true, name: true } } },
    });

    // Notify the requesting PM
    await this.notifications.createForUser(stockOut.requestedById, {
      title: 'Stock Out — Menunggu Konfirmasi Anda',
      message: `Admin Stock telah menyetujui ${updated.requestNumber}. Silakan lakukan konfirmasi.`,
      type: 'STOCK_OUT_REQUESTED',
      link: `/stock-out/${id}`,
      entityId: id,
    });
    this.gateway.emitToRoom(`user:${stockOut.requestedById}`, 'stockOut:pendingPmConfirm', {
      stockOutId: id,
      requestNumber: updated.requestNumber,
    });

    return updated;
  }

  // Step 2b: Admin Stock returns to PM for revision → DRAFT
  async adminStockReturn(id: string, dto: ReturnForRevisionDtoType, actorId: string): Promise<StockOut> {
    const stockOut = await this.prisma.stockOut.findUniqueOrThrow({
      where: { id },
      include: { requestedBy: { select: { id: true, name: true } } },
    });

    if (stockOut.status !== StockOutStatus.PENDING) {
      throw new BadRequestException(`Hanya PENDING yang dapat dikembalikan (current: ${stockOut.status})`);
    }

    const updated = await this.prisma.stockOut.update({
      where: { id },
      data: {
        status: StockOutStatus.DRAFT,
        revisionNotes: dto.reason,
      },
    });

    await this.notifications.createForUser(stockOut.requestedById, {
      title: 'Stock Out Dikembalikan — Perlu Revisi',
      message: `Admin Stock mengembalikan ${stockOut.requestNumber}: ${dto.reason}`,
      type: 'STOCK_OUT_REJECTED',
      link: `/stock-out/${id}`,
      entityId: id,
    });
    this.gateway.emitToRoom(`user:${stockOut.requestedById}`, 'stockOut:returned', {
      stockOutId: id,
      requestNumber: stockOut.requestNumber,
    });

    return updated;
  }

  // Step 3a: PM confirms → PENDING_FINANCE
  async pmConfirm(id: string, actorId: string): Promise<StockOut> {
    const stockOut = await this.prisma.stockOut.findUniqueOrThrow({
      where: { id },
      include: { requestedBy: { select: { id: true, name: true } } },
    });

    if (stockOut.status !== StockOutStatus.PENDING_PM_CONFIRM) {
      throw new BadRequestException(`Status harus PENDING_PM_CONFIRM (current: ${stockOut.status})`);
    }

    if (stockOut.requestedById !== actorId) {
      throw new ForbiddenException('Hanya PM yang membuat request yang dapat melakukan konfirmasi');
    }

    const updated = await this.prisma.stockOut.update({
      where: { id },
      data: {
        status: StockOutStatus.PENDING_FINANCE,
        pmConfirmedById: actorId,
        pmConfirmedAt: new Date(),
      },
    });

    await this.notifications.notifyUsersByRole(Role.FINANCE, {
      title: 'Stock Out — Menunggu Persetujuan Finance',
      message: `PM telah mengkonfirmasi ${stockOut.requestNumber}. Silakan lakukan approval.`,
      type: 'STOCK_OUT_REQUESTED',
      link: '/stock-out',
      entityId: id,
    });
    this.gateway.emitToRoom(`role:${Role.FINANCE}`, 'stockOut:pendingFinance', {
      stockOutId: id,
      requestNumber: stockOut.requestNumber,
    });

    return updated;
  }

  // Step 3b: PM sends back to Admin Stock for correction → PENDING
  async pmReturn(id: string, dto: ReturnForRevisionDtoType, actorId: string): Promise<StockOut> {
    const stockOut = await this.prisma.stockOut.findUniqueOrThrow({
      where: { id },
      include: { requestedBy: { select: { id: true, name: true } } },
    });

    if (stockOut.status !== StockOutStatus.PENDING_PM_CONFIRM) {
      throw new BadRequestException(`Status harus PENDING_PM_CONFIRM (current: ${stockOut.status})`);
    }

    if (stockOut.requestedById !== actorId) {
      throw new ForbiddenException('Hanya PM yang membuat request yang dapat melakukan tindakan ini');
    }

    const updated = await this.prisma.stockOut.update({
      where: { id },
      data: {
        status: StockOutStatus.PENDING,
        doNumber: null,
        adminStockApprovedById: null,
        adminStockApprovedAt: null,
        revisionNotes: dto.reason,
      },
    });

    await this.notifications.notifyUsersByRole(Role.ADMIN_STOCK, {
      title: 'Stock Out Dikembalikan ke Admin Stock',
      message: `PM mengembalikan ${stockOut.requestNumber} untuk perbaikan: ${dto.reason}`,
      type: 'STOCK_OUT_REQUESTED',
      link: '/stock-out',
      entityId: id,
    });
    this.gateway.emitToRoom(`role:${Role.ADMIN_STOCK}`, 'stockOut:returned', {
      stockOutId: id,
      requestNumber: stockOut.requestNumber,
    });

    return updated;
  }

  // Step 4a: Finance approves → FULFILLED + generate Surat Jalan
  async financeApprove(id: string, actorId: string): Promise<StockOut> {
    const fulfilled = await runSerializableTransaction(this.prisma, async (tx) => {
      const stockOut = await tx.stockOut.findUniqueOrThrow({
        where: { id },
        include: {
          requestedBy: { select: { id: true, name: true } },
          adminStockApprover: { select: { id: true, name: true, signatureUrl: true } },
          pmConfirmer: { select: { id: true, name: true, signatureUrl: true } },
        },
      });

      if (stockOut.status !== StockOutStatus.PENDING_FINANCE) {
        throw new BadRequestException(`Status harus PENDING_FINANCE (current: ${stockOut.status})`);
      }

      const items = stockOut.items as StockOutItemJson[];

      // Validate stock availability
      for (const item of items) {
        const stockItem = await tx.stockItem.findUniqueOrThrow({ where: { id: item.stockItemId } });
        if (stockItem.currentQty < item.qty) {
          throw new BadRequestException(
            `Stok ${stockItem.name} tidak mencukupi. Tersedia: ${stockItem.currentQty}, diminta: ${item.qty}`,
          );
        }
      }

      // Deduct stock
      const lowMeta: Array<{ itemId: string; itemName: string; newQty: number; minStockQty: number; unit: string }> = [];
      for (const item of items) {
        const meta = await this.stock.deductInsideTransaction(tx, item.stockItemId, item.qty, actorId, `StockOut:${id}`);
        lowMeta.push(meta);
      }

      const financeUser = await tx.user.findUnique({
        where: { id: actorId },
        select: { id: true, name: true, signatureUrl: true },
      });

      const updated = await tx.stockOut.update({
        where: { id },
        data: {
          status: StockOutStatus.FULFILLED,
          financeApprovedById: actorId,
          financeApprovedAt: new Date(),
          fulfilledAt: new Date(),
        },
        include: {
          requestedBy: { select: { id: true, name: true } },
          adminStockApprover: { select: { id: true, name: true, signatureUrl: true } },
          pmConfirmer: { select: { id: true, name: true, signatureUrl: true } },
        },
      });

      return { updated, lowMeta, financeUser, stockOut };
    });

    // Emit low stock alerts
    for (const m of fulfilled.lowMeta) {
      this.stock.emitLowStockIfNeeded({
        itemId: m.itemId,
        itemName: m.itemName,
        currentQty: m.newQty,
        minStockQty: m.minStockQty,
        unit: m.unit,
      });
    }

    // Generate Surat Jalan
    try {
      const sj = await this.suratJalan.generateForStockOut(id, actorId);
      await this.prisma.stockOut.update({
        where: { id },
        data: { suratJalanId: sj.id },
      });
    } catch (err) {
      // Log but don't fail the approval — SJ can be regenerated later
      console.error('[StockOut] Failed to generate Surat Jalan:', err);
    }

    // Notify requester
    await this.notifications.createForUser(fulfilled.updated.requestedById, {
      title: 'Stock Out Disetujui Finance — Surat Jalan Tersedia',
      message: `Permintaan ${fulfilled.updated.requestNumber} telah disetujui. Surat Jalan dapat diunduh.`,
      type: 'STOCK_OUT_FULFILLED',
      link: `/stock-out/${id}`,
      entityId: id,
    });
    this.gateway.emitToRoom(`user:${fulfilled.updated.requestedById}`, 'stockOut:fulfilled', {
      stockOutId: id,
      requestNumber: fulfilled.updated.requestNumber,
    });

    return fulfilled.updated;
  }

  // Step 4b: Finance returns to PM → DRAFT
  async financeReturn(id: string, dto: ReturnForRevisionDtoType, actorId: string): Promise<StockOut> {
    const stockOut = await this.prisma.stockOut.findUniqueOrThrow({
      where: { id },
      include: { requestedBy: { select: { id: true, name: true } } },
    });

    if (stockOut.status !== StockOutStatus.PENDING_FINANCE) {
      throw new BadRequestException(`Status harus PENDING_FINANCE (current: ${stockOut.status})`);
    }

    const updated = await this.prisma.stockOut.update({
      where: { id },
      data: {
        status: StockOutStatus.DRAFT,
        doNumber: null,
        adminStockApprovedById: null,
        adminStockApprovedAt: null,
        pmConfirmedById: null,
        pmConfirmedAt: null,
        revisionNotes: dto.reason,
      },
    });

    await this.notifications.createForUser(stockOut.requestedById, {
      title: 'Stock Out Ditolak Finance — Perlu Revisi',
      message: `Finance mengembalikan ${stockOut.requestNumber}: ${dto.reason}`,
      type: 'STOCK_OUT_REJECTED',
      link: `/stock-out/${id}`,
      entityId: id,
    });
    this.gateway.emitToRoom(`user:${stockOut.requestedById}`, 'stockOut:returned', {
      stockOutId: id,
      requestNumber: stockOut.requestNumber,
    });

    return updated;
  }

  // Legacy: hard reject (kept for backward compatibility / admin override)
  async reject(id: string, dto: RejectStockOutDtoType, rejectedById: string): Promise<StockOut> {
    const stockOut = await this.prisma.stockOut.findUniqueOrThrow({ where: { id } });

    const updated = await this.prisma.stockOut.update({
      where: { id },
      data: {
        status: StockOutStatus.REJECTED,
        fulfilledById: rejectedById,
        fulfilledAt: new Date(),
        rejectionReason: dto.reason,
      },
    });

    await this.notifications.createForUser(stockOut.requestedById, {
      title: 'Permintaan Barang Ditolak',
      message: `Permintaan ${stockOut.requestNumber} ditolak: ${dto.reason}`,
      type: 'STOCK_OUT_REJECTED',
      link: `/stock-out/${id}`,
      entityId: id,
    });
    this.gateway.emitToRoom(`user:${stockOut.requestedById}`, 'stockOut:rejected', {
      stockOutId: id,
      requestNumber: stockOut.requestNumber,
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
      } else if (userRole === Role.FINANCE) {
        where.status = StockOutStatus.PENDING_FINANCE;
      } else if (PM_ROLES.includes(userRole)) {
        // PM inbox: PENDING_PM_CONFIRM for their own requests + DRAFT needing revision
        where.requestedById = userId;
        where.status = { in: [StockOutStatus.PENDING_PM_CONFIRM, StockOutStatus.DRAFT] };
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
          adminStockApprover: { select: { id: true, name: true } },
          pmConfirmer: { select: { id: true, name: true } },
          financeApprover: { select: { id: true, name: true } },
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
        adminStockApprover: { select: { id: true, name: true } },
        pmConfirmer: { select: { id: true, name: true } },
        financeApprover: { select: { id: true, name: true } },
        permitCluster: true,
        suratJalan: { select: { id: true, documentNumber: true, pdfUrl: true, status: true } },
      },
    });

    const overseers: Role[] = [Role.ADMIN_STOCK, Role.ADMIN, Role.GENERAL_MANAGER, Role.FINANCE];
    const canView = stockOut.requestedById === userId || overseers.includes(userRole);
    if (!canView) throw new ForbiddenException();

    return stockOut;
  }

  async getInboxCount(userId: string, userRole: Role): Promise<number> {
    if (userRole === Role.ADMIN_STOCK) {
      return this.prisma.stockOut.count({ where: { status: StockOutStatus.PENDING } });
    }
    if (userRole === Role.FINANCE) {
      return this.prisma.stockOut.count({ where: { status: StockOutStatus.PENDING_FINANCE } });
    }
    if (PM_ROLES.includes(userRole)) {
      return this.prisma.stockOut.count({
        where: {
          requestedById: userId,
          status: { in: [StockOutStatus.PENDING_PM_CONFIRM, StockOutStatus.DRAFT] },
        },
      });
    }
    return 0;
  }
}
