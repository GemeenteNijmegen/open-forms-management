import { buildProjectDetailsLocationViewModel, ProjectDetailsLocationViewModel } from './ProjectDetailsLocationViewModel';
import {
  deriveProjectDetailsStatus, FacilityLine, HOUSING_LINE_TYPES, HousingLine, HousingLineType, KovaLine,
  ProjectDetailsAttempt, ProjectDetailsWorkVersion,
} from '../domain/ProjectDetails';

export const HOUSING_LINE_TYPE_LABELS: Record<HousingLineType, string> = {
  WOONHUIS: 'Woonhuis',
  APPARTEMENTEN: 'Appartementen',
  COLLECTIEF_WONEN: 'Collectief wonen',
  APPARTEMENTEN_COLLECTIEF_WONEN: 'Appartementen / collectief wonen',
};

export interface SelectOption {
  value: string;
  label: string;
  selected: boolean;
}

export interface ProjectDetailsLineCardViewModel {
  lineId: string;
  number: number;
  connectionCount: number;
  connectionType: string;
  otherDetails: string;
  typeOptions?: SelectOption[];
  homesAccordingToFormLabel?: string;
  facilityType?: string;
  kovaFunction?: string;
  // Mustache.js has no parent-context (`../`) lookup, so every field a line's own form needs is duplicated onto the card itself.
  caseReference: string;
  canManage: boolean;
  csrfToken?: string;
  backQuery: string;
}

export interface ProjectDetailsViewModel extends ProjectDetailsLocationViewModel {
  status: string;
  isNew: boolean;
  isPending: boolean;
  isReady: boolean;
  isFailed: boolean;
  isUnavailable: boolean;
  failureReasonCode?: string;
  canManage: boolean;
  csrfToken?: string;
  backQuery: string;
  caseReference: string;
  fullProjectName?: string;
  readableProjectName?: string;
  projectDescription?: string;
  additionalInformation?: string;
  mijnAansluitingKenmerk?: string;
  projectWideNotes?: string;
  housingLines: ProjectDetailsLineCardViewModel[];
  hasHousingLines: boolean;
  facilityLines: ProjectDetailsLineCardViewModel[];
  hasFacilityLines: boolean;
  kovaLines: ProjectDetailsLineCardViewModel[];
  hasKovaLines: boolean;
}

function housingTypeOptions(current: HousingLineType): SelectOption[] {
  return HOUSING_LINE_TYPES.map((value) => ({ value, label: HOUSING_LINE_TYPE_LABELS[value], selected: value === current }));
}

interface LineCardContext {
  caseReference: string;
  canManage: boolean;
  csrfToken?: string;
  backQuery: string;
}

function housingLineCard(line: HousingLine, number: number, context: LineCardContext): ProjectDetailsLineCardViewModel {
  return {
    lineId: line.lineId,
    number,
    connectionCount: line.connectionCount,
    connectionType: line.connectionType,
    otherDetails: line.otherDetails,
    typeOptions: housingTypeOptions(line.type),
    ...(line.homesAccordingToForm !== undefined ? { homesAccordingToFormLabel: String(line.homesAccordingToForm) } : {}),
    ...context,
  };
}

function facilityLineCard(line: FacilityLine, number: number, context: LineCardContext): ProjectDetailsLineCardViewModel {
  return {
    lineId: line.lineId,
    number,
    connectionCount: line.connectionCount,
    connectionType: line.connectionType,
    otherDetails: line.otherDetails,
    facilityType: line.facilityType,
    ...context,
  };
}

function kovaLineCard(line: KovaLine, number: number, context: LineCardContext): ProjectDetailsLineCardViewModel {
  return {
    lineId: line.lineId,
    number,
    connectionCount: line.connectionCount,
    connectionType: line.connectionType,
    otherDetails: line.otherDetails,
    kovaFunction: line.function,
    ...context,
  };
}

function byOrder<T extends { order: number }>(lines: Record<string, T>): T[] {
  return Object.values(lines).sort((a, b) => a.order - b.order);
}

