import { Test, TestingModule } from '@nestjs/testing'; // NEW: testing harness
import { ConflictException } from '@nestjs/common'; // NEW: conflict assertion
import { StockService } from './stock.service'; // NEW: service under test
import { PrismaService } from '../prisma/prisma.service'; // NEW: prisma token
import { NotificationsGateway } from '../notifications/notifications.gateway'; // NEW: gateway token

describe('StockService', () => { // NEW: stock suite
  let service: StockService; // NEW: service instance
  const prisma = { // NEW: prisma mock
    stockItem: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    stockLog: { create: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };
  const gateway = { emitToRoom: jest.fn() }; // NEW: gateway mock

  beforeEach(async () => { // NEW: setup module
    jest.clearAllMocks(); // NEW: clear mocks
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsGateway, useValue: gateway },
      ],
    }).compile();
    service = module.get(StockService);
  });

  describe('findAll', () => { // NEW: list behavior
    it('returns paginated response', async () => { // NEW: shape assertion
      prisma.$transaction.mockResolvedValue([[{ id: 's1', currentQty: 5, minStockQty: 2 }], 1]);
      const result = await service.findAll({ page: 1, limit: 10, sortOrder: 'asc', isActive: true } as any);
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('meta');
    });

    it('lowStock filter returns only items where currentQty <= minStockQty', async () => { // NEW: low stock behavior
      prisma.$queryRaw.mockResolvedValue([{ id: 's1' }]);
      prisma.$transaction.mockResolvedValue([[{ id: 's1', currentQty: 1, minStockQty: 2 }], 1]);
      const result = await service.findAll({ page: 1, limit: 10, sortOrder: 'asc', isActive: true, lowStock: true } as any);
      expect((result.data[0] as any).isLowStock).toBe(true); // FIX: cast unknown paginated item for spec assertion
    });

    it('search filters by name and code case-insensitively', async () => { // NEW: search OR behavior
      prisma.$transaction.mockResolvedValue([[], 0]);
      await service.findAll({ page: 1, limit: 10, sortOrder: 'asc', isActive: true, search: 'kbl' } as any);
      const where = prisma.stockItem.findMany.mock.calls[0][0].where;
      expect(where.OR).toHaveLength(2);
    });
  });

  describe('create', () => { // NEW: create behavior
    it('creates stock item successfully', async () => { // NEW: create success
      prisma.stockItem.findUnique.mockResolvedValue(null);
      prisma.stockItem.create.mockResolvedValue({ id: 's1' });
      const result = await service.create({ code: 'ITM-1', name: 'Item', unit: 'pcs', category: 'Kabel', currentQty: 0, minStockQty: 0 } as any, 'admin1');
      expect(result.id).toBe('s1');
    });

    it('throws ConflictException for duplicate code', async () => { // NEW: duplicate code
      prisma.stockItem.findUnique.mockResolvedValue({ id: 'exists' });
      await expect(service.create({ code: 'ITM-1' } as any, 'admin1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates initial StockLog when currentQty > 0 on creation', async () => { // NEW: initial stock log
      prisma.stockItem.findUnique.mockResolvedValue(null);
      prisma.stockItem.create.mockResolvedValue({ id: 's1' });
      await service.create({ code: 'ITM-1', name: 'Item', unit: 'pcs', category: 'Kabel', currentQty: 5, minStockQty: 2 } as any, 'admin1');
      expect(prisma.stockLog.create).toHaveBeenCalled();
    });
  });

  describe('adjustStock', () => { // NEW: adjustment behavior
    it('updates currentQty to newQty', async () => { // NEW: quantity update
      prisma.stockItem.findUnique.mockResolvedValue({ id: 's1', name: 'Item', currentQty: 10, minStockQty: 2, unit: 'pcs' });
      prisma.$transaction.mockImplementation(async (cb: any) => cb({ stockItem: { update: jest.fn().mockResolvedValue({ id: 's1', currentQty: 3 }) }, stockLog: { create: jest.fn() } }));
      const result = await service.adjustStock({ stockItemId: 's1', newQty: 3, reason: 'adjust' } as any, 'admin1');
      expect(result.currentQty).toBe(3);
    });

    it('creates StockLog with correct qtyBefore, qtyChange, qtyAfter', async () => { // NEW: stock log details
      const txStockLogCreate = jest.fn();
      prisma.stockItem.findUnique.mockResolvedValue({ id: 's1', name: 'Item', currentQty: 10, minStockQty: 2, unit: 'pcs' });
      prisma.$transaction.mockImplementation(async (cb: any) => cb({ stockItem: { update: jest.fn().mockResolvedValue({ id: 's1', currentQty: 3 }) }, stockLog: { create: txStockLogCreate } }));
      await service.adjustStock({ stockItemId: 's1', newQty: 3, reason: 'adjust' } as any, 'admin1');
      expect(txStockLogCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ qtyBefore: 10, qtyChange: -7, qtyAfter: 3 }) }));
    });

    it('emits stock:lowAlert when newQty <= minStockQty', async () => { // NEW: low alert event
      prisma.stockItem.findUnique.mockResolvedValue({ id: 's1', name: 'Item', currentQty: 10, minStockQty: 3, unit: 'pcs' });
      prisma.$transaction.mockImplementation(async (cb: any) => cb({ stockItem: { update: jest.fn().mockResolvedValue({ id: 's1', currentQty: 2 }) }, stockLog: { create: jest.fn() } }));
      await service.adjustStock({ stockItemId: 's1', newQty: 2, reason: 'adjust' } as any, 'admin1');
      expect(gateway.emitToRoom).toHaveBeenCalledWith('role:ADMIN_STOCK', 'stock:lowAlert', expect.any(Object));
    });

    it('emits stock:adjusted event', async () => { // NEW: adjusted event
      prisma.stockItem.findUnique.mockResolvedValue({ id: 's1', name: 'Item', currentQty: 10, minStockQty: 3, unit: 'pcs' });
      prisma.$transaction.mockImplementation(async (cb: any) => cb({ stockItem: { update: jest.fn().mockResolvedValue({ id: 's1', currentQty: 9 }) }, stockLog: { create: jest.fn() } }));
      await service.adjustStock({ stockItemId: 's1', newQty: 9, reason: 'adjust' } as any, 'admin1');
      expect(gateway.emitToRoom).toHaveBeenCalledWith('role:ADMIN_STOCK', 'stock:adjusted', expect.any(Object));
    });
  });

  describe('checkAvailability', () => { // NEW: availability summary
    it('returns sufficient=true when currentQty >= requestedQty', async () => { // NEW: sufficient item
      prisma.stockItem.findUnique.mockResolvedValue({ id: 's1', name: 'Item', currentQty: 10, unit: 'pcs' });
      const result = await service.checkAvailability([{ stockItemId: 's1', requestedQty: 5 }]);
      expect(result.items[0].sufficient).toBe(true);
    });

    it('returns sufficient=false when currentQty < requestedQty', async () => { // NEW: insufficient item
      prisma.stockItem.findUnique.mockResolvedValue({ id: 's1', name: 'Item', currentQty: 1, unit: 'pcs' });
      const result = await service.checkAvailability([{ stockItemId: 's1', requestedQty: 5 }]);
      expect(result.items[0].sufficient).toBe(false);
    });

    it('allAvailable=true only when ALL items sufficient', async () => { // NEW: all available summary
      prisma.stockItem.findUnique
        .mockResolvedValueOnce({ id: 's1', name: 'Item1', currentQty: 5, unit: 'pcs' })
        .mockResolvedValueOnce({ id: 's2', name: 'Item2', currentQty: 6, unit: 'pcs' });
      const result = await service.checkAvailability([{ stockItemId: 's1', requestedQty: 2 }, { stockItemId: 's2', requestedQty: 3 }]);
      expect(result.summary.allAvailable).toBe(true);
    });

    it('noneAvailable=true when NO items sufficient', async () => { // NEW: none available summary
      prisma.stockItem.findUnique
        .mockResolvedValueOnce({ id: 's1', name: 'Item1', currentQty: 1, unit: 'pcs' })
        .mockResolvedValueOnce({ id: 's2', name: 'Item2', currentQty: 1, unit: 'pcs' });
      const result = await service.checkAvailability([{ stockItemId: 's1', requestedQty: 2 }, { stockItemId: 's2', requestedQty: 3 }]);
      expect(result.summary.noneAvailable).toBe(true);
    });
  });
});
