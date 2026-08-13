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
  FtttHierarchyLevel,
  FtttImplLogType,
  FtttPhase,
  FtttPhaseStatus,
  FtttProjectStatus,
  FtttRequestPriority,
  FtttRequestStatus,
  Role,
} from '@prisma/client';
// ─── Reconciliation doc config (mirrors frontend RECON_DOCS) ─────────────────
// docKeys that do NOT need PM approval — set to APPROVED on upload
const RECON_NO_APPROVAL = new Set([
  // Telkom Infra Closing — Finance uploads, auto-approved
  'JAMINAN_PEMELIHARAAN', 'INVOICE_FINAL',
  // PST Closing — Finance uploads, auto-approved
  'INVOICE_PST_CLOSING', 'JAMINAN_PEMELIHARAAN_PST', 'JAMINAN_PELAKSANAAN_PST',
  // iFORTE — no approval needed (legacy keys kept for old projects)
  'PUNCHLIST', 'PO_FINAL', 'PSS', 'MCV', 'INVOICE_IFORTE',
  // iFORTE Reconciliation: Endorsement, BA Justifikasi, BAST/Termin MCV all need PM approval
  // SUPPORTING_DOC_IFORTE requires PM FTTT review/approval (removed from auto-approve)
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
  // iFORTE (Testing Issues iForte): Endorsement (approval) + BAST/Termin MCV wajib;
  // BA Justifikasi opsional; PO Final terbit di sistem iFORTE (tidak diupload);
  // Invoice pindah ke fase Project Closing (diunggah Finance)
  IFORTE: [
    ['ENDORSEMENT',       true, 'Endorsement (perlu disetujui)'],
    ['BAST_TERMIN_MCV',   true, 'BAST / Termin MCV (perlu disetujui)'],
    // BA_JUSTIFIKASI remains optional upload, but when present must be APPROVED (checked separately)
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
  FinancialRequestInboxFilterDtoType,
  FtttProjectFilterDtoType,
  FTTT_PHASES_BY_COMPANY,
  PHASE_LABELS,
  ResolveSanggahDtoType,
  SetPhasePlanDtoType,
  SubmitSanggahDtoType,
  UploadDocumentDtoType,
  UploadDrmDocDtoType,
  UploadSurveyDtoType,
} from './fttt-project.dto';

// Integra V1: resolve the Finance Project that should be linked as a Bulky Project's
// Segment. A Finance SITE is auto-resolved to its parent Segment; SEGMENT/STANDALONE
// (STANDALONE kept for back-compat until the Finance module itself adopts the
// Segment/Site hierarchy) are linked directly.
async function resolveSegmentFinanceProjectId(
  prisma: PrismaService,
  financeProjectId: string,
): Promise<{ id: string; name: string }> {
  const fp = await prisma.financeProject.findUnique({
    where: { id: financeProjectId },
    select: { id: true, name: true, projectType: true, status: true, hierarchyLevel: true, parentId: true },
  });
  if (!fp || fp.projectType !== 'FTTT') {
    throw new BadRequestException('Finance Project tidak valid (harus bertipe FTTT)');
  }
  if (fp.status !== 'ACTIVE') {
    throw new BadRequestException('Finance Project tidak aktif');
  }
  if (fp.hierarchyLevel === 'SITE') {
    if (!fp.parentId) {
      throw new BadRequestException('Finance Site tidak memiliki Segment induk yang valid');
    }
    const segment = await prisma.financeProject.findUnique({ where: { id: fp.parentId }, select: { id: true, name: true } });
    if (!segment) throw new BadRequestException('Segment induk dari Finance Site tidak ditemukan');
    return segment;
  }
  return { id: fp.id, name: fp.name };
}

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
    // Integra V1: this project is created as a Bulky Project, which links to the
    // Finance SEGMENT that owns the overall budget (a Finance SITE is auto-resolved
    // to its parent Segment)
    let linkedProjectName: string | null = dto.projectName ?? null;
    let resolvedFinanceProjectId: string | null = null;
    if (dto.financeProjectId) {
      const segment = await resolveSegmentFinanceProjectId(this.prisma, dto.financeProjectId);
      resolvedFinanceProjectId = segment.id;
      linkedProjectName = dto.projectName?.trim() || segment.name;
    }

    const phases = FTTT_PHASES_BY_COMPANY[dto.ftttCompany];
    const allPhases: FtttPhase[] = [
      FtttPhase.INITIATION,
      FtttPhase.SITE_INITIATION,
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
        financeProject: resolvedFinanceProjectId ? { connect: { id: resolvedFinanceProjectId } } : undefined,
        // Integra V1: projects created via this endpoint are always Bulky (parent);
        // Sites are created underneath via addSite() once Site Initiation is active
        hierarchyLevel: FtttHierarchyLevel.BULKY,
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

    // Daily Activity auto-log handled globally by ProjectDailyActivityInterceptor (all users)

    return project;
  }

  // ─── Integra V1: Bulky Project → Site management ──────────────────────────
  // Sites are added during/after Site Initiation and inherit company/lifecycle
  // from the Bulky parent; each Site links to its own Finance Site.
  private async assertBulky(bulkyId: string) {
    const bulky = await this.prisma.ftttProject.findUniqueOrThrow({ where: { id: bulkyId } });
    if (bulky.hierarchyLevel !== FtttHierarchyLevel.BULKY) {
      throw new BadRequestException('Operasi ini hanya berlaku untuk Bulky Project');
    }
    return bulky;
  }

  /** Integra V11: Closed / Cancelled projects are histori — block operational mutations. */
  private assertFtttMutable(project: { status: FtttProjectStatus; projectName?: string | null; id?: string }) {
    if (project.status === FtttProjectStatus.ACTIVE || project.status === FtttProjectStatus.ON_HOLD) return;
    const label = project.projectName ?? project.id ?? '';
    throw new BadRequestException(
      `Project ${label} berstatus ${project.status} bersifat read-only dan tidak dapat diubah.`,
    );
  }

  // POST :id/close — Integra V11: PM FTTT closes Parent (Bulky); cascade ACTIVE children → CLOSED
  async closeParent(bulkyId: string, actorId: string, actorRole: Role) {
    const allowed: Role[] = [Role.PM_FTTT, Role.ADMIN, Role.GENERAL_MANAGER];
    if (!allowed.includes(actorRole)) {
      throw new ForbiddenException('Hanya PM FTTT yang dapat menutup Parent Project');
    }
    const bulky = await this.assertBulky(bulkyId);
    if (bulky.status !== FtttProjectStatus.ACTIVE) {
      throw new BadRequestException(`Parent Project sudah berstatus ${bulky.status}`);
    }

    await this.prisma.$transaction([
      this.prisma.ftttProject.updateMany({
        where: { parentId: bulkyId, status: FtttProjectStatus.ACTIVE },
        data: { status: FtttProjectStatus.CLOSED },
      }),
      this.prisma.ftttProject.update({
        where: { id: bulkyId },
        data: { status: FtttProjectStatus.CLOSED },
      }),
    ]);

    this.gateway.emitToAll('fttt:project_closed', {
      projectId: bulkyId,
      status: FtttProjectStatus.CLOSED,
      closedById: actorId,
    });

    return this.prisma.ftttProject.findUniqueOrThrow({
      where: { id: bulkyId },
      include: this.fullInclude(),
    });
  }

  // GET :id/available-finance-sites — Finance Sites under the Bulky's linked
  // Segment that are not yet linked to another active FTTT Site
  async listAvailableFinanceSites(bulkyId: string) {
    const bulky = await this.assertBulky(bulkyId);
    if (!bulky.financeProjectId) return [];

    const linkedFinance = await this.prisma.financeProject.findUnique({ where: { id: bulky.financeProjectId } });
    if (!linkedFinance) return [];
    // The Bulky may itself be linked to a Segment or (back-compat) a STANDALONE project
    const segmentId = linkedFinance.hierarchyLevel === 'SITE' && linkedFinance.parentId
      ? linkedFinance.parentId
      : linkedFinance.id;

    const candidateSites = await this.prisma.financeProject.findMany({
      where: { parentId: segmentId, hierarchyLevel: 'SITE', status: 'ACTIVE' },
      orderBy: { name: 'asc' },
    });
    if (candidateSites.length === 0) return [];

    const alreadyLinked = await this.prisma.ftttProject.findMany({
      where: {
        hierarchyLevel: FtttHierarchyLevel.SITE,
        financeProjectId: { in: candidateSites.map((s) => s.id) },
        status: { notIn: [FtttProjectStatus.CANCELLED, FtttProjectStatus.CLOSED] },
      },
      select: { financeProjectId: true },
    });
    const linkedIds = new Set(alreadyLinked.map((l) => l.financeProjectId));
    return candidateSites.filter((s) => !linkedIds.has(s.id));
  }

  // POST :id/sites — PM adds a Site under the Bulky Project
  async addSite(bulkyId: string, financeProjectId: string, actorId: string, actorRole: Role) {
    const allowed: Role[] = [Role.PM_FTTT, Role.ADMIN, Role.GENERAL_MANAGER];
    if (!allowed.includes(actorRole)) {
      throw new ForbiddenException('Hanya PM FTTT yang dapat menambahkan Site');
    }
    const bulky = await this.assertBulky(bulkyId);
    this.assertFtttMutable(bulky);

    const lifecycle = FTTT_PHASES_BY_COMPANY[bulky.ftttCompany];
    const siteInitIdx = lifecycle.indexOf(FtttPhase.SITE_INITIATION);
    const currentIdx = lifecycle.indexOf(bulky.currentPhase);
    if (siteInitIdx === -1 || currentIdx < siteInitIdx) {
      throw new BadRequestException('Selesaikan fase Project Initiation terlebih dahulu sebelum menambahkan Site');
    }

    const financeSite = await this.prisma.financeProject.findUnique({ where: { id: financeProjectId } });
    if (!financeSite) throw new BadRequestException('Finance Site tidak ditemukan');
    if (financeSite.hierarchyLevel === 'SEGMENT') {
      throw new BadRequestException('Finance Project yang dipilih adalah Segment, bukan Site');
    }
    if (financeSite.status !== 'ACTIVE') {
      throw new BadRequestException('Finance Site tidak aktif');
    }

    const existingLink = await this.prisma.ftttProject.findFirst({
      where: {
        financeProjectId,
        hierarchyLevel: FtttHierarchyLevel.SITE,
        status: { notIn: [FtttProjectStatus.CANCELLED, FtttProjectStatus.CLOSED] },
      },
    });
    if (existingLink) {
      throw new BadRequestException('Finance Site ini sudah terhubung dengan FTTT Site lain');
    }

    const allPhases: FtttPhase[] = [
      FtttPhase.INITIATION,
      FtttPhase.SITE_INITIATION,
      FtttPhase.SURVEY,
      FtttPhase.PREPARATION,
      FtttPhase.IMPLEMENTATION,
      FtttPhase.DOCUMENTATION,
      FtttPhase.RECONCILIATION,
      FtttPhase.CLOSING,
    ];
    const now = new Date();

    const site = await this.prisma.ftttProject.create({
      data: {
        ftttCompany:    bulky.ftttCompany,
        // Site inherits the Bulky's trigger document — it does not collect its own
        triggerDocUrl:  bulky.triggerDocUrl,
        triggerDocType: bulky.triggerDocType,
        pm:             { connect: { id: bulky.pmId } },
        financeProject: { connect: { id: financeProjectId } },
        hierarchyLevel: FtttHierarchyLevel.SITE,
        parent:         { connect: { id: bulkyId } },
        projectName:    financeSite.name,
        currentPhase:   FtttPhase.SURVEY,
        status:         FtttProjectStatus.ACTIVE,
        phaseProgresses: {
          createMany: {
            data: allPhases.map((phase) => {
              const inLifecycle = lifecycle.includes(phase);
              if (!inLifecycle) return { phase, status: FtttPhaseStatus.SKIPPED };
              if (phase === FtttPhase.INITIATION || phase === FtttPhase.SITE_INITIATION) {
                return {
                  phase,
                  status: FtttPhaseStatus.COMPLETED,
                  unlockedAt: now,
                  completedAt: now,
                  completedById: actorId,
                };
              }
              if (phase === FtttPhase.SURVEY) {
                return { phase, status: FtttPhaseStatus.ACTIVE, unlockedAt: now };
              }
              return { phase, status: FtttPhaseStatus.LOCKED };
            }),
          },
        },
      },
      include: this.fullInclude(),
    });

    this.gateway.emitToAll('fttt:site_added', {
      bulkyId,
      siteId: site.id,
      financeProjectId,
    });

    // Daily Activity auto-log handled globally by ProjectDailyActivityInterceptor (all users)

    return site;
  }

  // GET :id/sites — list Sites under a Bulky Project
  async listSites(bulkyId: string) {
    await this.assertBulky(bulkyId);
    return this.prisma.ftttProject.findMany({
      where: { parentId: bulkyId },
      orderBy: { createdAt: 'asc' },
      include: {
        pm: { select: { id: true, name: true } },
        financeProject: { select: { id: true, code: true, name: true } },
        phaseProgresses: { orderBy: { phase: 'asc' } },
        _count: { select: { surveyUploads: true, transactions: true, spans: true } },
      },
    });
  }

  // DELETE sites/:siteId — only while the Site has no meaningful activity yet
  async deleteSite(siteId: string, actorId: string, actorRole: Role) {
    const allowed: Role[] = [Role.PM_FTTT, Role.ADMIN, Role.GENERAL_MANAGER];
    if (!allowed.includes(actorRole)) {
      throw new ForbiddenException('Hanya PM FTTT yang dapat menghapus Site');
    }
    const site = await this.prisma.ftttProject.findUniqueOrThrow({
      where: { id: siteId },
      include: {
        _count: { select: { surveyUploads: true, implementationLogs: true, transactions: true, spans: true } },
      },
    });
    if (site.hierarchyLevel !== FtttHierarchyLevel.SITE) {
      throw new BadRequestException('Hanya Site yang dapat dihapus melalui operasi ini');
    }
    this.assertFtttMutable(site);
    if (site.parentId) {
      const parent = await this.prisma.ftttProject.findUnique({ where: { id: site.parentId } });
      if (parent) this.assertFtttMutable(parent);
    }
    if (site.currentPhase !== FtttPhase.SURVEY) {
      throw new BadRequestException('Site hanya dapat dihapus selagi masih pada fase Validation & Survey');
    }
    const { surveyUploads, implementationLogs, transactions, spans } = site._count;
    if (surveyUploads > 0 || implementationLogs > 0 || transactions > 0 || spans > 0) {
      throw new BadRequestException('Site tidak dapat dihapus karena sudah memiliki aktivitas (survey, log implementasi, transaksi, atau span)');
    }
    await this.prisma.ftttProject.delete({ where: { id: siteId } });
    return { success: true };
  }

  // ─── Issue 13: Replace / delete triggering document (INITIATION phase only) ─
  async replaceTriggerDoc(id: string, file: Express.Multer.File | undefined, userId: string, userRole: Role) {
    if (userRole !== Role.ADMIN && userRole !== Role.GENERAL_MANAGER && userRole !== Role.PM_FTTT) {
      throw new ForbiddenException('Hanya Admin atau PM FTTT yang dapat mengganti dokumen triggering');
    }
    const project = await this.prisma.ftttProject.findUniqueOrThrow({ where: { id }, select: { id: true, currentPhase: true, ftttCompany: true, status: true, projectName: true } });
    this.assertFtttMutable(project);
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
    // Integra V1: the main list surfaces Bulky Projects only — Sites live under
    // their Bulky and are reached via listSites()/findOne(), not this listing.
    where.hierarchyLevel = FtttHierarchyLevel.BULKY;

    // PM_FTTT only sees their own projects; Admin/GM/Finance/Surveyor/PM Senior see all
    // PAI V9 URGENT: PM_SENIOR = cross-PM read/monitor only (mutations still exclude senior)
    const viewAllRoles: Role[] = [
      Role.ADMIN, Role.GENERAL_MANAGER, Role.ADMIN_STOCK,
      Role.FINANCE,         // Finance uploads Jaminan — needs to see all projects
      Role.SURVEYOR_FTTT,   // Surveyor needs to see projects they're working on
      Role.PM_SENIOR,
    ];
    if (!viewAllRoles.includes(userRole)) {
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
              children: true, // Integra V1: number of Sites under this Bulky Project
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

    // Roles that can view any project regardless of pmId (read/monitor)
    const viewAllRoles: Role[] = [
      Role.ADMIN, Role.GENERAL_MANAGER,
      Role.FINANCE,         // Finance uploads Jaminan for TELKOM_INFRA projects
      Role.SURVEYOR_FTTT,   // Surveyor uploads survey evidence for iForte/PST projects
      Role.PM_SENIOR,       // PAI V9 URGENT: supervisory visibility across PMs
    ];
    if (!viewAllRoles.includes(userRole) && project.pmId !== userId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke project ini');
    }

    // JLM: surface a maintenance reminder to Admins when the window is reached
    await this.maybeSendMaintenanceReminder(project);

    // Integra V3: normalize legacy Bulky Parents that advanced past SITE_INITIATION
    // into operational phases — rewind to monitoring mode so Child Sites stay accessible.
    if (
      project.hierarchyLevel === FtttHierarchyLevel.BULKY &&
      project.currentPhase !== FtttPhase.INITIATION &&
      project.currentPhase !== FtttPhase.SITE_INITIATION
    ) {
      return this.normalizeLegacyBulkyParent(project.id);
    }

    return project;
  }

  /** Integra V3: rewind Bulky Parent stuck past Site Initiation back to monitoring mode */
  private async normalizeLegacyBulkyParent(id: string) {
    const operationalPhases: FtttPhase[] = [
      FtttPhase.SURVEY,
      FtttPhase.PREPARATION,
      FtttPhase.PROCUREMENT,
      FtttPhase.IMPLEMENTATION,
      FtttPhase.DOCUMENTATION,
      FtttPhase.RECONCILIATION,
      FtttPhase.CLOSING,
    ];
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.ftttProject.update({
        where: { id },
        data: { currentPhase: FtttPhase.SITE_INITIATION, status: FtttProjectStatus.ACTIVE },
      });
      await tx.ftttPhaseProgress.upsert({
        where: { projectId_phase: { projectId: id, phase: FtttPhase.INITIATION } },
        update: { status: FtttPhaseStatus.COMPLETED, completedAt: now },
        create: { projectId: id, phase: FtttPhase.INITIATION, status: FtttPhaseStatus.COMPLETED, unlockedAt: now, completedAt: now },
      });
      await tx.ftttPhaseProgress.upsert({
        where: { projectId_phase: { projectId: id, phase: FtttPhase.SITE_INITIATION } },
        update: { status: FtttPhaseStatus.COMPLETED, completedAt: now },
        create: { projectId: id, phase: FtttPhase.SITE_INITIATION, status: FtttPhaseStatus.COMPLETED, unlockedAt: now, completedAt: now },
      });
      for (const phase of operationalPhases) {
        await tx.ftttPhaseProgress.upsert({
          where: { projectId_phase: { projectId: id, phase } },
          update: { status: FtttPhaseStatus.SKIPPED },
          create: { projectId: id, phase, status: FtttPhaseStatus.SKIPPED },
        });
      }
    });
    return this.prisma.ftttProject.findUniqueOrThrow({ where: { id }, include: this.fullInclude() });
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

    // Integra V3: Bulky Site Initiation requires ≥1 Child Site before completion
    if (phase === FtttPhase.SITE_INITIATION && project.hierarchyLevel === FtttHierarchyLevel.BULKY) {
      const siteCount = await this.prisma.ftttProject.count({
        where: {
          parentId: project.id,
          hierarchyLevel: FtttHierarchyLevel.SITE,
          status: { not: FtttProjectStatus.CANCELLED },
        },
      });
      if (siteCount === 0) {
        reasons.push('Minimal satu Site harus ditambahkan sebelum menyelesaikan Site Initiation');
      }
    }

    if (phase === FtttPhase.SURVEY) {
      // Partial survey: unlock Preparation with ≥1 evidence OR ≥1 site done —
      // remaining sites can continue after phase advance.
      const siteDone = await this.prisma.ftttSurveySite.count({
        where: { projectId: project.id, status: 'DONE' },
      });
      if (project.surveyUploads.length === 0 && siteDone === 0) {
        reasons.push('Minimal satu bukti survei atau satu site tersurvey wajib sebelum lanjut Preparation');
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
      if (company === FtttCompany.IFORTE) {
        // iFORTE: RFSD (Ready For Sales Document) wajib sebagai indikator
        // pekerjaan fisik selesai sebelum lanjut ke Documentation & Acceptance
        const hasRfsd = implLogs.some((l) => l.logType === 'RFSD');
        if (!hasRfsd) {
          reasons.push('RFSD (Ready For Sales Document) belum diunggah');
        }
      } else {
        const hasMonitoringDoc = implLogs.some((l) => l.logType === 'MONITORING_DOC');
        if (!hasMonitoringDoc) {
          reasons.push('Dokumen Monitoring belum diunggah oleh Admin');
        }
      }
      // Integra V1: Metode Implementasi (Galian / KU) is now method-first for ALL
      // companies (was PST-only) — must be chosen before completing Implementation
      if (!(project as typeof project & { implementationType: string | null }).implementationType) {
        reasons.push('Metode Implementasi (Galian / KU) belum dipilih');
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
        // iFORTE: seluruh dokumen Documentation & Acceptance bersifat opsional (non-mandatory)
        IFORTE: [],
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
        // iFORTE (Testing Issues iForte): Finance mengunggah Invoice (berdasarkan
        // BAST/Termin MCV) lalu memonitor pembayaran; project baru bisa Closed
        // setelah invoice ada dan status pembayaran PAID.
        if (!reconDocMap.has('INVOICE_IFORTE')) {
          reasons.push('Invoice belum diunggah oleh Finance');
        }
        const payStatus = (project as typeof project & { paymentStatus: string | null }).paymentStatus;
        if (payStatus !== 'PAID') {
          reasons.push('Status pembayaran belum ditandai LUNAS (PAID) oleh Finance');
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
      const reconDocs = (project as typeof project & { reconDocs: { docKey: string; approvalStatus: string }[] })
        .reconDocs ?? [];
      const reconDocMap = new Map(reconDocs.map((d) => [d.docKey, d.approvalStatus]));

      for (const [docKey, needsApproval, label] of required) {
        const status = reconDocMap.get(docKey);
        if (!status) {
          reasons.push(`${label} belum diunggah`);
        } else if (needsApproval && status !== 'APPROVED') {
          reasons.push(`${label} belum disetujui`);
        }
      }
      // iFORTE: BA Justifikasi opsional, tetapi jika diunggah wajib disetujui PM
      if (company === FtttCompany.IFORTE) {
        const baJust = reconDocMap.get('BA_JUSTIFIKASI');
        if (baJust && baJust !== 'APPROVED') {
          reasons.push('BA Justifikasi belum disetujui');
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
    this.assertFtttMutable(project);

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

    // Integra V3: Parent (Bulky) stops after Site Initiation — operational lifecycle lives on Sites.
    // Completing SITE_INITIATION marks Parent initiation done and skips remaining phases.
    const isBulkyTerminal =
      project.hierarchyLevel === FtttHierarchyLevel.BULKY &&
      project.currentPhase === FtttPhase.SITE_INITIATION;

    if (
      project.hierarchyLevel === FtttHierarchyLevel.BULKY &&
      project.currentPhase !== FtttPhase.INITIATION &&
      project.currentPhase !== FtttPhase.SITE_INITIATION
    ) {
      throw new BadRequestException(
        'Parent Project sudah melewati Initiation — lanjutkan lifecycle di masing-masing Child Site',
      );
    }

    const nextPhase = isBulkyTerminal ? null : (lifecycle[currentIdx + 1] ?? null);
    const operationalPhases: FtttPhase[] = [
      FtttPhase.SURVEY,
      FtttPhase.PREPARATION,
      FtttPhase.PROCUREMENT,
      FtttPhase.IMPLEMENTATION,
      FtttPhase.DOCUMENTATION,
      FtttPhase.RECONCILIATION,
      FtttPhase.CLOSING,
    ];

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

      if (isBulkyTerminal) {
        // Skip all operational phases on Parent; keep currentPhase = SITE_INITIATION (completed)
        for (const phase of operationalPhases) {
          if (!lifecycle.includes(phase)) continue;
          await tx.ftttPhaseProgress.upsert({
            where: { projectId_phase: { projectId: id, phase } },
            update: { status: FtttPhaseStatus.SKIPPED },
            create: { projectId: id, phase, status: FtttPhaseStatus.SKIPPED },
          });
        }
        // currentPhase stays SITE_INITIATION; project remains ACTIVE for Site monitoring
      } else if (nextPhase) {
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

    // Integra V1: Notify PM when the Bulky Project enters Site Initiation — Sites can now be added
    if (
      project.currentPhase === FtttPhase.INITIATION &&
      updated.currentPhase === FtttPhase.SITE_INITIATION &&
      pmId
    ) {
      await this.notifications.createForUser(pmId, {
        title:   'FTTT — Fase Site Initiation Dimulai',
        message: `Project ${pName} telah memasuki fase Site Initiation. Silakan tambahkan Site untuk melanjutkan.`,
        type:    'FTTT_PHASE_CHANGE',
        link:    `/fttt-projects/${id}`,
        entityId: id,
      });
    }

    // Integra V3: Parent Initiation complete — Sites continue operational lifecycle
    if (
      isBulkyTerminal &&
      project.hierarchyLevel === FtttHierarchyLevel.BULKY
    ) {
      if (pmId) {
        await this.notifications.createForUser(pmId, {
          title:   'FTTT — Parent Initiation Selesai',
          message: `Parent Project ${pName} selesai Site Initiation. Lanjutkan Validation & Survey pada masing-masing Child Site.`,
          type:    'FTTT_PHASE_CHANGE',
          link:    `/fttt-projects/${id}`,
          entityId: id,
        });
      }
      await this.notifications.notifyUsersByRole(Role.SURVEYOR_FTTT, {
        title:   'FTTT — Child Sites Siap Survey',
        message: `Sites di bawah ${pName} siap dikerjakan pada fase Validation & Survey.`,
        type:    'FTTT_PHASE_CHANGE',
        link:    `/fttt-projects/${id}`,
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

  // ─── Upload survey evidence (partial survey: allowed during SURVEY and after) ───
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
    const project = await this.prisma.ftttProject.findUniqueOrThrow({ where: { id } });
    if (project.status !== 'ACTIVE') {
      throw new BadRequestException('Project tidak aktif — survey tidak dapat diunggah');
    }
    // Allow continuing survey after leaving SURVEY (parallel with Preparation+)
    if (project.currentPhase === FtttPhase.INITIATION || project.currentPhase === FtttPhase.SITE_INITIATION) {
      throw new BadRequestException('Selesaikan Project/Site Initiation terlebih dahulu');
    }
    if (dto.siteId) {
      const site = await this.prisma.ftttSurveySite.findFirst({ where: { id: dto.siteId, projectId: id } });
      if (!site) throw new BadRequestException('Site survey tidak ditemukan pada project ini');
    }
    let fileUrl = '';
    if (file) {
      fileUrl = await this.storage.uploadMulterFile(file, 'fttt-survey', id);
    }
    return this.prisma.ftttSurveyUpload.create({
      data: {
        projectId: id,
        uploadedById: userId,
        fileUrl,
        fileType: dto.fileType,
        // Integra V1: preserve the client's original filename for display purposes
        originalFileName: file?.originalname ?? null,
        caption: dto.caption ?? null,
        siteId: dto.siteId ?? null,
      },
      include: { uploadedBy: { select: { id: true, name: true } }, site: true },
    });
  }

  // ─── Partial survey: site CRUD ───────────────────────────────────────────
  async listSurveySites(projectId: string) {
    await this.prisma.ftttProject.findUniqueOrThrow({ where: { id: projectId } });
    const sites = await this.prisma.ftttSurveySite.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { uploads: true } } },
    });
    const done = sites.filter((s) => s.status === 'DONE').length;
    return { sites, done, total: sites.length, complete: sites.length > 0 && done === sites.length };
  }

  async addSurveySite(projectId: string, dto: { name: string; code?: string; notes?: string }, userRole: Role) {
    const allowed: Role[] = [Role.SURVEYOR_FTTT, Role.PM_FTTT, Role.ADMIN, Role.GENERAL_MANAGER];
    if (!allowed.includes(userRole)) {
      throw new ForbiddenException('Tidak berwenang menambah site survey');
    }
    await this.prisma.ftttProject.findUniqueOrThrow({ where: { id: projectId } });
    const maxOrder = await this.prisma.ftttSurveySite.aggregate({
      where: { projectId },
      _max: { sortOrder: true },
    });
    return this.prisma.ftttSurveySite.create({
      data: {
        projectId,
        name: dto.name.trim(),
        code: dto.code?.trim() || null,
        notes: dto.notes?.trim() || null,
        sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
      },
    });
  }

  async markSurveySite(
    projectId: string,
    siteId: string,
    dto: { status: 'PENDING' | 'DONE'; notes?: string },
    userRole: Role,
  ) {
    const allowed: Role[] = [Role.SURVEYOR_FTTT, Role.PM_FTTT, Role.ADMIN, Role.GENERAL_MANAGER];
    if (!allowed.includes(userRole)) {
      throw new ForbiddenException('Tidak berwenang mengubah status site survey');
    }
    const site = await this.prisma.ftttSurveySite.findFirst({ where: { id: siteId, projectId } });
    if (!site) throw new NotFoundException('Site survey tidak ditemukan');
    const updated = await this.prisma.ftttSurveySite.update({
      where: { id: siteId },
      data: {
        status: dto.status,
        notes: dto.notes !== undefined ? dto.notes : site.notes,
        completedAt: dto.status === 'DONE' ? new Date() : null,
      },
    });
    await this.maybeMarkSurveyAllComplete(projectId);
    return updated;
  }

  async deleteSurveySite(projectId: string, siteId: string, userRole: Role) {
    const allowed: Role[] = [Role.SURVEYOR_FTTT, Role.PM_FTTT, Role.ADMIN, Role.GENERAL_MANAGER];
    if (!allowed.includes(userRole)) {
      throw new ForbiddenException('Tidak berwenang menghapus site survey');
    }
    const project = await this.prisma.ftttProject.findUnique({
      where: { id: projectId },
      select: { currentPhase: true },
    });
    if (!project) throw new NotFoundException('Project tidak ditemukan');
    if (project.currentPhase !== FtttPhase.SURVEY) {
      throw new BadRequestException('Site tidak dapat dihapus karena sudah memasuki fase berikutnya');
    }
    const site = await this.prisma.ftttSurveySite.findFirst({
      where: { id: siteId, projectId },
      include: { _count: { select: { uploads: true } } },
    });
    if (!site) throw new NotFoundException('Site survey tidak ditemukan');
    if (site.status === 'DONE' || site._count.uploads > 0) {
      throw new BadRequestException('Site tidak dapat dihapus karena sudah memiliki aktivitas/transaksi');
    }
    await this.prisma.ftttSurveySite.delete({ where: { id: siteId } });
    await this.maybeMarkSurveyAllComplete(projectId);
    return { success: true };
  }

  private async maybeMarkSurveyAllComplete(projectId: string) {
    const sites = await this.prisma.ftttSurveySite.findMany({ where: { projectId }, select: { status: true } });
    if (sites.length === 0) return;
    const allDone = sites.every((s) => s.status === 'DONE');
    if (!allDone) return;
    const prog = await this.prisma.ftttPhaseProgress.findUnique({
      where: { projectId_phase: { projectId, phase: FtttPhase.SURVEY } },
    });
    if (!prog) return;
    // Preserve PENDING_PM_REVIEW / REJECTED while still on review; otherwise mark complete
    if (prog.notes === 'PENDING_PM_REVIEW' || (typeof prog.notes === 'string' && prog.notes.startsWith('REJECTED:'))) {
      return;
    }
    await this.prisma.ftttPhaseProgress.update({
      where: { projectId_phase: { projectId, phase: FtttPhase.SURVEY } },
      data: { notes: 'SURVEY_ALL_COMPLETE' },
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

  // ─── Sanggah (removed from iFORTE business process — Testing Issues v3) ───
  async submitSanggah(
    id: string,
    dto: SubmitSanggahDtoType,
    file: Express.Multer.File | undefined,
    userId: string,
  ) {
    throw new BadRequestException('Proses Sanggah sudah tidak digunakan pada lifecycle iFORTE');
  }

  async resolveSanggah(sanggahId: string, dto: ResolveSanggahDtoType, userId: string) {
    throw new BadRequestException('Proses Sanggah sudah tidak digunakan pada lifecycle iFORTE');
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
    // iFORTE RFSD: Admin Project only
    if (dto.logType === FtttImplLogType.RFSD) {
      if (userRole !== Role.ADMIN && userRole !== Role.GENERAL_MANAGER) {
        throw new ForbiddenException('Hanya Admin Project yang dapat mengunggah RFSD');
      }
    } else if (project.ftttCompany === FtttCompany.TELKOM_INFRA) {
      // TI: Admin-only
      if (userRole !== Role.ADMIN && userRole !== Role.GENERAL_MANAGER) {
        throw new ForbiddenException('Hanya Admin Project yang dapat menambahkan log implementasi untuk project Telkom Infra');
      }
    } else {
      const allowedRoles: Role[] = [Role.SURVEYOR_FTTT, Role.PM_FTTT, Role.ADMIN, Role.GENERAL_MANAGER];
      if (!allowedRoles.includes(userRole)) {
        throw new ForbiddenException('Tidak memiliki akses untuk menambahkan log implementasi');
      }
    }

    // File required for PHOTO, MONITORING_DOC, RFSD, KMZ
    if (
      (dto.logType === FtttImplLogType.PHOTO ||
        dto.logType === FtttImplLogType.MONITORING_DOC ||
        dto.logType === FtttImplLogType.RFSD ||
        dto.logType === FtttImplLogType.KMZ) &&
      !file
    ) {
      throw new BadRequestException('File wajib untuk tipe log ini');
    }

    if (dto.logType === FtttImplLogType.KMZ && file) {
      const name = (file.originalname || '').toLowerCase();
      if (!name.endsWith('.kmz')) {
        throw new BadRequestException('Hanya file dengan format .kmz yang diterima untuk tipe File KMZ');
      }
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
        meterDone:   dto.meterDone != null ? dto.meterDone : null,
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
    // Integra V2: Daily Log folders for both Galian (Span) and KU
    if (project.implementationType !== 'GALIAN' && project.implementationType !== 'KU') {
      throw new BadRequestException('Pilih Metode Implementasi (Galian atau KU) terlebih dahulu');
    }
    if (dto.lengthMeters == null || dto.lengthMeters <= 0) {
      throw new BadRequestException('Panjang pekerjaan (meter) wajib diisi saat membuat Folder');
    }
    if (project.totalPanjangMeter != null) {
      const existing = await this.prisma.ftttSpan.aggregate({
        where: { projectId },
        _sum: { lengthMeters: true },
      });
      const used = Number(existing._sum.lengthMeters ?? 0);
      const total = Number(project.totalPanjangMeter);
      if (used + dto.lengthMeters > total + 0.001) {
        throw new BadRequestException(
          `Akumulasi panjang Folder (${used + dto.lengthMeters} m) melebihi Total Panjang Pekerjaan (${total} m)`,
        );
      }
    }
    return this.prisma.ftttSpan.create({
      data: {
        projectId,
        spanNumber: dto.spanNumber,
        lengthMeters: dto.lengthMeters,
        createdById: userId,
      },
      include: {
        spanLogs: {
          include: { uploadedBy: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' as const },
        },
        createdBy: { select: { id: true, name: true } },
      },
    });
  }

  async deleteSpan(spanId: string, userId: string, userRole: Role) {
    if (userRole !== Role.ADMIN && userRole !== Role.GENERAL_MANAGER) {
      throw new ForbiddenException('Hanya Admin yang dapat menghapus Span');
    }
    return this.prisma.ftttSpan.delete({ where: { id: spanId } });
  }

  async addSpanLog(spanId: string, dto: AddSpanLogDtoType, file: Express.Multer.File, userId: string, userRole: Role) {
    const span = await this.prisma.ftttSpan.findUniqueOrThrow({ where: { id: spanId } });
    // Integra V1: Daily Log is generalized — PM FTTT & Surveyor may also log for any
    // company (was iFORTE-only widening; TI/PST were Admin-only)
    const allowed: Role[] = [Role.ADMIN, Role.GENERAL_MANAGER, Role.PM_FTTT, Role.SURVEYOR_FTTT];
    if (!allowed.includes(userRole)) {
      throw new ForbiddenException('Tidak memiliki akses untuk mengunggah dokumentasi Daily Log');
    }
    const fileUrl = await this.storage.uploadMulterFile(file, 'fttt-span', span.projectId);
    const spanLog = await this.prisma.ftttSpanLog.create({
      data: {
        spanId, projectId: span.projectId, category: dto.category, fileUrl,
        caption: dto.caption ?? null, uploadedById: userId,
        // GENERAL: meter diakumulasi menjadi Progress (%)
        meterDone: dto.meterDone != null ? dto.meterDone : null,
      },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
    // Integra V1: every Daily Log entry also appears in Log Aktivitas (project
    // history), regardless of company — was iFORTE-only
    {
      const catLabel = String(dto.category).replace(/_/g, ' ');
      await this.prisma.ftttImplementationLog.create({
        data: {
          projectId: span.projectId,
          uploadedById: userId,
          logType: FtttImplLogType.PHOTO,
          fileUrl,
          caption: dto.caption ?? `Daily Log — ${catLabel}`,
          notes: dto.meterDone != null ? `Meter selesai: ${dto.meterDone} m` : null,
          meterDone: dto.meterDone != null ? dto.meterDone : null,
        },
      });
    }
    return spanLog;
  }

  async deleteSpanLog(logId: string, userId: string, userRole: Role) {
    if (userRole !== Role.ADMIN && userRole !== Role.GENERAL_MANAGER) {
      throw new ForbiddenException('Hanya Admin yang dapat menghapus log Span');
    }
    return this.prisma.ftttSpanLog.delete({ where: { id: logId } });
  }

  // ─── iFORTE GENERAL: total panjang pekerjaan (meter) — dasar Progress (%) ──
  async setTotalPanjang(id: string, meters: number, userId: string, userRole: Role) {
    const allowed: Role[] = [Role.PM_FTTT, Role.ADMIN, Role.GENERAL_MANAGER];
    if (!allowed.includes(userRole)) {
      throw new ForbiddenException('Hanya PM FTTT atau Admin yang dapat mengatur total panjang pekerjaan');
    }
    await this.prisma.ftttProject.findUniqueOrThrow({ where: { id } });
    await this.prisma.ftttProject.update({
      where: { id },
      data: { totalPanjangMeter: meters },
    });
    return this.prisma.ftttProject.findUniqueOrThrow({ where: { id }, include: this.fullInclude() });
  }

  // ─── iFORTE Closing: monitoring status pembayaran invoice ─────────────────
  async setPaymentStatus(id: string, status: 'UNPAID' | 'PAID', userId: string, userRole: Role) {
    const allowed: Role[] = [Role.FINANCE, Role.ADMIN, Role.GENERAL_MANAGER];
    if (!allowed.includes(userRole)) {
      throw new ForbiddenException('Hanya Finance atau Admin yang dapat mengubah status pembayaran');
    }
    const project = await this.prisma.ftttProject.findUniqueOrThrow({ where: { id } });
    if (project.ftttCompany !== FtttCompany.IFORTE) {
      throw new BadRequestException('Status pembayaran hanya untuk project iFORTE');
    }
    await this.prisma.ftttProject.update({
      where: { id },
      data: { paymentStatus: status },
    });
    return this.prisma.ftttProject.findUniqueOrThrow({ where: { id }, include: this.fullInclude() });
  }

  // ─── Private helpers ──────────────────────────────────────────────────────
  private fullInclude() {
    return {
      pm:             { select: { id: true, name: true, email: true } },
      cleanList:      { select: { id: true, rwCode: true, kelurahan: true } },
      phaseProgresses: { orderBy: { phase: 'asc' as const } },
      surveyUploads:  { include: { uploadedBy: { select: { id: true, name: true } }, site: true }, orderBy: { createdAt: 'desc' as const } },
      surveySites:    { include: { _count: { select: { uploads: true } } }, orderBy: { sortOrder: 'asc' as const } },
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
      transactions:   {
        include: {
          createdBy: { select: { id: true, name: true } },
          disbursedBy: { select: { id: true, name: true } },
          reviewedBy: { select: { id: true, name: true } },
          transferProofs: { orderBy: { createdAt: 'asc' as const } },
        },
        orderBy: { createdAt: 'desc' as const },
      },
      // Integra V1: Bulky ↔ Site hierarchy context
      parent:   { select: { id: true, projectName: true, ftttCompany: true, hierarchyLevel: true } },
      children: {
        select: {
          id: true, projectName: true, currentPhase: true, status: true,
          phaseProgresses: { select: { phase: true, status: true } },
          financeProject: { select: { id: true, code: true, name: true } },
        },
        orderBy: { createdAt: 'asc' as const },
      },
    } as const;
  }

  // ─── JLM: Finance Project options for the FTTT "Nama Project" dropdown ────────
  async listFinanceOptions() {
    return this.prisma.financeProject.findMany({
      where: { projectType: 'FTTT', status: 'ACTIVE' },
      select: {
        id: true, code: true, name: true, totalBudget: true,
        budgetPerizinan: true, materialBudget: true, jasaBudget: true, budgetLainLain: true,
        hierarchyLevel: true, parentId: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── JLM: Implementation Transaction Log (PM FTTT) ───────────────────────────
  // Stage 1: PM creates plan/need — does NOT reduce Finance budget until disbursed
  // Integra V1: this is now a Financial Request — PM records the need, Finance
  // reviews (accept/decline) before the existing disburse (Tanggal Dana Keluar) step.
  async addTransaction(projectId: string, dto: AddFtttTransactionDtoType, userId: string, userRole: Role) {
    if (userRole !== Role.PM_FTTT && userRole !== Role.GENERAL_MANAGER) {
      throw new ForbiddenException('Hanya PM FTTT yang dapat mencatat Transaction Log');
    }
    const project = await this.prisma.ftttProject.findUniqueOrThrow({
      where: { id: projectId },
      select: { id: true, currentPhase: true, financeProjectId: true, projectName: true },
    });
    // Stable v2: TX Log available on all operational phases (not Initiation / Site Initiation / Procurement)
    const TX_LOG_PHASES: FtttPhase[] = [
      FtttPhase.SURVEY,
      FtttPhase.PREPARATION,
      FtttPhase.IMPLEMENTATION,
      FtttPhase.DOCUMENTATION,
      FtttPhase.RECONCILIATION,
      FtttPhase.CLOSING,
    ];
    if (!TX_LOG_PHASES.includes(project.currentPhase)) {
      throw new BadRequestException('Transaction Log tidak tersedia pada fase ini');
    }
    const expectedNeedDate = new Date(dto.expectedNeedDate);
    if (Number.isNaN(expectedNeedDate.getTime())) {
      throw new BadRequestException('Tanggal Kebutuhan tidak valid');
    }
    const qty = Number(dto.qty);
    const price = Number(dto.price);
    const total = Math.round(qty * price * 100) / 100;

    // Integra V1: LAIN_LAIN is funded from the Segment's budget; the other categories
    // draw from the Site's own Finance Project (Segment owns budgetLainLain only —
    // see FinanceProject schema comment).
    let financeProjectId = project.financeProjectId ?? null;
    if (dto.category === 'LAIN_LAIN' && financeProjectId) {
      const fp = await this.prisma.financeProject.findUnique({
        where: { id: financeProjectId },
        select: { hierarchyLevel: true, parentId: true },
      });
      if (fp?.hierarchyLevel === 'SITE' && fp.parentId) {
        financeProjectId = fp.parentId;
      }
    }

    // Priority derived from how many days remain until the need date
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysUntilNeed = Math.ceil((expectedNeedDate.getTime() - Date.now()) / msPerDay);
    const priority: FtttRequestPriority =
      daysUntilNeed <= 3 ? FtttRequestPriority.HIGH
      : daysUntilNeed <= 7 ? FtttRequestPriority.MEDIUM
      : FtttRequestPriority.LOW;

    const tx = await this.prisma.ftttTransaction.create({
      data: {
        ftttProjectId:    projectId,
        financeProjectId,
        category:         dto.category,
        aktivitas:        dto.aktivitas.trim(),
        uom:              dto.uom?.trim() || null,
        qty:              qty.toString(),
        price:            price.toString(),
        total:            total.toString(),
        remarks:          dto.remarks.trim(),
        createdById:      userId,
        expectedNeedDate,
        reason:           dto.reason.trim(),
        priority,
        requestStatus:    FtttRequestStatus.PENDING_REVIEW,
        createdPhase:     project.currentPhase,
        // disbursedAt left null — budget not affected until Finance confirms
      },
      include: {
        createdBy: { select: { id: true, name: true } },
        disbursedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
        transferProofs: true,
      },
    });

    await this.notifications.notifyUsersByRole(Role.FINANCE, {
      title:   'FTTT — Financial Request Baru',
      message: `PM FTTT mengajukan Financial Request "${tx.aktivitas}" (${dto.category}, prioritas ${priority}) untuk project ${project.projectName ?? projectId.slice(-6)}.`,
      type:    'FTTT_FINANCIAL_REQUEST',
      link:    `/fttt-projects/${projectId}?tx=${tx.id}`,
      entityId: tx.id,
    });

    // Daily Activity auto-log handled globally by ProjectDailyActivityInterceptor (all users)

    return tx;
  }

  // Integra V1 / Stable v1: Finance accepts — Tanggal Persetujuan (date-only, no jam)
  async acceptFinancialRequest(txId: string, scheduledReleaseAtIso: string, userId: string, userRole: Role) {
    if (userRole !== Role.FINANCE && userRole !== Role.GENERAL_MANAGER) {
      throw new ForbiddenException('Hanya Finance yang dapat menyetujui Financial Request');
    }
    const tx = await this.prisma.ftttTransaction.findUniqueOrThrow({
      where: { id: txId },
      include: { ftttProject: { select: { id: true, projectName: true, pmId: true } } },
    });
    if (tx.requestStatus !== FtttRequestStatus.PENDING_REVIEW) {
      throw new BadRequestException('Financial Request ini sudah diproses sebelumnya');
    }
    // Normalize to date-only (start of calendar day) — no time component required from Finance
    const dateOnly = scheduledReleaseAtIso.slice(0, 10);
    const scheduledReleaseAt = new Date(`${dateOnly}T00:00:00.000Z`);
    if (Number.isNaN(scheduledReleaseAt.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
      throw new BadRequestException('Tanggal Persetujuan tidak valid');
    }
    const updated = await this.prisma.ftttTransaction.update({
      where: { id: txId },
      data: {
        requestStatus:  FtttRequestStatus.ACCEPTED,
        scheduledReleaseAt,
        reviewedById:   userId,
        reviewedAt:     scheduledReleaseAt,
        declinedReason: null,
      },
      include: {
        createdBy: { select: { id: true, name: true } },
        disbursedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    });
    if (tx.ftttProject.pmId) {
      await this.notifications.createForUser(tx.ftttProject.pmId, {
        title:   'FTTT — Financial Request Disetujui',
        message: `Financial Request "${tx.aktivitas}" untuk project ${tx.ftttProject.projectName ?? tx.ftttProject.id.slice(-6)} telah disetujui Finance. Tanggal Persetujuan: ${scheduledReleaseAt.toLocaleDateString('id-ID')}.`,
        type:    'FTTT_FINANCIAL_REQUEST_ACCEPTED',
        link:    `/fttt-projects/${tx.ftttProject.id}?tx=${txId}`,
        entityId: txId,
      });
    }
    return updated;
  }

  // Integra V1: Finance declines a Financial Request with a reason
  async declineFinancialRequest(txId: string, declinedReason: string, userId: string, userRole: Role) {
    if (userRole !== Role.FINANCE && userRole !== Role.GENERAL_MANAGER) {
      throw new ForbiddenException('Hanya Finance yang dapat menolak Financial Request');
    }
    if (!declinedReason?.trim()) {
      throw new BadRequestException('Alasan penolakan wajib diisi');
    }
    const tx = await this.prisma.ftttTransaction.findUniqueOrThrow({
      where: { id: txId },
      include: { ftttProject: { select: { id: true, projectName: true, pmId: true } } },
    });
    if (tx.requestStatus !== FtttRequestStatus.PENDING_REVIEW) {
      throw new BadRequestException('Financial Request ini sudah diproses sebelumnya');
    }
    const updated = await this.prisma.ftttTransaction.update({
      where: { id: txId },
      data: {
        requestStatus:  FtttRequestStatus.DECLINED,
        declinedReason: declinedReason.trim(),
        reviewedById:   userId,
        reviewedAt:     new Date(),
      },
      include: {
        createdBy: { select: { id: true, name: true } },
        disbursedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    });
    if (tx.ftttProject.pmId) {
      await this.notifications.createForUser(tx.ftttProject.pmId, {
        title:   'FTTT — Financial Request Ditolak',
        message: `Financial Request "${tx.aktivitas}" untuk project ${tx.ftttProject.projectName ?? tx.ftttProject.id.slice(-6)} ditolak Finance. Alasan: ${declinedReason.trim()}`,
        type:    'FTTT_FINANCIAL_REQUEST_DECLINED',
        link:    `/fttt-projects/${tx.ftttProject.id}`,
        entityId: tx.ftttProject.id,
      });
    }
    return updated;
  }

  // Stage 2 / Stable v2: Tanggal Dana Keluar + multi Bukti Transfer → budget deducted immediately
  async disburseTransaction(
    txId: string,
    disbursedAtIso: string,
    userId: string,
    userRole: Role,
    files: Express.Multer.File[] = [],
  ) {
    if (userRole !== Role.FINANCE && userRole !== Role.GENERAL_MANAGER) {
      throw new ForbiddenException('Hanya Finance yang dapat mengisi Tanggal Dana Keluar');
    }
    const tx = await this.prisma.ftttTransaction.findUniqueOrThrow({ where: { id: txId } });
    if (tx.disbursedAt) {
      throw new BadRequestException('Transaksi ini sudah memiliki Tanggal Dana Keluar');
    }
    // Integra V1: the Financial Request must be Accepted by Finance before dana can
    // be released. Legacy transactions created before this workflow existed (no
    // `reason` captured) bypass this gate for backward compatibility.
    if (tx.reason && tx.requestStatus !== FtttRequestStatus.ACCEPTED) {
      throw new BadRequestException('Financial Request harus disetujui (Accepted) oleh Finance sebelum dana dapat dikeluarkan');
    }
    if (!files.length) {
      throw new BadRequestException('Upload Bukti Transfer wajib diisi minimal 1 file (JPG, JPEG, PNG, atau PDF)');
    }
    const allowedMime = new Set(['image/jpeg', 'image/jpg', 'image/png', 'application/pdf']);
    for (const file of files) {
      const mime = (file.mimetype || '').toLowerCase();
      const nameOk = /\.(jpe?g|png|pdf)$/i.test(file.originalname || '');
      if (!allowedMime.has(mime) && !nameOk) {
        throw new BadRequestException(`Bukti Transfer "${file.originalname}" harus berupa JPG, JPEG, PNG, atau PDF`);
      }
    }
    // Normalize to date-only start-of-day so budget is not delayed to noon
    const dateOnly = disbursedAtIso.slice(0, 10);
    const d = new Date(`${dateOnly}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
      throw new BadRequestException('Tanggal Dana Keluar tidak valid');
    }
    // Integra V10: backdate allowed; future capped at today+14
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + 14);
    maxDate.setHours(23, 59, 59, 999);
    if (d.getTime() > maxDate.getTime()) {
      throw new BadRequestException('Tanggal Dana Keluar maksimal 14 hari dari hari ini');
    }

    const uploaded: { fileUrl: string; originalFileName: string | null; mimeType: string | null; fileSize: number | null }[] = [];
    for (const file of files) {
      const fileUrl = await this.storage.uploadMulterFile(file, 'fttt-transfer', tx.ftttProjectId);
      uploaded.push({
        fileUrl,
        originalFileName: file.originalname || null,
        mimeType: file.mimetype || null,
        fileSize: file.size ?? null,
      });
    }
    const primaryUrl = uploaded[0].fileUrl;

    await this.prisma.ftttTransactionTransferProof.createMany({
      data: uploaded.map((u) => ({
        transactionId: txId,
        fileUrl: u.fileUrl,
        originalFileName: u.originalFileName,
        mimeType: u.mimeType,
        fileSize: u.fileSize,
        uploadedById: userId,
      })),
    });

    return this.prisma.ftttTransaction.update({
      where: { id: txId },
      data: {
        disbursedAt: d,
        disbursedById: userId,
        hasTransferProof: true,
        transferProofUrl: primaryUrl,
      },
      include: {
        createdBy: { select: { id: true, name: true } },
        disbursedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
        transferProofs: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  async deleteTransaction(txId: string, userId: string, userRole: Role) {
    const tx = await this.prisma.ftttTransaction.findUniqueOrThrow({ where: { id: txId } });
    if (tx.disbursedAt) {
      throw new BadRequestException('Transaksi yang sudah terealisasi (ada Tanggal Dana Keluar) tidak dapat dihapus');
    }
    if (userRole !== Role.PM_FTTT && userRole !== Role.GENERAL_MANAGER && userRole !== Role.ADMIN) {
      throw new ForbiddenException('Tidak berwenang menghapus transaksi');
    }
    return this.prisma.ftttTransaction.delete({ where: { id: txId } });
  }

  // ─── Stable v1: Approval Dana inbox ──────────────────────────────────────
  private assertFinanceInboxRole(userRole: Role) {
    if (userRole !== Role.FINANCE && userRole !== Role.GENERAL_MANAGER && userRole !== Role.ADMIN) {
      throw new ForbiddenException('Hanya Finance yang dapat mengakses Approval Dana');
    }
  }

  async listFinancialRequests(filter: FinancialRequestInboxFilterDtoType, userId: string, userRole: Role) {
    this.assertFinanceInboxRole(userRole);
    const page = filter.page ?? 1;
    const limit = filter.limit ?? 20;
    const search = filter.search?.trim();

    const and: Record<string, unknown>[] = [];

    if (filter.filter === 'pending') {
      and.push({ requestStatus: FtttRequestStatus.PENDING_REVIEW, disbursedAt: null });
    } else if (filter.filter === 'accepted') {
      and.push({ requestStatus: FtttRequestStatus.ACCEPTED, disbursedAt: null });
    } else if (filter.filter === 'disbursed') {
      and.push({ disbursedAt: { not: null } });
    } else if (filter.filter === 'declined') {
      and.push({ requestStatus: FtttRequestStatus.DECLINED });
    } else if (filter.filter === 'unread') {
      and.push({ fundRequestReads: { none: { userId } } });
    }

    if (search) {
      const q = search;
      const searchOr: Record<string, unknown>[] = [
        { aktivitas: { contains: q, mode: 'insensitive' } },
        { createdBy: { name: { contains: q, mode: 'insensitive' } } },
        { ftttProject: { projectName: { contains: q, mode: 'insensitive' } } },
        { ftttProject: { financeProject: { name: { contains: q, mode: 'insensitive' } } } },
        { ftttProject: { financeProject: { code: { contains: q, mode: 'insensitive' } } } },
        { ftttProject: { pm: { name: { contains: q, mode: 'insensitive' } } } },
      ];
      const catKey = q.toUpperCase().replace(/[\s-]+/g, '_');
      if (['PERIZINAN', 'MATERIAL', 'JASA', 'LAIN_LAIN'].includes(catKey)
        || ['PERIZINAN', 'MATERIAL', 'JASA', 'LAIN-LAIN'].includes(q.toUpperCase())) {
        const mapped = catKey === 'LAIN_LAIN' || q.toUpperCase().includes('LAIN') ? 'LAIN_LAIN'
          : catKey === 'PERIZINAN' || q.toUpperCase().includes('PERIZINAN') ? 'PERIZINAN'
          : catKey === 'MATERIAL' ? 'MATERIAL'
          : catKey === 'JASA' ? 'JASA' : null;
        if (mapped) searchOr.push({ category: mapped });
      }
      const digits = q.replace(/\D/g, '');
      if (digits && !Number.isNaN(Number(digits))) {
        searchOr.push({ total: Number(digits) });
      }
      and.push({ OR: searchOr });
    }

    const where = and.length > 0 ? { AND: and } : {};

    const [rows, total] = await Promise.all([
      this.prisma.ftttTransaction.findMany({
        where: where as never,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          createdBy: { select: { id: true, name: true } },
          reviewedBy: { select: { id: true, name: true } },
          disbursedBy: { select: { id: true, name: true } },
          fundRequestReads: { where: { userId }, select: { readAt: true }, take: 1 },
          ftttProject: {
            select: {
              id: true,
              projectName: true,
              currentPhase: true,
              pm: { select: { id: true, name: true } },
              financeProject: { select: { id: true, code: true, name: true, hierarchyLevel: true } },
              parent: { select: { id: true, projectName: true } },
            },
          },
        },
      }),
      this.prisma.ftttTransaction.count({ where: where as never }),
    ]);

    const CAT_LABEL: Record<string, string> = {
      PERIZINAN: 'Perizinan', MATERIAL: 'Material', JASA: 'Jasa', LAIN_LAIN: 'Lain-Lain',
    };

    const data = rows.map((t) => {
      const fp = t.ftttProject.financeProject;
      const siteName = fp?.name ?? t.ftttProject.projectName ?? t.ftttProject.id.slice(-6);
      const projectTitle = fp
        ? `${fp.code} · ${fp.name}`
        : (t.ftttProject.projectName ?? `Project ${t.ftttProject.id.slice(-6)}`);
      const pmName = t.ftttProject.pm?.name ?? t.createdBy?.name ?? 'PM';
      const jenis = CAT_LABEL[t.category] ?? t.category;
      const totalNum = Number(t.total);
      const isRead = (t.fundRequestReads?.length ?? 0) > 0;
      let inboxStatus: 'pending' | 'accepted' | 'disbursed' | 'declined' = 'pending';
      if (t.disbursedAt) inboxStatus = 'disbursed';
      else if (t.requestStatus === FtttRequestStatus.DECLINED) inboxStatus = 'declined';
      else if (t.requestStatus === FtttRequestStatus.ACCEPTED) inboxStatus = 'accepted';
      else inboxStatus = 'pending';

      return {
        id: t.id,
        category: t.category,
        aktivitas: t.aktivitas,
        total: t.total,
        remarks: t.remarks,
        createdAt: t.createdAt,
        expectedNeedDate: t.expectedNeedDate,
        requestStatus: t.requestStatus,
        scheduledReleaseAt: t.scheduledReleaseAt,
        declinedReason: t.declinedReason,
        disbursedAt: t.disbursedAt,
        hasTransferProof: t.hasTransferProof,
        transferProofUrl: t.transferProofUrl,
        inboxStatus,
        isRead,
        title: projectTitle,
        description: `Pengajuan dana ${jenis} dari ${pmName} sebesar Rp ${Math.round(totalNum).toLocaleString('id-ID')}`,
        meta: {
          phase: PHASE_LABELS[t.ftttProject.currentPhase] ?? t.ftttProject.currentPhase,
          site: siteName,
          pmName,
          parentName: t.ftttProject.parent?.projectName ?? null,
        },
        projectId: t.ftttProject.id,
        link: `/fttt-projects/${t.ftttProject.id}?tx=${t.id}`,
        createdBy: t.createdBy,
        reviewedBy: t.reviewedBy,
        disbursedBy: t.disbursedBy,
      };
    });

    return paginate(data, total, page, limit);
  }

  async financialRequestInboxCount(userId: string, userRole: Role) {
    this.assertFinanceInboxRole(userRole);
    const count = await this.prisma.ftttTransaction.count({
      where: {
        requestStatus: FtttRequestStatus.PENDING_REVIEW,
        fundRequestReads: { none: { userId } },
      },
    });
    return { count };
  }

  async markFinancialRequestRead(txId: string, userId: string, userRole: Role) {
    this.assertFinanceInboxRole(userRole);
    await this.prisma.ftttTransaction.findUniqueOrThrow({ where: { id: txId }, select: { id: true } });
    await this.prisma.ftttFundRequestRead.upsert({
      where: { userId_transactionId: { userId, transactionId: txId } },
      create: { userId, transactionId: txId },
      update: { readAt: new Date() },
    });
    return { success: true };
  }

  // ─── JLM: Budget summary + Cost/Progress S-Curve for a linked FTTT project ───
  async getBudgetScurve(projectId: string) {
    const project = await this.prisma.ftttProject.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        financeProject: {
          select: {
            id: true, code: true, name: true, totalBudget: true,
            budgetPerizinan: true, materialBudget: true, jasaBudget: true, budgetLainLain: true,
            createdAt: true, endDate: true,
            hierarchyLevel: true, parentId: true,
          },
        },
        transactions: { orderBy: { createdAt: 'asc' }, include: { createdBy: { select: { id: true, name: true } }, disbursedBy: { select: { id: true, name: true } }, transferProofs: { orderBy: { createdAt: 'asc' } } } },
        phaseProgresses: true,
        // Integra V6: Actual Progress from implementation meters (Daily Log / Log Aktivitas)
        implementationLogs: { select: { meterDone: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
        spans: { select: { lengthMeters: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
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

    // Integra V4: Lain-Lain (Overhead) is owned by Segment (Parent) — Sites inherit live budget + pool spent
    let segmentLainLainId: string | null = null;
    if (fp?.hierarchyLevel === 'SITE' && fp.parentId) {
      const parent = await this.prisma.financeProject.findUnique({
        where: { id: fp.parentId },
        select: { id: true, budgetLainLain: true },
      });
      if (parent) {
        budgets.LAIN_LAIN = num(parent.budgetLainLain);
        segmentLainLainId = parent.id;
      }
    } else if (fp?.hierarchyLevel === 'SEGMENT') {
      segmentLainLainId = fp.id;
    }

    const totalBudget = num(fp?.totalBudget) || (budgets.PERIZINAN + budgets.MATERIAL + budgets.JASA + budgets.LAIN_LAIN);

    // Stable v1: any disbursed transaction counts as spent immediately (no noon / future hold)
    const realized = project.transactions.filter((t) => t.disbursedAt != null);
    const spent = { PERIZINAN: 0, MATERIAL: 0, JASA: 0, LAIN_LAIN: 0 } as Record<string, number>;
    for (const t of realized) {
      if (t.category === 'LAIN_LAIN' && segmentLainLainId) continue; // filled from segment pool below
      spent[t.category] += num(t.total);
    }
    if (segmentLainLainId) {
      const lainAgg = await this.prisma.ftttTransaction.aggregate({
        where: {
          financeProjectId: segmentLainLainId,
          category: 'LAIN_LAIN',
          disbursedAt: { not: null },
        },
        _sum: { total: true },
      });
      spent.LAIN_LAIN = num(lainAgg._sum.total);
    }
    const totalSpent = spent.PERIZINAN + spent.MATERIAL + spent.JASA + spent.LAIN_LAIN;

    // Finance-owned milestones: BASELINE (Planning Awal) + CURRENT (Perubahan Planning)
    const allMilestones = fp
      ? await this.prisma.ftttMilestone.findMany({ where: { financeProjectId: fp.id }, orderBy: { targetDate: 'asc' } })
      : [];
    const toMs = (rows: typeof allMilestones) =>
      rows
        .map((mm) => ({ t: new Date(mm.targetDate).getTime(), budget: num(mm.plannedBudget), pct: num(mm.plannedProgressPct) }))
        .sort((a, b) => a.t - b.t);
    const currentMs = toMs(allMilestones.filter((m) => (m as { kind?: string }).kind === 'CURRENT'));
    const baselineMsRaw = toMs(allMilestones.filter((m) => (m as { kind?: string }).kind === 'BASELINE'));
    // Plan Awal = BASELINE; Perubahan Planning only after a real Edit Planning (CURRENT differs from BASELINE)
    const baselineMs = baselineMsRaw.length > 0 ? baselineMsRaw : currentMs;
    const hasBaseline = baselineMs.length > 0;
    const msEqual = (a: typeof baselineMs, b: typeof currentMs) => {
      if (a.length !== b.length) return false;
      return a.every((x, i) => x.t === b[i].t && x.budget === b[i].budget && x.pct === b[i].pct);
    };
    const hasRevision = baselineMsRaw.length > 0 && currentMs.length > 0 && !msEqual(baselineMsRaw, currentMs);
    const revisedMs = hasRevision ? currentMs : baselineMs;
    const hasRevised = hasRevision;
    // Horizon follows the latest active planning milestone (BASELINE and/or CURRENT),
    // not a hard cap on financeProject.endDate — Edit Planning can extend past Plan Awal.
    const lastBaselineT = baselineMs.length ? baselineMs[baselineMs.length - 1].t : 0;
    const lastCurrentT = currentMs.length ? currentMs[currentMs.length - 1].t : 0;
    const lastMsT = Math.max(lastBaselineT, lastCurrentT);
    const lastTx = realized.length
      ? new Date(realized[realized.length - 1].disbursedAt ?? realized[realized.length - 1].createdAt)
      : null;
    // Integra V1: the S-Curve now starts at the earliest planning milestone (BASELINE
    // or CURRENT) instead of the project's createdAt, so the curve reflects the actual
    // planned start of work; falls back to createdAt when no milestones exist yet.
    const earliestMilestoneT = allMilestones.length ? new Date(allMilestones[0].targetDate).getTime() : null;
    const start = earliestMilestoneT != null
      ? new Date(earliestMilestoneT)
      : new Date(fp?.createdAt ?? project.createdAt);
    const endCandidates = [
      lastMsT,
      lastTx?.getTime() ?? 0,
      fp?.endDate ? new Date(fp.endDate).getTime() : 0,
    ].filter((t) => t > 0);
    const end = endCandidates.length
      ? new Date(Math.max(...endCandidates))
      : new Date(start.getFullYear(), start.getMonth() + 3, 1);
    const horizon = end.getTime() >= start.getTime() ? end : new Date(start.getFullYear(), start.getMonth() + 1, 1);
    const horizonT = horizon.getTime();
    const months: { name: string; year: number; month: number }[] = [];
    const cur = new Date(start.getFullYear(), start.getMonth(), 1);
    const stop = new Date(horizon.getFullYear(), horizon.getMonth(), 1);
    while (cur <= stop && months.length < 60) {
      months.push({ name: `${cur.getMonth() + 1}/${cur.getFullYear()}`, year: cur.getFullYear(), month: cur.getMonth() + 1 });
      cur.setMonth(cur.getMonth() + 1);
    }
    const endOfMonth = (m: { year: number; month: number }) => new Date(m.year, m.month, 0, 23, 59, 59).getTime();

    const planPhases = project.phaseProgresses.filter((p) => p.status !== 'SKIPPED');
    const phaseW = 100 / Math.max(1, planPhases.length);

    const interp = (ms: { t: number; budget: number; pct: number }[], x: number, key: 'budget' | 'pct'): number => {
      if (!ms.length) return 0;
      if (x >= ms[ms.length - 1].t) return ms[ms.length - 1][key];
      const startT = start.getTime();
      if (x <= ms[0].t) {
        if (x <= startT || ms[0].t <= startT) return x >= ms[0].t ? ms[0][key] : 0;
        return ms[0][key] * Math.max(0, Math.min(1, (x - startT) / (ms[0].t - startT)));
      }
      for (let i = 1; i < ms.length; i++) {
        if (x <= ms[i].t) {
          const a = ms[i - 1], b = ms[i];
          const frac = (x - a.t) / (b.t - a.t || 1);
          return a[key] + (b[key] - a[key]) * frac;
        }
      }
      return ms[ms.length - 1][key];
    };

    type Bucket = { name: string; end: number };
    const monthlyBuckets: Bucket[] = months.map((m) => ({ name: m.name, end: endOfMonth(m) }));
    // Weekly ticks only through the week that contains the horizon (no empty trailing weeks)
    const weeklyBuckets: Bucket[] = months.flatMap((m) => {
      const eom = endOfMonth(m);
      const weeks: { name: string; end: number; startDay: number }[] = [
        { name: `${m.name} W1`, end: new Date(m.year, m.month - 1, 7, 23, 59, 59).getTime(), startDay: 1 },
        { name: `${m.name} W2`, end: new Date(m.year, m.month - 1, 14, 23, 59, 59).getTime(), startDay: 8 },
        { name: `${m.name} W3`, end: new Date(m.year, m.month - 1, 21, 23, 59, 59).getTime(), startDay: 15 },
        { name: `${m.name} W4`, end: eom, startDay: 22 },
      ];
      return weeks
        .filter((w) => new Date(m.year, m.month - 1, w.startDay).getTime() <= horizonT)
        .map(({ name, end: weekEnd }) => ({ name, end: weekEnd }));
    });

    // Integra V6: Actual Cost from disbursed Transaction Log (Tanggal Dana Keluar).
    // Exclude Site-owned LAIN_LAIN when Segment owns the Lain-Lain pool (avoid double-count).
    const siteTxPoints = realized
      .filter((t) => !(t.category === 'LAIN_LAIN' && segmentLainLainId))
      .map((t) => ({ t: new Date(t.disbursedAt ?? t.createdAt).getTime(), v: num(t.total) }));
    let segmentLainPoints: { t: number; v: number }[] = [];
    if (segmentLainLainId) {
      const lainRows = await this.prisma.ftttTransaction.findMany({
        where: {
          financeProjectId: segmentLainLainId,
          category: 'LAIN_LAIN',
          disbursedAt: { not: null },
        },
        select: { disbursedAt: true, createdAt: true, total: true },
      });
      segmentLainPoints = lainRows.map((t) => ({
        t: new Date(t.disbursedAt ?? t.createdAt).getTime(),
        v: num(t.total),
      }));
    }
    const txPoints = [...siteTxPoints, ...segmentLainPoints].sort((a, b) => a.t - b.t);

    // Integra V6: Actual Progress from implementation meters (same source as Overview Progress %)
    const totalPanjang = num(project.totalPanjangMeter);
    const meterFromActivity = (project.implementationLogs ?? [])
      .map((l) => ({ t: new Date(l.createdAt).getTime(), v: num(l.meterDone) }))
      .filter((p) => p.v > 0);
    const meterFromSpans = (project.spans ?? [])
      .map((s) => ({ t: new Date(s.createdAt).getTime(), v: num(s.lengthMeters) }))
      .filter((p) => p.v > 0);
    const meterPoints = (meterFromActivity.length > 0 ? meterFromActivity : meterFromSpans)
      .sort((a, b) => a.t - b.t);
    const useMeterProgress = totalPanjang > 0 && meterPoints.length > 0;
    const now = Date.now();

    const buildCurves = (buckets: Bucket[]) => {
      const cost: {
        name: string;
        baselineCost: number;
        plannedCost: number;
        actualCost: number | null;
      }[] = [];
      const prog: {
        name: string;
        baselineProgress: number;
        plannedProgress: number;
        actualProgress: number | null;
      }[] = [];
      const n = Math.max(1, buckets.length);
      let cumActual = 0;
      let ptr = 0;
      let cumMeters = 0;
      let meterPtr = 0;
      let lastActualCost = 0;
      let lastActualProg = 0;
      for (let i = 0; i < buckets.length; i++) {
        const b = buckets[i];
        // Planning lines always shown for full project horizon
        const baselineProgress = hasBaseline ? interp(baselineMs, b.end, 'pct') : Math.min(100, ((i + 1) / n) * 100);
        const plannedProgress = hasRevised ? interp(revisedMs, b.end, 'pct') : baselineProgress;
        const baselineCost = hasBaseline ? interp(baselineMs, b.end, 'budget') : (totalBudget * baselineProgress) / 100;
        const plannedCost = hasRevised ? interp(revisedMs, b.end, 'budget') : baselineCost;

        // Integra V6: include the current incomplete period (bucket end may still be in the future).
        // Only omit Actual for periods that have not started yet.
        const periodStart = i === 0 ? start.getTime() : buckets[i - 1].end;
        if (periodStart <= now) {
          const cutoff = Math.min(b.end, now);
          while (ptr < txPoints.length && txPoints[ptr].t <= cutoff) {
            cumActual += txPoints[ptr].v;
            ptr++;
          }
          lastActualCost = cumActual;
          if (useMeterProgress) {
            while (meterPtr < meterPoints.length && meterPoints[meterPtr].t <= cutoff) {
              cumMeters += meterPoints[meterPtr].v;
              meterPtr++;
            }
            lastActualProg = Math.min(100, (cumMeters / totalPanjang) * 100);
          } else {
            lastActualProg = planPhases.filter((p) => p.completedAt && new Date(p.completedAt).getTime() <= cutoff).length * phaseW;
          }
          cost.push({
            name: b.name,
            baselineCost: Math.round(baselineCost),
            plannedCost: Math.round(plannedCost),
            actualCost: Math.round(lastActualCost),
          });
          prog.push({
            name: b.name,
            baselineProgress: Math.round(baselineProgress),
            plannedProgress: Math.round(plannedProgress),
            actualProgress: Math.round(Math.min(100, lastActualProg)),
          });
        } else {
          // Future periods: planning continues; Actual is null so the line does not project forward
          cost.push({
            name: b.name,
            baselineCost: Math.round(baselineCost),
            plannedCost: Math.round(plannedCost),
            actualCost: null,
          });
          prog.push({
            name: b.name,
            baselineProgress: Math.round(baselineProgress),
            plannedProgress: Math.round(plannedProgress),
            actualProgress: null,
          });
        }
      }
      return { cost, prog };
    };
    const monthly = buildCurves(monthlyBuckets);
    const weekly = buildCurves(weeklyBuckets);

    return {
      financeProject: fp,
      ftttProject: { id: project.id, name: project.projectName, currentPhase: project.currentPhase },
      totalBudget,
      totalSpent,
      remaining: totalBudget - totalSpent,
      byCategory: (['PERIZINAN', 'MATERIAL', 'JASA', 'LAIN_LAIN'] as const).map((c) => ({
        category: c, budget: budgets[c], spent: spent[c], remaining: budgets[c] - spent[c],
      })),
      costCurve: monthly.cost,
      progressCurve: monthly.prog,
      costCurveWeekly: weekly.cost,
      progressCurveWeekly: weekly.prog,
      // v3: Perubahan Planning line only after Edit Planning (hasRevision)
      hasBaseline,
      hasRevision,
      phasePlan: planPhases.map((p) => ({
        phase: p.phase,
        status: p.status,
        completedAt: p.completedAt,
        plannedEndDate: (p as typeof p & { plannedEndDate: Date | null }).plannedEndDate ?? null,
        weight: (p as typeof p & { weight: unknown }).weight ?? null,
      })),
      transactions: project.transactions.map((t) => ({
        id: t.id, category: t.category, aktivitas: t.aktivitas, uom: t.uom,
        qty: t.qty, price: t.price, total: t.total, remarks: t.remarks,
        createdAt: t.createdAt,
        createdPhase: (t as typeof t & { createdPhase?: string }).createdPhase ?? null,
        disbursedAt: t.disbursedAt,
        hasTransferProof: (t as typeof t & { hasTransferProof?: boolean }).hasTransferProof ?? false,
        transferProofUrl: (t as typeof t & { transferProofUrl?: string | null }).transferProofUrl ?? null,
        transferProofs: (t as typeof t & { transferProofs?: { id: string; fileUrl: string; originalFileName: string | null }[] }).transferProofs ?? [],
        createdBy: (t as typeof t & { createdBy?: { name: string } }).createdBy ?? null,
        disbursedBy: (t as typeof t & { disbursedBy?: { name: string } | null }).disbursedBy ?? null,
      })),
    };
  }

  // JLM: set per-phase planned timeline (Admin / PM FTTT)
  async setPhasePlan(projectId: string, dto: SetPhasePlanDtoType, userId: string, userRole: Role) {
    const allowed: Role[] = [Role.ADMIN, Role.GENERAL_MANAGER, Role.PM_FTTT];
    if (!allowed.includes(userRole)) {
      throw new ForbiddenException('Hanya Admin atau PM FTTT yang dapat mengatur timeline fase');
    }
    for (const p of dto.plans) {
      await this.prisma.ftttPhaseProgress.updateMany({
        where: { projectId, phase: p.phase as FtttPhase },
        data: {
          plannedEndDate: p.plannedEndDate ? new Date(p.plannedEndDate) : null,
          weight: p.weight != null ? p.weight.toString() : null,
        },
      });
    }
    return this.getBudgetScurve(projectId);
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
      'INVOICE_IFORTE',                                  // iFORTE Closing — Finance uploads Invoice
    ]);
    // PST Procurement PO — Finance only
    const isPoProcurement = dto.docKey === 'PO_PROCUREMENT';
    if (FINANCE_ONLY_DOCS.has(dto.docKey) || isPoProcurement) {
      if (userRole !== Role.FINANCE && userRole !== Role.GENERAL_MANAGER) {
        throw new ForbiddenException('Hanya Finance yang dapat mengunggah dokumen ini');
      }
    } else if (dto.docKey === 'SUPPORTING_DOC_IFORTE') {
      // iFORTE Project Preparation: hanya Admin Project yang boleh upload
      if (userRole !== Role.ADMIN && userRole !== Role.GENERAL_MANAGER) {
        throw new ForbiddenException('Hanya Admin Project yang dapat mengunggah Supporting Document');
      }
    } else {
      // Recon docs: Admin/GM; Surveyor/PM for some iFORTE flows
      const allowed: Role[] = [Role.ADMIN, Role.GENERAL_MANAGER, Role.FINANCE, Role.SURVEYOR_FTTT, Role.PM_FTTT];
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

  // ─── Integra V1: choose Metode Implementasi (Galian → span-based Daily Log; KU → existing) — all companies ──
  async setImplementationType(id: string, type: 'GALIAN' | 'KU', userId: string, userRole: Role) {
    if (userRole !== Role.ADMIN && userRole !== Role.GENERAL_MANAGER) {
      throw new ForbiddenException('Hanya Admin Project yang dapat menentukan metode implementasi');
    }
    const project = await this.prisma.ftttProject.findUniqueOrThrow({ where: { id } });
    // Integra V1: Metode Implementasi (Galian / KU) generalized for ALL companies
    // (was PST-only) — method-first daily logging
    if (project.currentPhase !== FtttPhase.IMPLEMENTATION) {
      throw new BadRequestException('Metode implementasi hanya dapat dipilih pada fase Implementation');
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
