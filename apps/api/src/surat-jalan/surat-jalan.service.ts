import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma, SuratJalanStatus } from '@prisma/client';
import type { Response } from 'express'; // FIX: stream PDF without static /api/files CORS
import * as path from 'path'; // FIX: resolve absolute path for sendFile
import { PrismaService } from '../prisma/prisma.service';
import { paginate, PaginatedResponse } from '../common/dto/pagination.dto';
import { SuratJalanFilterDtoType } from './surat-jalan.dto';
import { StorageService } from '../storage/storage.service';
import { StockService } from '../stock/stock.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');
import { ConfirmReceiptDtoType } from '../order/order.dto';

// NEW: SuratJalanService — auto-generates OUT/IN delivery documents
@Injectable()
export class SuratJalanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly stockService: StockService,
    private readonly gateway: NotificationsGateway,
  ) {}

  // NEW: Generate Surat Jalan OUT (barang keluar untuk order)
  // Called automatically by OrderService when stock is available
  async generateSuratJalanOut(orderId: string, generatedBy: string) {
    const order = await this.prisma.order.findUnique({
      where:   { id: orderId },
      include: {
        items:   { include: { stockItem: true } },
        creator: { select: { id: true, name: true, role: true } },
      },
    });
    if (!order) throw new NotFoundException('Order tidak ditemukan');

    const year = new Date().getFullYear();
    const countThisYear = await this.prisma.suratJalan.count({
      where: { type: 'OUT', createdAt: { gte: new Date(`${year}-01-01`) } },
    });
    const seq            = String(countThisYear + 1).padStart(4, '0');
    const documentNumber = `SJ-OUT-${year}-${seq}`;

    // NEW: Create SuratJalan DB record first (pdfUrl updated after upload)
    const sj = await this.prisma.suratJalan.create({
      data: {
        documentNumber,
        type:        'OUT',
        generatedBy,
        status:      'GENERATED',
        notes:       order.notes ?? null,
      },
    });

    // NEW: Build and upload PDF
    const pdfBuffer = await this.buildSuratJalanPdf({
      documentNumber,
      type:        'OUT',
      date:        new Date(),
      fromTo:      `${order.creator?.name ?? '-'} / ${order.fiberType}`,
      projectRef:  order.projectRef ?? '-',
      items:       order.items.filter((i) => i.fulfilledQty > 0 || i.availableQty >= i.requestedQty),
      notes:       order.notes ?? '',
      generatorName: order.creator?.name ?? '-',
      generatorRole: order.creator?.role ?? '-',
    });

    const s3Key = `surat-jalan/${year}/${documentNumber}.pdf`;
    const pdfUrl = await this.storage.uploadBuffer(s3Key, pdfBuffer, 'application/pdf');

    // NEW: Update record with S3 URL
    const updated = await this.prisma.suratJalan.update({
      where: { id: sj.id },
      data:  { pdfUrl },
    });

    return updated;
  }

  // NEW: Generate Surat Jalan IN (barang masuk dari supplier)
  // Called when Finance marks PurchaseRequest as RECEIVED
  async generateSuratJalanIn(purchaseRequestId: string, actorId: string) {
    const pr = await this.prisma.purchaseRequest.findUnique({
      where:   { id: purchaseRequestId },
      include: {
        items:     true,
        requester: { select: { name: true, role: true } },
        processor: { select: { name: true } },
      },
    });
    if (!pr) throw new NotFoundException('Purchase request tidak ditemukan');

    const year = new Date().getFullYear();
    const countThisYear = await this.prisma.suratJalan.count({
      where: { type: 'IN', createdAt: { gte: new Date(`${year}-01-01`) } },
    });
    const seq            = String(countThisYear + 1).padStart(4, '0');
    const documentNumber = `SJ-IN-${year}-${seq}`;

    const sj = await this.prisma.suratJalan.create({
      data: {
        documentNumber,
        type:        'IN',
        generatedBy: actorId,
        status:      'GENERATED',
      },
    });

    const pdfBuffer = await this.buildSuratJalanPdf({
      documentNumber,
      type:        'IN',
      date:        new Date(),
      fromTo:      'Gudang Pusat (dari Supplier)',
      projectRef:  `PR: ${pr.requestNumber}`,
      items:       pr.items.map((i) => ({ ...i, fulfilledQty: i.requestedQty, requestedQty: i.requestedQty })),
      notes:       pr.financeNotes ?? '',
      generatorName: pr.processor?.name ?? '-',
      generatorRole: 'Finance',
    });

    const s3Key  = `surat-jalan/${year}/${documentNumber}.pdf`;
    const pdfUrl = await this.storage.uploadBuffer(s3Key, pdfBuffer, 'application/pdf');

    const updated = await this.prisma.suratJalan.update({
      where: { id: sj.id },
      data:  { pdfUrl },
    });

    return updated;
  }

  /**
   * OUT SJ: confirms barang diterima di lapangan — stok sudah dikurangi saat submit; tidak menambah stok gudang.
   * IN SJ: hanya menandai dokumen; penambahan stok dari pembelian dilakukan saat Finance menandai PR RECEIVED.
   */
  async confirmReceipt(dto: ConfirmReceiptDtoType, adminId: string) {
    const sj = await this.prisma.suratJalan.findUnique({ where: { id: dto.suratJalanId } });
    if (!sj) throw new NotFoundException('Surat Jalan tidak ditemukan');
    if (sj.status === 'CONFIRMED') throw new ConflictException('Surat Jalan sudah dikonfirmasi');

    if (sj.type === 'OUT') {
      const order = await this.prisma.order.findFirst({ where: { suratJalanId: sj.id } });
      const confirmed = await this.prisma.suratJalan.update({
        where: { id: sj.id },
        data:  {
          status:      'CONFIRMED',
          confirmedBy: adminId,
          confirmedAt: new Date(),
          notes:       dto.notes ?? sj.notes,
        },
      });
      if (order) {
        await this.prisma.order.update({
          where: { id: order.id },
          data:  { status: 'FULFILLED' },
        });
      }
      const n = dto.items.filter((i) => i.receivedQty > 0).length;
      this.gateway.emitToRoom('role:ADMIN_STOCK', 'stock:received', {
        suratJalanId: sj.id, documentNumber: sj.documentNumber, itemsReceived: n,
      });
      if (order) {
        this.gateway.emitToRoom(`user:${order.createdBy}`, 'stock:received', {
          suratJalanId: sj.id, documentNumber: sj.documentNumber, itemsReceived: n,
        });
      }
      return confirmed;
    }

    // IN — konfirmasi administratif (stok dari PR sudah di RECEIVED)
    const confirmed = await this.prisma.suratJalan.update({
      where: { id: sj.id },
      data:  {
        status: 'CONFIRMED', confirmedBy: adminId, confirmedAt: new Date(), notes: dto.notes ?? sj.notes,
      },
    });
    return confirmed;
  }

  // MODIFIED: paginated list + date/search filters
  async findAll(filters: SuratJalanFilterDtoType): Promise<PaginatedResponse<unknown>> {
    const { type, status, page, limit, dateFrom, dateTo, search, sortBy, sortOrder } = filters;
    const skip  = (page - 1) * limit;
    const where: Prisma.SuratJalanWhereInput = {};
    if (type)   where.type   = type;
    if (status) where.status = status as SuratJalanStatus;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo)   where.createdAt.lte = new Date(dateTo);
    }
    if (search?.trim()) {
      where.documentNumber = { contains: search.trim(), mode: 'insensitive' };
    }

    const orderField = sortBy && ['createdAt', 'documentNumber'].includes(sortBy) ? sortBy : 'createdAt';
    const orderBy = { [orderField]: sortOrder } as Prisma.SuratJalanOrderByWithRelationInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.suratJalan.findMany({
        where,
        skip,
        take:    limit,
        orderBy,
        include: {
          order:     { select: { orderNumber: true, fiberType: true, creator: { select: { name: true } } } },
          generator: { select: { id: true, name: true } },
          confirmer: { select: { id: true, name: true } },
        },
      }),
      this.prisma.suratJalan.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  /** FIX: SuratJalan di Order pakai relasi Order.suratJalanId, bukan field orderId di SJ */
  async findSuratJalanIdByOrderId(orderId: string): Promise<string | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { suratJalanId: true },
    });
    return order?.suratJalanId ?? null; // FIX
  }

  /** FIX: Kirim PDF sebagai attachment — sama-origin fetch + blob di frontend */
  async streamPdfFileToResponse(sjId: string, res: Response): Promise<void> {
    await this.ensureDownloadablePdfUrl(sjId); // FIX: regenerate OUT jika perlu
    const sj = await this.prisma.suratJalan.findUnique({ where: { id: sjId } });
    if (!sj?.pdfUrl) throw new NotFoundException('PDF belum tersedia'); // FIX
    const key = this.storage.extractKeyFromUploadedUrl(sj.pdfUrl);
    if (!key || !this.storage.fileExists(key)) {
      throw new NotFoundException('File PDF tidak ada di disk'); // FIX
    }
    const abs = path.resolve(this.storage.absolutePathForKey(key)); // FIX
    const fname = sj.documentNumber.replace(/\//g, '-'); // FIX
    res.setHeader('Content-Type', 'application/pdf'); // FIX
    res.setHeader('Content-Disposition', `attachment; filename="SJ-${fname}.pdf"`); // FIX
    await new Promise<void>((resolve, reject) => {
      res.sendFile(abs, (err) => (err ? reject(err) : resolve())); // FIX
    });
  }

  // NEW: Single SJ with full relations
  async findOne(id: string) {
    const sj = await this.prisma.suratJalan.findUnique({
      where:   { id },
      include: {
        order:     { include: { items: true, creator: { select: { id: true, name: true } } } },
        generator: { select: { id: true, name: true, role: true } },
        confirmer: { select: { id: true, name: true } },
      },
    });
    if (!sj) throw new NotFoundException('Surat Jalan tidak ditemukan');
    return sj;
  }

  /** FIX: Pastikan file PDF ada di disk; regenerate SJ OUT dari Order jika hilang. */
  async ensureDownloadablePdfUrl(id: string): Promise<string> {
    const sj = await this.prisma.suratJalan.findUnique({
      where:   { id },
      include: {
        order: {
          include: {
            items:   { include: { stockItem: true } },
            creator: { select: { id: true, name: true, role: true } },
          },
        },
      },
    });
    if (!sj) throw new NotFoundException('Surat jalan tidak ditemukan');

    const keyFromDb = sj.pdfUrl ? this.storage.extractKeyFromUploadedUrl(sj.pdfUrl) : null; // FIX: parse storage key
    if (keyFromDb && this.storage.fileExists(keyFromDb)) { // FIX: fast path — file already on disk
      return this.storage.generatePresignedGetUrl(keyFromDb);
    }

    if (sj.type === 'OUT' && sj.order) { // FIX: rebuild PDF from linked order
      const order = sj.order;
      const pdfBuffer = await this.buildSuratJalanPdf({
        documentNumber: sj.documentNumber,
        type:           'OUT',
        date:           sj.createdAt,
        fromTo:         `${order.creator?.name ?? '-'} / ${order.fiberType}`,
        projectRef:     order.projectRef ?? '-',
        items:          order.items.filter((i) => i.fulfilledQty > 0 || i.availableQty >= i.requestedQty),
        notes:          order.notes ?? '',
        generatorName:  order.creator?.name ?? '-',
        generatorRole:  order.creator?.role ?? '-',
      });
      const year   = this.yearFromSjNumber(sj.documentNumber); // FIX: folder year matches SJ number
      const s3Key  = `surat-jalan/${year}/${sj.documentNumber}.pdf`; // FIX: same key shape as generateSuratJalanOut
      const pdfUrl = await this.storage.uploadBuffer(s3Key, pdfBuffer, 'application/pdf'); // FIX: write uploads/surat-jalan/...
      await this.prisma.suratJalan.update({ where: { id }, data: { pdfUrl } }); // FIX: persist URL for next download
      return pdfUrl;
    }

    throw new NotFoundException('PDF belum tersedia'); // FIX: IN / orphan SJ — tidak bisa auto-regenerate di sini
  }

  private yearFromSjNumber(documentNumber: string): number { // FIX: derive tahun dari nomor SJ-OUT-YYYY-####
    const m = documentNumber.match(/SJ-(?:OUT|IN)-(\d{4})-/);
    return m ? parseInt(m[1], 10) : new Date().getFullYear();
  }

  // NEW: PDF download — delegate to ensure (regenerates OUT when file missing)
  async getDownloadUrl(id: string) {
    const pdfUrl = await this.ensureDownloadablePdfUrl(id); // FIX: never return dead links
    const key    = this.storage.extractKeyFromUploadedUrl(pdfUrl);
    if (key) {
      const presignedUrl = await this.storage.generatePresignedGetUrl(key); // FIX: local files → stable /api/files URL
      return { pdfUrl: presignedUrl, publicUrl: pdfUrl };
    }
    return { pdfUrl };
  }

  // NEW: Build Surat Jalan PDF using PDFKit — same pattern as BaOpenService
  private async buildSuratJalanPdf(params: {
    documentNumber: string;
    type:           'OUT' | 'IN';
    date:           Date;
    fromTo:         string;
    projectRef:     string;
    items:          any[];
    notes:          string;
    generatorName:  string;
    generatorRole:  string;
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc    = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data',  (chunk) => chunks.push(chunk));
      doc.on('end',   () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const typeLabel = params.type === 'OUT' ? 'BARANG KELUAR' : 'BARANG MASUK';

      // Header
      doc.fontSize(18).font('Helvetica-Bold').text('PT. PERMATRACK INDONESIA', { align: 'center' });
      doc.fontSize(14).text(`SURAT JALAN — ${typeLabel}`, { align: 'center' });
      doc.fontSize(11).font('Helvetica').text(`No: ${params.documentNumber}`, { align: 'center' });
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.5);

      // Info block
      const infoY = doc.y;
      doc.text(`Tanggal     : ${params.date.toLocaleDateString('id-ID')}`);
      doc.text(`${params.type === 'OUT' ? 'Dari        : Gudang Pusat' : 'Dari        : Supplier'}`);
      doc.text(`${params.type === 'OUT' ? 'Kepada      : ' + params.fromTo : 'Kepada      : Gudang Pusat'}`);
      doc.text(`Proyek/Ref  : ${params.projectRef}`);
      doc.moveDown(0.5);

      // Items table header
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').fontSize(10);
      doc.text('No',        50,  doc.y, { width: 30 });
      doc.text('Nama Barang', 80, doc.y - doc.currentLineHeight(), { width: 220 });
      doc.text('Kode',      300, doc.y - doc.currentLineHeight(), { width: 80 });
      doc.text('Qty',       380, doc.y - doc.currentLineHeight(), { width: 60 });
      doc.text('Satuan',    440, doc.y - doc.currentLineHeight(), { width: 60 });
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.3);

      // Items rows
      doc.font('Helvetica').fontSize(10);
      params.items.forEach((item, idx) => {
        const qty = item.fulfilledQty > 0 ? item.fulfilledQty : item.requestedQty;
        const lineY = doc.y;
        doc.text(String(idx + 1),       50,  lineY, { width: 30 });
        doc.text(item.itemName,          80,  lineY, { width: 220 });
        doc.text(item.itemCode ?? '-',  300,  lineY, { width: 80 });
        doc.text(String(qty),           380,  lineY, { width: 60 });
        doc.text(item.unit,             440,  lineY, { width: 60 });
        doc.moveDown(0.5);
      });

      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.5);

      // Notes
      if (params.notes) {
        doc.font('Helvetica-Bold').text('Catatan:');
        doc.font('Helvetica').text(params.notes);
        doc.moveDown(0.5);
      }

      doc.moveDown(1);

      // Signature block
      const sigY = doc.y;
      doc.font('Helvetica-Bold').fontSize(11);
      doc.text('Disiapkan oleh',    50,  sigY, { width: 200 });
      doc.text('Diterima oleh',     350, sigY, { width: 200 });
      doc.moveDown(3);
      const lineY = doc.y;
      doc.font('Helvetica');
      doc.moveTo(50, lineY).lineTo(230, lineY).stroke();
      doc.moveTo(350, lineY).lineTo(530, lineY).stroke();
      doc.moveDown(0.3);
      doc.text(params.generatorName, 50,  doc.y, { width: 200 });
      doc.text('_______________',    350, doc.y - doc.currentLineHeight(), { width: 200 });
      doc.text(`(${params.generatorRole})`, 50, doc.y, { width: 200 });
      doc.text('Tanggal: ___________', 350, doc.y - doc.currentLineHeight(), { width: 200 });

      // Footer
      doc.moveDown(2);
      doc.fontSize(8).fillColor('gray')
        .text(`PermaTrax System — Dicetak: ${new Date().toLocaleString('id-ID')}`, { align: 'center' });

      doc.end();
    });
  }
}
