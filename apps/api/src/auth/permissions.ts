import { Role } from '@prisma/client';

// MODIFIED: Centralized permission matrix — Phase 1–5
export const PERMISSIONS = {
  // ─── PHASE 2: Clean List / Visit / BA Open ───────────────────────────────

  // Clean list management — FIX: official flow allows PM to import from ISP
  CLEAN_LIST_IMPORT: [Role.GENERAL_MANAGER, Role.ADMIN, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR], // FIX: Admin can bulk-import clean list alongside PM roles
  CLEAN_LIST_VIEW: [
    Role.ADMIN,
    Role.GENERAL_MANAGER, Role.PM_SENIOR, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT,
    Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT,
  ],

  // Request visit — surveyors create, PMs review, PM Senior / Admin approve
  REQUEST_VISIT_CREATE: [Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT],
  /** PM gate: approve/reject visit schedule before surveyor goes to field */
  REQUEST_VISIT_GATE_REVIEW: [Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR],
  /** PM gate: review submitted survey result (after lapangan) */
  REQUEST_VISIT_REVIEW: [Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR], // FIX: PM Senior shares PM review step per official chain
  REQUEST_VISIT_APPROVE: [Role.PM_SENIOR, Role.ADMIN],

  // BA Open — auto-generated, viewable by team and above
  BA_OPEN_VIEW: [
    Role.GENERAL_MANAGER, Role.PM_SENIOR, Role.ADMIN,
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT,
    Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT, // FIX: surveyors must read BA Open / visit-request-linked docs
  ],
  BA_OPEN_APPROVE: [Role.PM_SENIOR, Role.ADMIN],

  // MODIFIED: Legacy design keys — kept for backward compatibility
  DESIGN_CREATE: [Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT],
  DESIGN_APPROVE: [Role.PM_SENIOR],

  // MODIFIED: Legacy document keys — kept alongside Phase 5 DOCUMENT_* keys
  DOC_LIST_VIEW: [Role.ADMIN, Role.PM_SENIOR, Role.GENERAL_MANAGER],
  DOC_EMAIL_SEND: [Role.ADMIN, Role.PM_SENIOR],

  // NEW: Phase 5 — APD / ABD
  APD_CREATE: [Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT],
  APD_VIEW: [
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR,
    Role.ADMIN, Role.GENERAL_MANAGER,
  ],
  DRM_APPROVE: [Role.PM_SENIOR],
  ABD_SUBMIT: [Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT],
  ABD_APPROVE: [Role.PM_SENIOR, Role.GENERAL_MANAGER],

  // NEW: Phase 5 — Socialization
  SOCIALIZATION_CREATE: [
    Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT,
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT,
  ],
  SOCIALIZATION_VIEW: [
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR,
    Role.ADMIN, Role.GENERAL_MANAGER,
  ],

  // NEW: Phase 5 — Compensation / BAK
  COMPENSATION_CREATE: [
    Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT,
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT,
  ],
  BAK_APPROVE: [Role.PM_SENIOR, Role.GENERAL_MANAGER],

  // NEW: Phase 5 — Signatures
  SIGNATURE_UPLOAD: [
    Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT,
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT,
  ],
  SIGNATURE_VALIDATE: [Role.ADMIN, Role.PM_SENIOR],

  // NEW: Phase 5 — SCOM
  SCOM_CREATE: [
    Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT,
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT,
  ],

  // NEW: Phase 5 — BAKP
  BAKP_COMPILE: [Role.ADMIN, Role.PM_SENIOR],
  BAKP_PAYMENT_UPLOAD: [Role.FINANCE],
  BAKP_VALIDATE: [Role.ADMIN],
  BAKP_APPROVE: [Role.ADMIN],
  HLD_SUBMIT: [Role.DESIGNER, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR], // FIX Issue 10: Designer is the primary HLD submitter
  LLD_SUBMIT: [Role.DESIGNER, Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR], // FIX Issue 10: Designer is the primary LLD submitter
  HLD_APPROVE: [Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR, Role.ADMIN], // FIX: explicit HLD approval chain permission
  LLD_APPROVE: [Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR, Role.ADMIN], // FIX: explicit LLD approval chain permission
  SIP_CREATE: [ // FIX: official flow — surveyor/PM/admin can create/init SIP
    Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT,
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR, Role.ADMIN,
  ],
  SIP_VIEW: [ // FIX: official flow — broad SIP visibility incl. surveyor and GM
    Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT,
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR,
    Role.ADMIN, Role.GENERAL_MANAGER,
  ],

  // NEW: Phase 5 — Document list + email (ACC bundle)
  DOCUMENT_LIST_VIEW: [
    Role.ADMIN, Role.PM_SENIOR, Role.GENERAL_MANAGER,
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT,
    Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT, // FIX: surveyor visibility
    Role.DESIGNER, // FIX: designer pipeline docs
    Role.FINANCE, // FIX: finance oversight
    Role.ADMIN_STOCK, // FIX: stock admin
    Role.OPERATIONAL_MANAGER, // FIX: ops
  ],
  DOCUMENT_EMAIL_SEND: [
    Role.ADMIN, Role.PM_SENIOR, // FIX: senior send
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, // FIX: PM fiber leads
  ],

  // NEW: Phase 5 — Permit cluster registry (non-Finance)
  PERMIT_CLUSTER_VIEW: [
    Role.GENERAL_MANAGER, Role.PM_SENIOR, Role.ADMIN,
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT,
    Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT,
    Role.ADMIN_STOCK,
    Role.OPERATIONAL_MANAGER, // FIX: ops can monitor pipeline
    Role.DESIGNER, // FIX Issue 10: designer must view the pipeline to access HLD/LLD pages
  ],

  // GIS map — all roles can view
  MAP_VIEW: Object.values(Role) as Role[],
  MAP_MARK_EXISTING: [
    Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT,
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT,
  ],

  /** GIS network design draft create/list/detail/archive (calc → persisted topology) */
  // FIX MAP_VIEWER: JLM users access Saved Design menu on GIS Maps.
  // Without this, GET /design returns 403 instead of an empty list.
  // The list endpoint already filters by createdBy so JLM only sees their own designs.
  NETWORK_DESIGN: [
    Role.DESIGNER,
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.PM_SENIOR,
    Role.ADMIN,
    Role.MAP_VIEWER, // FIX: allow Saved Design list/view/create/delete for JLM scope
  ],

  // ─── PHASE 3: Stock / Order / Surat Jalan / Purchase Request ─────────────

  STOCK_VIEW: Object.values(Role) as Role[],
  STOCK_MANAGE: [Role.ADMIN_STOCK, Role.GENERAL_MANAGER],

  ORDER_CREATE: [Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR, Role.ADMIN_STOCK],
  ORDER_VIEW: [
    Role.ADMIN,
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR,
    Role.ADMIN_STOCK, Role.FINANCE, Role.GENERAL_MANAGER,
    Role.OPERATIONAL_MANAGER,
    Role.PURCHASING,
  ],

  /** Phase 3 — cancel order (service enforces state + ownership) */
  ORDER_CANCEL: [
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.PM_SENIOR,
    Role.ADMIN_STOCK,
    Role.FINANCE,
    Role.GENERAL_MANAGER,
    Role.ADMIN,
  ],

  SURAT_JALAN_VIEW: [
    Role.ADMIN,
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR,
    Role.ADMIN_STOCK, Role.FINANCE, Role.GENERAL_MANAGER,
  ],
  SURAT_JALAN_CONFIRM: [Role.ADMIN_STOCK],

  PURCHASE_REQUEST_VIEW: [
    Role.ADMIN,
    Role.FINANCE, Role.PM_SENIOR, Role.GENERAL_MANAGER,
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT,
  ],
  PURCHASE_REQUEST_PROCESS: [Role.FINANCE],

  STOCK_SETTINGS: [Role.GENERAL_MANAGER],

  // NEW: Cash Operation — submit access // FIX: all operational roles can create cash op / reimbursement
  CASH_OP_SUBMIT: [
    Role.SURVEYOR_FTTH, Role.SURVEYOR_FTTB, Role.SURVEYOR_FTTT,
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR,
    Role.DESIGNER, // FIX: designer chain submits cash op
    Role.MARKETING, Role.MARKETING_HEAD,
    Role.ADMIN, Role.ADMIN_STOCK, Role.GENERAL_MANAGER, Role.FINANCE, Role.OPERATIONAL_MANAGER,
  ],

  // NEW: Cash Operation — visibility scope
  CASH_OP_VIEW_ALL: [
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR,
    Role.ADMIN, Role.OPERATIONAL_MANAGER, Role.GENERAL_MANAGER,
    Role.FINANCE, Role.MARKETING_HEAD,
  ],

  // NEW: Cash Operation — approvers by chain level // FIX: align with full approval chain roles
  CASH_OP_APPROVE: [
    Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR,
    Role.DESIGNER,
    Role.ADMIN, Role.ADMIN_STOCK, Role.OPERATIONAL_MANAGER, Role.GENERAL_MANAGER,
    Role.FINANCE, Role.MARKETING_HEAD,
  ],

  /** Cash Advance Stage 2 — realization approval (used in M3+) */
  CASH_OP_REALISASI_FINANCE_APPROVE: [Role.FINANCE],
  CASH_OP_REALISASI_MANAGER_APPROVE: [Role.MARKETING_HEAD, Role.OPERATIONAL_MANAGER],
  CASH_OP_REALISASI_GM_APPROVE: [Role.GENERAL_MANAGER],

  /** Finance dashboard — budget projects (list/detail for finance ops + order/cash-op submitters) */
  FINANCE_PROJECT_VIEW: [
    Role.FINANCE,
    Role.GENERAL_MANAGER,
    Role.ADMIN,
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.PM_SENIOR,
    Role.SURVEYOR_FTTH,
    Role.SURVEYOR_FTTB,
    Role.SURVEYOR_FTTT,
    Role.DESIGNER,
    Role.MARKETING,
    Role.MARKETING_HEAD,
    Role.ADMIN_STOCK,
    Role.OPERATIONAL_MANAGER,
  ],
  FINANCE_PROJECT_MANAGE: [Role.FINANCE, Role.GENERAL_MANAGER],
  BUDGET_TRANSFER_SUBMIT: [Role.FINANCE],
  BUDGET_TRANSFER_APPROVE: [Role.GENERAL_MANAGER],
  /** Daftar / detail transfer (inbox GM, daftar Finance, oversight Admin) */
  BUDGET_TRANSFER_VIEW: [Role.FINANCE, Role.GENERAL_MANAGER, Role.ADMIN],
  FINANCE_REPORT_EXPORT: [Role.FINANCE, Role.GENERAL_MANAGER, Role.ADMIN],

  // Phase 3 — Purchasing / suppliers / Tagihan / PO email / StockOut (used from M2+)
  PURCHASING_VIEW: [Role.PURCHASING, Role.GENERAL_MANAGER, Role.ADMIN, Role.FINANCE],
  PURCHASING_SUBMIT_PRICE: [Role.PURCHASING],

  SUPPLIER_VIEW: [Role.PURCHASING, Role.FINANCE, Role.GENERAL_MANAGER, Role.ADMIN, Role.ADMIN_STOCK],
  SUPPLIER_MANAGE: [Role.PURCHASING, Role.FINANCE, Role.ADMIN],

  SUPPLIER_INVOICE_UPLOAD: [Role.FINANCE],
  /** Issue #47: view extended untuk konteks order (verify receipt, approval, PM creator); mutasi tetap Finance/Purchasing. */
  SUPPLIER_INVOICE_VIEW: [
    Role.FINANCE,
    Role.PURCHASING,
    Role.GENERAL_MANAGER,
    Role.ADMIN,
    Role.ADMIN_STOCK,
    Role.OPERATIONAL_MANAGER,
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.PM_SENIOR,
  ],
  SUPPLIER_INVOICE_SEND_EMAIL: [Role.FINANCE],
  SUPPLIER_INVOICE_SUPPLIER_ACK: [Role.FINANCE],

  ORDER_PO_SEND_EMAIL: [Role.PURCHASING],

  STOCK_OUT_REQUEST: [Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT, Role.PM_SENIOR, Role.ADMIN_STOCK],
  STOCK_OUT_FULFILL: [Role.ADMIN_STOCK],
  STOCK_OUT_FINANCE: [Role.FINANCE],

  /** Stock out list/detail + inbox count (PM/Admin Stock/Finance/oversight) */
  STOCK_OUT_VIEW: [
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.PM_SENIOR,
    Role.ADMIN_STOCK,
    Role.FINANCE,
    Role.ADMIN,
    Role.GENERAL_MANAGER,
  ],

  ORDER_CREATE_RESTOCK: [Role.ADMIN_STOCK],
} as const;
