import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type AuditLogRow = {
  timestamp: string;
  actorName: string;
  actorRole: string;
  action: string;
  detail: string;
  module: string;
};

/**
 * Integra V9: System Overview reads durable SystemActivityLog (all users).
 * Falls back to legacy merge while the table is still cold after deploy.
 */
@Injectable()
export class AuditLogService implements OnModuleInit {
  private readonly logger = new Logger(AuditLogService.name);
  private backfilled = false;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // Fire-and-forget one-time seed so Overview is not empty right after migrate.
    void this.seedFromLegacyIfEmpty().catch((e) =>
      this.logger.warn(`SystemActivityLog seed skipped: ${e instanceof Error ? e.message : e}`),
    );
  }

  async findRecent(limit: number): Promise<AuditLogRow[]> {
    const take = Math.min(100, Math.max(1, limit));

    try {
      const stored = await this.prisma.systemActivityLog.findMany({
        take,
        orderBy: { createdAt: 'desc' },
        include: { actor: { select: { name: true, role: true } } },
      });

      if (stored.length > 0) {
        return stored.map((r) => ({
          timestamp: r.createdAt.toISOString(),
          actorName: r.actor.name,
          actorRole: r.actor.role,
          action: r.action,
          detail: r.detail,
          module: r.module,
        }));
      }
    } catch (e) {
      this.logger.warn(`SystemActivityLog read failed, using legacy merge: ${e instanceof Error ? e.message : e}`);
    }

    return this.legacyMerge(take);
  }

  private async seedFromLegacyIfEmpty() {
    if (this.backfilled) return;
    this.backfilled = true;
    const count = await this.prisma.systemActivityLog.count();
    if (count > 0) return;

    const legacy = await this.legacyMerge(80);
    if (legacy.length === 0) return;

    // Resolve actor names → ids for seed
    const names = [...new Set(legacy.map((r) => r.actorName).filter(Boolean))];
    const users = await this.prisma.user.findMany({
      where: { name: { in: names } },
      select: { id: true, name: true },
    });
    const byName = new Map(users.map((u) => [u.name, u.id]));

    const data = legacy
      .map((r) => {
        const actorId = byName.get(r.actorName);
        if (!actorId) return null;
        return {
          actorId,
          action: r.action,
          detail: r.detail.slice(0, 400),
          module: r.module,
          createdAt: new Date(r.timestamp),
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);

    if (data.length === 0) return;
    await this.prisma.systemActivityLog.createMany({ data });
    this.logger.log(`Seeded ${data.length} SystemActivityLog rows from legacy sources`);
  }

  /** Legacy multi-source merge — used only when SystemActivityLog is empty / unavailable. */
  private async legacyMerge(limit: number): Promise<AuditLogRow[]> {
    const takeEach = Math.max(15, Math.ceil(limit / 2));
    const rows: AuditLogRow[] = [];

    const [visits, stock, orders, prs, daily, cashOps, cashSteps, ftttTx, implLogs, poChanges] =
      await Promise.all([
        this.prisma.visitApprovalLog.findMany({
          take: takeEach,
          orderBy: { createdAt: 'desc' },
          include: { actor: { select: { name: true, role: true } } },
        }),
        this.prisma.stockLog.findMany({
          take: takeEach,
          orderBy: { createdAt: 'desc' },
          include: {
            actor: { select: { name: true, role: true } },
            stockItem: { select: { name: true } },
          },
        }),
        this.prisma.order.findMany({
          take: takeEach,
          orderBy: { updatedAt: 'desc' },
          include: { creator: { select: { name: true, role: true } } },
        }),
        this.prisma.purchaseRequest.findMany({
          take: takeEach,
          orderBy: { updatedAt: 'desc' },
          include: { requester: { select: { name: true, role: true } } },
        }),
        this.prisma.dailyActivity.findMany({
          take: takeEach,
          orderBy: { timestamp: 'desc' },
          include: {
            actor: { select: { name: true, role: true } },
            updatedBy: { select: { name: true, role: true } },
            ftttProject: { select: { projectName: true } },
            financeProject: { select: { name: true } },
          },
        }),
        this.prisma.cashOperationRequest.findMany({
          take: takeEach,
          orderBy: { updatedAt: 'desc' },
          include: { requester: { select: { name: true, role: true } } },
        }),
        this.prisma.cashOpApprovalStep.findMany({
          take: takeEach,
          where: { decidedAt: { not: null }, status: { not: 'PENDING' } },
          orderBy: { decidedAt: 'desc' },
          include: {
            approver: { select: { name: true, role: true } },
            request: { select: { requestNumber: true } },
          },
        }),
        this.prisma.ftttTransaction.findMany({
          take: takeEach,
          orderBy: { createdAt: 'desc' },
          include: { createdBy: { select: { name: true, role: true } } },
        }),
        this.prisma.ftttImplementationLog.findMany({
          take: takeEach,
          orderBy: { createdAt: 'desc' },
          include: {
            uploadedBy: { select: { name: true, role: true } },
            project: { select: { projectName: true } },
          },
        }),
        this.prisma.financePoChangeRequest.findMany({
          take: takeEach,
          orderBy: { createdAt: 'desc' },
          include: {
            submittedBy: { select: { name: true, role: true } },
            reviewedBy: { select: { name: true, role: true } },
          },
        }),
      ]);

    for (const v of visits) {
      rows.push({
        timestamp: v.createdAt.toISOString(),
        actorName: v.actor.name,
        actorRole: v.actor.role,
        action: v.action,
        detail: `Visit ${v.visitRequestId}: ${v.fromStatus} → ${v.toStatus}`,
        module: 'VISIT',
      });
    }
    for (const s of stock) {
      rows.push({
        timestamp: s.createdAt.toISOString(),
        actorName: s.actor.name,
        actorRole: s.actor.role,
        action: s.type,
        detail: `${s.stockItem.name}: ${s.qtyChange > 0 ? '+' : ''}${s.qtyChange}`,
        module: 'STOCK',
      });
    }
    for (const o of orders) {
      rows.push({
        timestamp: o.updatedAt.toISOString(),
        actorName: o.creator.name,
        actorRole: o.creator.role,
        action: 'ORDER_UPDATE',
        detail: `${o.orderNumber} — ${o.status}`,
        module: 'ORDER',
      });
    }
    for (const p of prs) {
      rows.push({
        timestamp: p.updatedAt.toISOString(),
        actorName: p.requester.name,
        actorRole: p.requester.role,
        action: 'PURCHASE_REQUEST',
        detail: `${p.requestNumber} — ${p.status}`,
        module: 'PURCHASE',
      });
    }
    for (const a of daily) {
      const who = a.updatedBy ?? a.actor;
      const site = a.siteName || a.ftttProject?.projectName || a.financeProject?.name || 'Daily Activity';
      rows.push({
        timestamp: a.timestamp.toISOString(),
        actorName: who?.name || 'System',
        actorRole: who?.role || '',
        action: a.workStatus,
        detail: `${site}: ${a.scopeOfWork}`,
        module: 'DAILY_ACTIVITY',
      });
    }
    for (const c of cashOps) {
      rows.push({
        timestamp: c.updatedAt.toISOString(),
        actorName: c.requester?.name || 'System',
        actorRole: c.requester?.role || '',
        action: c.status,
        detail: `${c.requestNumber} · ${c.type}`,
        module: 'CASH_OPERATION',
      });
    }
    for (const st of cashSteps) {
      rows.push({
        timestamp: (st.decidedAt ?? st.createdAt).toISOString(),
        actorName: st.approver?.name || st.approverRole,
        actorRole: st.approver?.role || st.approverRole,
        action: st.status,
        detail: `Cash Op ${st.request?.requestNumber || ''} · step ${st.stepOrder}`,
        module: 'CASH_APPROVAL',
      });
    }
    for (const t of ftttTx) {
      rows.push({
        timestamp: t.createdAt.toISOString(),
        actorName: t.createdBy?.name || 'System',
        actorRole: t.createdBy?.role || '',
        action: t.disbursedAt ? 'DISBURSED' : 'TX_CREATED',
        detail: `${t.category} · ${t.aktivitas}`,
        module: 'FTTT_TX',
      });
    }
    for (const l of implLogs) {
      rows.push({
        timestamp: l.createdAt.toISOString(),
        actorName: l.uploadedBy?.name || 'System',
        actorRole: l.uploadedBy?.role || '',
        action: l.logType,
        detail: `${l.project?.projectName || 'FTTT'} · ${l.caption || l.notes || l.logType}`,
        module: 'FTTT_IMPL',
      });
    }
    for (const po of poChanges) {
      rows.push({
        timestamp: po.createdAt.toISOString(),
        actorName: po.submittedBy?.name || 'System',
        actorRole: po.submittedBy?.role || '',
        action: 'PO_SUBMIT',
        detail: `PO ${po.status} · ${Number(po.proposedAmount).toLocaleString('id-ID')}`,
        module: 'FINANCE_PO',
      });
      if (po.reviewedAt && po.reviewedBy) {
        rows.push({
          timestamp: po.reviewedAt.toISOString(),
          actorName: po.reviewedBy.name,
          actorRole: po.reviewedBy.role,
          action: po.status,
          detail: `PO review ${po.status}`,
          module: 'FINANCE_PO',
        });
      }
    }

    rows.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    return rows.slice(0, limit);
  }
}
