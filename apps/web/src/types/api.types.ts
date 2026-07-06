// NEW: Mirror of backend PaginatedResponse for frontend use
export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

// NEW: Common entity types matching Prisma output shapes
export type FiberType = 'FTTH' | 'FTTB' | 'FTTT';

export type Role =
  | 'SURVEYOR_FTTH' | 'SURVEYOR_FTTB' | 'SURVEYOR_FTTT'
  | 'PM_FTTH' | 'PM_FTTB' | 'PM_FTTT' | 'PM_SENIOR'
  | 'ADMIN' | 'ADMIN_STOCK' | 'FINANCE' | 'GENERAL_MANAGER' | 'PURCHASING'
  | 'MARKETING' | 'MARKETING_HEAD' | 'OPERATIONAL_MANAGER'; // NEW: cash operation roles

export const ROLE_LABELS: Record<Role, string> = { // NEW: role labels for shared UI usage
  SURVEYOR_FTTH: 'Surveyor FTTH',
  SURVEYOR_FTTB: 'Surveyor FTTB',
  SURVEYOR_FTTT: 'Surveyor FTTT',
  PM_FTTH: 'PM FTTH',
  PM_FTTB: 'PM FTTB',
  PM_FTTT: 'PM FTTT',
  PM_SENIOR: 'PM Senior',
  ADMIN: 'Admin',
  ADMIN_STOCK: 'Admin Stok',
  FINANCE: 'Finance',
  GENERAL_MANAGER: 'General Manager',
  PURCHASING: 'Purchasing',
  MARKETING: 'Marketing',
  MARKETING_HEAD: 'Marketing Head',
  OPERATIONAL_MANAGER: 'Operational Manager',
};

export type CleanListStatus =
  'AVAILABLE' | 'IN_PROGRESS' | 'HAS_EXISTING_FIBER' | 'COMPLETED' | 'REJECTED';

export type VisitRequestStatus =
  | 'DRAFT'
  | 'PM_REVIEW_VISIT'
  | 'APPROVED_PENDING_DATA'
  | 'PM_REVIEW_SURVEY'
  | 'PM_SENIOR_REVIEW'
  | 'ADMIN_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXISTING_FIBER';

// FIX: Updated to 20-phase permit lifecycle
export type PermitPhase =
  | 'CLUSTER_INTAKE' | 'VISIT_REQUEST' | 'BA_OPEN'
  | 'SITE_VISIT' | 'SURVEY_INPUT' | 'ROUTE_SURVEY'
  | 'BA_SURVEY' | 'SIP_REQUEST' | 'HLD_SUBMISSION' | 'LLD_SUBMISSION'
  | 'PR_BR_ISSUANCE' | 'CONTRACT_MANAGEMENT' | 'SKOM_BUDGET'
  | 'MANAGEMENT_APPROVAL' | 'FUND_DISBURSEMENT' | 'BAK_GENERATION'
  | 'BAKP_COMPILATION' | 'CLAIM_SUBMISSION' | 'INVOICE_PACKAGE'
  | 'PERMIT_DONE';

export type PermitClusterStatus = 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
export type OrderStatus =
  'DRAFT' | 'SUBMITTED' | 'STOCK_AVAILABLE' | 'PARTIAL_STOCK' |
  'NO_STOCK' | 'FULFILLED' | 'CANCELLED';
export type SuratJalanType = 'OUT' | 'IN';
export type SuratJalanStatus = 'GENERATED' | 'DISPATCHED' | 'CONFIRMED' | 'CANCELLED';
export type PurchaseRequestStatus =
  'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'ORDERED' | 'RECEIVED' | 'REJECTED' | 'CANCELLED';
export type BakpStatus =
  | 'DRAFT'
  | 'SUBMITTED_TO_PM'
  | 'PM_APPROVED'
  | 'SUBMITTED_TO_ADMIN'
  | 'ADMIN_APPROVED'
  | 'SUBMITTED_TO_ISP'
  | 'DONE'
  | 'REJECTED_BY_PM'
  | 'REJECTED_BY_ADMIN'
  | 'REJECTED_BY_ISP';

// NEW: Indonesian label maps (used in badges/displays throughout app)
export const PHASE_LABELS: Record<PermitPhase, string> = {
  CLUSTER_INTAKE: '1. Penerimaan Cluster',
  VISIT_REQUEST: '2. Request Kunjungan',
  BA_OPEN: '3. BA Open',
  SITE_VISIT: '4. Kunjungan Lapangan',
  SURVEY_INPUT: '5. Input Data Survey',
  ROUTE_SURVEY: '6. Survey Rute & Homepass',
  BA_SURVEY: '7. Berita Acara Survey',
  SIP_REQUEST: '8. SIP ke ISP',
  HLD_SUBMISSION: '9. High Level Drawing',
  LLD_SUBMISSION: '10. Low Level Drawing',
  PR_BR_ISSUANCE: '11. PR / BR',
  CONTRACT_MANAGEMENT: '12. Kontrak / PKS',
  SKOM_BUDGET: '13. Anggaran & RAB',
  MANAGEMENT_APPROVAL: '14. Persetujuan Manajemen',
  FUND_DISBURSEMENT: '15. Pencairan Dana',
  BAK_GENERATION: '16. BAK & Tanda Tangan',
  BAKP_COMPILATION: '17. Kompilasi BAKP',
  CLAIM_SUBMISSION: '18. Klaim Dokumen',
  INVOICE_PACKAGE: '19. Invoice & Penagihan',
  PERMIT_DONE: '20. Selesai ✓',
};

