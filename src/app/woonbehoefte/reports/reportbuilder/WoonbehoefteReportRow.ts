import { WoonbehoefteRawFormRow } from '../rawformfields/WoonbehoefteRawFormFields';

/**
 * One case = one Excel row, fixed columns only (sections A-E, H of 04_REPORT_DATA_AND_COLUMNS.md).
 * Label fields are pre-formatted display strings (reusing the same central label maps as the rest of the
 * app); the writer only decides cell type/formatting, it never derives a label itself.
 */
export interface WoonbehoefteReportRow {
  caseReference: string;
  projectName: string;
  statusLabel: string;

  assessedStartPeriodLabel: string;
  assessedStartYear?: number;
  assessedStartMonth?: number;
  assessedCompletionPeriodLabel: string;
  assessedCompletionYear?: number;
  assessedCompletionMonth?: number;
  assessedProjectReadinessCategory?: number;
  assessedProjectReadinessLabel: string;
  assigneeLabel: string;
  claimedAtLabel: string;
  statusSinceLabel: string;

  applicationCompleteLabel: string;
  boardDeclarationApprovedLabel: string;
  chamberOfCommerceApprovedLabel: string;
  planningAgreementEvidenceApprovedLabel: string;
  planningPublicDecisionEvidenceApprovedLabel: string;
  projectReadinessEvidenceApprovedLabel: string;
  assessedStartExplanation: string;
  assessedCompletionExplanation: string;

  checkRequestedLabel: string;
  checkRequestedAtLabel: string;
  checkRequestedByLabel: string;
  lastCheckedAtLabel: string;
  lastCheckedByLabel: string;
  lastCheckOutcomeLabel: string;

  rankingPeriod?: number;
  ranking?: number;
  rankingAfterLottery?: number;
  lotteryLabel: string;

  receivedAtLabel: string;
  formNameLabel: string;
  projectDescription: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  existingLianderRequestLabel: string;
  eanOrApplicationNumber: string;
  totalHomes?: number;
  submittedStartDate: string;
  startDateExplanation: string;
  submittedCompletionDate: string;
  submittedProjectReadinessCategory?: number;
  submittedProjectReadinessLabel: string;
  applicantTypeLabel: string;
  collectiveHousingLabel: string;
  collectiveHousingCategory: string;
  collectiveFacilitiesLabel: string;
  kovaLabel: string;

  /** Only set when includeAllFormFields is on and the fetch/parse succeeded for this case. */
  rawFormFields?: WoonbehoefteRawFormRow;

  /** Always present, empty unless includeAttachmentFilenames is on. One filename per line, primary attachments first. */
  attachmentFilenamesText: string;

  /** Always present, usually empty. Multiple warnings share one cell, one per line. */
  sourceWarning: string;
}
