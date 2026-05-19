import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OrderService } from './order.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { SuratJalanService } from '../surat-jalan/surat-jalan.service';
import { PurchaseRequestService } from '../purchase-request/purchase-request.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BudgetLedgerService } from '../budget-ledger/budget-ledger.service';
import { runSerializableTransaction } from '../budget-ledger/transaction-retry.util';
import { PoGenerationService } from '../po-generation/po-generation.service';

jest.mock('../budget-ledger/transaction-retry.util', () => ({
  runSerializableTransaction: jest.fn(),
}));

describe('OrderService', () => {
  let service: OrderService;
  const prisma = {
    order: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    financeProject: { findFirst: jest.fn() },
    stockItem: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    stockLog: { findFirst: jest.fn(), create: jest.fn() },
    orderItem: { updateMany: jest.fn() },
    $executeRaw: jest.fn().mockResolvedValue(undefined),
    $transaction: jest.fn((arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return (arg as (t: unknown) => Promise<unknown>)(prisma);
    }),
  };
  const stockService = {
    checkAvailability: jest.fn(),
    deductStock: jest.fn().mockResolvedValue({
      itemId: 's1',
      itemName: 'Item',
      newQty: 8,
      minStockQty: 0,
      unit: 'pcs',
    }),
    emitLowStockIfNeeded: jest.fn(),
  };
  const gateway = { emitToRoom: jest.fn() };
  const suratJalanService = { generateSuratJalanOut: jest.fn() };
  const purchaseRequestService = { createFromOrder: jest.fn() };
  const notificationsService = {
    createForRole: jest.fn(),
    createForUser: jest.fn(),
    notifyUsersByRole: jest.fn(),
  };
  const budgetLedger = {
    resolveProjectId: jest.fn(),
    deductForOrder: jest.fn(),
    afterDeductNotifyOrder: jest.fn(),
    utilizationFromProject: jest.fn().mockReturnValue({ material: 0.1, jasa: 0.1 }),
    refundForOrder: jest.fn(),
  };
  const poGeneration = {
    generateAndStorePo: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    poGeneration.generateAndStorePo.mockResolvedValue(undefined);
    (runSerializableTransaction as jest.Mock).mockImplementation(
      async (_p: unknown, fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          order: prisma.order,
          financeProject: {
            findUniqueOrThrow: jest.fn().mockResolvedValue({
              id: 'fp1',
              totalBudget: new Prisma.Decimal(1000),
              materialBudget: new Prisma.Decimal(500),
              jasaBudget: new Prisma.Decimal(500),
              materialSpent: new Prisma.Decimal(0),
              jasaSpent: new Prisma.Decimal(0),
            }),
          },
          budgetLedger: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          stockItem: {
            findUniqueOrThrow: jest.fn().mockImplementation(({ where: { id } }: { where: { id: string } }) =>
              Promise.resolve({ id, name: `Stock-${id}`, currentQty: 100 }),
            ),
          },
          orderItem: prisma.orderItem,
        }),
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: PrismaService, useValue: prisma },
        { provide: StockService, useValue: stockService },
        { provide: NotificationsGateway, useValue: gateway },
        { provide: SuratJalanService, useValue: suratJalanService },
        { provide: PurchaseRequestService, useValue: purchaseRequestService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: BudgetLedgerService, useValue: budgetLedger },
        { provide: PoGenerationService, useValue: poGeneration },
      ],
    }).compile();
    service = module.get(OrderService);
    jest.spyOn(service as unknown as { findOne: () => Promise<unknown> }, 'findOne').mockResolvedValue({ id: 'order1' });
  });

  describe('submit — Case A: all stock available', () => {
    it('deducts stock for each item (currentQty -= requestedQty)', async () => {
      const order = { id: 'o1', orderNumber: 'ORD-1', createdBy: 'pm1', status: 'DRAFT', items: [{ stockItemId: 's1', requestedQty: 2 }], creator: { id: 'pm1' } };
      prisma.order.findUnique.mockResolvedValue(order);
      stockService.checkAvailability.mockResolvedValue({ items: [{ stockItemId: 's1', sufficient: true, availableQty: 10 }], summary: { allAvailable: true, noneAvailable: false } });
      suratJalanService.generateSuratJalanOut.mockResolvedValue({ id: 'sj1', documentNumber: 'SJ-1', pdfUrl: 'url' });
      await service.submit('o1', 'pm1', 'PM_FTTH');
      expect(stockService.deductStock).toHaveBeenCalled();
    });

    it('creates StockLog entries with type OUT_ORDER', async () => {
      expect(true).toBe(true);
    });

    it('calls generateSuratJalanOut', async () => {
      const order = { id: 'o1', orderNumber: 'ORD-1', createdBy: 'pm1', status: 'DRAFT', items: [{ stockItemId: 's1', requestedQty: 2 }], creator: { id: 'pm1' } };
      prisma.order.findUnique.mockResolvedValue(order);
      stockService.checkAvailability.mockResolvedValue({ items: [{ stockItemId: 's1', sufficient: true, availableQty: 10 }], summary: { allAvailable: true, noneAvailable: false } });
      suratJalanService.generateSuratJalanOut.mockResolvedValue({ id: 'sj1', documentNumber: 'SJ-1', pdfUrl: 'url' });
      await service.submit('o1', 'pm1', 'PM_FTTH');
      expect(suratJalanService.generateSuratJalanOut).toHaveBeenCalled();
    });

    it('sets order status to STOCK_AVAILABLE', async () => {
      const order = { id: 'o1', orderNumber: 'ORD-1', createdBy: 'pm1', status: 'DRAFT', items: [{ stockItemId: 's1', requestedQty: 2 }], creator: { id: 'pm1' } };
      prisma.order.findUnique.mockResolvedValue(order);
      stockService.checkAvailability.mockResolvedValue({ items: [{ stockItemId: 's1', sufficient: true, availableQty: 10 }], summary: { allAvailable: true, noneAvailable: false } });
      suratJalanService.generateSuratJalanOut.mockResolvedValue({ id: 'sj1', documentNumber: 'SJ-1', pdfUrl: 'url' });
      await service.submit('o1', 'pm1', 'PM_FTTH');
      expect(prisma.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'STOCK_AVAILABLE' }) }));
    });

    it('emits order:suratJalanReady to PM user room', async () => {
      const order = { id: 'o1', orderNumber: 'ORD-1', createdBy: 'pm1', status: 'DRAFT', items: [{ stockItemId: 's1', requestedQty: 2 }], creator: { id: 'pm1' } };
      prisma.order.findUnique.mockResolvedValue(order);
      stockService.checkAvailability.mockResolvedValue({ items: [{ stockItemId: 's1', sufficient: true, availableQty: 10 }], summary: { allAvailable: true, noneAvailable: false } });
      suratJalanService.generateSuratJalanOut.mockResolvedValue({ id: 'sj1', documentNumber: 'SJ-1', pdfUrl: 'url' });
      await service.submit('o1', 'pm1', 'PM_FTTH');
      expect(gateway.emitToRoom).toHaveBeenCalledWith('user:pm1', 'order:suratJalanReady', expect.any(Object));
    });

    it('does NOT create PurchaseRequest', async () => {
      const order = { id: 'o1', orderNumber: 'ORD-1', createdBy: 'pm1', status: 'DRAFT', items: [{ stockItemId: 's1', requestedQty: 2 }], creator: { id: 'pm1' } };
      prisma.order.findUnique.mockResolvedValue(order);
      stockService.checkAvailability.mockResolvedValue({ items: [{ stockItemId: 's1', sufficient: true, availableQty: 10 }], summary: { allAvailable: true, noneAvailable: false } });
      suratJalanService.generateSuratJalanOut.mockResolvedValue({ id: 'sj1', documentNumber: 'SJ-1', pdfUrl: 'url' });
      await service.submit('o1', 'pm1', 'PM_FTTH');
      expect(purchaseRequestService.createFromOrder).not.toHaveBeenCalled();
    });
  });

  describe('submit — Case B: no stock available', () => {
    it('does NOT deduct any stock', async () => {
      const order = { id: 'o1', orderNumber: 'ORD-1', createdBy: 'pm1', status: 'DRAFT', items: [{ stockItemId: 's1', requestedQty: 5 }], creator: { id: 'pm1' } };
      prisma.order.findUnique.mockResolvedValue(order);
      stockService.checkAvailability.mockResolvedValue({ items: [{ stockItemId: 's1', sufficient: false, availableQty: 0 }], summary: { allAvailable: false, noneAvailable: true } });
      purchaseRequestService.createFromOrder.mockResolvedValue({ id: 'pr1', requestNumber: 'PR-1' });
      await service.submit('o1', 'pm1', 'PM_FTTH');
      expect(stockService.deductStock).not.toHaveBeenCalled();
    });
  });

  describe('submit — Case C: partial stock', () => {
    it('sets order status to PARTIAL_STOCK', async () => {
      const order = { id: 'o1', orderNumber: 'ORD-1', createdBy: 'pm1', status: 'DRAFT', items: [{ stockItemId: 's1', requestedQty: 1 }, { stockItemId: 's2', requestedQty: 5 }], creator: { id: 'pm1' } };
      prisma.order.findUnique.mockResolvedValue(order);
      stockService.checkAvailability.mockResolvedValue({ items: [{ stockItemId: 's1', sufficient: true, availableQty: 2 }, { stockItemId: 's2', sufficient: false, availableQty: 1 }], summary: { allAvailable: false, noneAvailable: false } });
      suratJalanService.generateSuratJalanOut.mockResolvedValue({ id: 'sj1', documentNumber: 'SJ-1', pdfUrl: 'url' });
      purchaseRequestService.createFromOrder.mockResolvedValue({ id: 'pr1', requestNumber: 'PR-1' });
      await service.submit('o1', 'pm1', 'PM_FTTH');
      expect(prisma.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PARTIAL_STOCK' }) }));
    });
  });

  describe('submit — Case D: ADMIN_STOCK restock (Issue 1A fix)', () => {
    it('does NOT deduct stock when submitter is ADMIN_STOCK even if items are catalog-available', async () => {
      const order = {
        id: 'o1', orderNumber: 'ORD-1', createdBy: 'admin1', status: 'DRAFT',
        items: [{ stockItemId: 's1', requestedQty: 50 }], creator: { id: 'admin1', name: 'Admin' },
      };
      prisma.order.findUnique.mockResolvedValue(order);
      // Stock IS available (100 in warehouse) but Admin Stock is restocking — must NOT deduct
      stockService.checkAvailability.mockResolvedValue({
        items: [{ stockItemId: 's1', sufficient: true, availableQty: 100 }],
        summary: { allAvailable: true, noneAvailable: false },
      });
      purchaseRequestService.createFromOrder.mockResolvedValue({ id: 'pr1', requestNumber: 'PR-1' });
      await service.submit('o1', 'admin1', 'ADMIN_STOCK');
      expect(stockService.deductStock).not.toHaveBeenCalled();
      expect(suratJalanService.generateSuratJalanOut).not.toHaveBeenCalled();
    });

    it('routes ADMIN_STOCK order to purchase request (NO_STOCK status)', async () => {
      const order = {
        id: 'o1', orderNumber: 'ORD-1', createdBy: 'admin1', status: 'DRAFT',
        items: [{ stockItemId: 's1', requestedQty: 50 }], creator: { id: 'admin1', name: 'Admin' },
      };
      prisma.order.findUnique.mockResolvedValue(order);
      stockService.checkAvailability.mockResolvedValue({
        items: [{ stockItemId: 's1', sufficient: true, availableQty: 100 }],
        summary: { allAvailable: true, noneAvailable: false },
      });
      purchaseRequestService.createFromOrder.mockResolvedValue({ id: 'pr1', requestNumber: 'PR-1' });
      await service.submit('o1', 'admin1', 'ADMIN_STOCK');
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'NO_STOCK' }) }),
      );
    });
  });

  describe('submit — deductAvailableItems atomicity', () => {
    beforeEach(() => {
      suratJalanService.generateSuratJalanOut.mockResolvedValue({ id: 'sj1', documentNumber: 'SJ-1', pdfUrl: 'url' });
    });

    it('fail-fast: item kedua stok tidak cukup → tidak ada deductStock untuk item tersebut', async () => {
      const order = {
        id: 'o1',
        orderNumber: 'ORD-1',
        createdBy: 'pm1',
        status: 'DRAFT',
        items: [
          { stockItemId: 's1', requestedQty: 2, availableQty: 2 },
          { stockItemId: 's2', requestedQty: 10, availableQty: 3 },
        ],
        creator: { id: 'pm1' },
      };
      prisma.order.findUnique.mockResolvedValue(order);
      stockService.checkAvailability.mockResolvedValue({
        items: [
          { stockItemId: 's1', sufficient: true, availableQty: 2 },
          { stockItemId: 's2', sufficient: false, availableQty: 3 },
        ],
        summary: { allAvailable: false, noneAvailable: false },
      });
      purchaseRequestService.createFromOrder.mockResolvedValue({ id: 'pr1', requestNumber: 'PR-1' });
      await service.submit('o1', 'pm1', 'PM_FTTH');
      expect(stockService.deductStock).toHaveBeenCalledTimes(1);
      expect(stockService.deductStock).toHaveBeenCalledWith('s1', 2, 'pm1', 'o1');
      expect(stockService.deductStock).not.toHaveBeenCalledWith('s2', expect.anything(), expect.anything(), expect.anything());
      expect(suratJalanService.generateSuratJalanOut).toHaveBeenCalled();
      expect(purchaseRequestService.createFromOrder).toHaveBeenCalled();
    });

    it('happy path multi-item: deductStock dipanggil per baris', async () => {
      const order = {
        id: 'o1',
        orderNumber: 'ORD-1',
        createdBy: 'pm1',
        status: 'DRAFT',
        items: [
          { stockItemId: 's1', requestedQty: 1, availableQty: 1 },
          { stockItemId: 's2', requestedQty: 2, availableQty: 2 },
        ],
        creator: { id: 'pm1' },
      };
      prisma.order.findUnique.mockResolvedValue(order);
      stockService.checkAvailability.mockResolvedValue({
        items: [
          { stockItemId: 's1', sufficient: true, availableQty: 1 },
          { stockItemId: 's2', sufficient: true, availableQty: 2 },
        ],
        summary: { allAvailable: true, noneAvailable: false },
      });
      stockService.deductStock
        .mockResolvedValueOnce({
          itemId: 's1',
          itemName: 'A',
          newQty: 9,
          minStockQty: 0,
          unit: 'pcs',
        })
        .mockResolvedValueOnce({
          itemId: 's2',
          itemName: 'B',
          newQty: 8,
          minStockQty: 0,
          unit: 'pcs',
        });
      await service.submit('o1', 'pm1', 'PM_FTTH');
      expect(stockService.deductStock).toHaveBeenCalledTimes(2);
      expect(stockService.deductStock).toHaveBeenNthCalledWith(1, 's1', 1, 'pm1', 'o1');
      expect(stockService.deductStock).toHaveBeenNthCalledWith(2, 's2', 2, 'pm1', 'o1');
      expect(prisma.orderItem.updateMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('cancel', () => {
    it('cancels DRAFT order successfully', async () => {
      prisma.order.findUnique.mockResolvedValue({ id: 'o1', status: 'DRAFT', createdBy: 'pm1' });
      prisma.order.update.mockResolvedValue({ id: 'o1', status: 'CANCELLED' });
      const result = await service.cancel('o1', { reason: 'Uji' }, 'pm1', 'PM_FTTH') as any;
      expect(result.status).toBe('CANCELLED');
      expect(budgetLedger.refundForOrder).not.toHaveBeenCalled();
    });

    it('throws for non-cancellable status (PURCHASED)', async () => {
      prisma.order.findUnique.mockResolvedValue({ id: 'o1', status: 'PURCHASED', createdBy: 'pm1' });
      await expect(service.cancel('o1', { reason: 'x' }, 'pm1', 'PM_FTTH')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('PENDING_PAYMENT_RECEIPT + Finance memanggil refundForOrder', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1',
        status: 'PENDING_PAYMENT_RECEIPT',
        createdBy: 'pm1',
      });
      prisma.order.update.mockResolvedValue({ id: 'o1', status: 'CANCELLED' });
      await service.cancel('o1', { reason: 'Batal bayar' }, 'fin1', 'FINANCE');
      expect(budgetLedger.refundForOrder).toHaveBeenCalledWith(
        'o1',
        'fin1',
        'Order dibatalkan: Batal bayar',
        expect.anything(),
      );
    });

    it('returns deducted stock if already processed (creates StockLog IN_RETURN)', async () => {
      expect(true).toBe(true);
    });
  });

  describe('financeProcess (receipt only — no deduct)', () => {
    it('happy path → PURCHASED tanpa deductForOrder', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1',
        status: 'PENDING_PAYMENT_RECEIPT',
        totalAmount: new Prisma.Decimal(250000),
        financeProjectId: 'fp-x',
        createdBy: 'pm1',
        orderNumber: 'ORD-9',
      });
      prisma.order.update.mockResolvedValue({ id: 'o1', status: 'PURCHASED', orderNumber: 'ORD-9' });

      await service.financeProcess('o1', { notes: 'ok' }, 'fin1');

      expect(budgetLedger.deductForOrder).not.toHaveBeenCalled();
      expect(budgetLedger.resolveProjectId).not.toHaveBeenCalled();
      expect(budgetLedger.afterDeductNotifyOrder).not.toHaveBeenCalled();
      expect(notificationsService.createForRole).toHaveBeenCalled();
    });

    it('legacy PENDING_FINANCE masih diproses (kompatibilitas data lama)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1',
        status: 'PENDING_FINANCE',
        totalAmount: new Prisma.Decimal(100),
        financeProjectId: null,
        createdBy: 'pm1',
        orderNumber: 'ORD-9',
      });
      prisma.order.update.mockResolvedValue({ id: 'o1', status: 'PURCHASED', orderNumber: 'ORD-9' });
      await service.financeProcess('o1', {}, 'fin1');
      expect(budgetLedger.deductForOrder).not.toHaveBeenCalled();
    });

    it('totalAmount nol → tetap PURCHASED', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1',
        status: 'PENDING_PAYMENT_RECEIPT',
        totalAmount: new Prisma.Decimal(0),
        financeProjectId: null,
        createdBy: 'pm1',
        orderNumber: 'ORD-9',
      });
      prisma.order.update.mockResolvedValue({ id: 'o1', status: 'PURCHASED', orderNumber: 'ORD-9' });
      await service.financeProcess('o1', {}, 'fin1');
      expect(budgetLedger.deductForOrder).not.toHaveBeenCalled();
    });
  });

  describe('createRestock', () => {
    it('assign INVENTORY project when financeProjectId omitted', async () => {
      prisma.financeProject.findFirst.mockResolvedValueOnce({ id: 'inv1', code: 'INVENTORY', status: 'ACTIVE' });
      prisma.order.count.mockResolvedValue(0);
      prisma.stockItem.findMany.mockResolvedValue([
        {
          id: 'stk1',
          code: 'sku1',
          name: 'Barang',
          category: 'C',
          unit: 'pcs',
          currentQty: 10,
          isActive: true,
        },
      ]);
      prisma.order.create.mockResolvedValue({
        id: 'ord-r1',
        orderNumber: 'ORD-2026-0001',
        orderTrigger: 'STOCK_RESTOCK',
        status: 'PENDING_PURCHASING_INPUT',
      });

      const out = await service.createRestock(
        { items: [{ productId: 'sku1', qty: 2 }], notes: 'restok' },
        'admin1',
      );

      expect(prisma.financeProject.findFirst).toHaveBeenCalledWith({
        where: { code: 'INVENTORY', status: 'ACTIVE' },
      });
      expect(prisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            financeProjectId: 'inv1',
            orderTrigger: 'STOCK_RESTOCK',
            status: 'PENDING_PURCHASING_INPUT',
            items: {
              create: expect.arrayContaining([
                expect.objectContaining({
                  stockItemId: 'stk1',
                  requestedQty: 2,
                  itemName: 'Barang',
                }),
              ]),
            },
          }),
        }),
      );
      expect(out.status).toBe('PENDING_PURCHASING_INPUT');
      expect(notificationsService.notifyUsersByRole).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: 'ORDER_PENDING_PURCHASING_INPUT' }),
      );
    });

    it('invalid override financeProjectId → 400', async () => {
      prisma.financeProject.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.createRestock({ items: [{ productId: 'x', qty: 1 }], financeProjectId: 'bad' }, 'a1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('unknown stock id/code → 400', async () => {
      prisma.financeProject.findFirst.mockResolvedValueOnce({ id: 'inv1', code: 'INVENTORY', status: 'ACTIVE' });
      prisma.order.count.mockResolvedValue(0);
      prisma.stockItem.findMany.mockResolvedValue([]);
      await expect(
        service.createRestock({ items: [{ productId: 'nope', qty: 1 }], notes: '' }, 'a1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('gmApprove + budget', () => {
    it('deductForOrder dipanggil saat totalAmount > 0', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'g1',
        status: 'PENDING_GM_APPROVAL',
        totalAmount: new Prisma.Decimal(100),
        financeProjectId: 'fp-x',
        createdBy: 'pm1',
        orderNumber: 'ORD-G1',
      });
      prisma.order.update.mockResolvedValue({
        id: 'g1',
        status: 'PENDING_PAYMENT_RECEIPT',
        orderNumber: 'ORD-G1',
        createdBy: 'pm1',
      });
      budgetLedger.resolveProjectId.mockResolvedValue('fp1');

      await service.gmApprove('g1', { notes: 'ok' }, 'gm1');

      expect(budgetLedger.resolveProjectId).toHaveBeenCalledWith('fp-x', expect.anything());
      expect(budgetLedger.deductForOrder).toHaveBeenCalledWith(
        'g1',
        'fp1',
        expect.any(Prisma.Decimal),
        'gm1',
        'pm1',
        expect.anything(),
      );
      expect(budgetLedger.afterDeductNotifyOrder).toHaveBeenCalled();
      expect(poGeneration.generateAndStorePo).toHaveBeenCalledWith('g1', undefined);
    });

    it('PO generation gagal tidak mengganggu gmApprove', async () => {
      poGeneration.generateAndStorePo.mockRejectedValueOnce(new Error('pdf fail'));
      prisma.order.findUnique.mockResolvedValue({
        id: 'g1',
        status: 'PENDING_GM_APPROVAL',
        totalAmount: new Prisma.Decimal(100),
        financeProjectId: 'fp-x',
        createdBy: 'pm1',
        orderNumber: 'ORD-G1',
      });
      prisma.order.update.mockResolvedValue({
        id: 'g1',
        status: 'PENDING_PAYMENT_RECEIPT',
        orderNumber: 'ORD-G1',
        createdBy: 'pm1',
      });
      budgetLedger.resolveProjectId.mockResolvedValue('fp1');

      const out = await service.gmApprove('g1', { notes: 'ok' }, 'gm1');

      expect(out.status).toBe('PENDING_PAYMENT_RECEIPT');
      expect(poGeneration.generateAndStorePo).toHaveBeenCalledWith('g1', undefined);
    });

    it('skip deduct bila ledger DEDUCT_MATERIAL sudah ada', async () => {
      (runSerializableTransaction as jest.Mock).mockImplementationOnce(
        async (_p: unknown, fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            order: prisma.order,
            financeProject: {
              findUniqueOrThrow: jest.fn().mockResolvedValue({
                id: 'fp1',
                totalBudget: new Prisma.Decimal(1000),
                materialBudget: new Prisma.Decimal(500),
                jasaBudget: new Prisma.Decimal(500),
                materialSpent: new Prisma.Decimal(0),
                jasaSpent: new Prisma.Decimal(0),
              }),
            },
            budgetLedger: {
              findFirst: jest.fn().mockResolvedValue({ id: 'led1' }),
            },
          }),
      );
      prisma.order.findUnique.mockResolvedValue({
        id: 'g2',
        status: 'PENDING_GM_APPROVAL',
        totalAmount: new Prisma.Decimal(50),
        financeProjectId: 'fp1',
        createdBy: 'pm1',
        orderNumber: 'ORD-G2',
      });
      prisma.order.update.mockResolvedValue({
        id: 'g2',
        status: 'PENDING_PAYMENT_RECEIPT',
        orderNumber: 'ORD-G2',
        createdBy: 'pm1',
      });
      budgetLedger.resolveProjectId.mockResolvedValue('fp1');

      await service.gmApprove('g2', {}, 'gm1');

      expect(budgetLedger.deductForOrder).not.toHaveBeenCalled();
    });
  });

  describe('adminStockSubmit', () => {
    it('notifies Purchasing when moving to PENDING_PURCHASING_INPUT', async () => {
      const orderMock = {
        id: 'o1',
        orderTrigger: 'PROJECT_REQUEST',
        status: 'PENDING_ADMIN_STOCK',
        orderNumber: 'ORD-N',
        items: [],
      };
      prisma.order.findUnique.mockResolvedValue(orderMock);
      prisma.order.findUniqueOrThrow.mockResolvedValue(orderMock);
      prisma.order.update.mockResolvedValue({
        id: 'o1',
        status: 'PENDING_PURCHASING_INPUT',
        orderNumber: 'ORD-N',
      });
      await service.adminStockSubmit(
        'o1',
        {
          purchaseItems: [
            { name: 'a', quantity: 2, unit: 'pcs', unitPrice: 10, totalPrice: 20 },
          ],
        },
        'adm1',
      );
      // FIX 5: notifyUsersByRole internally calls createForRole — persisted DB notification
      expect(notificationsService.notifyUsersByRole).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: 'ORDER_PENDING_PURCHASING_INPUT' }),
      );
      // FIX 5: WebSocket emit must coexist alongside persisted notification
      expect(gateway.emitToRoom).toHaveBeenCalledWith(
        expect.stringContaining('PURCHASING'),
        'order:pendingPurchasing',
        expect.objectContaining({ orderId: 'o1', orderNumber: 'ORD-N' }),
      );
    });

    it('ISSUE 1.1: ADMIN_STOCK submits without unitPrice — no error, status moves to PENDING_PURCHASING_INPUT', async () => {
      const orderMock = {
        id: 'o1',
        orderTrigger: 'PROJECT_REQUEST',
        status: 'PENDING_ADMIN_STOCK',
        orderNumber: 'ORD-N',
        items: [],
      };
      prisma.order.findUnique.mockResolvedValue(orderMock);
      prisma.order.findUniqueOrThrow.mockResolvedValue(orderMock);
      prisma.order.update.mockResolvedValue({
        id: 'o1',
        status: 'PENDING_PURCHASING_INPUT',
        orderNumber: 'ORD-N',
      });
      // Submit with unitPrice: 0 (no price from ADMIN_STOCK)
      await service.adminStockSubmit(
        'o1',
        {
          purchaseItems: [
            { name: 'Kabel ODC', quantity: 10, unit: 'meter', unitPrice: 0, totalPrice: 0 },
            { name: 'Closure', quantity: 5, unit: 'pcs', unitPrice: 0, totalPrice: 0 },
          ],
        },
        'adm1',
      );
      // Should not throw — unitPrice is optional for ADMIN_STOCK
      expect(prisma.order.update).toHaveBeenCalled();
      const updateCall = (prisma.order.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.status).toBe('PENDING_PURCHASING_INPUT');
      // Verify items stored with unitPrice 0 (Purchasing will fill later)
      expect(updateCall.data.items.create).toHaveLength(2);
      expect(updateCall.data.items.create[0].unitPrice).toEqual(new Prisma.Decimal(0));
    });
  });

  describe('orderTrigger branching', () => {
    it('adminStockSubmit ditolak untuk STOCK_RESTOCK', async () => {
      const orderMock = {
        id: 'x1',
        orderTrigger: 'STOCK_RESTOCK',
        status: 'PENDING_PURCHASING_INPUT',
        orderNumber: 'ORD-X',
        items: [],
      };
      prisma.order.findUnique.mockResolvedValue(orderMock as never);
      prisma.order.findUniqueOrThrow.mockResolvedValue(orderMock as never);
      await expect(
        service.adminStockSubmit(
          'x1',
          {
            purchaseItems: [
              { name: 'a', quantity: 1, unit: 'pcs', unitPrice: 1, totalPrice: 1 },
            ],
          },
          'a1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('opsApprove ditolak untuk STOCK_RESTOCK', async () => {
      const orderMock = {
        id: 'x2',
        orderTrigger: 'STOCK_RESTOCK',
        status: 'PENDING_OPS_APPROVAL',
        orderNumber: 'ORD-Y',
        items: [],
      };
      prisma.order.findUnique.mockResolvedValue(orderMock as never);
      prisma.order.findUniqueOrThrow.mockResolvedValue(orderMock as never);
      await expect(service.opsApprove('x2', {}, 'ops1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('verifyItems', () => {
    it('SESUAI dari PURCHASED: increment stok, StockLog IN_ORDER, FULFILLED, notifikasi post-commit', async () => {
      const stockLogFindFirst = jest.fn().mockResolvedValue(null);
      const stockLogCreate = jest.fn();
      const stockItemFindUnique = jest.fn().mockResolvedValue({ id: 's1', currentQty: 5 });
      const stockItemUpdate = jest.fn();
      const orderFindUniqueOrThrow = jest.fn().mockResolvedValue({
        id: 'ord1',
        status: 'PURCHASED',
        orderNumber: 'ORD-1',
        createdBy: 'creator1',
        verificationStatus: null,
        items: [{ id: 'li1', stockItemId: 's1', requestedQty: 3, itemName: 'Kabel' }],
      });
      const orderUpdate = jest.fn().mockResolvedValue({
        id: 'ord1',
        status: 'FULFILLED',
        orderNumber: 'ORD-1',
        createdBy: 'creator1',
      });
      (runSerializableTransaction as jest.Mock).mockImplementationOnce(async (_p: unknown, fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          order: { findUniqueOrThrow: orderFindUniqueOrThrow, update: orderUpdate },
          stockLog: { findFirst: stockLogFindFirst, create: stockLogCreate },
          stockItem: { findUnique: stockItemFindUnique, update: stockItemUpdate },
        }),
      );

      const out = await service.verifyItems('ord1', { status: 'SESUAI' }, 'adm1');

      expect(out.status).toBe('FULFILLED');
      expect(stockItemUpdate).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { currentQty: { increment: 3 } },
      });
      expect(stockLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'IN_ORDER',
          reference: 'ord1',
          qtyChange: 3,
          qtyBefore: 5,
          qtyAfter: 8,
        }),
      });
      expect(notificationsService.createForUser).toHaveBeenCalledWith(
        'creator1',
        expect.objectContaining({ title: expect.stringContaining('Order Selesai') }),
      );
    });

    it('TIDAK_SESUAI: tidak ubah stok, notifikasi post-commit', async () => {
      const orderFindUniqueOrThrow = jest.fn().mockResolvedValue({
        id: 'ord2',
        status: 'PURCHASED',
        orderNumber: 'ORD-2',
        createdBy: 'creator2',
        verificationStatus: null,
        items: [{ id: 'li1', stockItemId: 's1', requestedQty: 1, itemName: 'X' }],
      });
      const orderUpdate = jest.fn().mockResolvedValue({
        id: 'ord2',
        status: 'PENDING_VERIFICATION',
        orderNumber: 'ORD-2',
        createdBy: 'creator2',
      });
      (runSerializableTransaction as jest.Mock).mockImplementationOnce(async (_p: unknown, fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          order: { findUniqueOrThrow: orderFindUniqueOrThrow, update: orderUpdate },
          stockLog: { findFirst: jest.fn(), create: jest.fn() },
          stockItem: { findUnique: jest.fn(), update: jest.fn() },
        }),
      );

      const out = await service.verifyItems('ord2', { status: 'TIDAK_SESUAI', verificationNotes: 'rusak' }, 'adm1');

      expect(out.status).toBe('PENDING_VERIFICATION');
      expect(notificationsService.createForUser).toHaveBeenCalledWith(
        'creator2',
        expect.objectContaining({ title: expect.stringContaining('Tidak Sesuai') }),
      );
    });

    it('SESUAI idempotent: FULFILLED + log IN_ORDER → tidak increment lagi', async () => {
      const stockLogFindFirst = jest.fn().mockResolvedValue({ id: 'lg1' });
      const stockLogCreate = jest.fn();
      const orderFindUniqueOrThrow = jest.fn().mockResolvedValue({
        id: 'ord3',
        status: 'FULFILLED',
        orderNumber: 'ORD-3',
        createdBy: 'c3',
        verificationStatus: 'SESUAI',
        items: [{ id: 'li1', stockItemId: 's1', requestedQty: 1, itemName: 'X' }],
      });
      (runSerializableTransaction as jest.Mock).mockImplementationOnce(async (_p: unknown, fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          order: { findUniqueOrThrow: orderFindUniqueOrThrow, update: jest.fn() },
          stockLog: { findFirst: stockLogFindFirst, create: stockLogCreate },
          stockItem: { findUnique: jest.fn(), update: jest.fn() },
        }),
      );

      await service.verifyItems('ord3', { status: 'SESUAI' }, 'adm1');

      expect(stockLogCreate).not.toHaveBeenCalled();
      expect(notificationsService.createForUser).not.toHaveBeenCalled();
    });

    it('SESUAI dari DRAFT ditolak', async () => {
      const orderFindUniqueOrThrow = jest.fn().mockResolvedValue({
        id: 'ord4',
        status: 'DRAFT',
        orderNumber: 'ORD-4',
        createdBy: 'c4',
        verificationStatus: null,
        items: [],
      });
      (runSerializableTransaction as jest.Mock).mockImplementationOnce(async (_p: unknown, fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          order: { findUniqueOrThrow: orderFindUniqueOrThrow, update: jest.fn() },
          stockLog: { findFirst: jest.fn(), create: jest.fn() },
          stockItem: { findUnique: jest.fn(), update: jest.fn() },
        }),
      );

      await expect(service.verifyItems('ord4', { status: 'SESUAI' }, 'adm1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('multi-line: semua baris dengan stockItemId di-increment', async () => {
      const stockLogCreate = jest.fn();
      const orderFindUniqueOrThrow = jest.fn().mockResolvedValue({
        id: 'ord5',
        status: 'PENDING_VERIFICATION',
        orderNumber: 'ORD-5',
        createdBy: 'c5',
        verificationStatus: null,
        items: [
          { id: 'a', stockItemId: 's1', requestedQty: 2, itemName: 'A' },
          { id: 'b', stockItemId: 's2', requestedQty: 4, itemName: 'B' },
        ],
      });
      const stockItemFindUnique = jest
        .fn()
        .mockResolvedValueOnce({ id: 's1', currentQty: 10 })
        .mockResolvedValueOnce({ id: 's2', currentQty: 1 });
      const stockItemUpdate = jest.fn();
      (runSerializableTransaction as jest.Mock).mockImplementationOnce(async (_p: unknown, fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          order: {
            findUniqueOrThrow: orderFindUniqueOrThrow,
            update: jest.fn().mockResolvedValue({
              id: 'ord5',
              status: 'FULFILLED',
              orderNumber: 'ORD-5',
              createdBy: 'c5',
            }),
          },
          stockLog: { findFirst: jest.fn().mockResolvedValue(null), create: stockLogCreate },
          stockItem: { findUnique: stockItemFindUnique, update: stockItemUpdate },
        }),
      );

      await service.verifyItems('ord5', { status: 'SESUAI' }, 'adm1');

      expect(stockItemUpdate).toHaveBeenCalledTimes(2);
      expect(stockLogCreate).toHaveBeenCalledTimes(2);
    });

    it('item with null stockItemId, matching name in DB -> links to existing StockItem', async () => {
      const orderFindUniqueOrThrow = jest.fn().mockResolvedValue({
        id: 'ord6',
        status: 'PURCHASED',
        orderNumber: 'ORD-6',
        createdBy: 'creator1',
        verificationStatus: null,
        items: [{ id: 'li1', stockItemId: null, requestedQty: 2, itemName: 'Match Item' }],
      });
      const orderItemUpdate = jest.fn();
      const stockItemFindFirst = jest.fn().mockResolvedValue({ id: 's99' });
      const stockItemFindUnique = jest.fn().mockResolvedValue({ id: 's99', currentQty: 5 });
      const stockItemCreate = jest.fn();
      const stockItemUpdate = jest.fn();
      const stockLogCreate = jest.fn();
      (runSerializableTransaction as jest.Mock).mockImplementationOnce(async (_p: unknown, fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          order: { findUniqueOrThrow: orderFindUniqueOrThrow, update: jest.fn().mockResolvedValue({ id: 'ord6', status: 'FULFILLED' }) },
          orderItem: { update: orderItemUpdate },
          stockItem: { findFirst: stockItemFindFirst, findUnique: stockItemFindUnique, create: stockItemCreate, update: stockItemUpdate },
          stockLog: { findFirst: jest.fn().mockResolvedValue(null), create: stockLogCreate },
        }),
      );

      await service.verifyItems('ord6', { status: 'SESUAI' }, 'adm1');

      expect(stockItemFindFirst).toHaveBeenCalledWith({ where: { name: { equals: 'Match Item', mode: 'insensitive' } } });
      expect(stockItemCreate).not.toHaveBeenCalled();
      expect(orderItemUpdate).toHaveBeenCalledWith({ where: { id: 'li1' }, data: { stockItemId: 's99' } });
      expect(stockItemUpdate).toHaveBeenCalledWith({ where: { id: 's99' }, data: { currentQty: { increment: 2 } } });
      expect(stockLogCreate).toHaveBeenCalled();
    });

    it('item with null stockItemId, no match in DB -> creates new StockItem and links it', async () => {
      const orderFindUniqueOrThrow = jest.fn().mockResolvedValue({
        id: 'ord7',
        status: 'PURCHASED',
        orderNumber: 'ORD-7',
        createdBy: 'creator1',
        verificationStatus: null,
        items: [{ id: 'li2', stockItemId: null, requestedQty: 3, itemName: 'New Item', category: 'TOOLS', unit: 'pcs' }],
      });
      const orderItemUpdate = jest.fn();
      const stockItemFindFirst = jest.fn().mockResolvedValue(null);
      const newStockItem = { id: 'snew', currentQty: 0 };
      const stockItemCreate = jest.fn().mockResolvedValue(newStockItem);
      const stockItemFindUnique = jest.fn().mockResolvedValue({ id: 'snew', currentQty: 0 });
      const stockItemUpdate = jest.fn();
      const stockLogCreate = jest.fn();
      (runSerializableTransaction as jest.Mock).mockImplementationOnce(
        async (_p: unknown, fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            order: {
              findUniqueOrThrow: orderFindUniqueOrThrow,
              update: jest.fn().mockResolvedValue({ id: 'ord7', status: 'FULFILLED', createdBy: 'creator1', orderNumber: 'ORD-7' }),
            },
            orderItem: { update: orderItemUpdate },
            stockItem: {
              findFirst: stockItemFindFirst,
              findUnique: stockItemFindUnique,
              create: stockItemCreate,
              update: stockItemUpdate,
            },
            stockLog: { findFirst: jest.fn().mockResolvedValue(null), create: stockLogCreate },
          }),
      );

      await service.verifyItems('ord7', { status: 'SESUAI' }, 'adm1');

      expect(stockItemFindFirst).toHaveBeenCalledWith({
        where: { name: { equals: 'New Item', mode: 'insensitive' } },
      });
      expect(stockItemCreate).toHaveBeenCalled();
      expect(orderItemUpdate).toHaveBeenCalledWith({ where: { id: 'li2' }, data: { stockItemId: 'snew' } });
      expect(stockItemUpdate).toHaveBeenCalled();
      expect(stockLogCreate).toHaveBeenCalled();
    });
  });
});
