import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull'; // NEW: queue injection for async bundle PDF generation
import { Queue } from 'bull'; // NEW: Bull queue type
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { PermitClusterService } from '../permit-cluster/permit-cluster.service';
import { BakpIspDecision, BakpStatus, PermitPhase, Role } from '@prisma/client'; // FIX: PermitPhase for adminApproveBakp phase advance
import { BAKP_PDF_QUEUE } from './bakp.processor'; // NEW: BAKP PDF queue constant
import { runSerializableTransaction } from '../budget-ledger/transaction-retry.util';
import { BAKP_ALL_DOCS, BAKP_MANDATORY_KEYS } from './bakp.constants';
import { BakpMergeService } from './bakp-merge.service';
import { IspEmailService } from '../isp-email/isp-email.service';

@Injectable()
export class BakpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
    private readonly notifications: NotificationsService,
    private readonly permitCluster: PermitClusterService,
    @InjectQueue(BAKP_PDF_QUEUE) private readonly pdfQueue: Queue, // NEW: BAKP PDF queue dependency
    private readonly bakpMergeService: BakpMergeService,
    private readonly ispEmailService: IspEmailService,
  ) {}

  private appendAuditLog(existing: unknown, action: string, actorId: string, note?: string): object[] {
    const base = Array.isArray(existing) ? existing : [];
    return [
      ...base,
      {
        action,
        actorId,
        note: note ?? null,
        at: new Date().toISOString(),
      },
    ];
  }

  private async loadClusterForUser(clusterId: string, userId: string, userRole: Role) {
    const pc = await this.prisma.permitCluster.findUnique({
      where: { id: clusterId },
      include: {
        baOpen: true,
        socialization: true,
        bak: true,
        scom: true,
        visitRequest: { select: { requestedBy: true } },
      },
    });
    if (!pc) throw new NotFoundException('Cluster tidak ditemukan');
    // FIX: align access policy with permit-cluster service (PM by fiber, not only assigned PM)
    if (([Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT] as Role[]).includes(userRole)) {
      const expectedFiber = String(userRole).replace('PM_', '');
      if (pc.fiberType !== expectedFiber) {
        throw new ForbiddenException('Akses ditolak');
      }
    }
    return pc;
  }

  private computeChecklist(cluster: any, bakp: any) {
    const hasBAOpen = !!cluster.baOpen?.pdfUrl;
    const hasBASurvey = !!cluster.socialization?.baSurveyPdfUrl;
    const hasBASocialization = !!cluster.socialization?.momPdfUrl;
    const bak = cluster.bak;
    // FIX: always coerce to boolean, never null (Prisma non-null boolean column)
    const hasApprovedBAK = !!(bak && ['APPROVED', 'AUTO_APPROVED'].includes(bak.status));
    const hasSignedBAK = bak?.status === 'SIGNATURES_VALID';
    const hasPks = !!cluster.scom?.pksSignedUrl || !!cluster.scom?.momPdfUrl;

    return {
      hasBAOpen,
      hasBASurvey,
      hasBASocialization,
      hasApprovedBAK,
      hasSignedBAK,
      hasPks,
      hasTransferProof: bakp.hasTransferProof,
      hasReceipt: bakp.hasReceipt,
      hasPaymentPhoto: bakp.hasPaymentPhoto,
      hasRtRwKtp: bakp.hasRtRwKtp,
      hasRtRwSk: bakp.hasRtRwSk,
      hasSip: bakp.hasSip,
    };
  }

  async initBakp(permitClusterId: string, compiledBy: string) {
    const cluster = await this.prisma.permitCluster.findUnique({
      where: { id: permitClusterId }, // FIX
      include: { baOpen: true, socialization: true, bak: true, scom: true }, // FIX
    });
    if (!cluster) throw new NotFoundException('Cluster tidak ditemukan'); // FIX

    const existing = await this.prisma.bakp.findUnique({ where: { permitClusterId } }); // FIX
    if (existing) {
      const flags = this.computeChecklist(cluster, existing); // FIX
      return this.prisma.bakp.update({
        where: { id: existing.id }, // FIX
        data: {
          hasBAOpen: flags.hasBAOpen, // FIX
          hasBASurvey: flags.hasBASurvey, // FIX
          hasBASocialization: flags.hasBASocialization, // FIX
          hasApprovedBAK: flags.hasApprovedBAK, // FIX
          hasSignedBAK: flags.hasSignedBAK, // FIX
          hasPks: flags.hasPks, // FIX
        },
        include: { participants: true }, // FIX: stable API shape
      });
    }

    const laterPhases: PermitPhase[] = [
      PermitPhase.BAKP_COMPILATION, // FIX
      PermitPhase.CLAIM_SUBMISSION, // FIX
      PermitPhase.INVOICE_PACKAGE, // FIX
      PermitPhase.PERMIT_DONE, // FIX
    ];
    if (!laterPhases.includes(cluster.currentPhase)) {
      throw new BadRequestException(`BAKP tidak dapat dibuat pada fase ${cluster.currentPhase}`); // FIX
    }

    const year = new Date().getFullYear(); // FIX
    const count = await this.prisma.bakp.count({
      where: { createdAt: { gte: new Date(`${year}-01-01`) } }, // FIX
    });
    const documentNumber = `BAKP-${year}-${String(count + 1).padStart(4, '0')}`; // FIX

    const placeholder = await this.prisma.bakp.create({
      data: {
        permitClusterId, // FIX
        documentNumber, // FIX
        status: 'DRAFT', // FIX
        compiledBy, // FIX
      },
    });

    const flags = this.computeChecklist(cluster, placeholder); // FIX
    return this.prisma.bakp.update({
      where: { id: placeholder.id }, // FIX
      data: {
        hasBAOpen: flags.hasBAOpen, // FIX
        hasBASurvey: flags.hasBASurvey, // FIX
        hasBASocialization: flags.hasBASocialization, // FIX
        hasApprovedBAK: flags.hasApprovedBAK, // FIX
        hasSignedBAK: flags.hasSignedBAK, // FIX
        hasPks: flags.hasPks, // FIX
      },
      include: { participants: true }, // FIX
    });
  }

  /** FIX: load BAKP; auto-init only in phase ≥ BAKP_COMPILATION when caller is allowed */
  async getBakp(clusterId: string, userId: string, userRole: Role) {
    await this.loadClusterForUser(clusterId, userId, userRole); // FIX

    let row = await this.prisma.bakp.findUnique({
      where: { permitClusterId: clusterId }, // FIX
      include: { participants: true }, // FIX
    });

    if (!row) {
      const allowedInit: Role[] = [
        Role.SURVEYOR_FTTH, // FIX
        Role.SURVEYOR_FTTB, // FIX
        Role.SURVEYOR_FTTT, // FIX
        Role.PM_FTTH, // FIX
        Role.PM_FTTB, // FIX
        Role.PM_FTTT, // FIX
        Role.PM_SENIOR, // FIX
        Role.ADMIN, // FIX
        Role.GENERAL_MANAGER, // FIX
        Role.FINANCE, // FIX
        Role.OPERATIONAL_MANAGER, // FIX
      ];
      if (!allowedInit.includes(userRole)) {
        return null; // FIX
      }

      const pc = await this.prisma.permitCluster.findUnique({
        where: { id: clusterId }, // FIX
        select: { currentPhase: true }, // FIX
      });
      const laterPhases: PermitPhase[] = [
        PermitPhase.BAKP_COMPILATION, // FIX
        PermitPhase.CLAIM_SUBMISSION, // FIX
        PermitPhase.INVOICE_PACKAGE, // FIX
        PermitPhase.PERMIT_DONE, // FIX
      ];
      if (!pc || !laterPhases.includes(pc.currentPhase)) {
        return null; // FIX
      }

      await this.initBakp(clusterId, userId); // FIX

      row = await this.prisma.bakp.findUnique({
        where: { permitClusterId: clusterId }, // FIX
        include: { participants: true }, // FIX
      });
    }

    return row; // FIX: may still be null if race; caller handles
  }

  /** FIX: ensure BAKP row belongs to URL cluster (tamper-resistant routes) */
  private async assertBakpInCluster(clusterId: string, bakpId: string) {
    const bakp = await this.prisma.bakp.findFirst({
      where: { id: bakpId, permitClusterId: clusterId },
    });
    if (!bakp) throw new NotFoundException('BAKP tidak ditemukan');
    return bakp;
  }

  private pmRoleForFiber(fiberType: string | null | undefined): Role {
    return fiberType === 'FTTB' ? Role.PM_FTTB : fiberType === 'FTTT' ? Role.PM_FTTT : Role.PM_FTTH;
  }

  // FIX: Surveyor field-team-submit — uploads complete → PM review
  async fieldTeamSubmit(clusterId: string, bakpId: string, userId: string) {
    const bakp = await this.assertBakpInCluster(clusterId, bakpId);
    const full = await this.prisma.bakp.findUnique({
      where: { id: bakpId },
      include: { permitCluster: true },
    });
    if (!full) throw new NotFoundException('BAKP tidak ditemukan');

    const allowed: BakpStatus[] = [
      BakpStatus.DRAFT,
      BakpStatus.REJECTED_BY_PM,
      BakpStatus.REJECTED_BY_ADMIN,
      BakpStatus.REJECTED_BY_ISP,
    ];
    if (!allowed.includes(full.status)) {
      throw new BadRequestException(`Tidak bisa submit dari status ${full.status}`);
    }

    const docs = (full.docBakpUrls as Record<string, string> | null) ?? {};
    const missingMandatory = BAKP_ALL_DOCS.filter((doc) => BAKP_MANDATORY_KEYS.has(doc.key) && !docs[doc.key]);
    if (missingMandatory.length > 0) {
      throw new BadRequestException(
        `Dokumen kompensasi wajib belum lengkap: ${missingMandatory.map((d) => d.label).join(', ')}`,
      );
    }

    const mergedUrl = await this.bakpMergeService.mergeDocuments(
      full.documentNumber,
      Object.entries(docs).map(([key, url]) => ({ key, url })),
    );

    const updated = await this.prisma.bakp.update({
      where: { id: bakpId },
      data: {
        status: BakpStatus.SUBMITTED_TO_PM,
        fieldTeamSubmittedAt: new Date(),
        fieldTeamSubmittedBy: userId,
        pmRejectionReason: null,
        adminRejectionReason: null,
        ispRejectionReason: null,
        finalMergedPdfUrl: mergedUrl,
        bundlePdfUrl: mergedUrl,
        approvalLogs: this.appendAuditLog(full.approvalLogs, 'SUBMIT_TO_PM', userId),
      },
    });

    const pmRole = this.pmRoleForFiber(full.permitCluster?.fiberType);
    await this.notifications.createForRole(pmRole, {
      title: '📋 BAKP Perlu Review (PM)',
      message: `Surveyor submit BAKP cluster ${full.permitCluster?.clusterCode ?? clusterId}. Silakan review.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${full.permitClusterId}`,
      entityId: full.permitClusterId,
    });

    return updated;
  }

  // FIX: PM approves BAKP → Admin final review
  async pmApproveBakp(clusterId: string, bakpId: string, userId: string) {
    const bakp = await this.assertBakpInCluster(clusterId, bakpId);
    const full = await this.prisma.bakp.findUnique({
      where: { id: bakpId },
      include: { permitCluster: true },
    });
    if (!full) throw new NotFoundException('BAKP tidak ditemukan');
    if (bakp.status === BakpStatus.PM_APPROVED || bakp.status === BakpStatus.SUBMITTED_TO_ADMIN) {
      return bakp;
    }
    if (bakp.status !== BakpStatus.SUBMITTED_TO_PM) {
      throw new BadRequestException('Status tidak valid untuk approval PM');
    }

    const now = new Date();
    const updated = await this.prisma.bakp.update({
      where: { id: bakpId },
      data: {
        status: BakpStatus.SUBMITTED_TO_ADMIN,
        pmApprovedAt: now,
        pmApprovedBy: userId,
        pmBakpApprovedAt: now,
        pmBakpApprovedBy: userId,
        approvalLogs: this.appendAuditLog(full.approvalLogs, 'PM_APPROVE', userId),
      },
    });

    await this.notifications.createForRole(Role.ADMIN, {
      title: '📋 BAKP Perlu Review (Admin)',
      message: `PM approve BAKP cluster ${full.permitCluster?.clusterCode ?? clusterId}. Silakan review final.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${full.permitClusterId}`,
      entityId: full.permitClusterId,
    });

    return updated;
  }

  // FIX: PM rejects BAKP → back to Surveyor
  async pmRejectBakp(clusterId: string, bakpId: string, reason: string, userId: string) {
    const bakp = await this.assertBakpInCluster(clusterId, bakpId);
    const full = await this.prisma.bakp.findUnique({
      where: { id: bakpId },
      include: { permitCluster: true },
    });
    if (!full) throw new NotFoundException('BAKP tidak ditemukan');

    const updated = await this.prisma.bakp.update({
      where: { id: bakpId },
      data: {
        status: BakpStatus.REJECTED_BY_PM,
        pmRejectedAt: new Date(),
        pmRejectionReason: reason,
        approvalLogs: this.appendAuditLog(full.approvalLogs, 'PM_REJECT', userId, reason),
      },
    });

    const surveyors = await this.prisma.user.findMany({ where: { role: { in: [Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT] }, isActive: true } });
    await Promise.all(
      surveyors.map((s) =>
        this.notifications.createForUser(s.id, {
          title: '↺ BAKP Perlu Revisi (PM)',
          message: `PM tolak BAKP cluster ${full.permitCluster?.clusterCode ?? clusterId}. Alasan: ${reason}`,
          type: 'PERMIT_FLOW',
          link: `/permit-clusters/${full.permitClusterId}`,
          entityId: full.permitClusterId,
        }),
      ),
    );

    return updated;
  }

  // FIX: Admin approves BAKP → advance to CLAIM_SUBMISSION
  async adminApproveBakp(clusterId: string, bakpId: string, userId: string) {
    const bakp = await this.assertBakpInCluster(clusterId, bakpId);
    const full = await this.prisma.bakp.findUnique({
      where: { id: bakpId },
      include: { permitCluster: true },
    });
    if (!full) throw new NotFoundException('BAKP tidak ditemukan');
    if (bakp.status === BakpStatus.ADMIN_APPROVED || bakp.status === BakpStatus.SUBMITTED_TO_ISP) {
      return bakp;
    }
    if (bakp.status !== BakpStatus.SUBMITTED_TO_ADMIN) {
      throw new BadRequestException('Status tidak valid untuk approval Admin');
    }

    const now = new Date();
    const updated = await this.prisma.bakp.update({
      where: { id: bakpId },
      data: {
        status: BakpStatus.SUBMITTED_TO_ISP,
        adminApprovedAt: now,
        adminApprovedBy: userId,
        adminBakpApprovedAt: now,
        adminBakpApprovedBy: userId,
        ispSubmittedAt: now,
        ispSubmittedBy: userId,
        approvalLogs: this.appendAuditLog(full.approvalLogs, 'ADMIN_APPROVE_SUBMIT_ISP', userId),
      },
    });

    await this.ispEmailService.sendDocumentsToIsp(full.permitClusterId, userId, {
      subject: `Pengajuan BAKP ${full.documentNumber} untuk persetujuan ISP`,
      message: 'Mohon review dokumen BAKP terlampir pada tautan.',
      docUrls: [updated.finalMergedPdfUrl ?? updated.bundlePdfUrl].filter((v): v is string => !!v),
    });

    const pmRole = this.pmRoleForFiber(full.permitCluster?.fiberType);
    await this.notifications.createForRole(pmRole, {
      title: '📨 BAKP Dikirim ke ISP',
      message: `BAKP ${full.permitCluster?.clusterCode ?? clusterId} dikirim ke ISP. Menunggu keputusan ISP.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${full.permitClusterId}`,
      entityId: full.permitClusterId,
    });

    return updated;
  }

  // FIX: Admin rejects BAKP → back to Surveyor
  async adminRejectBakp(clusterId: string, bakpId: string, reason: string, userId: string) {
    const bakp = await this.assertBakpInCluster(clusterId, bakpId);
    const full = await this.prisma.bakp.findUnique({
      where: { id: bakpId },
      include: { permitCluster: true },
    });
    if (!full) throw new NotFoundException('BAKP tidak ditemukan');

    const updated = await this.prisma.bakp.update({
      where: { id: bakpId },
      data: {
        status: BakpStatus.REJECTED_BY_ADMIN,
        adminRejectedAt: new Date(),
        adminRejectionReason: reason,
        approvalLogs: this.appendAuditLog(full.approvalLogs, 'ADMIN_REJECT', userId, reason),
      },
    });

    const surveyors = await this.prisma.user.findMany({
      where: {
        role: { in: [Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT] },
        isActive: true,
      },
    });
    await Promise.all(
      surveyors.map((s) =>
        this.notifications.createForUser(s.id, {
          title: '↺ BAKP Perlu Revisi (Admin)',
          message: `Admin tolak BAKP ${full.permitCluster?.clusterCode ?? clusterId}. Alasan: ${reason}`,
          type: 'PERMIT_FLOW',
          link: `/permit-clusters/${full.permitClusterId}`,
          entityId: full.permitClusterId,
        }),
      ),
    );

    return updated;
  }

  // FIX: single BAKP compilation doc into docBakpUrls JSON
  async uploadBakpDoc(clusterId: string, bakpId: string, docKey: string, fileUrl: string, _userId: string) {
    await this.assertBakpInCluster(clusterId, bakpId);
    const row = await this.prisma.bakp.findUnique({ where: { id: bakpId } });
    if (!row) throw new NotFoundException('BAKP tidak ditemukan');
    const def = BAKP_ALL_DOCS.find((d) => d.key === docKey);
    if (!def) {
      throw new BadRequestException('Jenis dokumen BAKP tidak valid');
    }
    const existing = (row.docBakpUrls as Record<string, string> | null) ?? {};
    const merged = { ...existing, [docKey]: fileUrl };
    return this.prisma.bakp.update({
      where: { id: bakpId },
      data: { docBakpUrls: merged as object },
    });
  }

  async recordIspDecision(
    clusterId: string,
    bakpId: string,
    decision: BakpIspDecision,
    actorId: string,
    reason?: string,
  ) {
    return runSerializableTransaction(this.prisma, async (tx) => {
      const bakp = await tx.bakp.findFirst({ where: { id: bakpId, permitClusterId: clusterId } });
      if (!bakp) throw new NotFoundException('BAKP tidak ditemukan');
      if (bakp.status === BakpStatus.DONE && decision === BakpIspDecision.ACCEPTED) return bakp;
      if (bakp.status !== BakpStatus.SUBMITTED_TO_ISP) {
        throw new BadRequestException('Status BAKP tidak berada pada tahap keputusan ISP');
      }

      const now = new Date();
      const updated = await tx.bakp.update({
        where: { id: bakpId },
        data: {
          status: decision === BakpIspDecision.ACCEPTED ? BakpStatus.DONE : BakpStatus.REJECTED_BY_ISP,
          ispDecision: decision,
          ispDecisionAt: now,
          ispDecisionBy: actorId,
          ispRejectionReason: decision === BakpIspDecision.REJECTED ? reason ?? 'Ditolak ISP' : null,
          approvalLogs: this.appendAuditLog(
            bakp.approvalLogs,
            decision === BakpIspDecision.ACCEPTED ? 'ISP_ACCEPTED' : 'ISP_REJECTED',
            actorId,
            reason,
          ),
        },
      });

      if (decision === BakpIspDecision.ACCEPTED) {
        await tx.permitCluster.update({
          where: { id: clusterId },
          data: { currentPhase: PermitPhase.PERMIT_DONE, status: 'COMPLETED', readyForConstructionAt: now },
        });
      }
      return updated;
    });
  }

  // FIX: materai toggle (Surveyor / PM — same as stempel participants)
  async updateRequiresMaterai(clusterId: string, bakpId: string, requiresMaterai: boolean) {
    await this.assertBakpInCluster(clusterId, bakpId);
    return this.prisma.bakp.update({
      where: { id: bakpId },
      data: { requiresMaterai },
    });
  }

  async uploadPaymentProof(
    bakpId: string,
    dto: {
      transferProofUrl?: string;
      receiptUrl?: string;
      paymentPhotoUrl?: string;
      paymentAmount?: string;
      paymentDate?: string;
    },
    _financeUserId: string,
  ) {
    const bakp = await this.prisma.bakp.findUnique({
      where: { id: bakpId },
      include: { permitCluster: true },
    });
    if (!bakp) throw new NotFoundException('BAKP tidak ada');

    const nextStatus: BakpStatus =
      bakp.status === BakpStatus.DRAFT ? BakpStatus.DRAFT : bakp.status;

    const updated = await this.prisma.bakp.update({
      where: { id: bakpId },
      data: {
        transferProofUrl: dto.transferProofUrl ?? bakp.transferProofUrl,
        receiptUrl: dto.receiptUrl ?? bakp.receiptUrl,
        paymentPhotoUrl: dto.paymentPhotoUrl ?? bakp.paymentPhotoUrl,
        paymentAmount: dto.paymentAmount ? dto.paymentAmount : bakp.paymentAmount,
        paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : bakp.paymentDate,
        hasTransferProof: !!(dto.transferProofUrl ?? bakp.transferProofUrl),
        hasReceipt: !!(dto.receiptUrl ?? bakp.receiptUrl),
        hasPaymentPhoto: !!(dto.paymentPhotoUrl ?? bakp.paymentPhotoUrl),
        status: nextStatus,
      },
    });

    this.gateway.emitToRoom('role:ADMIN', 'bakp:paymentUploaded', {
      bakpId,
      documentNumber: updated.documentNumber,
    });
    return updated;
  }

  async uploadManualDoc(
    bakpId: string,
    docType: 'rtRwKtp' | 'rtRwSk' | 'sip' | 'receipt',
    fileUrl: string,
    userId: string,
    userRole: Role,
  ) {
    if (
      !([Role.ADMIN, Role.PM_SENIOR, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT] as Role[]).includes(userRole)
    ) {
      throw new ForbiddenException('Tidak diizinkan');
    }
    const bakp = await this.prisma.bakp.findUnique({ where: { id: bakpId } });
    if (!bakp) throw new NotFoundException('BAKP tidak ada');

    const manual = (bakp.manualDocUrls as Record<string, string> | null) ?? {};
    manual[docType] = fileUrl;

    const data: any = { manualDocUrls: manual as any };
    if (docType === 'rtRwKtp') data.hasRtRwKtp = true;
    if (docType === 'rtRwSk') data.hasRtRwSk = true;
    if (docType === 'sip') data.hasSip = true;
    if (docType === 'receipt') data.hasReceipt = true;

    return this.prisma.bakp.update({ where: { id: bakpId }, data });
  }

  private mandatoryComplete(b: any): string[] {
    const miss: string[] = [];
    const fields: [keyof typeof b, string][] = [
      ['hasBAOpen', 'BA Open'],
      ['hasBASurvey', 'BA Survey'],
      ['hasBASocialization', 'MoM Sosialisasi'],
      ['hasApprovedBAK', 'BAK disetujui'],
      ['hasSignedBAK', 'Tanda tangan BAK valid'],
      ['hasRtRwKtp', 'KTP RT/RW'],
      ['hasRtRwSk', 'SK RT/RW'],
      ['hasSip', 'SIP'],
      ['hasPks', 'PKS / SCOM'],
      ['hasReceipt', 'Kuitansi / bukti'],
      ['hasTransferProof', 'Bukti transfer'],
      ['hasPaymentPhoto', 'Foto pembayaran'],
    ];
    for (const [k, label] of fields) {
      if (!b[k]) miss.push(label);
    }
    return miss;
  }

  async submitForValidation(bakpId: string, userId: string, userRole: Role) {
    if (!([Role.ADMIN, Role.PM_SENIOR] as Role[]).includes(userRole)) {
      throw new ForbiddenException('Hanya Admin atau PM Senior');
    }
    const bakp = await this.prisma.bakp.findUnique({
      where: { id: bakpId },
      include: {
        permitCluster: {
          include: { baOpen: true, socialization: true, bak: true, scom: true },
        },
      },
    });
    if (!bakp) throw new NotFoundException('BAKP tidak ada');

    const merged = await this.initBakp(bakp.permitClusterId, userId);
    const miss = this.mandatoryComplete(merged);
    if (miss.length) {
      throw new BadRequestException(`Belum lengkap: ${miss.join(', ')}`);
    }

    const updated = await this.prisma.bakp.update({
      where: { id: bakpId },
      data: { status: BakpStatus.SUBMITTED_TO_PM },
    });

    this.gateway.emitToRoom('role:ADMIN', 'bakp:submittedForValidation', {
      bakpId,
      documentNumber: updated.documentNumber,
    });
    const pc = bakp.permitCluster;
    const pmRole =
      pc.fiberType === 'FTTB' ? Role.PM_FTTB : pc.fiberType === 'FTTT' ? Role.PM_FTTT : Role.PM_FTTH;
    await this.notifications.createForRole(pmRole, {
      title: 'BAKP submitted — perlu review',
      message: `Dokumen ${updated.documentNumber} menunggu validasi`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${bakp.permitClusterId}`,
      entityId: bakp.permitClusterId,
    }); // FIX: PM inbox
    await this.notifications.createForRole(Role.ADMIN, {
      title: 'BAKP menunggu validasi',
      message: updated.documentNumber,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${bakp.permitClusterId}`,
      entityId: bakp.permitClusterId,
    });
    return updated;
  }

  async validateBakp(
    bakpId: string,
    action: 'APPROVE' | 'REJECT',
    notes: string | undefined,
    adminId: string,
  ) {
    const bakp = await this.prisma.bakp.findUnique({
      where: { id: bakpId },
      include: {
        permitCluster: {
          include: { baOpen: true, socialization: true, bak: true, scom: true },
        },
      },
    });
    if (!bakp) throw new NotFoundException('BAKP tidak ada');

    if (action === 'REJECT') {
      const u = await this.prisma.bakp.update({
        where: { id: bakpId },
        data: { status: BakpStatus.REJECTED_BY_ADMIN, rejectionReason: notes },
      });
      const vr = await this.prisma.visitRequest.findUnique({
        where: { id: bakp.permitCluster.visitRequestId },
      });
      this.gateway.emitToRoom(`user:${bakp.permitCluster.assignedPmId}`, 'bakp:revisionRequired', {
        bakpId,
      });
      if (vr?.requestedBy) {
        this.gateway.emitToRoom(`user:${vr.requestedBy}`, 'bakp:revisionRequired', { bakpId });
      }

      // FIX: durable notifications for PM + field team — gateway alone disappears on reconnect
      const pmRole: Role =
        bakp.permitCluster.fiberType === 'FTTB'
          ? Role.PM_FTTB
          : bakp.permitCluster.fiberType === 'FTTT'
            ? Role.PM_FTTT
            : Role.PM_FTTH;
      if (bakp.permitCluster.assignedPmId) {
        await this.notifications.createForUser(bakp.permitCluster.assignedPmId, {
          title: 'BAKP ditolak — revisi diperlukan',
          message: `${bakp.documentNumber} perlu revisi. ${notes ? `Catatan: ${notes}` : ''}`.trim(),
          type: 'PERMIT_FLOW',
          link: `/permit-clusters/${bakp.permitClusterId}`,
          entityId: bakp.permitClusterId,
        });
      }
      if (vr?.requestedBy) {
        await this.notifications.createForUser(vr.requestedBy, {
          title: 'BAKP ditolak — revisi diperlukan',
          message: `${bakp.documentNumber} perlu revisi lapangan. ${notes ? `Catatan: ${notes}` : ''}`.trim(),
          type: 'PERMIT_FLOW',
          link: `/permit-clusters/${bakp.permitClusterId}`,
          entityId: bakp.permitClusterId,
        });
      }
      await this.notifications.createForRole(pmRole, {
        title: 'BAKP ditolak — revisi diperlukan',
        message: `Cluster ${bakp.permitCluster.clusterCode ?? bakp.permitClusterId} — ${notes || 'tanpa catatan'}`,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${bakp.permitClusterId}`,
        entityId: bakp.permitClusterId,
      });

      return u;
    }

    const merged = await this.initBakp(bakp.permitClusterId, adminId);
    const miss = this.mandatoryComplete(merged);
    if (miss.length) {
      throw new BadRequestException(`Tidak lengkap: ${miss.join(', ')}`);
    }

    await this.pdfQueue.add( // NEW: dispatch BAKP bundle generation to Bull queue (non-blocking)
      'generate-bundle',
      { bakpId, adminId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );

    await this.prisma.bakp.update({
      where: { id: bakpId },
      data: {
        status: BakpStatus.DONE,
        validatedBy: adminId,
        validatedAt: new Date(),
        validationNotes: notes,
        compiledBy: adminId,
      },
    });

    await this.permitCluster.markConstructionReady(bakp.permitClusterId, adminId);

    this.gateway.emitToRoom(`user:${bakp.permitCluster.assignedPmId}`, 'bakp:approved', {
      bakpId,
      documentNumber: bakp.documentNumber,
    });
    this.gateway.emitToRoom('role:PM_SENIOR', 'bakp:approved', {
      bakpId,
      documentNumber: bakp.documentNumber,
    });
    this.gateway.emitToRoom('role:GENERAL_MANAGER', 'bakp:approved', {
      bakpId,
      documentNumber: bakp.documentNumber,
    });

    const vr = await this.prisma.visitRequest.findUnique({
      where: { id: bakp.permitCluster.visitRequestId },
      select: { requestedBy: true },
    });
    if (vr?.requestedBy) {
      await this.notifications.createForUser(vr.requestedBy, {
        title: 'BAKP approved — upload kompensasi',
        message: bakp.documentNumber,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${bakp.permitClusterId}`,
        entityId: bakp.permitClusterId,
      });
    }
    if (bakp.permitCluster.assignedPmId) {
      await this.notifications.createForUser(bakp.permitCluster.assignedPmId, {
        title: 'BAKP approved Admin',
        message: 'Lanjutkan alur kompensasi / klaim',
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${bakp.permitClusterId}`,
        entityId: bakp.permitClusterId,
      });
    }

    return this.prisma.bakp.findUnique({ where: { id: bakpId } });
  }

  getBakpChecklist(bakp: any) {
    const labels: Record<string, string> = {
      hasBAOpen: 'BA Open',
      hasBASurvey: 'BA Survey',
      hasBASocialization: 'MoM Sosialisasi',
      hasApprovedBAK: 'BAK disetujui',
      hasSignedBAK: 'Tanda tangan valid',
      hasRtRwKtp: 'KTP RT/RW',
      hasRtRwSk: 'SK RT/RW',
      hasSip: 'SIP',
      hasPks: 'PKS',
      hasReceipt: 'Kuitansi',
      hasTransferProof: 'Bukti transfer',
      hasPaymentPhoto: 'Foto pembayaran',
    };
    const urls: Record<string, keyof typeof bakp | 'manual'> = {
      hasBAOpen: 'baOpenPdf',
      hasBASurvey: 'baSurveyPdf',
    };
    void urls;
    return Object.entries(labels).map(([fieldName, label]) => ({
      fieldName,
      label,
      required: true,
      completed: !!(bakp as any)[fieldName],
      fileUrl: null as string | null,
    }));
  }

  async getChecklistDto(bakpId: string) {
    const b = await this.prisma.bakp.findUnique({ where: { id: bakpId } });
    if (!b) throw new NotFoundException('BAKP tidak ada');
    const enriched = await this.initBakp(b.permitClusterId, b.compiledBy ?? b.id);
    return this.getBakpChecklist(enriched);
  }

  async resolveDownload(clusterId: string, userId: string, userRole: Role) {
    await this.loadClusterForUser(clusterId, userId, userRole);
    const bakp = await this.prisma.bakp.findUnique({ where: { permitClusterId: clusterId } });
    if (!bakp?.bundlePdfUrl) throw new BadRequestException('Bundle belum tersedia');
    return { pdfUrl: bakp.bundlePdfUrl, documentNumber: bakp.documentNumber };
  }

  /** FIX: used by @Public() download route — no JWT; security by cluster id obscurity (internal tool) */
  async resolveDownloadPublic(clusterId: string) {
    const bakp = await this.prisma.bakp.findUnique({ where: { permitClusterId: clusterId } });
    if (!bakp?.bundlePdfUrl) throw new BadRequestException('Bundle belum tersedia');
    return { pdfUrl: bakp.bundlePdfUrl, documentNumber: bakp.documentNumber };
  }

  async addParticipant(bakpId: string, dto: { name: string; role: string; ktpNumber?: string; ktpPhotoUrl?: string }) {
    await this.prisma.bakpParticipant.create({ data: { bakpId, name: dto.name, role: dto.role, ktpNumber: dto.ktpNumber, ktpPhotoUrl: dto.ktpPhotoUrl } }); // NEW: add BAKP participant
    return this.prisma.bakpParticipant.findMany({ where: { bakpId }, orderBy: { createdAt: 'asc' } });
  }

  async removeParticipant(bakpId: string, participantId: string) {
    await this.prisma.bakpParticipant.delete({ where: { id: participantId } });
    return this.prisma.bakpParticipant.findMany({ where: { bakpId }, orderBy: { createdAt: 'asc' } }); // NEW: remove participant
  }

  async uploadStempel(bakpId: string, stempelUrl: string) {
    return this.prisma.bakp.update({ where: { id: bakpId }, data: { stempelUrl } }); // NEW: store stamp file URL
  }
}
