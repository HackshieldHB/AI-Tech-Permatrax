import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FtttClosingLogType,
  FtttCompany,
  FtttDocumentType,
  FtttImplLogType,
  FtttPhase,
  FtttPhaseStatus,
  FtttProjectStatus,
  Role,
} from '@prisma/client';
// ─── Reconciliation doc config (mirrors frontend RECON_DOCS) ─────────────────
// docKeys that do NOT need PM approval — set to APPROVED on upload
const RECON_NO_APPROVAL = new Set([
  // Telkom Infra Closing — Finance uploads, auto-approved
  'JAMINAN_PEMELIHARAAN', 'INVOICE_FINAL',
  // PST Closing — Finance uploads, auto-approved
  'INVOICE_PST_CLOSING', 'JAMINAN_PEMELIHARAAN_PST', 'JAMINAN_PELAKSANAAN_PST',
  // iFORTE — no approval needed
  'PUNCHLIST', 'PO_FINAL', 'PSS', 'MCV', 'INVOICE_IFORTE',
]);

// Required docs per company for RECONCILIATION phase readiness
// Tuple: [docKey, needsApproval (true = must be APPROVED, false = just must exist)]
const RECON_REQUIRED: Record<string, Array<[string, boolean, string]>> = {
  TELKOM_INFRA: [
    // Admin uploads → PM approves (single-level approval)
    ['RISALAH_RAPAT_MOM',           true, 'Risalah Rapat/MOM'],
    ['BOQ_REKONSILIASI',            true, 'BOQ Rekonsiliasi'],
    ['BA_PENUTUPAN',                true, 'BA Penutupan'],
    ['BAPP_TI',                     true, 'BAPP'],
    ['BAST_1_TI',                   true, 'BAST 1'],
    ['NOTA_DINAS',                  true, 'Nota Dinas'],
    ['NOTA_DINAS_TIM_UJI_TERIMA',   true, 'Nota Dinas Tim Uji Terima'],
    ['PO_TI',                       true, 'PO'],
    ['AMANDEMEN_1_TI',              true, 'Amandemen 1'],
    ['AMANDEMEN_2_TI',              true, 'Amandemen 2'],
    // NOTE: Jaminan Pemeliharaan & Invoice Final in CLOSING phase
  ],
  PST: [
    // Admin uploads → PM approves
    ['REKONSILIASI',      true, 'Rekonsiliasi'],
    ['BAST',              true, 'BAST'],
    ['GOOD_RECEIPT_PST',  true, 'Good Receipt'],
    // Invoice moved to Closing phase
  ],
  IFORTE: [
    ['PUNCHLIST',         false, 'Punchlist'],
    ['ENDORSEMENT',       true,  'Endorsement (perlu disetujui)'],
    ['PO_FINAL',          false, 'PO Final'],
    ['PSS',               false, 'PSS'],
    ['MCV',               false, 'MCV'],
    ['INVOICE_IFORTE',    false, 'Invoice'],
  ],
};

import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { paginate } from '../common/dto/pagination.dto';
import {
  AddClosingLogDtoType,
  AddFtttTransactionDtoType,
  AddImplLogDtoType,
  AddJaminanDtoType,
  AddReconDocDtoType,
  AddSpanDtoType,
  AddSpanLogDtoType,
  AdvancePhaseDtoType,
  ApproveDocumentDtoType,
  CreateFtttProjectDtoType,
  FtttProjectFilterDtoType,
  FTTT_PHASES_BY_COMPANY,
  ResolveSanggahDtoType,
  SubmitSanggahDtoType,
  UploadDocumentDtoType,
  UploadDrmDocDtoType,
  UploadSurveyDtoType,
} from './fttt-project.dto';

