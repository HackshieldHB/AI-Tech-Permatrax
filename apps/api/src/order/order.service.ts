import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, Role, FiberType, OrderTrigger, BudgetLedgerEntryType, BudgetLedgerSourceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { SuratJalanService } from '../surat-jalan/surat-jalan.service';
import { PurchaseRequestService } from '../purchase-request/purchase-request.service';
import { BudgetLedgerService } from '../budget-ledger/budget-ledger.service';
import { runSerializableTransaction } from '../budget-ledger/transaction-retry.util';
import { PoGenerationService } from '../po-generation/po-generation.service';
import type { UtilizationPair } from '../budget-ledger/budget-ledger.service';
import {
  CreateOrderDtoType,
  CreateApprovalOrderDtoType,
  OrderFilterDtoType,
  CreateRestockOrderDtoType,
  CancelOrderDtoType,
  FinanceProcessDtoType,
} from './order.dto';
import { paginate, PaginatedResponse } from '../common/dto/pagination.dto';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
    private readonly gateway: NotificationsGateway,
    private readonly suratJalanService: SuratJalanService,
    private readonly purchaseRequestService: PurchaseRequestService,
    private readonly notifications: NotificationsService,
    private readonly budgetLedger: BudgetLedgerService,
    private readonly poGeneration: PoGenerationService,
  ) {}

  private async nextOrderNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `ORD-${year}-`;
    // FIX: use pg advisory lock to serialize generation — eliminates race condition that produced
    // duplicate order numbers under concurrency.  The lock is scoped to the transaction so it
    // releases automatically on commit/rollback.
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order_seq_${year}`})::bigint)`;
        const last = await tx.order.findFirst({
          where: { orderNumber: { startsWith: prefix } },
          orderBy: { orderNumber: 'desc' },
          select: { orderNumber: true },
        });
        let seq = 1;
        if (last?.orderNumber) {
          const parts = last.orderNumber.split('-');
          const lastSeq = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(lastSeq)) seq = lastSeq + 1;
        }
        return `${prefix}${String(seq).padStart(4, '0')}`;
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async create(dto: CreateOrderDtoType, createdBy: string) {
    // FIX: projectRef mandatory (defense in depth; DTO also validates)
    if (!dto.projectRef?.trim()) {
      throw new BadRequestException('Referensi Proyek wajib diisi');
    }

    const orderNumber = await this.nextOrderNumber();

    const order = await this.prisma.order.create({
      data: {
        orderNumber,
        createdBy,
        fiberType:  dto.fiberType,
        projectRef: dto.projectRef.trim(), // FIX
        notes:      dto.notes,
        financeProjectId: dto.financeProjectId?.trim() || null,
        orderTrigger: dto.orderTrigger ?? OrderTrigger.PROJECT_REQUEST,
        status:     'DRAFT',
        items: {
          create: dto.items.map((item) => ({
            stockItemId:   item.stockItemId ?? null,
            itemName:      item.itemName,
            itemCode:      item.itemCode,
            category:      item.category,
            unit:          item.unit,
            requestedQty:  item.requestedQty,
            unitPrice:     item.unitPrice ?? null,
            totalPrice:    item.unitPrice ? item.unitPrice * item.requestedQty : null,
          })),
        },
      },
      include: { items: true },
    });

    // FIX: notify ALL Admin Stock — draft katalog menunggu submit PM
    const itemCount = dto.items.length;
    await this.notifications.createForRole(Role.ADMIN_STOCK, {
      title:   '📦 Order Barang Baru dari PM',
      message: `${order.orderNumber} — ${dto.projectRef.trim()}. PM membuat order katalog (${itemCount} baris). Silakan pantau setelah PM submit.`,
      type:    'STOCK',
      link:    `/orders/${order.id}`,
      entityId: order.id,
    });

    return order;
  }

  async createApprovalOrder(dto: CreateApprovalOrderDtoType, createdBy: string) {
    // FIX: projectRef mandatory
    if (!dto.projectRef?.trim()) {
      throw new BadRequestException('Referensi Proyek wajib diisi');
    }

    const orderNumber = await this.nextOrderNumber();
    const order = await this.prisma.order.create({
      data: {
        orderNumber,
        createdBy,
        fiberType:       dto.fiberType ?? 'FTTH',
        projectRef:      dto.projectRef.trim(), // FIX
        notes:           dto.notes,
        financeProjectId: dto.financeProjectId?.trim() || null,
        orderTrigger: dto.orderTrigger ?? OrderTrigger.PROJECT_REQUEST,
        status:          'PENDING_ADMIN_STOCK',
        requestedItems:  dto.requestedItems as unknown as Prisma.InputJsonValue,
        items:           { create: [] },
      },
      include: { creator: { select: { id: true, name: true, role: true } }, items: true },
    });

    // FIX: notify ALL Admin Stock — detail proyek + jumlah item
    const reqLen = dto.requestedItems.length;
    await this.notifications.createForRole(Role.ADMIN_STOCK, {
      title:   '📦 Order Barang Baru dari PM',
      message: `${order.orderNumber} — ${dto.projectRef.trim()}. PM mengajukan ${reqLen} item. Silakan cek detail dan input harga.`,
      type:    'STOCK',
      link:    `/orders/${order.id}`,
      entityId: order.id,
    });

    return order;
  }

  /** Admin Stock: restock warehouse — langsung ke Purchasing (M3), budget project INVENTORY atau override. */
  async createRestock(dto: CreateRestockOrderDtoType, adminStockUserId: string) {
    let financeProjectId = dto.financeProjectId?.trim() || null;

    if (!financeProjectId) {
      const inventoryProject = await this.prisma.financeProject.findFirst({
        where: { code: 'INVENTORY', status: 'ACTIVE' },
      });
      if (!inventoryProject) {
        throw new InternalServerErrorException(
          'Project INVENTORY belum di-seed. Hubungi administrator.',
        );
      }
      financeProjectId = inventoryProject.id;
    } else {
      const project = await this.prisma.financeProject.findFirst({
        where: { id: financeProjectId, status: 'ACTIVE' },
      });
      if (!project) {
        throw new BadRequestException('Project tidak valid atau tidak aktif');
      }
    }

    const orderNumber = await this.nextOrderNumber();
    const keys = dto.items.map((i) => i.productId);
    const stockRows = await this.prisma.stockItem.findMany({
      where: {
        OR: [{ id: { in: keys } }, { code: { in: keys } }],
        isActive: true,
      },
    });

    const byKey = new Map<string, (typeof stockRows)[0]>();
    for (const s of stockRows) {
      byKey.set(s.id, s);
      byKey.set(s.code, s);
    }

    const lineCreates = [];
    for (const line of dto.items) {
      const stock = byKey.get(line.productId);
      if (!stock) {
        throw new BadRequestException(`Barang/katalog tidak ditemukan atau nonaktif: ${line.productId}`);
      }
      lineCreates.push({
        stockItemId: stock.id,
        itemName: stock.name,
        itemCode: stock.code,
        category: stock.category,
        unit: stock.unit,
        requestedQty: line.qty,
        availableQty: stock.currentQty,
      });
    }

    const requestedItems = dto.items.map((i) => ({
      productId: i.productId,
      qty:       i.qty,
      notes:     i.notes ?? null,
    }));

    const created = await this.prisma.order.create({
      data: {
        orderNumber,
        createdBy: adminStockUserId,
        fiberType: FiberType.FTTH,
        projectRef: 'RESTOCK-GUDANG',
        notes:      dto.notes,
        financeProjectId,
        orderTrigger: OrderTrigger.STOCK_RESTOCK,
        status:       'PENDING_PURCHASING_INPUT',
        requestedItems: requestedItems as unknown as Prisma.InputJsonValue,
        totalAmount:  new Prisma.Decimal(0),
        items:        { create: lineCreates },
      },
      include: { items: true },
    });

    await this.notifications.notifyUsersByRole(Role.PURCHASING, {
      title: 'Restock Gudang Menunggu Input Harga',
      message: `Restock gudang ${created.orderNumber} menunggu input supplier dan harga`,
      type: 'ORDER_PENDING_PURCHASING_INPUT',
      link: `/orders/${created.id}`,
      entityId: created.id,
    });
    this.gateway.emitToRoom(`role:${Role.PURCHASING}`, 'order:pendingPurchasing', {
      orderId: created.id,
      orderNumber: created.orderNumber,
    });

    return created;
  }

  async submit(orderId: string, userId: string, userRole: string) {
    const order = await this.prisma.order.findUnique({
      where:   { id: orderId },
      include: { items: { include: { stockItem: true } }, creator: { select: { id: true, name: true } } },
    });

    if (!order) throw new NotFoundException('Order tidak ditemukan');
    if (order.createdBy !== userId) throw new ForbiddenException('Hanya pembuat order yang bisa submit');
    if (order.status !== 'DRAFT') throw new ConflictException(`Order sudah disubmit (status: ${order.status})`);

    // FIX Issue 1A: Admin Stock orders catalog items to RESTOCK the warehouse — they must never
    // trigger a stock deduction. Route their entire order straight to the purchasing approval
    // chain so that goods are received and stock is ADDED after verification ("Sesuai").
    const isAdminStockRestock = userRole === Role.ADMIN_STOCK;

    const catalogItems    = order.items.filter((i) => i.stockItemId !== null);
    const noCatalogItems  = order.items.filter((i) => i.stockItemId === null);

    let availableItems: typeof catalogItems   = [];
    let unavailableItems: typeof catalogItems = [];

    if (catalogItems.length > 0 && !isAdminStockRestock) {
      // Only check / deduct stock for non-Admin-Stock submitters (i.e. PM outgoing requests)
      const availability = await this.stockService.checkAvailability(
        catalogItems.map((i) => ({ stockItemId: i.stockItemId!, requestedQty: i.requestedQty })),
      );

      for (const result of availability.items) {
        await this.prisma.orderItem.updateMany({
          where: { orderId, stockItemId: result.stockItemId },
          data:  { availableQty: result.availableQty },
        });
      }

      availableItems   = catalogItems.filter((i) => {
        const r = availability.items.find((a) => a.stockItemId === i.stockItemId);
        return r?.sufficient;
      });
      unavailableItems = catalogItems.filter((i) => {
        const r = availability.items.find((a) => a.stockItemId === i.stockItemId);
        return !r?.sufficient;
      });
    } else if (isAdminStockRestock) {
      // Admin Stock restock: treat all items as needing purchase (no deduction)
      unavailableItems = catalogItems;
    }

    const needsPurchase = [...unavailableItems, ...noCatalogItems];
    const hasStock      = availableItems.length > 0;
    const needsBuy      = needsPurchase.length > 0 || isAdminStockRestock;

    if (hasStock && !needsBuy) {
      await this.deductAvailableItems(order, availableItems, userId);
      const sj = await this.suratJalanService.generateSuratJalanOut(orderId, userId);
      await this.prisma.order.update({
        where: { id: orderId },
        data:  { status: 'STOCK_AVAILABLE', suratJalanId: sj.id },
      });

      this.gateway.emitToRoom(`user:${userId}`, 'order:suratJalanReady', {
        orderId,
        orderNumber:    order.orderNumber,
        suratJalanId:   sj.id,
        documentNumber: sj.documentNumber,
        pdfUrl:         sj.pdfUrl,
      });

    } else if (!hasStock && needsBuy) {
      const pr = await this.purchaseRequestService.createFromOrder(orderId, order.items, userId);
      await this.prisma.order.update({
        where: { id: orderId },
        data:  { status: 'NO_STOCK', purchaseRequestId: pr.id },
      });

      const prPayload = {
        orderId,
        orderNumber:       order.orderNumber,
        purchaseRequestId: pr.id,
        requestNumber:     pr.requestNumber,
      };
      this.gateway.emitToRoom(`user:${userId}`, 'order:purchaseRequestCreated', prPayload);
      this.gateway.emitToRoom('role:FINANCE', 'order:purchaseRequestCreated', prPayload);

    } else {
      await this.deductAvailableItems(order, availableItems, userId);
      const sj = await this.suratJalanService.generateSuratJalanOut(orderId, userId);
      const pr = await this.purchaseRequestService.createFromOrder(orderId, needsPurchase, userId);

      await this.prisma.order.update({
        where: { id: orderId },
        data:  { status: 'PARTIAL_STOCK', suratJalanId: sj.id, purchaseRequestId: pr.id },
      });

      this.gateway.emitToRoom(`user:${userId}`, 'order:suratJalanReady', {
        orderId, orderNumber: order.orderNumber,
        suratJalanId: sj.id, documentNumber: sj.documentNumber, pdfUrl: sj.pdfUrl,
      });
      const prPayload = {
        orderId, orderNumber: order.orderNumber,
        purchaseRequestId: pr.id, requestNumber: pr.requestNumber,
      };
      this.gateway.emitToRoom(`user:${userId}`, 'order:purchaseRequestCreated', prPayload);
      this.gateway.emitToRoom('role:FINANCE', 'order:purchaseRequestCreated', prPayload);
    }

    return this.findOne(orderId, userId, userRole);
  }

  async findAll(
    filters: OrderFilterDtoType,
    userId: string,
    userRole: string,
  ): Promise<PaginatedResponse<unknown>> {
    const { status, fiberType, orderTrigger, dateFrom, dateTo, page, limit, search, sortBy, sortOrder } = filters;
    const skip = (page - 1) * limit;

    const where: Prisma.OrderWhereInput = {};
    if (orderTrigger) {
      where.orderTrigger = orderTrigger;
    }
    if (status) {
      const statuses = status.split(',').map((s) => s.trim()).filter(Boolean);
      if (statuses.length === 1) where.status = statuses[0] as any;
      else if (statuses.length > 1) where.status = { in: statuses as any[] };
    }
    if (fiberType) where.fiberType = fiberType;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo)   where.createdAt.lte = new Date(dateTo);
    }

    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        { orderNumber: { contains: q, mode: 'insensitive' } },
        { projectRef: { contains: q, mode: 'insensitive' } },
      ];
    }

    // FIX: Admin Stock, Ops, GM, Finance, Admin see ALL orders; lainnya hanya milik sendiri
    const adminRoles: string[] = [
      'ADMIN_STOCK',
      'OPERATIONAL_MANAGER',
      'GENERAL_MANAGER',
      'FINANCE',
      'ADMIN',
      'PURCHASING',
    ];
    if (!adminRoles.includes(userRole)) {
      where.createdBy = userId;
    }

    const orderField = sortBy && ['createdAt', 'orderNumber'].includes(sortBy) ? sortBy : 'createdAt';
    const orderBy = { [orderField]: sortOrder } as Prisma.OrderOrderByWithRelationInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          creator:         { select: { id: true, name: true, role: true } }, // FIX: tampilan pemohon
          items:           { select: { id: true, itemName: true, requestedQty: true, unit: true, availableQty: true } },
          suratJalan:      { select: { id: true, documentNumber: true, status: true, pdfUrl: true } },
          purchaseRequest: { select: { id: true, requestNumber: true, status: true, totalAmount: true } },
          financeProject:  { select: { id: true, code: true, name: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async findOne(id: string, userId: string, userRole: string) {
    const order = await this.prisma.order.findUnique({
      where:   { id },
      include: {
        creator:         { select: { id: true, name: true, email: true, role: true } },
        items:           { include: { stockItem: { select: { id: true, name: true, currentQty: true } } } },
        suratJalan:      true,
        purchaseRequest: { include: { items: true } },
        financeProject:  { select: { id: true, code: true, name: true } },
        supplier: { select: { id: true, code: true, name: true, email: true, phone: true, isActive: true } },
        supplierInvoice: true,
      },
    });

    if (!order) throw new NotFoundException('Order tidak ditemukan');

    // FIX: non-admin hanya lihat order sendiri
    const adminRoles: string[] = [
      'ADMIN_STOCK',
      'OPERATIONAL_MANAGER',
      'GENERAL_MANAGER',
      'FINANCE',
      'ADMIN',
      'PURCHASING',
    ];
    if (!adminRoles.includes(userRole) && order.createdBy !== userId) {
      throw new ForbiddenException('Akses ditolak');
    }

    return order;
  }

  async cancel(id: string, dto: CancelOrderDtoType, userId: string, userRole: string) {
    const cancellable = new Set<string>([
      'DRAFT',
      'SUBMITTED',
      'STOCK_AVAILABLE',
      'PARTIAL_STOCK',
      'NO_STOCK',
      'PENDING_ADMIN_STOCK',
      'PENDING_PURCHASING_INPUT',
      'PENDING_OPS_APPROVAL',
      'PENDING_GM_APPROVAL',
      'PENDING_PAYMENT_RECEIPT',
    ]);

    return runSerializableTransaction(this.prisma, async (tx) => {
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Order tidak ditemukan');
      if (order.status === 'CANCELLED') {
        throw new BadRequestException('Order sudah dibatalkan');
      }
      if (!cancellable.has(order.status)) {
        throw new BadRequestException(
          `Order dengan status ${order.status} tidak dapat dibatalkan`,
        );
      }

      const postDeduct = order.status === 'PENDING_PAYMENT_RECEIPT';
      const isCreator = order.createdBy === userId;
      const isFinance = userRole === 'FINANCE';
      const isGm = userRole === 'GENERAL_MANAGER';
      const isAdmin = userRole === 'ADMIN';
      const isPmSenior = userRole === 'PM_SENIOR';

      const allowed = postDeduct
        ? isFinance || isGm || isAdmin
        : isCreator || isPmSenior || isFinance || isGm || isAdmin;

      if (!allowed) {
        throw new ForbiddenException('Anda tidak memiliki akses untuk membatalkan order ini');
      }

      if (postDeduct) {
        await this.budgetLedger.refundForOrder(
          id,
          userId,
          `Order dibatalkan: ${dto.reason}`,
          tx,
        );
      }

      // FIX: restore stock that was deducted at submit() for STOCK_AVAILABLE / PARTIAL_STOCK orders
      const needsStockRestore = order.status === 'STOCK_AVAILABLE' || order.status === 'PARTIAL_STOCK';
      if (needsStockRestore) {
        const orderWithItems = await tx.order.findUnique({
          where: { id },
          include: {
            items: {
              where: { stockItemId: { not: null }, fulfilledQty: { gt: 0 } },
            },
          },
        });
        for (const item of orderWithItems?.items ?? []) {
          if (item.stockItemId && item.fulfilledQty > 0) {
            const stockRow = await tx.stockItem.findUnique({
              where: { id: item.stockItemId },
              select: { currentQty: true },
            });
            const qtyBefore = stockRow?.currentQty ?? 0;
            const qtyAfter = qtyBefore + item.fulfilledQty;
            await tx.stockItem.update({
              where: { id: item.stockItemId },
              data: { currentQty: { increment: item.fulfilledQty } },
            });
            await tx.stockLog.create({
              data: {
                stockItemId: item.stockItemId,
                type: 'IN_RETURN',
                qtyBefore,
                qtyChange: item.fulfilledQty,
                qtyAfter,
                reference: id,
                notes: `cancel:${order.orderNumber};reason:${dto.reason}`,
                actorId: userId,
              },
            });
          }
        }
      }

      return tx.order.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledById: userId,
          cancelledAt: new Date(),
          cancelReason: dto.reason,
        },
      });
    });
  }

  async adminStockSubmit(
    id: string,
    data: {
      purchaseItems: {
        name: string;
        quantity: number;
        unit: string;
        unitPrice: number;
        totalPrice: number;
        notes?: string;
      }[];
      adminStockNotes?: string;
    },
    userId: string,
  ) {
    const order = await this.findOrderRaw(id);

    const orderTriggerLabel =
      order.orderTrigger === OrderTrigger.STOCK_RESTOCK ? 'Restock Gudang' : 'Project Request';

    if (order.orderTrigger === OrderTrigger.STOCK_RESTOCK) {
      throw new BadRequestException(
        'STOCK_RESTOCK tidak memerlukan submit Admin Stock terpisah (sudah di-create oleh Admin Stock)',
      );
    }

    // FIX: DRAFT / pengajuan + order katalog setelah submit (NO_STOCK / PARTIAL_STOCK) perlu input harga ke Purchasing / Ops
    const allowedAdminStockStatuses = [
      'DRAFT',
      'PENDING_ADMIN_STOCK',
      'NO_STOCK',
      'PARTIAL_STOCK',
    ] as const;
    if (!allowedAdminStockStatuses.includes(order.status as (typeof allowedAdminStockStatuses)[number])) {
      throw new BadRequestException(
        `Order tidak bisa diproses dari status ${order.status}. Hanya DRAFT atau Menunggu Admin Stok.`,
      );
    }

    if (!data.purchaseItems?.length) {
      throw new BadRequestException('Minimal 1 item harus diisi');
    }

    const totalAmount = data.purchaseItems.reduce(
      (sum, item) => sum + (Number(item.totalPrice) || 0),
      0,
    );

    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        purchaseItems: data.purchaseItems as unknown as Prisma.InputJsonValue,
        totalAmount: new Prisma.Decimal(totalAmount),
        adminStockNotes: data.adminStockNotes || null,
        adminStockSubmittedBy: userId,
        submittedByAdminAt: new Date(),
        status: 'PENDING_PURCHASING_INPUT',
        items: {
          deleteMany: {},
          create: data.purchaseItems.map((item) => ({
            itemName: item.name,
            requestedQty: item.quantity,
            unit: item.unit,
            itemCode: null,
            category: null,
            stockItemId: null,
            availableQty: 0,
            unitPrice: new Prisma.Decimal(item.unitPrice ?? 0),
            totalPrice: new Prisma.Decimal(item.totalPrice ?? 0),
          })),
        },
      },
    });

    if (updated.status === 'PENDING_PURCHASING_INPUT') {
      await this.notifications.notifyUsersByRole(Role.PURCHASING, {
        title: 'Order Menunggu Input Harga',
        message: `Order ${updated.orderNumber} (${orderTriggerLabel}) menunggu input supplier dan harga`,
        type: 'ORDER_PENDING_PURCHASING_INPUT',
        link: `/orders/${updated.id}`,
        entityId: updated.id,
      });
      this.gateway.emitToRoom(`role:${Role.PURCHASING}`, 'order:pendingPurchasing', {
        orderId: updated.id,
        orderNumber: updated.orderNumber,
      });
    }

    return updated;
  }

  async opsApprove(id: string, data: { notes?: string }, userId: string) {
    const order = await this.findOrderRaw(id);
    if (order.orderTrigger === OrderTrigger.STOCK_RESTOCK) {
      throw new BadRequestException('STOCK_RESTOCK tidak memerlukan approval Ops');
    }
    if (order.status !== 'PENDING_OPS_APPROVAL') {
      throw new BadRequestException(
        'Hanya order yang menunggu Ops yang bisa diapprove',
      );
    }

    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        status: 'PENDING_GM_APPROVAL',
        opsNotes: data.notes || null,
        opsApprovedBy: userId,
        opsApprovedAt: new Date(),
      },
    });

    await this.notifications.createForRole(Role.GENERAL_MANAGER, {
      title:   '📋 Order Barang Perlu Approval GM',
      message: `Ops Manager menyetujui order ${order.orderNumber} senilai Rp ${Number(order.totalAmount ?? 0).toLocaleString('id-ID')}. Silakan review.`,
      type:    'STOCK',
      link:    `/orders/${id}`,
      entityId: id,
    });

    await this.notifications.createForUser(order.createdBy, {
      title:   '🔄 Order Disetujui Ops Manager',
      message: `Order ${order.orderNumber} disetujui Ops. Menunggu approval GM.`,
      type:    'STOCK',
      link:    `/orders/${id}`,
      entityId: id,
    });

    return updated;
  }

  async opsReject(id: string, data: { notes: string }, userId: string) {
    if (!data.notes?.trim()) {
      throw new BadRequestException('Alasan penolakan wajib diisi');
    }
    const order = await this.findOrderRaw(id);
    if (order.status !== 'PENDING_OPS_APPROVAL') {
      throw new BadRequestException('Status tidak valid untuk ditolak');
    }

    // FIX: STOCK_RESTOCK orders skip Admin Stock phase entirely — send back to Purchasing input,
    // not PENDING_ADMIN_STOCK (which would get them stuck with no actor to advance them).
    const rejectedStatus = order.orderTrigger === OrderTrigger.STOCK_RESTOCK
      ? 'PENDING_PURCHASING_INPUT'
      : 'PENDING_ADMIN_STOCK';

    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        status: rejectedStatus,
        opsNotes: data.notes,
        opsRejectionReason: data.notes,
        opsApprovedBy: userId,
        opsApprovedAt: new Date(),
        revisionCount: { increment: 1 },
      },
    });

    const notifyRole = order.orderTrigger === OrderTrigger.STOCK_RESTOCK ? Role.PURCHASING : Role.ADMIN_STOCK;
    await this.notifications.createForRole(notifyRole, {
      title:   '↺ Order Dikembalikan untuk Revisi (Ops)',
      message: `Ops Manager menolak order ${order.orderNumber}. Alasan: ${data.notes}. Silakan revisi.`,
      type:    'STOCK',
      link:    `/orders/${id}`,
      entityId: id,
    });

    await this.notifications.createForUser(order.createdBy, {
      title:   '⚠️ Order Perlu Revisi',
      message: `Order ${order.orderNumber} dikembalikan untuk revisi. Alasan Ops: ${data.notes}`,
      type:    'STOCK',
      link:    `/orders/${id}`,
      entityId: id,
    });

    return updated;
  }

  async gmApprove(id: string, data: { notes?: string; signatureUrl?: string }, userId: string) {
    const meta = await runSerializableTransaction(this.prisma, async (tx) => {
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Order tidak ditemukan');
      if (order.status !== 'PENDING_GM_APPROVAL') {
        throw new BadRequestException('Hanya order yang menunggu GM yang bisa diapprove');
      }

      const totalAmt = new Prisma.Decimal(order.totalAmount ?? 0);
      const projectId = await this.budgetLedger.resolveProjectId(order.financeProjectId, tx);

      let prevUtil: UtilizationPair | null = null;
      let didDeduct = false;

      if (totalAmt.gt(0)) {
        const existingDeduct = await tx.budgetLedger.findFirst({
          where: {
            sourceType: BudgetLedgerSourceType.ORDER,
            sourceId: id,
            entryType: BudgetLedgerEntryType.DEDUCT_MATERIAL,
          },
        });
        if (existingDeduct) {
          this.logger.warn(`Order ${id}: DEDUCT_MATERIAL already exists, skipping deduct (idempotency)`);
        } else {
          const fp = await tx.financeProject.findUniqueOrThrow({ where: { id: projectId } });
          prevUtil = this.budgetLedger.utilizationFromProject(fp);
          await this.budgetLedger.deductForOrder(
            id,
            projectId,
            totalAmt,
            userId,
            order.createdBy,
            tx,
          );
          didDeduct = true;
        }
      }

      const updated = await tx.order.update({
        where: { id },
        data: {
          status: 'PENDING_PAYMENT_RECEIPT',
          gmNotes: data.notes || null,
          gmApprovedBy: userId,
          gmApprovedAt: new Date(),
        },
      });

      return {
        updated,
        projectId,
        prevUtil,
        totalAmt,
        didDeduct,
        creatorId: order.createdBy,
      };
    });

    try {
      await this.poGeneration.generateAndStorePo(id, data.signatureUrl);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`PO generation gagal untuk order ${id}: ${msg}`, stack);
    }

    if (meta.didDeduct && meta.prevUtil != null && meta.totalAmt.gt(0)) {
      await this.budgetLedger.afterDeductNotifyOrder(
        meta.projectId,
        meta.prevUtil,
        userId,
        meta.creatorId,
        meta.totalAmt,
      );
    }

    await this.notifications.createForRole(Role.FINANCE, {
      title:   '💳 Order disetujui GM — lakukan pembayaran',
      message:
        `GM menyetujui order ${meta.updated.orderNumber}. Budget material telah dipotong. Silakan lakukan pembayaran dan unggah bukti.`,
      type:    'STOCK',
      link:    `/orders/${id}`,
      entityId: id,
    });
    this.gateway.emitToRoom(`role:${Role.FINANCE}`, 'order:gmApproved', {
      orderId: meta.updated.id,
      orderNumber: meta.updated.orderNumber,
    });

    await this.notifications.createForUser(meta.creatorId, {
      title:   '✅ Order Disetujui GM',
      message: `Order ${meta.updated.orderNumber} disetujui GM. Finance akan memproses pembayaran.`,
      type:    'STOCK',
      link:    `/orders/${id}`,
      entityId: id,
    });

    return meta.updated;
  }

  async gmReject(id: string, data: { notes: string }, userId: string) {
    if (!data.notes?.trim()) {
      throw new BadRequestException('Alasan penolakan wajib diisi');
    }
    const order = await this.findOrderRaw(id);
    if (order.status !== 'PENDING_GM_APPROVAL') {
      throw new BadRequestException('Status tidak valid untuk ditolak');
    }

    // FIX: STOCK_RESTOCK orders have no Admin Stock phase — send back to Purchasing input,
    // not PENDING_ADMIN_STOCK (which would leave them stuck with no actor to advance them).
    const rejectedStatus = order.orderTrigger === OrderTrigger.STOCK_RESTOCK
      ? 'PENDING_PURCHASING_INPUT'
      : 'PENDING_ADMIN_STOCK';

    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        status: rejectedStatus,
        gmNotes: data.notes,
        gmRejectionReason: data.notes,
        gmApprovedBy: userId,
        gmApprovedAt: new Date(),
        revisionCount: { increment: 1 },
      },
    });

    const notifyRole = order.orderTrigger === OrderTrigger.STOCK_RESTOCK ? Role.PURCHASING : Role.ADMIN_STOCK;
    await this.notifications.createForRole(notifyRole, {
      title:   '↺ Order Dikembalikan untuk Revisi (GM)',
      message: `GM menolak order ${order.orderNumber}. Alasan: ${data.notes}. Silakan revisi dan submit ulang.`,
      type:    'STOCK',
      link:    `/orders/${id}`,
      entityId: id,
    });

    await this.notifications.createForUser(order.createdBy, {
      title:   '⚠️ Order Perlu Revisi',
      message: `Order ${order.orderNumber} dikembalikan untuk revisi. Alasan GM: ${data.notes}`,
      type:    'STOCK',
      link:    `/orders/${id}`,
      entityId: id,
    });

    return updated;
  }

  async financeProcess(id: string, data: FinanceProcessDtoType, userId: string) {
    const updated = await runSerializableTransaction(this.prisma, async (tx) => {
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Order tidak ditemukan');
      if (order.status !== 'PENDING_PAYMENT_RECEIPT' && order.status !== 'PENDING_FINANCE') {
        throw new BadRequestException('Order belum siap untuk diproses Finance');
      }
      if (data.amount != null) {
        this.logger.warn(`financeProcess: field amount ignored for order ${id} (deduct at GM approve)`);
      }

      return tx.order.update({
        where: { id },
        data: {
          status: 'PURCHASED',
          financeNotes: data.notes || null,
          financeReceiptUrl: data.receiptUrl || null,
          financeProcessedBy: userId,
          financeProcessedAt: new Date(),
        },
      });
    });

    await this.notifications.createForRole(Role.ADMIN_STOCK, {
      title:   '🚚 Barang Dalam Perjalanan',
      message: `Finance memproses pembayaran order ${updated.orderNumber ?? id}. Siapkan penerimaan barang.`,
      type:    'STOCK',
      link:    `/orders/${id}`,
      entityId: id,
    });
    this.gateway.emitToRoom(`role:${Role.ADMIN_STOCK}`, 'order:purchased', {
      orderId: updated.id,
      orderNumber: updated.orderNumber,
    });

    return updated;
  }

  async verifyItems(
    id: string,
    data: {
      status: 'SESUAI' | 'TIDAK_SESUAI';
      verificationNotes?: string;
    },
    userId: string,
  ) {
    const { order, notifyCreatorFulfilled, notifyTidakSesuai } = await runSerializableTransaction(
      this.prisma,
      async (tx) => {
        const orderRow = await tx.order.findUniqueOrThrow({
          where: { id },
          include: { items: true },
        });

        const awaiting = ['PURCHASED', 'PENDING_VERIFICATION'].includes(orderRow.status);
        const idempotentSesuai =
          data.status === 'SESUAI' &&
          orderRow.status === 'FULFILLED' &&
          orderRow.verificationStatus === 'SESUAI';

        if (data.status === 'TIDAK_SESUAI' && !awaiting) {
          throw new BadRequestException(
            `Order tidak dapat diverifikasi dari status ${orderRow.status}`,
          );
        }

        if (data.status === 'SESUAI' && !awaiting && !idempotentSesuai) {
          throw new BadRequestException(
            `Order tidak dapat diverifikasi dari status ${orderRow.status}`,
          );
        }

        if (data.status === 'TIDAK_SESUAI') {
          const updated = await tx.order.update({
            where: { id },
            data: {
              status: 'PENDING_VERIFICATION',
              verificationStatus: 'TIDAK_SESUAI',
              verificationNotes: data.verificationNotes || null,
              verifiedBy: userId,
              itemsArrivedAt: new Date(),
            },
          });

          return {
            order: updated,
            notifyCreatorFulfilled: false,
            notifyTidakSesuai: true,
          };
        }

        const existingInOrder = await tx.stockLog.findFirst({
          where: { type: 'IN_ORDER', reference: id },
        });

        if (idempotentSesuai && existingInOrder) {
          this.logger.warn(
            `Order ${id} sudah pernah menambah stok (IN_ORDER), permintaan duplikat diabaikan.`,
          );
          return { order: orderRow, notifyCreatorFulfilled: false, notifyTidakSesuai: false };
        }

        if (!existingInOrder) {
          for (const line of orderRow.items) {
            let stockItemId = line.stockItemId;
            if (!stockItemId) {
              const existing = await tx.stockItem.findFirst({
                where: { name: { equals: line.itemName, mode: 'insensitive' } },
              });
              if (existing) {
                stockItemId = existing.id;
              } else {
                // FIX: use UUID for auto-generated code — eliminates collision risk from Date.now()+random
                const newStock = await tx.stockItem.create({
                  data: {
                    name: line.itemName,
                    code: `AUTO-${randomUUID().replace(/-/g, '').substring(0, 12).toUpperCase()}`,
                    category: line.category || 'UNCATEGORIZED',
                    unit: line.unit ?? 'pcs',
                    mitra: 'Lainnya',
                    currentQty: 0,
                    minStockQty: 0,
                    createdBy: userId,
                  },
                });
                stockItemId = newStock.id;
              }
              await tx.orderItem.update({
                where: { id: line.id },
                data: { stockItemId },
              });
            }

            if (!stockItemId || line.requestedQty <= 0) {
              this.logger.warn(
                `Order ${id} baris ${line.id} tanpa stockItemId atau qty 0 — dilewati untuk IN_ORDER.`,
              );
              continue;
            }
            const stock = await tx.stockItem.findUnique({
              where: { id: stockItemId },
              select: { id: true, currentQty: true },
            });
            if (!stock) {
              throw new BadRequestException(`Barang stok untuk baris order tidak ditemukan (${line.itemName}).`);
            }
            const qtyAfter = stock.currentQty + line.requestedQty;
            await tx.stockItem.update({
              where: { id: stockItemId },
              data: { currentQty: { increment: line.requestedQty } },
            });
            await tx.stockLog.create({
              data: {
                stockItemId: stockItemId,
                type: 'IN_ORDER',
                qtyBefore: stock.currentQty,
                qtyChange: line.requestedQty,
                qtyAfter,
                reference: id,
                notes: `order:${orderRow.orderNumber};item:${line.id}`,
                actorId: userId,
              },
            });
          }
        } else if (awaiting) {
          this.logger.warn(
            `Order ${id} sudah punya log stok IN_ORDER — increment dilewati, status order tetap diperbarui.`,
          );
        }

        const now = new Date();
        const updated = await tx.order.update({
          where: { id },
          data: {
            status: 'FULFILLED',
            verificationStatus: 'SESUAI',
            verificationNotes: data.verificationNotes || null,
            verifiedBy: userId,
            fulfilledAt: now,
          },
        });

        return {
          order: updated,
          notifyCreatorFulfilled: true,
          notifyTidakSesuai: false,
        };
      },
    );

    if (notifyTidakSesuai) {
      await this.notifications.createForUser(order.createdBy, {
        title: '⚠️ Barang Tidak Sesuai',
        message: `Order ${order.orderNumber} dilaporkan tidak sesuai. Mohon ditinjau kembali.`,
        type: 'ORDER',
        link: `/orders/${order.id}`,
        entityId: order.id,
      });
      this.gateway.emitToRoom(`user:${order.createdBy}`, 'order:tidakSesuai', {
        orderId: order.id,
        orderNumber: order.orderNumber,
      });
    }

    if (notifyCreatorFulfilled) {
      await this.notifications.createForUser(order.createdBy, {
        title: '✅ Order Selesai',
        message: `Order ${order.orderNumber} telah diverifikasi dan diselesaikan.`,
        type: 'ORDER',
        link: `/orders/${order.id}`,
        entityId: order.id,
      });
      this.gateway.emitToRoom(`user:${order.createdBy}`, 'order:fulfilled', {
        orderId: order.id,
        orderNumber: order.orderNumber,
      });
    }

    return order;
  }

  private async findOrderRaw(id: string) {
    return this.prisma.order.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });
  }

  private async deductAvailableItems(
    order: { id: string; orderNumber: string | null },
    availableItems: Array<{ stockItemId: string | null; availableQty: number; id: string }>,
    userId: string,
  ) {
    for (const item of availableItems) {
      if (!item.stockItemId || item.availableQty <= 0) continue;
      await this.stockService.deductStock(
        item.stockItemId,
        item.availableQty,
        userId,
        order.id,
      );
    }
  }
}
