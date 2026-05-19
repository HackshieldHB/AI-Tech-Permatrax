import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationsService } from '../notifications/notifications.service'; // FIX: inject to send TASK notifications on phase advance
import { FiberType, PermitCluster, PermitClusterStatus, PermitPhase, Prisma, Role } from '@prisma/client';
import { paginate, PaginatedResponse } from '../common/dto/pagination.dto';
import { PermitClusterFilterDtoType } from './permit-cluster.dto';
import { HLD_STATUS, LLD_STATUS } from '@shared/constants/pipelineStates';

// NEW: canonical 20-phase order for progress / timeline
const PHASE_ORDER: PermitPhase[] = [
  'CLUSTER_INTAKE',
  'VISIT_REQUEST',
  'BA_OPEN',
  'SITE_VISIT',
  'SURVEY_INPUT',
  'ROUTE_SURVEY',
  'BA_SURVEY',
  'SIP_REQUEST',
  'HLD_SUBMISSION',
  'LLD_SUBMISSION',
  'PR_BR_ISSUANCE',
  'CONTRACT_MANAGEMENT',
  'SKOM_BUDGET',
  'MANAGEMENT_APPROVAL',
  'FUND_DISBURSEMENT',
  'BAK_GENERATION',
  'BAKP_COMPILATION',
  'CLAIM_SUBMISSION',
  'INVOICE_PACKAGE',
  'PERMIT_DONE',
];

const TOTAL_PHASES = PHASE_ORDER.length;

// NEW: PHASE TRANSITION MAP — metadata for advance rules & notifications
export const PHASE_TRANSITIONS: Record<
  PermitPhase,
  {
    nextPhase: PermitPhase | null;
    triggerDescription: string;
    autoAdvance?: boolean;
    notifyRoles: string[];
  }
> = {
  CLUSTER_INTAKE: {
    nextPhase: 'VISIT_REQUEST',
    triggerDescription: 'Clean list imported',
    autoAdvance: true,
    notifyRoles: ['SURVEYOR_FTTH', 'SURVEYOR_FTTB', 'SURVEYOR_FTTT'],
  },
  VISIT_REQUEST: {
    nextPhase: 'BA_OPEN',
    triggerDescription: 'Visit request approved by PM',
    autoAdvance: false,
    notifyRoles: ['PM_FTTH', 'PM_FTTB', 'PM_FTTT'],
  },
  BA_OPEN: {
    nextPhase: 'SITE_VISIT',
    triggerDescription: 'BA Open generated',
    autoAdvance: true,
    notifyRoles: [],
  },
  SITE_VISIT: {
    nextPhase: 'SURVEY_INPUT',
    triggerDescription: 'Site visit conducted',
    autoAdvance: false,
    notifyRoles: [],
  },
  SURVEY_INPUT: {
    nextPhase: 'ROUTE_SURVEY',
    triggerDescription: 'Survey data submitted',
    autoAdvance: false,
    notifyRoles: [],
  },
  ROUTE_SURVEY: {
    nextPhase: 'BA_SURVEY',
    triggerDescription: 'Route marking completed',
    autoAdvance: false,
    notifyRoles: [],
  },
  BA_SURVEY: {
    nextPhase: 'SIP_REQUEST',
    triggerDescription: 'BA Survey generated',
    autoAdvance: true,
    notifyRoles: [],
  },
  SIP_REQUEST: {
    nextPhase: 'HLD_SUBMISSION',
    triggerDescription: 'SIP approved by ISP',
    autoAdvance: false,
    notifyRoles: ['PM_FTTH', 'PM_FTTB', 'PM_FTTT'],
  },
  HLD_SUBMISSION: {
    nextPhase: 'LLD_SUBMISSION',
    triggerDescription: 'HLD approved by ISP',
    autoAdvance: false,
    notifyRoles: ['PM_FTTH', 'PM_FTTB', 'PM_FTTT'],
  },
  LLD_SUBMISSION: {
    nextPhase: 'PR_BR_ISSUANCE',
    triggerDescription: 'LLD approved by ISP',
    autoAdvance: false,
    notifyRoles: ['PM_FTTH', 'PM_FTTB', 'PM_FTTT'],
  },
  PR_BR_ISSUANCE: {
    nextPhase: 'CONTRACT_MANAGEMENT',
    triggerDescription: 'PR/BR issued',
    autoAdvance: false,
    notifyRoles: [],
  },
  CONTRACT_MANAGEMENT: {
    nextPhase: 'SKOM_BUDGET',
    triggerDescription: 'Contract/PKS signed',
    autoAdvance: false,
    notifyRoles: [],
  },
  SKOM_BUDGET: {
    nextPhase: 'MANAGEMENT_APPROVAL',
    triggerDescription: 'SKOM budget submitted',
    autoAdvance: false,
    notifyRoles: ['PM_SENIOR', 'GENERAL_MANAGER'],
  },
  MANAGEMENT_APPROVAL: {
    nextPhase: 'FUND_DISBURSEMENT',
    triggerDescription: 'Management approved',
    autoAdvance: false,
    notifyRoles: [],
  },
  FUND_DISBURSEMENT: {
    nextPhase: 'BAK_GENERATION',
    triggerDescription: 'Payment executed',
    autoAdvance: false,
    notifyRoles: [],
  },
  BAK_GENERATION: {
    nextPhase: 'BAKP_COMPILATION',
    triggerDescription: 'BAK signed and validated',
    autoAdvance: false,
    notifyRoles: ['ADMIN'],
  },
  BAKP_COMPILATION: {
    nextPhase: 'CLAIM_SUBMISSION',
    triggerDescription: 'BAKP fully compiled',
    autoAdvance: false,
    notifyRoles: ['ADMIN'],
  },
  CLAIM_SUBMISSION: {
    nextPhase: 'INVOICE_PACKAGE',
    triggerDescription: 'Claim docs approved',
    autoAdvance: false,
    notifyRoles: ['FINANCE'],
  },
  INVOICE_PACKAGE: {
    nextPhase: 'PERMIT_DONE',
    triggerDescription: 'Invoice paid',
    autoAdvance: false,
    notifyRoles: [],
  },
  PERMIT_DONE: {
    nextPhase: null,
    triggerDescription: 'Permit complete',
    autoAdvance: false,
    notifyRoles: [],
  },
};

