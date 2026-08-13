/**
 * Shared human-readable activity descriptions for Daily Activity (Scope of Work)
 * and System Overview (Detail). Keep wording business-friendly and consistent.
 */

export type ActivityAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'UPLOAD'
  | 'APPROVE'
  | 'REJECT'
  | 'SUBMIT'
  | 'IMPORT'
  | 'EXPORT'
  | string;

export type ActivityContext = {
  siteName?: string | null;
  projectName?: string | null;
  segmentName?: string | null;
  objectName?: string | null;
  category?: string | null;
  amount?: number | string | null;
  fromAmount?: number | string | null;
  toAmount?: number | string | null;
  fileName?: string | null;
  docName?: string | null;
};

const SCOPE_HINTS: Array<{ match: RegExp; kind: string }> = [
  { match: /financial-requests|\/transactions/i, kind: 'financial_request' },
  { match: /implementation-logs|mark-implementation-done/i, kind: 'implementation' },
  { match: /advance-phase/i, kind: 'phase_advance' },
  { match: /survey-uploads|survey-sites|submit-survey|review-survey/i, kind: 'survey' },
  { match: /drm-documents/i, kind: 'drm' },
  { match: /\/spans\/[^/]+\/logs|span-logs|\/logs/i, kind: 'daily_log' },
  { match: /\/spans(?!\/)/i, kind: 'span' },
  { match: /recon-docs/i, kind: 'recon' },
  { match: /closing-logs|confirm-maintenance/i, kind: 'closing' },
  { match: /po-customer/i, kind: 'po_customer' },
  { match: /plan-import|\/planning|\/budget|\/timeline/i, kind: 'finance_plan' },
  { match: /beginning-groups|\/endings|available-finance-sites/i, kind: 'site_relation' },
  { match: /\/sites(?!-)/i, kind: 'site' },
  { match: /documents|jaminan|sanggah/i, kind: 'document' },
  { match: /cash-operation/i, kind: 'cash' },
  { match: /orders|purchase|stock|supplier/i, kind: 'ops' },
];

function fmtIdr(n: number | string | null | undefined): string | null {
  if (n == null || n === '') return null;
  const num = typeof n === 'string' ? Number(n) : n;
  if (!Number.isFinite(num)) return null;
  return `Rp${Math.round(num).toLocaleString('id-ID')}`;
}

function q(name: string | null | undefined): string {
  const t = (name || '').trim();
  return t ? `"${t}"` : '';
}

function targetLabel(ctx: ActivityContext): string {
  if (ctx.siteName) return q(ctx.siteName);
  if (ctx.projectName) return q(ctx.projectName);
  if (ctx.objectName) return q(ctx.objectName);
  return '';
}

export function actionFromMethod(method: string, path: string): ActivityAction {
  const p = path.toLowerCase();
  if (p.includes('approve') || p.includes('/accept')) return 'APPROVE';
  if (p.includes('reject') || p.includes('decline')) return 'REJECT';
  if (p.includes('upload') || p.includes('evidence') || p.includes('document') || p.includes('/logs')) {
    return 'UPLOAD';
  }
  if (p.includes('import')) return 'IMPORT';
  if (p.includes('export') || p.includes('download') || p.includes('report')) return 'EXPORT';
  if (p.includes('submit')) return 'SUBMIT';
  if (p.includes('disburse')) return 'UPDATE';
  if (method === 'POST') return 'CREATE';
  if (method === 'PUT' || method === 'PATCH') return 'UPDATE';
  if (method === 'DELETE') return 'DELETE';
  return method;
}

function detectKind(path: string): string {
  for (const h of SCOPE_HINTS) {
    if (h.match.test(path)) return h.kind;
  }
  return 'generic';
}

function categoryLabel(cat?: string | null): string {
  if (!cat) return '';
  const map: Record<string, string> = {
    PERIZINAN: 'Perizinan',
    MATERIAL: 'Material',
    JASA: 'Jasa',
    LAIN_LAIN: 'Lain-Lain',
  };
  return map[cat.toUpperCase()] || cat.replace(/_/g, ' ');
}

