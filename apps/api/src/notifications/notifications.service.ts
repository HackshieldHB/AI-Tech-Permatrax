import { Injectable, NotFoundException } from '@nestjs/common';
import { Notification, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';

export type NotificationPayload = {
  title: string;
  message: string;
  type?: string;
  link?: string;
  entityId?: string;
};

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
  ) {}

  /** FIX: single user + realtime socket */
  async createForUser(userId: string, data: NotificationPayload) {
    const row = await this.prisma.notification.create({
      data: {
        userId,
        title: data.title,
        message: data.message,
        type: data.type ?? 'GENERAL',
        link: data.link ?? null,
        entityId: data.entityId ?? null,
      },
    });
    this.gateway.emitToRoom(`user:${userId}`, 'notification:new', {
      id: row.id,
      title: row.title,
      message: row.message,
      type: row.type,
      link: row.link,
      entityId: row.entityId,
      isRead: row.isRead,
      createdAt: row.createdAt,
    });
    return row;
  }

  /** FIX: fan-out per role — batch DB + satu emit ke room role (Sprint 2) */
  async createForRole(role: Role | string, data: NotificationPayload): Promise<Notification[]> {
    const users = await this.prisma.user.findMany({
      where: { role: role as Role, isActive: true },
      select: { id: true },
    });
    if (!users.length) return [];

    const insert = users.map((u) => ({
      userId: u.id,
      title: data.title,
      message: data.message,
      type: data.type ?? 'GENERAL',
      link: data.link ?? null,
      entityId: data.entityId ?? null,
    }));

    const created = await this.prisma.notification.createManyAndReturn({
      data: insert,
    });

    const roleKey = typeof role === 'string' ? role : String(role);
    this.gateway.emitToRoom(`role:${roleKey}`, 'notification:new', {
      title: data.title,
      message: data.message,
      type: data.type ?? 'GENERAL',
      link: data.link ?? null,
      entityId: data.entityId ?? null,
      count: created.length,
    });

    return created;
  }

  /** FIX: multiple roles (e.g. PM + PM_SENIOR) */
  async createForRoles(roles: (Role | string)[], data: NotificationPayload): Promise<Notification[]> {
    const out: Notification[] = [];
    for (const r of roles) {
      out.push(...(await this.createForRole(r, data)));
    }
    return out;
  }

  /** FIX: broadcast ke semua user aktif — batch insert + satu emit global */
  async createForAllUsers(data: NotificationPayload): Promise<Notification[]> {
    const users = await this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    if (!users.length) return [];

    const CHUNK = 200;
    const all: Notification[] = [];
    for (let i = 0; i < users.length; i += CHUNK) {
      const slice = users.slice(i, i + CHUNK);
      const insert = slice.map((u) => ({
        userId: u.id,
        title: data.title,
        message: data.message,
        type: data.type ?? 'GENERAL',
        link: data.link ?? null,
        entityId: data.entityId ?? null,
      }));
      const part = await this.prisma.notification.createManyAndReturn({ data: insert });
      all.push(...part);
    }

    this.gateway.emitToAll('notification:new', {
      title: data.title,
      message: data.message,
      type: data.type ?? 'GENERAL',
      link: data.link ?? null,
      entityId: data.entityId ?? null,
      count: all.length,
    });

    return all;
  }

  /** FIX: legacy name used by cash-operation submit */
  async notifyUsersByRole(role: Role, dto: { title: string; message: string; link?: string; type?: string; entityId?: string }) {
    const n = await this.createForRole(role, {
      title: dto.title,
      message: dto.message,
      link: dto.link,
      type: dto.type ?? 'CASH_OPERATION',
      entityId: dto.entityId,
    });
    return n.length;
  }

  /** Socket.IO fanout without persisting Notification row (M5 cash-op realisasi). */
  emitRealtime(room: string, event: string, payload: unknown): void {
    this.gateway.emitToRoom(room, event, payload);
  }

  /** FIX: inbox = rows for user + optional role-targeted rows */
  async findForUser(userId: string, options: { limit?: number; unreadOnly?: boolean } = {}) {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const unreadOnly = options.unreadOnly === true;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    const where: Prisma.NotificationWhereInput = {
      OR: [{ userId }, ...(user?.role ? [{ userRole: user.role as string }] : [])],
      ...(unreadOnly ? { isRead: false } : {}),
    };

    const [notifications, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.notification.count({
        where: { ...where, isRead: false },
      }),
    ]);

    return { notifications, unreadCount };
  }

  async markAsRead(id: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const row = await this.prisma.notification.findFirst({
      where: {
        id,
        OR: [{ userId }, ...(user?.role ? [{ userRole: user.role }] : [])],
      },
    });
    if (!row) throw new NotFoundException('Notifikasi tidak ditemukan');

    await this.prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
    return { success: true };
  }

  /**
   * Finance dashboard: budget threshold / overbudget — satu baris per user (dedup):
   * Finansial + GM (semua user aktif role tsb) ∪ notifyUserIds (actor + creator, dll).
   */
  async notifyBudgetThresholdAlerts(params: {
    projectId: string;
    projectName: string;
    projectCode: string;
    kind: 'WARN_80' | 'OVERBUDGET';
    categoryLabel: string;
    notifyUserIds?: string[];
  }): Promise<void> {
    const { projectId, projectName, projectCode, kind, categoryLabel, notifyUserIds } = params;
    const link = `/finance-projects/${projectId}`;
    const isOver = kind === 'OVERBUDGET';
    const title = isOver ? 'Melebihi plafon budget' : 'Peringatan budget 80%';
    const message = isOver
      ? `Budget ${categoryLabel} proyek "${projectName}" (${projectCode}) melebihi plafon — realisasi melebihi alokasi.`
      : `Budget ${categoryLabel} proyek "${projectName}" (${projectCode}) sudah mencapai ≥80% utilizasi.`;
    const payload: NotificationPayload = {
      title,
      message,
      type: 'FINANCE_BUDGET',
      link,
      entityId: projectId,
    };
    const roleHolders = await this.prisma.user.findMany({
      where: { role: { in: [Role.FINANCE, Role.GENERAL_MANAGER] }, isActive: true },
      select: { id: true },
    });
    const recipientIds = new Set<string>();
    for (const u of roleHolders) recipientIds.add(u.id);
    for (const id of notifyUserIds ?? []) {
      if (id) recipientIds.add(id);
    }
    if (!recipientIds.size) return;

    const rows = Array.from(recipientIds).map((userId) => ({
      userId,
      title: payload.title,
      message: payload.message,
      type: payload.type ?? 'GENERAL',
      link: payload.link ?? null,
      entityId: payload.entityId ?? null,
    }));
    await this.prisma.notification.createMany({ data: rows });

    this.gateway.emitToRoom(`role:${Role.FINANCE}`, 'notification:new', {
      title: payload.title,
      message: payload.message,
      type: payload.type,
      link: payload.link,
      entityId: payload.entityId,
      count: rows.length,
    });
    this.gateway.emitToRoom(`role:${Role.GENERAL_MANAGER}`, 'notification:new', {
      title: payload.title,
      message: payload.message,
      type: payload.type,
      link: payload.link,
      entityId: payload.entityId,
      count: rows.length,
    });
    for (const uid of notifyUserIds ?? []) {
      if (uid) {
        this.gateway.emitToRoom(`user:${uid}`, 'notification:new', {
          title: payload.title,
          message: payload.message,
          type: payload.type,
          link: payload.link,
          entityId: payload.entityId,
          refresh: true,
        });
      }
    }
  }

  async markAllAsRead(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    await this.prisma.notification.updateMany({
      where: {
        OR: [{ userId }, ...(user?.role ? [{ userRole: user.role }] : [])],
        isRead: false,
      },
      data: { isRead: true, readAt: new Date() },
    });
    return { success: true };
  }
}