// NEW: Indonesian labels for socket / PM actions
const PHASE_LABELS: Record<PermitPhase, string> = {
  CLUSTER_INTAKE: '1. Penerimaan Cluster',
  VISIT_REQUEST: '2. Request Kunjungan',
  BA_OPEN: '3. BA Open',
  SITE_VISIT: '4. Kunjungan Lapangan',
  SURVEY_INPUT: '5. Input Data Survey',
  ROUTE_SURVEY: '6. Survey Rute & Homepass',
  BA_SURVEY: '7. Berita Acara Survey',
  SIP_REQUEST: '8. SIP ke ISP',
  HLD_SUBMISSION: '9. High Level Drawing',
  LLD_SUBMISSION: '10. Low Level Drawing',
  PR_BR_ISSUANCE: '11. PR / BR',
  CONTRACT_MANAGEMENT: '12. Kontrak / PKS',
  SKOM_BUDGET: '13. Anggaran & RAB',
  MANAGEMENT_APPROVAL: '14. Persetujuan Manajemen',
  FUND_DISBURSEMENT: '15. Pencairan Dana',
  BAK_GENERATION: '16. BAK & Tanda Tangan',
  BAKP_COMPILATION: '17. Kompilasi BAKP',
  CLAIM_SUBMISSION: '18. Klaim Dokumen',
  INVOICE_PACKAGE: '19. Invoice & Penagihan',
  PERMIT_DONE: '20. Selesai',
};

@Injectable()
export class PermitClusterService {
  private readonly logger = new Logger(PermitClusterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
    private readonly notifications: NotificationsService, // FIX: used by notifySurveyorTask helper
  ) {}

  // FIX: phase → surveyor task metadata used for TASK-type inbox notifications
  private static readonly SURVEYOR_TASK_MAP: Partial<
    Record<PermitPhase, { title: string; message: string; path: string }>
  > = {
    SITE_VISIT: {
      title: '🏠 Tugas: Isi Data Kunjungan Lapangan',
      message:
        'Visit request disetujui. Silakan input data RT/RW dan pengelola cluster.',
      path: '/site-visit',
    },
    SURVEY_INPUT: {
      title: '📋 Tugas: Input Data Survey',
      message:
        'Data kunjungan tersimpan. Lanjutkan dengan input kondisi area dan temuan lapangan.',
      path: '/survey-input',
    },
    ROUTE_SURVEY: {
      title: '🗺️ Tugas: Survey Route & Homepass',
      message:
        'Lanjutkan survey dengan menghitung homepass dan panjang jalur kabel.',
      path: '/route-survey',
    },
    BA_SURVEY: {
      title: '📸 Tugas: Upload Foto Evidence (WAJIB)',
      message:
        'Pastikan upload foto dokumentasi kunjungan dengan GPS aktif. Ini wajib sebelum submit dokumen.',
      path: '/evidence',
    },
    SIP_REQUEST: {
      title: '📝 Tugas: Isi Form SIP (19 Fields)',
      message:
        'Isi Survey Information Permit lengkap sebelum submit semua dokumen ke PM.',
      path: '/sip',
    },
  };

  // FIX: send TASK-type notification to the surveyor (vr.requestedBy) for a given phase
  private async notifySurveyorTask(
    clusterId: string,
    phase: PermitPhase,
  ): Promise<void> {
    const task = PermitClusterService.SURVEYOR_TASK_MAP[phase];
    if (!task) return;

    const row = await this.prisma.permitCluster.findUnique({
      where: { id: clusterId },
      select: {
        id: true,
        clusterCode: true,
        visitRequest: { select: { requestedBy: true } },
      },
    });
    const surveyorId = row?.visitRequest?.requestedBy;
    if (!surveyorId) return;

    await this.notifications.createForUser(surveyorId, {
      title: task.title,
      message: `[${row!.clusterCode}] ${task.message}`,
      type: 'TASK',
      link: `/permit-clusters/${clusterId}${task.path}`,
      entityId: clusterId,
    });
  }

