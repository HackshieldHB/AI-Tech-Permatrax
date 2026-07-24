import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DailyActivity, DailyActivityWorkStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailQueueService } from '../mail/mail-queue.service';
import { paginate, PaginatedResponse } from '../common/dto/pagination.dto';
import type { AuthUser } from '../auth/types/auth-user.types';
import type {
  CreateDailyActivityAutoParams,
  FilterDailyActivityDtoType,
  UpdateDailyActivityDtoType,
} from './daily-activity.dto';

const REMINDER_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // every 60 minutes
const OVERDUE_GRACE_MS = 3 * 24 * 60 * 60 * 1000; // targetDoneAt + 3 days
const REMINDER_COOLDOWN_MS = 60 * 60 * 1000; // don't re-notify within 1 hour

/**
 * Integra V9: any role with Daily Activity manage access may update status on any
 * project activity (not only the original creator). Matches DAILY_ACTIVITY_MANAGE.
 */
const TEAM_MANAGE_ROLES: Role[] = [
  Role.GENERAL_MANAGER,
  Role.ADMIN,
  Role.PM_SENIOR,
  Role.PM_FTTT,
  Role.FINANCE,
  Role.SURVEYOR_FTTT,
];

const includeRelations = {
  actor: { select: { id: true, name: true, email: true } },
  updatedBy: { select: { id: true, name: true, email: true } },
  financeProject: { select: { id: true, code: true, name: true } },
  ftttProject: { select: { id: true, projectName: true, ftttCompany: true } },
  _count: { select: { evidences: true, history: true } },
} satisfies Prisma.DailyActivityInclude;

/** Full detail (used by GET :id) — includes ordered evidence + history lists with actor info. */
const includeDetail = {
  actor: { select: { id: true, name: true, email: true } },
  updatedBy: { select: { id: true, name: true, email: true } },
  financeProject: { select: { id: true, code: true, name: true } },
  ftttProject: { select: { id: true, projectName: true, ftttCompany: true } },
  evidences: {
    orderBy: { createdAt: 'asc' },
    include: { uploadedBy: { select: { id: true, name: true, email: true } } },
  },
  history: {
    orderBy: { createdAt: 'desc' },
    include: { changedBy: { select: { id: true, name: true, email: true } } },
  },
  _count: { select: { evidences: true, history: true } },
} satisfies Prisma.DailyActivityInclude;

type DailyActivityWithRelations = Prisma.DailyActivityGetPayload<{ include: typeof includeRelations }>;
type DailyActivityDetail = Prisma.DailyActivityGetPayload<{ include: typeof includeDetail }>;

export interface EvidenceFileInput {
  fileUrl: string;
  originalFileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
}

