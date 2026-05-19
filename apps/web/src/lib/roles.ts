/** Role string constants aligned with Prisma `Role` enum (web-safe, no @prisma/client). */

export const PM_ROLES = ['PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'PM_SENIOR'] as const;
export const SURVEYOR_ROLES = ['SURVEYOR_FTTH', 'SURVEYOR_FTTB', 'SURVEYOR_FTTT'] as const;

export type PmRole = (typeof PM_ROLES)[number];
export type SurveyorRole = (typeof SURVEYOR_ROLES)[number];

export function isPmRole(role: string | null | undefined): role is PmRole {
  return !!role && (PM_ROLES as readonly string[]).includes(role);
}

export function isSurveyorRole(role: string | null | undefined): role is SurveyorRole {
  return !!role && (SURVEYOR_ROLES as readonly string[]).includes(role);
}

export function isPmOrSurveyorRole(role: string | null | undefined): boolean {
  return isPmRole(role) || isSurveyorRole(role);
}
