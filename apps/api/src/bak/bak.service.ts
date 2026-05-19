import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
  Logger,
} from '@nestjs/common'; // FIX
import * as fs from 'fs'; // FIX
import * as path from 'path'; // FIX
import { PrismaService } from '../prisma/prisma.service'; // FIX
import { StorageService } from '../storage/storage.service'; // FIX
import { NotificationsService } from '../notifications/notifications.service'; // FIX
import { PermitClusterService } from '../permit-cluster/permit-cluster.service'; // FIX
import { BakpService } from '../bakp/bakp.service'; // FIX: phase 17 BAKP row bootstrap
import { BakAgreementStatus, Prisma, Role } from '@prisma/client'; // FIX
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit'); // FIX

/** FIX: helper to fetch image buffer from URL or local path */
async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    if (url.startsWith('http')) {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) }); // FIX: fetch from remote URL
      if (!res.ok) return null; // FIX
      const ab = await res.arrayBuffer(); // FIX
      return Buffer.from(ab); // FIX
    } else {
      const fullPath = url.startsWith('/') ? url : path.join(process.cwd(), url); // FIX: local file path
      if (fs.existsSync(fullPath)) {
        return fs.readFileSync(fullPath); // FIX
      }
    }
  } catch {
    /* FIX: swallow — caller draws placeholder */
  }
  return null; // FIX
}

const BAK_AGREEMENT_SAVE_KEYS = [ // FIX
  'wpNama',
  'wpNoKtp',
  'wpJabatan',
  'wpAlamat',
  'wpNoTelp',
  'tipeLokasiType',
  'tipeLokasiOther',
  'namaLokasi',
  'alamatLokasi',
  'alamatKantorPemasaran',
  'jangkaWaktu',
  'homepasExisting',
  'kategoriPerumahan',
  'occupancy',
  'penempatanKabel',
  'existingCompetitor',
  'benefitIsp',
  'areaDimeterM',
  'benefitPemilik',
  'ketentuanListrik',
  'ketentuanTambahan',
  'useDigitalSignature',
  'signatureIspUrl',
  'signaturePemilikUrl',
  'signatureIspName',
  'signaturePemilikName',
  'ktpPhotoUrls',
  'stempelPhotoUrl',
] as const; // FIX

@Injectable()
export class BakAgreementService {
  private readonly logger = new Logger(BakAgreementService.name); // FIX

  // FIX: surveyor BAK (BakAgreement) — separate from compensation `Bak`
  constructor(
    private readonly prisma: PrismaService, // FIX
    private readonly storageService: StorageService, // FIX
    private readonly notificationsService: NotificationsService, // FIX
    @Inject(forwardRef(() => PermitClusterService))
    private readonly permitClusterService: PermitClusterService, // FIX
    private readonly bakpService: BakpService, // FIX: create BAKP when entering phase 17
  ) {}

  private pickSaveData(body: Record<string, unknown>): Prisma.BakAgreementUpdateInput {
    // FIX: only persist whitelisted columns
    const out: Record<string, unknown> = {}; // FIX
    for (const key of BAK_AGREEMENT_SAVE_KEYS) {
      if (body[key] === undefined) continue; // FIX
      out[key] = body[key]; // FIX
    }
    return out as Prisma.BakAgreementUpdateInput; // FIX
  }

  /** FIX: get or init BAK agreement for cluster */
  async getOrInit(clusterId: string, _userId: string) {
    void _userId; // FIX: reserved for audit / future use
    let bak = await this.prisma.bakAgreement.findUnique({
      where: { permitClusterId: clusterId }, // FIX
    });
    if (!bak) {
      bak = await this.prisma.bakAgreement.create({
        data: { permitClusterId: clusterId, status: BakAgreementStatus.DRAFT }, // FIX
      });
    }
    return bak; // FIX
  }

