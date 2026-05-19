// CommonJS — hindari default import di Jest/TS
const PDFDocument = require('pdfkit');

import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ProcurementMailService } from '../procurement-mail/procurement-mail.service';

export interface GeneratePoResult {
  poNumber: string;
  fileUrl: string;
  generatedAt: Date;
}

export interface SendPoResult {
  messageId: string;
  sentAt: Date;
  recipientEmail: string;
}

type OrderEmailContext = {
  orderNumber: string;
  orderTrigger: string;
  totalAmount: Prisma.Decimal | null;
  poNumber: string | null;
  supplier: { name: string } | null;
};

@Injectable()
export class PoGenerationService {
  private readonly logger = new Logger(PoGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly mail: ProcurementMailService,
  ) {}

  async generatePoNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const lastOrder = await this.prisma.order.findFirst({
      where: {
        poNumber: { startsWith: `PO-${year}-` },
      },
      orderBy: { poNumber: 'desc' },
      select: { poNumber: true },
    });

    const lastSeq = lastOrder?.poNumber ? parseInt(lastOrder.poNumber.split('-')[2] || '0', 10) : 0;
    const newSeq = (lastSeq + 1).toString().padStart(4, '0');
    return `PO-${year}-${newSeq}`;
  }

  async buildPoPdf(orderId: string, manualSignatureUrl?: string): Promise<{ pdfBuffer: Buffer; poNumber: string }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { stockItem: true } },
        supplier: true,
        creator: { select: { id: true, name: true, email: true } },
      },
    });

    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    if (!order.supplier) {
      throw new BadRequestException('Order belum memiliki supplier — Purchasing belum submit price');
    }

    if (order.status !== 'PENDING_PAYMENT_RECEIPT' && order.status !== 'PURCHASED') {
      throw new BadRequestException('Order belum siap untuk PO generation');
    }

    // FIX BUG 2: Validate that GM signature exists (either manual or from profile) before generating PO
    if (!manualSignatureUrl && order.gmApprovedBy) {
      const gm = await this.prisma.user.findUnique({
        where: { id: order.gmApprovedBy },
        select: { signatureUrl: true, name: true },
      });
      if (!gm?.signatureUrl) {
        throw new BadRequestException(
          'Tanda tangan belum tersedia pada profile user. Silakan upload tanda tangan di menu Profile terlebih dahulu.'
        );
      }
    }

    const poNumber = order.poNumber ?? (await this.generatePoNumber());

    return new Promise<{ pdfBuffer: Buffer; poNumber: string }>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve({ pdfBuffer: Buffer.concat(chunks), poNumber }));
      doc.on('error', (err: Error) => reject(err));

      doc.fontSize(18).font('Helvetica-Bold').text('PURCHASE ORDER', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(12).font('Helvetica').text(`No. PO: ${poNumber}`, { align: 'center' });
      doc.text(
        `Tanggal: ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`,
        { align: 'center' },
      );
      doc.moveDown(1);

      doc.fontSize(11).font('Helvetica-Bold').text('Kepada:');
      doc.font('Helvetica').text(order.supplier.name);
      if (order.supplier.address) doc.text(order.supplier.address);
      if (order.supplier.phone) doc.text(`Telp: ${order.supplier.phone}`);
      if (order.supplier.npwp) doc.text(`NPWP: ${order.supplier.npwp}`);
      doc.moveDown(1);

      doc.font('Helvetica-Bold').text('Detail Order:');
      doc.font('Helvetica').text(`Nomor Order: ${order.orderNumber}`);
      doc.text(`Tipe: ${order.orderTrigger === 'STOCK_RESTOCK' ? 'Restock Gudang' : 'Project Request'}`);
      if (order.notes) doc.text(`Catatan: ${order.notes}`);
      doc.moveDown(1);

      doc.font('Helvetica-Bold').text('Daftar Barang:');
      doc.moveDown(0.3);

      const tableTop = doc.y;
      const itemX = 50;
      const qtyX = 280;
      const unitPriceX = 350;
      const totalX = 450;

      doc.font('Helvetica-Bold').fontSize(10);
      doc.text('Item', itemX, tableTop);
      doc.text('Qty', qtyX, tableTop);
      doc.text('Harga Satuan', unitPriceX, tableTop);
      doc.text('Total', totalX, tableTop);
      doc.moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).stroke();

      let y = tableTop + 25;
      doc.font('Helvetica').fontSize(10);

      let grandTotal = 0;
      order.items.forEach((item, idx) => {
        const itemName = item.stockItem?.name ?? item.itemName ?? `Item ${idx + 1}`;
        const unitPrice = Number(item.unitPrice ?? 0);
        const totalPrice = Number(item.totalPrice ?? unitPrice * item.requestedQty);
        grandTotal += totalPrice;

        doc.text(itemName, itemX, y, { width: 220 });
        doc.text(String(item.requestedQty), qtyX, y);
        doc.text(`Rp ${unitPrice.toLocaleString('id-ID')}`, unitPriceX, y);
        doc.text(`Rp ${totalPrice.toLocaleString('id-ID')}`, totalX, y);

        y += 20;
      });

      let ppnLabel = '';
      let ppnAmount = 0;
      if (order.ppnType === 'PERCENT' && order.ppnValue) {
        ppnAmount = (grandTotal * Number(order.ppnValue)) / 100;
        ppnLabel = `PPN (${order.ppnValue}%)`;
      } else if (order.ppnType === 'NOMINAL' && order.ppnValue) {
        ppnAmount = Number(order.ppnValue);
        ppnLabel = 'PPN (Nominal)';
      }

      doc.moveTo(50, y + 5).lineTo(545, y + 5).stroke();
      y += 15;
      doc.font('Helvetica-Bold').text('SUBTOTAL', unitPriceX, y);
      doc.text(`Rp ${grandTotal.toLocaleString('id-ID')}`, totalX, y);

      if (ppnAmount > 0) {
        y += 20;
        doc.font('Helvetica').text(ppnLabel, unitPriceX, y);
        doc.text(`Rp ${ppnAmount.toLocaleString('id-ID')}`, totalX, y);
      }

      y += 20;
      doc.font('Helvetica-Bold').text('TOTAL', unitPriceX, y);
      doc.text(`Rp ${(grandTotal + ppnAmount).toLocaleString('id-ID')}`, totalX, y);

      doc.moveDown(2);
      doc.fontSize(10).font('Helvetica');
      doc.text('Mohon konfirmasi penerimaan PO ini melalui email balasan.', { align: 'left' });
      doc.moveDown(0.5);
      doc.text('Hormat kami,', { align: 'left' });
      doc.moveDown(0.5);

      const renderSignatures = async () => {
        // Fetch both Purchasing (creator) and GM approver signatures
        const [purchasingUser, gmUser] = await Promise.all([
          // Issued By: Purchasing (order creator)
          order.creator?.id
            ? this.prisma.user.findUnique({
                where: { id: order.creator.id },
                select: { signatureUrl: true, name: true, role: true },
              })
            : null,
          // Approved By: GM
          order.gmApprovedBy
            ? this.prisma.user.findUnique({
                where: { id: order.gmApprovedBy },
                select: { signatureUrl: true, name: true, role: true },
              })
            : null,
        ]);

        const issuedBy = {
          signatureUrl: purchasingUser?.signatureUrl || null,
          name: purchasingUser?.name || order.creator?.name || 'Purchasing',
          role: purchasingUser?.role || 'PURCHASING',
        };

        const approvedBy = {
          signatureUrl: manualSignatureUrl || gmUser?.signatureUrl || null,
          name: gmUser?.name || 'General Manager',
          role: gmUser?.role || 'GENERAL_MANAGER',
        };

        // Layout: Two-column signature section
        const pageWidth = doc.page.width - 100; // 50 margin each side
        const sigBoxWidth = pageWidth / 2 - 20;
        const startY = doc.y;
        const leftCol = 50;
        const rightCol = 50 + sigBoxWidth + 40;

        // Helper to render a signature box
        const renderSigBox = async (colX: number, title: string, person: typeof issuedBy) => {
          // Title
          doc.fontSize(9).font('Helvetica').fillColor('#666666')
            .text(title, colX, startY, { width: sigBoxWidth, align: 'center' });

          // Signature image or placeholder
          const sigY = startY + 15;
          if (person.signatureUrl) {
            try {
              const sigBuffer = await this.storage.downloadBuffer(person.signatureUrl);
              doc.image(sigBuffer, colX + (sigBoxWidth - 80) / 2, sigY, { width: 80, height: 40 });
            } catch (e) {
              this.logger.error(`Gagal memuat signature: ${e instanceof Error ? e.message : e}`);
              // Draw placeholder line
              doc.moveTo(colX + 20, sigY + 20).lineTo(colX + sigBoxWidth - 20, sigY + 20).stroke('#999999');
            }
          } else {
            // Draw placeholder line
            doc.moveTo(colX + 20, sigY + 20).lineTo(colX + sigBoxWidth - 20, sigY + 20).stroke('#999999');
          }

          // Name and role
          doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000')
            .text(person.name, colX, sigY + 45, { width: sigBoxWidth, align: 'center' });
          doc.fontSize(8).font('Helvetica').fillColor('#666666')
            .text(person.role, colX, sigY + 58, { width: sigBoxWidth, align: 'center' });
        };

        await renderSigBox(leftCol, 'Diterbitkan Oleh,', issuedBy);
        await renderSigBox(rightCol, 'Disetujui Oleh,', approvedBy);

        doc.moveDown(6);
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000')
          .text('PT. PermaTrack', 50, doc.y, { align: 'left' });

        doc.end();
      };

      void renderSignatures();
    });
  }

  async generateAndStorePo(orderId: string, manualSignatureUrl?: string): Promise<GeneratePoResult> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    if (order.poNumber && order.poFileUrl) {
      return {
        poNumber: order.poNumber,
        fileUrl: order.poFileUrl,
        generatedAt: order.poGeneratedAt ?? new Date(),
      };
    }

    const { pdfBuffer, poNumber } = await this.buildPoPdf(orderId, manualSignatureUrl);
    const year = new Date().getFullYear();
    const key = `po/${year}/${poNumber}.pdf`;
    const fileUrl = await this.storage.uploadBuffer(pdfBuffer, key, 'application/pdf');
    const generatedAt = new Date();

    try {
      await this.prisma.order.update({
        where: { id: orderId },
        data: {
          poNumber,
          poFileUrl: fileUrl,
          poGeneratedAt: generatedAt,
        },
      });
    } catch (e: unknown) {
      this.logger.error(`Gagal menyimpan PO ke order ${orderId}: ${e instanceof Error ? e.message : e}`);
      await this.storage.deleteFile(fileUrl);
      throw e;
    }

    return { poNumber, fileUrl, generatedAt };
  }

  async sendPoEmail(orderId: string, sentByUserId: string): Promise<SendPoResult> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { supplier: true },
    });

    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    if (!order.poFileUrl || !order.poNumber) {
      throw new BadRequestException('PO belum di-generate. Tidak dapat dikirim.');
    }

    if (!order.supplier) {
      throw new BadRequestException('Supplier tidak ditemukan');
    }

    if (!order.supplier.email?.trim()) {
      throw new BadRequestException(
        `Supplier ${order.supplier.name} belum memiliki email. Update master supplier.`,
      );
    }

    const pdfBuffer = this.storage.downloadBuffer(order.poFileUrl);

    const result = await this.mail.sendEmail({
      to: order.supplier.email.trim(),
      subject: `Purchase Order ${order.poNumber} - PT PermaTrack`,
      text: this.buildEmailBody(order),
      observability: {
        event: 'purchase_order_send',
        orderId,
      },
      attachments: [
        {
          filename: `${order.poNumber}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    });

    const sentAt = new Date();

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        poEmailSentAt: sentAt,
        poEmailSentById: sentByUserId,
        poEmailMessageId: result.messageId,
      },
    });

    return {
      messageId: result.messageId,
      sentAt,
      recipientEmail: order.supplier.email.trim(),
    };
  }

  private buildEmailBody(order: OrderEmailContext): string {
    const total = Number(order.totalAmount ?? 0).toLocaleString('id-ID');
    return `
Yth. ${order.supplier?.name ?? ''},

Terlampir Purchase Order dengan nomor ${order.poNumber} untuk Order ${order.orderNumber}.

Mohon konfirmasi penerimaan PO ini melalui email balasan.

Detail Order:
- Nomor PO: ${order.poNumber}
- Nomor Order: ${order.orderNumber}
- Tipe: ${order.orderTrigger === 'STOCK_RESTOCK' ? 'Restock Gudang' : 'Project Request'}
- Total: Rp ${total}

Detail rincian barang dapat dilihat pada lampiran PDF.

Terima kasih atas kerja sama Anda.

Hormat kami,
PT PermaTrack
    `.trim();
  }
}
