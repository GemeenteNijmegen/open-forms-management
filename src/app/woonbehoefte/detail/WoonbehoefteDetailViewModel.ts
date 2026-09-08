import { AdditionalEvidenceCaseDocumentGroup } from '../additional-evidence/documents/AdditionalEvidenceCaseDocumentsLoader';
import { WoonbehoefteDocumentRow } from '../documents/WoonbehoefteDocumentsLoader';
import {
  APPLICANT_TYPE_LABELS, CASE_STATUS_LABELS, CHECK_OUTCOME_LABELS, NOTE_CATEGORY_LABELS, PROJECT_READINESS_CONDITIONS,
  PROJECT_READINESS_LABELS, TERNARY_ASSESSMENT_LABELS, TERNARY_ASSESSMENT_UNASSESSED_LABEL,
} from '../domain/CaseLabels';
import { CaseStatus } from '../domain/CaseStatus';
import {
  CaseActivity, CaseActivityChange, CaseAssessment, CaseNote, CaseNoteCategory, TernaryAssessment, WoonbehoefteCase,
} from '../domain/WoonbehoefteCase';
import { formatDutchDate, formatDutchDateTime, formatPeriodLabel, periodYear } from '../domain/WoonbehoefteFormatting';
import { WoonbehoefteSourceRecord } from '../domain/WoonbehoefteSource';

export type WoonbehoefteSourceAvailability = 'READY' | 'FAILED' | 'MISSING';

const TERNARY_VALUES: TernaryAssessment[] = ['YES', 'NO', 'NOT_APPLICABLE', 'UNKNOWN'];
/** Statuses a medewerker can freely switch between via the generic select; `PROPOSED_INADMISSIBLE`/`INADMISSIBLE` each need their own dedicated action instead. */
const GENERIC_STATUSES: CaseStatus[] = ['NEW', 'IN_PROGRESS', 'WAITING_FOR_ADDITIONAL_INFORMATION', 'READY_FOR_RANKING'];
const MONTH_OPTION_LABELS = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december',
];

/** Dutch labels for every `CaseActivityChange.field` a mutation currently writes; see WoonbehoefteCaseRepository. */
const ACTIVITY_FIELD_LABELS: Record<string, string> = {
  'status': 'Status',
  'claimedBy': 'Behandelaar',
  'check.lastOutcome': 'Check',
  'assessment.applicationComplete': 'Aanvraagformulier volledig',
  'assessment.boardDeclarationApproved': 'Bestuursverklaring',
  'assessment.chamberOfCommerceApproved': 'KvK-uittreksel',
  'assessment.planningAgreementEvidenceApproved': 'Overeenkomst(en) als onderbouwing',
  'assessment.planningPublicDecisionEvidenceApproved': 'Subsidie, woondeal of prestatieafspraken',
  'assessment.projectReadinessEvidenceApproved': 'Bewijsstukken voldoen aan projectrijpheid',
  'assessment.assessedStartPeriod': 'Vastgestelde start',
  'assessment.assessedStartExplanation': 'Toelichting start',
  'assessment.assessedCompletionPeriod': 'Vastgestelde oplevering',
  'assessment.assessedCompletionExplanation': 'Toelichting oplevering',
  'assessment.assessedProjectReadiness': 'Vastgestelde projectrijpheid',
};

function activityFieldLabel(field: string): string {
  return ACTIVITY_FIELD_LABELS[field] ?? field.replace(/^assessment\./, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

/** Never shows a raw internal enum value; an unmapped SCREAMING_SNAKE_CASE value is hidden rather than leaked. */
function activityValueLabel(field: string, value: CaseActivityChange['from']): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value ? 'Ja' : 'Nee';
  }
  if (typeof value === 'number') {
    if (field === 'assessment.assessedProjectReadiness') {
      return PROJECT_READINESS_LABELS[value] ?? String(value);
    }
    return field.endsWith('Period') ? formatPeriodLabel(value) : String(value);
  }
  if (value in CASE_STATUS_LABELS) {
    return CASE_STATUS_LABELS[value as CaseStatus];
  }
  if (value in TERNARY_ASSESSMENT_LABELS) {
    return TERNARY_ASSESSMENT_LABELS[value];
  }
  if (value in CHECK_OUTCOME_LABELS) {
    return CHECK_OUTCOME_LABELS[value];
  }
  // Not a known label: an unmapped ALL_CAPS value is an internal enum without a Dutch mapping, never shown raw.
  return /^[A-Z][A-Z0-9_]*$/.test(value) ? undefined : value;
}

