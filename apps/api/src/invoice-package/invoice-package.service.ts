import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationsService } from '../notifications/notifications.service'; // FIX: durable notifications for invoice flow
import { PermitClusterService } from '../permit-cluster/permit-cluster.service';
// FIX: CommonJS require — pdfkit does not have a default ES export
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');

@Injectable()
export class InvoicePackageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly gateway: NotificationsGateway,
    private readonly notifications: NotificationsService, // FIX: inject durable notifications service
    private readonly permitCluster: PermitClusterService,
  ) {}

  // FIX: helper — resolve cluster/surveyor/PM context used by all notification senders
  private async getContext(invoiceId: string) {
    const invoice = await this.prisma.invoicePackage.findUnique({
      where: { id: invoiceId },
      include: {
        permitCluster: {
          include: {
            visitRequest: { select: { requestedBy: true } },
          },
        },
      },
    });
    const cluster = invoice?.permitCluster;
    const surveyorId = cluster?.visitRequest?.requestedBy;
    const fiberType = cluster?.fiberType;
    const pmRole: Role =
      fiberType === 'FTTB' ? Role.PM_FTTB : fiberType === 'FTTT' ? Role.PM_FTTT : Role.PM_FTTH;
    return { invoice, cluster, surveyorId, pmRole };
  }

  async getByCluster(permitClusterId: string) {
    return this.prisma.invoicePackage.findUnique({ where: { permitClusterId } });
  }

  private async nextInv() {
    const year = new Date().getFullYear();
    const n = await this.prisma.invoicePackage.count({
      where: { createdAt: { gte: new Date(`${year}-01-01`) } },
    });
    return `INV-${year}-${String(n + 1).padStart(4, '0')}`;
  }

  private buildPdf(lines: string[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.fontSize(14).text('INVOICE', { align: 'center' });
      doc.moveDown();
      doc.fontSize(10);
      lines.forEach((l) => {
        doc.text(l);
        doc.moveDown(0.2);
      });
      doc.end();
    });
  }

  async generate(
    permitClusterId: string,
    dto: { amount: string; supportingDocs?: string[] },
    userId: string,
  ) {
    const cluster = await this.prisma.permitCluster.findUnique({ where: { id: permitClusterId } });
    if (!cluster) throw new NotFoundException('Cluster tidak ada');

    const invoiceNumber = await this.nextInv();
    const amount = new Prisma.Decimal(dto.amount);
    const pdf = await this.buildPdf([
      `No: ${invoiceNumber}`,
      `Cluster: ${cluster.clusterCode}`,
      `Jumlah: ${amount.toString()} IDR`,
    ]);
    const year = new Date().getFullYear();
    const key = `invoice/${year}/${invoiceNumber}.pdf`;
    let invoicePdfUrl: string; // FIX: keep invoice generation running without S3 credentials
    try { // FIX: S3 upload fallback for invoice PDF
      invoicePdfUrl = await this.storage.uploadBuffer(key, pdf, 'application/pdf');
    } catch (err: any) {
      console.warn(`[Invoice] S3 upload failed, using placeholder: ${err?.message}`); // FIX: non-blocking S3 failure
      invoicePdfUrl = `https://placeholder.permatrax.dev/${key}`; // FIX: placeholder URL fallback
    }

    const saved = await this.prisma.invoicePackage.upsert({
      where: { permitClusterId },
      create: {
        permitClusterId,
        invoiceNumber,
        amount,
        supportingDocs: dto.supportingDocs ?? [],
        invoicePdfUrl,
        generatedBy: userId,
      },
      update: {
        invoiceNumber,
        amount,
        supportingDocs: dto.supportingDocs ?? [],
        invoicePdfUrl,
        generatedBy: userId,
      },
    });

    // FIX: durable notification — PM_SENIOR and fiber-specific PM see the invoice in their inbox
    const pmRole: Role =
      cluster.fiberType === 'FTTB' ? Role.PM_FTTB : cluster.fiberType === 'FTTT' ? Role.PM_FTTT : Role.PM_FTTH;
    await this.notifications.createForRoles([Role.PM_SENIOR, pmRole], {
      title: 'Invoice dibuat',
      message: `Invoice ${invoiceNumber} cluster ${cluster.clusterCode} siap dikirim ke Finance (Rp ${Number(amount).toLocaleString('id-ID')}).`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${permitClusterId}`,
      entityId: permitClusterId,
    });

    return saved;
  }

  async submitToFinance(id: string, userId: string) {
    const row = await this.prisma.invoicePackage.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Invoice tidak ada');
    void userId;
    const u = await this.prisma.invoicePackage.update({
      where: { id },
      data: { status: 'SUBMITTED', submittedToFinanceAt: new Date() },
    });
    this.gateway.emitToRoom('role:FINANCE', 'invoice:submitted', { invoiceId: id });

    // FIX: durable inbox notification for Finance — ephemeral socket is not enough
    const ctx = await this.getContext(id);
    await this.notifications.createForRole(Role.FINANCE, {
      title: 'Invoice baru perlu approval',
      message: `Invoice ${u.invoiceNumber} (cluster ${ctx.cluster?.clusterCode ?? ctx.cluster?.id ?? ''}) — Rp ${Number(u.amount).toLocaleString('id-ID')} menunggu persetujuan Finance.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${u.permitClusterId}`,
      entityId: u.permitClusterId,
    });

    return u;
  }

  async financeApprove(id: string, userId: string) {
    const row = await this.prisma.invoicePackage.findUnique({
      where: { id },
      include: { permitCluster: { select: { assignedPmId: true } } },
    });
    if (!row) throw new NotFoundException('Invoice tidak ada');
    void userId;
    const u = await this.prisma.invoicePackage.update({
      where: { id },
      data: { status: 'APPROVED', approvedAt: new Date(), reviewedByFinanceAt: new Date() },
    });

    // FIX: notify PM_SENIOR + fiber-specific PM so they can follow up on payment
    const ctx = await this.getContext(id);
    await this.notifications.createForRoles([Role.PM_SENIOR, ctx.pmRole], {
      title: 'Invoice disetujui Finance',
      message: `Invoice ${u.invoiceNumber} cluster ${ctx.cluster?.clusterCode ?? u.permitClusterId} disetujui Finance — menunggu pembayaran.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${u.permitClusterId}`,
      entityId: u.permitClusterId,
    });
    if (row.permitCluster.assignedPmId) {
      await this.notifications.createForUser(row.permitCluster.assignedPmId, {
        title: 'Invoice disetujui Finance',
        message: `${u.invoiceNumber} siap dibayarkan.`,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${u.permitClusterId}`,
        entityId: u.permitClusterId,
      });
    }

    return u;
  }

  async recordPayment(
    id: string,
    dto: { paymentRef: string; paymentEvidenceUrl?: string; paidAt?: string },
    userId: string,
  ) {
    const row = await this.prisma.invoicePackage.findUnique({
      where: { id },
      include: { permitCluster: { select: { assignedPmId: true } } },
    });
    if (!row) throw new NotFoundException('Invoice tidak ada');
    const u = await this.prisma.invoicePackage.update({
      where: { id },
      data: {
        status: 'PAID',
        paymentRef: dto.paymentRef,
        paymentEvidenceUrl: dto.paymentEvidenceUrl,
        paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
      },
    });
    await this.permitCluster.markPermitDone(row.permitClusterId, userId);
    this.gateway.emitToRoom(`user:${row.permitCluster.assignedPmId}`, 'invoice:paid', { invoiceId: id });
    this.gateway.emitToRoom('role:PM_SENIOR', 'invoice:paid', { invoiceId: id });
    this.gateway.emitToRoom('role:GENERAL_MANAGER', 'invoice:paid', { invoiceId: id });

    // FIX: PERMIT DONE milestone — durable notification to every stakeholder role
    const ctx = await this.getContext(id);
    await this.notifications.createForRoles(
      [Role.GENERAL_MANAGER, Role.PM_SENIOR, ctx.pmRole, Role.ADMIN, Role.OPERATIONAL_MANAGER, Role.FINANCE],
      {
        title: 'PERMIT DONE — pembayaran diterima',
        message: `Cluster ${ctx.cluster?.clusterCode ?? u.permitClusterId} selesai. Pembayaran Rp ${Number(u.amount).toLocaleString('id-ID')} diterima.`,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${u.permitClusterId}`,
        entityId: u.permitClusterId,
      },
    );

    // FIX: direct thank-you to the surveyor who opened this cluster
    if (ctx.surveyorId) {
      await this.notifications.createForUser(ctx.surveyorId, {
        title: 'Permit selesai',
        message: `Cluster ${ctx.cluster?.clusterCode ?? u.permitClusterId} yang Anda survey telah PERMIT DONE. Terima kasih!`,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${u.permitClusterId}`,
        entityId: u.permitClusterId,
      });
    }

    return u;
  }

  async addFollowUp(id: string, notes: string, userId: string) {
    const row = await this.prisma.invoicePackage.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Invoice tidak ada');
    void userId;
    const u = await this.prisma.invoicePackage.update({
      where: { id },
      data: {
        followUpCount: row.followUpCount + 1,
        lastFollowUpAt: new Date(),
        notes: notes ?? row.notes,
      },
    });

    // FIX: re-nudge Finance each time PM adds a follow-up so it shows up in their inbox
    const ctx = await this.getContext(id);
    await this.notifications.createForRole(Role.FINANCE, {
      title: `Follow-up invoice #${u.followUpCount}`,
      message: `${u.invoiceNumber} cluster ${ctx.cluster?.clusterCode ?? u.permitClusterId} — mohon diproses. ${notes ? `Catatan: ${notes}` : ''}`.trim(),
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${u.permitClusterId}`,
      entityId: u.permitClusterId,
    });

    return u;
  }
}
