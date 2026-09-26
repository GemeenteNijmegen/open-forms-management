import { randomUUID } from 'crypto';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { beginProjectDetailsAction, isProjectDetailsActionRejected } from './ProjectDetailsActionSupport';
import { xRayTraceId } from '../../../../observability/xRayTraceId';
import { AuditTrail } from '../../../../shared/audit/AuditTrail';
import { recordAudit } from '../../../../shared/audit/recordAudit';
import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { redirectToWoonbehoefteCase } from '../../actions/WoonbehoefteActionSupport';
import {
  deriveProjectDetailsStatus, FacilityLine, HousingLine, isHousingLineType, KovaLine, ProjectDetailsLineCategory, ProjectDetailsWorkVersion,
} from '../domain/ProjectDetails';
import { LineMutationResult, ProjectDetailsStore } from '../persistence/ProjectDetailsStore';

const CATEGORY_URL_PARAMS: Record<string, ProjectDetailsLineCategory> = { wonen: 'WONEN', voorziening: 'VOORZIENING', kova: 'KOVA' };
const CATEGORY_SLUGS: Record<ProjectDetailsLineCategory, string> = { WONEN: 'wonen', VOORZIENING: 'voorziening', KOVA: 'kova' };
const CATEGORY_HEADING_IDS: Record<ProjectDetailsLineCategory, string> = {
  WONEN: 'projectdetails-wonen', VOORZIENING: 'projectdetails-voorziening', KOVA: 'projectdetails-kova',
};

export function parseProjectDetailsCategoryParam(value: string | undefined): ProjectDetailsLineCategory | undefined {
  return value ? CATEGORY_URL_PARAMS[value] : undefined;
}

/** Zelfde kaart-id als de bijbehorende `<details id="...">` in woonbehoefte-detail.mustache, zodat een redirect na Opslaan/Toevoegen er direct naartoe springt. */
function lineCardFragment(category: ProjectDetailsLineCategory, lineId: string): string {
  return `pd-${CATEGORY_SLUGS[category]}-line-${lineId}`;
}

