import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { runSerializableTransaction } from '../budget-ledger/transaction-retry.util';
import { paginate, PaginatedResponse } from '../common/dto/pagination.dto';
import type { PurchasingInboxFilterDtoType, SubmitPriceDtoType } from './purchasing.dto';

const inboxInclude = {
  items: { include: { stockItem: true } },
  financeProject: true,
  creator: { select: { id: true, name: true, email: true, role: true } },
} as const;

export type PurchasingInboxOrder = Prisma.OrderGetPayload<{ include: typeof inboxInclude }>;

@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly gateway: NotificationsGateway,
  ) {}

  async getInbox(
    _userId: string,
    filter: PurchasingInboxFilterDtoType,
  ): Promise<PaginatedResponse<PurchasingInboxOrder>> {
    const where: Prisma.OrderWhereInput = {
      status: 'PENDING_PURCHASING_INPUT',
    };

    if (filter.orderTrigger !== 'all') {
      where.orderTrigger = filter.orderTrigger;
    }

    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: inboxInclude,
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.order.count({ where }),
    ]);

    return paginate(items, total, filter.page, filter.limit);
  }

  async getInboxCount(): Promise<number> {
    return this.prisma.order.count({
      where: { status: 'PENDING_PURCHASING_INPUT' },
    });
  }

  async submitPrice(orderId: string, dto: SubmitPriceDtoType, purchasingUserId: string) {
    const updated = await runSerializableTransaction(this.prisma, async (tx) => {
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true },
      });

      if (order.status !== 'PENDING_PURCHASING_INPUT') {
        throw new BadRequestException(
          `Order ini tidak dalam status menunggu input harga (current: ${order.status})`,
        );
      }

      const supplier = await tx.supplier.findUnique({ where: { id: dto.supplierId } });
      if (!supplier) {
        throw new BadRequestException('Supplier tidak ditemukan');
      }
      if (!supplier.isActive) {
        throw new BadRequestException('Supplier sudah dinonaktifkan, pilih supplier lain');
      }

      if (order.items.length === 0) {
        throw new BadRequestException('Order tidak memiliki baris item');
      }

      if (dto.items.length !== order.items.length) {
        throw new BadRequestException('Setiap baris order harus diisi harga (jumlah tidak sesuai)');
      }

      const orderItemIds = new Set(order.items.map((i) => i.id));
      const dtoIds = dto.items.map((i) => i.orderItemId);
      const dtoIdSet = new Set(dtoIds);
      if (dtoIdSet.size !== dtoIds.length) {
        throw new BadRequestException('orderItemId duplikat pada payload');
      }
      for (const id of dtoIds) {
        if (!orderItemIds.has(id)) {
          throw new BadRequestException(`OrderItem ${id} tidak ditemukan di order ini`);
        }
      }

      let grandTotal = new Prisma.Decimal(0);
      for (const dtoItem of dto.items) {
        const orderItem = order.items.find((i) => i.id === dtoItem.orderItemId)!;
        const unitPrice = new Prisma.Decimal(dtoItem.unitPrice);
        const totalPrice = unitPrice.mul(orderItem.requestedQty);

        await tx.orderItem.update({
          where: { id: dtoItem.orderItemId },
          data: { unitPrice, totalPrice },
        });

        grandTotal = grandTotal.plus(totalPrice);
      }

      let ppnType = dto.ppnType;
      let ppnValueDecimal = dto.ppnValue ? new Prisma.Decimal(dto.ppnValue) : null;
      if (ppnType === 'PERCENT' && ppnValueDecimal) {
        const ppnAmt = grandTotal.mul(ppnValueDecimal).div(100);
        grandTotal = grandTotal.plus(ppnAmt);
      } else if (ppnType === 'NOMINAL' && ppnValueDecimal) {
        grandTotal = grandTotal.plus(ppnValueDecimal);
      } else {
        ppnType = null;
        ppnValueDecimal = null;
      }

      const nextStatus =
        order.orderTrigger === 'STOCK_RESTOCK' ? 'PENDING_GM_APPROVAL' : 'PENDING_OPS_APPROVAL';

      return tx.order.update({
        where: { id: orderId },
        data: {
          supplierId: dto.supplierId,
          totalAmount: grandTotal,
          ppnType: ppnType || null,
          ppnValue: ppnValueDecimal,
          purchasingSubmittedById: purchasingUserId,
          purchasingSubmittedAt: new Date(),
          purchasingNotes: dto.notes ?? null,
          status: nextStatus,
        },
      });
    });

    const nextRole = updated.status === 'PENDING_OPS_APPROVAL' ? Role.OPERATIONAL_MANAGER : Role.GENERAL_MANAGER;
    const nextRoleLabel = updated.status === 'PENDING_OPS_APPROVAL' ? 'Ops Manager' : 'GM';
    const totalLabel = Number(updated.totalAmount ?? 0).toLocaleString('id-ID');

    await this.notifications.notifyUsersByRole(nextRole, {
      title: `Order Menunggu Approval ${nextRoleLabel}`,
      message: `Order ${updated.orderNumber} menunggu approval Anda. Total: Rp ${totalLabel}`,
      type: 'ORDER_PENDING_APPROVAL',
      link: `/orders/${updated.id}`,
      entityId: updated.id,
    });

    // Notify the Admin Stock user who submitted/created the order so they know
    // Purchasing has processed it and it is now advancing through the approval chain.
    // For STOCK_RESTOCK, createdBy is the Admin Stock user. For PROJECT_REQUEST processed
    // via adminStockSubmit, adminStockSubmittedBy holds the Admin Stock user ID.
    const adminStockNotifyUserId =
      updated.adminStockSubmittedBy ??
      (updated.orderTrigger === 'STOCK_RESTOCK' ? updated.createdBy : null);
    if (adminStockNotifyUserId) {
      await this.notifications.createForUser(adminStockNotifyUserId, {
        title: '📋 Harga Disubmit Purchasing',
        message: `Purchasing telah mengisi harga untuk order ${updated.orderNumber} (Rp ${totalLabel}). Menunggu approval ${nextRoleLabel}.`,
        type: 'STOCK',
        link: `/orders/${updated.id}`,
        entityId: updated.id,
      });
    }

    if (updated.status === 'PENDING_OPS_APPROVAL') {
      this.gateway.emitToRoom(`role:${Role.OPERATIONAL_MANAGER}`, 'order:pendingOpsApproval', {
        orderId: updated.id,
        orderNumber: updated.orderNumber,
      });
    }
    if (updated.status === 'PENDING_GM_APPROVAL') {
      this.gateway.emitToRoom(`role:${Role.GENERAL_MANAGER}`, 'order:pendingGmApproval', {
        orderId: updated.id,
        orderNumber: updated.orderNumber,
      });
    }

    return updated;
  }
}
