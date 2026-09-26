import { ProjectLocationIssueCode, ProjectPolygon } from '../location/ProjectLocation';

/**
 * Werkregel-type voor Wonen, afgeleid uit `typeWoonobject` en `isCollectieveWoonvorm` in
 * ProjectDetailsCsvParser; nooit rechtstreeks uit een enkel bronveld overgenomen.
 */
export const HOUSING_LINE_TYPES = ['WOONHUIS', 'APPARTEMENTEN', 'COLLECTIEF_WONEN', 'APPARTEMENTEN_COLLECTIEF_WONEN'] as const;
export type HousingLineType = typeof HOUSING_LINE_TYPES[number];

export function isHousingLineType(value: unknown): value is HousingLineType {
  return typeof value === 'string' && (HOUSING_LINE_TYPES as readonly string[]).includes(value);
}

interface ProjectDetailsLineBase {
  lineId: string;
  /** Volgorde van eerste voorkomen in de bron, of van toevoegen door een medewerker. Presentatie, geen sleutel. */
  order: number;
  connectionCount: number;
  connectionType: string;
  otherDetails: string;
}

export interface HousingLine extends ProjectDetailsLineBase {
  type: HousingLineType;
  /** Bronnotitie `aantalWoningen`; alleen-lezen in de UI. */
  homesAccordingToForm?: number;
}

export interface FacilityLine extends ProjectDetailsLineBase {
  facilityType: string;
}

export interface KovaLine extends ProjectDetailsLineBase {
  function: string;
}

/**
 * De werkversie is één item per dossier (`sk = WORKVERSION`). Regelgroepen staan als Map op
 * stabiele `lineId`, niet als List: een gerichte `SET category.#lineId = ...` raakt zo nooit een
 * arrayindex van een andere regel en overschrijft nooit een sibling-veld.
 */
