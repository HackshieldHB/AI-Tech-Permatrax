/**
 * SHARED PIPELINE STATE CONSTANTS
 * 
 * DO NOT MODIFY without coordinating frontend and backend changes.
 * These constants are the SINGLE SOURCE OF TRUTH for pipeline states.
 */

// ============================================
// HLD STATUSES
// ============================================
export const HLD_STATUS = {
  WAITING_INPUT: 'WAITING_INPUT',
  DRAFT: 'DRAFT',
  SUBMITTED_FOR_REVIEW: 'SUBMITTED_FOR_REVIEW',
  PM_APPROVED: 'PM_APPROVED',
  PM_REJECTED: 'PM_REJECTED',
  ADMIN_APPROVED: 'ADMIN_APPROVED',
  ADMIN_REJECTED: 'ADMIN_REJECTED',
  PENDING_ISP: 'PENDING_ISP',
  ISP_REVISION: 'ISP_REVISION',
  ISP_APPROVED: 'ISP_APPROVED',
} as const;

export type HldStatus = typeof HLD_STATUS[keyof typeof HLD_STATUS];

// ============================================
// LLD STATUSES
// ============================================
export const LLD_STATUS = {
  WAITING_INPUT: 'WAITING_INPUT',
  DRAFT: 'DRAFT',
  SUBMITTED_FOR_REVIEW: 'SUBMITTED_FOR_REVIEW',
  PM_APPROVED: 'PM_APPROVED',
  PM_REJECTED: 'PM_REJECTED',
  ADMIN_APPROVED: 'ADMIN_APPROVED',
  ADMIN_REJECTED: 'ADMIN_REJECTED',
  PENDING_ISP: 'PENDING_ISP',
  ISP_REVISION: 'ISP_REVISION',
  ISP_APPROVED: 'ISP_APPROVED',
} as const;

export type LldStatus = typeof LLD_STATUS[keyof typeof LLD_STATUS];

// ============================================
// ALLOWED STATES FOR ACTIONS
// ============================================

// States where Designer can upload files
export const HLD_UPLOAD_STATES: HldStatus[] = [
  HLD_STATUS.WAITING_INPUT,
  HLD_STATUS.DRAFT,
  HLD_STATUS.ISP_REVISION,
  HLD_STATUS.PM_REJECTED,
  HLD_STATUS.ADMIN_REJECTED,
];

export const LLD_UPLOAD_STATES: LldStatus[] = [
  LLD_STATUS.WAITING_INPUT,
  LLD_STATUS.DRAFT,
  LLD_STATUS.ISP_REVISION,
  LLD_STATUS.PM_REJECTED,
  LLD_STATUS.ADMIN_REJECTED,
];

// States where Designer can submit
export const HLD_SUBMIT_STATES: HldStatus[] = [
  HLD_STATUS.WAITING_INPUT,
  HLD_STATUS.DRAFT,
  HLD_STATUS.ISP_REVISION,
  HLD_STATUS.PM_REJECTED,
  HLD_STATUS.ADMIN_REJECTED,
];

export const LLD_SUBMIT_STATES: LldStatus[] = [
  LLD_STATUS.WAITING_INPUT,
  LLD_STATUS.DRAFT,
  LLD_STATUS.ISP_REVISION,
  LLD_STATUS.PM_REJECTED,
  LLD_STATUS.ADMIN_REJECTED,
];

// ============================================
// STATE TRANSITION MAP (Source of Truth)
// ============================================

export const HLD_STATE_TRANSITIONS: Record<HldStatus, HldStatus[]> = {
  [HLD_STATUS.WAITING_INPUT]: [HLD_STATUS.DRAFT],
  [HLD_STATUS.DRAFT]: [HLD_STATUS.SUBMITTED_FOR_REVIEW],
  [HLD_STATUS.SUBMITTED_FOR_REVIEW]: [HLD_STATUS.PM_APPROVED, HLD_STATUS.PM_REJECTED],
  [HLD_STATUS.PM_APPROVED]: [HLD_STATUS.ADMIN_APPROVED, HLD_STATUS.ADMIN_REJECTED],
  [HLD_STATUS.PM_REJECTED]: [HLD_STATUS.DRAFT],
  [HLD_STATUS.ADMIN_APPROVED]: [HLD_STATUS.PENDING_ISP],
  [HLD_STATUS.ADMIN_REJECTED]: [HLD_STATUS.DRAFT],
  [HLD_STATUS.PENDING_ISP]: [HLD_STATUS.ISP_APPROVED, HLD_STATUS.ISP_REVISION],
  [HLD_STATUS.ISP_REVISION]: [HLD_STATUS.DRAFT],
  [HLD_STATUS.ISP_APPROVED]: [], // Terminal state
};

