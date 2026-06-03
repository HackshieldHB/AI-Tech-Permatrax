import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FtttCompany,
  FtttDocumentType,
  FtttPhase,
  FtttPhaseStatus,
  FtttProjectStatus,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { paginate } from '../common/dto/pagination.dto';
import {
  AddJaminanDtoType,
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

  // ─── Create project (PM uploads trigger doc + selects company) ────────────
  async create(dto: CreateFtttProjectDtoType, triggerDocFile: Express.Multer.File, pmId: string) {
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
      if (project.documents.length === 0) {
        reasons.push('Minimal satu dokumen (ATP/BAUT) harus sudah disetujui');
      }
    }

    return { ready: reasons.length === 0, blockedReasons: reasons };
  }

  // ─── Advance to next phase ────────────────────────────────────────────────
  async advancePhase(id: string, dto: AdvancePhaseDtoType, userId: string) {
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
    file: Express.Multer.File,
    dto: UploadSurveyDtoType,
    userId: string,
  ) {
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

    const project = await this.prisma.ftttProject.findUniqueOrThrow({ where: { id } });
    if (project.ftttCompany !== FtttCompany.TELKOM_INFRA) {
      throw new BadRequestException('Jaminan hanya tersedia untuk project Telkom Infra');
    }

    let fileUrl: string | undefined;
    if (file) {
      fileUrl = await this.storage.uploadMulterFile(file, 'fttt-jaminan', id);
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
    file: Express.Multer.File,
    dto: UploadDocumentDtoType,
    userId: string,
  ) {
    const fileUrl = await this.storage.uploadMulterFile(file, 'fttt-docs', id);
    return this.prisma.ftttDocument.create({
      data: {
        projectId:     id,
        docType:       dto.docType as FtttDocumentType,
        fileUrl,
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
      if (!dto.approved) {
        return this.prisma.ftttDocument.update({
          where: { id: docId },
          data: { approvalStatus: 'REJECTED' },
        });
      }
      return this.prisma.ftttDocument.update({
        where: { id: docId },
        data: { approvalStatus: 'PENDING_ADMIN', pmApprovedById: userId, pmApprovedAt: new Date() },
      });
    }

    if (userRole === Role.ADMIN) {
      if (doc.approvalStatus !== 'PENDING_ADMIN') {
        throw new BadRequestException('Dokumen tidak dalam status menunggu Admin');
      }
      return this.prisma.ftttDocument.update({
        where: { id: docId },
        data: dto.approved
          ? { approvalStatus: 'APPROVED', adminApprovedById: userId, adminApprovedAt: new Date() }
          : { approvalStatus: 'REJECTED' },
      });
    }

    throw new ForbiddenException('Anda tidak berwenang menyetujui dokumen ini');
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
      jaminans:       { include: { uploadedBy: { select: { id: true, name: true } } } },
      documents:      { include: { uploadedBy: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' as const } },
    } as const;
  }
}