export const PHASE_ORDER: PermitPhase[] = [
  'CLUSTER_INTAKE', 'VISIT_REQUEST', 'BA_OPEN',
  'SITE_VISIT', 'SURVEY_INPUT', 'ROUTE_SURVEY',
  'BA_SURVEY', 'SIP_REQUEST', 'HLD_SUBMISSION', 'LLD_SUBMISSION',
  'PR_BR_ISSUANCE', 'CONTRACT_MANAGEMENT', 'SKOM_BUDGET',
  'MANAGEMENT_APPROVAL', 'FUND_DISBURSEMENT', 'BAK_GENERATION',
  'BAKP_COMPILATION', 'CLAIM_SUBMISSION', 'INVOICE_PACKAGE',
  'PERMIT_DONE',
];

// NEW: Short labels for compact table badges
export const PHASE_SHORT_LABELS: Record<PermitPhase, string> = {
  CLUSTER_INTAKE: 'Cluster',
  VISIT_REQUEST: 'Visit Req',
  BA_OPEN: 'BA Open',
  SITE_VISIT: 'Site Visit',
  SURVEY_INPUT: 'Survey',
  ROUTE_SURVEY: 'Rute',
  BA_SURVEY: 'BA Survey',
  SIP_REQUEST: 'SIP',
  HLD_SUBMISSION: 'HLD',
  LLD_SUBMISSION: 'LLD',
  PR_BR_ISSUANCE: 'PR/BR',
  CONTRACT_MANAGEMENT: 'Kontrak',
  SKOM_BUDGET: 'RAB/SKOM',
  MANAGEMENT_APPROVAL: 'Approval',
  FUND_DISBURSEMENT: 'Dana',
  BAK_GENERATION: 'BAK',
  BAKP_COMPILATION: 'BAKP',
  CLAIM_SUBMISSION: 'Klaim',
  INVOICE_PACKAGE: 'Invoice',
  PERMIT_DONE: 'Selesai',
};

// NEW: Phase groups for list page summary cards
export const PHASE_GROUPS = [
  {
    label: 'Survei & Perizinan Awal',
    phases: ['CLUSTER_INTAKE', 'VISIT_REQUEST', 'BA_OPEN', 'SITE_VISIT', 'SURVEY_INPUT', 'ROUTE_SURVEY', 'BA_SURVEY', 'SIP_REQUEST'] as PermitPhase[],
    color: '#F06A6A',
    bgColor: '#FDE8E8',
  },
  {
    label: 'Desain Teknis',
    phases: ['HLD_SUBMISSION', 'LLD_SUBMISSION'] as PermitPhase[],
    color: '#8B5CF6',
    bgColor: '#F5F3FF',
  },
  {
    label: 'Kontrak & Anggaran',
    phases: ['PR_BR_ISSUANCE', 'CONTRACT_MANAGEMENT', 'SKOM_BUDGET', 'MANAGEMENT_APPROVAL', 'FUND_DISBURSEMENT'] as PermitPhase[],
    color: '#F59E0B',
    bgColor: '#FFFBEB',
  },
  {
    label: 'Dokumen & Klaim',
    phases: ['BAK_GENERATION', 'BAKP_COMPILATION', 'CLAIM_SUBMISSION'] as PermitPhase[],
    color: '#EC4899',
    bgColor: '#FDF2F8',
  },
  {
    label: 'Invoice & Selesai',
    phases: ['INVOICE_PACKAGE', 'PERMIT_DONE'] as PermitPhase[],
    color: '#22C55E',
    bgColor: '#F0FDF4',
  },
] as const;

export interface SurveyorDocPackage { // NEW: surveyor document package
  id: string;
  permitClusterId: string;
  submittedBy: string;
  hasBaOpen: boolean;
  hasSurveyData: boolean;
  hasEvidencePhotos: boolean;
  hasRouteData: boolean;
  status: 'ASSEMBLING' | 'SUBMITTED' | 'PM_REVIEWING' | 'PM_REJECTED' | 'PM_APPROVED' | 'ADMIN_REVIEWING' | 'ADMIN_REJECTED' | 'ADMIN_APPROVED';
  pmNotes?: string;
  adminNotes?: string;
  submittedAt?: string;
  pmReviewedAt?: string;
  adminReviewedAt?: string;
}

export interface SurveyEvidence { // NEW: survey evidence with GPS
  id: string;
  surveyDataId: string;
  fileUrl: string;
  fileName: string;
  mimeType?: string;
  fileSize?: number;
  latitude?: number;
  longitude?: number;
  capturedAt?: string;
  uploadedAt: string;
  uploadedBy: string;
}

export interface IspEmailConfig { // NEW: ISP email config
  id: string;
  ispName: string;
  emailTo: string[];
  emailCc: string[];
  emailBcc: string[];
  smtpNotes?: string;
  updatedAt: string;
}

export interface BakpParticipant { // NEW: BAKP participant
  id: string;
  bakpId: string;
  name: string;
  role: string;
  ktpNumber?: string;
  ktpPhotoUrl?: string;
  signatureUrl?: string;
  createdAt: string;
}

