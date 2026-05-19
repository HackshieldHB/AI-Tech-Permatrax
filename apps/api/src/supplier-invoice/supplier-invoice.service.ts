import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProcurementMailService } from '../procurement-mail/procurement-mail.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { runSerializableTransaction } from '../budget-ledger/transaction-retry.util';
import { paginate, PaginatedResponse } from '../common/dto/pagination.dto';
import type {
  UploadInvoiceDtoType,
  UpdateInvoiceDtoType,
  SupplierAckDtoType,
  SupplierRejectDtoType,
  FilterInvoiceDtoType,
} from './supplier-invoice.dto';

type InvoiceDb = Prisma.TransactionClient | PrismaService;

type InvoiceForEmail = Prisma.SupplierInvoiceGetPayload<{
  include: {
    supplier: true;
    order: { include: { supplier: true } };
  };
}>;

export type SupplierInvoiceDetail = Prisma.SupplierInvoiceGetPayload<{
  include: {
    order: { include: { supplier: true } };
    supplier: true;
    uploadedBy: { select: { id: true; name: true } };
    approvedBy: { select: { id: true; name: true } };
  };
}>;

@Injectable()
export class SupplierInvoiceService {
  private readonly logger = new Logger(SupplierInvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: ProcurementMailService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly gateway: NotificationsGateway,
  ) {}

  /** Nomor tagihan SI-YYYY-NNNN (sequential per tahun). */
  async generateInvoiceNumber(): Promise<string> {
    return this.allocateInvoiceNumber(this.prisma);
  }

  private async allocateInvoiceNumber(db: InvoiceDb): Promise<string> {
    const year = new Date().getFullYear();
    const last = await db.supplierInvoice.findFirst({
      where: { invoiceNumber: { startsWith: `SI-${year}-` } },
      orderBy: { invoiceNumber: 'desc' },
      select: { invoiceNumber: true },
    });

    const lastSeq = last?.invoiceNumber ? parseInt(last.invoiceNumber.split('-')[2] || '0', 10) : 0;
    const newSeq = (lastSeq + 1).toString().padStart(4, '0');
    return `SI-${year}-${newSeq}`;
  }

