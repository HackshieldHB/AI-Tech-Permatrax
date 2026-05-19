import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PurchasingService } from './purchasing.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { runSerializableTransaction } from '../budget-ledger/transaction-retry.util';
import { SubmitPriceDto } from './purchasing.dto';

jest.mock('../budget-ledger/transaction-retry.util', () => ({
  runSerializableTransaction: jest.fn(),
}));

describe('PurchasingService', () => {
  let service: PurchasingService;
  const prisma = {
    order: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    orderItem: { update: jest.fn() },
    supplier: { findUnique: jest.fn() },
  };

  const notifications = { notifyUsersByRole: jest.fn().mockResolvedValue(1) };
  const gateway = { emitToRoom: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchasingService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: NotificationsGateway, useValue: gateway },
      ],
    }).compile();
    service = module.get(PurchasingService);
    (runSerializableTransaction as jest.Mock).mockImplementation(async (_p: unknown, fn: (tx: typeof prisma) => Promise<unknown>) =>
      fn(prisma),
    );
  });

  describe('getInbox', () => {
    it('filters PENDING_PURCHASING_INPUT', async () => {
      prisma.order.findMany.mockResolvedValue([]);
      prisma.order.count.mockResolvedValue(0);
      await service.getInbox('u1', { page: 1, limit: 20, orderTrigger: 'all' });
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'PENDING_PURCHASING_INPUT' }),
          orderBy: { createdAt: 'asc' },
        }),
      );
    });

    it('orderTrigger PROJECT_REQUEST', async () => {
      prisma.order.findMany.mockResolvedValue([]);
      prisma.order.count.mockResolvedValue(0);
      await service.getInbox('u1', { page: 1, limit: 10, orderTrigger: 'PROJECT_REQUEST' });
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orderTrigger: 'PROJECT_REQUEST' }),
        }),
      );
    });

    it('orderTrigger STOCK_RESTOCK', async () => {
      prisma.order.findMany.mockResolvedValue([]);
      prisma.order.count.mockResolvedValue(0);
      await service.getInbox('u1', { page: 1, limit: 10, orderTrigger: 'STOCK_RESTOCK' });
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orderTrigger: 'STOCK_RESTOCK' }),
        }),
      );
    });

    it('pagination', async () => {
      prisma.order.findMany.mockResolvedValue([]);
      prisma.order.count.mockResolvedValue(0);
      await service.getInbox('u1', { page: 2, limit: 5, orderTrigger: 'all' });
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 5, take: 5 }),
      );
    });

    it('FIFO ordering', async () => {
      prisma.order.findMany.mockResolvedValue([]);
      prisma.order.count.mockResolvedValue(0);
      await service.getInbox('u1', { page: 1, limit: 20, orderTrigger: 'all' });
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'asc' } }),
      );
    });
  });

  describe('getInboxCount', () => {
    it('counts by status', async () => {
      prisma.order.count.mockResolvedValue(3);
      await expect(service.getInboxCount()).resolves.toBe(3);
      expect(prisma.order.count).toHaveBeenCalledWith({
        where: { status: 'PENDING_PURCHASING_INPUT' },
      });
    });
  });

  describe('submitPrice', () => {
    const orderBase = {
      id: 'o1',
      status: 'PENDING_PURCHASING_INPUT',
      orderTrigger: 'PROJECT_REQUEST',
      orderNumber: 'ORD-1',
      items: [{ id: 'oi1', requestedQty: 3 }],
    };

    beforeEach(() => {
      prisma.order.findUniqueOrThrow.mockResolvedValue(orderBase);
      prisma.supplier.findUnique.mockResolvedValue({ id: 'sup1', isActive: true });
      prisma.orderItem.update.mockResolvedValue({});
      prisma.order.update.mockResolvedValue({
        id: 'o1',
        orderNumber: 'ORD-1',
        status: 'PENDING_OPS_APPROVAL',
        totalAmount: new Prisma.Decimal(300),
      });
    });

    it('PROJECT_REQUEST → PENDING_OPS_APPROVAL', async () => {
      await service.submitPrice(
        'o1',
        { supplierId: 'sup1', items: [{ orderItemId: 'oi1', unitPrice: 100 }] },
        'pur1',
      );
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING_OPS_APPROVAL', supplierId: 'sup1' }),
        }),
      );
      expect(notifications.notifyUsersByRole).toHaveBeenCalled();
    });

    it('STOCK_RESTOCK → PENDING_GM_APPROVAL', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        ...orderBase,
        orderTrigger: 'STOCK_RESTOCK',
      });
      prisma.order.update.mockResolvedValue({
        id: 'o1',
        orderNumber: 'ORD-1',
        status: 'PENDING_GM_APPROVAL',
        totalAmount: new Prisma.Decimal(300),
      });
      await service.submitPrice(
        'o1',
        { supplierId: 'sup1', items: [{ orderItemId: 'oi1', unitPrice: 100 }] },
        'pur1',
      );
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING_GM_APPROVAL' }),
        }),
      );
    });

    it('wrong status → 400', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({ ...orderBase, status: 'DRAFT', items: orderBase.items });
      await expect(
        service.submitPrice('o1', { supplierId: 'sup1', items: [{ orderItemId: 'oi1', unitPrice: 1 }] }, 'p1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('supplier not found → 400', async () => {
      prisma.supplier.findUnique.mockResolvedValue(null);
      await expect(
        service.submitPrice('o1', { supplierId: 'sup1', items: [{ orderItemId: 'oi1', unitPrice: 1 }] }, 'p1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('supplier inactive → 400', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 'sup1', isActive: false });
      await expect(
        service.submitPrice('o1', { supplierId: 'sup1', items: [{ orderItemId: 'oi1', unitPrice: 1 }] }, 'p1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('orderItem not in order → 400', async () => {
      await expect(
        service.submitPrice(
          'o1',
          { supplierId: 'sup1', items: [{ orderItemId: 'bad', unitPrice: 1 }] },
          'p1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('empty items on order → 400', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({ ...orderBase, items: [] });
      await expect(
        service.submitPrice('o1', { supplierId: 'sup1', items: [{ orderItemId: 'oi1', unitPrice: 1 }] }, 'p1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('partial items count → 400', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        ...orderBase,
        items: [
          { id: 'oi1', requestedQty: 1 },
          { id: 'oi2', requestedQty: 2 },
        ],
      });
      await expect(
        service.submitPrice('o1', { supplierId: 'sup1', items: [{ orderItemId: 'oi1', unitPrice: 1 }] }, 'p1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('updates total from qty × unitPrice', async () => {
      await service.submitPrice(
        'o1',
        { supplierId: 'sup1', items: [{ orderItemId: 'oi1', unitPrice: 100 }] },
        'pur1',
      );
      expect(prisma.orderItem.update).toHaveBeenCalledWith({
        where: { id: 'oi1' },
        data: { unitPrice: new Prisma.Decimal(100), totalPrice: new Prisma.Decimal(300) },
      });
    });

    it('sets purchasing submit fields', async () => {
      await service.submitPrice(
        'o1',
        { supplierId: 'sup1', items: [{ orderItemId: 'oi1', unitPrice: 50 }], notes: 'n' },
        'pur1',
      );
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            purchasingSubmittedById: 'pur1',
            purchasingNotes: 'n',
          }),
        }),
      );
    });

    it('second submit after transition fails status check', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValueOnce(orderBase).mockResolvedValueOnce({
        ...orderBase,
        status: 'PENDING_OPS_APPROVAL',
      });
      await service.submitPrice(
        'o1',
        { supplierId: 'sup1', items: [{ orderItemId: 'oi1', unitPrice: 10 }] },
        'a',
      );
      await expect(
        service.submitPrice('o1', { supplierId: 'sup1', items: [{ orderItemId: 'oi1', unitPrice: 10 }] }, 'b'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('notifies next approver after commit', async () => {
      await service.submitPrice(
        'o1',
        { supplierId: 'sup1', items: [{ orderItemId: 'oi1', unitPrice: 100 }] },
        'pur1',
      );
      expect(notifications.notifyUsersByRole).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'ORDER_PENDING_APPROVAL',
          link: '/orders/o1',
          entityId: 'o1',
        }),
      );
    });

    it('duplicate orderItemId in payload → 400', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        ...orderBase,
        items: [
          { id: 'oi1', requestedQty: 1 },
          { id: 'oi2', requestedQty: 1 },
        ],
      });
      await expect(
        service.submitPrice(
          'o1',
          {
            supplierId: 'sup1',
            items: [
              { orderItemId: 'oi1', unitPrice: 1 },
              { orderItemId: 'oi1', unitPrice: 2 },
            ],
          },
          'p1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

  });

  describe('SubmitPriceDto', () => {
    const oid = 'clxyz1111000000000000001';
    it('unitPrice <= 0 invalid', () => {
      expect(
        SubmitPriceDto.safeParse({ supplierId: 'sup1', items: [{ orderItemId: oid, unitPrice: 0 }] }).success,
      ).toBe(false);
    });

    it('items empty invalid', () => {
      expect(SubmitPriceDto.safeParse({ supplierId: 'sup1', items: [] }).success).toBe(false);
    });
  });
});