// NEW: expanded lifecycle interfaces
export interface SurveyData {
  id: string;
  permitClusterId: string;
  conductedBy: string;
  conductedAt?: string;
  rtName?: string;
  rtPhone?: string;
  rwName?: string;
  rwPhone?: string;
  pengelolaName?: string;
  pengelolaPhone?: string;
  stakeholderNotes?: string;
  areaCondition?: string;
  accessDifficulty?: string;
  existingInfra?: string;
  surveyNotes?: string;
  evidencePhotos: string[];
  evidenceFiles?: SurveyEvidence[];
  routeGeoJson?: any;
  homepasCount?: number;
  homepasCoords?: any;
  polePositions?: any;
  routeNotes?: string;
  routeDistanceM?: number;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'REVISION_REQUIRED';
}

export interface BaOpen { // NEW: BA Open with form fields
  id: string;
  documentNumber: string;
  status: string;
  pdfUrl?: string;
  generatedAt?: string;
  tanggal?: string;
  tempat?: string;
  topik?: string;
  description?: string;
}

export interface Sip {
  id: string;
  permitClusterId: string;
  documentNumber: string;
  ispCustomer?: string;
  status: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'ISP_REVISION';
  pdfUrl?: string;
  submittedAt?: string;
  approvedAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  ispFeedback?: string;
  siteName?: string;
  coordinates?: string;
  residenceType?: string;
  classing?: string;
  workMethod?: string;
  homepasCount?: number;
  occupancyPercent?: number;
  existingCompetitors?: string;
  picKawasan?: string;
  requestBy?: string;
  boundaryKmzUrl?: string;
  picFs?: string;
  picCbn?: string;
  branch?: string;
  provinsi?: string;
  kota?: string;
  kecamatan?: string;
  kelurahan?: string;
  alamat?: string;
  remarks?: string;
}

export interface HldRevision {
  id: string;
  version: number;
  kmzFileUrl?: string;
  boqFileUrl?: string;
  notes?: string;
  createdAt: string;
}

export interface Hld {
  id: string;
  permitClusterId: string;
  version: number;
  status: 'DRAFT' | 'SUBMITTED_FOR_REVIEW' | 'PM_APPROVED' | 'PM_REJECTED' | 'ADMIN_APPROVED' | 'ADMIN_REJECTED' | 'PENDING_ISP' | 'ISP_REVISION' | 'ISP_APPROVED';
  kmzFileUrl?: string;
  boqFileUrl?: string;
  additionalFiles: string[];
  slaDeadline?: string;
  pmApprovedBy?: string;
  pmApprovedAt?: string;
  adminApprovedBy?: string;
  adminApprovedAt?: string;
  submittedToIsp?: string;
  ispFeedback?: string;
  revisions?: HldRevision[];
}

export interface LldRevision {
  id: string;
  version: number;
  apdFileUrl?: string;
  schematicFileUrl?: string;
  coreConnectionUrl?: string;
  notes?: string;
  createdAt: string;
}

export interface Lld {
  id: string;
  permitClusterId: string;
  version: number;
  status: 'DRAFT' | 'SUBMITTED_FOR_REVIEW' | 'PM_APPROVED' | 'PM_REJECTED' | 'ADMIN_APPROVED' | 'ADMIN_REJECTED' | 'PENDING_ISP' | 'ISP_REVISION' | 'ISP_APPROVED';
  apdFileUrl?: string;
  schematicFileUrl?: string;
  coreConnectionUrl?: string;
  additionalFiles: string[];
  slaDeadline?: string;
  pmApprovedAt?: string;
  adminApprovedAt?: string;
  ispFeedback?: string;
  revisions?: LldRevision[];
}

export interface PrBrRecord {
  id: string;
  type: 'PR' | 'BR';
  documentNumber: string;
  amount: number;
  description: string;
  status: 'DRAFT' | 'ISSUED' | 'APPROVED' | 'REJECTED';
  issuedAt?: string;
  fileUrl?: string;
}

export interface ContractRecord {
  id: string;
  type: 'PO' | 'PKS' | 'OTHER';
  contractNumber?: string;
  vendor?: string;
  amount?: number;
  startDate?: string;
  endDate?: string;
  status: 'DRAFT' | 'PENDING_OPS_MANAGER' | 'PENDING_GM' | 'APPROVED' | 'REJECTED' | 'ACTIVE' | 'COMPLETED' | 'TERMINATED';
  opsApprovedAt?: string;
  gmApprovedAt?: string;
  rejectionNotes?: string;
  signedAt?: string;
  fileUrl?: string;
}

export interface DisbursementRecord {
  id: string;
  amount: number;
  description: string;
  scheduledDate: string;
  executedDate?: string;
  status: string;
  evidenceUrl?: string;
}

export interface SkomBudget {
  id: string;
  totalBudget: number;
  rabFileUrl?: string;
  timelineFileUrl?: string;
  kurvaSFileUrl?: string;
  kurvaSData?: any;
  startDate?: string;
  endDate?: string;
  durationDays?: number;
  status: 'DRAFT' | 'PENDING_OPS_APPROVAL' | 'OPS_APPROVED' | 'OPS_REJECTED' | 'PENDING_GM_APPROVAL' | 'GM_APPROVED' | 'GM_REJECTED' | 'DISBURSED'; // FIX: added DISBURSED
  approvedAt?: string;
  totalDisbursed?: number;
  disbursements: DisbursementRecord[];
  // FIX: disbursement schedule fields
  disbursementStartDate?: string;
  disbursementEndDate?: string;
  disbursementAmount?: number;
  disbursementNotes?: string;
}

