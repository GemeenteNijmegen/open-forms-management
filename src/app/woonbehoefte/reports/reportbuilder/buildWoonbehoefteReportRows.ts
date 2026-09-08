import { WoonbehoefteReportRow } from './WoonbehoefteReportRow';
import {
  APPLICANT_TYPE_LABELS, CASE_STATUS_LABELS, CHECK_OUTCOME_LABELS, PROJECT_READINESS_LABELS,
  TERNARY_ASSESSMENT_LABELS, TERNARY_ASSESSMENT_UNASSESSED_LABEL,
} from '../../domain/CaseLabels';
import { TernaryAssessment } from '../../domain/WoonbehoefteCase';
import { formatDutchDateTime, formatPeriodLabel, periodMonth, periodYear } from '../../domain/WoonbehoefteFormatting';
import { WoonbehoefteCaseWithSource } from '../../overview/WoonbehoefteOverviewViewModel';
import { AttachmentFilenamesOutcome } from '../attachments/WoonbehoefteReportAttachments';
import { RawFormFieldsOutcome } from '../rawformfields/fetchWoonbehoefteRawFormFields';

const MISSING_SOURCE_WARNING = 'Primaire bron ontbreekt of heeft een bronconflict.';

function ternaryLabel(value: TernaryAssessment | undefined): string {
  return value ? TERNARY_ASSESSMENT_LABELS[value] : TERNARY_ASSESSMENT_UNASSESSED_LABEL;
}

function booleanLabel(value: boolean | undefined): string {
  return value === undefined ? '' : (value ? 'Ja' : 'Nee');
}

/**
 * entries must already be filtered and sorted identically to the overview; this only maps them to export
 * rows. rawFormFieldsByCaseReference/attachmentFilenamesByCaseReference are empty unless their report
 * option was on.
 */
export function buildWoonbehoefteReportRows(
  entries: WoonbehoefteCaseWithSource[],
  rawFormFieldsByCaseReference: Map<string, RawFormFieldsOutcome> = new Map(),
  attachmentFilenamesByCaseReference: Map<string, AttachmentFilenamesOutcome> = new Map(),
): WoonbehoefteReportRow[] {
  return entries.map((entry) => buildRow(
    entry,
    rawFormFieldsByCaseReference.get(entry.woonbehoefteCase.caseReference),
    attachmentFilenamesByCaseReference.get(entry.woonbehoefteCase.caseReference),
  ));
}

function buildRow(
  { woonbehoefteCase: c, source, hasSourceConflict }: WoonbehoefteCaseWithSource,
  rawOutcome?: RawFormFieldsOutcome,
  attachmentOutcome?: AttachmentFilenamesOutcome,
): WoonbehoefteReportRow {
  const a = c.assessment;
  const readiness = a.assessedProjectReadiness;
  const submittedReadiness = source?.submittedProjectReadiness;

  return {
    caseReference: c.caseReference,
    projectName: source?.projectName ?? '',
    statusLabel: CASE_STATUS_LABELS[c.status],

    assessedStartPeriodLabel: formatPeriodLabel(a.assessedStartPeriod),
    assessedStartYear: periodYear(a.assessedStartPeriod),
    assessedStartMonth: periodMonth(a.assessedStartPeriod),
    assessedCompletionPeriodLabel: formatPeriodLabel(a.assessedCompletionPeriod),
    assessedCompletionYear: periodYear(a.assessedCompletionPeriod),
    assessedCompletionMonth: periodMonth(a.assessedCompletionPeriod),
    assessedProjectReadinessCategory: readiness,
    assessedProjectReadinessLabel: readiness ? PROJECT_READINESS_LABELS[readiness] : 'Nog niet vastgesteld',
    assigneeLabel: c.claimedBy ?? 'Ongeclaimd',
    claimedAtLabel: c.claimedAt ? formatDutchDateTime(c.claimedAt) : '',
    statusSinceLabel: formatDutchDateTime(c.statusChangedAt),

    applicationCompleteLabel: ternaryLabel(a.applicationComplete),
    boardDeclarationApprovedLabel: ternaryLabel(a.boardDeclarationApproved),
    chamberOfCommerceApprovedLabel: ternaryLabel(a.chamberOfCommerceApproved),
    planningAgreementEvidenceApprovedLabel: ternaryLabel(a.planningAgreementEvidenceApproved),
    planningPublicDecisionEvidenceApprovedLabel: ternaryLabel(a.planningPublicDecisionEvidenceApproved),
    projectReadinessEvidenceApprovedLabel: ternaryLabel(a.projectReadinessEvidenceApproved),
    assessedStartExplanation: a.assessedStartExplanation ?? '',
    assessedCompletionExplanation: a.assessedCompletionExplanation ?? '',

    checkRequestedLabel: booleanLabel(c.check.requested),
    checkRequestedAtLabel: c.check.requestedAt ? formatDutchDateTime(c.check.requestedAt) : '',
    checkRequestedByLabel: c.check.requestedBy ?? '',
    lastCheckedAtLabel: c.check.lastCheckedAt ? formatDutchDateTime(c.check.lastCheckedAt) : '',
    lastCheckedByLabel: c.check.lastCheckedBy ?? '',
    lastCheckOutcomeLabel: c.check.lastOutcome ? CHECK_OUTCOME_LABELS[c.check.lastOutcome] : '',

    rankingPeriod: c.ranking?.period,
    ranking: c.ranking?.rank,
    rankingAfterLottery: c.ranking?.rankAfterLottery,
    lotteryLabel: booleanLabel(c.ranking?.lottery),

    receivedAtLabel: source ? formatDutchDateTime(source.registrationAt) : '',
    formNameLabel: source?.formName ?? '',
    projectDescription: source?.projectDescription ?? '',
    contactName: source?.contactName ?? '',
    contactPhone: source?.contactPhone ?? '',
    contactEmail: source?.contactEmail ?? '',
    existingLianderRequestLabel: booleanLabel(source?.hasExistingLianderRequest),
    eanOrApplicationNumber: source?.eanOrApplicationNumber ?? '',
    totalHomes: source?.totalHomes,
    // Raw CSV passthrough, not a normalized date: never reformatted, see WoonbehoefteCsvParser.
    submittedStartDate: source?.submittedStartDate ?? '',
    startDateExplanation: source?.startDateExplanation ?? '',
    submittedCompletionDate: source?.submittedCompletionDate ?? '',
    submittedProjectReadinessCategory: submittedReadiness,
    submittedProjectReadinessLabel: submittedReadiness ? PROJECT_READINESS_LABELS[submittedReadiness] : '',
    applicantTypeLabel: APPLICANT_TYPE_LABELS[source?.applicantType ?? 'UNKNOWN'],
    collectiveHousingLabel: booleanLabel(source?.isCollectiveHousing),
    collectiveHousingCategory: source?.collectiveHousingCategory ?? '',
    collectiveFacilitiesLabel: booleanLabel(source?.hasCollectiveFacilities),
    kovaLabel: booleanLabel(source?.hasKova),

    rawFormFields: rawOutcome?.fields,
    attachmentFilenamesText: attachmentOutcome?.filenamesText ?? '',
    sourceWarning: [
      hasSourceConflict || !source ? MISSING_SOURCE_WARNING : undefined,
      rawOutcome?.warning,
      attachmentOutcome?.warning,
    ].filter((warning): warning is string => Boolean(warning)).join('\n'),
  };
}
