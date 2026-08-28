import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { BaOpenStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { paginate, PaginatedResponse } from '../common/dto/pagination.dto';
import { BaOpenListFilterDtoType } from './ba-open.dto';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { PermitClusterService } from '../permit-cluster/permit-cluster.service';
import { BA_OPEN_PDF_QUEUE } from './ba-open.queue';
import { CreateBaOpenDtoType } from './ba-open.dto';
import { StorageService } from '../storage/storage.service';
import { formatDocWarningLog } from '@shared/constants/pipelineStates';
// FIX: CommonJS require — pdfkit does not have a default ES export
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');

// NEW: BaOpenService — auto-generates BA Open documents after admin approval
@Injectable()
export class BaOpenService {
  private readonly logger = new Logger(BaOpenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
    private readonly permitClusterService: PermitClusterService,
    private readonly storageService: StorageService, // FIX: local PDF upload (no S3)
    @InjectQueue(BA_OPEN_PDF_QUEUE) private readonly pdfQueue: Queue,
  ) {}

  // NEW: Called automatically by VisitRequestService after admin approval
  async generateBaOpen(dto: CreateBaOpenDtoType, generatedBy: string) {
    const visitRequestId = dto.visitRequestId;
    const vr = await this.prisma.visitRequest.findUnique({
      where:   { id: visitRequestId },
      include: {
        cleanList: true,
        requester: { select: { id: true, name: true } },
      },
    });
    if (!vr) throw new NotFoundException('Visit request tidak ditemukan');

    const year = new Date().getFullYear();
    const countThisYear = await this.prisma.baOpen.count({
      where: { createdAt: { gte: new Date(`${year}-01-01`) } },
    });
    const sequence = String(countThisYear + 1).padStart(4, '0');
    const documentNumber = `BA-OPEN-${year}-${sequence}`;

    const stakeholderSummary = this.formatStakeholderResponse(vr.stakeholderResponse);

    const baOpen = await this.prisma.baOpen.create({
      data: {
        visitRequestId,
        documentNumber,
        generatedBy,
        status:            'GENERATED',
        clusterName:       vr.cleanList?.kelurahan ?? '-',
        rwCode:            vr.cleanList?.rwCode ?? '-',
        kelurahan:         vr.cleanList?.kelurahan ?? '-',
        ispCustomer:       vr.ispCustomer,
        visitDate:         vr.visitDate ?? new Date(),
        surveyorName:      vr.requester?.name ?? '-',
        rtRwName:          vr.rwContact ?? null,
        areaDescription:   vr.areaCondition ?? null,
        stakeholderSummary,
        tanggal: new Date(dto.tanggal),
        tempat: dto.tempat,
        topik: dto.topik,
        description: dto.description,
        existingFiber: dto.existingFiber ?? false,
        existingOperator: dto.existingOperator ?? undefined,
      },
    });

    await this.pdfQueue.add(
      'generate-pdf',
      {
        baOpenId: baOpen.id,
        visitRequestId,
        assignedPmId: vr.assignedPmId ?? vr.requestedBy,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );

    await this.permitClusterService.createFromBaOpen(baOpen.id, generatedBy);
    this.gateway.emitToRoom(`user:${vr.requestedBy}`, 'baOpen:generated', {
      visitRequestId,
      baOpenId: baOpen.id,
      documentNumber,
      pdfUrl: null,
    });
    return baOpen;
  }

  // FIX: lookup by visit request — null if admin has not approved yet (no 404)
  async findByVisitRequestId(visitRequestId: string) {
    return this.prisma.baOpen.findFirst({
      where: { visitRequestId },
      include: {
        visitRequest: {
          include: {
            requester: { select: { id: true, name: true, email: true, role: true } },
            cleanList: true,
          },
        },
      },
    });
  }

  // FIX: lookup by permit cluster id
  async findByClusterId(clusterId: string) {
    return this.prisma.baOpen.findFirst({
      where: { permitCluster: { id: clusterId } },
      include: {
        visitRequest: {
          include: {
            requester: { select: { id: true, name: true } },
            cleanList: true,
          },
        },
      },
    });
  }

  // MODIFIED: paginated list + filters
  async findAll(filters: BaOpenListFilterDtoType): Promise<PaginatedResponse<unknown>> {
    const { status, ispCustomer, fiberType, search, dateFrom, dateTo, page, limit, sortBy, sortOrder } = filters;
    const skip = (page - 1) * limit;
    const where: Prisma.BaOpenWhereInput = {};
    if (status) where.status = status as BaOpenStatus;
    if (ispCustomer?.trim()) {
      where.ispCustomer = { contains: ispCustomer.trim(), mode: 'insensitive' };
    }
    if (fiberType) {
      where.visitRequest = { is: { cleanList: { fiberType } } };
    }
    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        { documentNumber: { contains: q, mode: 'insensitive' } },
        { clusterName: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (dateFrom || dateTo) {
      where.generatedAt = {};
      if (dateFrom) where.generatedAt.gte = new Date(dateFrom);
      if (dateTo)   where.generatedAt.lte = new Date(dateTo);
    }

    const orderField = sortBy && ['generatedAt', 'documentNumber'].includes(sortBy) ? sortBy : 'generatedAt';
    const orderBy = { [orderField]: sortOrder } as Prisma.BaOpenOrderByWithRelationInput;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.baOpen.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          generator: { select: { id: true, name: true } },
          visitRequest: {
            include: {
              requester: { select: { id: true, name: true } },
              cleanList: { select: { kelurahan: true, kecamatan: true, fiberType: true } },
            },
          },
        },
      }),
      this.prisma.baOpen.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  // NEW: Single BA Open with full details
  async findOne(id: string) {
    const baOpen = await this.prisma.baOpen.findUnique({
      where:   { id },
      include: {
        visitRequest: {
          include: {
            requester:  { select: { id: true, name: true, email: true } },
            cleanList:  true,
            approvalLogs: { include: { actor: { select: { name: true, role: true } } } },
          },
        },
      },
    });
    if (!baOpen) throw new NotFoundException('BA Open tidak ditemukan');
    return baOpen;
  }

  // FIX: official Indonesian BA Open PDF layout (PDFKit via CommonJS require)
  async buildBaOpenPdfBuffer(baOpenId: string): Promise<Buffer> {
    const baOpen = await this.prisma.baOpen.findUnique({ // FIX: use findUnique + null check
      where: { id: baOpenId },
      include: {
        visitRequest: {
          include: {
            cleanList: true,
            requester: { select: { name: true, role: true, signatureUrl: true } },
            approvalLogs: {
              include: { actor: { select: { name: true, role: true, signatureUrl: true } } },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });

    if (!baOpen) throw new NotFoundException('BA Open tidak ditemukan'); // FIX: explicit null guard

    // FIX: Pre-load signature buffers before PDF generation (async operations)
    const approvalLogs = baOpen.visitRequest?.approvalLogs || [];
    const pmApprover = approvalLogs.find(
      (log: any) => log.action === 'PM_REVIEW_APPROVED' || log.action === 'VISIT_GATE_APPROVED'
    )?.actor;
    const adminApprover = approvalLogs.find(
      (log: any) => log.action === 'ADMIN_APPROVED'
    )?.actor;
    const surveyor = baOpen.visitRequest?.requester;

    // Prepare signer data with pre-loaded signature buffers
    const signers = [
      {
        name: surveyor?.name || 'Surveyor',
        role: surveyor?.role || 'Surveyor',
        signatureUrl: surveyor?.signatureUrl || null,
      },
      {
        name: pmApprover?.name || 'Project Manager',
        role: pmApprover?.role || 'PM',
        signatureUrl: pmApprover?.signatureUrl || null,
      },
      {
        name: adminApprover?.name || 'Admin',
        role: adminApprover?.role || 'ADMIN',
        signatureUrl: adminApprover?.signatureUrl || null,
      },
    ];

    // Pre-load all signature buffers
    const sigBuffers: (Buffer | null)[] = await Promise.all(
      signers.map(async (signer) => {
        if (!signer.signatureUrl) return null;
        try {
          return await this.storageService.downloadBuffer(signer.signatureUrl);
        } catch (e) {
          return null;
        }
      })
    );

    return new Promise<Buffer>((resolve, reject) => {
      try { // FIX: wrap body in try/catch to propagate sync errors via reject
        const doc = new PDFDocument({ // FIX: construct directly without .default
          size: 'A4',
          margins: { top: 50, bottom: 50, left: 60, right: 60 },
        });

        const buffers: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', reject);

        const cl = baOpen.visitRequest?.cleanList;
        const pageWidth = doc.page.width - 120;

        const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const months = [
          'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
          'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
        ];
        const tgl = baOpen.tanggal ? new Date(baOpen.tanggal) : new Date();
        const hariStr = days[tgl.getDay()];
        const tglLong = `${tgl.getDate()} ${months[tgl.getMonth()]} ${tgl.getFullYear()}`;
        const tglStr = `${hariStr}, ${tglLong}`;

        // HEADER BOX
        doc.rect(60, 50, pageWidth, 85).stroke('#1a2d45'); // FIX: larger header box for readability
        doc.fontSize(15).font('Helvetica-Bold').fillColor('#1a2d45')
          .text('BERITA ACARA KUNJUNGAN', 60, 65, { width: pageWidth, align: 'center' });
        doc.fontSize(13).font('Helvetica-Bold')
          .text('OPEN CLUSTER', 60, 84, { width: pageWidth, align: 'center' });
        doc.fontSize(9).font('Helvetica').fillColor('#555555')
          .text('PT INTEGRA LINTAS TEKNOLOGI',
            60, 105, { width: pageWidth, align: 'center' });

        doc.moveDown(2);
        doc.fontSize(10).font('Helvetica').fillColor('#000000');

        const infoY = doc.y;
        doc.text('Nomor', 60, infoY, { width: 120 });
        doc.text(`: ${baOpen.documentNumber || '-'}`, 180, infoY); // FIX: fallback for null document number
        doc.text('Tanggal', 60, infoY + 18, { width: 120 });
        doc.text(`: ${tglStr}`, 180, infoY + 18);

        doc.moveDown(2);

        doc.font('Helvetica')
          .text(`Pada hari ini, ${hariStr} tanggal ${tglLong}, bertempat di:`,
            { align: 'justify' });
        doc.moveDown(0.3);
        doc.font('Helvetica-Bold').text(`   ${baOpen.tempat || '-'}`);
        doc.moveDown(0.5);
        doc.font('Helvetica')
          .text('Telah dilaksanakan kunjungan lapangan dengan agenda:');
        doc.moveDown(0.3);
        doc.font('Helvetica-Bold').text(`   ${baOpen.topik || '-'}`);
        doc.moveDown(1.5);

        // URAIAN SECTION
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a2d45')
          .text('URAIAN / ISSUES', { underline: true });
        doc.moveDown(0.3);
        doc.moveTo(60, doc.y).lineTo(60 + pageWidth, doc.y).stroke('#cccccc');
        doc.moveDown(0.4);
        doc.font('Helvetica').fillColor('#000000')
          .text(baOpen.description || '-', { align: 'justify', lineGap: 3 });
        doc.moveDown(1.5);

        // CLUSTER INFO SECTION
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a2d45')
          .text('INFORMASI CLUSTER', { underline: true });
        doc.moveDown(0.3);
        doc.moveTo(60, doc.y).lineTo(60 + pageWidth, doc.y).stroke('#cccccc');
        doc.moveDown(0.5);

        const clusterRows: [string, string][] = [ // FIX: typed tuples so TS stays happy
          ['ISP Customer',    cl?.ispCustomer    || '-'],
          ['Kode RW',         cl?.rwCode         || '-'],
          ['Kelurahan',       cl?.kelurahan      || '-'],
          ['Kecamatan',       cl?.kecamatan      || '-'],
          ['Kota/Kabupaten',  cl?.kotaKabupaten  || '-'],
          ['Fiber Type',      String(cl?.fiberType ?? '-')],
          ['Target Homepass', String(cl?.homepasCount ?? '-')],
        ];

        doc.font('Helvetica').fillColor('#000000').fontSize(10);
        clusterRows.forEach(([label, value]) => {
          const y = doc.y;
          doc.text(label, 60, y, { width: 140 });
          doc.text(`: ${value}`, 200, y);
          doc.moveDown(0.4);
        });

        doc.moveDown(1.5);

        // PESERTA SECTION
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a2d45')
          .text('PESERTA KUNJUNGAN', { underline: true });
        doc.moveDown(0.3);
        doc.moveTo(60, doc.y).lineTo(60 + pageWidth, doc.y).stroke('#cccccc');
        doc.moveDown(0.5);

        doc.font('Helvetica').fillColor('#000000').fontSize(10);
        const peserta: [string, string][] = [ // FIX: typed tuples
          ['Surveyor', surveyor?.name || '-'],
          ['ISP',      cl?.ispCustomer || baOpen.ispCustomer || '-'],
        ];
        peserta.forEach(([label, value]) => {
          const y = doc.y;
          doc.text(label, 60, y, { width: 140 });
          doc.text(`: ${value}`, 200, y);
          doc.moveDown(0.4);
        });

        doc.moveDown(2);

        // SIGNATURES - FIX: Use pre-loaded signature buffers
        if (doc.y > 640) doc.addPage();

        doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a2d45')
          .text('TANDA TANGAN', { underline: true });
        doc.moveDown(0.3);
        doc.moveTo(60, doc.y).lineTo(60 + pageWidth, doc.y).stroke('#cccccc');
        doc.moveDown(2.5);

        const sigY = doc.y;
        const colW = (pageWidth - 40) / 3;
        const cols = [60, 60 + colW + 20, 60 + (colW + 20) * 2];

        ['Dibuat oleh,', 'Mengetahui,', 'Menyetujui,'].forEach((lbl, i) => {
          doc.font('Helvetica').fontSize(9).fillColor('#000000')
            .text(lbl, cols[i], sigY, { width: colW, align: 'center' });
        });

        // HARDEN: Render signatures with safe fallback
        for (let i = 0; i < signers.length; i++) {
          const signer = signers[i];
          const colX = cols[i];
          const sigImgY = sigY + 15;
          const sigBuffer = sigBuffers[i];

          if (sigBuffer) {
            try {
              doc.image(sigBuffer, colX + (colW - 70) / 2, sigImgY, { width: 70, height: 35 });
            } catch (e) {
              // Fallback: draw signature line
              doc.moveTo(colX + 10, sigImgY + 25).lineTo(colX + colW - 10, sigImgY + 25).stroke('#000000');
              this.logger.warn(formatDocWarningLog('BA_OPEN', baOpenId, `${signer.role}_signature_render`));
            }
          } else {
            // No signature: draw signature line and log warning
            doc.moveTo(colX + 10, sigImgY + 25).lineTo(colX + colW - 10, sigImgY + 25).stroke('#000000');
            this.logger.warn(formatDocWarningLog('BA_OPEN', baOpenId, `${signer.role}_signature_missing`));
          }

          // Name and role
          const nameY = sigImgY + 32;
          doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000')
            .text(signer.name, colX, nameY, { width: colW, align: 'center' });
          doc.fontSize(8).font('Helvetica').fillColor('#666666')
            .text(signer.role, colX, nameY + 13, { width: colW, align: 'center' });
        }

        // FOOTER
        doc.fontSize(7).fillColor('#aaaaaa')
          .text(
            `Dokumen ini dibuat oleh sistem PermaTrax — ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`,
            60, doc.page.height - 38,
            { width: pageWidth, align: 'center' },
          );

        doc.end();
      } catch (err) {
        reject(err); // FIX: guarantee rejection if any sync path fails
      }
    });
  }

  // FIX: persist PDF to local storage and update row (on-the-fly or queue completion)
  async generateAndSavePdf(baOpenId: string): Promise<{ pdfUrl: string }> {
    const pdfBuffer = await this.buildBaOpenPdfBuffer(baOpenId);
    const year = new Date().getFullYear();
    const ba = await this.prisma.baOpen.findUnique({ where: { id: baOpenId } });
    if (!ba) throw new NotFoundException('BA Open tidak ditemukan');
    const safeName = ba.documentNumber.replace(/\//g, '-');
    const key = `ba-open/${year}/${safeName}.pdf`;
    const pdfUrl = await this.storageService.uploadBuffer(pdfBuffer, key, 'application/pdf');
    await this.prisma.baOpen.update({
      where: { id: baOpenId },
      data:  { pdfUrl, status: 'GENERATED' as BaOpenStatus },
    });
    return { pdfUrl };
  }

  // FIX: download resolver — redirect to stored file or generate buffer on the fly
  async resolveDownload(
    id: string,
  ): Promise<{ mode: 'redirect'; url: string } | { mode: 'buffer'; buffer: Buffer; filename: string }> {
    const baOpen = await this.prisma.baOpen.findUnique({ where: { id } });
    if (!baOpen) throw new NotFoundException('BA Open tidak ditemukan');
    if (baOpen.pdfUrl) {
      return { mode: 'redirect', url: baOpen.pdfUrl };
    }
    const buffer = await this.buildBaOpenPdfBuffer(id);
    const filename = `BA-Open-${baOpen.documentNumber.replace(/\//g, '-')}.pdf`;
    return { mode: 'buffer', buffer, filename };
  }

  // NEW: Get presigned download URL from storage (legacy JSON clients)
  async getDownloadUrl(id: string): Promise<{ pdfUrl: string }> {
    const baOpen = await this.prisma.baOpen.findUnique({ where: { id } });
    if (!baOpen) throw new NotFoundException('BA Open tidak ditemukan');
    if (!baOpen.pdfUrl) throw new NotFoundException('PDF belum tersedia');
    return { pdfUrl: baOpen.pdfUrl };
  }

  // NEW: Mark as SENT and return updated record
  async sendToIsp(id: string, sentBy: string): Promise<any> {
    const baOpen = await this.findOne(id);
    const updated = await this.prisma.baOpen.update({
      where: { id },
      data:  { status: 'SENT' },
    });
    return {
      sent:      true,
      sentAt:    new Date(),
      recipient: baOpen.ispCustomer,
      document:  updated.documentNumber,
    };
  }

  private formatStakeholderResponse(response: string | null | undefined): string {
    const map: Record<string, string> = {
      ALLOWED:     'Diizinkan',
      NOT_ALLOWED: 'Tidak Diizinkan',
      CONDITIONAL: 'Bersyarat',
      PENDING:     'Menunggu Konfirmasi',
    };
    if (response == null) return '-';
    return map[response] ?? response;
  }
}