export const LLD_STATE_TRANSITIONS: Record<LldStatus, LldStatus[]> = {
  [LLD_STATUS.WAITING_INPUT]: [LLD_STATUS.DRAFT],
  [LLD_STATUS.DRAFT]: [LLD_STATUS.SUBMITTED_FOR_REVIEW],
  [LLD_STATUS.SUBMITTED_FOR_REVIEW]: [LLD_STATUS.PM_APPROVED, LLD_STATUS.PM_REJECTED],
  [LLD_STATUS.PM_APPROVED]: [LLD_STATUS.ADMIN_APPROVED, LLD_STATUS.ADMIN_REJECTED],
  [LLD_STATUS.PM_REJECTED]: [LLD_STATUS.DRAFT],
  [LLD_STATUS.ADMIN_APPROVED]: [LLD_STATUS.PENDING_ISP],
  [LLD_STATUS.ADMIN_REJECTED]: [LLD_STATUS.DRAFT],
  [LLD_STATUS.PENDING_ISP]: [LLD_STATUS.ISP_APPROVED, LLD_STATUS.ISP_REVISION],
  [LLD_STATUS.ISP_REVISION]: [LLD_STATUS.DRAFT],
  [LLD_STATUS.ISP_APPROVED]: [], // Terminal state
};

// ============================================
// APPROVAL STATES (Snapshot immutability)
// ============================================

// States where snapshots should be immutable
export const HLD_IMMUTABLE_SNAPSHOT_STATES: HldStatus[] = [
  HLD_STATUS.PM_APPROVED,
  HLD_STATUS.ADMIN_APPROVED,
  HLD_STATUS.PENDING_ISP,
  HLD_STATUS.ISP_APPROVED,
  HLD_STATUS.ISP_REVISION,
];

export const LLD_IMMUTABLE_SNAPSHOT_STATES: LldStatus[] = [
  LLD_STATUS.PM_APPROVED,
  LLD_STATUS.ADMIN_APPROVED,
  LLD_STATUS.PENDING_ISP,
  LLD_STATUS.ISP_APPROVED,
  LLD_STATUS.ISP_REVISION,
];

// ============================================
// STATE AGING CONFIGURATION
// ============================================

// Days before WAITING_INPUT becomes stale
export const WAITING_INPUT_STALE_DAYS = 7;

// ============================================
// VALIDATION HELPERS
// ============================================

export function isValidHldTransition(from: HldStatus, to: HldStatus): boolean {
  const allowed = HLD_STATE_TRANSITIONS[from] || [];
  return allowed.includes(to);
}

export function isValidLldTransition(from: LldStatus, to: LldStatus): boolean {
  const allowed = LLD_STATE_TRANSITIONS[from] || [];
  return allowed.includes(to);
}

export function canUploadHld(status: HldStatus): boolean {
  return HLD_UPLOAD_STATES.includes(status);
}

export function canUploadLld(status: LldStatus): boolean {
  return LLD_UPLOAD_STATES.includes(status);
}

export function canSubmitHld(status: HldStatus): boolean {
  return HLD_SUBMIT_STATES.includes(status);
}

export function canSubmitLld(status: LldStatus): boolean {
  return LLD_SUBMIT_STATES.includes(status);
}

export function isSnapshotImmutableHld(status: HldStatus): boolean {
  return HLD_IMMUTABLE_SNAPSHOT_STATES.includes(status);
}

export function isSnapshotImmutableLld(status: LldStatus): boolean {
  return LLD_IMMUTABLE_SNAPSHOT_STATES.includes(status);
}

// ============================================
// STRUCTURED JSON LOGGING (Production-ready)
// ============================================

interface StateTransitionLog {
  event: 'STATE_TRANSITION';
  entity: 'HLD' | 'LLD';
  id: string;
  from: string;
  to: string;
  userId: string;
  role: string;
  requestId?: string;
  timestamp: string;
}

interface StateViolationLog {
  event: 'STATE_VIOLATION';
  entity: 'HLD' | 'LLD';
  id: string;
  from: string;
  attemptedTo: string;
  userId: string;
  role: string;
  timestamp: string;
}

interface StateTimeoutLog {
  event: 'STATE_TIMEOUT';
  entity: 'HLD' | 'LLD';
  id: string;
  state: string;
  daysInactive: number;
  isStale: boolean;
  timestamp: string;
}

