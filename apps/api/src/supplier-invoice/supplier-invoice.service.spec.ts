import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupplierInvoiceService } from './supplier-invoice.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProcurementMailService } from '../procurement-mail/procurement-mail.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { runSerializableTransaction } from '../budget-ledger/transaction-retry.util';
import { Role } from '@prisma/client';
import { UploadInvoiceDto } from './supplier-invoice.dto';

jest.mock('../budget-ledger/transaction-retry.util', () => ({
  runSerializableTransaction: jest.fn(),
}));

describe('SupplierInvoiceService', () => {
  let service: SupplierInvoiceService;

  const prisma = {
    supplierInvoice: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    order: {
      findUnique: jest.fn(),
    },
  };

  const mail = { sendEmail: jest.fn() };
  const storage = { downloadBuffer: jest.fn() };
  const notifications = {
    notifyUsersByRole: jest.fn(),
    createForRoles: jest.fn(),
  };
  const gateway = { emitToRoom: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    (runSerializableTransaction as jest.Mock).mockImplementation(async (_p: unknown, fn: (tx: typeof prisma) => Promise<unknown>) =>
      fn(prisma),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierInvoiceService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProcurementMailService, useValue: mail },
        { provide: StorageService, useValue: storage },
        { provide: NotificationsService, useValue: notifications },
        { provide: NotificationsGateway, useValue: gateway },
      ],
    }).compile();
    service = module.get(SupplierInvoiceService);
  });

  describe('generateInvoiceNumber', () => {
    it('first of year → SI-YYYY-0001', async () => {
      const y = new Date().getFullYear();
      prisma.supplierInvoice.findFirst.mockResolvedValue(null);
      await expect(service.generateInvoiceNumber()).resolves.toBe(`SI-${y}-0001`);
    });

    it('sequential per year', async () => {
      const y = new Date().getFullYear();
      prisma.supplierInvoice.findFirst.mockResolvedValue({ invoiceNumber: `SI-${y}-0002` });
      await expect(service.generateInvoiceNumber()).resolves.toBe(`SI-${y}-0003`);
    });
  });

  describe('upload', () => {
    const dtoBase = {
      orderId: 'ord1',
      invoiceFileUrl: 'http://localhost:3001/api/files/x.pdf',
      invoiceAmount: 1000,
      paymentMethod: 'CBD' as const,
    };

    it('happy path PENDING_PAYMENT_RECEIPT', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'ord1',
        status: 'PENDING_PAYMENT_RECEIPT',
        supplierId: 's1',
        supplier: { id: 's1', name: 'S' },
        supplierInvoice: null,
      });
      prisma.supplierInvoice.findFirst.mockResolvedValue(null);
      const created = {
        id: 'inv1',
        invoiceNumber: 'SI-2026-0001',
        orderId: 'ord1',
      };
      prisma.supplierInvoice.create.mockResolvedValue(created);

      const out = await service.upload(dtoBase, 'fin1');

      expect(out.invoiceNumber).toBe('SI-2026-0001');
      expect(notifications.notifyUsersByRole).toHaveBeenCalledWith(
        Role.PURCHASING,
        expect.objectContaining({ type: 'SUPPLIER_INVOICE_UPLOADED' }),
      );
    });

    it('happy path PURCHASED', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'ord1',
        status: 'PURCHASED',
        supplierId: 's1',
        supplier: { id: 's1' },
        supplierInvoice: null,
      });
      prisma.supplierInvoice.findFirst.mockResolvedValue(null);
      prisma.supplierInvoice.create.mockResolvedValue({
        id: 'i2',
        invoiceNumber: 'SI-2026-0002',
        orderId: 'ord1',
      });

      await service.upload(dtoBase, 'fin1');
      expect(prisma.supplierInvoice.create).toHaveBeenCalled();
    });

    it('wrong status → 400', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'o',
        status: 'DRAFT',
        supplierId: 's',
        supplier: {},
        supplierInvoice: null,
      });
      await expect(service.upload(dtoBase, 'f')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('no supplier → 400', async () => {
      prisma.order.findUnique.mockResolvedValue({
        status: 'PENDING_PAYMENT_RECEIPT',
        supplierId: null,
        supplier: null,
        supplierInvoice: null,
      });
      await expect(service.upload(dtoBase, 'f')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('existing supplierInvoice → 400', async () => {
      prisma.order.findUnique.mockResolvedValue({
        status: 'PENDING_PAYMENT_RECEIPT',
        supplierId: 's',
        supplier: {},
        supplierInvoice: { invoiceNumber: 'SI-1' },
      });
      await expect(service.upload(dtoBase, 'f')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('TERMIN tanpa paymentDueDate → Zod gagal', () => {
      const r = UploadInvoiceDto.safeParse({
        ...dtoBase,
        paymentMethod: 'TERMIN',
      });
      expect(r.success).toBe(false);
    });

    it('CBD tanpa paymentDueDate → ok', () => {
      const r = UploadInvoiceDto.safeParse(dtoBase);
      expect(r.success).toBe(true);
    });

    it('order tidak ada → 404', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.upload(dtoBase, 'f')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('DRAFT → success', async () => {
      prisma.supplierInvoice.findUnique.mockResolvedValue({
        id: 'i1',
        status: 'DRAFT',
      });
      prisma.supplierInvoice.update.mockResolvedValue({ id: 'i1', status: 'DRAFT' });

      await service.update('i1', { invoiceAmount: 500 }, 'f');
      expect(prisma.supplierInvoice.update).toHaveBeenCalled();
    });

    it('REJECTED_BY_SUPPLIER → DRAFT + clear reason', async () => {
      prisma.supplierInvoice.findUnique.mockResolvedValue({
        id: 'i1',
        status: 'REJECTED_BY_SUPPLIER',
        supplierRejectionReason: 'x',
      });
      prisma.supplierInvoice.update.mockResolvedValue({ id: 'i1', status: 'DRAFT' });

      await service.update('i1', {}, 'f');
      expect(prisma.supplierInvoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'DRAFT', supplierRejectionReason: null }),
        }),
      );
    });

    it('SENT_TO_SUPPLIER → 400', async () => {
      prisma.supplierInvoice.findUnique.mockResolvedValue({ id: 'i1', status: 'SENT_TO_SUPPLIER' });
      await expect(service.update('i1', {}, 'f')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('APPROVED_BY_SUPPLIER → 400', async () => {
      prisma.supplierInvoice.findUnique.mockResolvedValue({
        id: 'i1',
        status: 'APPROVED_BY_SUPPLIER',
      });
      await expect(service.update('i1', {}, 'f')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('sendToSupplier', () => {
    const inv = {
      id: 'i1',
      status: 'DRAFT',
      invoiceNumber: 'SI-1',
      invoiceFileUrl: 'http://localhost:3001/api/files/a.pdf',
      invoiceAmount: new Prisma.Decimal(100),
      paymentMethod: 'CBD',
      paymentDueDate: null,
      supplier: { name: 'V', email: 'v@v.com' },
      order: { orderNumber: 'ORD-9', supplier: true },
    };

    it('DRAFT → SENT, email terkirim', async () => {
      prisma.supplierInvoice.findUnique.mockResolvedValue(inv);
      storage.downloadBuffer.mockReturnValue(Buffer.from('%PDF'));
      mail.sendEmail.mockResolvedValue({ messageId: 'm' });
      prisma.supplierInvoice.update.mockResolvedValue({ ...inv, status: 'SENT_TO_SUPPLIER' });

      await service.sendToSupplier('i1', 'f');
      expect(mail.sendEmail).toHaveBeenCalled();
      expect(prisma.supplierInvoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'SENT_TO_SUPPLIER' }) }),
      );
    });

    it('wrong status → 400', async () => {
      prisma.supplierInvoice.findUnique.mockResolvedValue({ ...inv, status: 'APPROVED_BY_SUPPLIER' });
      await expect(service.sendToSupplier('i1', 'f')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('supplier email null → 400', async () => {
      prisma.supplierInvoice.findUnique.mockResolvedValue({
        ...inv,
        supplier: { name: 'X', email: null },
      });
      await expect(service.sendToSupplier('i1', 'f')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('storage download gagal → email tanpa lampiran', async () => {
      prisma.supplierInvoice.findUnique.mockResolvedValue(inv);
      storage.downloadBuffer.mockImplementation(() => {
        throw new BadRequestException('fail');
      });
      mail.sendEmail.mockResolvedValue({});
      prisma.supplierInvoice.update.mockResolvedValue({});

      await service.sendToSupplier('i1', 'f');
      expect(mail.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ attachments: undefined }),
      );
    });
  });

  describe('markSupplierAck', () => {
    it('SENT → APPROVED_BY_SUPPLIER', async () => {
      prisma.supplierInvoice.findUnique.mockResolvedValue({ id: 'i1', status: 'SENT_TO_SUPPLIER' });
      prisma.supplierInvoice.update.mockResolvedValue({
        id: 'i1',
        status: 'APPROVED_BY_SUPPLIER',
        invoiceNumber: 'SI-1',
      });

      await service.markSupplierAck('i1', {}, 'fin1');

      expect(prisma.supplierInvoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'APPROVED_BY_SUPPLIER',
            approvedById: 'fin1',
          }),
        }),
      );
      expect(notifications.createForRoles).toHaveBeenCalledWith(
        [Role.PURCHASING, Role.FINANCE],
        expect.objectContaining({ type: 'SUPPLIER_INVOICE_ACK' }),
      );
    });

    it('wrong status → 400', async () => {
      prisma.supplierInvoice.findUnique.mockResolvedValue({ id: 'i1', status: 'DRAFT' });
      await expect(service.markSupplierAck('i1', {}, 'f')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('markSupplierReject', () => {
    it('SENT → REJECTED + reason', async () => {
      prisma.supplierInvoice.findUnique.mockResolvedValue({ id: 'i1', status: 'SENT_TO_SUPPLIER' });
      prisma.supplierInvoice.update.mockResolvedValue({
        id: 'i1',
        status: 'REJECTED_BY_SUPPLIER',
        invoiceNumber: 'SI-1',
      });

      await service.markSupplierReject('i1', { reason: 'salah nominal' }, 'fin1');

      expect(notifications.notifyUsersByRole).toHaveBeenCalledWith(
        Role.FINANCE,
        expect.objectContaining({ type: 'SUPPLIER_INVOICE_REJECTED' }),
      );
    });

    it('wrong status → 400', async () => {
      prisma.supplierInvoice.findUnique.mockResolvedValue({ id: 'i1', status: 'DRAFT' });
      await expect(service.markSupplierReject('i1', { reason: 'x' }, 'f')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('findAll', () => {
    it('filter status + pagination shape', async () => {
      prisma.supplierInvoice.findMany.mockResolvedValue([{ id: '1' }]);
      prisma.supplierInvoice.count.mockResolvedValue(1);
      const r = await service.findAll({
        page: 1,
        limit: 20,
        status: 'DRAFT',
        paymentMethod: 'all',
      });
      expect(r.data).toHaveLength(1);
      expect(r.meta.total).toBe(1);
      expect(prisma.supplierInvoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'DRAFT' }) }),
      );
    });

    it('filter paymentMethod', async () => {
      prisma.supplierInvoice.findMany.mockResolvedValue([]);
      prisma.supplierInvoice.count.mockResolvedValue(0);
      await service.findAll({
        page: 1,
        limit: 10,
        status: 'all',
        paymentMethod: 'TERMIN',
      });
      expect(prisma.supplierInvoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ paymentMethod: 'TERMIN' }) }),
      );
    });
  });
});
