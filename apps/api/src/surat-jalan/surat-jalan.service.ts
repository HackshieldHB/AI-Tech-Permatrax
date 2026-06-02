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

  // Generate Surat Jalan for StockOut flow (4-sig: Admin Stock, PM, Finance, Diterima Oleh manual)
  async generateForStockOut(stockOutId: string, actorId: string) {
    const stockOut = await this.prisma.stockOut.findUniqueOrThrow({
      where: { id: stockOutId },
      include: {
        requestedBy:        { select: { id: true, name: true } },
        adminStockApprover: { select: { id: true, name: true, signatureUrl: true } },
        pmConfirmer:        { select: { id: true, name: true, signatureUrl: true } },
        financeApprover:    { select: { id: true, name: true, signatureUrl: true } },
        permitCluster:      { select: { clusterCode: true } },
      },
    });

    const year = new Date().getFullYear();
    const countThisYear = await this.prisma.suratJalan.count({
      where: { type: 'OUT', createdAt: { gte: new Date(`${year}-01-01`) } },
    });
    const seq            = String(countThisYear + 1).padStart(4, '0');
    const documentNumber = `SJ-OUT-${year}-${seq}`;

    const sj = await this.prisma.suratJalan.create({
      data: {
        documentNumber,
        type:        'OUT',
        generatedBy: actorId,
        status:      'GENERATED',
        notes:       stockOut.notes ?? null,
      },
    });

    const items = (stockOut.items as Array<{ stockItemId: string; qty: number; itemName?: string; notes?: string }>);

    const pdfBuffer = await this.buildStockOutSuratJalanPdf({
      documentNumber,
      date:           new Date(),
      doNumber:       stockOut.doNumber ?? '-',
      recipient:        stockOut.recipient ?? '-',
      recipientCompany: stockOut.recipientCompany ?? '-',
      recipientAddress: stockOut.recipientAddress ?? '-',
      recipientTelp:    stockOut.recipientTelp ?? '-',
      project:          stockOut.permitCluster?.clusterCode ?? stockOut.notes ?? '-',
      from:             'PT Integra Lintas Teknologi',
      fromPerson:       stockOut.adminStockApprover?.name ?? '-',
      fromPhone:        '085899287026',
      items,
      notes:          stockOut.notes ?? '',
      adminStock:     stockOut.adminStockApprover,
      pm:             stockOut.pmConfirmer,
      finance:        stockOut.financeApprover,
    });

    const s3Key = `surat-jalan/${year}/${documentNumber}.pdf`;
    const pdfUrl = await this.storage.uploadBuffer(s3Key, pdfBuffer, 'application/pdf');

    return this.prisma.suratJalan.update({ where: { id: sj.id }, data: { pdfUrl } });
  }

  private async buildStockOutSuratJalanPdf(params: {
    documentNumber: string;
    date:           Date;
    doNumber:       string;
    recipient:      string;   // Up./Penerima (person)
    recipientCompany?: string; // Company/Name of recipient
    recipientAddress?: string;
    recipientTelp?: string;
    project:        string;
    from:           string;
    fromPerson:     string;   // Admin Stock name
    fromPhone:      string;
    items:          Array<{ stockItemId: string; qty: number; itemName?: string; notes?: string }>;
    notes:          string;
    adminStock:     { name: string; signatureUrl?: string | null } | null;
    pm:             { name: string; signatureUrl?: string | null } | null;
    finance:        { name: string; signatureUrl?: string | null } | null;
  }): Promise<Buffer> {
    const loadSig = async (url: string | null | undefined): Promise<Buffer | null> => {
      if (!url) return null;
      try {
        const key = this.storage.extractKeyFromUploadedUrl(url);
        if (key && this.storage.fileExists(key)) {
          return require('fs').readFileSync(this.storage.absolutePathForKey(key)) as Buffer;
        }
      } catch { /* skip */ }
      return null;
    };

    const [adminSig, pmSig, financeSig] = await Promise.all([
      loadSig(params.adminStock?.signatureUrl),
      loadSig(params.pm?.signatureUrl),
      loadSig(params.finance?.signatureUrl),
    ]);

    // Indonesian month names for "Jakarta, DD MMMM YYYY" date format
    const ID_MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    const d = params.date;
    const dateStr = `Jakarta, ${d.getDate()} ${ID_MONTHS[d.getMonth()]} ${d.getFullYear()}`;

    return new Promise((resolve, reject) => {
      const doc    = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end',  () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const L = 40, R = 555, W = R - L;

      // ── Header ──────────────────────────────────────────────────────────────
      // Company name (left) — no logo file available, so left-aligned only
      doc.fontSize(15).font('Helvetica-Bold').text('PT Integra Lintas Teknologi', L, 40, { width: 320 });
      doc.moveDown(2.2);

      // "DELIVERY ORDER" centered, bold, underlined
      const doTitleY = doc.y;
      doc.fontSize(13).font('Helvetica-Bold')
        .text('DELIVERY ORDER', L, doTitleY, { width: W, align: 'center', underline: true });
      doc.moveDown(0.8);

      // ── Info block — two-column grid ────────────────────────────────────────
      const infoY   = doc.y;
      const lw      = 90;   // label width
      const sep     = 8;    // colon column
      const col1X   = L;
      const col2X   = L + 260;
      const rowH    = 16;
      doc.fontSize(9).font('Helvetica');

      const drawRow = (x: number, y: number, label: string, value: string, labelW = lw) => {
        doc.font('Helvetica-Bold').text(label, x, y, { width: labelW, lineBreak: false });
        doc.font('Helvetica').text(` :  ${value}`, x + labelW, y, { width: 220, lineBreak: false });
      };

      // Left column
      drawRow(col1X, infoY + rowH * 0, 'Company/ Name', params.recipientCompany ?? '-');
      drawRow(col1X, infoY + rowH * 1, 'Address',       params.recipientAddress ?? '-');
      drawRow(col1X, infoY + rowH * 3, 'Telp',          params.recipientTelp ?? '-');
      drawRow(col1X, infoY + rowH * 4, 'Up',            params.recipient);
      drawRow(col1X, infoY + rowH * 5, 'PO No.',        '');
      drawRow(col1X, infoY + rowH * 6, 'PO Date',       '');

      // Right column
      drawRow(col2X, infoY + rowH * 0, 'DO No.',  params.doNumber, 55);
      // "From" spans two lines: company + person
      doc.font('Helvetica-Bold').text('From', col2X, infoY + rowH * 1, { width: 55, lineBreak: false });
      doc.font('Helvetica').text(` :  ${params.from}`, col2X + 55, infoY + rowH * 1, { width: 200, lineBreak: false });
      doc.font('Helvetica').text(`     ${params.fromPerson}`, col2X + 55, infoY + rowH * 2, { width: 200, lineBreak: false });
      drawRow(col2X, infoY + rowH * 4, 'Tel/Fax', params.fromPhone, 55);

      doc.y = infoY + rowH * 7 + 6;
      doc.moveDown(0.3);

      // ── Items table ─────────────────────────────────────────────────────────
      // Column widths: NO(30) | ITEM(80) | DESCRIPTION(200) | SERIAL NUMBER(120) | QTY(65)
      const tblX   = L;
      const colNo  = 30;
      const colItem= 80;
      const colDesc= 200;
      const colSer = 120;
      const colQty = W - colNo - colItem - colDesc - colSer; // remainder ~65
      const colXNo   = tblX;
      const colXItem = colXNo   + colNo;
      const colXDesc = colXItem + colItem;
      const colXSer  = colXDesc + colDesc;
      const colXQty  = colXSer  + colSer;

      const drawTableBorder = (y: number) => {
        doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).stroke();
      };

      const drawVerticals = (y1: number, y2: number) => {
        [colXNo, colXItem, colXDesc, colXSer, colXQty, R].forEach((x) => {
          doc.moveTo(x, y1).lineTo(x, y2).lineWidth(0.5).stroke();
        });
      };

      // Table header
      const tblHeaderY = doc.y;
      const tblRowH    = 16;
      drawTableBorder(tblHeaderY);
      doc.font('Helvetica-Bold').fontSize(9);
      doc.text('NO',            colXNo   + 4, tblHeaderY + 3, { width: colNo   - 6, align: 'center', lineBreak: false });
      doc.text('ITEM',          colXItem + 4, tblHeaderY + 3, { width: colItem - 6, align: 'center', lineBreak: false });
      doc.text('DESCRIPTION',   colXDesc + 4, tblHeaderY + 3, { width: colDesc - 6, align: 'center', lineBreak: false });
      doc.text('SERIAL NUMBER', colXSer  + 4, tblHeaderY + 3, { width: colSer  - 6, align: 'center', lineBreak: false });
      doc.text('QTY',           colXQty  + 4, tblHeaderY + 3, { width: colQty  - 6, align: 'center', lineBreak: false });
      drawTableBorder(tblHeaderY + tblRowH);
      drawVerticals(tblHeaderY, tblHeaderY + tblRowH);

      // Table rows
      doc.font('Helvetica').fontSize(9);
      let rowY = tblHeaderY + tblRowH;
      params.items.forEach((item, idx) => {
        doc.text(String(idx + 1),       colXNo   + 4, rowY + 3, { width: colNo   - 6, align: 'center', lineBreak: false });
        // ITEM = short label (use first word of itemName as category stand-in)
        const shortItem = (item.itemName ?? '-').split(' ')[0] ?? '-';
        doc.text(shortItem,             colXItem + 4, rowY + 3, { width: colItem - 6, lineBreak: false });
        doc.text(item.itemName ?? '-',  colXDesc + 4, rowY + 3, { width: colDesc - 6, lineBreak: false });
        doc.text('-',                   colXSer  + 4, rowY + 3, { width: colSer  - 6, align: 'center', lineBreak: false });
        doc.text(String(item.qty),      colXQty  + 4, rowY + 3, { width: colQty  - 6, align: 'center', lineBreak: false });
        rowY += tblRowH;
        drawTableBorder(rowY);
        drawVerticals(rowY - tblRowH, rowY);
      });

      if (params.items.length === 0) {
        doc.text('-', colXNo + 4, rowY + 3, { width: W - 8, align: 'center', lineBreak: false });
        rowY += tblRowH;
        drawTableBorder(rowY);
        drawVerticals(rowY - tblRowH, rowY);
      }

      doc.y = rowY + 6;

      // Note
      if (params.notes) {
        doc.fontSize(9).font('Helvetica-Bold').text('Note :', L, doc.y, { continued: true });
        doc.font('Helvetica').text(` ${params.notes}`);
      }

      // ── Date (right-aligned) ─────────────────────────────────────────────────
      doc.moveDown(3);
      doc.fontSize(9).font('Helvetica').text(dateStr, L, doc.y, { width: W, align: 'right' });
      doc.moveDown(0.6);

      // ── 4-column signature block (all labels pinned to same Y for alignment) ──
      const sigW    = Math.floor(W / 4);
      const sigX    = [L, L + sigW, L + sigW * 2, L + sigW * 3];
      const labels  = ['Dibuat Oleh,', 'Disetujui Oleh,', 'Diterima Oleh,', 'Diketahui Oleh,'];
      const names   = [
        params.adminStock?.name ?? '',
        params.pm?.name ?? '',
        '',                               // manual — filled on paper
        params.finance?.name ?? '',
      ];
      const sigs    = [adminSig, pmSig, null, financeSig];
      const sigImgH = 45;

      // Pin all labels to one fixed Y so they are horizontally aligned
      const labelY  = doc.y;
      const sigImgY = labelY + 14;

      doc.font('Helvetica').fontSize(9);
      labels.forEach((lbl, i) => {
        // Use fixed labelY for every column — prevents cursor drift between columns
        doc.text(lbl, sigX[i], labelY, { width: sigW - 4, lineBreak: false });
      });

      // Signature images (Admin Stock, PM, Finance) — same fixed anchor Y
      sigs.forEach((img, i) => {
        if (img) {
          try { doc.image(img, sigX[i], sigImgY, { height: sigImgH, fit: [sigW - 8, sigImgH] }); }
          catch { /* skip */ }
        }
      });

      // Horizontal underline for each column — all at same Y
      const sigLineY = sigImgY + sigImgH + 2;
      sigX.forEach((x) => {
        doc.moveTo(x, sigLineY).lineTo(x + sigW - 8, sigLineY).lineWidth(0.5).stroke();
      });

      // Names / placeholder below line — all at same Y
      const nameY = sigLineY + 3;
      doc.fontSize(9).font('Helvetica');
      names.forEach((name, i) => {
        if (i === 2) {
          // Diterima Oleh — blank area for manual wet signature
          doc.text('(                            )', sigX[i], nameY, { width: sigW - 4, align: 'center', lineBreak: false });
          doc.fontSize(7).fillColor('#888888')
            .text('Nama     : ________________', sigX[i], nameY + 14, { width: sigW - 4, lineBreak: false })
            .text('Jabatan  : ________________', sigX[i], nameY + 22, { width: sigW - 4, lineBreak: false })
            .text('Tgl        : ________________', sigX[i], nameY + 30, { width: sigW - 4, lineBreak: false });
          doc.fontSize(9).fillColor('black');
        } else {
          doc.text(`(${name})`, sigX[i], nameY, { width: sigW - 4, align: 'center', lineBreak: false });
        }
      });

      doc.end();
    });
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
      doc.fontSize(18).font('Helvetica-Bold').text('PT. Integra Lintas Teknologi', { align: 'center' });
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
