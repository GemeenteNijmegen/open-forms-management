export const CASE_STATUSES = [
  'NEW',
  'IN_PROGRESS',
  'WAITING_FOR_ADDITIONAL_INFORMATION',
  'PROPOSED_INADMISSIBLE',
  'INADMISSIBLE',
  'READY_FOR_RANKING',
] as const;

export type CaseStatus = typeof CASE_STATUSES[number];

export function isCaseStatus(value: unknown): value is CaseStatus {
  return typeof value === 'string' && (CASE_STATUSES as readonly string[]).includes(value);
}
