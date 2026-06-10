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
// docKeys that do NOT need PM/Admin approval — set to APPROVED on upload
const RECON_NO_APPROVAL = new Set([
  // Telkom Infra Recon — docs from Telkom Infra, auto-approved on upload
  'BAST_1_TI', 'BAPWPP_TI', 'SURAT_WASPANG', 'PO_TI', 'AMANDEMEN_1_TI', 'AMANDEMEN_2_TI',
  // Telkom Infra Closing — Finance uploads, auto-approved
  'JAMINAN_PEMELIHARAAN', 'INVOICE_FINAL',
  // PST
  'BAST_1', 'GOOD_RECEIPT_PST', 'INVOICE_PST',
  // iFORTE
  'PUNCHLIST', 'PO_FINAL', 'PSS', 'MCV', 'INVOICE_IFORTE',
]);

// Required docs per company for RECONCILIATION phase readiness
// Tuple: [docKey, needsApproval (true = must be APPROVED, false = just must exist)]
const RECON_REQUIRED: Record<string, Array<[string, boolean, string]>> = {
  TELKOM_INFRA: [
    // Docs requiring PM/Admin approval
    ['RISALAH_RAPAT_MOM',  true,  'Risalah Rapat/MOM (perlu disetujui)'],
    ['BOQ_PERHITUNGAN',    true,  'BOQ Perhitungan (perlu disetujui)'],
    ['BA_PENUTUPAN',       true,  'BA Penutupan (perlu disetujui)'],
    ['BAPP_TI',            true,  'BAPP (perlu disetujui)'],
    // Docs from Telkom Infra — auto-approved on upload (just must exist)
    ['BAST_1_TI',          false, 'BAST 1'],
    ['BAPWPP_TI',          false, 'BAPWPP'],
    ['SURAT_WASPANG',      false, 'Surat Waspang'],
    ['PO_TI',              false, 'PO'],
    ['AMANDEMEN_1_TI',     false, 'Amandemen 1'],
    ['AMANDEMEN_2_TI',     false, 'Amandemen 2'],
    // NOTE: Jaminan Pemeliharaan & Invoice Final moved to CLOSING phase
  ],
  PST: [
    ['REKONSILIASI',      true,  'Rekonsiliasi (perlu disetujui)'],
    ['BAST_1',            false, 'BAST 1'],
    ['GOOD_RECEIPT_PST',  false, 'Good Receipt'],
    ['INVOICE_PST',       false, 'Invoice'],
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
  AddImplLogDtoType,
  AddJaminanDtoType,
  AddReconDocDtoType,
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
        projectName:    dto.projectName ?? null,
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

    return project;
  }

  // ─── Phase gate check: can the current phase be completed? ───────────────
  async checkPhaseReadiness(id: string): Promise<{ ready: boolean; blockedReasons: string[] }> {
    const project = await this.prisma.ftttProject.findUnique({
      where: { id },
      include: {
        surveyUploads: true,
        drmDocuments:  true,
        jaminans:      true,
        documents:     { where: { approvalStatus: 'APPROVED' } },
        reconDocs:     true,   // needed for RECONCILIATION phase check
        closingLogs:   true,   // needed for CLOSING phase check
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

    // C6-PST5: PROCUREMENT phase readiness — PM must have uploaded PO
    if (phase === FtttPhase.PROCUREMENT) {
      const reconDocMap = new Map(
        (project as typeof project & { reconDocs: { docKey: string }[] })
          .reconDocs.map((d) => [d.docKey, true]),
      );
      if (!reconDocMap.has('PO_PROCUREMENT')) {
        reasons.push('Dokumen Purchase Order (PO) belum diunggah oleh PM FTTT');
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
        if (!hasBoq) reasons.push('Dokumen BOQ awal belum diunggah');
      }
    }

    if (phase === FtttPhase.DOCUMENTATION) {
      // Per-lifecycle required document types for Documentation & Acceptance phase
      const DOC_REQUIRED: Record<string, Array<[string, string]>> = {
        TELKOM_INFRA: [
          ['KONTRAK',             'Kontrak'],
          ['PO',                  'PO'],
          ['AMANDEMEN_1',         'Amandemen 1'],
          ['DOK_PERUBAHAN_WAKTU', 'Dokumen Perubahan Waktu (NPWP)'],
          ['BAUT_REKONSILIASI',   'BA Rekonsiliasi'],
          ['BAUT',                'BAUT'],
        ],
        PST:   [['ATP', 'ATP'], ['BAUT', 'BAUT']],
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

    // CLOSING phase readiness — BAST II must be approved + evidence/note
    if (phase === FtttPhase.CLOSING) {
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

      // C5-Issue3: Telkom Infra closing also requires Jaminan Pemeliharaan + Invoice Final
      if (company === FtttCompany.TELKOM_INFRA) {
        const reconDocMap = new Map(
          (project as typeof project & { reconDocs: { docKey: string }[] })
            .reconDocs.map((d) => [d.docKey, true]),
        );
        if (!reconDocMap.has('JAMINAN_PEMELIHARAAN')) {
          reasons.push('Jaminan Pemeliharaan belum diunggah pada fase Closing');
        }
        if (!reconDocMap.has('INVOICE_FINAL')) {
          reasons.push('Invoice Final belum diunggah pada fase Closing');
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

  // ─── C6-PST4: Surveyor marks Implementation lapangan done ────────────────
  async markImplementationLapanganDone(id: string, userId: string, userRole: Role) {
    if (userRole !== Role.SURVEYOR_FTTT) {
      throw new ForbiddenException('Hanya Surveyor FTTT yang dapat menandai pekerjaan lapangan selesai');
    }
    const project = await this.prisma.ftttProject.findUniqueOrThrow({ where: { id } });
    if (project.currentPhase !== FtttPhase.IMPLEMENTATION) {
      throw new BadRequestException('Project tidak dalam fase Implementation');
    }
    await this.prisma.ftttPhaseProgress.update({
      where: { projectId_phase: { projectId: id, phase: FtttPhase.IMPLEMENTATION } },
      data: { notes: 'SURVEYOR_DONE' },
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
        // Unlock next phase
        await tx.ftttPhaseProgress.update({
          where: { projectId_phase: { projectId: id, phase: nextPhase } },
          data: { status: FtttPhaseStatus.ACTIVE, unlockedAt: new Date() },
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

    // Notify Finance when Telkom Infra project enters PREPARATION phase
    // — Finance must upload Jaminan Uang Muka & Jaminan Pelaksanaan
    if (
      project.currentPhase === FtttPhase.INITIATION &&
      updated.currentPhase === FtttPhase.PREPARATION &&
      project.ftttCompany === FtttCompany.TELKOM_INFRA
    ) {
      await this.notifications.notifyUsersByRole(Role.FINANCE, {
        title:    'FTTT Project — Upload Dokumen Jaminan Diperlukan',
        message:  `Project ${updated.projectName ?? updated.id} (Telkom Infra) telah memasuki fase Project Preparation. Silakan upload dokumen Jaminan Uang Muka dan Jaminan Pelaksanaan.`,
        type:     'FTTT_JAMINAN_REQUIRED',
        link:     `/fttt-projects/${id}`,
        entityId: id,
      });
    }

    return updated;
  }

  // ─── Upload survey evidence (iForte / PST only) ───────────────────────────
  async uploadSurveyEvidence(
    id: string,
    file: Express.Multer.File | undefined,
    dto: UploadSurveyDtoType,
    userId: string,
  ) {
    if (!file) throw new BadRequestException('File foto / dokumen survei wajib diunggah');
    const project = await this.prisma.ftttProject.findUniqueOrThrow({ where: { id } });
    if (project.ftttCompany === FtttCompany.TELKOM_INFRA) {
      throw new BadRequestException('Telkom Infra tidak memerlukan survei');
    }
    const fileUrl = await this.storage.uploadMulterFile(file, 'fttt-survey', id);
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
  async uploadDocument(
    id: string,
    file: Express.Multer.File | undefined,
    dto: UploadDocumentDtoType,
    userId: string,
    userRole: Role,
  ) {
    // C6-TI2: PM FTTT (not Surveyor) owns Documentation & Acceptance document upload
    const docUploaderRoles: Role[] = [Role.PM_FTTT, Role.ADMIN, Role.GENERAL_MANAGER];
    if (!docUploaderRoles.includes(userRole)) {
      throw new ForbiddenException('Hanya PM FTTT yang dapat mengunggah dokumen pada fase Documentation and Acceptance');
    }

    // Either a file or formContent must be provided
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
    const doc = await this.prisma.ftttDocument.findUniqueOrThrow({ where: { id: docId } });

    if (userRole === Role.PM_FTTT) {
      if (doc.approvalStatus !== 'PENDING_PM') {
        throw new BadRequestException('Dokumen tidak dalam status menunggu PM');
      }
      // Issue #2: rejection reason is mandatory
      if (!dto.approved) {
        if (!dto.rejectionNotes?.trim()) {
          throw new BadRequestException('Alasan penolakan wajib diisi');
        }
        return this.prisma.ftttDocument.update({
          where: { id: docId },
          data: { approvalStatus: 'REJECTED', rejectionNotes: dto.rejectionNotes.trim() },
        });
      }
      return this.prisma.ftttDocument.update({
        where: { id: docId },
        data: { approvalStatus: 'PENDING_ADMIN', pmApprovedById: userId, pmApprovedAt: new Date(), rejectionNotes: null },
      });
    }

    if (userRole === Role.ADMIN) {
      if (doc.approvalStatus !== 'PENDING_ADMIN') {
        throw new BadRequestException('Dokumen tidak dalam status menunggu Admin');
      }
      // Issue #2: rejection reason is mandatory for Admin too
      if (!dto.approved && !dto.rejectionNotes?.trim()) {
        throw new BadRequestException('Alasan penolakan wajib diisi');
      }
      return this.prisma.ftttDocument.update({
        where: { id: docId },
        data: dto.approved
          ? { approvalStatus: 'APPROVED', adminApprovedById: userId, adminApprovedAt: new Date(), rejectionNotes: null }
          : { approvalStatus: 'REJECTED', rejectionNotes: dto.rejectionNotes!.trim() },
      });
    }

    throw new ForbiddenException('Anda tidak berwenang menyetujui dokumen ini');
  }

  // ─── Issue #6: Surveyor replaces a REJECTED document ─────────────────────
  async replaceDocument(
    docId: string,
    file: Express.Multer.File | undefined,
    userId: string,
    userRole: Role,
    notes?: string,
    formContent?: string,
  ) {
    // C6-TI2: PM FTTT can replace rejected docs (was Surveyor — ownership transferred)
    const allowedRoles: Role[] = [Role.PM_FTTT, Role.ADMIN, Role.GENERAL_MANAGER];
    if (!allowedRoles.includes(userRole)) {
      throw new ForbiddenException('Hanya PM FTTT yang dapat mengganti dokumen yang ditolak');
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

  // ─── Issue #4: Implementation phase — add log entry (photo/doc/note) ──────
  async addImplementationLog(
    id: string,
    dto: AddImplLogDtoType,
    file: Express.Multer.File | undefined,
    userId: string,
    userRole: Role,
  ) {
    // Surveyor FTTT, PM FTTT (as observer), Admin can add logs
    const allowedRoles: Role[] = [Role.SURVEYOR_FTTT, Role.PM_FTTT, Role.ADMIN, Role.GENERAL_MANAGER];
    if (!allowedRoles.includes(userRole)) {
      throw new ForbiddenException('Tidak memiliki akses untuk menambahkan log implementasi');
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
      include: { uploadedBy: { select: { id: true, name: true } } },
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
      implementationLogs: { include: { uploadedBy: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' as const } },
      reconDocs:          { include: { uploadedBy: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' as const } },
      closingLogs:        { include: { uploadedBy: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' as const } },
    } as const;
  }

  // ─── Issue #4: Reconciliation & Billing — upload/replace doc ─────────────
  async upsertReconDoc(
    projectId: string,
    dto: AddReconDocDtoType,
    file: Express.Multer.File | undefined,
    userId: string,
    userRole: Role,
  ) {
    // C6-TI2: PM FTTT (not Surveyor) owns Reconciliation document upload
    const allowed: Role[] = [Role.PM_FTTT, Role.ADMIN, Role.GENERAL_MANAGER, Role.FINANCE];
    if (!allowed.includes(userRole)) {
      throw new ForbiddenException('Tidak memiliki akses untuk mengunggah dokumen rekonsiliasi');
    }

    const existing = await this.prisma.ftttReconDoc.findUnique({
      where: { projectId_docKey: { projectId, docKey: dto.docKey } },
    });

    let fileUrl = existing?.fileUrl ?? undefined;
    if (file) {
      fileUrl = await this.storage.uploadMulterFile(file, 'fttt-recon', projectId);
    }

    // Either file or formContent required
    if (!file && !dto.formContent?.trim()) {
      throw new BadRequestException('Dokumen harus berupa file upload atau Generate Form yang terisi');
    }

    // Fix #1: docs in RECON_NO_APPROVAL list don't go through PM review — set APPROVED directly
    const initialStatus = RECON_NO_APPROVAL.has(dto.docKey) ? 'APPROVED' : 'PENDING_PM';

    if (existing) {
      return this.prisma.ftttReconDoc.update({
        where: { id: existing.id },
        data: {
          fileUrl:        fileUrl ?? null,
          formContent:    dto.formContent ?? null,
          notes:          dto.notes ?? null,
          uploadedById:   userId,
          approvalStatus: RECON_NO_APPROVAL.has(dto.docKey) ? 'APPROVED' : 'PENDING_PM',
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
      return this.prisma.ftttReconDoc.update({
        where: { id: docId },
        data: approved
          ? { approvalStatus: 'PENDING_ADMIN', pmApprovedById: userId, pmApprovedAt: new Date(), rejectionNotes: null }
          : { approvalStatus: 'REJECTED', rejectionNotes: rejectionNotes!.trim() },
      });
    }

    if (userRole === Role.ADMIN || userRole === Role.GENERAL_MANAGER) {
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
}
