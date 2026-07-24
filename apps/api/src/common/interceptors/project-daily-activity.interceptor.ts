import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { DailyActivityWorkStatus } from '@prisma/client';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../auth/types/auth-user.types';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Project-scoped API prefixes — Daily Activity mirrors System Overview for these only. */
const PROJECT_PREFIXES = ['/api/fttt-projects', '/api/finance-projects'];

/** Avoid double-logging Update Status / evidence (handled in DailyActivityService). */
const SKIP_PREFIXES = ['/api/daily-activities', '/api/auth', '/api/files', '/api/audit-log', '/api/health'];

const KEYWORD_SEGMENTS = new Set([
  'transactions',
  'spans',
  'documents',
  'sanggah',
  'recon-docs',
  'closing-logs',
  'span-logs',
  'sites',
  'survey-uploads',
  'survey-sites',
  'drm-documents',
  'implementation-logs',
  'po-customer',
  'plan-import',
  'planning',
  'budget',
  'timeline',
]);

const SCOPE_BY_SEGMENT: Record<string, string> = {
  'implementation-logs': 'Implementation Log',
  'advance-phase': 'Phase Advance',
  'submit-survey-review': 'Survey Submit Review',
  'review-survey': 'Survey Review',
  'mark-implementation-done': 'Implementation Lapangan Done',
  'survey-uploads': 'Survey Upload',
  'survey-sites': 'Survey Site',
  'drm-documents': 'DRM Document',
  sanggah: 'Sanggah',
  documents: 'Project Document',
  spans: 'Daily Log Span',
  logs: 'Daily Log',
  transactions: 'Finance Transaction',
  accept: 'Financial Request Accept',
  decline: 'Financial Request Decline',
  disburse: 'Finance Disburse',
  'recon-docs': 'Reconciliation Doc',
  'closing-logs': 'Closing Log',
  'confirm-maintenance': 'Maintenance Confirm',
  'implementation-type': 'Implementation Type',
  'total-panjang': 'Total Panjang',
  'payment-status': 'Payment Status',
  'po-customer': 'PO Customer',
  'plan-import': 'Plan Import',
  planning: 'Planning Update',
  budget: 'Budget Update',
  timeline: 'Timeline Update',
  sites: 'Site Create',
};

function actionFromMethod(method: string, path: string): string {
  const p = path.toLowerCase();
  if (p.includes('approve')) return 'APPROVE';
  if (p.includes('reject') || p.includes('decline')) return 'REJECT';
  if (p.includes('upload') || p.includes('evidence') || p.includes('document') || p.includes('logs')) return 'UPLOAD';
  if (p.includes('import')) return 'IMPORT';
  if (p.includes('export')) return 'EXPORT';
  if (p.includes('submit')) return 'SUBMIT';
  if (p.includes('accept')) return 'APPROVE';
  if (p.includes('disburse')) return 'UPDATE';
  if (method === 'POST') return 'CREATE';
  if (method === 'PUT' || method === 'PATCH') return 'UPDATE';
  if (method === 'DELETE') return 'DELETE';
  return method;
}

function scopeOfWorkFromPath(method: string, path: string): string {
  const clean = path.split('?')[0];
  const segs = clean.split('/').filter(Boolean);
  const action = actionFromMethod(method, clean);
  // Prefer the most specific known segment from the end
  for (let i = segs.length - 1; i >= 0; i--) {
    const seg = segs[i].toLowerCase();
    if (SCOPE_BY_SEGMENT[seg]) {
      return `${SCOPE_BY_SEGMENT[seg]} (${action})`;
    }
  }
  const last = segs[segs.length - 1] || 'project';
  if (KEYWORD_SEGMENTS.has(last) || /^[a-z0-9]{20,}$/i.test(last)) {
    const prev = segs[segs.length - 2] || 'project';
    return `${prev.replace(/-/g, ' ')} (${action})`;
  }
  return `Project ${action}`;
}

function extractEntityId(path: string, root: 'fttt-projects' | 'finance-projects'): string | null {
  const clean = path.split('?')[0];
  const re = new RegExp(`/${root}/([^/]+)`, 'i');
  const m = clean.match(re);
  if (!m) return null;
  const id = m[1];
  if (KEYWORD_SEGMENTS.has(id.toLowerCase())) return null;
  return id;
}

/**
 * Integra V10: append a Daily Activity row for every successful project mutation
 * (FTTT + Finance), all actors — same coverage model as System Overview, project-scoped.
 */
