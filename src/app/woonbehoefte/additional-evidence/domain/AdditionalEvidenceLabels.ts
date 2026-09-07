import { AdditionalEvidenceWorkItemStatus } from '../persistence/AdditionalEvidenceRepository';

export const ADDITIONAL_EVIDENCE_STATUS_LABELS: Record<AdditionalEvidenceWorkItemStatus, string> = {
  NEW: 'Nieuw',
  UNKNOWN: 'Onbekend',
  LINKED: 'Gekoppeld',
};