@Injectable()
export class DailyActivityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DailyActivityService.name);
  private reminderTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailQueue: MailQueueService,
  ) {}

  onModuleInit() {
    // Simple interval-based sweep — no @nestjs/schedule dependency in this codebase.
    this.reminderTimer = setInterval(() => {
      this.runReminderSweep().catch((err) =>
        this.logger.error(`Reminder sweep gagal: ${err?.message}`, err?.stack),
      );
    }, REMINDER_SWEEP_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.reminderTimer) clearInterval(this.reminderTimer);
  }

  /** Used by other services (e.g. FTTT implementation logs) to auto-record a Daily Activity row. */
  async createAuto(params: CreateDailyActivityAutoParams): Promise<DailyActivity> {
    const workStatus = params.workStatus ?? DailyActivityWorkStatus.ON_PROGRESS;
    return this.prisma.$transaction(async (tx) => {
      const activity = await tx.dailyActivity.create({
        data: {
          actorId: params.actorId,
          scopeOfWork: params.scopeOfWork,
          financeProjectId: params.financeProjectId ?? null,
          ftttProjectId: params.ftttProjectId ?? null,
          siteName: params.siteName ?? null,
          workStatus,
          targetDoneAt: params.targetDoneAt ?? null,
          remarks: params.remarks ?? null,
          evidenceUrl: params.evidenceUrl ?? null,
        },
      });

      // Seed an initial history row so "Riwayat Update" reflects the auto-logged origin state.
      await tx.dailyActivityHistory.create({
        data: {
          activityId: activity.id,
          workStatus,
          remarks: params.remarks ?? null,
          targetDoneAt: params.targetDoneAt ?? null,
          changedById: params.actorId,
        },
      });

      return activity;
    });
  }

  async findAll(filter: FilterDailyActivityDtoType): Promise<PaginatedResponse<DailyActivityWithRelations>> {
    const where: Prisma.DailyActivityWhereInput = {};

    if (filter.workStatus) where.workStatus = filter.workStatus;
    if (filter.ftttProjectId) where.ftttProjectId = filter.ftttProjectId;
    if (filter.financeProjectId) where.financeProjectId = filter.financeProjectId;

    if (filter.search?.trim()) {
      const q = filter.search.trim();
      where.OR = [
        { scopeOfWork: { contains: q, mode: 'insensitive' } },
        { siteName: { contains: q, mode: 'insensitive' } },
        { remarks: { contains: q, mode: 'insensitive' } },
        { actor: { name: { contains: q, mode: 'insensitive' } } },
        { updatedBy: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.dailyActivity.findMany({
        where,
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
        orderBy: { timestamp: 'desc' },
        include: includeRelations,
      }),
      this.prisma.dailyActivity.count({ where }),
    ]);

    return paginate(items, total, filter.page, filter.limit);
  }

  async findOne(id: string): Promise<DailyActivityDetail> {
    const row = await this.prisma.dailyActivity.findUnique({
      where: { id },
      include: includeDetail,
    });
    if (!row) throw new NotFoundException('Daily Activity tidak ditemukan');
    return row;
  }

  async update(
    id: string,
    dto: UpdateDailyActivityDtoType,
    user: AuthUser,
  ): Promise<DailyActivityWithRelations> {
    const existing = await this.prisma.dailyActivity.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Daily Activity tidak ditemukan');
    this.assertCanManage(existing, user);

    const nextStatus = dto.workStatus ?? existing.workStatus;
    const nextTargetDoneAt = dto.targetDoneAt !== undefined ? dto.targetDoneAt : existing.targetDoneAt;
    const nextRemarks = dto.remarks !== undefined ? dto.remarks : existing.remarks;

    if (nextStatus === DailyActivityWorkStatus.ON_PROGRESS && !nextTargetDoneAt) {
      throw new BadRequestException('Target selesai (targetDoneAt) wajib diisi untuk status ON_PROGRESS');
    }
    if (nextStatus === DailyActivityWorkStatus.ON_HOLD) {
      if (!nextTargetDoneAt) {
        throw new BadRequestException('Target selesai (targetDoneAt) wajib diisi untuk status ON_HOLD');
      }
      if (!nextRemarks?.trim()) {
        throw new BadRequestException('Keterangan (remarks) wajib diisi untuk status ON_HOLD');
      }
    }

    const data: Prisma.DailyActivityUpdateInput = {
      // Integra V9: bump list timestamp + record who last updated status
      timestamp: new Date(),
      updatedBy: { connect: { id: user.userId } },
    };
    if (dto.workStatus) data.workStatus = dto.workStatus;
    if (dto.targetDoneAt !== undefined) data.targetDoneAt = dto.targetDoneAt;
    if (dto.remarks !== undefined) data.remarks = dto.remarks;
    if (dto.evidenceUrl !== undefined) data.evidenceUrl = dto.evidenceUrl;

    if (nextStatus === DailyActivityWorkStatus.DONE) {
      // DONE clears monitoring — no more overdue reminders needed for this record.
      data.targetDoneAt = null;
      data.lastReminderAt = null;
    }

    const [, updated] = await this.prisma.$transaction([
      this.prisma.dailyActivityHistory.create({
        data: {
          activityId: id,
          workStatus: nextStatus,
          remarks: nextRemarks ?? null,
          targetDoneAt: nextStatus === DailyActivityWorkStatus.DONE ? null : (nextTargetDoneAt ?? null),
          changedById: user.userId,
        },
      }),
      this.prisma.dailyActivity.update({
        where: { id },
        data,
        include: includeRelations,
      }),
    ]);

    return updated;
  }

  /** Multi-file "Bukti Pekerjaan" upload — creates one DailyActivityEvidence row per file and
   * keeps the legacy `evidenceUrl` column synced to the most recently uploaded file for back-compat. */
  async addEvidenceFiles(
    id: string,
    files: EvidenceFileInput[],
    user: AuthUser,
  ): Promise<DailyActivityDetail> {
    const existing = await this.prisma.dailyActivity.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Daily Activity tidak ditemukan');
    this.assertCanManage(existing, user);
    if (!files.length) throw new BadRequestException('Minimal satu file evidence wajib diunggah');

    await this.prisma.$transaction([
      this.prisma.dailyActivityEvidence.createMany({
        data: files.map((f) => ({
          activityId: id,
          fileUrl: f.fileUrl,
          originalFileName: f.originalFileName ?? null,
          mimeType: f.mimeType ?? null,
          fileSize: f.fileSize ?? null,
          uploadedById: user.userId,
        })),
      }),
      this.prisma.dailyActivity.update({
        where: { id },
        data: {
          evidenceUrl: files[files.length - 1].fileUrl,
          timestamp: new Date(),
          updatedBy: { connect: { id: user.userId } },
        },
      }),
    ]);

    return this.findOne(id);
  }

  private assertCanManage(_activity: DailyActivity, user: AuthUser): void {
    // Integra V9: project team members with manage permission can Update Status
    // for any Daily Activity (progress monitoring is shared across the project).
    if (TEAM_MANAGE_ROLES.includes(user.role)) return;
    throw new ForbiddenException('Anda tidak memiliki akses untuk mengubah Daily Activity');
  }

  // ─── Reminder sweep ─────────────────────────────────────────────────────

  private async runReminderSweep(): Promise<void> {
    const now = new Date();
    const overdueBefore = new Date(now.getTime() - OVERDUE_GRACE_MS);

    const candidates = await this.prisma.dailyActivity.findMany({
      where: {
        workStatus: { in: [DailyActivityWorkStatus.ON_PROGRESS, DailyActivityWorkStatus.ON_HOLD] },
        targetDoneAt: { not: null, lt: overdueBefore },
      },
      include: { actor: { select: { id: true, name: true, email: true } } },
    });

    if (candidates.length === 0) return;

    for (const activity of candidates) {
      try {
        await this.maybeSendReminder(activity, now);
      } catch (err: any) {
        this.logger.error(`Gagal kirim reminder untuk Daily Activity ${activity.id}: ${err?.message}`);
      }
    }
  }

  private async maybeSendReminder(
    activity: DailyActivity & { actor: { id: string; name: string; email: string } },
    now: Date,
  ): Promise<void> {
    if (!activity.targetDoneAt) return;

    // Skip if a fresher log already exists for the same project after the missed deadline —
    // it means the work has since been re-reported and this stale row shouldn't nag again.
    if (activity.ftttProjectId || activity.financeProjectId) {
      const newerCount = await this.prisma.dailyActivity.count({
        where: {
          id: { not: activity.id },
          timestamp: { gt: activity.targetDoneAt },
          ...(activity.ftttProjectId ? { ftttProjectId: activity.ftttProjectId } : {}),
          ...(activity.financeProjectId ? { financeProjectId: activity.financeProjectId } : {}),
        },
      });
      if (newerCount > 0) return;
    }

    const lastSentAt = activity.lastReminderAt ? activity.lastReminderAt.getTime() : null;
    if (lastSentAt !== null && now.getTime() - lastSentAt < REMINDER_COOLDOWN_MS) return;

    if (!activity.actor?.email) return;

    const overdueDays = Math.max(1, Math.floor((now.getTime() - activity.targetDoneAt.getTime()) / 86400000));

    await this.mailQueue.enqueue({
      mailOptions: {
        to: activity.actor.email,
        subject: `[PermaTrax] Pengingat: Pekerjaan Terlambat — ${activity.siteName || activity.scopeOfWork}`,
        html: `
          <p>Halo ${activity.actor.name},</p>
          <p>Aktivitas berikut telah melewati target selesai selama <b>${overdueDays} hari</b>:</p>
          <ul>
            <li><b>Site/Proyek:</b> ${activity.siteName || '-'}</li>
            <li><b>Scope of Work:</b> ${activity.scopeOfWork}</li>
            <li><b>Status:</b> ${activity.workStatus}</li>
            <li><b>Target Selesai:</b> ${activity.targetDoneAt.toLocaleDateString('id-ID')}</li>
          </ul>
          <p>Mohon segera update status pekerjaan pada modul Daily Activity di PermaTrax.</p>
        `,
      },
    });

    await this.prisma.dailyActivity.update({
      where: { id: activity.id },
      data: { lastReminderAt: now },
    });
  }
}
