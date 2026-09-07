import { AdditionalEvidenceOverviewFilter } from './AdditionalEvidenceOverviewFilter';
import { formatDutchDateTime } from '../../domain/WoonbehoefteFormatting';
import { ADDITIONAL_EVIDENCE_STATUS_LABELS } from '../domain/AdditionalEvidenceLabels';
import {
  AdditionalEvidenceSourceItem, AdditionalEvidenceSourceRecord, isFailedAdditionalEvidenceSource, isReadyAdditionalEvidenceSource,
} from '../domain/AdditionalEvidenceSource';
import { AdditionalEvidenceWorkItem, AdditionalEvidenceWorkItemStatus } from '../persistence/AdditionalEvidenceRepository';

export interface AdditionalEvidenceWorkItemWithSource {
  workItem: AdditionalEvidenceWorkItem;
  source?: AdditionalEvidenceSourceRecord;
  sourceError: boolean;
}

/**
 * Joins every workitem to its current source record, read fresh from the source cache: the workitem
 * itself stores no CSV content (see `AdditionalEvidenceRepository`), so this join is what shows
 * projectnaam/origineleKenmerk/contactgegevens, and heals automatically once a failed source is re-fetched
 * successfully - nothing about the workitem needs to change for that.
 */
export function joinWorkItemsWithSources(
  workItems: AdditionalEvidenceWorkItem[], sourceItems: Map<string, AdditionalEvidenceSourceItem>,
): AdditionalEvidenceWorkItemWithSource[] {
  return workItems.map((workItem) => {
    const item = sourceItems.get(workItem.objectUuid);
    if (item && isReadyAdditionalEvidenceSource(item)) {
      return { workItem, source: item, sourceError: false };
    }
    return { workItem, source: undefined, sourceError: item !== undefined && isFailedAdditionalEvidenceSource(item) };
  });
}

export function matchesOverviewFilter(entry: AdditionalEvidenceWorkItemWithSource, filter: AdditionalEvidenceOverviewFilter): boolean {
  return filter.statuses.length === 0 || filter.statuses.includes(entry.workItem.status);
}

export interface AdditionalEvidenceOverviewRow {
  submissionReference: string;
  detailHref: string;
  statusLabel: string;
  statusToken: string;
  projectNameLabel: string;
  originalCaseReferenceLabel: string;
  submittedAtLabel: string;
  hasSourceError: boolean;
  contactEmail?: string;
  contactPhone?: string;
  evidenceDescription?: string;
  remarks?: string;
}

export function buildOverviewRow(entry: AdditionalEvidenceWorkItemWithSource, backQuery: string): AdditionalEvidenceOverviewRow {
  const { workItem, source, sourceError } = entry;
  return {
    submissionReference: workItem.submissionReference,
    detailHref: `/woonbehoefte/additional-evidence/${encodeURIComponent(workItem.objectUuid)}${backQuery ? `?back=${encodeURIComponent(backQuery)}` : ''}`,
    statusLabel: ADDITIONAL_EVIDENCE_STATUS_LABELS[workItem.status],
    statusToken: workItem.status.toLowerCase(),
    projectNameLabel: source?.submittedProjectName ?? 'Onbekend project (bron nog niet beschikbaar)',
    originalCaseReferenceLabel: source?.originalCaseReference ?? '-',
    submittedAtLabel: source ? formatDutchDateTime(source.submittedAt) : '-',
    hasSourceError: sourceError,
    ...(source?.contactEmail ? { contactEmail: source.contactEmail } : {}),
    ...(source?.contactPhone ? { contactPhone: source.contactPhone } : {}),
    ...(source?.evidenceDescription ? { evidenceDescription: source.evidenceDescription } : {}),
    ...(source?.remarks ? { remarks: source.remarks } : {}),
  };
}

export interface AdditionalEvidenceStatusOption {
  value: AdditionalEvidenceWorkItemStatus;
  label: string;
  checked: boolean;
}

export interface AdditionalEvidenceOverviewViewModel {
  rows: AdditionalEvidenceOverviewRow[];
  hasRows: boolean;
  totalCountLabel: string;
  statusOptions: AdditionalEvidenceStatusOption[];
}

export function buildAdditionalEvidenceOverviewViewModel(
  entries: AdditionalEvidenceWorkItemWithSource[], filter: AdditionalEvidenceOverviewFilter, backQuery: string,
): AdditionalEvidenceOverviewViewModel {
  const matched = entries
    .filter((entry) => matchesOverviewFilter(entry, filter))
    .sort((a, b) => (b.source?.submittedAt ?? '').localeCompare(a.source?.submittedAt ?? ''));

  return {
    rows: matched.map((entry) => buildOverviewRow(entry, backQuery)),
    hasRows: matched.length > 0,
    totalCountLabel: `${matched.length} ${matched.length === 1 ? 'extra bewijs' : 'extra bewijzen'}`,
    statusOptions: (Object.keys(ADDITIONAL_EVIDENCE_STATUS_LABELS) as AdditionalEvidenceWorkItemStatus[]).map((status) => ({
      value: status, label: ADDITIONAL_EVIDENCE_STATUS_LABELS[status], checked: filter.statuses.includes(status),
    })),
  };
}
