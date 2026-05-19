import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ClaimStatus, PermitPhase, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { PermitClusterService } from '../permit-cluster/permit-cluster.service';

@Injectable()
export class ClaimPackageService {
  private readonly STREAM_A_DOCS = [
    'docMom', 'docBaOpen', 'docBaAcara', 'docBaTtdRt', 'docFcBukuTabungan',
    'docSip', 'docKtpRtRw', 'docPks', 'docKwitansi', 'docEvidancePayment', 'docBuktiTrf', 'docSkInternal', 'docPoSpk',
  ] as const; // NEW: stream A document keys
  private readonly STREAM_B_DOCS = [
    'docBaOpenLengkap', 'docKwitansiGov', 'docFotoEvidance', 'docEvidancePaymentGov', 'docSkInternalGov', 'docPoSpkGov',
  ] as const; // NEW: stream B document keys
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
    private readonly notifications: NotificationsService,
    private readonly permitCluster: PermitClusterService,
  ) {}

  async findByCluster(permitClusterId: string) {
    return this.prisma.claimPackage.findUnique({ where: { permitClusterId } });
  }

  private async seq(year: number) {
    const n = await this.prisma.claimPackage.count({
      where: { createdAt: { gte: new Date(`${year}-01-01`) } },
    });
    return `CLAIM-${year}-${String(n + 1).padStart(4, '0')}`;
  }

  async initClaimPackage(permitClusterId: string, _userId: string) {
    const cluster = await this.prisma.permitCluster.findUnique({
      where: { id: permitClusterId },
      include: {
        baOpen: true,
        surveyData: true,
        sip: true,
        hld: true,
        lld: true,
        prBrRecords: true,
        contracts: true,
        skomBudget: true,
        bak: true,
        bakp: true,
      },
    });
    if (!cluster) throw new NotFoundException('Cluster tidak ada');

    const doc = await this.seq(new Date().getFullYear());
    const ispUrls: string[] = [];
    const govUrls: string[] = [];
    if (cluster.baOpen?.pdfUrl) ispUrls.push(cluster.baOpen.pdfUrl);
    if (cluster.surveyData?.baSurveyPdfUrl) ispUrls.push(cluster.surveyData.baSurveyPdfUrl);
    if (cluster.sip?.pdfUrl) ispUrls.push(cluster.sip.pdfUrl);

    return this.prisma.claimPackage.upsert({
      where: { permitClusterId },
      create: {
        permitClusterId,
        documentNumber: doc,
        hasBAOpen: !!cluster.baOpen?.pdfUrl,
        hasBASurvey: !!cluster.surveyData?.baSurveyPdfUrl,
        hasSip: !!cluster.sip,
        hasHld: !!cluster.hld,
        hasLld: !!cluster.lld,
        hasPrBr: cluster.prBrRecords.length > 0,
        hasContract: cluster.contracts.length > 0,
        hasSkomBudget: !!cluster.skomBudget,
        hasBAK: !!cluster.bak,
        hasBAKP: !!cluster.bakp,
        ispDocumentUrls: ispUrls,
        govDocumentUrls: govUrls,
      },
      update: {
        hasBAOpen: !!cluster.baOpen?.pdfUrl,
        hasBASurvey: !!cluster.surveyData?.baSurveyPdfUrl,
        hasSip: !!cluster.sip,
        hasHld: !!cluster.hld,
        hasLld: !!cluster.lld,
        hasPrBr: cluster.prBrRecords.length > 0,
        hasContract: cluster.contracts.length > 0,
        hasSkomBudget: !!cluster.skomBudget,
        hasBAK: !!cluster.bak,
        hasBAKP: !!cluster.bakp,
        ispDocumentUrls: ispUrls,
      },
    });
  }

  async compilePackage(id: string, userId: string) {
    const row = await this.prisma.claimPackage.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Claim tidak ada');
    void userId;
    const u = await this.prisma.claimPackage.update({
      where: { id },
      data: {
        status: 'SUBMITTED_FOR_REVIEW',
        compiledAt: new Date(),
        compiledBy: userId,
        compiledPackageUrl: row.compiledPackageUrl ?? 'pending-bundle',
      },
    });
    this.gateway.emitToRoom('role:ADMIN', 'claim:compiled', { claimId: id });
    this.gateway.emitToRoom('role:PM_SENIOR', 'claim:compiled', { claimId: id });
    return u;
  }

  async approve(id: string, userId: string) {
    const row = await this.prisma.claimPackage.findUnique({
      where: { id },
      include: { permitCluster: { select: { clusterCode: true, fiberType: true, assignedPmId: true } } },
    });
    if (!row) throw new NotFoundException('Claim tidak ada');
    void userId;
    const u = await this.prisma.claimPackage.update({
      where: { id },
      data: { status: 'APPROVED', approvedAt: new Date() },
    });
    await this.permitCluster.advancePhaseInternal(row.permitClusterId, 'INVOICE_PACKAGE');

    // FIX: claim APPROVED — PM needs to do Pengecekan 2; PM_SENIOR + Admin also informed
    const pmRole: Role =
      row.permitCluster?.fiberType === 'FTTB'
        ? Role.PM_FTTB
        : row.permitCluster?.fiberType === 'FTTT'
          ? Role.PM_FTTT
          : Role.PM_FTTH;
    await this.notifications.createForRoles([pmRole, Role.PM_SENIOR, Role.ADMIN], {
      title: 'Claim disetujui — perlu Pengecekan 2 (PM)',
      message: `Cluster ${row.permitCluster?.clusterCode ?? row.permitClusterId} — siap lanjut invoice.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${row.permitClusterId}`,
      entityId: row.permitClusterId,
    });
    if (row.permitCluster?.assignedPmId) {
      await this.notifications.createForUser(row.permitCluster.assignedPmId, {
        title: 'Claim disetujui — invoice siap',
        message: `Cluster ${row.permitCluster?.clusterCode ?? row.permitClusterId}.`,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${row.permitClusterId}`,
        entityId: row.permitClusterId,
      });
    }

    return u;
  }

  async reject(id: string, reason: string, userId: string) {
    const row = await this.prisma.claimPackage.findUnique({
      where: { id },
      include: { permitCluster: { select: { clusterCode: true } } },
    });
    if (!row) throw new NotFoundException('Claim tidak ada');
    void userId;
    const updated = await this.prisma.claimPackage.update({
      where: { id },
      data: { status: 'REVISION_REQUIRED', revisionReason: reason },
    });

    // FIX: claim REJECTED — Admin is the compiler; inbox them so they can revise
    await this.notifications.createForRole(Role.ADMIN, {
      title: 'Claim ditolak — revisi diperlukan',
      message: `Cluster ${row.permitCluster?.clusterCode ?? row.permitClusterId} — ${reason || 'tanpa catatan'}.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${row.permitClusterId}`,
      entityId: row.permitClusterId,
    });

    return updated;
  }

  async addStreamADoc(id: string, docKey: string, fileUrl: string) {
    if (!this.STREAM_A_DOCS.includes(docKey as any)) throw new NotFoundException('docKey stream A tidak valid');
    await this.prisma.claimPackage.update({ where: { id }, data: { [docKey]: fileUrl } as any });
    return this.runCheck1(id); // NEW: auto run check1 after stream A upload
  }

  async addStreamBDoc(id: string, docKey: string, fileUrl: string) {
    if (!this.STREAM_B_DOCS.includes(docKey as any)) throw new NotFoundException('docKey stream B tidak valid');
    await this.prisma.claimPackage.update({ where: { id }, data: { [docKey]: fileUrl } as any });
    return this.runCheck1(id); // NEW: auto run check1 after stream B upload
  }

  async runCheck1(id: string) {
    const pkg = await this.prisma.claimPackage.findUnique({ where: { id } });
    if (!pkg) throw new NotFoundException('Claim package tidak ada');
    const requiredA = ['docBaOpen', 'docSip', 'docKtpRtRw', 'docPks', 'docKwitansi', 'docBuktiTrf'];
    const requiredB = ['docBaOpenLengkap', 'docEvidancePaymentGov'];
    const failed = [...requiredA, ...requiredB].filter((k) => !(pkg as any)[k]);
    const upd = await this.prisma.claimPackage.update({
      where: { id },
      data: failed.length ? { check1Status: 'FAIL', check1FailedDocs: failed } : { check1Status: 'PASS', check1FailedDocs: [], check1DoneAt: new Date() },
      include: { permitCluster: { select: { id: true, clusterCode: true, fiberType: true } } },
    }); // NEW: set check1 status + failed docs
    const pmRole =
      upd.permitCluster?.fiberType === 'FTTB'
        ? Role.PM_FTTB
        : upd.permitCluster?.fiberType === 'FTTT'
          ? Role.PM_FTTT
          : Role.PM_FTTH;
    if (!failed.length) {
      await this.notifications.createForRole(pmRole, {
        title: 'Pengecekan 2 diperlukan',
        message: `Check1 PASS — cluster ${upd.permitCluster?.clusterCode ?? upd.permitClusterId}`,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${upd.permitClusterId}`,
        entityId: upd.permitClusterId,
      });
    } else {
      await this.notifications.createForRole(Role.ADMIN, {
        title: 'Pengecekan 1 gagal',
        message: `Dokumen kurang: ${failed.join(', ')}`,
        type: 'PERMIT_FLOW',
        link: `/document-list/${upd.permitClusterId}`,
        entityId: upd.permitClusterId,
      });
    }
    return upd;
  }

  async adminSubmitForCheck2(id: string) {
    const pkg = await this.prisma.claimPackage.findUnique({ where: { id } });
    if (!pkg) throw new NotFoundException('Claim package tidak ada');
    if (pkg.check1Status !== 'PASS') throw new NotFoundException('Check1 belum PASS');
    return this.prisma.claimPackage.update({ where: { id }, data: { status: 'SUBMITTED_FOR_REVIEW' } }); // NEW: submit check2 by admin
  }

  async pmApproveCheck2(id: string, pmUserId: string) {
    const u = await this.prisma.claimPackage.update({
      where: { id },
      data: { check2Status: 'APPROVED', check2ReviewedBy: pmUserId, check2ReviewedAt: new Date() },
      include: { permitCluster: { select: { clusterCode: true } } },
    });
    await this.notifications.createForRole(Role.ADMIN, {
      title: 'Pengecekan 2 approved — siap kirim ISP',
      message: u.permitCluster?.clusterCode ?? u.permitClusterId,
      type: 'PERMIT_FLOW',
      link: `/document-list/${u.permitClusterId}`,
      entityId: u.permitClusterId,
    });
    return u;
  }

  async pmRejectCheck2(id: string, pmUserId: string, notes: string) {
    return this.prisma.claimPackage.update({ where: { id }, data: { check2Status: 'REJECTED', check2ReviewedBy: pmUserId, check2ReviewedAt: new Date(), check2Notes: notes } }); // NEW: PM reject check2
  }

  async submitToIsp(id: string, adminId: string) {
    const pkg = await this.prisma.claimPackage.findUnique({ where: { id } });
    if (!pkg) throw new NotFoundException('Claim package tidak ada');
    if (pkg.check1Status !== 'PASS' || pkg.check2Status !== 'APPROVED') throw new NotFoundException('Check1/Check2 belum selesai');
    const updated = await this.prisma.claimPackage.update({
      where: { id },
      data: { submittedToIspAt: new Date(), submittedToIspBy: adminId, status: 'APPROVED' },
      include: { permitCluster: { select: { clusterCode: true } } },
    });
    await this.permitCluster.advancePhaseInternal(updated.permitClusterId, 'INVOICE_PACKAGE');
    await this.notifications.createForAllUsers({
      title: 'PERMIT DONE — cluster siap konstruksi',
      message: `Dokumen dikirim ke ISP — ${updated.permitCluster?.clusterCode ?? updated.permitClusterId}`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${updated.permitClusterId}`,
      entityId: updated.permitClusterId,
    }); // FIX: org-wide milestone
    return updated;
  }

  // FIX: Admin approves single uploaded document (per-doc workflow)
  async adminApproveDoc(id: string, docKey: string, userId: string) {
    const claim = await this.prisma.claimPackage.findUnique({ where: { id } });
    if (!claim) throw new NotFoundException('Claim tidak ada');

    const approvals = (claim.docApprovals as Record<string, Record<string, unknown>> | null) ?? {};
    approvals[docKey] = {
      ...(approvals[docKey] || {}),
      adminStatus: 'APPROVED',
      adminById: userId,
      adminAt: new Date().toISOString(),
      adminNotes: null,
    };

    return this.prisma.claimPackage.update({
      where: { id },
      data: { docApprovals: approvals as object },
    });
  }

  // FIX: Admin rejects single document → Surveyor revises
  async adminRejectDoc(id: string, docKey: string, notes: string, userId: string) {
    const claim = await this.prisma.claimPackage.findUnique({ where: { id } });
    if (!claim) throw new NotFoundException('Claim tidak ada');

    const approvals = (claim.docApprovals as Record<string, Record<string, unknown>> | null) ?? {};
    approvals[docKey] = {
      ...(approvals[docKey] || {}),
      adminStatus: 'REJECTED',
      adminById: userId,
      adminAt: new Date().toISOString(),
      adminNotes: notes,
      pmStatus: 'PENDING',
    };

    const surveyors = await this.prisma.user.findMany({
      where: {
        role: { in: [Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT] },
        isActive: true,
      },
    });
    const claimFull = await this.prisma.claimPackage.findUnique({
      where: { id },
      include: { permitCluster: true },
    });
    await Promise.all(
      surveyors.map((s) =>
        this.notifications.createForUser(s.id, {
          title: '↺ Dokumen Klaim Ditolak Admin',
          message: `Dokumen "${docKey}" pada cluster ${claimFull?.permitCluster?.clusterCode ?? id} ditolak. Alasan: ${notes}`,
          type: 'PERMIT_FLOW',
          link: `/permit-clusters/${claimFull?.permitClusterId}`,
          entityId: claimFull?.permitClusterId ?? '',
        }),
      ),
    );

    return this.prisma.claimPackage.update({
      where: { id },
      data: { docApprovals: approvals as object },
    });
  }

  // FIX: PM approves doc after Admin approved
  async pmApproveDoc(id: string, docKey: string, userId: string) {
    const claim = await this.prisma.claimPackage.findUnique({ where: { id } });
    if (!claim) throw new NotFoundException('Claim tidak ada');

    const approvals = (claim.docApprovals as Record<string, Record<string, unknown>> | null) ?? {};
    if (approvals[docKey]?.adminStatus !== 'APPROVED') {
      throw new BadRequestException('Admin harus approve dokumen ini terlebih dahulu');
    }

    approvals[docKey] = {
      ...approvals[docKey],
      pmStatus: 'APPROVED',
      pmById: userId,
      pmAt: new Date().toISOString(),
      pmNotes: null,
    };

    return this.prisma.claimPackage.update({
      where: { id },
      data: { docApprovals: approvals as object },
    });
  }

  // FIX: PM rejects single document
  async pmRejectDoc(id: string, docKey: string, notes: string, userId: string) {
    const claim = await this.prisma.claimPackage.findUnique({ where: { id } });
    if (!claim) throw new NotFoundException('Claim tidak ada');

    const approvals = (claim.docApprovals as Record<string, Record<string, unknown>> | null) ?? {};
    approvals[docKey] = {
      ...approvals[docKey],
      pmStatus: 'REJECTED',
      pmById: userId,
      pmAt: new Date().toISOString(),
      pmNotes: notes,
    };

    const surveyors = await this.prisma.user.findMany({
      where: {
        role: { in: [Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT] },
        isActive: true,
      },
    });
    const claimFull = await this.prisma.claimPackage.findUnique({
      where: { id },
      include: { permitCluster: true },
    });
    await Promise.all(
      surveyors.map((s) =>
        this.notifications.createForUser(s.id, {
          title: '↺ Dokumen Klaim Ditolak PM',
          message: `Dokumen "${docKey}" cluster ${claimFull?.permitCluster?.clusterCode ?? id} ditolak PM. Alasan: ${notes}`,
          type: 'PERMIT_FLOW',
          link: `/permit-clusters/${claimFull?.permitClusterId}`,
          entityId: claimFull?.permitClusterId ?? '',
        }),
      ),
    );

    return this.prisma.claimPackage.update({
      where: { id },
      data: { docApprovals: approvals as object },
    });
  }

  // FIX: Surveyor re-upload after rejection — reset per-doc approvals
  async reUploadDoc(id: string, docKey: string, fileUrl: string, stream: 'A' | 'B', _userId: string) {
    const claim = await this.prisma.claimPackage.findUnique({ where: { id } });
    if (!claim) throw new NotFoundException('Claim tidak ada');

    if (stream === 'A' && !this.STREAM_A_DOCS.includes(docKey as any)) {
      throw new BadRequestException('docKey tidak valid untuk stream A');
    }
    if (stream === 'B' && !this.STREAM_B_DOCS.includes(docKey as any)) {
      throw new BadRequestException('docKey tidak valid untuk stream B');
    }

    const approvals = (claim.docApprovals as Record<string, Record<string, unknown>> | null) ?? {};
    approvals[docKey] = {
      adminStatus: 'PENDING',
      pmStatus: 'PENDING',
      reUploadedAt: new Date().toISOString(),
    };

    void _userId;
    return this.prisma.claimPackage.update({
      where: { id },
      data: { [docKey]: fileUrl, docApprovals: approvals } as any,
    });
  }

  // FIX: when every uploaded doc has Admin+PM APPROVED → INVOICE_PACKAGE + claim APPROVED
  async checkAllApprovedAndAdvance(id: string) {
    const claim = await this.prisma.claimPackage.findUnique({
      where: { id },
      include: { permitCluster: true },
    });
    if (!claim) return;

    const approvals = (claim.docApprovals as Record<string, Record<string, unknown>> | null) ?? {};

    const streamADocs = [
      'docMom',
      'docBaOpen',
      'docBaAcara',
      'docBaTtdRt',
      'docFcBukuTabungan',
      'docSip',
      'docKtpRtRw',
      'docPks',
      'docKwitansi',
      'docEvidancePayment',
      'docBuktiTrf',
      'docSkInternal',
      'docPoSpk',
    ];
    const streamBDocs = [
      'docBaOpenLengkap',
      'docKwitansiGov',
      'docFotoEvidance',
      'docEvidancePaymentGov',
      'docSkInternalGov',
      'docPoSpkGov',
    ];

    const uploadedDocs = [...streamADocs, ...streamBDocs].filter((key) => !!(claim as any)[key]);

    const allApproved =
      uploadedDocs.length > 0 &&
      uploadedDocs.every(
        (key) => approvals[key]?.adminStatus === 'APPROVED' && approvals[key]?.pmStatus === 'APPROVED',
      );

    if (allApproved) {
      await this.prisma.permitCluster.update({
        where: { id: claim.permitClusterId },
        data: { currentPhase: PermitPhase.INVOICE_PACKAGE },
      });
      await this.prisma.claimPackage.update({
        where: { id },
        data: { status: ClaimStatus.APPROVED },
      });
    }
  }
}