@Injectable()
export class FtttProjectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly gateway: NotificationsGateway,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── Create project (PM_FTTT only — Issue #5) ─────────────────────────────
  async create(dto: CreateFtttProjectDtoType, triggerDocFile: Express.Multer.File, pmId: string, userRole: Role) {
    // Issue #5: Only PM_FTTT can initiate a project
    if (userRole !== Role.PM_FTTT) {
      throw new ForbiddenException('Hanya PM FTTT yang dapat membuat Project Initiation');
    }
    const triggerDocUrl = await this.storage.uploadMulterFile(triggerDocFile, 'fttt-trigger', dto.ftttCompany);

    // JLM: link to a Finance Project (must be Project Type = FTTT and active)
    let linkedProjectName: string | null = dto.projectName ?? null;
    if (dto.financeProjectId) {
      const fp = await this.prisma.financeProject.findUnique({
        where: { id: dto.financeProjectId },
        select: { id: true, name: true, projectType: true, status: true },
      });
      if (!fp || fp.projectType !== 'FTTT') {
        throw new BadRequestException('Finance Project tidak valid (harus bertipe FTTT)');
      }
      if (fp.status !== 'ACTIVE') {
        throw new BadRequestException('Finance Project tidak aktif');
      }
      linkedProjectName = dto.projectName?.trim() || fp.name;
    }

    const phases = FTTT_PHASES_BY_COMPANY[dto.ftttCompany];
    const allPhases: FtttPhase[] = [
      FtttPhase.INITIATION,
      FtttPhase.SURVEY,
      FtttPhase.PREPARATION,
      FtttPhase.IMPLEMENTATION,
      FtttPhase.DOCUMENTATION,
      FtttPhase.RECONCILIATION,
      FtttPhase.CLOSING,
    ];

    const project = await this.prisma.ftttProject.create({
      data: {
        ftttCompany:    dto.ftttCompany,
        triggerDocUrl,
        triggerDocType: dto.triggerDocType,
        // Use checked relation form (pm: { connect }) instead of scalar pmId,
        // because mixing scalar pmId with nested createMany causes Prisma to
        // switch to checked mode and then complain pm is missing. (#fttt-500-fix)
        pm:             { connect: { id: pmId } },
        cleanList:      dto.cleanListId ? { connect: { id: dto.cleanListId } } : undefined,
        financeProject: dto.financeProjectId ? { connect: { id: dto.financeProjectId } } : undefined,
        projectName:    linkedProjectName,
        notes:          dto.notes ?? null,
        currentPhase:   FtttPhase.INITIATION,
        status:         FtttProjectStatus.ACTIVE,
        phaseProgresses: {
          createMany: {
            data: allPhases.map((phase) => {
              const inLifecycle = phases.includes(phase);
              if (!inLifecycle) {
                return { phase, status: FtttPhaseStatus.SKIPPED };
              }
              return {
                phase,
                status: phase === FtttPhase.INITIATION
                  ? FtttPhaseStatus.ACTIVE
                  : FtttPhaseStatus.LOCKED,
                unlockedAt: phase === FtttPhase.INITIATION ? new Date() : null,
              };
            }),
          },
        },
      },
      include: this.fullInclude(),
    });

    this.gateway.emitToAll('fttt:project_created', {
      projectId: project.id,
      company:   project.ftttCompany,
      pmId,
    });

    return project;
  }

  // ─── Issue 13: Replace / delete triggering document (INITIATION phase only) ─
  async replaceTriggerDoc(id: string, file: Express.Multer.File | undefined, userId: string, userRole: Role) {
    if (userRole !== Role.ADMIN && userRole !== Role.GENERAL_MANAGER && userRole !== Role.PM_FTTT) {
      throw new ForbiddenException('Hanya Admin atau PM FTTT yang dapat mengganti dokumen triggering');
    }
    const project = await this.prisma.ftttProject.findUniqueOrThrow({ where: { id }, select: { id: true, currentPhase: true, ftttCompany: true } });
    if (project.currentPhase !== FtttPhase.INITIATION) {
      throw new BadRequestException('Dokumen triggering hanya dapat diganti pada fase Project Initiation');
    }
    if (!file) throw new BadRequestException('File dokumen wajib diunggah');
    const triggerDocUrl = await this.storage.uploadMulterFile(file, 'fttt-trigger', project.ftttCompany);
    return this.prisma.ftttProject.update({
      where: { id },
      data: { triggerDocUrl },
      include: this.fullInclude(),
    });
  }

  // ─── List ─────────────────────────────────────────────────────────────────
  async findAll(filters: FtttProjectFilterDtoType, userId: string, userRole: Role) {
    const { company, phase, status, page, limit } = filters;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (company) where.ftttCompany = company;
    if (phase)   where.currentPhase = phase;
    if (status && status !== 'all') where.status = status;

    // PM_FTTT only sees their own projects; Admin/GM/Finance/Surveyor see all
    const managingRoles: Role[] = [
      Role.ADMIN, Role.GENERAL_MANAGER, Role.ADMIN_STOCK,
      Role.FINANCE,         // Finance uploads Jaminan — needs to see all projects
      Role.SURVEYOR_FTTT,   // Surveyor needs to see projects they're working on
    ];
    if (!managingRoles.includes(userRole)) {
      where.pmId = userId;
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.ftttProject.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          pm: { select: { id: true, name: true } },
          phaseProgresses: { orderBy: { phase: 'asc' } },
          _count: {
            select: {
              surveyUploads: true,
              drmDocuments: true,
              sanggahs: true,
              documents: true,
            },
          },
        },
      }),
      this.prisma.ftttProject.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  // ─── Single project detail ────────────────────────────────────────────────
  async findOne(id: string, userId: string, userRole: Role) {
    const project = await this.prisma.ftttProject.findUnique({
      where: { id },
      include: this.fullInclude(),
    });
    if (!project) throw new NotFoundException('FTTT project tidak ditemukan');

    // Roles that can view any project regardless of pmId
    const managingRoles: Role[] = [
      Role.ADMIN, Role.GENERAL_MANAGER,
      Role.FINANCE,         // Finance uploads Jaminan for TELKOM_INFRA projects
      Role.SURVEYOR_FTTT,   // Surveyor uploads survey evidence for iForte/PST projects
    ];
    if (!managingRoles.includes(userRole) && project.pmId !== userId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke project ini');
    }

    // JLM: surface a maintenance reminder to Admins when the window is reached
    await this.maybeSendMaintenanceReminder(project);

    return project;
  }

  // ─── Phase gate check: can the current phase be completed? ───────────────
  async checkPhaseReadiness(id: string): Promise<{ ready: boolean; blockedReasons: string[] }> {
    const project = await this.prisma.ftttProject.findUnique({
      where: { id },
      include: {
        surveyUploads:      true,
        drmDocuments:       true,
        jaminans:           true,
        documents:          { where: { approvalStatus: 'APPROVED' } },
        reconDocs:          true,
        closingLogs:        true,
        implementationLogs: true,  // needed for IMPLEMENTATION phase check
        phaseProgresses:    true,  // needed to check lapangan-done flag
      },
    });
    if (!project) throw new NotFoundException();

    const phase   = project.currentPhase;
    const company = project.ftttCompany;
    const reasons: string[] = [];

    if (phase === FtttPhase.INITIATION) {
      // trigger doc is always uploaded at creation, so always ready
    }

    if (phase === FtttPhase.SURVEY) {
      if (project.surveyUploads.length === 0) {
        reasons.push('Minimal satu bukti survei wajib diunggah');
      }
    }

    // C7-PST3: Implementation readiness — lapangan must be marked done + Admin must upload monitoring doc
    if (phase === FtttPhase.IMPLEMENTATION) {
      const implProg = (project as typeof project & { phaseProgresses: { phase: string; notes: string | null }[] })
        .phaseProgresses?.find((p) => p.phase === 'IMPLEMENTATION');
      const lapanganDone = implProg?.notes === 'SURVEYOR_DONE';
      if (!lapanganDone) {
        reasons.push('Pekerjaan lapangan belum ditandai selesai');
      }
      const implLogs = (project as typeof project & { implementationLogs: { logType: string }[] })
        .implementationLogs ?? [];
      const hasMonitoringDoc = implLogs.some((l) => l.logType === 'MONITORING_DOC');
      if (!hasMonitoringDoc) {
        reasons.push('Dokumen Monitoring belum diunggah oleh Admin');
      }
      // JLM: PST must choose an implementation type (Galian / KU) before completing Implementation
      if (
        company === FtttCompany.PST &&
        !(project as typeof project & { implementationType: string | null }).implementationType
      ) {
        reasons.push('Jenis Implementasi (Galian / KU) belum dipilih');
      }
    }

    // PST Procurement phase readiness — Finance must have uploaded PO
    if (phase === FtttPhase.PROCUREMENT) {
      const reconDocMap = new Map(
        (project as typeof project & { reconDocs: { docKey: string }[] })
          .reconDocs.map((d) => [d.docKey, true]),
      );
      if (!reconDocMap.has('PO_PROCUREMENT')) {
        reasons.push('Dokumen Purchase Order (PO) belum diunggah oleh Finance');
      }
    }

    if (phase === FtttPhase.PREPARATION) {
      if (company === FtttCompany.TELKOM_INFRA) {
        const hasUangMuka = project.jaminans.some((j) => j.jaminanType === 'JAMINAN_UANG_MUKA');
        const hasPelaksanaan = project.jaminans.some((j) => j.jaminanType === 'JAMINAN_PELAKSANAAN');
        if (!hasUangMuka) reasons.push('Jaminan Uang Muka belum diunggah');
        if (!hasPelaksanaan) reasons.push('Jaminan Pelaksanaan belum diunggah');
      }
      if (company === FtttCompany.PST) {
        const hasBoq = project.drmDocuments.some((d) => d.docType === 'BOQ_INITIAL');
        const hasDrm = project.drmDocuments.some((d) => d.docType === 'DRM_RESULT');
        if (!hasBoq) reasons.push('Dokumen BOQ Awal belum diunggah');
        if (!hasDrm) reasons.push('Dokumen Hasil DRM belum diunggah');
      }
    }

    if (phase === FtttPhase.DOCUMENTATION) {
      // Per-lifecycle required document types for Documentation & Acceptance phase
      const DOC_REQUIRED: Record<string, Array<[string, string]>> = {
        TELKOM_INFRA: [
          ['BACT',            'BACT'],
          ['BAUT',            'BAUT'],
          ['BAUT_REKONSILIASI', 'BA Rekonsiliasi'],
        ],
        PST: [
          ['BACT',            'BACT'],
          ['BAUT',            'BAUT'],
          ['BAUT_REKONSILIASI', 'BA Rekonsiliasi'],
        ],
        IFORTE: [['ATP', 'ATP'], ['EVIDENCE', 'Evidence']],
      };
      const required = DOC_REQUIRED[company] ?? [];
      // project.documents is filtered to APPROVED only in the include above
      const approvedTypes = new Set(project.documents.map((d) => d.docType));
      for (const [docType, label] of required) {
        if (!approvedTypes.has(docType as any)) {
          reasons.push(`Dokumen ${label} belum disetujui`);
        }
      }
    }

    // CLOSING phase readiness
    if (phase === FtttPhase.CLOSING) {
      const reconDocMap = new Map(
        (project as typeof project & { reconDocs: { docKey: string }[] })
          .reconDocs.map((d) => [d.docKey, true]),
      );

      if (company === FtttCompany.TELKOM_INFRA) {
        // TI Closing: only Finance docs (BAST II / Evidence / Note removed)
        if (!reconDocMap.has('JAMINAN_PEMELIHARAAN')) {
          reasons.push('Jaminan Pemeliharaan belum diunggah oleh Finance');
        }
        if (!reconDocMap.has('INVOICE_FINAL')) {
          reasons.push('Invoice Final belum diunggah oleh Finance');
        }
      } else if (company === FtttCompany.PST) {
        // PST Closing: Finance uploads Invoice, Jaminan Pemeliharaan, Jaminan Pelaksanaan
        if (!reconDocMap.has('INVOICE_PST_CLOSING')) {
          reasons.push('Invoice belum diunggah oleh Finance');
        }
        if (!reconDocMap.has('JAMINAN_PEMELIHARAAN_PST')) {
          reasons.push('Jaminan Pemeliharaan belum diunggah oleh Finance');
        }
        if (!reconDocMap.has('JAMINAN_PELAKSANAAN_PST')) {
          reasons.push('Jaminan Pelaksanaan belum diunggah oleh Finance');
        }
      } else {
        // iFORTE — BAST II must be approved + evidence/note
        const closingLogs = (project as typeof project & {
          closingLogs: { logType: string; approvalStatus: string | null }[];
        }).closingLogs ?? [];

        const bastII = closingLogs.find((l) => l.logType === 'BAST_II');
        if (!bastII) {
          reasons.push('Dokumen BAST II belum diunggah');
        } else if (bastII.approvalStatus !== 'APPROVED') {
          reasons.push('Dokumen BAST II belum disetujui PM FTTT');
        }
        const hasEvidence = closingLogs.some((l) => l.logType === 'EVIDENCE');
        const hasNote     = closingLogs.some((l) => l.logType === 'NOTE');
        if (!hasEvidence && !hasNote) {
          reasons.push('Minimal satu evidence foto atau catatan serah terima wajib diunggah');
        }
      }

      // JLM: TI + PST require Admin to confirm the maintenance period is complete
      if (company === FtttCompany.TELKOM_INFRA || company === FtttCompany.PST) {
        if (!(project as typeof project & { maintenanceConfirmedAt: Date | null }).maintenanceConfirmedAt) {
          reasons.push('Konfirmasi penyelesaian masa pemeliharaan belum dilakukan oleh Admin Project');
        }
      }
    }

    // Fix #2: RECONCILIATION phase readiness — all required docs must be uploaded/approved
    if (phase === FtttPhase.RECONCILIATION) {
      const required = RECON_REQUIRED[company] ?? [];
      const reconDocMap = new Map(
        (project as typeof project & { reconDocs: { docKey: string; approvalStatus: string }[] })
          .reconDocs.map((d) => [d.docKey, d.approvalStatus]),
      );

      for (const [docKey, needsApproval, label] of required) {
        const status = reconDocMap.get(docKey);
        if (!status) {
          reasons.push(`${label} belum diunggah`);
        } else if (needsApproval && status !== 'APPROVED') {
          reasons.push(`${label} belum disetujui`);
        }
      }
    }

    return { ready: reasons.length === 0, blockedReasons: reasons };
  }

  // ─── C6-PST2: Submit Survey for PM review (Surveyor) ─────────────────────
  async submitSurveyForReview(id: string, userId: string, userRole: Role) {
    if (userRole !== Role.SURVEYOR_FTTT) {
      throw new ForbiddenException('Hanya Surveyor FTTT yang dapat submit survey untuk review PM');
    }
    const project = await this.prisma.ftttProject.findUniqueOrThrow({ where: { id } });
    if (project.currentPhase !== FtttPhase.SURVEY) {
      throw new BadRequestException('Project tidak dalam fase Survey');
    }
    // Check at least 1 upload
    const count = await this.prisma.ftttSurveyUpload.count({ where: { projectId: id } });
    if (count === 0) {
      throw new BadRequestException('Minimal satu bukti survei wajib diunggah sebelum submit ke PM');
    }
    await this.prisma.ftttPhaseProgress.update({
      where: { projectId_phase: { projectId: id, phase: FtttPhase.SURVEY } },
      data: { notes: 'PENDING_PM_REVIEW' },
    });
    // C7-PST1: Notify PM that survey is ready for review
    const proj = await this.prisma.ftttProject.findUniqueOrThrow({ where: { id }, select: { projectName: true, pmId: true } });
    if (proj.pmId) {
      await this.notifications.createForUser(proj.pmId, {
        title:   'FTTT — Survey Menunggu Review',
        message: `Surveyor telah mengirim bukti survei untuk project ${proj.projectName ?? id.slice(-6)}. Silakan review.`,
        type:    'FTTT_SURVEY_SUBMITTED',
        link:    `/fttt-projects/${id}`,
        entityId: id,
      });
    }
    return this.prisma.ftttProject.findUniqueOrThrow({ where: { id }, include: this.fullInclude() });
  }

  // ─── C6-PST2: PM reviews Survey phase ────────────────────────────────────
  async reviewSurveyPhase(id: string, approved: boolean, rejectionNotes: string | undefined, userId: string, userRole: Role) {
    const allowed: Role[] = [Role.PM_FTTT, Role.ADMIN, Role.GENERAL_MANAGER];
    if (!allowed.includes(userRole)) {
      throw new ForbiddenException('Hanya PM FTTT yang dapat mereview fase Validation & Survey');
    }
    const project = await this.prisma.ftttProject.findUniqueOrThrow({
      where: { id },
      include: { phaseProgresses: true },
    });
    if (project.currentPhase !== FtttPhase.SURVEY) {
      throw new BadRequestException('Project tidak dalam fase Survey');
    }
    const surveyProg = project.phaseProgresses.find((p) => p.phase === 'SURVEY');
    if (surveyProg?.notes !== 'PENDING_PM_REVIEW') {
      throw new BadRequestException('Survey belum disubmit Surveyor untuk review');
    }
    if (approved) {
      // PM approves → advance phase
      return this.advancePhase(id, {}, userId, userRole);
    } else {
      if (!rejectionNotes?.trim()) throw new BadRequestException('Alasan penolakan wajib diisi');
      await this.prisma.ftttPhaseProgress.update({
        where: { projectId_phase: { projectId: id, phase: FtttPhase.SURVEY } },
        data: { notes: `REJECTED:${rejectionNotes.trim()}` },
      });
      return this.prisma.ftttProject.findUniqueOrThrow({ where: { id }, include: this.fullInclude() });
    }
  }

  // ─── Mark Implementation lapangan done ───────────────────────────────────
  async markImplementationLapanganDone(id: string, userId: string, userRole: Role) {
    const project = await this.prisma.ftttProject.findUniqueOrThrow({ where: { id } });
    // TI: Admin-only; PST/iFORTE: Surveyor or Admin
    if (project.ftttCompany === FtttCompany.TELKOM_INFRA) {
      if (userRole !== Role.ADMIN && userRole !== Role.GENERAL_MANAGER) {
        throw new ForbiddenException('Hanya Admin yang dapat menandai pekerjaan lapangan selesai untuk project Telkom Infra');
      }
    } else {
      const allowed: Role[] = [Role.SURVEYOR_FTTT, Role.ADMIN, Role.GENERAL_MANAGER];
      if (!allowed.includes(userRole)) {
        throw new ForbiddenException('Hanya Surveyor FTTT atau Admin yang dapat menandai pekerjaan lapangan selesai');
      }
    }
    if (project.currentPhase !== FtttPhase.IMPLEMENTATION) {
      throw new BadRequestException('Project tidak dalam fase Implementation');
    }
    await this.prisma.ftttPhaseProgress.update({
      where: { projectId_phase: { projectId: id, phase: FtttPhase.IMPLEMENTATION } },
      data: { notes: 'SURVEYOR_DONE' },
    });
    await this.notifications.notifyUsersByRole(Role.ADMIN, {
      title:   'FTTT — Pekerjaan Lapangan Selesai',
      message: `Pekerjaan lapangan untuk project ${project.projectName ?? id.slice(-6)} telah ditandai selesai. Silakan upload Dokumen Monitoring dan selesaikan fase Implementation.`,
      type:    'FTTT_LAPANGAN_DONE',
      link:    `/fttt-projects/${id}`,
      entityId: id,
    });
    return this.prisma.ftttProject.findUniqueOrThrow({ where: { id }, include: this.fullInclude() });
  }

  // ─── Advance to next phase ────────────────────────────────────────────────
  async advancePhase(id: string, dto: AdvancePhaseDtoType, userId: string, userRole?: Role) {
    const { ready, blockedReasons } = await this.checkPhaseReadiness(id);
    if (!ready) {
      throw new BadRequestException(
        `Fase belum bisa diselesaikan: ${blockedReasons.join('; ')}`,
      );
    }

    const project = await this.prisma.ftttProject.findUniqueOrThrow({
      where: { id },
      include: { phaseProgresses: true },
    });

    // C5-Issue4: Only Admin can complete the Implementation phase
    if (
      project.currentPhase === FtttPhase.IMPLEMENTATION &&
      userRole !== Role.ADMIN &&
      userRole !== Role.GENERAL_MANAGER
    ) {
      throw new ForbiddenException('Hanya Admin yang dapat menyelesaikan fase Implementation');
    }

    // JLM: Only Admin can complete Project Closing (after confirming maintenance period)
    if (
      project.currentPhase === FtttPhase.CLOSING &&
      userRole !== Role.ADMIN &&
      userRole !== Role.GENERAL_MANAGER
    ) {
      throw new ForbiddenException('Hanya Admin Project yang dapat menyelesaikan fase Project Closing');
    }

    // C6-TI2: Only PM FTTT or Admin can complete Documentation & Reconciliation phases
    if (
      (project.currentPhase === FtttPhase.DOCUMENTATION || project.currentPhase === FtttPhase.RECONCILIATION) &&
      userRole !== Role.PM_FTTT &&
      userRole !== Role.ADMIN &&
      userRole !== Role.GENERAL_MANAGER
    ) {
      throw new ForbiddenException('Hanya PM FTTT atau Admin yang dapat menyelesaikan fase ini');
    }

    const lifecycle = FTTT_PHASES_BY_COMPANY[project.ftttCompany as FtttCompany];
    const currentIdx = lifecycle.indexOf(project.currentPhase as FtttPhase);
    if (currentIdx === -1) throw new BadRequestException('Phase tidak valid');

    const nextPhase = lifecycle[currentIdx + 1] ?? null;

    await this.prisma.$transaction(async (tx) => {
      // Mark current phase complete
      await tx.ftttPhaseProgress.update({
        where: { projectId_phase: { projectId: id, phase: project.currentPhase } },
        data: {
          status:       FtttPhaseStatus.COMPLETED,
          completedAt:  new Date(),
          completedById: userId,
          notes:        dto.notes ?? null,
        },
      });

      if (nextPhase) {
        // C7-PST4: upsert to handle old projects that may not have a phaseProgress row for new phases
        await tx.ftttPhaseProgress.upsert({
          where: { projectId_phase: { projectId: id, phase: nextPhase } },
          update: { status: FtttPhaseStatus.ACTIVE, unlockedAt: new Date() },
          create: { projectId: id, phase: nextPhase, status: FtttPhaseStatus.ACTIVE, unlockedAt: new Date() },
        });
        await tx.ftttProject.update({
          where: { id },
          data:  { currentPhase: nextPhase },
        });
      } else {
        // All phases done → project complete
        await tx.ftttProject.update({
          where: { id },
          data:  { status: FtttProjectStatus.COMPLETED },
        });
      }
    });

    const updated = await this.prisma.ftttProject.findUniqueOrThrow({
      where: { id },
      include: this.fullInclude(),
    });

    // Live progress bar event
    this.gateway.emitToAll('fttt:phase_advanced', {
      projectId:     id,
      previousPhase: project.currentPhase,
      currentPhase:  updated.currentPhase,
      status:        updated.status,
      phases:        updated.phaseProgresses,
    });

    const pName = updated.projectName ?? updated.id.slice(-6).toUpperCase();
    const pmId  = updated.pmId;

    // Notify Finance when Telkom Infra project enters PREPARATION phase
    if (
      project.currentPhase === FtttPhase.INITIATION &&
      updated.currentPhase === FtttPhase.PREPARATION &&
      project.ftttCompany === FtttCompany.TELKOM_INFRA
    ) {
      await this.notifications.notifyUsersByRole(Role.FINANCE, {
        title:    'FTTT Project — Upload Dokumen Jaminan Diperlukan',
        message:  `Project ${pName} (Telkom Infra) telah memasuki fase Project Preparation. Silakan upload dokumen Jaminan Uang Muka dan Jaminan Pelaksanaan.`,
        type:     'FTTT_JAMINAN_REQUIRED',
        link:     `/fttt-projects/${id}`,
        entityId: id,
      });
    }

    // C7-PST1: Notify PM when project enters Survey phase (Surveyor needs to upload evidence)
    if (updated.currentPhase === FtttPhase.SURVEY) {
      await this.notifications.notifyUsersByRole(Role.SURVEYOR_FTTT, {
        title:   'FTTT — Fase Validation & Survey Dimulai',
        message: `Project ${pName} telah memasuki fase Validation & Survey. Silakan upload bukti survei.`,
        type:    'FTTT_PHASE_CHANGE',
        link:    `/fttt-projects/${id}`,
        entityId: id,
      });
    }

    // C7-PST1: Notify PM when project advances to Preparation
    if (updated.currentPhase === FtttPhase.PREPARATION && pmId) {
      await this.notifications.createForUser(pmId, {
        title:   'FTTT — Fase Project Preparation Dimulai',
        message: `Project ${pName} telah memasuki fase Project Preparation.`,
        type:    'FTTT_PHASE_CHANGE',
        link:    `/fttt-projects/${id}`,
        entityId: id,
      });
    }

    // C7-PST1: Notify PM + Admin when project enters Implementation
    if (updated.currentPhase === FtttPhase.IMPLEMENTATION) {
      if (pmId) {
        await this.notifications.createForUser(pmId, {
          title:   'FTTT — Fase Implementation Dimulai',
          message: `Project ${pName} telah memasuki fase Implementation.`,
          type:    'FTTT_PHASE_CHANGE',
          link:    `/fttt-projects/${id}`,
          entityId: id,
        });
      }
      await this.notifications.notifyUsersByRole(Role.SURVEYOR_FTTT, {
        title:   'FTTT — Fase Implementation Dimulai',
        message: `Project ${pName} siap untuk upload progress implementasi.`,
        type:    'FTTT_PHASE_CHANGE',
        link:    `/fttt-projects/${id}`,
        entityId: id,
      });
    }

    // C7-PST1: Notify PM when project enters Documentation or Reconciliation
    if (
      (updated.currentPhase === FtttPhase.DOCUMENTATION || updated.currentPhase === FtttPhase.RECONCILIATION) &&
      pmId
    ) {
      await this.notifications.createForUser(pmId, {
        title:   `FTTT — Fase ${updated.currentPhase === FtttPhase.DOCUMENTATION ? 'Documentation & Acceptance' : 'Reconciliation & Billing'} Dimulai`,
        message: `Project ${pName} memerlukan upload dokumen pada fase ini.`,
        type:    'FTTT_PHASE_CHANGE',
        link:    `/fttt-projects/${id}`,
        entityId: id,
      });
    }

    // C7-PST1: Notify Admin when project enters Closing
    if (updated.currentPhase === FtttPhase.CLOSING) {
      await this.notifications.notifyUsersByRole(Role.ADMIN, {
        title:   'FTTT — Fase Project Closing Dimulai',
        message: `Project ${pName} telah memasuki fase Project Closing. Upload BAST II dan Evidence setelah masa pemeliharaan selesai.`,
        type:    'FTTT_PHASE_CHANGE',
        link:    `/fttt-projects/${id}`,
        entityId: id,
      });
      // C7.4: Notify Finance when TI project enters Closing — Finance uploads Jaminan + Invoice Final
      if (project.ftttCompany === FtttCompany.TELKOM_INFRA) {
        await this.notifications.notifyUsersByRole(Role.FINANCE, {
          title:   'FTTT — Upload Jaminan Pemeliharaan & Invoice Final Diperlukan',
          message: `Project ${pName} (Telkom Infra) telah memasuki fase Project Closing. Silakan upload dokumen Jaminan Pemeliharaan dan Invoice Final.`,
          type:    'FTTT_FINANCE_REQUIRED',
          link:    `/fttt-projects/${id}`,
          entityId: id,
        });
      }
      // Issue 12 (PST): Notify Finance — Finance uploads Invoice + Jaminan Pemeliharaan + Jaminan Pelaksanaan
      if (project.ftttCompany === FtttCompany.PST) {
        await this.notifications.notifyUsersByRole(Role.FINANCE, {
          title:   'FTTT — Upload Invoice & Jaminan Diperlukan',
          message: `Project ${pName} (PST) telah memasuki fase Project Closing. Silakan upload dokumen Invoice, Jaminan Pemeliharaan, dan Jaminan Pelaksanaan.`,
          type:    'FTTT_FINANCE_REQUIRED',
          link:    `/fttt-projects/${id}`,
          entityId: id,
        });
      }
    }

    // Issue 8 (PST): Notify Finance when project enters Procurement — Finance uploads the Purchase Order
    if (updated.currentPhase === FtttPhase.PROCUREMENT && project.ftttCompany === FtttCompany.PST) {
      await this.notifications.notifyUsersByRole(Role.FINANCE, {
        title:   'FTTT — Upload Purchase Order (PO) Diperlukan',
        message: `Project ${pName} (PST) telah memasuki fase Procurement. Silakan upload dokumen Purchase Order (PO) untuk melanjutkan ke fase Implementation.`,
        type:    'FTTT_FINANCE_REQUIRED',
        link:    `/fttt-projects/${id}`,
        entityId: id,
      });
    }

    // C7.4: Notify Finance when PST/iFORTE project enters Reconciliation — Finance uploads BAST_1 + Invoice
    if (updated.currentPhase === FtttPhase.RECONCILIATION) {
      if (project.ftttCompany === FtttCompany.PST) {
        await this.notifications.notifyUsersByRole(Role.FINANCE, {
          title:   'FTTT — Upload BAST 1 & Invoice Diperlukan',
          message: `Project ${pName} (PST) telah memasuki fase Reconciliation & Billing. Silakan upload dokumen BAST 1 dan Invoice.`,
          type:    'FTTT_FINANCE_REQUIRED',
          link:    `/fttt-projects/${id}`,
          entityId: id,
        });
      }
      if (project.ftttCompany === FtttCompany.IFORTE) {
        await this.notifications.notifyUsersByRole(Role.FINANCE, {
          title:   'FTTT — Upload Invoice Diperlukan',
          message: `Project ${pName} (iFORTE) telah memasuki fase Reconciliation & Billing. Silakan upload dokumen Invoice.`,
          type:    'FTTT_FINANCE_REQUIRED',
          link:    `/fttt-projects/${id}`,
          entityId: id,
        });
      }
    }

    return updated;
  }

  // ─── Upload survey evidence (iForte / PST only) ───────────────────────────
  async uploadSurveyEvidence(
    id: string,
    file: Express.Multer.File | undefined,
    dto: UploadSurveyDtoType,
    userId: string,
    userRole?: Role,
  ) {
    // C7.1: Only Surveyor FTTT can upload survey documents
    if (userRole && userRole !== Role.SURVEYOR_FTTT && userRole !== Role.ADMIN && userRole !== Role.GENERAL_MANAGER) {
      throw new ForbiddenException('Hanya Surveyor FTTT yang dapat meng-upload dokumen pada fase Validation & Survey');
    }
    // C7.1: operational_notes is text-only — no file required
    const isTextOnly = dto.fileType === 'operational_notes';
    if (!file && !isTextOnly) {
      throw new BadRequestException('File dokumen survei wajib diunggah');
    }
    if (isTextOnly && !dto.caption?.trim()) {
      throw new BadRequestException('Isi catatan lapangan tidak boleh kosong');
    }
    await this.prisma.ftttProject.findUniqueOrThrow({ where: { id } });
    let fileUrl = '';
    if (file) {
      fileUrl = await this.storage.uploadMulterFile(file, 'fttt-survey', id);
    }
    return this.prisma.ftttSurveyUpload.create({
      data: { projectId: id, uploadedById: userId, fileUrl, fileType: dto.fileType, caption: dto.caption ?? null },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
  }

  // ─── DRM document (PST only) ──────────────────────────────────────────────
  async uploadDrmDocument(
    id: string,
    file: Express.Multer.File,
    dto: UploadDrmDocDtoType,
    userId: string,
  ) {
    const project = await this.prisma.ftttProject.findUniqueOrThrow({ where: { id } });
    if (project.ftttCompany !== FtttCompany.PST) {
      throw new BadRequestException('DRM hanya tersedia untuk project PST');
    }

    // Auto-version: find max existing version for this docType
    const latest = await this.prisma.ftttDrmDocument.findFirst({
      where:   { projectId: id, docType: dto.docType },
      orderBy: { version: 'desc' },
    });
    const version = (latest?.version ?? 0) + 1;

    const fileUrl = await this.storage.uploadMulterFile(file, 'fttt-drm', id);
    return this.prisma.ftttDrmDocument.create({
      data: { projectId: id, docType: dto.docType, version, fileUrl, notes: dto.notes ?? null, uploadedById: userId },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
  }

  // Get DRM history (all versions of all doc types)
  async getDrmHistory(id: string) {
    return this.prisma.ftttDrmDocument.findMany({
      where:   { projectId: id },
      orderBy: [{ docType: 'asc' }, { version: 'asc' }],
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
  }

  // ─── Sanggah (iForte only, max 2) ─────────────────────────────────────────
  async submitSanggah(
    id: string,
    dto: SubmitSanggahDtoType,
    file: Express.Multer.File | undefined,
    userId: string,
  ) {
    const project = await this.prisma.ftttProject.findUniqueOrThrow({ where: { id } });
    if (project.ftttCompany !== FtttCompany.IFORTE) {
      throw new BadRequestException('Sanggah hanya tersedia untuk project iForte');
    }

    const existing = await this.prisma.ftttSanggah.count({ where: { projectId: id } });
    if (existing >= 2) {
      throw new BadRequestException('Maksimal 2 kali pengajuan sanggah');
    }

    let fileUrl: string | undefined;
    if (file) {
      fileUrl = await this.storage.uploadMulterFile(file, 'fttt-sanggah', id);
    }

    return this.prisma.ftttSanggah.create({
      data: {
        projectId:    id,
        attemptNumber: existing + 1,
        reason:       dto.reason,
        fileUrl:      fileUrl ?? null,
        submittedById: userId,
      },
      include: { submittedBy: { select: { id: true, name: true } } },
    });
  }

  async resolveSanggah(sanggahId: string, dto: ResolveSanggahDtoType, userId: string) {
    return this.prisma.ftttSanggah.update({
      where: { id: sanggahId },
      data:  {
        status:        dto.status,
        resolvedAt:    new Date(),
        resolvedById:  userId,
        responseNotes: dto.responseNotes ?? null,
      },
    });
  }

  // ─── Jaminan (Telkom Infra only, Finance role only) ───────────────────────
  async addJaminan(
    id: string,
    dto: AddJaminanDtoType,
    file: Express.Multer.File | undefined,
    userId: string,
    userRole: Role,
  ) {
    // Only Finance (and Admin/GM for oversight) can upload jaminan documents
    const allowedRoles: Role[] = [Role.FINANCE, Role.ADMIN, Role.GENERAL_MANAGER];
    if (!allowedRoles.includes(userRole)) {
      throw new ForbiddenException('Hanya Finance yang dapat mengunggah dokumen Jaminan');
    }

    const project = await this.prisma.ftttProject.findUniqueOrThrow({
      where: { id },
      include: { jaminans: true },
    });
    if (project.ftttCompany !== FtttCompany.TELKOM_INFRA) {
      throw new BadRequestException('Jaminan hanya tersedia untuk project Telkom Infra');
    }

    // Issue #3: Check if this jaminanType already exists — if so, replace (upsert)
    const existing = project.jaminans.find((j) => j.jaminanType === dto.jaminanType);

    let fileUrl: string | undefined;
    if (file) {
      fileUrl = await this.storage.uploadMulterFile(file, 'fttt-jaminan', id);
    }

    if (existing) {
      // Replace existing document of same type
      return this.prisma.ftttJaminan.update({
        where: { id: existing.id },
        data: {
          amount:      dto.amount ?? null,
          issuer:      dto.issuer ?? null,
          issueDate:   dto.issueDate ?? null,
          expiryDate:  dto.expiryDate ?? null,
          fileUrl:     fileUrl ?? existing.fileUrl,  // keep old file if no new one provided
          notes:       dto.notes ?? null,
          uploadedById: userId,
        },
        include: { uploadedBy: { select: { id: true, name: true } } },
      });
    }

    return this.prisma.ftttJaminan.create({
      data: {
        projectId:   id,
        jaminanType: dto.jaminanType,
        amount:      dto.amount ?? null,
        issuer:      dto.issuer ?? null,
        issueDate:   dto.issueDate ?? null,
        expiryDate:  dto.expiryDate ?? null,
        fileUrl:     fileUrl ?? null,
        notes:       dto.notes ?? null,
        uploadedById: userId,
      },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
  }

  // ─── Documentation upload ──────────────────────────────────────────────────
  // Admin Project uploads; PM FTTT reviews and approves/rejects
  async uploadDocument(
    id: string,
    file: Express.Multer.File | undefined,
    dto: UploadDocumentDtoType,
    userId: string,
    userRole: Role,
  ) {
    const docUploaderRoles: Role[] = [Role.ADMIN, Role.GENERAL_MANAGER];
    if (!docUploaderRoles.includes(userRole)) {
      throw new ForbiddenException('Hanya Admin Project yang dapat mengunggah dokumen pada fase Documentation and Acceptance');
    }

    if (!file && !dto.formContent?.trim()) {
      throw new BadRequestException('Dokumen harus berupa file upload atau Generate Form yang terisi');
    }

    let fileUrl: string | null = null;
    if (file) fileUrl = await this.storage.uploadMulterFile(file, 'fttt-docs', id);

    return this.prisma.ftttDocument.create({
      data: {
        projectId:     id,
        docType:       dto.docType as FtttDocumentType,
        fileUrl,
        formContent:   dto.formContent ?? null,
        notes:         dto.notes ?? null,
        uploadedById:  userId,
        approvalStatus: 'PENDING_PM',
      },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
  }

  async approveDocument(docId: string, dto: ApproveDocumentDtoType, userId: string, userRole: Role) {
    const doc = await this.prisma.ftttDocument.findUniqueOrThrow({
      where: { id: docId },
      include: { project: { select: { id: true, projectName: true, pmId: true } } },
    });

    if (userRole === Role.PM_FTTT) {
      if (doc.approvalStatus !== 'PENDING_PM') {
        throw new BadRequestException('Dokumen tidak dalam status menunggu PM');
      }
      if (!dto.approved) {
        if (!dto.rejectionNotes?.trim()) {
          throw new BadRequestException('Alasan penolakan wajib diisi');
        }
        const updated = await this.prisma.ftttDocument.update({
          where: { id: docId },
          data: { approvalStatus: 'REJECTED', rejectionNotes: dto.rejectionNotes.trim() },
        });
        if (doc.uploadedById !== userId) {
          await this.notifications.createForUser(doc.uploadedById, {
            title:   'FTTT — Dokumen Ditolak',
            message: `Dokumen pada project ${(doc as any).project?.projectName ?? ''} ditolak. Silakan perbaiki dan upload ulang.`,
            type:    'FTTT_DOC_REJECTED',
            link:    `/fttt-projects/${(doc as any).project?.id}`,
            entityId: (doc as any).project?.id,
          });
        }
        return updated;
      }
      // PM approves → APPROVED directly (Admin Project is the uploader, PM is final reviewer)
      return this.prisma.ftttDocument.update({
        where: { id: docId },
        data: { approvalStatus: 'APPROVED', pmApprovedById: userId, pmApprovedAt: new Date(), rejectionNotes: null },
      });
    }

    if (userRole === Role.ADMIN || userRole === Role.GENERAL_MANAGER) {
      // Admin can still approve docs in PENDING_ADMIN state (legacy / iFORTE flow)
      if (doc.approvalStatus !== 'PENDING_ADMIN') {
        throw new BadRequestException('Dokumen tidak dalam status menunggu Admin');
      }
      if (!dto.approved && !dto.rejectionNotes?.trim()) {
        throw new BadRequestException('Alasan penolakan wajib diisi');
      }
      const updated = await this.prisma.ftttDocument.update({
        where: { id: docId },
        data: dto.approved
          ? { approvalStatus: 'APPROVED', adminApprovedById: userId, adminApprovedAt: new Date(), rejectionNotes: null }
          : { approvalStatus: 'REJECTED', rejectionNotes: dto.rejectionNotes!.trim() },
      });
      // C7-PST1: Notify PM of approval result
      const pmId = (doc as any).project?.pmId;
      if (pmId) {
        await this.notifications.createForUser(pmId, {
          title:   dto.approved ? 'FTTT — Dokumen Disetujui' : 'FTTT — Dokumen Ditolak',
          message: `Dokumen project ${(doc as any).project?.projectName ?? ''} telah ${dto.approved ? 'disetujui' : 'ditolak'} oleh Admin.`,
          type:    dto.approved ? 'FTTT_DOC_APPROVED' : 'FTTT_DOC_REJECTED',
          link:    `/fttt-projects/${(doc as any).project?.id}`,
          entityId: (doc as any).project?.id,
        });
      }
      return updated;
    }

    throw new ForbiddenException('Anda tidak berwenang menyetujui dokumen ini');
  }

  // ─── Replace a REJECTED document ─────────────────────────────────────────
  // Admin Project is the document owner — replaces rejected docs; PM FTTT is reviewer only
  async replaceDocument(
    docId: string,
    file: Express.Multer.File | undefined,
    userId: string,
    userRole: Role,
    notes?: string,
    formContent?: string,
  ) {
    const allowedRoles: Role[] = [Role.ADMIN, Role.GENERAL_MANAGER];
    if (!allowedRoles.includes(userRole)) {
      throw new ForbiddenException('Hanya Admin Project yang dapat mengganti dokumen yang ditolak. PM FTTT berperan sebagai reviewer saja.');
    }

    const doc = await this.prisma.ftttDocument.findUniqueOrThrow({ where: { id: docId } });

    // Can only replace REJECTED documents
    if (doc.approvalStatus !== 'REJECTED') {
      throw new BadRequestException('Hanya dokumen yang ditolak yang dapat diganti');
    }

    // Generate Form docs: formContent required; Upload docs: file required
    if (!file && !formContent?.trim()) {
      throw new BadRequestException('File atau isi form wajib diberikan untuk mengganti dokumen');
    }

    let fileUrl = doc.fileUrl;
    if (file) fileUrl = await this.storage.uploadMulterFile(file, 'fttt-docs', doc.projectId);

    return this.prisma.ftttDocument.update({
      where: { id: docId },
      data: {
        fileUrl,
        formContent:    formContent?.trim() ?? doc.formContent,
        notes:          notes ?? doc.notes,
        approvalStatus: 'PENDING_PM',   // reset to pending review
        uploadedById:   userId,
        pmApprovedById: null,
        pmApprovedAt:   null,
        adminApprovedById: null,
        adminApprovedAt:   null,
        updatedAt:      new Date(),
      },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
  }

  // ─── Implementation phase — add log entry (photo/doc/note) ──────────────
  async addImplementationLog(
    id: string,
    dto: AddImplLogDtoType,
    file: Express.Multer.File | undefined,
    userId: string,
    userRole: Role,
  ) {
    const project = await this.prisma.ftttProject.findUniqueOrThrow({ where: { id }, select: { ftttCompany: true } });
    // TI: Admin-only; PST/iFORTE: Surveyor, PM, Admin
    if (project.ftttCompany === FtttCompany.TELKOM_INFRA) {
      if (userRole !== Role.ADMIN && userRole !== Role.GENERAL_MANAGER) {
        throw new ForbiddenException('Hanya Admin Project yang dapat menambahkan log implementasi untuk project Telkom Infra');
      }
    } else {
      const allowedRoles: Role[] = [Role.SURVEYOR_FTTT, Role.PM_FTTT, Role.ADMIN, Role.GENERAL_MANAGER];
      if (!allowedRoles.includes(userRole)) {
        throw new ForbiddenException('Tidak memiliki akses untuk menambahkan log implementasi');
      }
    }

    // File required for PHOTO and MONITORING_DOC
    if ((dto.logType === FtttImplLogType.PHOTO || dto.logType === FtttImplLogType.MONITORING_DOC) && !file) {
      throw new BadRequestException('File wajib untuk tipe log ini');
    }

    let fileUrl: string | undefined;
    if (file) {
      fileUrl = await this.storage.uploadMulterFile(file, 'fttt-impl', id);
    }

    return this.prisma.ftttImplementationLog.create({
      data: {
        projectId:   id,
        uploadedById: userId,
        logType:     dto.logType,
        fileUrl:     fileUrl ?? null,
        caption:     dto.caption ?? null,
        notes:       dto.notes ?? null,
      },
      include: { uploadedBy: { select: { id: true, name: true, role: true } } },
    });
  }

  // ─── Live progress summary (for WebSocket / polling) ──────────────────────
  async getProgress(id: string) {
    const project = await this.prisma.ftttProject.findUnique({
      where: { id },
      include: { phaseProgresses: true },
    });
    if (!project) throw new NotFoundException();

    const [surveyCount, drmCount, sanggahCount, docCount] = await Promise.all([
      this.prisma.ftttSurveyUpload.count({ where: { projectId: id } }),
      this.prisma.ftttDrmDocument.count({ where: { projectId: id } }),
      this.prisma.ftttSanggah.count({ where: { projectId: id } }),
      this.prisma.ftttDocument.count({ where: { projectId: id } }),
    ]);

    const lifecycle = FTTT_PHASES_BY_COMPANY[project.ftttCompany as FtttCompany];
    const totalPhases = lifecycle.length;
    const completedPhases = project.phaseProgresses.filter(
      (p) => p.status === FtttPhaseStatus.COMPLETED,
    ).length;
    const progressPct = Math.round((completedPhases / totalPhases) * 100);

    return {
      projectId:      id,
      company:        project.ftttCompany,
      currentPhase:   project.currentPhase,
      status:         project.status,
      progressPct,
      completedPhases,
      totalPhases,
      phases:         project.phaseProgresses,
      counts: { surveyUploads: surveyCount, drmDocuments: drmCount, sanggahs: sanggahCount, documents: docCount },
    };
  }

  // ─── Span management (Telkom Infra Implementation phase) ─────────────────
  async createSpan(projectId: string, dto: AddSpanDtoType, userId: string, userRole: Role) {
    if (userRole !== Role.ADMIN && userRole !== Role.GENERAL_MANAGER) {
      throw new ForbiddenException('Hanya Admin yang dapat menambahkan Span');
    }
    const project = await this.prisma.ftttProject.findUniqueOrThrow({ where: { id: projectId } });
    // JLM: span-based log is for Telkom Infra, and for PST only when implementation type = Galian
    const spanAllowed =
      project.ftttCompany === FtttCompany.TELKOM_INFRA ||
      (project.ftttCompany === FtttCompany.PST && project.implementationType === 'GALIAN');
    if (!spanAllowed) {
      throw new BadRequestException('Span hanya tersedia untuk Telkom Infra atau PST jenis implementasi Galian');
    }
    return this.prisma.ftttSpan.create({
      data: { projectId, spanNumber: dto.spanNumber, createdById: userId },
      include: { spanLogs: { include: { uploadedBy: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' as const } }, createdBy: { select: { id: true, name: true } } },
    });
  }

  async deleteSpan(spanId: string, userId: string, userRole: Role) {
    if (userRole !== Role.ADMIN && userRole !== Role.GENERAL_MANAGER) {
      throw new ForbiddenException('Hanya Admin yang dapat menghapus Span');
    }
    return this.prisma.ftttSpan.delete({ where: { id: spanId } });
  }

  async addSpanLog(spanId: string, dto: AddSpanLogDtoType, file: Express.Multer.File, userId: string, userRole: Role) {
    if (userRole !== Role.ADMIN && userRole !== Role.GENERAL_MANAGER) {
      throw new ForbiddenException('Hanya Admin yang dapat mengunggah dokumentasi Span');
    }
    const span = await this.prisma.ftttSpan.findUniqueOrThrow({ where: { id: spanId } });
    const fileUrl = await this.storage.uploadMulterFile(file, 'fttt-span', span.projectId);
    return this.prisma.ftttSpanLog.create({
      data: { spanId, projectId: span.projectId, category: dto.category, fileUrl, caption: dto.caption ?? null, uploadedById: userId },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
  }

  async deleteSpanLog(logId: string, userId: string, userRole: Role) {
    if (userRole !== Role.ADMIN && userRole !== Role.GENERAL_MANAGER) {
      throw new ForbiddenException('Hanya Admin yang dapat menghapus log Span');
    }
    return this.prisma.ftttSpanLog.delete({ where: { id: logId } });
  }

  // ─── Private helpers ──────────────────────────────────────────────────────
  private fullInclude() {
    return {
      pm:             { select: { id: true, name: true, email: true } },
      cleanList:      { select: { id: true, rwCode: true, kelurahan: true } },
      phaseProgresses: { orderBy: { phase: 'asc' as const } },
      surveyUploads:  { include: { uploadedBy: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' as const } },
      drmDocuments:   { include: { uploadedBy: { select: { id: true, name: true } } }, orderBy: { version: 'asc' as const } },
      sanggahs:       { include: { submittedBy: { select: { id: true, name: true } } }, orderBy: { attemptNumber: 'asc' as const } },
      jaminans:           { include: { uploadedBy: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' as const } },
      documents:          { include: { uploadedBy: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' as const } },
      implementationLogs: { include: { uploadedBy: { select: { id: true, name: true, role: true } } }, orderBy: { createdAt: 'asc' as const } },
      reconDocs:          { include: { uploadedBy: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' as const } },
      closingLogs:        { include: { uploadedBy: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' as const } },
      spans:              {
        include: {
          createdBy: { select: { id: true, name: true } },
          spanLogs: { include: { uploadedBy: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' as const } },
        },
        orderBy: { createdAt: 'asc' as const },
      },
      // JLM: Finance link + implementation transaction log
      financeProject: { select: { id: true, code: true, name: true, projectType: true, totalBudget: true, budgetPerizinan: true, materialBudget: true, jasaBudget: true, budgetLainLain: true } },
      transactions:   { include: { createdBy: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' as const } },
    } as const;
  }

  // ─── JLM: Finance Project options for the FTTT "Nama Project" dropdown ────────
  async listFinanceOptions() {
    return this.prisma.financeProject.findMany({
      where: { projectType: 'FTTT', status: 'ACTIVE' },
      select: {
        id: true, code: true, name: true, totalBudget: true,
        budgetPerizinan: true, materialBudget: true, jasaBudget: true, budgetLainLain: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── JLM: Implementation Transaction Log (PM FTTT) ───────────────────────────
  async addTransaction(projectId: string, dto: AddFtttTransactionDtoType, userId: string, userRole: Role) {
    if (userRole !== Role.PM_FTTT && userRole !== Role.GENERAL_MANAGER) {
      throw new ForbiddenException('Hanya PM FTTT yang dapat mencatat Transaction Log');
    }
    const project = await this.prisma.ftttProject.findUniqueOrThrow({
      where: { id: projectId },
      select: { id: true, currentPhase: true, financeProjectId: true },
    });
    if (project.currentPhase !== FtttPhase.IMPLEMENTATION) {
      throw new BadRequestException('Transaction Log hanya dapat diisi pada fase Implementation');
    }
    const qty = Number(dto.qty);
    const price = Number(dto.price);
    const total = Math.round(qty * price * 100) / 100;
    return this.prisma.ftttTransaction.create({
      data: {
        ftttProjectId:    projectId,
        financeProjectId: project.financeProjectId ?? null,
        category:         dto.category,
        aktivitas:        dto.aktivitas.trim(),
        uom:              dto.uom?.trim() || null,
        qty:              qty.toString(),
        price:            price.toString(),
        total:            total.toString(),
        remarks:          dto.remarks.trim(),
        createdById:      userId,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });
  }

  async deleteTransaction(txId: string, userId: string, userRole: Role) {
    const tx = await this.prisma.ftttTransaction.findUniqueOrThrow({ where: { id: txId } });
    if (userRole !== Role.PM_FTTT && userRole !== Role.GENERAL_MANAGER && userRole !== Role.ADMIN) {
      throw new ForbiddenException('Tidak berwenang menghapus transaksi');
    }
    return this.prisma.ftttTransaction.delete({ where: { id: txId } });
  }

  // ─── JLM: Budget summary + Cost/Progress S-Curve for a linked FTTT project ───
  async getBudgetScurve(projectId: string) {
    const project = await this.prisma.ftttProject.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        financeProject: { select: { id: true, code: true, name: true, totalBudget: true, budgetPerizinan: true, materialBudget: true, jasaBudget: true, budgetLainLain: true } },
        transactions: { orderBy: { createdAt: 'asc' }, include: { createdBy: { select: { id: true, name: true } } } },
        phaseProgresses: true,
      },
    });

    const num = (v: unknown) => (v == null ? 0 : Number(v));
    const fp = project.financeProject;
    const budgets = {
      PERIZINAN: num(fp?.budgetPerizinan),
      MATERIAL:  num(fp?.materialBudget),
      JASA:      num(fp?.jasaBudget),
      LAIN_LAIN: num(fp?.budgetLainLain),
    };
    const totalBudget = num(fp?.totalBudget) || (budgets.PERIZINAN + budgets.MATERIAL + budgets.JASA + budgets.LAIN_LAIN);

    // Spent per category (from transactions)
    const spent = { PERIZINAN: 0, MATERIAL: 0, JASA: 0, LAIN_LAIN: 0 } as Record<string, number>;
    for (const t of project.transactions) spent[t.category] += num(t.total);
    const totalSpent = spent.PERIZINAN + spent.MATERIAL + spent.JASA + spent.LAIN_LAIN;

    // Cost S-Curve — monthly cumulative actual vs linear planned across project timeline
    const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}`;
    const actualByMonth = new Map<string, number>();
    for (const t of project.transactions) {
      const k = monthKey(new Date(t.createdAt));
      actualByMonth.set(k, (actualByMonth.get(k) ?? 0) + num(t.total));
    }
    // timeline: project createdAt → endDate (or last transaction / +6 months)
    const start = new Date(project.createdAt);
    const end = (project as any).maintenanceEndDate ? new Date((project as any).maintenanceEndDate) : null;
    const lastTx = project.transactions.length ? new Date(project.transactions[project.transactions.length - 1].createdAt) : null;
    const horizon = end ?? lastTx ?? new Date(start.getFullYear(), start.getMonth() + 5, 1);
    const months: { name: string; year: number; month: number }[] = [];
    const cur = new Date(start.getFullYear(), start.getMonth(), 1);
    const stop = new Date(horizon.getFullYear(), horizon.getMonth(), 1);
    while (cur <= stop && months.length < 60) {
      months.push({ name: `${cur.getMonth() + 1}/${cur.getFullYear()}`, year: cur.getFullYear(), month: cur.getMonth() + 1 });
      cur.setMonth(cur.getMonth() + 1);
    }
    const nMonths = Math.max(1, months.length);
    const plannedPerMonth = totalBudget / nMonths;
    let cumPlan = 0;
    let cumActual = 0;
    const costCurve = months.map((m, i) => {
      cumPlan += plannedPerMonth;
      cumActual += actualByMonth.get(`${m.year}-${m.month}`) ?? 0;
      return {
        name: m.name,
        plannedCost: Math.round(cumPlan),
        actualCost: Math.round(cumActual),
        // only draw actual line up to the current month
        hasActual: i < months.findIndex((mm) => mm.year === new Date().getFullYear() && mm.month === new Date().getMonth() + 1) + 1 || actualByMonth.has(`${m.year}-${m.month}`),
      };
    });

    // Progress S-Curve — planned linear over lifecycle phases vs actual completed phases
    const phases = project.phaseProgresses.filter((p) => p.status !== 'SKIPPED');
    const totalPhases = Math.max(1, phases.length);
    const completed = phases.filter((p) => p.status === 'COMPLETED').length;
    const progressCurve = months.map((m, i) => ({
      name: m.name,
      plannedProgress: Math.min(100, Math.round(((i + 1) / nMonths) * 100)),
      actualProgress: Math.round((completed / totalPhases) * 100),
    }));

    return {
      financeProject: fp,
      ftttProject: { id: project.id, name: project.projectName, currentPhase: project.currentPhase },
      totalBudget,
      totalSpent,
      remaining: totalBudget - totalSpent,
      byCategory: (['PERIZINAN', 'MATERIAL', 'JASA', 'LAIN_LAIN'] as const).map((c) => ({
        category: c, budget: budgets[c], spent: spent[c], remaining: budgets[c] - spent[c],
      })),
      costCurve,
      progressCurve,
      transactions: project.transactions.map((t) => ({
        id: t.id, category: t.category, aktivitas: t.aktivitas, uom: t.uom,
        qty: t.qty, price: t.price, total: t.total, remarks: t.remarks,
        createdAt: t.createdAt, createdBy: (t as typeof t & { createdBy?: { name: string } }).createdBy ?? null,
      })),
    };
  }

  // JLM: Finance-side FTTT monitoring — resolve the linked FTTT project from a finance project id
  async getMonitoringByFinance(financeProjectId: string) {
    const ftttProject = await this.prisma.ftttProject.findFirst({
      where: { financeProjectId },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!ftttProject) return { linked: false as const };
    const data = await this.getBudgetScurve(ftttProject.id);
    return { linked: true as const, ...data };
  }

  // ─── Reconciliation & Billing / Closing — upload/replace doc ────────────
  async upsertReconDoc(
    projectId: string,
    dto: AddReconDocDtoType,
    file: Express.Multer.File | undefined,
    userId: string,
    userRole: Role,
  ) {
    // Finance-only docs (auto-approved, no PM review needed)
    const FINANCE_ONLY_DOCS = new Set([
      'JAMINAN_PEMELIHARAAN', 'INVOICE_FINAL',           // TI Closing
      'INVOICE_PST_CLOSING', 'JAMINAN_PEMELIHARAAN_PST', // PST Closing
      'JAMINAN_PELAKSANAAN_PST',                         // PST Closing
    ]);
    // PST Procurement PO — Finance only
    const isPoProcurement = dto.docKey === 'PO_PROCUREMENT';
    if (FINANCE_ONLY_DOCS.has(dto.docKey) || isPoProcurement) {
      if (userRole !== Role.FINANCE && userRole !== Role.GENERAL_MANAGER) {
        throw new ForbiddenException('Hanya Finance yang dapat mengunggah dokumen ini');
      }
    } else {
      // All other recon docs: Admin/GM (TI, PST), or Surveyor for iFORTE
      const allowed: Role[] = [Role.ADMIN, Role.GENERAL_MANAGER, Role.FINANCE, Role.SURVEYOR_FTTT];
      if (!allowed.includes(userRole)) {
        throw new ForbiddenException('Tidak memiliki akses untuk mengunggah dokumen rekonsiliasi');
      }
    }

    // JLM: maintenance end date is captured by Finance with the Jaminan Pemeliharaan upload
    const JAMINAN_PEMELIHARAAN_KEYS = new Set(['JAMINAN_PEMELIHARAAN', 'JAMINAN_PEMELIHARAAN_PST']);
    let maintenanceEndDate: Date | null = null;
    if (JAMINAN_PEMELIHARAAN_KEYS.has(dto.docKey)) {
      if (dto.maintenanceEndDate) {
        const d = new Date(dto.maintenanceEndDate);
        if (isNaN(d.getTime())) throw new BadRequestException('Tanggal berakhir masa pemeliharaan tidak valid');
        maintenanceEndDate = d;
      }
      const proj = await this.prisma.ftttProject.findUniqueOrThrow({
        where: { id: projectId },
        select: { maintenanceEndDate: true },
      });
      if (!maintenanceEndDate && !proj.maintenanceEndDate) {
        throw new BadRequestException('Tanggal Berakhir Masa Pemeliharaan wajib diisi');
      }
    }

    const existing = await this.prisma.ftttReconDoc.findUnique({
      where: { projectId_docKey: { projectId, docKey: dto.docKey } },
    });

    if (maintenanceEndDate) {
      await this.prisma.ftttProject.update({
        where: { id: projectId },
        data: { maintenanceEndDate, lastMaintReminderAt: null },
      });
    }

    let fileUrl = existing?.fileUrl ?? undefined;
    if (file) {
      fileUrl = await this.storage.uploadMulterFile(file, 'fttt-recon', projectId);
    }

    // Either file or formContent required
    if (!file && !dto.formContent?.trim()) {
      throw new BadRequestException('Dokumen harus berupa file upload atau Generate Form yang terisi');
    }

    // Determine initial approval status: auto-approve Finance docs, PM reviews all others
    const resolveStatus = (docKey: string) => {
      if (RECON_NO_APPROVAL.has(docKey)) return 'APPROVED';
      return 'PENDING_PM';
    };
    const initialStatus = resolveStatus(dto.docKey);

    if (existing) {
      return this.prisma.ftttReconDoc.update({
        where: { id: existing.id },
        data: {
          fileUrl:        fileUrl ?? null,
          formContent:    dto.formContent ?? null,
          notes:          dto.notes ?? null,
          uploadedById:   userId,
          approvalStatus: resolveStatus(dto.docKey),
          rejectionNotes: null,
          pmApprovedById: null, pmApprovedAt: null,
          adminApprovedById: null, adminApprovedAt: null,
        },
        include: { uploadedBy: { select: { id: true, name: true } } },
      });
    }

    return this.prisma.ftttReconDoc.create({
      data: {
        projectId,
        docKey:         dto.docKey,
        fileUrl:        fileUrl ?? null,
        formContent:    dto.formContent ?? null,
        notes:          dto.notes ?? null,
        uploadedById:   userId,
        approvalStatus: initialStatus,
      },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
  }

  async approveReconDoc(docId: string, approved: boolean, rejectionNotes: string | undefined, userId: string, userRole: Role) {
    const doc = await this.prisma.ftttReconDoc.findUniqueOrThrow({ where: { id: docId } });

    if (!approved && !rejectionNotes?.trim()) {
      throw new BadRequestException('Alasan penolakan wajib diisi');
    }

    if (userRole === Role.PM_FTTT) {
      if (doc.approvalStatus !== 'PENDING_PM') throw new BadRequestException('Dokumen tidak dalam status menunggu PM');
      // PM approves → APPROVED directly (Admin is uploader, PM is final reviewer)
      return this.prisma.ftttReconDoc.update({
        where: { id: docId },
        data: approved
          ? { approvalStatus: 'APPROVED', pmApprovedById: userId, pmApprovedAt: new Date(), rejectionNotes: null }
          : { approvalStatus: 'REJECTED', rejectionNotes: rejectionNotes!.trim() },
      });
    }

    if (userRole === Role.ADMIN || userRole === Role.GENERAL_MANAGER) {
      // Admin can approve PENDING_ADMIN docs (iFORTE legacy flow or override)
      if (doc.approvalStatus !== 'PENDING_ADMIN') throw new BadRequestException('Dokumen tidak dalam status menunggu Admin');
      return this.prisma.ftttReconDoc.update({
        where: { id: docId },
        data: approved
          ? { approvalStatus: 'APPROVED', adminApprovedById: userId, adminApprovedAt: new Date(), rejectionNotes: null }
          : { approvalStatus: 'REJECTED', rejectionNotes: rejectionNotes!.trim() },
      });
    }

    throw new ForbiddenException('Tidak berwenang menyetujui dokumen ini');
  }

  // ─── Project Closing phase ─────────────────────────────────────────────────
  async addClosingLog(
    projectId: string,
    dto: AddClosingLogDtoType,
    file: Express.Multer.File | undefined,
    userId: string,
    userRole: Role,
  ) {
    // C6-TI3: Only Admin can manage Project Closing activities
    const allowed: Role[] = [Role.ADMIN, Role.GENERAL_MANAGER];
    if (!allowed.includes(userRole)) {
      throw new ForbiddenException('Hanya Admin yang dapat mengelola dokumen fase Project Closing');
    }

    // EVIDENCE requires a file; BAST_II requires file OR formContent; NOTE requires notes
    if (dto.logType === FtttClosingLogType.EVIDENCE && !file) {
      throw new BadRequestException('File foto wajib untuk Evidence');
    }
    // C5-Issue1: BAST II is now Upload File only (Generate Form removed)
    if (dto.logType === FtttClosingLogType.BAST_II && !file) {
      throw new BadRequestException('File BAST II wajib diunggah');
    }

    // Only one BAST_II allowed per project
    if (dto.logType === FtttClosingLogType.BAST_II) {
      const existing = await this.prisma.ftttClosingLog.findFirst({
        where: { projectId, logType: 'BAST_II' },
      });
      if (existing) {
        // Replace existing BAST_II — resets approval
        let fileUrl = existing.fileUrl;
        if (file) fileUrl = await this.storage.uploadMulterFile(file, 'fttt-closing', projectId);
        return this.prisma.ftttClosingLog.update({
          where: { id: existing.id },
          data: { fileUrl, formContent: dto.formContent ?? null,
            notes: dto.notes ?? null, caption: dto.caption ?? null,
            uploadedById: userId, approvalStatus: 'PENDING_PM',
            pmApprovedById: null, pmApprovedAt: null, rejectionNotes: null },
          include: { uploadedBy: { select: { id: true, name: true } } },
        });
      }
    }

    let fileUrl: string | undefined;
    if (file) fileUrl = await this.storage.uploadMulterFile(file, 'fttt-closing', projectId);

    return this.prisma.ftttClosingLog.create({
      data: {
        projectId,
        logType:      dto.logType,
        fileUrl:      fileUrl ?? null,
        formContent:  dto.formContent ?? null,
        caption:      dto.caption ?? null,
        notes:        dto.notes ?? null,
        uploadedById: userId,
        approvalStatus: dto.logType === FtttClosingLogType.BAST_II ? 'PENDING_PM' : null,
      },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
  }

  // ─── C5-Issue5: Delete survey upload ─────────────────────────────────────
  async deleteSurveyUpload(projectId: string, uploadId: string, userId: string, userRole: Role) {
    const upload = await this.prisma.ftttSurveyUpload.findUniqueOrThrow({ where: { id: uploadId } });
    if (upload.projectId !== projectId) {
      throw new BadRequestException('Upload tidak ditemukan di project ini');
    }
    // Surveyor can delete their own uploads; Admin/GM can delete any
    const canDelete =
      (userRole === Role.ADMIN || userRole === Role.GENERAL_MANAGER) ||
      (userRole === Role.SURVEYOR_FTTT && upload.uploadedById === userId);
    if (!canDelete) {
      throw new ForbiddenException('Anda tidak dapat menghapus upload ini');
    }
    return this.prisma.ftttSurveyUpload.delete({ where: { id: uploadId } });
  }

  async approveClosingLog(logId: string, approved: boolean, rejectionNotes: string | undefined, userId: string, userRole: Role) {
    const log = await this.prisma.ftttClosingLog.findUniqueOrThrow({ where: { id: logId } });
    if (log.logType !== 'BAST_II') throw new BadRequestException('Hanya dokumen BAST II yang memerlukan approval');
    if (log.approvalStatus !== 'PENDING_PM') throw new BadRequestException('Dokumen tidak dalam status menunggu PM');

    if (!approved && !rejectionNotes?.trim()) {
      throw new BadRequestException('Alasan penolakan wajib diisi');
    }

    if (userRole !== Role.PM_FTTT && userRole !== Role.ADMIN && userRole !== Role.GENERAL_MANAGER) {
      throw new ForbiddenException('Hanya PM FTTT atau Admin yang dapat menyetujui BAST II');
    }

    return this.prisma.ftttClosingLog.update({
      where: { id: logId },
      data: approved
        ? { approvalStatus: 'APPROVED', pmApprovedById: userId, pmApprovedAt: new Date(), rejectionNotes: null }
        : { approvalStatus: 'REJECTED', rejectionNotes: rejectionNotes!.trim() },
    });
  }

  // ─── JLM: Admin confirms maintenance period complete (Project Closing) ─────
  async confirmMaintenance(id: string, userId: string, userRole: Role) {
    if (userRole !== Role.ADMIN && userRole !== Role.GENERAL_MANAGER) {
      throw new ForbiddenException('Hanya Admin Project yang dapat mengkonfirmasi penyelesaian masa pemeliharaan');
    }
    const project = await this.prisma.ftttProject.findUniqueOrThrow({ where: { id } });
    if (project.currentPhase !== FtttPhase.CLOSING) {
      throw new BadRequestException('Konfirmasi hanya dapat dilakukan pada fase Project Closing');
    }
    return this.prisma.ftttProject.update({
      where: { id },
      data: { maintenanceConfirmedAt: new Date(), maintenanceConfirmedById: userId },
      include: this.fullInclude(),
    });
  }

  // ─── JLM: PST — choose Implementation type (Galian → span-based; KU → existing) ──
  async setImplementationType(id: string, type: 'GALIAN' | 'KU', userId: string, userRole: Role) {
    if (userRole !== Role.ADMIN && userRole !== Role.GENERAL_MANAGER) {
      throw new ForbiddenException('Hanya Admin Project yang dapat menentukan jenis implementasi');
    }
    const project = await this.prisma.ftttProject.findUniqueOrThrow({ where: { id } });
    if (project.ftttCompany !== FtttCompany.PST) {
      throw new BadRequestException('Jenis implementasi hanya berlaku untuk project PST');
    }
    if (project.currentPhase !== FtttPhase.IMPLEMENTATION) {
      throw new BadRequestException('Jenis implementasi hanya dapat dipilih pada fase Implementation');
    }
    return this.prisma.ftttProject.update({
      where: { id },
      data: { implementationType: type },
      include: this.fullInclude(),
    });
  }

  // ─── JLM: maintenance reminder — fired on access, deduped to once per day ──
  private async maybeSendMaintenanceReminder(project: {
    id: string; projectName: string | null; currentPhase: FtttPhase; ftttCompany: FtttCompany;
    maintenanceEndDate: Date | null; maintenanceConfirmedAt: Date | null; lastMaintReminderAt: Date | null;
  }) {
    if (project.currentPhase !== FtttPhase.CLOSING) return;
    if (project.ftttCompany !== FtttCompany.TELKOM_INFRA && project.ftttCompany !== FtttCompany.PST) return;
    if (!project.maintenanceEndDate || project.maintenanceConfirmedAt) return;

    const now = new Date();
    const end = new Date(project.maintenanceEndDate);
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysLeft = Math.ceil((end.getTime() - now.getTime()) / msPerDay);
    // Reminder window: from 3 days before the end date onward
    if (daysLeft > 3) return;

    // Dedup: at most one reminder per calendar day
    if (project.lastMaintReminderAt) {
      const last = new Date(project.lastMaintReminderAt);
      if (last.toDateString() === now.toDateString()) return;
    }

    const pName = project.projectName ?? project.id.slice(-6).toUpperCase();
    const message =
      daysLeft > 0
        ? 'Masa pemeliharaan project akan segera berakhir. Silakan lakukan konfirmasi penyelesaian masa pemeliharaan untuk melanjutkan proses Project Closing.'
        : 'Masa pemeliharaan project telah berakhir. Silakan lakukan konfirmasi penyelesaian masa pemeliharaan untuk melanjutkan proses Project Closing.';
    try {
      await this.notifications.notifyUsersByRole(Role.ADMIN, {
        title:    `FTTT — Pengingat Masa Pemeliharaan (${pName})`,
        message,
        type:     'FTTT_MAINTENANCE_REMINDER',
        link:     `/fttt-projects/${project.id}`,
        entityId: project.id,
      });
      await this.prisma.ftttProject.update({
        where: { id: project.id },
        data: { lastMaintReminderAt: now },
      });
    } catch {
      /* reminder is best-effort — never block project access */
    }
  }
}
