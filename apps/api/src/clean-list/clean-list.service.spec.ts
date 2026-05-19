import { Test, TestingModule } from '@nestjs/testing'; // NEW: testing harness
import { ConflictException } from '@nestjs/common'; // NEW: duplicate checks
import { CleanListService } from './clean-list.service'; // NEW: service under test
import { PrismaService } from '../prisma/prisma.service'; // NEW: prisma token
import { NotificationsGateway } from '../notifications/notifications.gateway'; // NEW: gateway token
import { NotificationsService } from '../notifications/notifications.service'; // NEW: task notifications

describe('CleanListService', () => { // NEW: clean list suite
  let service: CleanListService; // NEW: service instance
  const prisma = { // NEW: mock prisma
    cleanList: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      groupBy: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const gateway = { emitToAll: jest.fn() }; // NEW: mock gateway
  const notifications = { createForUser: jest.fn(), createForRole: jest.fn() }; // NEW: mock notifications

  beforeEach(async () => { // NEW: setup module
    jest.clearAllMocks(); // NEW: clear mocks
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CleanListService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsGateway, useValue: gateway },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = module.get(CleanListService);
  });

  describe('findAll', () => { // NEW: pagination + filters
    it('returns PaginatedResponse shape with data and meta', async () => { // NEW: response shape
      prisma.$transaction.mockResolvedValue([[{ id: '1' }], 1]);
      const result = await service.findAll({ page: 1, limit: 10, sortOrder: 'desc' } as any);
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('meta');
      expect(result.meta.total).toBe(1);
    });

    it('filters by ispCustomer correctly', async () => { // NEW: isp filter
      prisma.$transaction.mockResolvedValue([[], 0]);
      await service.findAll({ page: 1, limit: 10, sortOrder: 'desc', ispCustomer: 'FiberStar' } as any);
      expect(prisma.cleanList.findMany.mock.calls[0][0].where.ispCustomer).toEqual({ equals: 'FiberStar', mode: 'insensitive' });
    });

    it('filters by fiberType correctly', async () => { // NEW: fiber filter
      prisma.$transaction.mockResolvedValue([[], 0]);
      await service.findAll({ page: 1, limit: 10, sortOrder: 'desc', fiberType: 'FTTH' } as any);
      expect(prisma.cleanList.findMany.mock.calls[0][0].where.fiberType).toBe('FTTH');
    });

    it('filters by status correctly', async () => { // NEW: status filter
      prisma.$transaction.mockResolvedValue([[], 0]);
      await service.findAll({ page: 1, limit: 10, sortOrder: 'desc', status: 'AVAILABLE' } as any);
      expect(prisma.cleanList.findMany.mock.calls[0][0].where.status).toBe('AVAILABLE');
    });

    it('searches rwCode, kelurahan, kecamatan case-insensitively', async () => { // NEW: search filter
      prisma.$transaction.mockResolvedValue([[], 0]);
      await service.findAll({ page: 1, limit: 10, sortOrder: 'desc', search: 'rw-a' } as any);
      const where = prisma.cleanList.findMany.mock.calls[0][0].where;
      expect(where.OR).toHaveLength(3);
    });

    it('returns empty data array (not error) when no results', async () => { // NEW: empty list behavior
      prisma.$transaction.mockResolvedValue([[], 0]);
      const result = await service.findAll({ page: 1, limit: 10, sortOrder: 'desc' } as any);
      expect(result.data).toEqual([]);
    });

    it('respects page and limit params', async () => { // NEW: pagination args
      prisma.$transaction.mockResolvedValue([[], 0]);
      await service.findAll({ page: 3, limit: 20, sortOrder: 'desc' } as any);
      expect(prisma.cleanList.findMany.mock.calls[0][0].skip).toBe(40);
      expect(prisma.cleanList.findMany.mock.calls[0][0].take).toBe(20);
    });

    it('meta.totalPages = ceil(total / limit)', async () => { // NEW: total pages calculation
      prisma.$transaction.mockResolvedValue([[{ id: '1' }], 21]);
      const result = await service.findAll({ page: 1, limit: 10, sortOrder: 'desc' } as any);
      expect(result.meta.totalPages).toBe(3);
    });
  });

  describe('create', () => { // NEW: create behavior
    it('creates clean list entry successfully', async () => { // NEW: success create
      prisma.cleanList.findFirst.mockResolvedValue(null);
      prisma.cleanList.create.mockResolvedValue({ id: 'new-id' });
      const result = await service.create({ rwCode: 'RW01', kelurahan: 'A', ispCustomer: 'Fiber', fiberType: 'FTTH' } as any, 'gm-1');
      expect(result.id).toBe('new-id');
    });

    it('throws ConflictException for duplicate rwCode+kelurahan+ispCustomer', async () => { // NEW: duplicate guard
      prisma.cleanList.findFirst.mockResolvedValue({ id: 'dup' });
      await expect(
        service.create({ rwCode: 'RW01', kelurahan: 'A', ispCustomer: 'Fiber', fiberType: 'FTTH' } as any, 'gm-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('bulkImport', () => { // NEW: bulk import behavior
    it('creates multiple entries in transaction', async () => { // NEW: transaction create
      prisma.$transaction.mockImplementation(async (cb: any) => cb({
        cleanList: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
        },
      }));
      const result = await service.bulkImport({
        ispCustomer: 'Fiber',
        fiberType: 'FTTH',
        rows: [{ rwCode: 'RW01', kelurahan: 'A', kecamatan: 'B', kotaKabupaten: 'C', homepasCount: 10 }],
      } as any, 'gm-1');
      expect(result.created).toBe(1);
    });

    it('skips duplicates instead of failing', async () => { // NEW: duplicate skip
      prisma.$transaction.mockImplementation(async (cb: any) => cb({
        cleanList: {
          findFirst: jest.fn().mockResolvedValue({ id: 'dup' }),
          create: jest.fn(),
        },
      }));
      const result = await service.bulkImport({
        ispCustomer: 'Fiber',
        fiberType: 'FTTH',
        rows: [{ rwCode: 'RW01', kelurahan: 'A', kecamatan: 'B', kotaKabupaten: 'C', homepasCount: 10 }],
      } as any, 'gm-1');
      expect(result.skipped).toBe(1);
    });

    it('returns { created, skipped, total } summary', async () => { // NEW: summary assertion
      prisma.$transaction.mockImplementation(async (cb: any) => cb({
        cleanList: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
        },
      }));
      const result = await service.bulkImport({
        ispCustomer: 'Fiber',
        fiberType: 'FTTH',
        rows: [{ rwCode: 'RW01', kelurahan: 'A', kecamatan: 'B', kotaKabupaten: 'C', homepasCount: 10 }],
      } as any, 'gm-1');
      expect(result).toEqual({ created: 1, skipped: 0, total: 1 });
    });
  });

  describe('markExistingFiber', () => { // NEW: existing fiber mark
    it('sets hasExistingFiber=true and operatorName', async () => { // NEW: update fields
      prisma.cleanList.findUnique.mockResolvedValue({ id: 'cl1' });
      prisma.cleanList.update.mockResolvedValue({ id: 'cl1', rwCode: 'RW01' });
      await service.markExistingFiber('cl1', 'ISP Existing', 'u1');
      expect(prisma.cleanList.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ hasExistingFiber: true, existingOperator: 'ISP Existing' }),
        }),
      );
    });

    it('updates status to HAS_EXISTING_FIBER', async () => { // NEW: status transition
      prisma.cleanList.findUnique.mockResolvedValue({ id: 'cl1' });
      prisma.cleanList.update.mockResolvedValue({ id: 'cl1', rwCode: 'RW01' });
      await service.markExistingFiber('cl1', 'ISP Existing', 'u1');
      expect(prisma.cleanList.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'HAS_EXISTING_FIBER' }) }));
    });

    it('emits Socket.IO gis:markedExisting event', async () => { // NEW: socket event
      prisma.cleanList.findUnique.mockResolvedValue({ id: 'cl1' });
      prisma.cleanList.update.mockResolvedValue({ id: 'cl1', rwCode: 'RW01' });
      await service.markExistingFiber('cl1', 'ISP Existing', 'u1');
      expect(gateway.emitToAll).toHaveBeenCalledWith('gis:markedExisting', expect.any(Object));
    });
  });
});
