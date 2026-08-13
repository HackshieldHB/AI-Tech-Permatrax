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
import { buildActivityDescription } from '../activity/activity-description';

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
  'beginning-groups',
  'site-endings',
  'complete',
]);

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
 * Integra V10 / URGENT: append a Daily Activity row with human-readable Scope of Work
 * for every successful project mutation (FTTT + Finance).
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
        next: (responseBody) => {
          void this.persist(actorId, method, path, req.body, req.params, responseBody).catch(() => {
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
    responseBody?: unknown,
  ) {
    let ftttProjectId: string | null = extractEntityId(path, 'fttt-projects');
    let financeProjectId: string | null = extractEntityId(path, 'finance-projects');
    let siteName: string | null =
      (typeof body?.projectName === 'string' && body.projectName) ||
      (typeof body?.name === 'string' && body.name) ||
      (typeof body?.siteName === 'string' && body.siteName) ||
      null;
    let category: string | null =
      (typeof body?.category === 'string' && body.category) ||
      (typeof body?.budgetCategory === 'string' && body.budgetCategory) ||
      null;
    let amount: number | string | null =
      (typeof body?.amount === 'number' || typeof body?.amount === 'string' ? body.amount : null) ??
      (typeof body?.totalAmount === 'number' || typeof body?.totalAmount === 'string' ? body.totalAmount : null) ??
      (typeof body?.materialBudget === 'number' || typeof body?.materialBudget === 'string'
        ? body.materialBudget
        : null);

    if (!ftttProjectId && path.includes('/fttt-projects/')) {
      ftttProjectId = await this.resolveFtttProjectId(path, params);
    }
    if (!financeProjectId && path.includes('/finance-projects/')) {
      financeProjectId = await this.resolveFinanceProjectId(path, params);
    }

    // Beginning group: resolve beginning site name
    const beginningSiteId =
      (typeof body?.beginningFinanceSiteId === 'string' && body.beginningFinanceSiteId) ||
      null;
    if (beginningSiteId && !siteName) {
      const fs = await this.prisma.financeProject.findUnique({
        where: { id: beginningSiteId },
        select: { name: true },
      });
      if (fs) siteName = fs.name;
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

    // Enrich from created transaction response when available
    if (responseBody && typeof responseBody === 'object') {
      const r = responseBody as Record<string, unknown>;
      if (!category && typeof r.category === 'string') category = r.category;
      if (amount == null && (typeof r.amount === 'number' || typeof r.amount === 'string')) {
        amount = r.amount as number | string;
      }
      if (!siteName && typeof r.projectName === 'string') siteName = r.projectName;
      if (
        !siteName &&
        r.beginningFinanceSite &&
        typeof r.beginningFinanceSite === 'object' &&
        typeof (r.beginningFinanceSite as { name?: string }).name === 'string'
      ) {
        siteName = (r.beginningFinanceSite as { name: string }).name;
      }
    }

    const scopeOfWork = buildActivityDescription(method, path, {
      siteName,
      projectName: siteName,
      category,
      amount,
      objectName: siteName,
    });

    const remarks = `${method} ${path.split('?')[0]}`.slice(0, 500);

    await this.prisma.dailyActivity.create({
      data: {
        actorId,
        scopeOfWork: scopeOfWork.slice(0, 400),
        ftttProjectId,
        financeProjectId,
        siteName,
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