function formatActivityChangeLine(change: CaseActivityChange): string {
  const label = activityFieldLabel(change.field);
  const from = activityValueLabel(change.field, change.from);
  const to = activityValueLabel(change.field, change.to);
  if (from === undefined && to !== undefined) {
    return `${label}: ${to}`;
  }
  if (from !== undefined && to === undefined) {
    return `${label}: gewijzigd`;
  }
  return `${label}: ${from ?? '-'} -> ${to ?? '-'}`;
}

export interface SelectOption {
  value: string;
  label: string;
  selected: boolean;
}

export interface WoonbehoefteNoteRow {
  categoryLabel: string;
  text: string;
  createdByLabel: string;
  createdAtLabel: string;
}

export interface WoonbehoefteActivityRow {
  summary: string;
  actor: string;
  occurredAtLabel: string;
  changeLines: string[];
}

export interface WoonbehoefteDetailViewModel {
  caseReference: string;
  version: number;
  statusLabel: string;
  statusToken: string;
  assigneeLabel: string;
  isUnclaimed: boolean;
  checkRequested: boolean;
  checkRequestedInfo?: string;
  checkRequestNoteText?: string;
  receivedLabel: string;
  statusSinceLabel: string;

  backHref: string;
  backQuery: string;

  hasSource: boolean;
  sourceErrorMessage?: string;

  projectName: string;
  projectDescription?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  totalHomesLabel?: string;
  hasExistingLianderRequestLabel?: string;
  eanOrApplicationNumber?: string;
  applicantTypeLabel: string;
  collectiveHousingLabel?: string;
  hasCollectiveFacilitiesLabel?: string;
  hasKovaLabel?: string;
  collectiveHousingCategory?: string;

  submittedStartDateLabel: string;
  assessedStartPeriodLabel: string;
  assessedStartExplanationValue: string;
  submittedCompletionDateLabel: string;
  assessedCompletionPeriodLabel: string;
  assessedCompletionExplanationValue: string;
  submittedReadinessLabel: string;
  submittedReadinessConditionText?: string;
  assessedReadinessLabel: string;

  applicationDocument?: WoonbehoefteDocumentRow;
  attachments: WoonbehoefteDocumentRow[];
  hasAttachments: boolean;
  attachmentCountLabel: string;
  /** One group per gekoppelde extra-bewijzeninzending; all shaping happens in `AdditionalEvidenceCaseDocumentsLoader`, this is a straight passthrough. */
  additionalDocumentGroups: AdditionalEvidenceCaseDocumentGroup[];
  hasAdditionalDocumentGroups: boolean;

  notes: WoonbehoefteNoteRow[];
  hasNotes: boolean;
  activities: WoonbehoefteActivityRow[];
  hasActivities: boolean;

  // Management/action state; undefined/false when the actor only has woonbehoefte:view.
  canManage: boolean;
  csrfToken?: string;
  canClaim: boolean;
  canRelease: boolean;
  canTakeOver: boolean;
  canUseGenericStatusSelect: boolean;
  statusOptions: SelectOption[];
  isProposedInadmissible: boolean;
  isInadmissible: boolean;
  applicationCompleteOptions: SelectOption[];
  boardDeclarationApprovedOptions: SelectOption[];
  chamberOfCommerceApprovedOptions: SelectOption[];
  planningAgreementEvidenceApprovedOptions: SelectOption[];
  planningPublicDecisionEvidenceApprovedOptions: SelectOption[];
  projectReadinessEvidenceApprovedOptions: SelectOption[];
  assessedStartMonthOptions: SelectOption[];
  assessedStartYearOptions: SelectOption[];
  assessedCompletionMonthOptions: SelectOption[];
  assessedCompletionYearOptions: SelectOption[];
  readinessOptions: SelectOption[];
  noteCategoryOptions: SelectOption[];
  checkOutcomeOptions: SelectOption[];
}

function yesNoLabel(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : value ? 'Ja' : 'Nee';
}

function ternaryOptions(current: TernaryAssessment | undefined): SelectOption[] {
  return [
    { value: '', label: TERNARY_ASSESSMENT_UNASSESSED_LABEL, selected: current === undefined },
    ...TERNARY_VALUES.map((value) => ({ value, label: TERNARY_ASSESSMENT_LABELS[value], selected: value === current })),
  ];
}

function monthOptions(current: number | undefined): SelectOption[] {
  return MONTH_OPTION_LABELS.map((label, index) => ({ value: String(index + 1), label, selected: current === index + 1 }));
}

/** A wide, fixed bracket around the current year; a previously stored value outside it is always added too, so it never silently disappears from the select. */
function yearOptions(current: number | undefined): SelectOption[] {
  const currentYear = new Date().getUTCFullYear();
  const years = new Set(Array.from({ length: 20 }, (_, index) => currentYear - 2 + index));
  if (current !== undefined) {
    years.add(current);
  }
  return [...years].sort((a, b) => a - b).map((year) => ({ value: String(year), label: String(year), selected: current === year }));
}

