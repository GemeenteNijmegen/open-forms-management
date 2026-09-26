import { randomUUID } from 'crypto';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { errorReason } from '../../../../observability/errorReason';
import { logger } from '../../../../observability/Logger';
import { xRayTraceId } from '../../../../observability/xRayTraceId';
import { AuditTrail } from '../../../../shared/audit/AuditTrail';
import { recordAudit } from '../../../../shared/audit/recordAudit';
import { EmployeeIdentity } from '../../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../../shared/authorization/AuthorizationService';
import { parseFormBody } from '../../../../shared/lambda/parseFormBody';
import { CSRF_FORM_FIELD, isValidCsrfSubmission } from '../../../../shared/security/csrf/CsrfProtection';
import { redirectToWoonbehoefteCase } from '../../actions/WoonbehoefteActionSupport';
import { sanitizeWoonbehoefteFilterQuery } from '../../overview/WoonbehoefteOverviewFilter';
import { deriveProjectDetailsStatus } from '../domain/ProjectDetails';
import { ProjectDetailsStore } from '../persistence/ProjectDetailsStore';

// Projectdetails is uitsluitend voor medewerkers die de werkversie ook mogen bewerken; een view-only medewerker start geen voorinvulling.
const PROJECT_DETAILS_MANAGE_CHECK = { resource: 'woonbehoefte', action: 'manage' } as const;

/** Compact: alleen wie een start aanvroeg en voor welk dossier, nooit CSV-inhoud of vrije tekst. */
async function auditStartRequested(auditTrail: AuditTrail, actorEmail: string, caseReference?: string): Promise<void> {
  await recordAudit(auditTrail, {
    eventType: 'WOONBEHOEFTE_PROJECT_DETAILS_START_REQUESTED',
    outcome: 'SUCCESS',
    correlationId: xRayTraceId(),
    resource: 'woonbehoefte',
    action: 'project_details_start_requested',
    actorEmail,
    metadata: caseReference ? { caseReference } : {},
  });
}

/**
 * Handelt zowel de volledige batchstart (werkvoorraad) als de start van één dossier af. Beide roepen
 * dezelfde worker-Lambda asynchroon aan, nooit synchroon binnen de requestcyclus. Dubbele starts zijn
 * onschadelijk: initializeCase is conditioneel en raakt een bestaande werkversie nooit aan.
 */
export class ProjectDetailsTriggerHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly store: ProjectDetailsStore,
    private readonly lambdaClient: LambdaClient,
    private readonly workerFunctionName: string,
    private readonly auditTrail: AuditTrail,
  ) { }

  async handleBatchStart(
    identity: EmployeeIdentity, cookieHeader: string | undefined, body: string | undefined, isBase64Encoded: boolean, triggerCorrelationId: string,
  ): Promise<ApiGatewayV2Response> {
    const context = await this.authorizationService.loadContext(identity);
    const denied = await this.authorizationService.requireAuthorization(context, PROJECT_DETAILS_MANAGE_CHECK);
    if (denied) {
      return denied;
    }

    const form = parseFormBody(body, isBase64Encoded);
    if (!isValidCsrfSubmission(cookieHeader, form.get(CSRF_FORM_FIELD) ?? undefined)) {
      return this.authorizationService.denyAccess(context, PROJECT_DETAILS_MANAGE_CHECK);
    }

    const back = sanitizeWoonbehoefteFilterQuery(form.get('back') ?? undefined);
    const backParam = back ? `&${back}` : '';
    const runId = randomUUID();

    try {
      await this.lambdaClient.send(new InvokeCommand({
        FunctionName: this.workerFunctionName,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ runId, triggerCorrelationId })),
      }));
      logger.info('Projectdetails batch gestart', { runId, triggerCorrelationId });
      await auditStartRequested(this.auditTrail, identity.email ?? identity.principalId);
    } catch (error) {
      logger.error('Projectdetails batch kon niet starten', { runId, reason: errorReason(error) });
      return Response.redirect(`/woonbehoefte?projectDetails=failed${backParam}`, 303);
    }

    return Response.redirect(`/woonbehoefte?projectDetails=started${backParam}`, 303);
  }

  async handleCaseStart(
    identity: EmployeeIdentity, caseReference: string | undefined, cookieHeader: string | undefined,
    body: string | undefined, isBase64Encoded: boolean, triggerCorrelationId: string,
  ): Promise<ApiGatewayV2Response> {
    if (!caseReference) {
      return Response.error(400);
    }
    const context = await this.authorizationService.loadContext(identity);
    const denied = await this.authorizationService.requireAuthorization(context, PROJECT_DETAILS_MANAGE_CHECK);
    if (denied) {
      return denied;
    }

    const form = parseFormBody(body, isBase64Encoded);
    if (!isValidCsrfSubmission(cookieHeader, form.get(CSRF_FORM_FIELD) ?? undefined)) {
      return this.authorizationService.denyAccess(context, PROJECT_DETAILS_MANAGE_CHECK);
    }
    const back = sanitizeWoonbehoefteFilterQuery(form.get('back') ?? undefined);

    // Alleen NEW/FAILED mag hier opnieuw starten; READY/PENDING blijft ongemoeid, zelfs bij een dubbele klik.
    const [workVersion, attempt] = await Promise.all([this.store.getWorkVersion(caseReference), this.store.getAttempt(caseReference)]);
    const status = deriveProjectDetailsStatus(workVersion, attempt);
    if (status === 'NEW' || status === 'FAILED') {
      const runId = randomUUID();
      try {
        await this.lambdaClient.send(new InvokeCommand({
          FunctionName: this.workerFunctionName,
          InvocationType: 'Event',
          Payload: Buffer.from(JSON.stringify({ runId, triggerCorrelationId, caseReference })),
        }));
        logger.info('Projectdetails dossierstart', { caseReference, runId, triggerCorrelationId });
        await auditStartRequested(this.auditTrail, identity.email ?? identity.principalId, caseReference);
      } catch (error) {
        logger.error('Projectdetails dossierstart mislukt', { caseReference, runId, reason: errorReason(error) });
      }
    }

    return redirectToWoonbehoefteCase(caseReference, { back });
  }
}