export interface ClaimPackage {
  id: string;
  documentNumber: string;
  status: 'DRAFT' | 'COMPILING' | 'SUBMITTED_FOR_REVIEW' | 'REVISION_REQUIRED' | 'APPROVED';
  docMom?: string;
  docBaOpen?: string;
  docBaAcara?: string;
  docBaTtdRt?: string;
  docFcBukuTabungan?: string;
  docSip?: string;
  docKtpRtRw?: string;
  docPks?: string;
  docKwitansi?: string;
  docEvidancePayment?: string;
  docBuktiTrf?: string;
  docSkInternal?: string;
  docPoSpk?: string;
  docBaOpenLengkap?: string;
  docKwitansiGov?: string;
  docFotoEvidance?: string;
  docEvidancePaymentGov?: string;
  docSkInternalGov?: string;
  docPoSpkGov?: string;
  check1Status: string;
  check1FailedDocs: string[];
  check1DoneAt?: string;
  check2Status: string;
  check2ReviewedBy?: string;
  check2ReviewedAt?: string;
  check2Notes?: string;
  submittedToIspAt?: string;
  submittedToIspBy?: string;
}

export interface InvoicePackage {
  id: string;
  invoiceNumber: string;
  amount: number;
  status: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'PAID' | 'REJECTED';
  invoicePdfUrl?: string;
  submittedToFinanceAt?: string;
  approvedAt?: string;
  paidAt?: string;
  paymentRef?: string;
  followUpCount: number;
  lastFollowUpAt?: string;
}

export const VISIT_STATUS_LABELS: Record<VisitRequestStatus, string> = {
  DRAFT: 'Draft',
  PM_REVIEW_VISIT: 'Review jadwal (PM)',
  APPROVED_PENDING_DATA: 'Disetujui — isi survey',
  PM_REVIEW_SURVEY: 'Review hasil survey (PM)',
  PM_SENIOR_REVIEW: 'Review PM Senior',
  ADMIN_REVIEW: 'Review Admin',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
  EXISTING_FIBER: 'Ada Fiber Existing',
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Dikirim',
  STOCK_AVAILABLE: 'Stok Tersedia',
  PARTIAL_STOCK: 'Stok Sebagian',
  NO_STOCK: 'Butuh Pembelian',
  FULFILLED: 'Selesai',
  CANCELLED: 'Dibatalkan',
};

export const PR_STATUS_LABELS: Record<PurchaseRequestStatus, string> = {
  PENDING: 'Menunggu',
  IN_REVIEW: 'Diproses',
  APPROVED: 'Disetujui',
  ORDERED: 'Dipesan',
  RECEIVED: 'Diterima',
  REJECTED: 'Ditolak',
  CANCELLED: 'Dibatalkan',
};

export interface ParsedExcelRow {
  siteName: string;
  kotaKabupaten: string;
  kelurahan?: string;
  kecamatan?: string;
  rwCode?: string;
  homepasCount: number;
  actualHP?: number;
  hpHldApproved?: number;
  permitStatus?: string;
  implStatus?: string;
  picPermit?: string;
  projectType?: string;
  coordinates?: string;
  hasExistingFiber?: boolean;
  lastUpdate?: string;
  remark?: string;
  sourceSheet: 'MASTER' | 'POTENSIAL_CBN';
  externalCode?: string;
}

export interface SafeUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  fiberType: FiberType | null;
  isActive: boolean;
  signatureUrl: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface UserStats {
  total: number;
  active: number;
  inactive: number;
  byRole: Array<{ role: string; count: number; label: string }>;
  recentlyCreated: SafeUser[];
}

export interface PmDashboard {
  stats: {
    activeClusters: number;
    pendingActions: number;
    pendingOrders: number;
    completedThisMonth: number;
    totalClusters?: number; // FIX: fiber-scoped totals
    pendingVisitRequests?: number; // FIX
    pendingDocPackages?: number; // FIX
  };
  clustersByPhase: Array<{ phase: string; count: number }>;
  pendingActions: Array<{
    type: string;
    clusterId: string;
    clusterCode: string;
    daysWaiting: number;
    label: string;
    href: string;
  }>;
  recentClusters: any[];
}

export interface SurveyorDashboardRecentRequest {
  id: string;
  status: string;
  rejectionReason?: string | null;
  cleanList: {
    siteName: string;
    rwCode: string;
    ispCustomer: string;
    kotaKabupaten: string;
  };
  createdAt: string;
}

export interface SurveyorDashboard {
  stats: {
    total: number;
    draft: number;
    submitted: number;
    underReview: number;
    approved: number;
    rejected: number;
    approvedThisMonth: number;
    activeVR?: number; // FIX: visit request aktif (antrian review)
    activeClusters?: number; // FIX: cluster pipeline per fiber
    pendingTasks?: number; // FIX: dokumen / tugas surveyor
    unreadNotifications?: number; // FIX: notifikasi belum dibaca
  };
  recentRequests: SurveyorDashboardRecentRequest[];
  availableCleanList: number;
}

export interface AdminDashboard {
  pendingValidations: {
    visitRequests: number;
    bakpValidations: number;
    total: number;
  };
  recentApprovals: Array<{
    id: string;
    action: string;
    createdAt: string;
    actor: { name: string; role: string };
    notes?: string;
  }>;
  constructionReadyThisMonth: number;
  documentsReadyForIsp: number; // FIX: count cluster dengan BAKP approved (selaras /document-list)
}

