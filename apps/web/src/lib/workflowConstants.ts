/**
 * workflowConstants.ts
 * Defines the strict, multi-tier Maker-Checker Approval routing logic loops natively.
 */

export const WORKFLOW_PATHS = {
  // PATH 1: Standard Operational Flow linking multi-tier handoffs
  OPERATIONAL: [
    { stage: 'PENDING_ADMIN', role: 'ADMIN', action: 'INITIATE', label: 'Admin Initialization' },
    { stage: 'PENDING_FS', role: 'FIELD_SUPPORT', action: 'REVIEW', label: 'Field Support Review' },
    { stage: 'PENDING_ACK', role: 'ADMIN', action: 'ACKNOWLEDGE', label: 'Admin Acknowledgment' },
    { stage: 'READY_INVOICE', role: 'FINANCE', action: 'APPROVE', label: 'Invoice Generation' }
  ],
  
  // PATH 2: Escalated / Managerial Flow directly mapping abstract validations
  ESCALATED: [
    { stage: 'PENDING_ADMIN', role: 'ADMIN', action: 'INITIATE', label: 'Admin Escalation' },
    { stage: 'PENDING_MANAGER', role: 'REGIONAL_MANAGER', action: 'APPROVE', label: 'Managerial Approval' }
  ]
};

export const DOCUMENT_TYPES = {
  BA_SURVEY: 'BA_SURVEY',
  BAK: 'BAK',
  BAKP: 'BAKP',
  INVOICE: 'INVOICE'
};

export const STATUS_CODES = {
  IN_PROGRESS: 'IN_PROGRESS',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED'
};
