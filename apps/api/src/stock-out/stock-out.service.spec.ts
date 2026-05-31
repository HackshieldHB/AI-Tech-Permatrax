import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role, StockOutStatus } from '@prisma/client';
import { StockOutService } from './stock-out.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { StockService } from '../stock/stock.service';
import { SuratJalanService } from '../surat-jalan/surat-jalan.service';
import { runSerializableTransaction } from '../budget-ledger/transaction-retry.util';
import {
  CreateStockOutDto,
  RejectStockOutDto,
  FilterStockOutDto,
  StockOutItemDto,
  AdminStockApproveDto,
} from './stock-out.dto';

jest.mock('../budget-ledger/transaction-retry.util', () => ({
  runSerializableTransaction: jest.fn(),
}));

describe('StockOutService', () => {
  let service: StockOutService;

  const tx = {
    stockItem: { findMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    permitCluster: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
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
    user: { findUnique: jest.fn() },
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

  const suratJalan = {
    generateForStockOut: jest.fn().mockResolvedValue({ id: 'sj1' }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    Object.values(tx.stockOut).forEach((m) => (m as jest.Mock).mockReset());
    Object.values(tx.stockItem).forEach((m) => (m as jest.Mock).mockReset());
    tx.permitCluster.findUnique.mockReset();
    tx.user.findUnique.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockOutService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: NotificationsGateway, useValue: gateway },
        { provide: StockService, useValue: stock },
        { provide: SuratJalanService, useValue: suratJalan },
      ],
    }).compile();

    service = module.get(StockOutService);
    (runSerializableTransaction as jest.Mock).mockImplementation(async (_p: unknown, fn: (t: typeof tx) => unknown) =>
      fn(tx),
    );
  });

  describe('Zod CreateStockOutDto', () => {
    it('rejects empty items', () => {
      expect(CreateStockOutDto.safeParse({ items: [], recipient: 'x' }).success).toBe(false);
    });

    it('rejects missing recipient', () => {
      expect(
        CreateStockOutDto.safeParse({ items: [{ stockItemId: 'cid', qty: 1 }] }).success,
      ).toBe(false);
    });

    it('rejects qty <= 0', () => {
      expect(StockOutItemDto.safeParse({ stockItemId: 'cid', qty: 0 }).success).toBe(false);
    });
  });

  describe('Zod RejectStockOutDto', () => {
    it('rejects empty reason', () => {
      expect(RejectStockOutDto.safeParse({ reason: '' }).success).toBe(false);
    });
  });

  describe('Zod AdminStockApproveDto', () => {
    it('rejects empty doNumber', () => {
      expect(AdminStockApproveDto.safeParse({ doNumber: '' }).success).toBe(false);
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
      recipient: 'Budi Santoso',
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
        expect.objectContaining({ type: 'STOCK_OUT_REQUESTED', entityId: 'so1' }),
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

  describe('adminStockApprove', () => {
    const pending = {
      id: 'so1',
      status: StockOutStatus.PENDING,
      items: [{ stockItemId: 's1', qty: 2 }],
      requestedById: 'req1',
      requestNumber: 'SO-2026-0001',
      requestedBy: { id: 'req1', name: 'Ann' },
    };

    beforeEach(() => {
      prisma.stockOut.findUniqueOrThrow.mockResolvedValue(pending);
      prisma.stockOut.update.mockResolvedValue({
        ...pending,
        status: StockOutStatus.PENDING_PM_CONFIRM,
        doNumber: 'DO-001',
        adminStockApprovedById: 'admin1',
        requestedBy: { id: 'req1', name: 'Ann' },
      });
    });

    it('happy path → PENDING_PM_CONFIRM + notify PM', async () => {
      const res = await service.adminStockApprove('so1', { doNumber: 'DO-001' }, 'admin1');
      expect(res.status).toBe(StockOutStatus.PENDING_PM_CONFIRM);
      expect(notifications.createForUser).toHaveBeenCalledWith(
        'req1',
        expect.objectContaining({ type: 'STOCK_OUT_REQUESTED' }),
      );
    });

    it('wrong status → 400', async () => {
      prisma.stockOut.findUniqueOrThrow.mockResolvedValue({ ...pending, status: StockOutStatus.FULFILLED });
      await expect(service.adminStockApprove('so1', { doNumber: 'DO-001' }, 'a')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('reject (hard reject)', () => {
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

    it('scope inbox FINANCE → PENDING_FINANCE', async () => {
      await service.findAll(FilterStockOutDto.parse({ scope: 'inbox' }), 'u99', Role.FINANCE);
      expect(prisma.stockOut.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: StockOutStatus.PENDING_FINANCE }),
        }),
      );
    });

    it('scope inbox PM_FTTH → PENDING_PM_CONFIRM or DRAFT for own requests', async () => {
      await service.findAll(FilterStockOutDto.parse({ scope: 'inbox' }), 'u1', Role.PM_FTTH);
      expect(prisma.stockOut.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ requestedById: 'u1' }),
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
        adminStockApprover: null,
        pmConfirmer: null,
        financeApprover: null,
        permitCluster: null,
        suratJalan: null,
      });
      await expect(service.findOne('so1', 'u1', Role.PM_FTTH)).resolves.toBeDefined();
    });

    it('ADMIN_STOCK can view any', async () => {
      prisma.stockOut.findUniqueOrThrow.mockResolvedValue({
        ...base,
        requestedById: 'other',
        requestedBy: {},
        fulfilledBy: null,
        adminStockApprover: null,
        pmConfirmer: null,
        financeApprover: null,
        permitCluster: null,
        suratJalan: null,
      });
      await expect(service.findOne('so1', 'u9', Role.ADMIN_STOCK)).resolves.toBeDefined();
    });

    it('surveyor cannot view others', async () => {
      prisma.stockOut.findUniqueOrThrow.mockResolvedValue({
        ...base,
        requestedById: 'other',
        requestedBy: {},
        fulfilledBy: null,
        adminStockApprover: null,
        pmConfirmer: null,
        financeApprover: null,
        permitCluster: null,
        suratJalan: null,
      });
      await expect(service.findOne('so1', 'u9', Role.SURVEYOR_FTTH)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('getInboxCount', () => {
    it('non-tracked role → 0', async () => {
      await expect(service.getInboxCount('u1', Role.SURVEYOR_FTTH)).resolves.toBe(0);
    });

    it('ADMIN_STOCK → PENDING count', async () => {
      prisma.stockOut.count.mockResolvedValue(4);
      await expect(service.getInboxCount('u99', Role.ADMIN_STOCK)).resolves.toBe(4);
    });

    it('FINANCE → PENDING_FINANCE count', async () => {
      prisma.stockOut.count.mockResolvedValue(2);
      await expect(service.getInboxCount('u99', Role.FINANCE)).resolves.toBe(2);
    });

    it('PM_FTTH → own PENDING_PM_CONFIRM + DRAFT count', async () => {
      prisma.stockOut.count.mockResolvedValue(3);
      await expect(service.getInboxCount('u1', Role.PM_FTTH)).resolves.toBe(3);
    });
  });
});