  async upload(dto: UploadInvoiceDtoType, financeUserId: string) {
    const created = await runSerializableTransaction(this.prisma, async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: dto.orderId },
        include: { supplier: true, supplierInvoice: true },
      });

      if (!order) {
        throw new NotFoundException('Order tidak ditemukan');
      }

      const eligibleStatuses = ['PENDING_PAYMENT_RECEIPT', 'PURCHASED'] as const;
      if (!eligibleStatuses.includes(order.status as (typeof eligibleStatuses)[number])) {
        throw new BadRequestException(`Order belum siap untuk upload tagihan (status: ${order.status})`);
      }

      if (!order.supplier || !order.supplierId) {
        throw new BadRequestException('Order belum memiliki supplier');
      }

      if (order.supplierInvoice) {
        throw new BadRequestException(
          `Order sudah memiliki tagihan ${order.supplierInvoice.invoiceNumber}. Perbarui tagihan yang ada.`,
        );
      }

      if (dto.paymentMethod === 'TERMIN' && !dto.paymentDueDate) {
        throw new BadRequestException('Tanggal jatuh tempo wajib untuk TERMIN');
      }

      const invoiceNumber = await this.allocateInvoiceNumber(tx);

      return tx.supplierInvoice.create({
        data: {
          invoiceNumber,
          orderId: dto.orderId,
          supplierId: order.supplierId,
          invoiceFileUrl: dto.invoiceFileUrl,
          invoiceAmount: new Prisma.Decimal(dto.invoiceAmount),
          paymentMethod: dto.paymentMethod,
          paymentDueDate: dto.paymentDueDate ? new Date(dto.paymentDueDate) : null,
          status: 'DRAFT',
          uploadedById: financeUserId,
        },
      });
    });

    await this.notifications.notifyUsersByRole(Role.PURCHASING, {
      title: 'Tagihan Order Diupload',
      message: `Tagihan ${created.invoiceNumber} untuk order siap dikirim ke supplier.`,
      type: 'SUPPLIER_INVOICE_UPLOADED',
      link: `/supplier-invoices/${created.id}`,
      entityId: created.id,
    });
    this.gateway.emitToRoom(`role:${Role.PURCHASING}`, 'supplierInvoice:uploaded', {
      invoiceId: created.id,
      invoiceNumber: created.invoiceNumber,
      orderId: created.orderId,
    });

    return created;
  }

  async update(_id: string, dto: UpdateInvoiceDtoType, _financeUserId: string) {
    const invoice = await this.prisma.supplierInvoice.findUnique({ where: { id: _id } });
    if (!invoice) {
      throw new NotFoundException('Tagihan tidak ditemukan');
    }

    const editableStatuses = ['DRAFT', 'REJECTED_BY_SUPPLIER'] as const;
    if (!editableStatuses.includes(invoice.status as (typeof editableStatuses)[number])) {
      throw new BadRequestException(`Tagihan dengan status ${invoice.status} tidak dapat diedit`);
    }

    const newStatus = invoice.status === 'REJECTED_BY_SUPPLIER' ? 'DRAFT' : invoice.status;

    const data: Prisma.SupplierInvoiceUpdateInput = {
      status: newStatus,
    };

    if (dto.invoiceFileUrl !== undefined) {
      data.invoiceFileUrl = dto.invoiceFileUrl;
    }
    if (dto.invoiceAmount !== undefined) {
      data.invoiceAmount = new Prisma.Decimal(dto.invoiceAmount);
    }
    if (dto.paymentMethod !== undefined) {
      data.paymentMethod = dto.paymentMethod;
    }
    if (dto.paymentDueDate !== undefined) {
      data.paymentDueDate =
        dto.paymentDueDate === null ? null : new Date(dto.paymentDueDate);
    }

    if (newStatus === 'DRAFT') {
      data.supplierRejectionReason = null;
    }

    return this.prisma.supplierInvoice.update({
      where: { id: _id },
      data,
    });
  }

  async sendToSupplier(id: string, _financeUserId: string) {
    const invoice = await this.prisma.supplierInvoice.findUnique({
      where: { id },
      include: {
        order: { include: { supplier: true } },
        supplier: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException('Tagihan tidak ditemukan');
    }

    if (invoice.status !== 'DRAFT') {
      throw new BadRequestException(`Tagihan tidak dalam status DRAFT (current: ${invoice.status})`);
    }

    if (!(invoice.supplier.email?.trim())) {
      throw new BadRequestException(
        `Supplier ${invoice.supplier.name} belum memiliki email. Update master supplier.`,
      );
    }

    let invoiceFileBuffer: Buffer | null = null;
    if (invoice.invoiceFileUrl) {
      try {
        invoiceFileBuffer = this.storage.downloadBuffer(invoice.invoiceFileUrl);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Gagal mengunduh file tagihan ${invoice.invoiceFileUrl}: ${msg}`);
      }
    }

    const orderNumber = invoice.order?.orderNumber ?? '';

    await this.mail.sendEmail({
      to: invoice.supplier.email.trim(),
      subject: `Tagihan ${invoice.invoiceNumber} untuk Order ${orderNumber} - PT PermaTrack`,
      text: this.buildEmailBody(invoice),
      observability: {
        event: 'supplier_invoice_send',
        invoiceId: id,
        orderId: invoice.orderId ?? undefined,
      },
      attachments: invoiceFileBuffer
        ? [
            {
              filename: `${invoice.invoiceNumber}.pdf`,
              content: invoiceFileBuffer,
              contentType: 'application/pdf',
            },
          ]
        : undefined,
    });

    return this.prisma.supplierInvoice.update({
      where: { id },
      data: {
        status: 'SENT_TO_SUPPLIER',
        emailSentAt: new Date(),
      },
    });
  }

  async markSupplierAck(id: string, _dto: SupplierAckDtoType, financeUserId: string) {
    const invoice = await this.prisma.supplierInvoice.findUnique({ where: { id } });
    if (!invoice) {
      throw new NotFoundException('Tagihan tidak ditemukan');
    }

    if (invoice.status !== 'SENT_TO_SUPPLIER') {
      throw new BadRequestException(`Tagihan tidak dalam status SENT_TO_SUPPLIER (current: ${invoice.status})`);
    }

    const updated = await this.prisma.supplierInvoice.update({
      where: { id },
      data: {
        status: 'APPROVED_BY_SUPPLIER',
        supplierAckAt: new Date(),
        approvedById: financeUserId,
        approvedAt: new Date(),
      },
    });

    const payload = {
      title: 'Supplier Setujui Tagihan',
      message: `Tagihan ${updated.invoiceNumber} disetujui supplier.`,
      type: 'SUPPLIER_INVOICE_ACK',
      link: `/supplier-invoices/${updated.id}`,
      entityId: updated.id,
    };
    await this.notifications.createForRoles([Role.PURCHASING, Role.FINANCE], payload);

    this.gateway.emitToRoom(`role:${Role.PURCHASING}`, 'supplierInvoice:supplierAck', {
      invoiceId: updated.id,
      invoiceNumber: updated.invoiceNumber,
    });
    this.gateway.emitToRoom(`role:${Role.FINANCE}`, 'supplierInvoice:supplierAck', {
      invoiceId: updated.id,
      invoiceNumber: updated.invoiceNumber,
    });

    return updated;
  }

  async markSupplierReject(id: string, dto: SupplierRejectDtoType, _financeUserId: string) {
    const invoice = await this.prisma.supplierInvoice.findUnique({ where: { id } });
    if (!invoice) {
      throw new NotFoundException('Tagihan tidak ditemukan');
    }

    if (invoice.status !== 'SENT_TO_SUPPLIER') {
      throw new BadRequestException(`Tagihan tidak dalam status SENT_TO_SUPPLIER (current: ${invoice.status})`);
    }

    const updated = await this.prisma.supplierInvoice.update({
      where: { id },
      data: {
        status: 'REJECTED_BY_SUPPLIER',
        supplierRejectionReason: dto.reason,
      },
    });

    await this.notifications.notifyUsersByRole(Role.FINANCE, {
      title: 'Supplier Tolak Tagihan',
      message: `Tagihan ${updated.invoiceNumber} ditolak supplier: ${dto.reason}`,
      type: 'SUPPLIER_INVOICE_REJECTED',
      link: `/supplier-invoices/${updated.id}`,
      entityId: updated.id,
    });
    this.gateway.emitToRoom(`role:${Role.FINANCE}`, 'supplierInvoice:supplierReject', {
      invoiceId: updated.id,
      invoiceNumber: updated.invoiceNumber,
      reason: dto.reason,
    });

    return updated;
  }

  async findAll(filter: FilterInvoiceDtoType): Promise<PaginatedResponse<unknown>> {
    const where: Prisma.SupplierInvoiceWhereInput = {};

    if (filter.status && filter.status !== 'all') {
      where.status = filter.status;
    }
    if (filter.paymentMethod && filter.paymentMethod !== 'all') {
      where.paymentMethod = filter.paymentMethod;
    }

    const [data, total] = await Promise.all([
      this.prisma.supplierInvoice.findMany({
        where,
        include: {
          order: { select: { id: true, orderNumber: true, totalAmount: true } },
          supplier: { select: { id: true, name: true, code: true } },
          uploadedBy: { select: { id: true, name: true } },
        },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.supplierInvoice.count({ where }),
    ]);

    return paginate(data, total, filter.page, filter.limit);
  }

  async findOne(id: string): Promise<SupplierInvoiceDetail> {
    const row = await this.prisma.supplierInvoice.findUnique({
      where: { id },
      include: {
        order: { include: { supplier: true } },
        supplier: true,
        uploadedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });
    if (!row) {
      throw new NotFoundException('Tagihan tidak ditemukan');
    }
    return row;
  }

  private buildEmailBody(invoice: InvoiceForEmail): string {
    const paymentMethodText: Record<string, string> = {
      CBD: 'Cash Before Delivery (Pembayaran sebelum pengiriman)',
      COD: 'Cash On Delivery (Pembayaran saat pengiriman)',
      TERMIN: `Termin (Jatuh tempo: ${
        invoice.paymentDueDate
          ? new Date(invoice.paymentDueDate).toLocaleDateString('id-ID')
          : '—'
      })`,
    };

    const methodLabel =
      paymentMethodText[invoice.paymentMethod] ?? String(invoice.paymentMethod);

    return [
      `Yth. ${invoice.supplier.name},`,
      '',
      `Terlampir Tagihan dengan nomor ${invoice.invoiceNumber} untuk Order ${invoice.order.orderNumber}.`,
      '',
      '',
      'Detail Tagihan:',
      `- Nomor Tagihan: ${invoice.invoiceNumber}`,
      `- Nomor Order: ${invoice.order.orderNumber}`,
      `- Nominal: Rp ${Number(invoice.invoiceAmount).toLocaleString('id-ID')}`,
      `- Metode Pembayaran: ${methodLabel}`,
      '',
      '',
      'Mohon konfirmasi penerimaan tagihan ini melalui email balasan.',
      '',
      '',
      'Hormat kami,',
      'PT PermaTrack',
    ].join('\n');
  }
}