export interface CleanListDashStats {
  summary: {
    totalAvailable: number;
    totalInProgress: number;
    totalExistingFiber: number;
    totalCompleted: number;
    totalSites: number;
  };
  homepasses: {
    totalPlanned: number;
    totalActual: number;
    achievementRate: number;
  };
  byCity: Array<{ city: string; count: number; totalHP: number }>;
  byPermitStatus: Array<{ status: string | null; count: number }>;
  recentlyAdded: any[];
}

// ── Finance dashboard (Milestone 5) ─────────────────────────────────

export type FinanceProjectStatus = 'ACTIVE' | 'CLOSED' | 'ARCHIVED';

export interface FinanceProjectListItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  // JLM: FTTH vs FTTT + FTTT budget categories
  projectType?: 'FTTH' | 'FTTT';
  budgetPerizinan?: string | number | null;
  budgetLainLain?: string | number | null;
  totalBudget: string | number;
  materialBudget: string | number | null;
  jasaBudget: string | number | null;
  materialSpent: string | number;
  jasaSpent: string | number;
  endDate: string | null;
  status: FinanceProjectStatus;
  isDefaultUncategorized: boolean;
  isOverbudget: boolean;
  createdById: string;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
  materialRemaining?: number;
  jasaRemaining?: number;
  // JLM: realisasi terpadu (FTTT: dari Transaction Log, sinkron dengan halaman Detail)
  totalSpent?: number;
  totalRemaining?: number;
  perizinanSpent?: number;
  lainLainSpent?: number;
}

export type BudgetLedgerEntryType =
  | 'BUDGET_INIT'
  | 'BUDGET_ADJUSTMENT'
  | 'DEDUCT_MATERIAL'
  | 'DEDUCT_JASA'
  | 'REFUND_MATERIAL'
  | 'REFUND_JASA'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN';

export interface BudgetLedger {
  id: string;
  financeProjectId: string;
  entryType: BudgetLedgerEntryType;
  category: 'MATERIAL' | 'JASA' | null;
  amount: string;
  sourceType: 'ORDER' | 'CASH_OP' | 'MANUAL_ADJUSTMENT' | 'TRANSFER' | null;
  sourceId: string | null;
  budgetTransferId: string | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  createdById: string | null;
  createdAt: string;
  createdBy?: { id: string; name: string | null; email: string | null } | null;
}

export interface FinanceProjectActivityStats {
  totalTransactions: number;
  deductCount: number;
  refundCount: number;
  transferCount: number;
  lastActivityAt: string | null;
  lastActivityType: BudgetLedgerEntryType | null;
}

export interface FinanceProjectDetail extends FinanceProjectListItem {
  pendingTransferCount: number;
  recentLedgerEntries: BudgetLedger[];
  activityStats: FinanceProjectActivityStats;
}

export type BudgetTransferStatus =
  | 'PENDING_GM_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

export interface BudgetTransfer {
  id: string;
  sourceFinanceProjectId: string;
  targetFinanceProjectId: string;
  sourceCategory: 'MATERIAL' | 'JASA';
  targetCategory: 'MATERIAL' | 'JASA';
  amount: string;
  reason: string;
  status: BudgetTransferStatus;
  submittedById: string;
  decidedById: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  sourceProject?: { id: string; code: string; name: string };
  targetProject?: { id: string; code: string; name: string };
  submittedBy?: { id: string; name: string | null };
  decidedBy?: { id: string; name: string | null } | null;
}

export interface ForecastDto {
  burnRate: { material: number; jasa: number };
  estimatedDepletionDate: { material: string | null; jasa: string | null };
  projectedFinalRealization: { material: number; jasa: number; total: number };
  projectionWindow: {
    type: 'endDate' | 'fallback30days';
    endDate: string | null;
    daysProjected: number;
  };
  metadata: {
    daysSinceStart: number;
    transactionCount: number;
    isReliable: boolean;
    disclaimer: string;
  };
}

/** Cash Operation — Stage 1 approval chain step */
export interface CashOpApprovalStep {
  id: string;
  requestId?: string;
  stepOrder: number;
  approverRole: string;
  approverId: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED';
  approvedAmount: string | null;
  notes: string | null;
  decidedAt: string | null;
  approver?: { id: string; name: string | null; role?: string | null } | null;
}

export type RealisasiStatus =
  | 'DRAFT'
  | 'PENDING_PM_REVIEW'
  | 'PENDING_OPS_REVIEW'
  | 'PENDING_GM_REVIEW'
  | 'PENDING_FINANCE_REVIEW'
  | 'PENDING_MARKETING_HEAD_REVIEW'
  | 'REJECTED'
  | 'DONE';

export interface CashOpRealisasiItem {
  id: string;
  cashOpRequestId: string;
  itemNumber: number;
  description: string;
  paymentDate: string;
  amount: string;
  finalAmount?: string | null;
  photoUrl: string | null;
  createdAt: string;
}

export interface CashOpRealisasiStep {
  id: string;
  cashOpRequestId: string;
  stepOrder: number;
  approverRole: string;
  approverId: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED';
  approvedAt: string | null;
  rejectionReason: string | null;
  notes: string | null;
  approver?: { id: string; name: string } | null;
}

