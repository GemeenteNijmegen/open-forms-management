export const CASE_STATUSES = [
  'NEW',
  'IN_PROGRESS',
  'WAITING_FOR_ADDITIONAL_INFORMATION',
  'READY_FOR_RANKING',
  'CORRECTION_NEEDED',
  'CORRECTION_WAITING_FOR_RESPONSE',
  'READY_MIJN_AANSLUITING',
  'CAPACITY_MA_SUBMITTED',
  'PROPOSED_INADMISSIBLE',
  'INADMISSIBLE',
  'WITHDRAWN',
] as const;

export type CaseStatus = typeof CASE_STATUSES[number];

export function isCaseStatus(value: unknown): value is CaseStatus {
  return typeof value === 'string' && (CASE_STATUSES as readonly string[]).includes(value);
}

/** Statuses a medewerker picks directly on the detail page; PROPOSED_INADMISSIBLE and INADMISSIBLE have their own dedicated flow. */
export const GENERIC_CASE_STATUSES = [
  'NEW',
  'IN_PROGRESS',
  'WAITING_FOR_ADDITIONAL_INFORMATION',
  'READY_FOR_RANKING',
  'CORRECTION_NEEDED',
  'CORRECTION_WAITING_FOR_RESPONSE',
  'READY_MIJN_AANSLUITING',
  'CAPACITY_MA_SUBMITTED',
  'WITHDRAWN',
] as const;