  /** FIX: Initialize PermitCluster when VisitRequest is created (Pipeline 1: CLUSTER_INTAKE) */
  async initClusterForVisitRequest(visitRequestId: string, userId: string) {
    const vr = await this.prisma.visitRequest.findUnique({
      where: { id: visitRequestId },
      include: { cleanList: true },
    });
    if (!vr) throw new NotFoundException('Visit request tidak ditemukan');

    // Check if cluster already exists for this visit request
    const existing = await this.prisma.permitCluster.findUnique({
      where: { visitRequestId },
    });
    if (existing) {
      return existing;
    }

    const assignedPmId = vr.assignedPmId ?? userId;

    // Create PermitCluster at CLUSTER_INTAKE phase
    const cluster = await this.prisma.permitCluster.create({
      data: {
        visitRequest: { connect: { id: vr.id } },
        baOpen: null, // Will be set later when BA Open is generated
        clusterCode: vr.cleanList?.rwCode ?? '-',
        ispCustomer: vr.ispCustomer,
        fiberType: vr.fiberType as FiberType,
        assignedPm: { connect: { id: assignedPmId } },
        currentPhase: 'CLUSTER_INTAKE',
        status: 'IN_PROGRESS',
      },
      include: {
        assignedPm: { select: { id: true, name: true, email: true } },
        visitRequest: { select: { id: true, status: true } },
      },
    });

    // Notify PM that cluster has entered intake phase
    await this.notifications.createForUser(assignedPmId, {
      title: '📋 Cluster Masuk Pipeline',
      message: `Cluster ${cluster.clusterCode} telah masuk ke fase CLUSTER_INTAKE. Silakan proses visit request.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${cluster.id}`,
      entityId: cluster.id,
    });

    this.logger.log(`[CLUSTER_INTAKE] Created permit cluster ${cluster.id} for visit request ${visitRequestId}`);

    return cluster;
  }

  /** NEW: Called when BA Open PDF exists — updates existing cluster and advances phase */
  async createFromBaOpen(baOpenId: string, _triggerUserId: string) {
    const ba = await this.prisma.baOpen.findUnique({
      where: { id: baOpenId },
      include: {
        visitRequest: { include: { cleanList: true } },
      },
    });
    if (!ba) throw new NotFoundException('BA Open tidak ditemukan');

    const vr = ba.visitRequest;
    const assignedPmId = vr.assignedPmId ?? vr.requestedBy;

    // FIX: Check if cluster already exists by visitRequestId (from CLUSTER_INTAKE phase)
    const existingByVr = await this.prisma.permitCluster.findUnique({
      where: { visitRequestId: ba.visitRequestId },
    });

    if (existingByVr) {
      // Update existing cluster with BA Open and advance to SITE_VISIT
      const updated = await this.prisma.permitCluster.update({
        where: { id: existingByVr.id },
        data: {
          baOpenId: ba.id,
          currentPhase: 'SITE_VISIT',
          clusterCode: ba.rwCode ?? vr.cleanList?.rwCode ?? existingByVr.clusterCode,
        },
        include: {
          assignedPm: { select: { id: true, name: true, email: true } },
          visitRequest: { select: { id: true, status: true } },
          baOpen: { select: { id: true, documentNumber: true, pdfUrl: true } },
        },
      });

      this.gateway.emitToRoom(`user:${assignedPmId}`, 'permitCluster:updated', {
        clusterId: updated.id,
        clusterCode: updated.clusterCode,
        newPhase: 'SITE_VISIT',
        message: 'BA Open terbentuk — lanjutkan kunjungan lapangan',
      });

      // FIX: Fire SITE_VISIT TASK notification to surveyor
      await this.notifySurveyorTask(updated.id, 'SITE_VISIT');

      return updated;
    }

    // Fallback: create new cluster if no existing one (backwards compatibility)
    const existingByBa = await this.prisma.permitCluster.findUnique({
      where: { baOpenId },
    });
    if (existingByBa) return existingByBa;

    const cluster = await this.prisma.permitCluster.create({
      data: {
        visitRequest: { connect: { id: ba.visitRequestId } },
        baOpen: { connect: { id: ba.id } },
        clusterCode: ba.rwCode ?? vr.cleanList?.rwCode ?? '-',
        ispCustomer: ba.ispCustomer,
        fiberType: vr.fiberType as FiberType,
        assignedPm: { connect: { id: assignedPmId } },
        currentPhase: 'SITE_VISIT',
        status: 'IN_PROGRESS',
      },
      include: {
        assignedPm: { select: { id: true, name: true, email: true } },
        visitRequest: { select: { id: true, status: true } },
        baOpen: { select: { id: true, documentNumber: true, pdfUrl: true } },
      },
    });

    this.gateway.emitToRoom(`user:${assignedPmId}`, 'permitCluster:created', {
      clusterId: cluster.id,
      clusterCode: cluster.clusterCode,
      message: 'Cluster masuk pipeline perizinan — lanjutkan kunjungan lapangan',
    });

    // FIX: Fire SITE_VISIT TASK notification to surveyor
    await this.notifySurveyorTask(cluster.id, 'SITE_VISIT');

    return cluster;
  }

  progressPercent(phase: PermitPhase): number {
    const phaseIndex = PHASE_ORDER.indexOf(phase);
    if (phaseIndex < 0) return 0;
    if (TOTAL_PHASES <= 1) return 0;
    return Math.round((phaseIndex / (TOTAL_PHASES - 1)) * 100);
  }

  // NEW: full progress for UI progress bar
  getPhaseProgress(currentPhase: PermitPhase): {
    currentIndex: number;
    totalPhases: number;
    percentage: number;
    completedPhases: PermitPhase[];
    remainingPhases: PermitPhase[];
  } {
    const allPhases = PHASE_ORDER;
    const currentIndex = allPhases.indexOf(currentPhase);
    const idx = currentIndex < 0 ? 0 : currentIndex;
    return {
      currentIndex: idx,
      totalPhases: allPhases.length,
      percentage: this.progressPercent(currentPhase),
      completedPhases: idx > 0 ? allPhases.slice(0, idx) : [],
      remainingPhases: idx < allPhases.length - 1 ? allPhases.slice(idx + 1) : [],
    };
  }

