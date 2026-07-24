import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../auth/types/auth-user.types';

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

function actionFromMethod(method: string, path: string): string {
  const p = path.toLowerCase();
  if (p.includes('approve')) return 'APPROVE';
  if (p.includes('reject')) return 'REJECT';
  if (p.includes('upload') || p.includes('evidence') || p.includes('document')) return 'UPLOAD';
  if (p.includes('import')) return 'IMPORT';
  if (p.includes('export') || p.includes('download') || p.includes('report')) return 'EXPORT';
  if (p.includes('submit')) return 'SUBMIT';
  if (method === 'POST') return 'CREATE';
  if (method === 'PUT' || method === 'PATCH') return 'UPDATE';
  if (method === 'DELETE') return 'DELETE';
  return method;
}

/** Integra V9: persist every mutating API call by authenticated user into SystemActivityLog. */
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
        next: () => {
          const action = actionFromMethod(method, path);
          const module = moduleFromPath(path);
          const bodyHint =
            typeof req.body?.name === 'string'
              ? req.body.name
              : typeof req.body?.requestNumber === 'string'
                ? req.body.requestNumber
                : typeof req.body?.code === 'string'
                  ? req.body.code
                  : '';
          const detail = [method, path.split('?')[0], bodyHint].filter(Boolean).join(' · ').slice(0, 400);
          void this.prisma.systemActivityLog
            .create({
              data: {
                actorId,
                action,
                detail,
                module,
                method,
                path: path.split('?')[0].slice(0, 240),
              },
            })
            .catch(() => {
              /* never break the request for audit write failures */
            });
        },
      }),
    );
  }
}