@Injectable()
export class ProjectDailyActivityInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<{
      method: string;
      originalUrl?: string;
      url?: string;
      user?: AuthUser;
      body?: Record<string, unknown>;
      params?: Record<string, string>;
    }>();

    const method = (req.method || '').toUpperCase();
    if (!MUTATING.has(method)) return next.handle();

    const path = String(req.originalUrl || req.url || '');
    if (SKIP_PREFIXES.some((s) => path.startsWith(s) || path.includes(s + '/'))) {
      return next.handle();
    }
    if (!PROJECT_PREFIXES.some((p) => path.startsWith(p) || path.includes(p))) {
      return next.handle();
    }

    const actorId = req.user?.userId;
    if (!actorId) return next.handle();

    return next.handle().pipe(
      tap({
        next: () => {
          void this.persist(actorId, method, path, req.body, req.params).catch(() => {
            /* never break the request */
          });
        },
      }),
    );
  }

  private async persist(
    actorId: string,
    method: string,
    path: string,
    body?: Record<string, unknown>,
    params?: Record<string, string>,
  ) {
    const scopeOfWork = scopeOfWorkFromPath(method, path);
    let ftttProjectId: string | null = extractEntityId(path, 'fttt-projects');
    let financeProjectId: string | null = extractEntityId(path, 'finance-projects');
    let siteName: string | null =
      (typeof body?.projectName === 'string' && body.projectName) ||
      (typeof body?.name === 'string' && body.name) ||
      (typeof body?.siteName === 'string' && body.siteName) ||
      null;

    // Nested routes: resolve project via related entity ids in params/path
    if (!ftttProjectId && path.includes('/fttt-projects/')) {
      ftttProjectId = await this.resolveFtttProjectId(path, params);
    }
    if (!financeProjectId && path.includes('/finance-projects/')) {
      financeProjectId = await this.resolveFinanceProjectId(path, params);
    }

    if (ftttProjectId && !siteName) {
      const p = await this.prisma.ftttProject.findUnique({
        where: { id: ftttProjectId },
        select: { projectName: true, financeProjectId: true },
      });
      if (p) {
        siteName = p.projectName;
        if (!financeProjectId) financeProjectId = p.financeProjectId;
      } else {
        // Stale/wrong id from path keyword miss — don't FK-fail
        ftttProjectId = null;
      }
    }

    if (financeProjectId && !siteName) {
      const p = await this.prisma.financeProject.findUnique({
        where: { id: financeProjectId },
        select: { name: true },
      });
      if (p) siteName = p.name;
      else financeProjectId = null;
    }

    const remarks = `${method} ${path.split('?')[0]}`.slice(0, 500);

    await this.prisma.dailyActivity.create({
      data: {
        actorId,
        scopeOfWork: scopeOfWork.slice(0, 200),
        ftttProjectId,
        financeProjectId,
        siteName,
        // Feed rows are completed events — no overdue monitoring
        workStatus: DailyActivityWorkStatus.DONE,
        targetDoneAt: null,
        remarks,
        updatedById: actorId,
      },
    });
  }

  private async resolveFtttProjectId(
    path: string,
    params?: Record<string, string>,
  ): Promise<string | null> {
    const txId = params?.txId || path.match(/\/transactions\/([^/]+)/)?.[1];
    if (txId && !KEYWORD_SEGMENTS.has(txId)) {
      const tx = await this.prisma.ftttTransaction.findUnique({
        where: { id: txId },
        select: { ftttProjectId: true },
      });
      if (tx) return tx.ftttProjectId;
    }

    const spanId = params?.spanId || path.match(/\/spans\/([^/]+)/)?.[1];
    if (spanId && !KEYWORD_SEGMENTS.has(spanId)) {
      const span = await this.prisma.ftttSpan.findUnique({
        where: { id: spanId },
        select: { projectId: true },
      });
      if (span) return span.projectId;
    }

    const docId = params?.docId || path.match(/\/documents\/([^/]+)/)?.[1];
    if (docId && !KEYWORD_SEGMENTS.has(docId)) {
      const doc = await this.prisma.ftttDocument.findUnique({
        where: { id: docId },
        select: { projectId: true },
      });
      if (doc) return doc.projectId;
    }

    const sanggahId = params?.sanggahId || path.match(/\/sanggah\/([^/]+)/)?.[1];
    if (sanggahId && !KEYWORD_SEGMENTS.has(sanggahId)) {
      const s = await this.prisma.ftttSanggah.findUnique({
        where: { id: sanggahId },
        select: { projectId: true },
      });
      if (s) return s.projectId;
    }

    const logId = params?.logId;
    if (logId) {
      const closing = await this.prisma.ftttClosingLog.findUnique({
        where: { id: logId },
        select: { projectId: true },
      }).catch(() => null);
      if (closing) return closing.projectId;
    }

    return null;
  }

  private async resolveFinanceProjectId(
    path: string,
    params?: Record<string, string>,
  ): Promise<string | null> {
    const requestId = params?.requestId || path.match(/\/po-customer\/([^/]+)/)?.[1];
    if (requestId && !KEYWORD_SEGMENTS.has(requestId)) {
      const row = await this.prisma.financePoChangeRequest.findUnique({
        where: { id: requestId },
        select: { financeProjectId: true },
      });
      if (row) return row.financeProjectId;
    }
    return null;
  }
}