// Detail-page only: prefixes the copyable full project name with the live ranking position, if any.
// Uses plain hyphens (no spaces) to stay distinct from composeFullProjectName, which the Excel export still uses unchanged.
function composeRankedProjectName(rank: number | undefined, caseReference: string, readableProjectName: string): string {
  const base = readableProjectName ? `${caseReference}-${readableProjectName}` : caseReference;
  return rank !== undefined ? `${rank}-${base}` : base;
}

/**
 * READY toont de volledige bewerkbare sectie; NEW/PENDING/FAILED tonen alleen een statusmelding (en bij
 * NEW/FAILED, met `manage`, een startknop). `csrfToken`/`backQuery` komen van de bestaande detailpagina,
 * geen eigen token: dezelfde POST-formulieren delen de dubbele-submit-cookie van de rest van de pagina.
 */
export function buildProjectDetailsViewModel(
  caseReference: string, workVersion: ProjectDetailsWorkVersion | undefined, attempt: ProjectDetailsAttempt | undefined,
  canManage: boolean, csrfToken: string | undefined, backQuery: string, locationErrorCode: string | undefined = undefined,
  rank: number | undefined = undefined, now: Date = new Date(),
): ProjectDetailsViewModel {
  const status = deriveProjectDetailsStatus(workVersion, attempt, now);
  const lineContext: LineCardContext = { caseReference, canManage, backQuery, ...(csrfToken ? { csrfToken } : {}) };

  return {
    ...buildProjectDetailsLocationViewModel(workVersion, locationErrorCode),
    status,
    isNew: status === 'NEW',
    isPending: status === 'PENDING',
    isReady: status === 'READY',
    isFailed: status === 'FAILED',
    isUnavailable: false,
    ...(status === 'FAILED' && attempt?.failureReasonCode ? { failureReasonCode: attempt.failureReasonCode } : {}),
    canManage,
    ...(csrfToken ? { csrfToken } : {}),
    backQuery,
    caseReference,
    ...(workVersion
      ? {
        fullProjectName: composeRankedProjectName(rank, caseReference, workVersion.readableProjectName),
        readableProjectName: workVersion.readableProjectName,
        projectDescription: workVersion.projectDescription,
        additionalInformation: workVersion.additionalInformation,
        mijnAansluitingKenmerk: workVersion.mijnAansluitingKenmerk ?? '',
        projectWideNotes: workVersion.projectWideNotes,
      }
      : {}),
    housingLines: workVersion ? byOrder(workVersion.housingLines).map((line, index) => housingLineCard(line, index + 1, lineContext)) : [],
    hasHousingLines: Boolean(workVersion && Object.keys(workVersion.housingLines).length > 0),
    facilityLines: workVersion
      ? byOrder(workVersion.collectiveFacilityLines).map((line, index) => facilityLineCard(line, index + 1, lineContext)) : [],
    hasFacilityLines: Boolean(workVersion && Object.keys(workVersion.collectiveFacilityLines).length > 0),
    kovaLines: workVersion ? byOrder(workVersion.kovaLines).map((line, index) => kovaLineCard(line, index + 1, lineContext)) : [],
    hasKovaLines: Boolean(workVersion && Object.keys(workVersion.kovaLines).length > 0),
  };
}

/** Gebruikt wanneer het lezen van de werkversie/pogingstatus zelf mislukt: de rest van de detailpagina blijft bruikbaar. */
export function buildUnavailableProjectDetailsViewModel(
  caseReference: string, canManage: boolean, csrfToken: string | undefined, backQuery: string,
): ProjectDetailsViewModel {
  return {
    ...buildProjectDetailsLocationViewModel(undefined, undefined),
    status: 'UNAVAILABLE',
    isNew: false,
    isPending: false,
    isReady: false,
    isFailed: false,
    isUnavailable: true,
    canManage,
    ...(csrfToken ? { csrfToken } : {}),
    backQuery,
    caseReference,
    housingLines: [],
    hasHousingLines: false,
    facilityLines: [],
    hasFacilityLines: false,
    kovaLines: [],
    hasKovaLines: false,
  };
}