  // NEW: PM dashboard “Butuh Tindakan” hint
  getRequiredAction(
    cluster: PermitCluster,
    userRole: Role,
  ): {
    canAct: boolean;
    actionLabel: string;
    actionType: string;
    href: string;
  } | null {
    const p = cluster.currentPhase;
    const id = cluster.id;
    const base = `/permit-clusters/${id}`;
    const isPm = ([Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT] as Role[]).includes(userRole);
    const isSurveyor = ([Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT] as Role[]).includes(
      userRole,
    );
    const isPmSenior = userRole === Role.PM_SENIOR;
    const isGm = userRole === Role.GENERAL_MANAGER;
    const isAdmin = userRole === Role.ADMIN;
    const isFinance = userRole === Role.FINANCE;

    if (p === 'SITE_VISIT' && (isSurveyor || isPm)) {
      return { canAct: true, actionLabel: 'Isi data kunjungan lapangan', actionType: 'SITE_VISIT', href: base };
    }
    if (p === 'SURVEY_INPUT' && (isSurveyor || isPm)) {
      return { canAct: true, actionLabel: 'Input data survey', actionType: 'SURVEY_INPUT', href: base };
    }
    if (p === 'ROUTE_SURVEY' && (isSurveyor || isPm)) {
      return { canAct: true, actionLabel: 'Selesaikan survey rute', actionType: 'ROUTE_SURVEY', href: base };
    }
    if (p === 'SIP_REQUEST' && (isPmSenior || isGm)) {
      return { canAct: true, actionLabel: 'Proses SIP ke ISP', actionType: 'SIP', href: base };
    }
    if ((p === 'HLD_SUBMISSION' || p === 'LLD_SUBMISSION') && isPm) {
      return { canAct: true, actionLabel: 'Kelola desain (HLD/LLD)', actionType: 'DESIGN', href: base };
    }
    if (p === 'CLAIM_SUBMISSION' && (isAdmin || isPmSenior)) {
      return { canAct: true, actionLabel: 'Kompilasi klaim dokumen', actionType: 'CLAIM', href: base };
    }
    if (p === 'INVOICE_PACKAGE' && (isFinance || isGm)) {
      return { canAct: true, actionLabel: 'Review invoice', actionType: 'INVOICE', href: base };
    }
    return null;
  }

