import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role, StockOutStatus } from '@prisma/client';
import { StockOutService } from './stock-out.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { StockService } from '../stock/stock.service';
import { runSerializableTransaction } from '../budget-ledger/transaction-retry.util';
import {
  CreateStockOutDto,
  RejectStockOutDto,
  FilterStockOutDto,
  StockOutItemDto,
} from './stock-out.dto';

jest.mock('../budget-ledger/transaction-retry.util', () => ({
  runSerializableTransaction: jest.fn(),
}));

describe('StockOutService', () => {
  let service: StockOutService;

  const tx = {
    stockItem: { findMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    permitCluster: { findUnique: jest.fn() },
    stockOut: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  const prisma = {
    stockOut: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  const notifications = {
    notifyUsersByRole: jest.fn().mockResolvedValue(1),
    createForUser: jest.fn().mockResolvedValue({}),
  };

  const gateway = { emitToRoom: jest.fn() };

  const stock = {
    deductInsideTransaction: jest.fn(),
    emitLowStockIfNeeded: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    Object.values(tx.stockOut).forEach((m) => (m as jest.Mock).mockReset());
    Object.values(tx.stockItem).forEach((m) => (m as jest.Mock).mockReset());
    tx.permitCluster.findUnique.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockOutService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: NotificationsGateway, useValue: gateway },
        { provide: StockService, useValue: stock },
      ],
    }).compile();

    service = module.get(StockOutService);
    (runSerializableTransaction as jest.Mock).mockImplementation(async (_p: unknown, fn: (t: typeof tx) => unknown) =>
      fn(tx),
    );
  });

  describe('Zod CreateStockOutDto', () => {
    it('rejects empty items', () => {
      expect(CreateStockOutDto.safeParse({ items: [] }).success).toBe(false);
    });

    it('rejects qty <= 0', () => {
      expect(
        StockOutItemDto.safeParse({ stockItemId: 'cid', qty: 0 }).success,
      ).toBe(false);
    });
  });

  describe('Zod RejectStockOutDto', () => {
    it('rejects empty reason', () => {
      expect(RejectStockOutDto.safeParse({ reason: '' }).success).toBe(false);
    });
  });

  describe('generateRequestNumber', () => {
    it('SO-YYYY-0001 ketika belum ada nomor', async () => {
      const year = new Date().getFullYear();
      prisma.stockOut.findFirst.mockResolvedValue(null);
      await expect(service.generateRequestNumber()).resolves.toBe(`SO-${year}-0001`);
    });

    it('incremental oleh tahun', async () => {
      const year = new Date().getFullYear();
      prisma.stockOut.findFirst.mockResolvedValue({ requestNumber: `SO-${year}-0007` });
      await expect(service.generateRequestNumber()).resolves.toBe(`SO-${year}-0008`);
    });
  });

  describe('create', () => {
    const dto = {
      items: [{ stockItemId: 's1', qty: 2, notes: 'x' }],
      notes: 'n',
    };

    it('happy path → PENDING + notify ADMIN_STOCK', async () => {
      tx.stockItem.findMany.mockResolvedValue([{ id: 's1' }]);
      tx.stockOut.findFirst.mockResolvedValue(null);
      tx.stockOut.create.mockResolvedValue({
        id: 'so1',
        requestNumber: 'SO-2026-0001',
        requestedBy: { id: 'u1', name: 'Budi' },
        status: StockOutStatus.PENDING,
      });

      const row = await service.create(dto, 'u1');
      expect(row.status).toBe(StockOutStatus.PENDING);
      expect(notifications.notifyUsersByRole).toHaveBeenCalledWith(
        Role.ADMIN_STOCK,
        expect.objectContaining({
          type: 'STOCK_OUT_REQUESTED',
          entityId: 'so1',
        }),
      );
    });

    it('stock item not found → 400', async () => {
      tx.stockItem.findMany.mockResolvedValue([]);
      await expect(service.create(dto, 'u1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('permit cluster invalid → 400', async () => {
      tx.stockItem.findMany.mockResolvedValue([{ id: 's1' }]);
      tx.permitCluster.findUnique.mockResolvedValue(null);
      await expect(
        service.create({ ...dto, permitClusterId: 'pc1' }, 'u1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('fulfill', () => {
    const pending = {
      id: 'so1',
      status: StockOutStatus.PENDING,
      items: [{ stockItemId: 's1', qty: 2 }],
      requestedById: 'req1',
      requestNumber: 'SO-2026-0001',
      requestedBy: { id: 'req1', name: 'Ann' },
    };

    beforeEach(() => {
      tx.stockOut.findUniqueOrThrow.mockResolvedValue(pending);
      tx.stockItem.findUniqueOrThrow.mockResolvedValue({ id: 's1', name: 'Kabel', currentQty: 10 });
      stock.deductInsideTransaction.mockResolvedValue({
        itemId: 's1',
        itemName: 'Kabel',
        newQty: 8,
        minStockQty: 1,
        unit: 'Meter',
      });
      tx.stockOut.update.mockResolvedValue({
        ...pending,
        status: StockOutStatus.FULFILLED,
        fulfilledById: 'admin1',
      });
    });

    it('happy path → FULFILLED + deduct + notify', async () => {
      const res = await service.fulfill('so1', 'admin1');
      expect(res.status).toBe(StockOutStatus.FULFILLED);
      expect(stock.deductInsideTransaction).toHaveBeenCalledWith(
        tx,
        's1',
        2,
        'admin1',
        'StockOut:so1',
      );
      expect(stock.emitLowStockIfNeeded).toHaveBeenCalled();
      expect(notifications.createForUser).toHaveBeenCalledWith(
        'req1',
        expect.objectContaining({ type: 'STOCK_OUT_FULFILLED' }),
      );
    });

    it('wrong status → 400', async () => {
      tx.stockOut.findUniqueOrThrow.mockResolvedValue({ ...pending, status: StockOutStatus.FULFILLED });
      await expect(service.fulfill('so1', 'a')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('insufficient stock → 400', async () => {
      tx.stockItem.findUniqueOrThrow.mockResolvedValue({ id: 's1', name: 'Kabel', currentQty: 1 });
      await expect(service.fulfill('so1', 'a')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('multiple items — deduct each', async () => {
      tx.stockOut.findUniqueOrThrow.mockResolvedValue({
        ...pending,
        items: [
          { stockItemId: 's1', qty: 1 },
          { stockItemId: 's2', qty: 3 },
        ],
      });
      tx.stockItem.findUniqueOrThrow
        .mockResolvedValueOnce({ id: 's1', name: 'A', currentQty: 10 })
        .mockResolvedValueOnce({ id: 's2', name: 'B', currentQty: 10 });
      stock.deductInsideTransaction
        .mockResolvedValueOnce({
          itemId: 's1',
          itemName: 'A',
          newQty: 9,
          minStockQty: 0,
          unit: 'Pcs',
        })
        .mockResolvedValueOnce({
          itemId: 's2',
          itemName: 'B',
          newQty: 7,
          minStockQty: 0,
          unit: 'Pcs',
        });

      tx.stockOut.update.mockResolvedValue({
        ...pending,
        status: StockOutStatus.FULFILLED,
      });

      await service.fulfill('so1', 'admin1');
      expect(stock.deductInsideTransaction).toHaveBeenCalledTimes(2);
    });
  });

  describe('reject', () => {
    const pending = {
      id: 'so1',
      status: StockOutStatus.PENDING,
      requestedById: 'req1',
      requestNumber: 'SO-1',
    };

    it('happy path', async () => {
      prisma.stockOut.findUniqueOrThrow.mockResolvedValue(pending);
      prisma.stockOut.update.mockResolvedValue({
        ...pending,
        status: StockOutStatus.REJECTED,
        rejectionReason: 'habis',
      });

      const r = await service.reject('so1', { reason: 'habis' }, 'adm');
      expect(r.status).toBe(StockOutStatus.REJECTED);
      expect(notifications.createForUser).toHaveBeenCalledWith(
        'req1',
        expect.objectContaining({ type: 'STOCK_OUT_REJECTED' }),
      );
    });

    it('wrong status → 400', async () => {
      prisma.stockOut.findUniqueOrThrow.mockResolvedValue({
        ...pending,
        status: StockOutStatus.FULFILLED,
      });
      await expect(service.reject('so1', { reason: 'x' }, 'a')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('findAll', () => {
    beforeEach(() => {
      prisma.stockOut.findMany.mockResolvedValue([]);
      prisma.stockOut.count.mockResolvedValue(0);
    });

    it('scope mine filters requestedById', async () => {
      await service.findAll(
        FilterStockOutDto.parse({ scope: 'mine', page: 1, limit: 20 }),
        'u1',
        Role.PM_FTTH,
      );
      expect(prisma.stockOut.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ requestedById: 'u1' }),
        }),
      );
    });

    it('scope inbox ADMIN_STOCK → semua PENDING', async () => {
      await service.findAll(FilterStockOutDto.parse({ scope: 'inbox' }), 'u99', Role.ADMIN_STOCK);
      expect(prisma.stockOut.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: StockOutStatus.PENDING }),
        }),
      );
    });

    it('scope inbox non–Admin Stock → fallback own', async () => {
      await service.findAll(FilterStockOutDto.parse({ scope: 'inbox' }), 'u1', Role.PM_FTTH);
      expect(prisma.stockOut.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ requestedById: 'u1' }),
        }),
      );
    });

    it('filter status', async () => {
      await service.findAll(
        FilterStockOutDto.parse({ scope: 'mine', status: 'FULFILLED' }),
        'u1',
        Role.PM_FTTH,
      );
      expect(prisma.stockOut.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: StockOutStatus.FULFILLED }),
        }),
      );
    });

    it('scope all forbidden untuk PM', async () => {
      await expect(
        service.findAll(FilterStockOutDto.parse({ scope: 'all' }), 'u1', Role.PM_FTTH),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('findOne ACL', () => {
    const base = {
      id: 'so1',
      requestedById: 'u1',
      status: StockOutStatus.PENDING,
      requestNumber: 'X',
      items: [],
      permitClusterId: null,
      fulfilledById: null,
      fulfilledAt: null,
      rejectionReason: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('owner can view', async () => {
      prisma.stockOut.findUniqueOrThrow.mockResolvedValue({
        ...base,
        requestedBy: {},
        fulfilledBy: null,
        permitCluster: null,
      });
      await expect(service.findOne('so1', 'u1', Role.PM_FTTH)).resolves.toBeDefined();
    });

    it('ADMIN_STOCK can view any', async () => {
      prisma.stockOut.findUniqueOrThrow.mockResolvedValue({
        ...base,
        requestedById: 'other',
        requestedBy: {},
        fulfilledBy: null,
        permitCluster: null,
      });
      await expect(service.findOne('so1', 'u9', Role.ADMIN_STOCK)).resolves.toBeDefined();
    });

    it('surveyor cannot view others', async () => {
      prisma.stockOut.findUniqueOrThrow.mockResolvedValue({
        ...base,
        requestedById: 'other',
        requestedBy: {},
        fulfilledBy: null,
        permitCluster: null,
      });
      await expect(service.findOne('so1', 'u9', Role.SURVEYOR_FTTH)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('getInboxCount', () => {
    it('non–Admin Stock → 0', async () => {
      await expect(service.getInboxCount(Role.PM_FTTH)).resolves.toBe(0);
    });

    it('ADMIN_STOCK → count', async () => {
      prisma.stockOut.count.mockResolvedValue(4);
      await expect(service.getInboxCount(Role.ADMIN_STOCK)).resolves.toBe(4);
    });
  });
});