/** Cash operation request — aligns with GET /cash-operation/:id */
export interface CashOperationRequest {
  id: string;
  requestNumber: string;
  type: 'CASH_ADVANCE' | 'REIMBURSEMENT';
  status: string;
  description: string;
  amount: number | string;
  category?: string | null;
  projectRef?: string | null;
  currentStepRole?: string | null;
  currentApproverRole?: string | null;
  currentStep?: number;
  slaDeadline?: string | null;
  slaBreached: boolean;
  createdAt: string;
  requestedBy?: string;
  periodeFrom: string | null;
  periodeTo: string | null;
  nomorRekeningPengaju?: string | null;
  finalApprovedAmount: string | null;
  realisasiSubmittedAt: string | null;
  realisasiTotal: string | null;
  realisasiStatus: RealisasiStatus | null;
  realisasiCurrentStepRole: string | null;
  realisasiRejectionReason: string | null;
  realisasiRejectedReason?: string | null;
  realisasiNomorRekeningFinance?: string | null;
  realisasiCompletedAt: string | null;

  // Signature and approval fields
  gmSignatureUrl?: string | null;
  gmApprovedAt?: string | null;
  gmApprovedById?: string | null;
  financeSignatureUrl?: string | null;
  financeApprovedAt?: string | null;
  financeApprovedById?: string | null;
  financeNominalDisetujui?: string | null;

  approvedAt: string | null;
  requester?: { name?: string | null; role?: string | null } | null;
  attachments: Array<{ id: string; fileName: string; fileUrl: string; mimeType?: string | null }>;
  approvalSteps: CashOpApprovalStep[];
  financeProject?: { id: string; code: string; name: string } | null;
  /** Server-side diagnostics for broken approval rows (GET /cash-operation/:id) */
  approvalDebug?: {
    currentApproverRole: string | null;
    pendingStepFound: boolean;
    expectedApprovalStepCount: number;
    actualApprovalStepCount: number;
    /** Present when server detects approvalSteps vs approvalChain drift */
    repairSuggestion?: string;
  };
}

export interface RealisasiBundle {
  cashOp: CashOperationRequest;
  items: CashOpRealisasiItem[];
  steps: CashOpRealisasiStep[];
  windowOpenAt: string | null;
  isWindowOpen: boolean;
}

export const REALISASI_STATUS_LABELS: Record<RealisasiStatus, { label: string; color: string }> = {
  DRAFT: { label: 'Draft Realisasi', color: 'gray' },
  PENDING_PM_REVIEW: { label: 'Menunggu Approval PM', color: 'amber' },
  PENDING_OPS_REVIEW: { label: 'Menunggu Ops Manager', color: 'amber' },
  PENDING_GM_REVIEW: { label: 'Menunggu Approval GM', color: 'amber' },
  PENDING_FINANCE_REVIEW: { label: 'Menunggu Finance', color: 'amber' },
  PENDING_MARKETING_HEAD_REVIEW: { label: 'Menunggu Marketing Head', color: 'amber' },
  REJECTED: { label: 'Perlu Revisi', color: 'red' },
  DONE: { label: 'Selesai', color: 'green' },
};

// ─── Phase 3 — Supplier / Tagihan / StockOut (M6 types) ─────────────────────