  // MODIFIED: paginated findAll with standard meta
  async findAll(
    filters: PermitClusterFilterDtoType,
    userRole: Role,
    userId: string,
  ): Promise<PaginatedResponse<unknown>> {
    const { fiberType, status, currentPhase, ispCustomer, search, page, limit, sortBy, sortOrder } = filters;
    const skip = (page - 1) * limit;
    const where: Prisma.PermitClusterWhereInput = {};
    if (fiberType) where.fiberType = fiberType;
    if (status) where.status = status;
    if (currentPhase) where.currentPhase = currentPhase;
    if (ispCustomer?.trim()) where.ispCustomer = { contains: ispCustomer.trim(), mode: 'insensitive' };
    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        { clusterCode: { contains: q, mode: 'insensitive' } },
        { ispCustomer: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (String(userRole).startsWith('SURVEYOR')) {
      where.visitRequest = { requestedBy: userId }; // FIX: surveyor — hanya cluster dari visit request mereka
    } else if (([Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT] as Role[]).includes(userRole)) {
      const ft = (fiberType as FiberType) ?? (String(userRole).replace('PM_', '') as FiberType);
      where.fiberType = ft; // FIX: PM lihat semua cluster sesuai tipe fiber, bukan hanya assignedPmId
    }

    const orderField = sortBy && ['updatedAt', 'createdAt', 'clusterCode'].includes(sortBy) ? sortBy : 'updatedAt';
    const orderBy = { [orderField]: sortOrder } as Prisma.PermitClusterOrderByWithRelationInput;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.permitCluster.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          assignedPm: { select: { id: true, name: true, email: true, role: true } },
          apd: { select: { status: true } },
          bakp: { select: { status: true } },
          baOpen: { select: { documentNumber: true, pdfUrl: true, existingFiber: true, existingOperator: true } },
          visitRequest: {
            select: {
              id: true,
              cleanList: { select: { kelurahan: true, rwCode: true, hasExistingFiber: true } },
            },
          },
        },
      }),
      this.prisma.permitCluster.count({ where }),
    ]);

    const data = rows.map((r) => ({
      ...r,
      progressPercent: this.progressPercent(r.currentPhase),
    }));

    return paginate(data, total, page, limit);
  }

  async findOne(id: string, userRole: Role, userId: string) {
    const row = await this.prisma.permitCluster.findUnique({
      where: { id },
      include: {
        assignedPm: { select: { id: true, name: true, email: true, role: true } },
        visitRequest: {
          include: {
            cleanList: true,
            requester: { select: { id: true, name: true } },
          },
        },
        baOpen: true,
        apd: { include: { revisions: true, abd: { include: { revisions: true, technicalDiagrams: true } } } },
        socialization: true,
        compensation: { include: { negotiations: true } },
        bak: { include: { signatures: true } },
        bakAgreement: true, // FIX: surveyor BAK form (phase 16)
        scom: true,
        bakp: true,
        surveyData: true,
        sip: true,
        hld: { include: { revisions: true } },
        lld: { include: { revisions: true } },
        prBrRecords: true,
        contracts: true,
        skomBudget: { include: { disbursements: true } },
        claimPackage: true,
        invoicePackage: true,
      },
    });
    if (!row) throw new NotFoundException('Permit cluster tidak ditemukan');

    if (String(userRole).startsWith('SURVEYOR')) {
      if (row.visitRequest?.requestedBy !== userId) {
        throw new ForbiddenException('Akses ditolak');
      }
    } else if (([Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT] as Role[]).includes(userRole)) {
      const ft = String(userRole).replace('PM_', '') as FiberType;
      if (row.fiberType !== ft) {
        throw new ForbiddenException('Akses ditolak');
      }
    } // FIX: PM akses semua cluster dengan fiber sama (bukan hanya assignedPm)

    return {
      ...row,
      progressPercent: this.progressPercent(row.currentPhase),
      phaseProgress: this.getPhaseProgress(row.currentPhase),
    };
  }

  /** NEW: Manual phase override */
  async advancePhase(id: string, newPhase: PermitPhase, userId: string, userRole: Role) {
    if (!([Role.PM_SENIOR, Role.ADMIN, Role.GENERAL_MANAGER] as Role[]).includes(userRole)) {
      throw new ForbiddenException('Hanya PM Senior / Admin / GM');
    }
    const row = await this.prisma.permitCluster.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Cluster tidak ditemukan');

    const updated = await this.prisma.permitCluster.update({
      where: { id },
      data: { currentPhase: newPhase },
    });

    if (newPhase === 'PR_BR_ISSUANCE') {
      await this.initPrBrWorkflowForCluster(id); // FIX: manual phase override must create PrBrWorkflow too (same as advancePhaseInternal)
    }

    this.emitPhaseAdvanced(updated, row.currentPhase, newPhase);
    return updated;
  }

  emitPhaseAdvanced(
    cluster: { id: string; clusterCode: string; assignedPmId: string },
    fromPhase: PermitPhase,
    toPhase: PermitPhase,
  ) {
    const payload = {
      clusterId: cluster.id,
      clusterCode: cluster.clusterCode,
      fromPhase,
      toPhase,
      phaseLabel: PHASE_LABELS[toPhase] ?? toPhase,
    };
    this.gateway.emitToRoom(`user:${cluster.assignedPmId}`, 'permitCluster:phaseAdvanced', payload);
    this.gateway.emitToRoom('role:PM_SENIOR', 'permitCluster:phaseAdvanced', payload);
    this.gateway.emitToRoom('role:ADMIN', 'permitCluster:phaseAdvanced', payload);
    // NEW: expanded permit-flow socket event
    this.gateway.emitToRooms(
      [`user:${cluster.assignedPmId}`, 'role:PM_SENIOR', 'role:ADMIN'],
      'cluster:phaseAdvanced',
      payload,
    );
  }

  private async initBakForCluster(clusterId: string, userId: string) { // FIX: auto-create BAK when entering BAK_GENERATION
    const existing = await this.prisma.bak.findFirst({ where: { permitClusterId: clusterId } });
    if (existing) return existing;
    const compensation = await this.prisma.compensation.findUnique({ where: { permitClusterId: clusterId } });
    if (!compensation) return null; // FIX: skip when compensation is not yet available
    const year = new Date().getFullYear();
    const count = await this.prisma.bak.count();
    const documentNumber = `BAK-${year}-${String(count + 1).padStart(4, '0')}`;
    return this.prisma.bak.create({
      data: {
        permitClusterId: clusterId,
        compensationId: compensation.id,
        documentNumber,
        finalAmount: compensation.finalAmount ?? compensation.negotiatedAmount ?? compensation.proposedAmount,
        recipientName: '-',
        recipientBank: '-',
        recipientAccount: '-',
        status: 'DRAFT',
        createdBy: userId,
      },
    });
  }

  private async initBakpForCluster(clusterId: string, userId: string) { // FIX: auto-create BAKP when entering BAKP_COMPILATION
    const existing = await this.prisma.bakp.findFirst({ where: { permitClusterId: clusterId } });
    if (existing) return existing;
    const year = new Date().getFullYear();
    const count = await this.prisma.bakp.count();
    const documentNumber = `BAKP-${year}-${String(count + 1).padStart(4, '0')}`;
    return this.prisma.bakp.create({
      data: {
        permitClusterId: clusterId,
        documentNumber,
        status: 'DRAFT',
        compiledBy: userId,
      },
    });
  }

  // FIX PR/BR→PO flow: auto-initialize workflow row + notify PM/Admin when cluster enters PR_BR_ISSUANCE
  private async initPrBrWorkflowForCluster(clusterId: string) {
    const cluster = await this.prisma.permitCluster.findUnique({
      where: { id: clusterId },
      select: { id: true, clusterCode: true, fiberType: true, assignedPmId: true }, // FIX: minimal select for notifications + PM role mapping
    });
    if (!cluster) return null;

    // FIX: upsert so re-entering phase doesn’t fail; keep existing row state (don’t wipe uploads)
    await this.prisma.prBrWorkflow.upsert({
      where: { permitClusterId: clusterId },
      create: { permitClusterId: clusterId, status: 'PENDING_UPLOAD' }, // FIX: new clusters start in upload-waiting state
      update: {}, // FIX: preserve PR/BR files + status if workflow already exists
    });

    const clusterCode = cluster.clusterCode;
    const pmRole: Role =
      cluster.fiberType === 'FTTB' ? Role.PM_FTTB :
      cluster.fiberType === 'FTTT' ? Role.PM_FTTT : Role.PM_FTTH;

    // FIX PR/BR→PO flow: notify PM (fiber-specific) as the primary uploader
    await this.notifications.createForRole(pmRole, {
      title: '📄 PR/BR dari ISP Siap Diupload',
      message: `Dokumen PR dan BR dari ISP untuk cluster ${clusterCode} perlu diupload. Silakan upload dokumen yang diterima dari ISP.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${clusterId}`,
      entityId: clusterId,
    });

    // FIX PR/BR→PO flow: notify PM Senior for visibility
    await this.notifications.createForRole(Role.PM_SENIOR, {
      title: '📄 PR/BR Siap Diupload',
      message: `Cluster ${clusterCode} memasuki fase PR/BR. PM perlu upload dokumen dari ISP.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${clusterId}`,
      entityId: clusterId,
    });

    // FIX PR/BR→PO flow: Admin is co-uploader and primary reviewer downstream
    await this.notifications.createForRole(Role.ADMIN, {
      title: `📄 PR/BR Baru — Cluster ${clusterCode}`,
      message: `Cluster ${clusterCode} memasuki fase PR/BR. PM akan mengupload dokumen dari ISP (Admin juga bisa upload).`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${clusterId}`,
      entityId: clusterId,
    });

    return { clusterCode, pmRole };
  }

  /** FIX: Initialize HLD record with WAITING_INPUT status when entering HLD_SUBMISSION phase */
  private async initHldForCluster(clusterId: string, pmId: string | null) {
    const existing = await this.prisma.hld.findUnique({
      where: { permitClusterId: clusterId },
    });
    if (existing) {
      return existing; // Don't overwrite existing HLD
    }
    // Create new HLD with WAITING_INPUT status for Designer to upload
    const hld = await this.prisma.hld.create({
      data: {
        permitClusterId: clusterId,
        createdBy: pmId,
        status: HLD_STATUS.WAITING_INPUT, // Designer must upload KMZ + BOQ first
        kmzFileUrl: null,
        boqFileUrl: null,
        additionalFiles: [],
      },
      // TODO: Add lastActivityAt field after Prisma migration is run
    });
    // Notify Designer that HLD is ready for upload
    await this.notifications.createForRole('DESIGNER' as Role, {
      title: '📐 HLD Siap — Upload KMZ + BOQ',
      message: 'Pipeline 9 HLD memerlukan upload dokumen KMZ dan BOQ. Silakan upload melalui halaman HLD.',
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${clusterId}`,
      entityId: clusterId,
    });
    // Notify PM that Designer has been assigned
    if (pmId) {
      await this.notifications.createForUser(pmId, {
        title: '📐 HLD Dimulai — Menunggu Upload Designer',
        message: 'Fase HLD telah dimulai. Designer akan mengupload KMZ dan BOQ.',
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${clusterId}`,
        entityId: clusterId,
      });
    }
    return hld;
  }

  /** FIX: Initialize LLD record with WAITING_INPUT status when entering LLD_SUBMISSION phase */
  private async initLldForCluster(clusterId: string, pmId: string | null) {
    const existing = await this.prisma.lld.findUnique({
      where: { permitClusterId: clusterId },
    });
    if (existing) {
      return existing; // Don't overwrite existing LLD
    }
    // Create new LLD with WAITING_INPUT status for Designer to upload
    const lld = await this.prisma.lld.create({
      data: {
        permitClusterId: clusterId,
        createdBy: pmId,
        status: LLD_STATUS.WAITING_INPUT, // Designer must upload APD + Schematic + Core Connection first
        apdFileUrl: null,
        schematicFileUrl: null,
        coreConnectionUrl: null,
        additionalFiles: [],
      },
      // TODO: Add lastActivityAt field after Prisma migration is run
    });
    // Notify Designer that LLD is ready for upload
    await this.notifications.createForRole('DESIGNER' as Role, {
      title: '📐 LLD Siap — Upload APD + Schematic + Core Connection',
      message: 'Pipeline 10 LLD memerlukan upload dokumen APD, Schematic, dan Core Connection. Silakan upload melalui halaman LLD.',
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${clusterId}`,
      entityId: clusterId,
    });
    // Notify PM that Designer has been assigned
    if (pmId) {
      await this.notifications.createForUser(pmId, {
        title: '📐 LLD Dimulai — Menunggu Upload Designer',
        message: 'Fase LLD telah dimulai. Designer akan mengupload dokumen LLD.',
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${clusterId}`,
        entityId: clusterId,
      });
    }
    return lld;
  }

  /** FIX: Initialize Contract record when entering CONTRACT_MANAGEMENT phase */
  private async initContractForCluster(clusterId: string, pmId: string | null) {
    const existing = await this.prisma.contractRecord.findFirst({
      where: { permitClusterId: clusterId },
    });
    if (existing) {
      return existing;
    }
    const cluster = await this.prisma.permitCluster.findUnique({
      where: { id: clusterId },
      select: { clusterCode: true, fiberType: true },
    });
    const contract = await this.prisma.contractRecord.create({
      data: {
        permitClusterId: clusterId,
        type: 'PKS',
        status: 'DRAFT',
        createdBy: pmId ?? '',
      },
    });
    // Notify PM that contract phase has started
    if (pmId) {
      await this.notifications.createForUser(pmId, {
        title: '📄 Kontrak Siap — Upload PKS',
        message: `Fase Kontrak/PKS untuk cluster ${cluster?.clusterCode} telah dimulai. Silakan upload dokumen kontrak.`,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${clusterId}`,
        entityId: clusterId,
      });
    }
    return contract;
  }

  /** FIX: Initialize Claim Package when entering CLAIM_SUBMISSION phase */
  private async initClaimForCluster(clusterId: string, _pmId: string | null) {
    const existing = await this.prisma.claimPackage.findUnique({
      where: { permitClusterId: clusterId },
    });
    if (existing) {
      return existing;
    }
    const year = new Date().getFullYear();
    const count = await this.prisma.claimPackage.count({
      where: { createdAt: { gte: new Date(`${year}-01-01`) } },
    });
    const docNumber = `CLAIM-${year}-${String(count + 1).padStart(4, '0')}`;
    
    const claim = await this.prisma.claimPackage.create({
      data: {
        permitClusterId: clusterId,
        documentNumber: docNumber,
        status: 'DRAFT',
        ispDocumentUrls: [],
        govDocumentUrls: [],
      },
    });
    // Notify Admin that claim is ready for compilation
    await this.notifications.createForRole(Role.ADMIN, {
      title: '📦 Klaim Dokumen Siap',
      message: `Fase Klaim Dokumen telah dimulai. Silakan kompilasi dokumen untuk cluster ini.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${clusterId}`,
      entityId: clusterId,
    });
    return claim;
  }

  /** FIX: Initialize Invoice Package when entering INVOICE_PACKAGE phase */
  private async initInvoiceForCluster(clusterId: string, _pmId: string | null) {
    const existing = await this.prisma.invoicePackage.findUnique({
      where: { permitClusterId: clusterId },
    });
    if (existing) {
      return existing;
    }
    const year = new Date().getFullYear();
    const count = await this.prisma.invoicePackage.count({
      where: { createdAt: { gte: new Date(`${year}-01-01`) } },
    });
    const invNumber = `INV-${year}-${String(count + 1).padStart(4, '0')}`;
    
    const invoice = await this.prisma.invoicePackage.create({
      data: {
        permitClusterId: clusterId,
        invoiceNumber: invNumber,
        status: 'DRAFT',
        amount: 0,
        generatedBy: '', // Will be set when actually generated
      },
    });
    // Notify Finance that invoice phase has started
    await this.notifications.createForRole(Role.FINANCE, {
      title: '💰 Invoice Siap Diproses',
      message: `Fase Invoice telah dimulai. Silakan proses invoice untuk cluster ini.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${clusterId}`,
      entityId: clusterId,
    });
    return invoice;
  }

  /** FIX: Initialize SKOM Budget when entering SKOM_BUDGET phase (Pipeline 13) */
  private async initSkomBudgetForCluster(clusterId: string, pmId: string | null) {
    const existing = await this.prisma.skomBudget.findUnique({
      where: { permitClusterId: clusterId },
    });
    if (existing) {
      return existing;
    }

    const cluster = await this.prisma.permitCluster.findUnique({
      where: { id: clusterId },
      select: { clusterCode: true },
    });

    const skom = await this.prisma.skomBudget.create({
      data: {
        permitClusterId: clusterId,
        status: 'DRAFT',
        createdBy: pmId ?? '',
        totalBudget: null,
        budgetFileUrl: null,
        rabFileUrl: null,
        timelineFileUrl: null,
        kurvaSFileUrl: null,
      },
    });

    // Notify PM/Finance that SKOM Budget phase has started
    if (pmId) {
      await this.notifications.createForUser(pmId, {
        title: '💰 SKOM Budget Siap — Upload Dokumen Anggaran',
        message: `Fase Anggaran & RAB untuk cluster ${cluster?.clusterCode} telah dimulai. Silakan upload SKOM Budget, RAB, Timeline, dan Kurva-S.`,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${clusterId}`,
        entityId: clusterId,
      });
    }
    // Also notify Finance team
    await this.notifications.createForRole(Role.FINANCE, {
      title: '💰 SKOM Budget Dimulai',
      message: `Cluster ${cluster?.clusterCode} memerlukan persiapan anggaran. Silakan koordinasi dengan PM.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${clusterId}`,
      entityId: clusterId,
    });

    return skom;
  }

  /** NEW: Called internally when a workflow step completes */
  async advancePhaseInternal(id: string, toPhase: PermitPhase) {
    const row = await this.prisma.permitCluster.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Cluster tidak ditemukan');
    if (row.currentPhase === toPhase) {
      return row;
    }
    const from = row.currentPhase;
    const updated = await this.prisma.permitCluster.update({
      where: { id },
      data: { currentPhase: toPhase },
    });
    if (toPhase === 'HLD_SUBMISSION') { // FIX: Auto-create HLD with WAITING_INPUT when entering HLD phase
      await this.initHldForCluster(id, row.assignedPmId);
    }
    if (toPhase === 'LLD_SUBMISSION') { // FIX: Auto-create LLD with WAITING_INPUT when entering LLD phase
      await this.initLldForCluster(id, row.assignedPmId);
    }
    if (toPhase === 'BAK_GENERATION') { // FIX: initialize BAK data as soon as cluster enters BAK phase
      await this.initBakForCluster(id, row.assignedPmId);
    }
    if (toPhase === 'BAKP_COMPILATION') { // FIX: initialize BAKP record as soon as cluster enters BAKP phase
      await this.initBakpForCluster(id, row.assignedPmId);
    }
    if (toPhase === 'PR_BR_ISSUANCE') { // FIX PR/BR→PO flow: create workflow row + fire PM/Admin notifications on entry
      await this.initPrBrWorkflowForCluster(id);
    }
    if (toPhase === 'CONTRACT_MANAGEMENT') { // FIX: Auto-create Contract record when entering Contract phase
      await this.initContractForCluster(id, row.assignedPmId);
    }
    if (toPhase === 'SKOM_BUDGET') { // FIX: Auto-create SKOM Budget when entering SKOM phase
      await this.initSkomBudgetForCluster(id, row.assignedPmId);
    }
    if (toPhase === 'CLAIM_SUBMISSION') { // FIX: Auto-create Claim Package when entering Claim phase
      await this.initClaimForCluster(id, row.assignedPmId);
    }
    if (toPhase === 'INVOICE_PACKAGE') { // FIX: Auto-create Invoice Package when entering Invoice phase
      await this.initInvoiceForCluster(id, row.assignedPmId);
    }
    this.emitPhaseAdvanced(updated, from, toPhase);
    
    // FIX: ensure all clients get real-time update
    this.gateway.server.emit('cluster:phaseAdvanced', {
      clusterId: id,
      newPhase: toPhase,
      previousPhase: from,
    });
    // FIX: also emit to cluster-specific room
    this.gateway.server
      .to(`cluster:${id}`)
      .emit('cluster:updated', { currentPhase: toPhase });

    // FIX: Fix 7 — fire TASK notification when cluster enters a surveyor-facing phase
    await this.notifySurveyorTask(id, toPhase);
    return updated;
  }

  /** MODIFIED: final permit completion (replaces construction-ready gate) */
  async markPermitDone(id: string, _actorId: string) {
    const row = await this.prisma.permitCluster.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Cluster tidak ditemukan');

    const updated = await this.prisma.permitCluster.update({
      where: { id },
      data: {
        status: 'COMPLETED' as PermitClusterStatus,
        currentPhase: 'PERMIT_DONE',
        readyForConstructionAt: new Date(),
      },
    });

    const allRoleRooms = [
      'role:GENERAL_MANAGER',
      'role:OPERATIONAL_MANAGER',
      'role:PM_FTTH', 'role:PM_FTTB', 'role:PM_FTTT', 'role:PM_SENIOR',
      'role:SURVEYOR_FTTH', 'role:SURVEYOR_FTTB', 'role:SURVEYOR_FTTT',
      'role:ADMIN', 'role:ADMIN_STOCK', 'role:FINANCE',
      'role:MARKETING', 'role:MARKETING_HEAD',
    ]; // NEW: explicit role-room broadcast for permit done
    for (const room of allRoleRooms) {
      this.gateway.emitToRoom(room, 'cluster:permitDone', {
        clusterId: updated.id,
        clusterCode: updated.clusterCode,
        siteName: row.clusterCode,
        ispCustomer: row.ispCustomer,
        completedAt: new Date().toISOString(),
      });
    }
    this.gateway.emitToAll('permitCluster:constructionReady', {
      clusterId: updated.id,
      clusterCode: updated.clusterCode,
      readyForConstructionAt: updated.readyForConstructionAt,
    });
    return updated;
  }

  /** FIX: backward-compatible name — now advances to claim phase after BAKP, not terminal */
  async markConstructionReady(id: string, _adminId: string) {
    return this.advancePhaseInternal(id, 'CLAIM_SUBMISSION');
  }

  async getDashboardStats() {
    const byPhase = await this.prisma.permitCluster.groupBy({
      by: ['currentPhase'],
      _count: { id: true },
    });
    const byFiber = await this.prisma.permitCluster.groupBy({
      by: ['fiberType'],
      _count: { id: true },
    });

    const startMonth = new Date();
    startMonth.setDate(1);
    startMonth.setHours(0, 0, 0, 0);

    const completedThisMonth = await this.prisma.permitCluster.count({
      where: {
        status: 'COMPLETED',
        readyForConstructionAt: { gte: startMonth },
      },
    });

    const completed = await this.prisma.permitCluster.findMany({
      where: { status: 'COMPLETED', readyForConstructionAt: { not: null } },
      select: { createdAt: true, readyForConstructionAt: true },
    });
    let avgDays = 0;
    if (completed.length) {
      const sum = completed.reduce((acc, c) => {
        const ms = c.readyForConstructionAt!.getTime() - c.createdAt.getTime();
        return acc + ms / (1000 * 60 * 60 * 24);
      }, 0);
      avgDays = Math.round((sum / completed.length) * 10) / 10;
    }

    return {
      byPhase: Object.fromEntries(byPhase.map((x) => [x.currentPhase, x._count.id])),
      byFiberType: Object.fromEntries(byFiber.map((x) => [x.fiberType, x._count.id])),
      completedThisMonth,
      avgDaysToComplete: avgDays,
    };
  }

  // NEW: Deterministic pseudo-coordinates for map markers (until CleanList has lat/lng)
  hashLngLatFromId(id: string): [number, number] {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
    const u = (h >>> 0) % 400000;
    const lng = 106.72 + (u % 2000) / 5000;
    const lat = -6.38 + ((Math.floor(u / 2000) % 2000) / 5000);
    return [lng, lat];
  }

  async findForMapMarkers(userRole: Role, userId: string) {
    const where: Prisma.PermitClusterWhereInput = {};
    if (([Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT] as Role[]).includes(userRole)) {
      where.assignedPmId = userId;
    }
    const rows = await this.prisma.permitCluster.findMany({
      where,
      include: { assignedPm: { select: { name: true, email: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 5000,
    });
    return rows.map((r) => {
      const [lng, lat] = this.hashLngLatFromId(r.id);
      return {
        id: r.id,
        clusterCode: r.clusterCode,
        ispCustomer: r.ispCustomer,
        fiberType: r.fiberType,
        status: r.status,
        currentPhase: r.currentPhase,
        pmName: r.assignedPm?.name ?? '—',
        lng,
        lat,
      };
    });
  }
}
