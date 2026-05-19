import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PoGenerationService } from './po-generation.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ProcurementMailService } from '../procurement-mail/procurement-mail.service';

describe('PoGenerationService', () => {
  let service: PoGenerationService;
  const prisma = {
    order: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const storage = {
    uploadBuffer: jest.fn(),
    deleteFile: jest.fn(),
    downloadBuffer: jest.fn(),
  };
  const mail = { sendEmail: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PoGenerationService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: ProcurementMailService, useValue: mail },
      ],
    }).compile();
    service = module.get(PoGenerationService);
  });

  describe('generatePoNumber', () => {
    it('first of year → PO-YYYY-0001', async () => {
      const y = new Date().getFullYear();
      prisma.order.findFirst.mockResolvedValue(null);
      await expect(service.generatePoNumber()).resolves.toBe(`PO-${y}-0001`);
    });

    it('increments sequence', async () => {
      const y = new Date().getFullYear();
      prisma.order.findFirst.mockResolvedValue({ poNumber: `PO-${y}-0003` });
      await expect(service.generatePoNumber()).resolves.toBe(`PO-${y}-0004`);
    });
  });

  describe('buildPoPdf', () => {
    const baseOrder = {
      id: 'o1',
      status: 'PENDING_PAYMENT_RECEIPT',
      orderNumber: 'ORD-1',
      orderTrigger: 'PROJECT_REQUEST',
      notes: null,
      poNumber: null,
      totalAmount: new Prisma.Decimal(100),
      supplier: { id: 's1', name: 'PT X', address: 'Jakarta', phone: '08', npwp: '1' },
      creator: { id: 'u1', name: 'PM', email: 'pm@test.com' },
      items: [
        {
          id: 'i1',
          itemName: 'Kabel',
          requestedQty: 2,
          unitPrice: new Prisma.Decimal(50),
          totalPrice: new Prisma.Decimal(100),
          stockItem: { name: 'Kabel 1' },
        },
      ],
    };

    beforeEach(() => {
      prisma.order.findUnique.mockResolvedValue(baseOrder);
    });

    it('produces non-empty PDF buffer', async () => {
      const { pdfBuffer, poNumber } = await service.buildPoPdf('o1');
      expect(pdfBuffer.length).toBeGreaterThan(100);
      expect(poNumber.startsWith('PO-')).toBe(true);
    });

    it('reuses existing poNumber', async () => {
      prisma.order.findUnique.mockResolvedValue({ ...baseOrder, poNumber: 'PO-2026-0009' });
      const { poNumber } = await service.buildPoPdf('o1');
      expect(poNumber).toBe('PO-2026-0009');
    });

    it('no supplier → 400', async () => {
      prisma.order.findUnique.mockResolvedValue({ ...baseOrder, supplier: null });
      await expect(service.buildPoPdf('o1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('wrong status → 400', async () => {
      prisma.order.findUnique.mockResolvedValue({ ...baseOrder, status: 'DRAFT' });
      await expect(service.buildPoPdf('o1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('order not found → 404', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.buildPoPdf('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('generateAndStorePo', () => {
    it('idempotent when PO already stored', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({
        id: 'o1',
        poNumber: 'PO-2026-0001',
        poFileUrl: 'http://localhost:3001/api/files/po/x.pdf',
        poGeneratedAt: new Date('2026-01-01'),
      });
      const r = await service.generateAndStorePo('o1');
      expect(r.poNumber).toBe('PO-2026-0001');
      expect(storage.uploadBuffer).not.toHaveBeenCalled();
    });

    it('happy path persists PO fields', async () => {
      prisma.order.findUnique
        .mockResolvedValueOnce({
          id: 'o1',
          poNumber: null,
          poFileUrl: null,
          poGeneratedAt: null,
        })
        .mockResolvedValueOnce({
          id: 'o1',
          status: 'PENDING_PAYMENT_RECEIPT',
          orderNumber: 'ORD-1',
          orderTrigger: 'PROJECT_REQUEST',
          notes: null,
          poNumber: null,
          totalAmount: new Prisma.Decimal(10),
          supplier: { id: 's', name: 'S', address: null, phone: null, npwp: null },
          creator: { id: 'u', name: 'U', email: 'u@t.com' },
          items: [
            {
              id: 'i1',
              itemName: 'A',
              requestedQty: 1,
              unitPrice: new Prisma.Decimal(10),
              totalPrice: new Prisma.Decimal(10),
              stockItem: null,
            },
          ],
        });

      storage.uploadBuffer.mockResolvedValue('http://local/api/files/po/2026/PO-2026-0999.pdf');
      prisma.order.update.mockResolvedValue({});

      const y = new Date().getFullYear();
      prisma.order.findFirst.mockResolvedValue({ poNumber: `PO-${y}-0998` });

      const r = await service.generateAndStorePo('o1');
      expect(storage.uploadBuffer).toHaveBeenCalled();
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'o1' },
          data: expect.objectContaining({ poFileUrl: expect.any(String) }),
        }),
      );
      expect(r.fileUrl).toContain('po/');
    });

    it('upload+update failure deletes file', async () => {
      prisma.order.findUnique
        .mockResolvedValueOnce({ id: 'o1', poNumber: null, poFileUrl: null, poGeneratedAt: null })
        .mockResolvedValueOnce({
          id: 'o1',
          status: 'PENDING_PAYMENT_RECEIPT',
          orderNumber: 'ORD-1',
          orderTrigger: 'PROJECT_REQUEST',
          notes: null,
          poNumber: null,
          totalAmount: new Prisma.Decimal(10),
          supplier: { id: 's', name: 'S', address: null, phone: null, npwp: null },
          creator: { id: 'u', name: 'U', email: 'u@t.com' },
          items: [
            {
              id: 'i1',
              itemName: 'A',
              requestedQty: 1,
              unitPrice: new Prisma.Decimal(10),
              totalPrice: new Prisma.Decimal(10),
              stockItem: null,
            },
          ],
        });
      prisma.order.findFirst.mockResolvedValue(null);
      storage.uploadBuffer.mockResolvedValue('http://localhost:3001/api/files/po/2026/x.pdf');
      prisma.order.update.mockRejectedValueOnce(new Error('db'));

      await expect(service.generateAndStorePo('o1')).rejects.toThrow('db');
      expect(storage.deleteFile).toHaveBeenCalled();
    });
  });

  describe('sendPoEmail', () => {
    it('happy path', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1',
        poNumber: 'PO-1',
        poFileUrl: 'http://localhost:3001/api/files/po/x.pdf',
        orderNumber: 'ORD-1',
        orderTrigger: 'PROJECT_REQUEST',
        totalAmount: new Prisma.Decimal(100),
        supplier: { name: 'V', email: 'v@v.com' },
      });
      storage.downloadBuffer.mockReturnValue(Buffer.from('%PDF'));
      mail.sendEmail.mockResolvedValue({ messageId: 'm1', acceptedRecipients: ['v@v.com'] });
      prisma.order.update.mockResolvedValue({});

      const r = await service.sendPoEmail('o1', 'pur1');
      expect(r.messageId).toBe('m1');
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ poEmailSentById: 'pur1' }),
        }),
      );
    });

    it('PO not generated → 400', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1',
        poNumber: null,
        poFileUrl: null,
        supplier: { name: 'V', email: 'e@e.com' },
      });
      await expect(service.sendPoEmail('o1', 'u')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('supplier tanpa email → 400', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1',
        poNumber: 'P',
        poFileUrl: 'http://x/y.pdf',
        orderNumber: 'ORD',
        orderTrigger: 'PROJECT_REQUEST',
        totalAmount: null,
        supplier: { name: 'Tanpa Email', email: null },
      });
      await expect(service.sendPoEmail('o1', 'u')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('mail failure → 500', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1',
        poNumber: 'P',
        poFileUrl: 'http://localhost:3001/api/files/a.pdf',
        orderNumber: 'ORD',
        orderTrigger: 'PROJECT_REQUEST',
        totalAmount: null,
        supplier: { name: 'V', email: 'v@v.com' },
      });
      storage.downloadBuffer.mockReturnValue(Buffer.from('x'));
      mail.sendEmail.mockRejectedValue(new InternalServerErrorException('fail'));
      await expect(service.sendPoEmail('o1', 'u')).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });
});
