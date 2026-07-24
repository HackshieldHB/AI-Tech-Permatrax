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

/** Integra V7: System Overview / Audit Trail — merge latest events across modules (not create-only). */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async findRecent(limit: number): Promise<AuditLogRow[]> {
    const takeEach = Math.max(10, Math.ceil(limit / 2));
    const rows: AuditLogRow[] = [];

    const [
      visits,
      stock,
      orders,
      prs,
      daily,
      cashOps,
      clusters,
      supplierInvoices,
      baOpens,
      ftttProjects,
    ] = await Promise.all([
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
          ftttProject: { select: { projectName: true } },
          financeProject: { select: { name: true } },
        },
      }),
      this.prisma.cashOperationRequest.findMany({
        take: takeEach,
        orderBy: { updatedAt: 'desc' },
        include: { requester: { select: { name: true, role: true } } },
      }),
      this.prisma.permitCluster.findMany({
        take: takeEach,
        orderBy: { updatedAt: 'desc' },
        include: {
          assignedPm: { select: { name: true, role: true } },
          visitRequest: { include: { cleanList: { select: { siteName: true, rwCode: true } } } },
        },
      }),
      this.prisma.supplierInvoice.findMany({
        take: takeEach,
        orderBy: { updatedAt: 'desc' },
        include: { uploadedBy: { select: { name: true, role: true } } },
      }),
      this.prisma.baOpen.findMany({
        take: takeEach,
        orderBy: { generatedAt: 'desc' },
        include: { generator: { select: { name: true, role: true } } },
      }),
      this.prisma.ftttProject.findMany({
        take: takeEach,
        orderBy: { updatedAt: 'desc' },
        include: { pm: { select: { name: true, role: true } } },
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
        detail: `${s.stockItem.name}: ${s.qtyChange > 0 ? '+' : ''}${s.qtyChange}${s.reference ? ` — ${s.reference}` : ''}`,
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
      const site = a.siteName || a.ftttProject?.projectName || a.financeProject?.name || 'Daily Activity';
      rows.push({
        timestamp: a.timestamp.toISOString(),
        actorName: a.actor?.name || 'System',
        actorRole: a.actor?.role || '',
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
        detail: `${c.requestNumber} · ${c.type} · ${c.description?.slice(0, 80) || ''}`,
        module: 'CASH_OPERATION',
      });
    }

    for (const cl of clusters) {
      const name =
        cl.visitRequest?.cleanList?.siteName ||
        cl.visitRequest?.cleanList?.rwCode ||
        cl.clusterCode;
      rows.push({
        timestamp: cl.updatedAt.toISOString(),
        actorName: cl.assignedPm?.name || 'System',
        actorRole: cl.assignedPm?.role || '',
        action: cl.currentPhase,
        detail: `${name} — ${cl.status}`,
        module: 'PERMIT',
      });
    }

    for (const inv of supplierInvoices) {
      rows.push({
        timestamp: inv.updatedAt.toISOString(),
        actorName: inv.uploadedBy?.name || 'System',
        actorRole: inv.uploadedBy?.role || '',
        action: inv.status,
        detail: `Invoice ${inv.invoiceNumber} — ${inv.status}`,
        module: 'SUPPLIER_INVOICE',
      });
    }

    for (const ba of baOpens) {
      rows.push({
        timestamp: ba.generatedAt.toISOString(),
        actorName: ba.generator?.name || 'System',
        actorRole: ba.generator?.role || '',
        action: ba.status,
        detail: `BA Open ${ba.documentNumber} — ${ba.status}`,
        module: 'BA_OPEN',
      });
    }

    for (const fp of ftttProjects) {
      rows.push({
        timestamp: fp.updatedAt.toISOString(),
        actorName: fp.pm?.name || 'System',
        actorRole: fp.pm?.role || '',
        action: fp.currentPhase,
        detail: `${fp.projectName} — ${fp.status}`,
        module: 'FTTT',
      });
    }

    rows.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    return rows.slice(0, limit);
  }
}
