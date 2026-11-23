import { ApiGatewayV2Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { ESF_VIEW_CHECK, renderEsfPage } from './EsfPageHandler';
import { validateEsfSearch } from './EsfSearchValidation';
import { logger } from '../../../observability/Logger';
import { xRayTraceId } from '../../../observability/xRayTraceId';
import { AuditTrail } from '../../../shared/audit/AuditTrail';
import { recordAudit } from '../../../shared/audit/recordAudit';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { HttpClientError } from '../../../shared/clients/http/HttpClientError';
import { parseFormBody } from '../../../shared/lambda/parseFormBody';
import { CSRF_FORM_FIELD, isValidCsrfSubmission } from '../../../shared/security/csrf/CsrfProtection';
import { EsfSearchRequest, EsfSearchResult, EsfSearchService } from '../data/EsfSearchService';

export class EsfSearchHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly auditTrail: AuditTrail,
    private readonly createSearchService: () => Promise<EsfSearchService>,
  ) { }

  async handleRequest(
    identity: EmployeeIdentity, cookieHeader: string | undefined, body: string | undefined, isBase64Encoded: boolean,
  ): Promise<ApiGatewayV2Response> {
    const context = await this.authorizationService.loadContext(identity);
    const denied = await this.authorizationService.requireAuthorization(context, ESF_VIEW_CHECK);
    if (denied) {
      return denied;
    }

    const form = parseFormBody(body, isBase64Encoded);
    if (!isValidCsrfSubmission(cookieHeader, form.get(CSRF_FORM_FIELD) ?? undefined)) {
      logger.info('ESF search rejected: invalid CSRF token');
      return this.authorizationService.denyAccess(context, ESF_VIEW_CHECK);
    }

    const validation = validateEsfSearch(form);
    if (!validation.valid) {
      logger.info('ESF search rejected: invalid input', { errorCount: validation.errors.length });
      return renderEsfPage(identity, context.evaluator, { values: validation.values, errors: validation.errors }, 400);
    }

    const { request, values } = validation;
    const correlationId = xRayTraceId();
    const startedAt = Date.now();
    const auditBase = {
      correlationId,
      resource: 'esf',
      action: 'view',
      ...(identity.email ? { actorEmail: identity.email } : {}),
    };

    try {
      await this.auditTrail.record({ ...auditBase, eventType: 'ESF_SEARCH_STARTED', outcome: 'SUCCESS', metadata: safeMetadata(request) });
    } catch {
      logger.error('ESF search stopped: audit start could not be written', { searchType: request.searchType });
      return renderEsfPage(identity, context.evaluator, { values, failure: 'audit' }, 503);
    }

    let result: EsfSearchResult;
    try {
      result = await (await this.createSearchService()).search(request);
    } catch (error) {
      const errorCode = toErrorCode(error);
      logger.error('ESF search failed', { ...safeMetadata(request), errorCode, durationMs: Date.now() - startedAt });
      await recordAudit(this.auditTrail, {
        ...auditBase, eventType: 'ESF_SEARCH_FINISHED', outcome: 'FAILURE', metadata: { ...safeMetadata(request), errorCode },
      });
      return renderEsfPage(identity, context.evaluator, { values, failure: 'objects' }, 503);
    }

    const counts = countResult(result);
    logger.info('ESF search finished', { ...safeMetadata(request), outcome: result.outcome, ...counts, durationMs: Date.now() - startedAt });
    await recordAudit(this.auditTrail, {
      ...auditBase, eventType: 'ESF_SEARCH_FINISHED', outcome: 'SUCCESS', metadata: { ...safeMetadata(request), result: result.outcome, ...counts },
    });
    return renderEsfPage(identity, context.evaluator, { values, result }, 200);
  }
}

// Never the search value: clientnummer and dossiernummer can be traced back to a person.
function safeMetadata(request: EsfSearchRequest): Record<string, string> {
  return { searchType: request.searchType, periodenummer: request.periodenummer };
}

function countResult(result: EsfSearchResult): { objectCount: number; recordCount: number } {
  const tasks = result.outcome === 'FOUND' ? result.tasks : [];
  return {
    objectCount: tasks.length,
    recordCount: tasks.reduce((sum, task) => sum + task.records.length, 0),
  };
}

// Only the category: an HttpClientError message or cause can contain the request URL with the filter values.
function toErrorCode(error: unknown): string {
  return error instanceof HttpClientError ? `objects_${error.category.replace(/-/g, '_')}` : 'esf_configuration';
}