interface SnapshotViolationLog {
  event: 'SNAPSHOT_VIOLATION';
  entity: 'HLD' | 'LLD';
  id: string;
  attemptedFields: string[];
  currentStatus: string;
  userId: string;
  timestamp: string;
}

interface DocWarningLog {
  event: 'DOC_WARNING';
  entity: string;
  id: string;
  missing: string;
  fallback: string;
  timestamp: string;
}

interface FileIntegrityLog {
  event: 'FILE_INTEGRITY';
  entity: 'HLD' | 'LLD';
  id: string;
  fileType: string;
  fileUrl: string;
  valid: boolean;
  error?: string;
  timestamp: string;
}

// Structured JSON log formatters
export function createStateTransitionLog(
  entity: 'HLD' | 'LLD',
  id: string,
  userId: string,
  role: string,
  from: string,
  to: string,
  requestId?: string
): StateTransitionLog {
  return {
    event: 'STATE_TRANSITION',
    entity,
    id,
    from,
    to,
    userId,
    role,
    requestId,
    timestamp: new Date().toISOString(),
  };
}

export function createStateViolationLog(
  entity: 'HLD' | 'LLD',
  id: string,
  userId: string,
  role: string,
  from: string,
  attemptedTo: string
): StateViolationLog {
  return {
    event: 'STATE_VIOLATION',
    entity,
    id,
    from,
    attemptedTo,
    userId,
    role,
    timestamp: new Date().toISOString(),
  };
}

export function createStateTimeoutLog(
  entity: 'HLD' | 'LLD',
  id: string,
  state: string,
  daysInactive: number,
  isStale: boolean
): StateTimeoutLog {
  return {
    event: 'STATE_TIMEOUT',
    entity,
    id,
    state,
    daysInactive,
    isStale,
    timestamp: new Date().toISOString(),
  };
}

export function createSnapshotViolationLog(
  entity: 'HLD' | 'LLD',
  id: string,
  attemptedFields: string[],
  currentStatus: string,
  userId: string
): SnapshotViolationLog {
  return {
    event: 'SNAPSHOT_VIOLATION',
    entity,
    id,
    attemptedFields,
    currentStatus,
    userId,
    timestamp: new Date().toISOString(),
  };
}

export function createDocWarningLog(
  entity: string,
  id: string,
  missing: string,
  fallback: string
): DocWarningLog {
  return {
    event: 'DOC_WARNING',
    entity,
    id,
    missing,
    fallback,
    timestamp: new Date().toISOString(),
  };
}

export function createFileIntegrityLog(
  entity: 'HLD' | 'LLD',
  id: string,
  fileType: string,
  fileUrl: string,
  valid: boolean,
  error?: string
): FileIntegrityLog {
  return {
    event: 'FILE_INTEGRITY',
    entity,
    id,
    fileType,
    fileUrl,
    valid,
    error,
    timestamp: new Date().toISOString(),
  };
}

// Legacy string formatters (for backward compatibility during transition)
export function formatStateTransitionLog(
  entity: string,
  entityId: string,
  userId: string,
  role: string,
  fromState: string,
  toState: string
): string {
  return `[STATE TRANSITION] entity=${entity} id=${entityId} user=${userId} role=${role} from=${fromState} to=${toState}`;
}

export function formatStateViolationLog(
  entity: string,
  entityId: string,
  fromState: string,
  toState: string,
  context: string
): string {
  return `[STATE VIOLATION] entity=${entity} id=${entityId} from=${fromState} to=${toState} context=${context}`;
}

export function formatStateTimeoutLog(
  entity: string,
  entityId: string,
  state: string,
  daysInactive: number
): string {
  return `[STATE TIMEOUT] entity=${entity} id=${entityId} state=${state} daysInactive=${daysInactive}`;
}

export function formatSnapshotViolationLog(
  entity: string,
  entityId: string,
  attemptedField: string,
  currentStatus: string
): string {
  return `[SNAPSHOT VIOLATION] entity=${entity} id=${entityId} attempted=${attemptedField} status=${currentStatus}`;
}

export function formatDocWarningLog(
  entity: string,
  entityId: string,
  missingField: string
): string {
  return `[DOC WARNING] entity=${entity} id=${entityId} missing=${missingField}`;
}

// ============================================
// IDEMPOTENCY HELPERS
// ============================================

export function isIdempotentTransition(currentState: string, targetState: string): boolean {
  return currentState === targetState;
}

export function shouldSkipTransition(currentState: string, targetState: string): { skip: boolean; reason?: string } {
  if (currentState === targetState) {
    return { skip: true, reason: 'Already in target state' };
  }
  return { skip: false };
}