export interface Supplier {
  id: string;
  code: string;
  name: string;
  npwp: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  bankAccount: string | null;
  bankName: string | null;
  contactPerson: string | null;
  notes: string | null;
  isActive: boolean;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export type PaymentMethod = 'CBD' | 'COD' | 'TERMIN';
export type SupplierInvoiceStatus =
  | 'DRAFT'
  | 'SENT_TO_SUPPLIER'
  | 'APPROVED_BY_SUPPLIER'
  | 'REJECTED_BY_SUPPLIER';

export interface SupplierInvoice {
  id: string;
  invoiceNumber: string;
  orderId: string;
  supplierId: string;
  invoiceFileUrl: string;
  invoiceAmount: string;
  paymentMethod: PaymentMethod;
  paymentDueDate: string | null;
  status: SupplierInvoiceStatus;
  emailSentAt: string | null;
  supplierAckAt: string | null;
  supplierRejectionReason: string | null;
  uploadedById: string;
  approvedById: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type StockOutStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'PENDING_PM_CONFIRM'
  | 'PENDING_FINANCE'
  | 'FULFILLED'
  | 'REJECTED';

export interface StockOutItem {
  stockItemId: string;
  qty: number;
  notes?: string;
  itemName?: string;
}

export interface StockOut {
  id: string;
  requestNumber: string;
  requestedById: string;
  permitClusterId: string | null;
  items: StockOutItem[];
  status: StockOutStatus;
  recipient: string | null;
  doNumber: string | null;
  adminStockApprovedById: string | null;
  adminStockApprovedAt: string | null;
  pmConfirmedById: string | null;
  pmConfirmedAt: string | null;
  financeApprovedById: string | null;
  financeApprovedAt: string | null;
  revisionNotes: string | null;
  suratJalanId: string | null;
  fulfilledById: string | null;
  fulfilledAt: string | null;
  rejectionReason: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  // relations (optional — included in detail view)
  requestedBy?: { id: string; name: string };
  adminStockApprover?: { id: string; name: string } | null;
  pmConfirmer?: { id: string; name: string } | null;
  financeApprover?: { id: string; name: string } | null;
  suratJalan?: { id: string; documentNumber: string; pdfUrl: string | null; status: string } | null;
}

/** Order trigger (Phase 3 procurement + restock) */
export type OrderTrigger = 'PROJECT_REQUEST' | 'STOCK_RESTOCK';

export const SUPPLIER_INVOICE_STATUS_LABELS: Record<SupplierInvoiceStatus, { label: string; color: string }> = {
  DRAFT: { label: 'Draft', color: 'gray' },
  SENT_TO_SUPPLIER: { label: 'Terkirim ke Supplier', color: 'blue' },
  APPROVED_BY_SUPPLIER: { label: 'Disetujui Supplier', color: 'green' },
  REJECTED_BY_SUPPLIER: { label: 'Ditolak Supplier', color: 'red' },
};

export const STOCK_OUT_STATUS_LABELS: Record<StockOutStatus, { label: string; color: string }> = {
  DRAFT:              { label: 'Perlu Revisi', color: 'orange' },
  PENDING:            { label: 'Menunggu Admin Stock', color: 'amber' },
  PENDING_PM_CONFIRM: { label: 'Menunggu Konfirmasi PM', color: 'blue' },
  PENDING_FINANCE:    { label: 'Menunggu Finance', color: 'purple' },
  FULFILLED:          { label: 'Selesai', color: 'green' },
  REJECTED:           { label: 'Ditolak', color: 'red' },
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CBD: 'Cash Before Delivery',
  COD: 'Cash On Delivery',
  TERMIN: 'Termin (Tempo)',
};

// ─── FTTT Project Flow ────────────────────────────────────────────────────────

export type FtttCompany = 'TELKOM_INFRA' | 'IFORTE' | 'PST';
export type FtttPhase =
  | 'INITIATION' | 'SURVEY' | 'PREPARATION' | 'PROCUREMENT'
  | 'IMPLEMENTATION' | 'DOCUMENTATION' | 'RECONCILIATION' | 'CLOSING';
export type FtttPhaseStatus = 'LOCKED' | 'ACTIVE' | 'COMPLETED' | 'SKIPPED';
export type FtttProjectStatus = 'ACTIVE' | 'COMPLETED' | 'ON_HOLD' | 'CANCELLED';
export type FtttDocType = 'PO_CONTRACT' | 'SITELIST' | 'BOQ_TOS';
export type FtttApprovalStatus = 'PENDING_PM' | 'PENDING_ADMIN' | 'APPROVED' | 'REJECTED';
export type FtttSanggahStatus = 'SUBMITTED' | 'ACCEPTED' | 'REJECTED';
export type FtttJaminanType = 'JAMINAN_UANG_MUKA' | 'JAMINAN_PELAKSANAAN';
export type FtttDocumentType =
  | 'ATP' | 'EVIDENCE' | 'BAUT' | 'BAUT_REKONSILIASI' | 'BACT'
  | 'KONTRAK' | 'PO' | 'AMANDEMEN_1' | 'DOK_PERUBAHAN_WAKTU'
  | 'SUPPORTING'; // legacy

export type FtttSpanLogCategory =
  | 'GALIAN' | 'VIDEO_GALIAN' | 'PERBAIKAN' | 'HANDHOLE'
  | 'JEMBATAN' | 'JOIN_TERMINASI' | 'MARKING_POS';

export interface FtttSpanLog {
  id:          string;
  spanId:      string;
  category:    FtttSpanLogCategory;
  fileUrl:     string;
  caption:     string | null;
  createdAt:   string;
  uploadedBy:  { id: string; name: string };
}

export interface FtttSpan {
  id:          string;
  projectId:   string;
  spanNumber:  string;
  createdAt:   string;
  createdBy:   { id: string; name: string };
  spanLogs:    FtttSpanLog[];
}

export type FtttCostCategory = 'PERIZINAN' | 'MATERIAL' | 'JASA' | 'LAIN_LAIN';

export interface FtttTransaction {
  id:          string;
  category:    FtttCostCategory;
  aktivitas:   string;
  uom:         string | null;
  qty:         string | number;
  price:       string | number;
  total:       string | number;
  remarks:     string;
  createdAt:   string;
  createdBy:   { id: string; name: string };
}

export const FTTT_COST_CATEGORY_LABELS: Record<FtttCostCategory, string> = {
  PERIZINAN: 'Perizinan',
  MATERIAL:  'Material',
  JASA:      'Jasa',
  LAIN_LAIN: 'Lain-Lain',
};

export const FTTT_COMPANY_LABELS: Record<FtttCompany, string> = {
  TELKOM_INFRA: 'Telkom Infra',
  IFORTE:       'iForte',
  PST:          'PST',
};

export const FTTT_PHASE_LABELS: Record<FtttPhase, string> = {
  INITIATION:     'Project Initiation',
  SURVEY:         'Validation & Survey',
  PREPARATION:    'Project Preparation',
  PROCUREMENT:    'Procurement',
  IMPLEMENTATION: 'Implementation',
  DOCUMENTATION:  'Documentation & Acceptance',
  RECONCILIATION: 'Reconciliation & Billing',
  CLOSING:        'Project Closing',
};

export const FTTT_DOC_TYPE_LABELS: Record<FtttDocType, string> = {
  PO_CONTRACT: 'PO / Contract (PDF)',
  SITELIST:    'Sitelist (Excel)',
  BOQ_TOS:     'BOQ & TOS (Excel)',
};

export const FTTT_PROJECT_STATUS_LABELS: Record<FtttProjectStatus, { label: string; color: string }> = {
  ACTIVE:    { label: 'Aktif', color: 'blue' },
  COMPLETED: { label: 'Selesai', color: 'green' },
  ON_HOLD:   { label: 'Ditunda', color: 'orange' },
  CANCELLED: { label: 'Dibatalkan', color: 'red' },
};

export interface FtttPhaseProgress {
  id:            string;
  phase:         FtttPhase;
  status:        FtttPhaseStatus;
  unlockedAt:    string | null;
  completedAt:   string | null;
  completedById: string | null;
  notes:         string | null;
}

export interface FtttProject {
  id:             string;
  ftttCompany:    FtttCompany;
  triggerDocUrl:  string;
  triggerDocType: FtttDocType;
  currentPhase:   FtttPhase;
  status:         FtttProjectStatus;
  projectName:    string | null;
  notes:          string | null;
  pmId:           string;
  // JLM: PST implementation type + Project Closing maintenance confirmation/reminder
  implementationType?:       'GALIAN' | 'KU' | null;
  maintenanceEndDate?:       string | null;
  maintenanceConfirmedAt?:   string | null;
  maintenanceConfirmedById?: string | null;
  // JLM: Finance Project link + Implementation transaction log
  financeProjectId?:         string | null;
  financeProject?:           { id: string; code: string; name: string; projectType?: string; totalBudget: string | number; budgetPerizinan?: string | number | null; materialBudget?: string | number | null; jasaBudget?: string | number | null; budgetLainLain?: string | number | null } | null;
  transactions?:             FtttTransaction[];
  createdAt:      string;
  updatedAt:      string;
  pm:             { id: string; name: string; email: string };
  cleanList:      { id: string; rwCode: string; kelurahan: string } | null;
  phaseProgresses: FtttPhaseProgress[];
  surveyUploads:      FtttSurveyUpload[];
  drmDocuments:       FtttDrmDoc[];
  sanggahs:           FtttSanggah[];
  jaminans:           FtttJaminan[];
  documents:          FtttDoc[];
  implementationLogs: FtttImplementationLog[];
  reconDocs:          FtttReconDoc[];
  closingLogs:        FtttClosingLog[];
  spans:              FtttSpan[];
}

export interface FtttSurveyUpload {
  id:           string;
  fileUrl:      string;
  fileType:     string;
  caption:      string | null;
  createdAt:    string;
  uploadedBy:   { id: string; name: string };
}

export interface FtttDrmDoc {
  id:          string;
  docType:     string;
  version:     number;
  fileUrl:     string;
  notes:       string | null;
  uploadedAt:  string;
  uploadedBy:  { id: string; name: string };
}

export interface FtttSanggah {
  id:            string;
  attemptNumber: number;
  reason:        string;
  fileUrl:       string | null;
  status:        FtttSanggahStatus;
  submittedAt:   string;
  resolvedAt:    string | null;
  responseNotes: string | null;
  submittedBy:   { id: string; name: string };
}

export interface FtttJaminan {
  id:          string;
  jaminanType: FtttJaminanType;
  amount:      string | null;
  issuer:      string | null;
  issueDate:   string | null;
  expiryDate:  string | null;
  fileUrl:     string | null;
  notes:       string | null;
  createdAt:   string;
  uploadedBy:  { id: string; name: string };
}

export interface FtttDoc {
  id:              string;
  docType:         FtttDocumentType;
  fileUrl:         string | null;       // null for form-generated docs
  formContent:     string | null;       // JSON for form-generated docs
  notes:           string | null;
  approvalStatus:  FtttApprovalStatus;
  pmApprovedAt:    string | null;
  adminApprovedAt: string | null;
  rejectionNotes:  string | null;
  createdAt:       string;
  uploadedBy:      { id: string; name: string };
}

export interface FtttReconDoc {
  id:              string;
  docKey:          string;
  fileUrl:         string | null;
  formContent:     string | null;
  notes:           string | null;
  approvalStatus:  FtttApprovalStatus;
  pmApprovedAt:    string | null;
  adminApprovedAt: string | null;
  rejectionNotes:  string | null;
  createdAt:       string;
  uploadedBy:      { id: string; name: string };
}

export type FtttImplLogType    = 'PHOTO' | 'MONITORING_DOC' | 'NOTE';
export type FtttClosingLogType = 'BAST_II' | 'EVIDENCE' | 'NOTE';

export interface FtttClosingLog {
  id:              string;
  logType:         FtttClosingLogType;
  fileUrl:         string | null;
  formContent:     string | null;
  caption:         string | null;
  notes:           string | null;
  approvalStatus:  FtttApprovalStatus | null;
  rejectionNotes:  string | null;
  createdAt:       string;
  uploadedBy:      { id: string; name: string };
}

export interface FtttImplementationLog {
  id:          string;
  logType:     FtttImplLogType;
  fileUrl:     string | null;
  caption:     string | null;
  notes:       string | null;
  createdAt:   string;
  uploadedBy:  { id: string; name: string; role?: string };
}

export interface FtttProgressSummary {
  projectId:       string;
  company:         FtttCompany;
  currentPhase:    FtttPhase;
  status:          FtttProjectStatus;
  progressPct:     number;
  completedPhases: number;
  totalPhases:     number;
  phases:          FtttPhaseProgress[];
  counts: {
    surveyUploads: number;
    drmDocuments:  number;
    sanggahs:      number;
    documents:     number;
  };
}