function parseConnectionCount(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === '') {
    return undefined;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

// Technische bovengrens tegen een gemanipuleerde POST, geen inhoudelijke validatie: ruim boven wat een medewerker ooit zou intypen,
// ruim onder de DynamoDB-itemgrens (400 KB) waar het grootste echte dossier nu op circa 5,7 KB uitkomt.
const MAX_SHORT_FIELD_LENGTH = 500;
const MAX_FREE_TEXT_LENGTH = 10_000;

function withinLength(value: string, maxLength: number): boolean {
  return value.length <= maxLength;
}

/**
 * Elke geslaagde mutatie schrijft één centraal audit-event met alleen eventtype/caseReference/categorie/
 * regel-ID, nooit veldinhoud. Een mislukte audit-write mag de al geslaagde opslag nooit als mislukt
 * voorstellen: `recordAudit` slikt zijn eigen fout al in (zie `recordAudit.ts`), dus dit wacht 'm gewoon af.
 */
async function auditProjectDetailsChange(
  auditTrail: AuditTrail, actorEmail: string, caseReference: string, action: string,
  category?: ProjectDetailsLineCategory, lineId?: string,
): Promise<void> {
  await recordAudit(auditTrail, {
    eventType: 'WOONBEHOEFTE_PROJECT_DETAILS_UPDATED',
    outcome: 'SUCCESS',
    correlationId: xRayTraceId(),
    resource: 'woonbehoefte',
    action: 'project_details_updated',
    actorEmail,
    metadata: { caseReference, changeAction: action, ...(category ? { category } : {}), ...(lineId ? { lineId } : {}) },
  });
}

/**
 * POST-acties voor het bewerken van een werkversie: elke actie raakt precies één onderdeel (project,
 * aanvullende informatie, projectbrede gegevens, of één regelgroep) en nooit een volledig oud
 * formuliersnapshot, zie `ProjectDetailsStore`. Geen generieke optimistic locking: last-write-wins per
 * onderdeel is een expliciet besluit.
 */
export class ProjectDetailsActionHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly store: ProjectDetailsStore,
    private readonly auditTrail: AuditTrail,
  ) { }

  async handleProject(
    identity: EmployeeIdentity, caseReference: string | undefined, cookieHeader: string | undefined,
    body: string | undefined, isBase64Encoded: boolean,
  ): Promise<ApiGatewayV2Response> {
    if (!caseReference) {
      return Response.error(400);
    }
    const begun = await beginProjectDetailsAction(this.authorizationService, identity, cookieHeader, body, isBase64Encoded);
    if (isProjectDetailsActionRejected(begun)) {
      return begun;
    }
    const { form, back } = begun;
    const readableProjectName = form.get('readableProjectName')?.trim();
    const projectDescription = form.get('projectDescription') ?? '';
    if (
      !readableProjectName || !withinLength(readableProjectName, MAX_SHORT_FIELD_LENGTH) || !withinLength(projectDescription, MAX_FREE_TEXT_LENGTH)
    ) {
      return Response.error(400);
    }

    const actorEmail = identity.email ?? identity.principalId;
    const result = await this.store.updateProject(caseReference, readableProjectName, projectDescription, actorEmail);
    return this.redirectAfter(caseReference, result, back, 'PROJECT_UPDATED', actorEmail, 'pd-project-card');
  }

  async handleAdditionalInformation(
    identity: EmployeeIdentity, caseReference: string | undefined, cookieHeader: string | undefined,
    body: string | undefined, isBase64Encoded: boolean,
  ): Promise<ApiGatewayV2Response> {
    if (!caseReference) {
      return Response.error(400);
    }
    const begun = await beginProjectDetailsAction(this.authorizationService, identity, cookieHeader, body, isBase64Encoded);
    if (isProjectDetailsActionRejected(begun)) {
      return begun;
    }
    const { form, back } = begun;
    const additionalInformation = form.get('additionalInformation') ?? '';
    if (!withinLength(additionalInformation, MAX_FREE_TEXT_LENGTH)) {
      return Response.error(400);
    }

    const actorEmail = identity.email ?? identity.principalId;
    const result = await this.store.updateAdditionalInformation(caseReference, additionalInformation, actorEmail);
    return this.redirectAfter(caseReference, result, back, 'ADDITIONAL_INFO_UPDATED', actorEmail, 'pd-additional-information-card');
  }

  async handleProjectWide(
    identity: EmployeeIdentity, caseReference: string | undefined, cookieHeader: string | undefined,
    body: string | undefined, isBase64Encoded: boolean,
  ): Promise<ApiGatewayV2Response> {
    if (!caseReference) {
      return Response.error(400);
    }
    const begun = await beginProjectDetailsAction(this.authorizationService, identity, cookieHeader, body, isBase64Encoded);
    if (isProjectDetailsActionRejected(begun)) {
      return begun;
    }
    const { form, back } = begun;
    const projectWideNotes = form.get('projectWideNotes') ?? '';
    if (!withinLength(projectWideNotes, MAX_FREE_TEXT_LENGTH)) {
      return Response.error(400);
    }

    const actorEmail = identity.email ?? identity.principalId;
    const result = await this.store.updateProjectWideNotes(caseReference, projectWideNotes, actorEmail);
    return this.redirectAfter(caseReference, result, back, 'PROJECT_WIDE_NOTES_UPDATED', actorEmail, 'pd-project-wide-card');
  }

  /**
   * Voor een dossier waarvan de bron blijvend kapot blijft: een bevoegde medewerker start hiermee zelf een
   * lege werkversie, los van een nieuwe CSV-poging (`ProjectDetailsTriggerHandler.handleCaseStart`). Alleen
   * zinvol vanuit NEW/FAILED; op een dossier dat inmiddels READY of PENDING is doet dit niets.
   */
  async handleManualStart(
    identity: EmployeeIdentity, caseReference: string | undefined, cookieHeader: string | undefined,
    body: string | undefined, isBase64Encoded: boolean,
  ): Promise<ApiGatewayV2Response> {
    if (!caseReference) {
      return Response.error(400);
    }
    const begun = await beginProjectDetailsAction(this.authorizationService, identity, cookieHeader, body, isBase64Encoded);
    if (isProjectDetailsActionRejected(begun)) {
      return begun;
    }
    const { back } = begun;

    const [workVersion, attempt] = await Promise.all([this.store.getWorkVersion(caseReference), this.store.getAttempt(caseReference)]);
    const status = deriveProjectDetailsStatus(workVersion, attempt);
    if (status !== 'NEW' && status !== 'FAILED') {
      return redirectToWoonbehoefteCase(caseReference, { back, fragment: 'pd-project-card' });
    }

    const actorEmail = identity.email ?? identity.principalId;
    const result = await this.store.startEmptyWorkVersion(caseReference, actorEmail);
    if (result === 'CREATED') {
      await auditProjectDetailsChange(this.auditTrail, actorEmail, caseReference, 'MANUALLY_STARTED');
    }
    return redirectToWoonbehoefteCase(caseReference, { back, fragment: 'pd-project-card', ...(result === 'CREATED' ? { saved: 'project-details' } : {}) });
  }

  async handleLineCreate(
    identity: EmployeeIdentity, caseReference: string | undefined, categoryParam: string | undefined, cookieHeader: string | undefined,
    body: string | undefined, isBase64Encoded: boolean,
  ): Promise<ApiGatewayV2Response> {
    if (!caseReference) {
      return Response.error(400);
    }
    const category = parseProjectDetailsCategoryParam(categoryParam);
    if (!category) {
      return Response.error(400);
    }
    const begun = await beginProjectDetailsAction(this.authorizationService, identity, cookieHeader, body, isBase64Encoded);
    if (isProjectDetailsActionRejected(begun)) {
      return begun;
    }
    const { form, back } = begun;

    const workVersion = await this.store.getWorkVersion(caseReference);
    if (!workVersion) {
      return Response.error(404);
    }
    const existingLines = this.linesForCategory(workVersion, category);
    const nextOrder = Object.values(existingLines).reduce((max, line) => Math.max(max, line.order + 1), 0);

    const line = this.buildLineFromForm(category, form, randomUUID(), nextOrder);
    if (!line) {
      return Response.error(400);
    }

    const actorEmail = identity.email ?? identity.principalId;
    const result = await this.store.upsertLine(caseReference, category, line, true, actorEmail);
    return this.redirectAfter(caseReference, result, back, 'LINE_CREATED', actorEmail, lineCardFragment(category, line.lineId), category, line.lineId);
  }

  async handleLineUpdate(
    identity: EmployeeIdentity, caseReference: string | undefined, categoryParam: string | undefined, lineId: string | undefined,
    cookieHeader: string | undefined, body: string | undefined, isBase64Encoded: boolean,
  ): Promise<ApiGatewayV2Response> {
    if (!caseReference || !lineId) {
      return Response.error(400);
    }
    const category = parseProjectDetailsCategoryParam(categoryParam);
    if (!category) {
      return Response.error(400);
    }
    const begun = await beginProjectDetailsAction(this.authorizationService, identity, cookieHeader, body, isBase64Encoded);
    if (isProjectDetailsActionRejected(begun)) {
      return begun;
    }
    const { form, back } = begun;

    const workVersion = await this.store.getWorkVersion(caseReference);
    const existingLines: Record<string, HousingLine | FacilityLine | KovaLine> = workVersion ? this.linesForCategory(workVersion, category) : {};
    const existing = existingLines[lineId];
    const order = existing?.order ?? 0;

    const homesAccordingToForm = category === 'WONEN' ? (existing as HousingLine | undefined)?.homesAccordingToForm : undefined;
    const line = this.buildLineFromForm(category, form, lineId, order, homesAccordingToForm);
    if (!line) {
      return Response.error(400);
    }

    const actorEmail = identity.email ?? identity.principalId;
    const result = await this.store.upsertLine(caseReference, category, line, false, actorEmail);
    return this.redirectAfter(caseReference, result, back, 'LINE_UPDATED', actorEmail, lineCardFragment(category, lineId), category, lineId);
  }

  async handleLineDelete(
    identity: EmployeeIdentity, caseReference: string | undefined, categoryParam: string | undefined, lineId: string | undefined,
    cookieHeader: string | undefined, body: string | undefined, isBase64Encoded: boolean,
  ): Promise<ApiGatewayV2Response> {
    if (!caseReference || !lineId) {
      return Response.error(400);
    }
    const category = parseProjectDetailsCategoryParam(categoryParam);
    if (!category) {
      return Response.error(400);
    }
    const begun = await beginProjectDetailsAction(this.authorizationService, identity, cookieHeader, body, isBase64Encoded);
    if (isProjectDetailsActionRejected(begun)) {
      return begun;
    }
    const { back } = begun;

    const actorEmail = identity.email ?? identity.principalId;
    const result = await this.store.deleteLine(caseReference, category, lineId, actorEmail);
    return this.redirectAfter(caseReference, result, back, 'LINE_DELETED', actorEmail, CATEGORY_HEADING_IDS[category], category, lineId);
  }

  private linesForCategory(
    workVersion: ProjectDetailsWorkVersion, category: ProjectDetailsLineCategory,
  ): Record<string, HousingLine | FacilityLine | KovaLine> {
    if (category === 'WONEN') {
      return workVersion.housingLines;
    }
    return category === 'VOORZIENING' ? workVersion.collectiveFacilityLines : workVersion.kovaLines;
  }

  private buildLineFromForm(
    category: ProjectDetailsLineCategory, form: URLSearchParams, lineId: string, order: number, homesAccordingToForm?: number,
  ): HousingLine | FacilityLine | KovaLine | undefined {
    const connectionCount = parseConnectionCount(form.get('connectionCount'));
    const connectionType = form.get('connectionType') ?? '';
    const otherDetails = form.get('otherDetails') ?? '';
    if (connectionCount === undefined || !withinLength(connectionType, MAX_SHORT_FIELD_LENGTH) || !withinLength(otherDetails, MAX_FREE_TEXT_LENGTH)) {
      return undefined;
    }

    if (category === 'WONEN') {
      const type = form.get('type');
      if (!isHousingLineType(type)) {
        return undefined;
      }
      return {
        lineId, order, type, connectionCount, connectionType, otherDetails, ...(homesAccordingToForm !== undefined ? { homesAccordingToForm } : {}),
      };
    }
    if (category === 'VOORZIENING') {
      const facilityType = form.get('facilityType')?.trim();
      if (!facilityType || !withinLength(facilityType, MAX_SHORT_FIELD_LENGTH)) {
        return undefined;
      }
      return { lineId, order, facilityType, connectionCount, connectionType, otherDetails };
    }
    const kovaFunction = form.get('function')?.trim();
    if (!kovaFunction || !withinLength(kovaFunction, MAX_SHORT_FIELD_LENGTH)) {
      return undefined;
    }
    return { lineId, order, function: kovaFunction, connectionCount, connectionType, otherDetails };
  }

  private async redirectAfter(
    caseReference: string, result: LineMutationResult, back: string, action: string, actorEmail: string, fragment: string,
    category?: ProjectDetailsLineCategory, lineId?: string,
  ): Promise<ApiGatewayV2Response> {
    if (result === 'OK') {
      await auditProjectDetailsChange(this.auditTrail, actorEmail, caseReference, action, category, lineId);
    }
    return redirectToWoonbehoefteCase(caseReference, { back, fragment, ...(result === 'OK' ? { saved: 'project-details' } : {}) });
  }
}