export interface ProjectDetailsWorkVersion {
  caseReference: string;
  readableProjectName: string;
  projectDescription: string;
  additionalInformation: string;
  projectWideNotes: string;
  housingLines: Record<string, HousingLine>;
  collectiveFacilityLines: Record<string, FacilityLine>;
  kovaLines: Record<string, KovaLine>;
  /** Geometrie uit de formulier-CSV. Afwezig zolang de bron leeg, onleesbaar of ongeldig was; zie sourceLocationIssue voor de reden. */
  sourceLocationPolygon?: ProjectPolygon;
  sourceLocationIssue?: ProjectLocationIssueCode;
  /** Door een medewerker geplakte polygon. Heeft voorrang boven sourceLocationPolygon zodra aanwezig. */
  manualLocationPolygon?: ProjectPolygon;
  manualLocationSetAt?: string;
  manualLocationSetBy?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

/**
 * Zelfde samenstelling voor de detailpagina en de GeoJSON-download, zodat beide altijd dezelfde naam tonen.
 * Een lege leesbare naam (een handmatig leeg gestarte werkversie) valt terug op alleen het OF-kenmerk, in
 * plaats van een kaal "OF-kenmerk - " over te houden.
 */
export function composeFullProjectName(caseReference: string, readableProjectName: string): string {
  return readableProjectName ? `${caseReference} - ${readableProjectName}` : caseReference;
}

export type ProjectDetailsAttemptStatus = 'PENDING' | 'FAILED';

/** Pogingstatus (`sk = ATTEMPT`) van de laatste voorinvulling; alleen relevant zolang er geen werkversie bestaat. */
export interface ProjectDetailsAttempt {
  caseReference: string;
  status: ProjectDetailsAttemptStatus;
  attemptedAt: string;
  failureReasonCode?: string;
}

export type ProjectDetailsBatchStatus = 'RUNNING' | 'READY' | 'READY_WITH_ERRORS' | 'CUTOFF';

/**
 * Eén item (`pk = PROJECTDETAILSBATCH`, `sk = STATE`) dat telkens de laatste batchrun beschrijft. Geen
 * claim/lock: een gelijktijdige tweede batch overschrijft dit item gewoon, zelfde geaccepteerde tradeoff
 * als het ontbreken van een lock op de batch zelf.
 */
export interface ProjectDetailsBatchState {
  runId: string;
  status: ProjectDetailsBatchStatus;
  startedAt: string;
  completedAt?: string;
  created?: number;
  skipped?: number;
  failed?: number;
}

export type ProjectDetailsBatchDisplayStatus = 'RUNNING' | 'STALE_RUNNING' | ProjectDetailsBatchStatus;

/** Lambda's harde timeout is 15 minuten; een kleine marge erbovenop voorkomt dat een net-op-tijd afgeronde run als stale toont. */
const STALE_BATCH_RUNNING_AFTER_MS = 16 * 60 * 1000;

/**
 * RUNNING betekent normaal gewoon "loopt nog", maar na een harde Lambda-timeout of een crash schrijft de
 * worker nooit een eindstatus, dus blijft RUNNING voor altijd staan. Dit rekent RUNNING om naar
 * STALE_RUNNING zodra startedAt te oud is, puur bij het tonen: er wordt niets teruggeschreven.
 */
export function deriveProjectDetailsBatchDisplayStatus(
  state: ProjectDetailsBatchState | undefined, now: Date = new Date(),
): ProjectDetailsBatchDisplayStatus | undefined {
  if (!state) {
    return undefined;
  }
  if (state.status === 'RUNNING') {
    const ageMs = now.getTime() - new Date(state.startedAt).getTime();
    return ageMs > STALE_BATCH_RUNNING_AFTER_MS ? 'STALE_RUNNING' : 'RUNNING';
  }
  return state.status;
}

export type ProjectDetailsStatus = 'NEW' | 'PENDING' | 'READY' | 'FAILED';

/** Lambda's harde timeout is 900s; een poging die daarna nog PENDING is, is een gecrashte worker, geen lopende poging. */
const STALE_PENDING_AFTER_MS = 15 * 60 * 1000;

/**
 * Een werkversie heeft altijd voorrang boven de pogingstatus, ook als die nog FAILED/PENDING zegt. Een
 * PENDING-poging die ouder is dan de Lambda-timeout wordt hier als FAILED behandeld, zonder dat daarvoor
 * een aparte schrijfactie nodig is: dezelfde lazy-herstelaanpak als de stale QUEUED/BUILDING-status bij
 * de Excel-rapporten.
 */
export function deriveProjectDetailsStatus(
  workVersion: ProjectDetailsWorkVersion | undefined, attempt: ProjectDetailsAttempt | undefined, now: Date = new Date(),
): ProjectDetailsStatus {
  if (workVersion) {
    return 'READY';
  }
  if (attempt?.status === 'PENDING') {
    const attemptAgeMs = now.getTime() - new Date(attempt.attemptedAt).getTime();
    return attemptAgeMs > STALE_PENDING_AFTER_MS ? 'FAILED' : 'PENDING';
  }
  if (attempt?.status === 'FAILED') {
    return 'FAILED';
  }
  return 'NEW';
}

export type ProjectDetailsLineCategory = 'WONEN' | 'VOORZIENING' | 'KOVA';

export type ProjectDetailsHistoryAction =
  | 'INITIALIZED'
  | 'MANUALLY_STARTED'
  | 'PROJECT_UPDATED'
  | 'ADDITIONAL_INFO_UPDATED'
  | 'PROJECT_WIDE_NOTES_UPDATED'
  | 'LINE_CREATED'
  | 'LINE_UPDATED'
  | 'LINE_DELETED'
  | 'LOCATION_ADDED'
  | 'LOCATION_REPLACED';

/** Immutable (`sk = HISTORY#<occurredAt>#<historyId>`); nooit vrije tekst of brondata, alleen wat een wijziging herleidbaar maakt. */
export interface ProjectDetailsHistoryEntry {
  historyId: string;
  caseReference: string;
  actor: string;
  occurredAt: string;
  action: ProjectDetailsHistoryAction;
  category?: ProjectDetailsLineCategory;
  lineId?: string;
}
