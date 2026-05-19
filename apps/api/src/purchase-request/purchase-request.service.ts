import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma, PurchaseRequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { SuratJalanService } from '../surat-jalan/surat-jalan.service';
import { StockService } from '../stock/stock.service';
import { paginate, PaginatedResponse } from '../common/dto/pagination.dto';
import { PurchaseRequestListFilterDtoType } from './purchase-request.dto';

// NEW: Valid status transition map — enforces sequential flow
const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING:   ['IN_REVIEW', 'APPROVED', 'REJECTED'],
  IN_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED:  ['ORDERED'],
  ORDERED:   ['RECEIVED'],
  RECEIVED:  [],
  REJECTED:  [],
  CANCELLED: [],
};

@Injectable()
export class PurchaseRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
    private readonly suratJalanService: SuratJalanService,
    private readonly stockService: StockService,
  ) {}

  // NEW: Internal method called by OrderService — creates PR from order items missing stock
  async createFromOrder(orderId: string, items: any[], requestedBy: string) {
    const year  = new Date().getFullYear();
    const count = await this.prisma.purchaseRequest.count({ where: { createdAt: { gte: new Date(`${year}-01-01`) } } });
    const seq   = String(count + 1).padStart(4, '0');
    const requestNumber = `PR-${year}-${seq}`;

    // NEW: Calculate total if unit prices provided
    const totalAmount = items.reduce((sum, i) => {
      if (i.unitPrice && i.requestedQty) return sum + i.unitPrice * i.requestedQty;
      return sum;
    }, 0) || null;

    const pr = await this.prisma.purchaseRequest.create({
      data: {
        requestNumber,
        requestedBy,
        status:      'PENDING',
        totalAmount: totalAmount,
        items: {
          create: items.map((i) => ({
            itemName:     i.itemName,
            itemCode:     i.itemCode ?? null,
            category:     i.category ?? null,
            unit:         i.unit,
            requestedQty: i.requestedQty,
            unitPrice:    i.unitPrice ?? null,
            totalPrice:   i.unitPrice != null ? i.unitPrice * i.requestedQty : null,
          })),
        },
      },
      include: { items: true, requester: { select: { name: true } } },
    });

    if (orderId) {
      await this.prisma.order.update({
        where: { id: orderId },
        data:  { purchaseRequestId: pr.id },
      });
    }

    // NEW: Notify Finance team in real-time
    this.gateway.emitToRoom('role:FINANCE', 'purchaseRequest:new', {
      id:          pr.id,
      requestNumber,
      requestedBy: pr.requester?.name,
      totalAmount,
      itemCount:   items.length,
      createdAt:   pr.createdAt,
    });

    return pr;
  }

  /** Tambah stok gudang saat PR RECEIVED — cocokkan kode/nama ke StockItem. */
  private async applyPurchaseRequestToStock(prId: string, actorId: string, reference: string) {
    const lines = await this.prisma.purchaseRequestItem.findMany({ where: { purchaseRequestId: prId } });
    for (const line of lines) {
      let stock = line.itemCode
        ? await this.prisma.stockItem.findFirst({ where: { code: line.itemCode, isActive: true } })
        : null;
      if (!stock) {
        stock = await this.prisma.stockItem.findFirst({
          where: { name: { equals: line.itemName, mode: 'insensitive' }, isActive: true },
        });
      }
      if (!stock) continue;
      await this.stockService.receiveStock(stock.id, line.requestedQty, actorId, reference);
    }
  }

  // MODIFIED: paginated list — pendingCount hanya via GET /purchase-requests/inbox-count
  async findAll(
    filters: PurchaseRequestListFilterDtoType,
    userId: string,
    userRole: string,
  ): Promise<PaginatedResponse<unknown>> {
    const { status, page, limit, search, dateFrom, dateTo, sortBy, sortOrder } = filters;
    const skip  = (page - 1) * limit;

    const where: Prisma.PurchaseRequestWhereInput = {};

    if (status) where.status = status as PurchaseRequestStatus;
    if (search?.trim()) {
      where.requestNumber = { contains: search.trim(), mode: 'insensitive' };
    }
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo)   where.createdAt.lte = new Date(dateTo);
    }

    if (['PM_FTTH', 'PM_FTTB', 'PM_FTTT'].includes(userRole)) {
      where.requestedBy = userId;
    }

    const orderField = sortBy && ['createdAt', 'requestNumber'].includes(sortBy) ? sortBy : 'createdAt';
    const orderBy = { [orderField]: sortOrder } as Prisma.PurchaseRequestOrderByWithRelationInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.purchaseRequest.findMany({
        where,
        skip,
        take:    limit,
        orderBy,
        include: {
          requester: { select: { id: true, name: true, role: true } },
          processor: { select: { id: true, name: true } },
          items:     true,
          order:     { select: { id: true, orderNumber: true, fiberType: true } },
        },
      }),
      this.prisma.purchaseRequest.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  // NEW: Single PR with full detail — PM_* hanya milik sendiri
  async findOne(id: string, userId?: string, userRole?: string) {
    const pr = await this.prisma.purchaseRequest.findUnique({
      where:   { id },
      include: {
        requester: { select: { id: true, name: true, email: true, role: true } },
        processor: { select: { id: true, name: true } },
        items:     true,
        order:     { select: { id: true, orderNumber: true, fiberType: true, projectRef: true } },
      },
    });
    if (!pr) throw new NotFoundException('Purchase request tidak ditemukan');
    if (
      userId &&
      userRole &&
      ['PM_FTTH', 'PM_FTTB', 'PM_FTTT'].includes(userRole) &&
      pr.requestedBy !== userId
    ) {
      throw new ForbiddenException('Akses ditolak');
    }
    return pr;
  }

  // NEW: Finance inbox unread count — for badge widget
  async getFinanceInboxCount() {
    const count = await this.prisma.purchaseRequest.count({ where: { status: 'PENDING' } });
    return { count };
  }

  // NEW: Finance progresses PR through status flow
  async updateStatus(
    id: string,
    newStatus: string,
    financeNotes: string | undefined,
    processorId: string,
  ) {
    const pr = await this.findOne(id);

    // NEW: Validate status transition
    const allowed = VALID_TRANSITIONS[pr.status] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new BadRequestException(
        `Tidak bisa mengubah status dari ${pr.status} ke ${newStatus}`,
      );
    }

    if (newStatus === 'REJECTED' && !(financeNotes && financeNotes.trim())) {
      throw new BadRequestException('Catatan wajib saat menolak permintaan');
    }

    const updateData: any = { status: newStatus, processedBy: processorId };
    if (financeNotes)         updateData.financeNotes = financeNotes;
    if (newStatus === 'APPROVED')  updateData.approvedAt  = new Date();
    if (newStatus === 'RECEIVED')  updateData.processedAt = new Date();

    const updated = await this.prisma.purchaseRequest.update({
      where: { id },
      data:  updateData,
    });

    // NEW: On RECEIVED — SJ-IN PDF + tambah stok gudang sesuai baris PR
    if (newStatus === 'RECEIVED') {
      const sj = await this.suratJalanService.generateSuratJalanIn(id, processorId);
      await this.applyPurchaseRequestToStock(id, processorId, sj.documentNumber);
    }

    // NEW: Notify PM who made the original order
    this.gateway.emitToRoom(`user:${pr.requestedBy}`, 'purchaseRequest:updated', {
      id:           pr.id,
      requestNumber: pr.requestNumber,
      status:       newStatus,
      financeNotes: financeNotes ?? null,
    });

    return updated;
  }

  // NEW: Finance updates item prices inline
  async updateItemPrices(id: string, pricedItems: Array<{ itemId: string; unitPrice: number }>) {
    const pr = await this.findOne(id);

    await Promise.all(
      pricedItems.map(({ itemId, unitPrice }) =>
        this.prisma.purchaseRequestItem.findUnique({ where: { id: itemId } }).then(async (item) => {
          if (!item || item.purchaseRequestId !== id) return;
          await this.prisma.purchaseRequestItem.update({
            where: { id: itemId },
            data:  { unitPrice, totalPrice: unitPrice * item.requestedQty },
          });
        }),
      ),
    );

    // NEW: Recalculate total on PR
    const items       = await this.prisma.purchaseRequestItem.findMany({ where: { purchaseRequestId: id } });
    const totalAmount = items.reduce((sum, i) => sum + (Number(i.totalPrice) ?? 0), 0);

    return this.prisma.purchaseRequest.update({
      where: { id },
      data:  { totalAmount },
    });
  }
}
