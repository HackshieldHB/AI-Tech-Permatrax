import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SupplierService } from './supplier.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto } from './supplier.dto';

describe('SupplierService', () => {
  let service: SupplierService;
  const prisma = {
    supplier: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [SupplierService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(SupplierService);
  });

  describe('generateCode', () => {
    it('first supplier of year → SUP-YYYY-001', async () => {
      const y = new Date().getFullYear();
      prisma.supplier.findFirst.mockResolvedValue(null);
      await expect(service.generateCode()).resolves.toBe(`SUP-${y}-001`);
    });

    it('increments from last code for year', async () => {
      const y = new Date().getFullYear();
      prisma.supplier.findFirst.mockResolvedValue({ code: `SUP-${y}-005` });
      await expect(service.generateCode()).resolves.toBe(`SUP-${y}-006`);
    });

    it('year boundary: no match for new prefix yields 001', async () => {
      const y = new Date().getFullYear();
      prisma.supplier.findFirst.mockResolvedValue(null);
      await expect(service.generateCode()).resolves.toBe(`SUP-${y}-001`);
    });
  });

  describe('create', () => {
    it('creates with full data', async () => {
      jest.spyOn(service, 'generateCode').mockResolvedValue('SUP-2026-001');
      prisma.supplier.create.mockResolvedValue({ id: 's1', code: 'SUP-2026-001' });
      const dto = {
        name: 'PT Contoh',
        npwp: '00',
        email: 'a@b.com',
        phone: '081',
        address: 'Jl',
        bankAccount: '123',
        bankName: 'BCA',
        contactPerson: 'Budi',
        notes: 'ok',
      };
      const out = await service.create(dto, 'user1');
      expect(prisma.supplier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'PT Contoh', createdById: 'user1' }),
        }),
      );
      expect(out.id).toBe('s1');
    });

    it('minimal data (name only)', async () => {
      jest.spyOn(service, 'generateCode').mockResolvedValue('SUP-2026-002');
      prisma.supplier.create.mockResolvedValue({ id: 's2' });
      await service.create({ name: 'X' }, 'u1');
      expect(prisma.supplier.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'X' }) }),
      );
    });
  });

  describe('DTO email', () => {
    it('invalid email fails Zod', () => {
      const r = CreateSupplierDto.safeParse({ name: 'A', email: 'not-an-email' });
      expect(r.success).toBe(false);
    });

    it('empty email is treated as undefined', () => {
      const r = CreateSupplierDto.safeParse({ name: 'A', email: '' });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.email).toBeUndefined();
    });
  });

  describe('update', () => {
    it('partial update', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 's1' });
      prisma.supplier.update.mockResolvedValue({ id: 's1', name: 'New' });
      await expect(service.update('s1', { name: 'New' })).resolves.toMatchObject({ name: 'New' });
    });

    it('non-existent → 404', async () => {
      prisma.supplier.findUnique.mockResolvedValue(null);
      await expect(service.update('bad', { name: 'X' })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('search filter builds OR on name, code, npwp', async () => {
      prisma.supplier.findMany.mockResolvedValue([]);
      prisma.supplier.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20, search: 'abc', isActive: 'all' });
      expect(prisma.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.any(Array),
          }),
        }),
      );
    });

    it('isActive true filter', async () => {
      prisma.supplier.findMany.mockResolvedValue([]);
      prisma.supplier.count.mockResolvedValue(0);
      await service.findAll({ page: 1, limit: 20, isActive: 'true' });
      expect(prisma.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });

    it('returns paginated shape', async () => {
      prisma.supplier.findMany.mockResolvedValue([{ id: '1' }]);
      prisma.supplier.count.mockResolvedValue(1);
      const r = await service.findAll({ page: 1, limit: 20, isActive: 'all' });
      expect(r.data).toHaveLength(1);
      expect(r.meta.total).toBe(1);
    });
  });

  describe('findActive', () => {
    it('only active sorted by name asc', async () => {
      prisma.supplier.findMany.mockResolvedValue([]);
      await service.findActive();
      expect(prisma.supplier.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('deactivate / activate', () => {
    it('deactivate sets isActive false', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 's1' });
      prisma.supplier.update.mockResolvedValue({ id: 's1', isActive: false });
      await expect(service.deactivate('s1')).resolves.toMatchObject({ isActive: false });
    });

    it('activate sets isActive true', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 's1' });
      prisma.supplier.update.mockResolvedValue({ id: 's1', isActive: true });
      await expect(service.activate('s1')).resolves.toMatchObject({ isActive: true });
    });
  });
});
