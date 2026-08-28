import { Role } from '@prisma/client';

/** Roles that must keep GIS + Pipeline even if Settings.roles was narrowed. */
export const CORE_OPS_FEATURE_ROLES: Record<string, Role[]> = {
  GIS_MAP: [
    Role.SURVEYOR_FTTH,
    Role.SURVEYOR_FTTB,
    Role.SURVEYOR_FTTT,
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.PM_SENIOR,
    Role.DESIGNER,
    Role.OPERATIONAL_MANAGER,
    Role.GENERAL_MANAGER,
    Role.ADMIN,
    Role.MAP_VIEWER,
  ],
  PERMIT_PIPELINE: [
    Role.SURVEYOR_FTTH,
    Role.SURVEYOR_FTTB,
    Role.SURVEYOR_FTTT,
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.PM_SENIOR,
    Role.DESIGNER,
    Role.OPERATIONAL_MANAGER,
    Role.GENERAL_MANAGER,
    Role.ADMIN,
  ],
};

/** Seed-aligned grants. Heal unions these in; it does not strip extra roles. */
export const DEFAULT_FEATURE_FLAG_ROLES: Record<string, Role[]> = {
  CLEAN_LIST: [
    Role.GENERAL_MANAGER,
    Role.PM_SENIOR,
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.SURVEYOR_FTTH,
    Role.SURVEYOR_FTTB,
    Role.SURVEYOR_FTTT,
  ],
  VISIT_REQUEST: [
    Role.GENERAL_MANAGER,
    Role.PM_SENIOR,
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.SURVEYOR_FTTH,
    Role.SURVEYOR_FTTB,
    Role.SURVEYOR_FTTT,
    Role.ADMIN,
  ],
  BA_OPEN: [
    Role.GENERAL_MANAGER,
    Role.PM_SENIOR,
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.ADMIN,
    Role.SURVEYOR_FTTH,
    Role.SURVEYOR_FTTB,
    Role.SURVEYOR_FTTT,
  ],
  STOCK_MODULE: Object.values(Role),
  ORDER_MODULE: [
    Role.GENERAL_MANAGER,
    Role.PM_SENIOR,
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.ADMIN_STOCK,
    Role.FINANCE,
    Role.PURCHASING,
  ],
  SURAT_JALAN: [
    Role.GENERAL_MANAGER,
    Role.PM_SENIOR,
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.ADMIN_STOCK,
    Role.FINANCE,
  ],
  PURCHASE_REQUEST: [
    Role.GENERAL_MANAGER,
    Role.PM_SENIOR,
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.FINANCE,
  ],
  GIS_MAP: CORE_OPS_FEATURE_ROLES.GIS_MAP,
  SETTINGS: [Role.GENERAL_MANAGER],
  PERMIT_PIPELINE: CORE_OPS_FEATURE_ROLES.PERMIT_PIPELINE,
  DOCUMENT_LIST: [
    Role.ADMIN,
    Role.ADMIN_STOCK,
    Role.PM_SENIOR,
    Role.GENERAL_MANAGER,
    Role.PM_FTTH,
    Role.PM_FTTB,
    Role.PM_FTTT,
    Role.DESIGNER,
    Role.SURVEYOR_FTTH,
    Role.SURVEYOR_FTTB,
    Role.SURVEYOR_FTTT,
    Role.FINANCE,
    Role.PURCHASING,
    Role.OPERATIONAL_MANAGER,
  ],
  CASH_OPERATION: Object.values(Role),
};

export function hasCoreOpsGrant(featureKey: string, userRole: Role): boolean {
  return (CORE_OPS_FEATURE_ROLES[featureKey] ?? []).includes(userRole);
}

export function withGuaranteedGm(roles: string[]): Role[] {
  const next = new Set(roles.filter(Boolean) as Role[]);
  next.add(Role.GENERAL_MANAGER);
  return [...next];
}

export function unionDefaultRoles(featureKey: string, current: string[]): Role[] {
  const extra = DEFAULT_FEATURE_FLAG_ROLES[featureKey] ?? [];
  const core = CORE_OPS_FEATURE_ROLES[featureKey] ?? [];
  return withGuaranteedGm([...current, ...extra, ...core]);
}