/** Build consistent Scope of Work / Detail text. */
export function buildActivityDescription(
  method: string,
  path: string,
  ctx: ActivityContext = {},
): string {
  const action = actionFromMethod(method, path);
  const kind = detectKind(path);
  const target = targetLabel(ctx);
  const amount = fmtIdr(ctx.amount);
  const cat = categoryLabel(ctx.category);
  const inSegment = ctx.segmentName ? ` in ${ctx.segmentName}` : '';

  switch (kind) {
    case 'financial_request': {
      const label = cat ? `Financial Request ${cat}` : 'Financial Request';
      if (action === 'APPROVE') {
        return [`Approve ${label}`, target ? `for ${target}` : '', amount ? `sebesar ${amount}` : '']
          .filter(Boolean)
          .join(' ');
      }
      if (action === 'REJECT') {
        return [`Reject ${label}`, target ? `for ${target}` : '', amount ? `sebesar ${amount}` : '']
          .filter(Boolean)
          .join(' ');
      }
      if (action === 'SUBMIT') {
        return [`Submit ${label}`, target ? `for ${target}` : '', amount ? `sebesar ${amount}` : '']
          .filter(Boolean)
          .join(' ');
      }
      if (action === 'UPDATE') {
        return [`Update ${label}`, target ? `for ${target}` : '', amount ? `sebesar ${amount}` : '']
          .filter(Boolean)
          .join(' ');
      }
      return [`Create ${label}`, target ? `for ${target}` : '', amount ? `sebesar ${amount}` : '']
        .filter(Boolean)
        .join(' ');
    }
    case 'daily_log':
      return target ? `Upload Daily Log for ${target}` : 'Upload Daily Log';
    case 'implementation':
      if (path.toLowerCase().includes('mark-implementation-done')) {
        return target ? `Complete Implementation Lapangan for ${target}` : 'Complete Implementation Lapangan';
      }
      return target ? `Upload Implementation Log for ${target}` : 'Upload Implementation Log';
    case 'phase_advance':
      return target
        ? `Submit Phase Advance for ${target}`
        : ctx.projectName
          ? `Submit Phase Advance for ${q(ctx.projectName)}`
          : 'Submit Phase Advance';
    case 'survey':
      if (path.toLowerCase().includes('review')) {
        return target ? `Review Survey for ${target}` : 'Review Survey';
      }
      if (path.toLowerCase().includes('submit')) {
        return target ? `Submit Survey Review for ${target}` : 'Submit Survey Review';
      }
      return target ? `Upload Dokumen Survey for ${target}` : 'Upload Dokumen Survey';
    case 'drm':
      return target ? `Upload DRM Document for ${target}` : 'Upload DRM Document';
    case 'span':
      return target ? `Create new Segment ${target}` : 'Create new Segment';
    case 'site':
    case 'site_relation': {
      if (path.toLowerCase().includes('beginning')) {
        return target ? `Add Beginning Site ${target}` : 'Add Beginning Site';
      }
      if (path.toLowerCase().includes('complete') || path.toLowerCase().includes('endings')) {
        return target
          ? `Complete Ending Sites for Beginning ${target}`
          : 'Complete Ending Site selection';
      }
      if (action === 'DELETE') {
        return target
          ? `Delete Site ${target}${ctx.segmentName ? ` from ${ctx.segmentName}` : ''}`
          : 'Delete Site relationship';
      }
      return target
        ? `Create new Site ${target}${inSegment}`
        : 'Create new Site';
    }
    case 'recon':
      return target ? `Upload Reconciliation Doc for ${target}` : 'Upload Reconciliation Doc';
    case 'closing':
      return target ? `Upload Closing Log for ${target}` : 'Upload Closing Log';
    case 'po_customer':
      return target ? `Update PO Customer for ${target}` : 'Update PO Customer';
    case 'finance_plan': {
      if (path.toLowerCase().includes('budget')) {
        const from = fmtIdr(ctx.fromAmount);
        const to = fmtIdr(ctx.toAmount ?? ctx.amount);
        if (from && to) {
          return target
            ? `Update Material Budget for ${target} from ${from} to ${to}`
            : `Update Material Budget from ${from} to ${to}`;
        }
        return target ? `Input Material Budget for ${target}` : 'Input Material Budget';
      }
      return target ? `Update Planning for ${target}` : 'Update Planning';
    }
    case 'document': {
      const doc = ctx.docName || ctx.fileName;
      if (action === 'UPLOAD' || action === 'CREATE') {
        return target
          ? `Upload ${doc ? doc + ' ' : 'Dokumen '}for ${target}`.replace(/\s+/g, ' ').trim()
          : `Upload ${doc || 'Dokumen'}`;
      }
      break;
    }
    default:
      break;
  }

  // Generic fallback — still human readable, never raw API path
  const verb =
    action === 'CREATE'
      ? 'Create'
      : action === 'UPDATE'
        ? 'Update'
        : action === 'DELETE'
          ? 'Delete'
          : action === 'UPLOAD'
            ? 'Upload'
            : action === 'APPROVE'
              ? 'Approve'
              : action === 'REJECT'
                ? 'Reject'
                : action === 'SUBMIT'
                  ? 'Submit'
                  : action;
  const object = ctx.objectName || ctx.docName || 'data';
  return [verb, object, target ? `for ${target}` : '', amount ? `sebesar ${amount}` : '']
    .filter(Boolean)
    .join(' ')
    .slice(0, 400);
}

/** Frontend route for System Overview click-through (no basePath prefix). */
export function buildEntityHref(path: string, ids: {
  ftttProjectId?: string | null;
  financeProjectId?: string | null;
  transactionId?: string | null;
  dailyActivityHint?: boolean;
}): string | null {
  const clean = path.split('?')[0];
  if (ids.transactionId || /\/financial-requests|\/transactions\//i.test(clean)) {
    if (ids.ftttProjectId) return `/fttt-projects/${ids.ftttProjectId}`;
    return '/approval-dana';
  }
  if (ids.ftttProjectId) return `/fttt-projects/${ids.ftttProjectId}`;
  if (ids.financeProjectId) return `/finance-projects/${ids.financeProjectId}`;
  if (/\/daily-activit/i.test(clean) || ids.dailyActivityHint) return '/daily-activity';
  if (/\/cash-operation/i.test(clean)) return '/cash-operation';
  if (/\/orders/i.test(clean)) return '/orders';
  if (/\/visit/i.test(clean)) return '/visit-requests';
  if (/\/stock/i.test(clean)) return '/stock';
  if (/\/suppliers/i.test(clean)) return '/suppliers';
  return null;
}