function noteRow(note: CaseNote): WoonbehoefteNoteRow {
  return {
    categoryLabel: NOTE_CATEGORY_LABELS[note.category],
    text: note.text,
    createdByLabel: note.createdBy,
    createdAtLabel: formatDutchDateTime(note.createdAt),
  };
}

function activityRow(activity: CaseActivity): WoonbehoefteActivityRow {
  return {
    summary: activity.summary,
    actor: activity.actor,
    occurredAtLabel: formatDutchDateTime(activity.occurredAt),
    changeLines: (activity.changes ?? []).map(formatActivityChangeLine),
  };
}

export function buildWoonbehoefteDetailViewModel(
  woonbehoefteCase: WoonbehoefteCase,
  source: WoonbehoefteSourceRecord | undefined,
  sourceAvailability: WoonbehoefteSourceAvailability,
  documents: WoonbehoefteDocumentRow[],
  notes: CaseNote[],
  activities: CaseActivity[],
  canManage: boolean,
  actorEmail: string | undefined,
  backQuery: string,
  csrfToken?: string,
  additionalDocumentGroups: AdditionalEvidenceCaseDocumentGroup[] = [],
): WoonbehoefteDetailViewModel {
  const assessment: CaseAssessment = woonbehoefteCase.assessment;
  const sortedNotes = [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const sortedActivities = [...activities].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const canUseGenericStatusSelect = (GENERIC_STATUSES as string[]).includes(woonbehoefteCase.status);
  const checkRequestNoteText = woonbehoefteCase.check.requested && woonbehoefteCase.check.requestNoteId
    ? notes.find((note) => note.noteId === woonbehoefteCase.check.requestNoteId)?.text
    : undefined;
  const applicationDocument = documents.find((document) => document.isApplicationPdf);
  const attachments = documents.filter((document) => !document.isApplicationPdf);

  return {
    caseReference: woonbehoefteCase.caseReference,
    version: woonbehoefteCase.version,
    statusLabel: CASE_STATUS_LABELS[woonbehoefteCase.status],
    statusToken: woonbehoefteCase.status.toLowerCase().replace(/_/g, '-'),
    assigneeLabel: woonbehoefteCase.claimedBy ?? 'Ongeclaimd',
    isUnclaimed: woonbehoefteCase.claimedBy === undefined,
    checkRequested: woonbehoefteCase.check.requested,
    ...(woonbehoefteCase.check.requested && woonbehoefteCase.check.requestedBy
      ? {
        checkRequestedInfo: `Check gevraagd door ${woonbehoefteCase.check.requestedBy}`
          + (woonbehoefteCase.check.requestedAt ? ` op ${formatDutchDateTime(woonbehoefteCase.check.requestedAt)}` : ''),
      }
      : {}),
    ...withOptional('checkRequestNoteText', checkRequestNoteText),
    receivedLabel: source ? formatDutchDateTime(source.registrationAt) : '-',
    statusSinceLabel: formatDutchDateTime(woonbehoefteCase.statusChangedAt),

    backHref: `/woonbehoefte${backQuery ? `?${backQuery}` : ''}`,
    backQuery,

    hasSource: sourceAvailability === 'READY',
    ...(sourceAvailability !== 'READY' ? { sourceErrorMessage: sourceErrorMessage(sourceAvailability) } : {}),

    projectName: source?.projectName ?? 'Onbekend project (bron nog niet beschikbaar)',
    ...(source?.projectDescription ? { projectDescription: source.projectDescription } : {}),
    ...(source?.contactName ? { contactName: source.contactName } : {}),
    ...(source?.contactPhone ? { contactPhone: source.contactPhone } : {}),
    ...(source?.contactEmail ? { contactEmail: source.contactEmail } : {}),
    ...(source?.totalHomes !== undefined ? { totalHomesLabel: String(source.totalHomes) } : {}),
    ...withOptional('hasExistingLianderRequestLabel', yesNoLabel(source?.hasExistingLianderRequest)),
    ...(source?.eanOrApplicationNumber ? { eanOrApplicationNumber: source.eanOrApplicationNumber } : {}),
    applicantTypeLabel: APPLICANT_TYPE_LABELS[source?.applicantType ?? 'UNKNOWN'],
    ...withOptional('collectiveHousingLabel', yesNoLabel(source?.isCollectiveHousing)),
    ...withOptional('hasCollectiveFacilitiesLabel', yesNoLabel(source?.hasCollectiveFacilities)),
    ...withOptional('hasKovaLabel', yesNoLabel(source?.hasKova)),
    ...(source?.collectiveHousingCategory ? { collectiveHousingCategory: source.collectiveHousingCategory } : {}),

    submittedStartDateLabel: source?.submittedStartDate ? formatDutchDate(source.submittedStartDate) : '-',
    assessedStartPeriodLabel: formatPeriodLabel(assessment.assessedStartPeriod),
    assessedStartExplanationValue: assessment.assessedStartExplanation ?? '',
    submittedCompletionDateLabel: source?.submittedCompletionDate ? formatDutchDate(source.submittedCompletionDate) : '-',
    assessedCompletionPeriodLabel: formatPeriodLabel(assessment.assessedCompletionPeriod),
    assessedCompletionExplanationValue: assessment.assessedCompletionExplanation ?? '',
    submittedReadinessLabel: source?.submittedProjectReadiness
      ? PROJECT_READINESS_LABELS[source.submittedProjectReadiness]
      : 'Kon niet eenduidig worden vastgesteld',
    ...withOptional(
      'submittedReadinessConditionText',
      source?.submittedProjectReadiness ? PROJECT_READINESS_CONDITIONS[source.submittedProjectReadiness] : undefined,
    ),
    assessedReadinessLabel: assessment.assessedProjectReadiness
      ? PROJECT_READINESS_LABELS[assessment.assessedProjectReadiness] : 'Nog niet vastgesteld',

    ...(applicationDocument ? { applicationDocument } : {}),
    attachments,
    hasAttachments: attachments.length > 0,
    attachmentCountLabel: `Bijlagen (${attachments.length})`,
    additionalDocumentGroups,
    hasAdditionalDocumentGroups: additionalDocumentGroups.length > 0,

    notes: sortedNotes.map(noteRow),
    hasNotes: sortedNotes.length > 0,
    activities: sortedActivities.map(activityRow),
    hasActivities: sortedActivities.length > 0,

    canManage,
    ...(csrfToken ? { csrfToken } : {}),
    canClaim: canManage && woonbehoefteCase.claimedBy === undefined,
    canRelease: canManage && woonbehoefteCase.claimedBy === actorEmail,
    canTakeOver: canManage && woonbehoefteCase.claimedBy !== undefined && woonbehoefteCase.claimedBy !== actorEmail,
    canUseGenericStatusSelect,
    statusOptions: GENERIC_STATUSES.map((status) => ({
      value: status, label: CASE_STATUS_LABELS[status], selected: status === woonbehoefteCase.status,
    })),
    isProposedInadmissible: woonbehoefteCase.status === 'PROPOSED_INADMISSIBLE',
    isInadmissible: woonbehoefteCase.status === 'INADMISSIBLE',
    applicationCompleteOptions: ternaryOptions(assessment.applicationComplete),
    boardDeclarationApprovedOptions: ternaryOptions(assessment.boardDeclarationApproved),
    chamberOfCommerceApprovedOptions: ternaryOptions(assessment.chamberOfCommerceApproved),
    planningAgreementEvidenceApprovedOptions: ternaryOptions(assessment.planningAgreementEvidenceApproved),
    planningPublicDecisionEvidenceApprovedOptions: ternaryOptions(assessment.planningPublicDecisionEvidenceApproved),
    projectReadinessEvidenceApprovedOptions: ternaryOptions(assessment.projectReadinessEvidenceApproved),
    assessedStartMonthOptions: monthOptions(assessment.assessedStartPeriod ? assessment.assessedStartPeriod % 100 : undefined),
    assessedStartYearOptions: yearOptions(periodYear(assessment.assessedStartPeriod)),
    assessedCompletionMonthOptions: monthOptions(assessment.assessedCompletionPeriod ? assessment.assessedCompletionPeriod % 100 : undefined),
    assessedCompletionYearOptions: yearOptions(periodYear(assessment.assessedCompletionPeriod)),
    readinessOptions: [1, 2, 3, 4, 5, 6].map((value) => ({
      value: String(value), label: PROJECT_READINESS_LABELS[value], selected: assessment.assessedProjectReadiness === value,
    })),
    noteCategoryOptions: (Object.keys(NOTE_CATEGORY_LABELS) as CaseNoteCategory[])
      .map((value) => ({ value, label: NOTE_CATEGORY_LABELS[value], selected: false })),
    checkOutcomeOptions: (['OK', 'CHANGES_NEEDED'] as const).map((value) => ({ value, label: CHECK_OUTCOME_LABELS[value], selected: false })),
  };
}

function sourceErrorMessage(availability: WoonbehoefteSourceAvailability): string {
  return availability === 'FAILED'
    ? 'De brongegevens van deze aanvraag konden niet worden verwerkt. Bekijk de aanvraag-PDF of probeer een verversing.'
    : 'De brongegevens van deze aanvraag zijn nog niet beschikbaar. Probeer een verversing.';
}

function withOptional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
}
