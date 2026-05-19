import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type AuditLogRow = {
  timestamp: string;
  actorName: string;
  actorRole: string;
  action: string;
  detail: string;
  module: string;
};

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async findRecent(limit: number): Promise<AuditLogRow[]> {
    const takeEach = Math.max(8, Math.ceil(limit / 2));

    const [visits, stock, orders, prs] = await this.prisma.$transaction([
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
        orderBy: { createdAt: 'desc' },
        include: { creator: { select: { name: true, role: true } } },
      }),
      this.prisma.purchaseRequest.findMany({
        take: takeEach,
        orderBy: { createdAt: 'desc' },
        include: { requester: { select: { name: true, role: true } } },
      }),
    ]);

    const rows: AuditLogRow[] = [];

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
        detail: `${s.stockItem.name}: ${s.qtyChange > 0 ? '+' : ''}${s.qtyChange}${s.reference ? ` — ${s.reference}` : ''}`,
        module: 'STOCK',
      });
    }

    for (const o of orders) {
      rows.push({
        timestamp: o.createdAt.toISOString(),
        actorName: o.creator.name,
        actorRole: o.creator.role,
        action: 'ORDER',
        detail: `${o.orderNumber} — ${o.status}`,
        module: 'ORDER',
      });
    }

    for (const p of prs) {
      rows.push({
        timestamp: p.createdAt.toISOString(),
        actorName: p.requester.name,
        actorRole: p.requester.role,
        action: 'PURCHASE_REQUEST',
        detail: `${p.requestNumber} — ${p.status}`,
        module: 'PURCHASE',
      });
    }

    rows.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    return rows.slice(0, limit);
  }
}
