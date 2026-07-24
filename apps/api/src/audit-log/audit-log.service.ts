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

/**
 * Integra V7/V8: System Overview Recent Activity — merge true actor events across modules.
 * Prefer events with a real acting user (not entity-owner PM attribution) so all users appear.
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async findRecent(limit: number): Promise<AuditLogRow[]> {
    const takeEach = Math.max(25, Math.ceil(limit * 1.5));
    const buckets: AuditLogRow[][] = [];

    const pushBucket = (rows: AuditLogRow[]) => {
      if (rows.length) buckets.push(rows);
    };

    const [
      visits,
      stock,
      orders,
      prs,
      daily,
      cashOps,
      supplierInvoices,
      baOpens,
      ftttTx,
      poChanges,
      implLogs,
      visitRequests,
      cashSteps,
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
      this.prisma.supplierInvoice.findMany({
        take: takeEach,
        orderBy: { updatedAt: 'desc' },
        include: { uploadedBy: { select: { name: true, role: true } } },
      }),
      this.prisma.baOpen.findMany({
        take: takeEach,
        orderBy: { updatedAt: 'desc' },
        include: { generator: { select: { name: true, role: true } } },
      }),
      this.prisma.ftttTransaction.findMany({
        take: takeEach,
        orderBy: { createdAt: 'desc' },
        include: { createdBy: { select: { name: true, role: true } } },
      }),
      this.prisma.financePoChangeRequest.findMany({
        take: takeEach,
        orderBy: { createdAt: 'desc' },
        include: {
          submittedBy: { select: { name: true, role: true } },
          reviewedBy: { select: { name: true, role: true } },
        },
      }),
      this.prisma.ftttImplementationLog.findMany({
        take: takeEach,
        orderBy: { createdAt: 'desc' },
        include: {
          uploadedBy: { select: { name: true, role: true } },
          project: { select: { projectName: true } },
        },
      }),
      this.prisma.visitRequest.findMany({
        take: takeEach,
        orderBy: { updatedAt: 'desc' },
        include: {
          requester: { select: { name: true, role: true } },
          cleanList: { select: { siteName: true, rwCode: true } },
        },
      }),
      this.prisma.cashOpApprovalStep.findMany({
        take: takeEach,
        orderBy: { decidedAt: 'desc' },
        where: { decidedAt: { not: null }, status: { not: 'PENDING' } },
        include: {
          approver: { select: { name: true, role: true } },
          request: { select: { requestNumber: true } },
        },
      }),
    ]);

    pushBucket(
      visits.map((v) => ({
        timestamp: v.createdAt.toISOString(),
        actorName: v.actor.name,
        actorRole: v.actor.role,
        action: v.action,
        detail: `Visit ${v.visitRequestId}: ${v.fromStatus} → ${v.toStatus}`,
        module: 'VISIT',
      })),
    );

    pushBucket(
      stock.map((s) => ({
        timestamp: s.createdAt.toISOString(),
        actorName: s.actor.name,
        actorRole: s.actor.role,
        action: s.type,
        detail: `${s.stockItem.name}: ${s.qtyChange > 0 ? '+' : ''}${s.qtyChange}${s.reference ? ` — ${s.reference}` : ''}`,
        module: 'STOCK',
      })),
    );

    pushBucket(
      orders.map((o) => ({
        timestamp: o.updatedAt.toISOString(),
        actorName: o.creator.name,
        actorRole: o.creator.role,
        action: 'ORDER_UPDATE',
        detail: `${o.orderNumber} — ${o.status}`,
        module: 'ORDER',
      })),
    );

    pushBucket(
      prs.map((p) => ({
        timestamp: p.updatedAt.toISOString(),
        actorName: p.requester.name,
        actorRole: p.requester.role,
        action: 'PURCHASE_REQUEST',
        detail: `${p.requestNumber} — ${p.status}`,
        module: 'PURCHASE',
      })),
    );

    pushBucket(
      daily.map((a) => {
        const site = a.siteName || a.ftttProject?.projectName || a.financeProject?.name || 'Daily Activity';
        return {
          timestamp: a.timestamp.toISOString(),
          actorName: a.actor?.name || 'System',
          actorRole: a.actor?.role || '',
          action: a.workStatus,
          detail: `${site}: ${a.scopeOfWork}`,
          module: 'DAILY_ACTIVITY',
        };
      }),
    );

    pushBucket(
      cashOps.map((c) => ({
        timestamp: c.updatedAt.toISOString(),
        actorName: c.requester?.name || 'System',
        actorRole: c.requester?.role || '',
        action: c.status,
        detail: `${c.requestNumber} · ${c.type} · ${(c.description ?? '').slice(0, 80)}`,
        module: 'CASH_OPERATION',
      })),
    );

    pushBucket(
      supplierInvoices.map((inv) => ({
        timestamp: inv.updatedAt.toISOString(),
        actorName: inv.uploadedBy?.name || 'System',
        actorRole: inv.uploadedBy?.role || '',
        action: inv.status,
        detail: `Invoice ${inv.invoiceNumber} — ${inv.status}`,
        module: 'SUPPLIER_INVOICE',
      })),
    );

    pushBucket(
      baOpens.map((ba) => ({
        timestamp: ba.updatedAt.toISOString(),
        actorName: ba.generator?.name || 'System',
        actorRole: ba.generator?.role || '',
        action: ba.status,
        detail: `BA Open ${ba.documentNumber} — ${ba.status}`,
        module: 'BA_OPEN',
      })),
    );

    pushBucket(
      ftttTx.map((t) => ({
        timestamp: t.createdAt.toISOString(),
        actorName: t.createdBy?.name || 'System',
        actorRole: t.createdBy?.role || '',
        action: t.disbursedAt ? 'DISBURSED' : 'TX_CREATED',
        detail: `${t.category} · ${t.aktivitas} · ${Number(t.total).toLocaleString('id-ID')}`,
        module: 'FTTT_TX',
      })),
    );

    const poRows: AuditLogRow[] = [];
    for (const po of poChanges) {
      poRows.push({
        timestamp: po.createdAt.toISOString(),
        actorName: po.submittedBy?.name || 'System',
        actorRole: po.submittedBy?.role || '',
        action: 'PO_SUBMIT',
        detail: `PO change ${po.status} · ${Number(po.proposedAmount).toLocaleString('id-ID')}`,
        module: 'FINANCE_PO',
      });
      if (po.reviewedAt && po.reviewedBy) {
        poRows.push({
          timestamp: po.reviewedAt.toISOString(),
          actorName: po.reviewedBy.name,
          actorRole: po.reviewedBy.role,
          action: po.status === 'APPROVED' ? 'PO_APPROVE' : po.status === 'REJECTED' ? 'PO_REJECT' : 'PO_REVIEW',
          detail: `PO change ${po.status}${po.reviewNote ? ` — ${po.reviewNote}` : ''}`,
          module: 'FINANCE_PO',
        });
      }
    }
    pushBucket(poRows);

    pushBucket(
      implLogs.map((l) => ({
        timestamp: l.createdAt.toISOString(),
        actorName: l.uploadedBy?.name || 'System',
        actorRole: l.uploadedBy?.role || '',
        action: l.logType,
        detail: `${l.project?.projectName || 'FTTT'} · ${l.caption || l.notes || l.logType}`,
        module: 'FTTT_IMPL',
      })),
    );

    pushBucket(
      visitRequests.map((vr) => ({
        timestamp: vr.updatedAt.toISOString(),
        actorName: vr.requester?.name || 'System',
        actorRole: vr.requester?.role || '',
        action: vr.status,
        detail: `${vr.cleanList?.siteName || vr.cleanList?.rwCode || vr.id} — Visit Request`,
        module: 'VISIT_REQUEST',
      })),
    );

    if (cashSteps.length > 0) {
      pushBucket(
        cashSteps.map((st) => ({
          timestamp: (st.decidedAt ?? st.createdAt).toISOString(),
          actorName: st.approver?.name || st.approverRole || 'System',
          actorRole: st.approver?.role || st.approverRole || '',
          action: st.status,
          detail: `Cash Op ${st.request?.requestNumber || ''} · step ${st.stepOrder}`.trim(),
          module: 'CASH_APPROVAL',
        })),
      );
    }

    // Round-robin across modules so one busy user/module cannot dominate the list
    const pointers = buckets.map(() => 0);
    const mixed: AuditLogRow[] = [];
    let added = true;
    while (mixed.length < limit * 3 && added) {
      added = false;
      for (let i = 0; i < buckets.length; i++) {
        const idx = pointers[i];
        if (idx < buckets[i].length) {
          mixed.push(buckets[i][idx]);
          pointers[i] = idx + 1;
          added = true;
        }
      }
    }

    mixed.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

    // Prefer diversity of actor names in the final window while keeping time order
    const final: AuditLogRow[] = [];
    const seenActor = new Set<string>();
    const deferred: AuditLogRow[] = [];
    for (const row of mixed) {
      const key = `${row.actorName}|${row.module}|${row.action}|${row.detail}`;
      if (seenActor.has(key)) continue;
      seenActor.add(key);
      const actorKey = row.actorName.toLowerCase();
      const actorCount = final.filter((r) => r.actorName.toLowerCase() === actorKey).length;
      if (actorCount >= Math.max(3, Math.ceil(limit / 6)) && final.length < limit) {
        deferred.push(row);
        continue;
      }
      final.push(row);
      if (final.length >= limit) break;
    }
    for (const row of deferred) {
      if (final.length >= limit) break;
      final.push(row);
    }
    final.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    return final.slice(0, limit);
  }
}