  /** FIX: Surveyor saves form data */
  async saveForm(clusterId: string, data: Record<string, unknown>, _userId: string) {
    void _userId; // FIX
    const picked = this.pickSaveData(data); // FIX
    const existing = await this.prisma.bakAgreement.findUnique({
      where: { permitClusterId: clusterId }, // FIX
    });
    if (existing) {
      return this.prisma.bakAgreement.update({
        where: { id: existing.id }, // FIX
        data: picked, // FIX
      });
    }
    return this.prisma.bakAgreement.create({
      data: {
        permitClusterId: clusterId, // FIX
        status: BakAgreementStatus.DRAFT, // FIX
        ...(picked as Record<string, unknown>), // FIX: UpdateInput spread is not assignable to CreateInput for TS
      } as Prisma.BakAgreementUncheckedCreateInput,
    });
  }

  /** FIX: Surveyor marks form complete + generate PDF */
  async completeForm(clusterId: string, userId: string) {
    const bak = await this.prisma.bakAgreement.findUnique({
      where: { permitClusterId: clusterId }, // FIX
    });
    if (!bak) throw new NotFoundException('BAK tidak ditemukan'); // FIX

    const allowedComplete: BakAgreementStatus[] = [ // FIX: allow re-complete after rejection
      BakAgreementStatus.DRAFT,
      BakAgreementStatus.PM_REJECTED,
      BakAgreementStatus.ADMIN_REJECTED,
    ];
    if (
      !allowedComplete.includes(bak.status) &&
      bak.status !== BakAgreementStatus.FORM_COMPLETE &&
      bak.status !== BakAgreementStatus.PDF_GENERATED
    ) {
      throw new BadRequestException(`Tidak bisa complete dari status ${bak.status}`); // FIX
    }

    // FIX 3: Auto-fetch signature from user profile if not already set
    let signatureIspUrl = bak.signatureIspUrl;
    let signatureIspName = bak.signatureIspName;
    if (!signatureIspUrl && bak.useDigitalSignature) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { signatureUrl: true, name: true },
      });
      if (!user?.signatureUrl) {
        throw new BadRequestException(
          'Tanda tangan belum tersedia pada profile user. Silakan upload tanda tangan di menu Profile terlebih dahulu.',
        );
      }
      signatureIspUrl = user.signatureUrl;
      signatureIspName = user.name;
    }

    await this.prisma.bakAgreement.update({
      where: { id: bak.id }, // FIX
      data: {
        status: BakAgreementStatus.FORM_COMPLETE, // FIX
        submittedBy: userId, // FIX
        submittedAt: new Date(), // FIX
        signedPdfUrl: null, // FIX: clear old signed PDF so surveyor must re-upload
        // FIX 3: Update with auto-fetched signature if applicable
        ...(signatureIspUrl && !bak.signatureIspUrl ? {
          signatureIspUrl,
          signatureIspName,
        } : {}),
      },
    });

    await this.generatePdf(bak.id, userId); // FIX: regenerate PDF with latest revised data

    return this.prisma.bakAgreement.findUniqueOrThrow({
      where: { id: bak.id }, // FIX
    });
  }

  /** FIX: generate BAK PDF (PDFKit) — embeds digital signature images when present */
  async generatePdf(bakId: string, userId: string) {
    void userId; // FIX
    const bak = await this.prisma.bakAgreement.findUnique({
      where: { id: bakId }, // FIX: always get fresh data including signature URLs
      include: { permitCluster: true }, // FIX
    });
    if (!bak) throw new NotFoundException('BAK tidak ditemukan'); // FIX

    this.logger.debug( // FIX: log signature status for debugging
      `GeneratePDF bakId=${bakId} ` +
        `useDigital=${bak.useDigitalSignature} ` +
        `ispUrl=${bak.signatureIspUrl ? 'YES' : 'NO'} ` +
        `pemilikUrl=${bak.signaturePemilikUrl ? 'YES' : 'NO'}`,
    );

    const doc = new PDFDocument({ margin: 50, size: 'A4' }); // FIX
    const chunks: Buffer[] = []; // FIX
    doc.on('data', (c: Buffer) => chunks.push(c)); // FIX

    await new Promise<void>((resolve, reject) => {
      doc.on('end', resolve); // FIX
      doc.on('error', reject); // FIX

      void (async () => {
        try {
          const field = (label: string, value: string | null | undefined) => {
            // FIX
            doc.font('Helvetica-Bold').text(`${label}: `, { continued: true }); // FIX
            doc.font('Helvetica').text(value || '-'); // FIX
            doc.moveDown(0.4); // FIX
          };

          doc.fontSize(16).font('Helvetica-Bold').text('BERITA ACARA KESEPAKATAN (BAK)', { align: 'center' }); // FIX
          doc
            .fontSize(12)
            .font('Helvetica')
            .text(
              `Cluster: ${bak.permitCluster?.clusterCode ?? clusterIdFallback(bak.permitClusterId)}`,
              { align: 'center' },
            ); // FIX
          doc.moveDown(2); // FIX

          doc.fontSize(13).font('Helvetica-Bold').text('1. Warga Penghuni / WP'); // FIX
          doc.moveDown(0.3); // FIX
          doc.fontSize(11).font('Helvetica'); // FIX
          field('Nama WP', bak.wpNama); // FIX
          field('No KTP', bak.wpNoKtp); // FIX
          field('Jabatan WP', bak.wpJabatan); // FIX
          field('Alamat WP', bak.wpAlamat); // FIX
          field('No Telp/HP', bak.wpNoTelp); // FIX
          doc.moveDown(1); // FIX

          doc.fontSize(13).font('Helvetica-Bold').text('2. Lokasi / Kawasan'); // FIX
          doc.moveDown(0.3); // FIX
          doc.fontSize(11).font('Helvetica'); // FIX
          field(
            'Tipe Lokasi',
            bak.tipeLokasiType === 'OTHERS'
              ? `Others: ${bak.tipeLokasiOther ?? ''}`
              : bak.tipeLokasiType,
          ); // FIX
          field('Nama Lokasi', bak.namaLokasi); // FIX
          field('Alamat Lokasi', bak.alamatLokasi); // FIX
          field('Alamat Kantor Pemasaran', bak.alamatKantorPemasaran); // FIX
          doc.moveDown(1); // FIX

          doc.fontSize(13).font('Helvetica-Bold').text('3. Jangka Waktu Perjanjian'); // FIX
          doc.fontSize(11).font('Helvetica').text(bak.jangkaWaktu || '-'); // FIX
          doc.moveDown(1); // FIX

          doc.fontSize(13).font('Helvetica-Bold').text('4. Jumlah dan Kriteria Homepass'); // FIX
          doc.moveDown(0.3); // FIX
          doc.fontSize(11).font('Helvetica'); // FIX
          field('Homepass Existing', String(bak.homepasExisting ?? '-')); // FIX
          field('Kategori Perumahan', bak.kategoriPerumahan); // FIX
          field('Occupancy', bak.occupancy != null ? `${bak.occupancy}%` : '-'); // FIX
          doc.moveDown(1); // FIX

          doc.fontSize(13).font('Helvetica-Bold').text('5. Penempatan Kabel'); // FIX
          doc.fontSize(11).font('Helvetica').text(bak.penempatanKabel || '-'); // FIX
          doc.moveDown(1); // FIX

          doc.fontSize(13).font('Helvetica-Bold').text('6. Existing Competitor'); // FIX
          doc.fontSize(11).font('Helvetica').text(bak.existingCompetitor || '-'); // FIX
          doc.moveDown(1); // FIX

          doc.fontSize(13).font('Helvetica-Bold').text('7. Benefit yang Diperoleh ISP'); // FIX
          doc.fontSize(11).font('Helvetica').text(bak.benefitIsp || '-'); // FIX
          doc.moveDown(1); // FIX

          doc.fontSize(13).font('Helvetica-Bold').text('8. Benefit yang Diperoleh Pemilik Kawasan'); // FIX
          doc.fontSize(11).font('Helvetica').text(bak.benefitPemilik || '-'); // FIX
          doc.moveDown(1); // FIX

          doc.fontSize(13).font('Helvetica-Bold').text('9. Listrik'); // FIX
          doc
            .fontSize(11)
            .font('Helvetica')
            .text(
              bak.ketentuanListrik ||
                'Pembayaran langsung ke PLN dengan KWH meter yang terpakai',
            ); // FIX
          doc.moveDown(1); // FIX

          doc.fontSize(13).font('Helvetica-Bold').text('10. Ketentuan Tambahan'); // FIX
          doc.fontSize(11).font('Helvetica').text(bak.ketentuanTambahan || '-'); // FIX
          doc.moveDown(2); // FIX

          // FIX: signature section with embedded images (new page)
          doc.addPage(); // FIX
          doc.fontSize(14).font('Helvetica-Bold').text('Tanda Tangan Para Pihak', { align: 'center' }); // FIX
          doc.moveDown(1); // FIX

          const signY = doc.y; // FIX
          const leftX = 60; // FIX
          const rightX = 320; // FIX
          const sigBoxW = 180; // FIX
          const sigBoxH = 80; // FIX

          doc.fontSize(11).font('Helvetica').text('Pihak ISP', leftX, signY, { width: sigBoxW, align: 'center' }); // FIX
          doc.text('Pihak Pemilik Kawasan', rightX, signY, { width: sigBoxW, align: 'center' }); // FIX

          const nameY = signY + sigBoxH + 10; // FIX

          if (bak.useDigitalSignature && bak.signatureIspUrl) {
            let ispDrawn = false; // FIX
            try {
              const ispSrc = bak.signatureIspUrl.startsWith('http') // FIX
                ? bak.signatureIspUrl // FIX
                : bak.signatureIspUrl.replace(/^\/+/, ''); // FIX: handle local storage path
              const imgBuf = await fetchImageBuffer(ispSrc); // FIX
              if (imgBuf) {
                doc.image(imgBuf, leftX + 10, signY + 14, {
                  width: sigBoxW - 20, // FIX
                  height: sigBoxH - 10, // FIX
                  fit: [sigBoxW - 20, sigBoxH - 10], // FIX
                });
                ispDrawn = true; // FIX
              }
            } catch {
              /* FIX: fall through to placeholder */
            }
            if (!ispDrawn) {
              doc.rect(leftX + 10, signY + 14, sigBoxW - 20, sigBoxH - 10).dash(3, { space: 3 }).stroke('#CCCCCC').undash(); // FIX: placeholder box
              doc.fontSize(8).fillColor('#AAAAAA').text('(TTD Digital)', leftX + 10, signY + 50, { width: sigBoxW - 20, align: 'center' }); // FIX
              doc.fillColor('black'); // FIX
            }
          } else {
            doc.rect(leftX + 10, signY + 14, sigBoxW - 20, sigBoxH - 10).dash(3, { space: 3 }).stroke('#CCCCCC').undash(); // FIX: manual signature box
            doc.moveTo(leftX + 10, nameY - 5).lineTo(leftX + sigBoxW - 10, nameY - 5).stroke('#000000'); // FIX
          }

          if (bak.useDigitalSignature && bak.signaturePemilikUrl) {
            let pemilikDrawn = false; // FIX
            try {
              const pemilikSrc = bak.signaturePemilikUrl.startsWith('http') // FIX
                ? bak.signaturePemilikUrl // FIX
                : bak.signaturePemilikUrl.replace(/^\/+/, ''); // FIX
              const imgBuf = await fetchImageBuffer(pemilikSrc); // FIX
              if (imgBuf) {
                doc.image(imgBuf, rightX + 10, signY + 14, {
                  width: sigBoxW - 20, // FIX
                  height: sigBoxH - 10, // FIX
                  fit: [sigBoxW - 20, sigBoxH - 10], // FIX
                });
                pemilikDrawn = true; // FIX
              }
            } catch {
              /* FIX: fall through to placeholder */
            }
            if (!pemilikDrawn) {
              doc.rect(rightX + 10, signY + 14, sigBoxW - 20, sigBoxH - 10).dash(3, { space: 3 }).stroke('#CCCCCC').undash(); // FIX
              doc.fontSize(8).fillColor('#AAAAAA').text('(TTD Digital)', rightX + 10, signY + 50, { width: sigBoxW - 20, align: 'center' }); // FIX
              doc.fillColor('black'); // FIX
            }
          } else {
            doc.rect(rightX + 10, signY + 14, sigBoxW - 20, sigBoxH - 10).dash(3, { space: 3 }).stroke('#CCCCCC').undash(); // FIX
            doc.moveTo(rightX + 10, nameY - 5).lineTo(rightX + sigBoxW - 10, nameY - 5).stroke('#000000'); // FIX
          }

          doc.fontSize(11).font('Helvetica-Bold').fillColor('black'); // FIX: name labels below signature box
          doc.text(bak.signatureIspName || '(___________________)', leftX, nameY, {
            width: sigBoxW,
            align: 'center',
          }); // FIX
          doc.text(bak.signaturePemilikName || '(___________________)', rightX, nameY, {
            width: sigBoxW,
            align: 'center',
          }); // FIX

          if (bak.stempelPhotoUrl) {
            doc.moveDown(2); // FIX: stempel note
            doc.fontSize(10).font('Helvetica').fillColor('#666666').text(
              '* Stempel/cap basah telah dilampirkan pada dokumen fisik',
              { align: 'center' },
            );
            doc.fillColor('black'); // FIX
          }

          if (bak.useDigitalSignature) {
            doc.moveDown(1); // FIX: digital signature disclaimer
            doc
              .fontSize(9)
              .fillColor('#888888')
              .text(
                'Dokumen ini menggunakan tanda tangan digital yang sah ' +
                  'sesuai UU ITE No. 11 Tahun 2008.',
                { align: 'center' },
              );
            doc.fillColor('black'); // FIX
          }

          doc.end(); // FIX
        } catch (err) {
          reject(err as Error); // FIX
        }
      })();
    });

    const buffer = Buffer.concat(chunks); // FIX
    const key = `bak/agreement/${bak.permitClusterId}/BAK-${bak.id}.pdf`; // FIX
    const url = await this.storageService.uploadBuffer(buffer, key, 'application/pdf'); // FIX

    await this.prisma.bakAgreement.update({
      where: { id: bakId }, // FIX
      data: { pdfUrl: url, status: BakAgreementStatus.PDF_GENERATED }, // FIX
    });

    return url; // FIX
  }

  /** FIX: resolve PDF URL (auth-friendly JSON for SPA) */
  async getPdfUrl(clusterId: string, userId: string) {
    let row = await this.getOrInit(clusterId, userId); // FIX
    if (!row.pdfUrl) {
      await this.generatePdf(row.id, userId); // FIX
      row = await this.prisma.bakAgreement.findUniqueOrThrow({
        where: { permitClusterId: clusterId }, // FIX
      });
    }
    return { url: row.pdfUrl! }; // FIX
  }

  /** FIX: Surveyor uploads signed BAK */
  async uploadSignedBak(clusterId: string, signedUrl: string, _userId: string) {
    void _userId; // FIX
    const bak = await this.prisma.bakAgreement.findUnique({
      where: { permitClusterId: clusterId }, // FIX
      include: { permitCluster: true }, // FIX
    });
    if (!bak) throw new NotFoundException('BAK tidak ditemukan'); // FIX

    const allowedUploadStatuses: BakAgreementStatus[] = [ // FIX: includes re-upload after PM or Admin rejection
      BakAgreementStatus.PDF_GENERATED,
      BakAgreementStatus.PM_REJECTED,
      BakAgreementStatus.ADMIN_REJECTED,
    ];
    if (!allowedUploadStatuses.includes(bak.status)) {
      throw new BadRequestException(`Tidak bisa upload dari status ${bak.status}`); // FIX
    }

    const prevStatus = bak.status; // FIX
    const updated = await this.prisma.bakAgreement.update({
      where: { id: bak.id }, // FIX
      data: {
        signedPdfUrl: signedUrl, // FIX
        status: BakAgreementStatus.PM_REVIEW, // FIX: always go back to PM_REVIEW
        pmNotes: null, // FIX: clear previous PM rejection notes on re-upload
      },
    });

    const isRevision = // FIX
      prevStatus === BakAgreementStatus.PM_REJECTED ||
      prevStatus === BakAgreementStatus.ADMIN_REJECTED;

    const pmRole = pmRoleForFiber(bak.permitCluster?.fiberType); // FIX
    await this.notificationsService.createForRole(pmRole, {
      title: isRevision ? '📋 BAK Revisi Perlu Review (PM)' : '📋 BAK Perlu Review (PM)', // FIX
      message: isRevision // FIX
        ? `Surveyor mengupload REVISI BAK untuk cluster ${bak.permitCluster?.clusterCode}. Silakan review ulang.`
        : `Surveyor mengupload BAK untuk cluster ${bak.permitCluster?.clusterCode}. Silakan review.`,
      type: 'PERMIT_FLOW', // FIX
      link: `/permit-clusters/${clusterId}`, // FIX
      entityId: clusterId, // FIX
    });

    return updated; // FIX
  }

  /** FIX: PM approves BAK */
  async pmApprove(clusterId: string, userId: string) {
    const bak = await this.prisma.bakAgreement.findUnique({
      where: { permitClusterId: clusterId }, // FIX
      include: { permitCluster: true }, // FIX
    });
    if (!bak) throw new NotFoundException(); // FIX

    const updated = await this.prisma.bakAgreement.update({
      where: { id: bak.id }, // FIX
      data: {
        status: BakAgreementStatus.ADMIN_REVIEW, // FIX
        pmApprovedBy: userId, // FIX
        pmApprovedAt: new Date(), // FIX
      },
    });

    await this.notificationsService.createForRole(Role.ADMIN, {
      // FIX
      title: '📋 BAK Perlu Review (Admin)', // FIX
      message: `PM menyetujui BAK cluster ${bak.permitCluster?.clusterCode}. Silakan review final.`, // FIX
      type: 'PERMIT_FLOW', // FIX
      link: `/permit-clusters/${clusterId}`, // FIX
      entityId: clusterId, // FIX
    });

    return updated; // FIX
  }

  /** FIX: PM rejects BAK → back to Surveyor */
  async pmReject(clusterId: string, notes: string, userId: string) {
    const bak = await this.prisma.bakAgreement.findUnique({
      where: { permitClusterId: clusterId }, // FIX
      include: { permitCluster: true }, // FIX
    });
    if (!bak) throw new NotFoundException(); // FIX

    const updated = await this.prisma.bakAgreement.update({
      where: { id: bak.id }, // FIX
      data: {
        status: BakAgreementStatus.PM_REJECTED, // FIX
        pmNotes: notes, // FIX
        pmApprovedBy: userId, // FIX
      },
    });

    const surveyors = await this.prisma.user.findMany({
      where: { role: { in: [Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT] } }, // FIX
    });
    await Promise.all(
      surveyors.map((s) =>
        this.notificationsService.createForUser(s.id, {
          // FIX
          title: '↺ BAK Perlu Revisi (PM)', // FIX
          message: `PM menolak BAK cluster ${bak.permitCluster?.clusterCode}. Catatan: ${notes}`, // FIX
          type: 'PERMIT_FLOW', // FIX
          link: `/permit-clusters/${clusterId}`, // FIX
          entityId: clusterId, // FIX
        }),
      ),
    );

    return updated; // FIX
  }

  /** FIX: Admin approves BAK → advance phase */
  async adminApprove(clusterId: string, userId: string) {
    const bak = await this.prisma.bakAgreement.findUnique({
      where: { permitClusterId: clusterId }, // FIX
      include: { permitCluster: true }, // FIX
    });
    if (!bak) throw new NotFoundException(); // FIX

    const updated = await this.prisma.bakAgreement.update({
      where: { id: bak.id }, // FIX
      data: {
        status: BakAgreementStatus.APPROVED, // FIX
        adminApprovedBy: userId, // FIX
        adminApprovedAt: new Date(), // FIX
      },
    });

    await this.permitClusterService.advancePhaseInternal(clusterId, 'BAKP_COMPILATION'); // FIX

    await this.bakpService.initBakp(clusterId, userId); // FIX: auto-init BAKP + checklist flags for surveyor

    const surveyors = await this.prisma.user.findMany({
      where: {
        role: { in: [Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT] }, // FIX
        isActive: true, // FIX
      },
    }); // FIX
    await Promise.all(
      surveyors.map((s) =>
        this.notificationsService.createForUser(s.id, {
          title: '📋 BAKP Siap Diisi (Fase 17)', // FIX
          message: `BAK cluster ${bak.permitCluster?.clusterCode ?? clusterId} disetujui Admin. Silakan upload dokumen BAKP.`, // FIX
          type: 'PERMIT_FLOW', // FIX
          link: `/permit-clusters/${clusterId}`, // FIX
          entityId: clusterId, // FIX
        }),
      ),
    ); // FIX

    this.logger.log(`BAKP ensured after BAK Agreement admin approve for cluster ${clusterId}`); // FIX

    return updated; // FIX
  }

  /** FIX: Admin rejects BAK → back to Surveyor */
  async adminReject(clusterId: string, notes: string, _userId: string) {
    void _userId; // FIX
    const bak = await this.prisma.bakAgreement.findUnique({
      where: { permitClusterId: clusterId }, // FIX
      include: { permitCluster: true }, // FIX
    });
    if (!bak) throw new NotFoundException(); // FIX

    const updated = await this.prisma.bakAgreement.update({
      where: { id: bak.id }, // FIX
      data: {
        status: BakAgreementStatus.ADMIN_REJECTED, // FIX
        adminNotes: notes, // FIX
      },
    });

    const surveyors = await this.prisma.user.findMany({
      where: { role: { in: [Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT] } }, // FIX
    });
    await Promise.all(
      surveyors.map((s) =>
        this.notificationsService.createForUser(s.id, {
          // FIX
          title: '↺ BAK Perlu Revisi (Admin)', // FIX
          message: `Admin menolak BAK cluster ${bak.permitCluster?.clusterCode}. Catatan: ${notes}`, // FIX
          type: 'PERMIT_FLOW', // FIX
          link: `/permit-clusters/${clusterId}`, // FIX
          entityId: clusterId, // FIX
        }),
      ),
    );

    return updated; // FIX
  }
}

function clusterIdFallback(id: string) {
  return id.slice(0, 8); // FIX
}

function pmRoleForFiber(
  fiber: { toString(): string } | string | null | undefined,
): Role {
  const f = String(fiber ?? 'FTTH'); // FIX
  if (f === 'FTTB') return Role.PM_FTTB; // FIX
  if (f === 'FTTT') return Role.PM_FTTT; // FIX
  return Role.PM_FTTH; // FIX
}
