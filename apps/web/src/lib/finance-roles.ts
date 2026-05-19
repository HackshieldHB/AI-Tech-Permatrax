/** FINANCE + GM: create/edit projects, transfers, budget, settings gear */
export function canManageFinance(role: string | undefined): boolean {
  return role === 'FINANCE' || role === 'GENERAL_MANAGER';
}

/** FINANCE + GM + ADMIN: export reports (aligned with FINANCE_REPORT_EXPORT) */
export function canExportFinanceReport(role: string | undefined): boolean {
  return role === 'FINANCE' || role === 'GENERAL_MANAGER' || role === 'ADMIN';
}
