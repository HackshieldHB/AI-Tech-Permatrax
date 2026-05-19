"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WAITING_INPUT_STALE_DAYS = exports.LLD_IMMUTABLE_SNAPSHOT_STATES = exports.HLD_IMMUTABLE_SNAPSHOT_STATES = exports.LLD_STATE_TRANSITIONS = exports.HLD_STATE_TRANSITIONS = exports.LLD_SUBMIT_STATES = exports.HLD_SUBMIT_STATES = exports.LLD_UPLOAD_STATES = exports.HLD_UPLOAD_STATES = exports.LLD_STATUS = exports.HLD_STATUS = void 0;
exports.isValidHldTransition = isValidHldTransition;
exports.isValidLldTransition = isValidLldTransition;
exports.canUploadHld = canUploadHld;
exports.canUploadLld = canUploadLld;
exports.canSubmitHld = canSubmitHld;
exports.canSubmitLld = canSubmitLld;
exports.isSnapshotImmutableHld = isSnapshotImmutableHld;
exports.isSnapshotImmutableLld = isSnapshotImmutableLld;
exports.createStateTransitionLog = createStateTransitionLog;
exports.createStateViolationLog = createStateViolationLog;
exports.createStateTimeoutLog = createStateTimeoutLog;
exports.createSnapshotViolationLog = createSnapshotViolationLog;
exports.createDocWarningLog = createDocWarningLog;
exports.createFileIntegrityLog = createFileIntegrityLog;
exports.formatStateTransitionLog = formatStateTransitionLog;
exports.formatStateViolationLog = formatStateViolationLog;
exports.formatStateTimeoutLog = formatStateTimeoutLog;
exports.formatSnapshotViolationLog = formatSnapshotViolationLog;
exports.formatDocWarningLog = formatDocWarningLog;
exports.isIdempotentTransition = isIdempotentTransition;
exports.shouldSkipTransition = shouldSkipTransition;
exports.HLD_STATUS = {
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
};
exports.LLD_STATUS = {
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
};
exports.HLD_UPLOAD_STATES = [
    exports.HLD_STATUS.WAITING_INPUT,
    exports.HLD_STATUS.DRAFT,
    exports.HLD_STATUS.ISP_REVISION,
    exports.HLD_STATUS.PM_REJECTED,
    exports.HLD_STATUS.ADMIN_REJECTED,
];
exports.LLD_UPLOAD_STATES = [
    exports.LLD_STATUS.WAITING_INPUT,
    exports.LLD_STATUS.DRAFT,
    exports.LLD_STATUS.ISP_REVISION,
    exports.LLD_STATUS.PM_REJECTED,
    exports.LLD_STATUS.ADMIN_REJECTED,
];
exports.HLD_SUBMIT_STATES = [
    exports.HLD_STATUS.WAITING_INPUT,
    exports.HLD_STATUS.DRAFT,
    exports.HLD_STATUS.ISP_REVISION,
    exports.HLD_STATUS.PM_REJECTED,
    exports.HLD_STATUS.ADMIN_REJECTED,
];
exports.LLD_SUBMIT_STATES = [
    exports.LLD_STATUS.WAITING_INPUT,
    exports.LLD_STATUS.DRAFT,
    exports.LLD_STATUS.ISP_REVISION,
    exports.LLD_STATUS.PM_REJECTED,
    exports.LLD_STATUS.ADMIN_REJECTED,
];
exports.HLD_STATE_TRANSITIONS = {
    [exports.HLD_STATUS.WAITING_INPUT]: [exports.HLD_STATUS.DRAFT],
    [exports.HLD_STATUS.DRAFT]: [exports.HLD_STATUS.SUBMITTED_FOR_REVIEW],
    [exports.HLD_STATUS.SUBMITTED_FOR_REVIEW]: [exports.HLD_STATUS.PM_APPROVED, exports.HLD_STATUS.PM_REJECTED],
    [exports.HLD_STATUS.PM_APPROVED]: [exports.HLD_STATUS.ADMIN_APPROVED, exports.HLD_STATUS.ADMIN_REJECTED],
    [exports.HLD_STATUS.PM_REJECTED]: [exports.HLD_STATUS.DRAFT],
    [exports.HLD_STATUS.ADMIN_APPROVED]: [exports.HLD_STATUS.PENDING_ISP],
    [exports.HLD_STATUS.ADMIN_REJECTED]: [exports.HLD_STATUS.DRAFT],
    [exports.HLD_STATUS.PENDING_ISP]: [exports.HLD_STATUS.ISP_APPROVED, exports.HLD_STATUS.ISP_REVISION],
    [exports.HLD_STATUS.ISP_REVISION]: [exports.HLD_STATUS.DRAFT],
    [exports.HLD_STATUS.ISP_APPROVED]: [],
};
exports.LLD_STATE_TRANSITIONS = {
    [exports.LLD_STATUS.WAITING_INPUT]: [exports.LLD_STATUS.DRAFT],
    [exports.LLD_STATUS.DRAFT]: [exports.LLD_STATUS.SUBMITTED_FOR_REVIEW],
    [exports.LLD_STATUS.SUBMITTED_FOR_REVIEW]: [exports.LLD_STATUS.PM_APPROVED, exports.LLD_STATUS.PM_REJECTED],
    [exports.LLD_STATUS.PM_APPROVED]: [exports.LLD_STATUS.ADMIN_APPROVED, exports.LLD_STATUS.ADMIN_REJECTED],
    [exports.LLD_STATUS.PM_REJECTED]: [exports.LLD_STATUS.DRAFT],
    [exports.LLD_STATUS.ADMIN_APPROVED]: [exports.LLD_STATUS.PENDING_ISP],
    [exports.LLD_STATUS.ADMIN_REJECTED]: [exports.LLD_STATUS.DRAFT],
    [exports.LLD_STATUS.PENDING_ISP]: [exports.LLD_STATUS.ISP_APPROVED, exports.LLD_STATUS.ISP_REVISION],
    [exports.LLD_STATUS.ISP_REVISION]: [exports.LLD_STATUS.DRAFT],
    [exports.LLD_STATUS.ISP_APPROVED]: [],
};
exports.HLD_IMMUTABLE_SNAPSHOT_STATES = [
    exports.HLD_STATUS.PM_APPROVED,
    exports.HLD_STATUS.ADMIN_APPROVED,
    exports.HLD_STATUS.PENDING_ISP,
    exports.HLD_STATUS.ISP_APPROVED,
    exports.HLD_STATUS.ISP_REVISION,
];
exports.LLD_IMMUTABLE_SNAPSHOT_STATES = [
    exports.LLD_STATUS.PM_APPROVED,
    exports.LLD_STATUS.ADMIN_APPROVED,
    exports.LLD_STATUS.PENDING_ISP,
    exports.LLD_STATUS.ISP_APPROVED,
    exports.LLD_STATUS.ISP_REVISION,
];
exports.WAITING_INPUT_STALE_DAYS = 7;
function isValidHldTransition(from, to) {
    const allowed = exports.HLD_STATE_TRANSITIONS[from] || [];
    return allowed.includes(to);
}
function isValidLldTransition(from, to) {
    const allowed = exports.LLD_STATE_TRANSITIONS[from] || [];
    return allowed.includes(to);
}
function canUploadHld(status) {
    return exports.HLD_UPLOAD_STATES.includes(status);
}
function canUploadLld(status) {
    return exports.LLD_UPLOAD_STATES.includes(status);
}
function canSubmitHld(status) {
    return exports.HLD_SUBMIT_STATES.includes(status);
}
function canSubmitLld(status) {
    return exports.LLD_SUBMIT_STATES.includes(status);
}
function isSnapshotImmutableHld(status) {
    return exports.HLD_IMMUTABLE_SNAPSHOT_STATES.includes(status);
}
function isSnapshotImmutableLld(status) {
    return exports.LLD_IMMUTABLE_SNAPSHOT_STATES.includes(status);
}
function createStateTransitionLog(entity, id, userId, role, from, to, requestId) {
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
function createStateViolationLog(entity, id, userId, role, from, attemptedTo) {
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
function createStateTimeoutLog(entity, id, state, daysInactive, isStale) {
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
function createSnapshotViolationLog(entity, id, attemptedFields, currentStatus, userId) {
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
function createDocWarningLog(entity, id, missing, fallback) {
    return {
        event: 'DOC_WARNING',
        entity,
        id,
        missing,
        fallback,
        timestamp: new Date().toISOString(),
    };
}
function createFileIntegrityLog(entity, id, fileType, fileUrl, valid, error) {
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
function formatStateTransitionLog(entity, entityId, userId, role, fromState, toState) {
    return `[STATE TRANSITION] entity=${entity} id=${entityId} user=${userId} role=${role} from=${fromState} to=${toState}`;
}
function formatStateViolationLog(entity, entityId, fromState, toState, context) {
    return `[STATE VIOLATION] entity=${entity} id=${entityId} from=${fromState} to=${toState} context=${context}`;
}
function formatStateTimeoutLog(entity, entityId, state, daysInactive) {
    return `[STATE TIMEOUT] entity=${entity} id=${entityId} state=${state} daysInactive=${daysInactive}`;
}
function formatSnapshotViolationLog(entity, entityId, attemptedField, currentStatus) {
    return `[SNAPSHOT VIOLATION] entity=${entity} id=${entityId} attempted=${attemptedField} status=${currentStatus}`;
}
function formatDocWarningLog(entity, entityId, missingField) {
    return `[DOC WARNING] entity=${entity} id=${entityId} missing=${missingField}`;
}
function isIdempotentTransition(currentState, targetState) {
    return currentState === targetState;
}
function shouldSkipTransition(currentState, targetState) {
    if (currentState === targetState) {
        return { skip: true, reason: 'Already in target state' };
    }
    return { skip: false };
}
//# sourceMappingURL=pipelineStates.js.map