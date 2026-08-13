import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../auth/types/auth-user.types';
import {
  actionFromMethod,
  buildActivityDescription,
  buildEntityHref,
} from '../activity/activity-description';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SKIP_PATH = [
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/health',
  '/health',
  '/api/files',
  '/api/audit-log',
];

function moduleFromPath(path: string): string {
  const clean = path.split('?')[0].replace(/^\/api\//, '').replace(/^\//, '');
  const seg = clean.split('/').filter(Boolean)[0] || 'system';
  return seg.replace(/-/g, '_').toUpperCase();
}

function extractId(path: string, root: string): string | null {
  const m = path.split('?')[0].match(new RegExp(`/${root}/([^/]+)`, 'i'));
  if (!m) return null;
  const id = m[1];
  if (/^(sites|transactions|spans|documents|beginning-groups)$/i.test(id)) return null;
  return id;
}

/** Integra V9 / URGENT: durable System Overview with human-readable Detail (not API paths). */
@Injectable()
export class SystemActivityInterceptor implements NestInterceptor {
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
    if (SKIP_PATH.some((s) => path.startsWith(s) || path.includes(s))) {
      return next.handle();
    }

    const user = req.user;
    const actorId = user?.userId;
    if (!actorId) return next.handle();

    return next.handle().pipe(
      tap({
        next: (responseBody) => {
          void this.persist(actorId, method, path, req.body, responseBody).catch(() => {
            /* never break the request for audit write failures */
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
    responseBody?: unknown,
  ) {
    const cleanPath = path.split('?')[0];
    let ftttProjectId = extractId(cleanPath, 'fttt-projects');
    let financeProjectId = extractId(cleanPath, 'finance-projects');
    let siteName: string | null =
      (typeof body?.projectName === 'string' && body.projectName) ||
      (typeof body?.name === 'string' && body.name) ||
      (typeof body?.siteName === 'string' && body.siteName) ||
      null;
    let category: string | null =
      (typeof body?.category === 'string' && body.category) || null;
    let amount: number | string | null =
      (typeof body?.amount === 'number' || typeof body?.amount === 'string' ? body.amount : null) ??
      (typeof body?.totalAmount === 'number' || typeof body?.totalAmount === 'string'
        ? body.totalAmount
        : null);

    if (typeof body?.beginningFinanceSiteId === 'string') {
      const fs = await this.prisma.financeProject.findUnique({
        where: { id: body.beginningFinanceSiteId },
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
      if (!ftttProjectId && typeof r.id === 'string' && /fttt-projects/i.test(cleanPath)) {
        // created entity id — only use if looks like project create
        if (!/beginning-groups|transactions|spans|documents/i.test(cleanPath)) {
          ftttProjectId = r.id;
        }
      }
    }

    const txId = cleanPath.match(/\/transactions\/([^/]+)/)?.[1] || null;
    const detail = buildActivityDescription(method, cleanPath, {
      siteName,
      projectName: siteName,
      category,
      amount,
      objectName: siteName,
    });

    // Store human detail; keep technical path in `path` for audit/debug only
    const href = buildEntityHref(cleanPath, {
      ftttProjectId,
      financeProjectId,
      transactionId: txId,
    });
    const detailWithNav = href ? `${detail}` : detail;

    await this.prisma.systemActivityLog.create({
      data: {
        actorId,
        action: actionFromMethod(method, cleanPath),
        detail: detailWithNav.slice(0, 400),
        module: moduleFromPath(cleanPath),
        method,
        // Encode href hint after path for Overview navigation (UI parses ||href=)
        path: (href ? `${cleanPath.slice(0, 200)}||href=${href}` : cleanPath).slice(0, 240),
      },
    });
  }
}
