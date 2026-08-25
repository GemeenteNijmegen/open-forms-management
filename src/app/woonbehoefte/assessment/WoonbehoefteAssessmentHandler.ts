import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { xRayTraceId } from '../../../observability/xRayTraceId';
import { AuditTrail } from '../../../shared/audit/AuditTrail';
import { recordAudit } from '../../../shared/audit/recordAudit';
import { EmployeeIdentity } from '../../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../../shared/authorization/AuthorizationService';
import { beginWoonbehoefteAction, isActionRejected, redirectAfterMutation } from '../actions/WoonbehoefteActionSupport';
import { WoonbehoefteCaseRepository } from '../cases/WoonbehoefteCaseRepository';
import { CaseActivityChange, CaseAssessment, TernaryAssessment } from '../domain/WoonbehoefteCase';

const TERNARY_FIELDS = [
  'applicationComplete', 'boardDeclarationApproved', 'chamberOfCommerceApproved',
  'planningAgreementEvidenceApproved', 'planningPublicDecisionEvidenceApproved', 'projectReadinessEvidenceApproved',
] as const;

const EXPLANATION_FIELDS = ['assessedStartExplanation', 'assessedCompletionExplanation'] as const;

const TERNARY_VALUES: readonly string[] = ['YES', 'NO', 'NOT_APPLICABLE', 'UNKNOWN'];

function isTernaryAssessment(value: string | null): value is TernaryAssessment {
  return value !== null && TERNARY_VALUES.includes(value);
}

type FieldOutcome = { kind: 'unchanged' } | { kind: 'clear' } | { kind: 'set'; value: CaseAssessment[keyof CaseAssessment] };

/** Omits `from`/`to` entirely when absent, never sets them to `undefined` - the DocumentClient rejects an explicit `undefined` value. */
function buildChange(field: string, from: CaseActivityChange['from'], to?: CaseActivityChange['to']): CaseActivityChange {
  return {
    field,
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
  };
}

/** An empty select value ("Nog niet beoordeeld") is an explicit clear, never left as "no change". */
function ternaryOutcome(submitted: string | null): FieldOutcome {
  if (submitted === null) {
    return { kind: 'unchanged' };
  }
  if (submitted === '') {
    return { kind: 'clear' };
  }
  return isTernaryAssessment(submitted) ? { kind: 'set', value: submitted } : { kind: 'unchanged' };
}

/** A blank textarea clears a previously stored toelichting; anything else sets the trimmed text. */
function explanationOutcome(submitted: string | null): FieldOutcome {
  if (submitted === null) {
    return { kind: 'unchanged' };
  }
  const trimmed = submitted.trim();
  return trimmed ? { kind: 'set', value: trimmed } : { kind: 'clear' };
}

/**
 * Both fields entirely absent means this submission's form doesn't cover this period at all (the
 * beoordeling and planning blocks are separate `<form>`s posting to the same route) - never treated as
 * "clear". Both present but empty clears the vastgestelde period. Both filled and valid sets it. Any
 * other (partial/invalid) combination is left unchanged: never guess a period from half a submission.
 */
function periodOutcome(form: URLSearchParams, monthField: string, yearField: string): FieldOutcome {
  const monthRaw = form.get(monthField);
  const yearRaw = form.get(yearField);
  if (monthRaw === null && yearRaw === null) {
    return { kind: 'unchanged' };
  }
  if (!monthRaw && !yearRaw) {
    return { kind: 'clear' };
  }
  const month = Number(monthRaw);
  const year = Number(yearRaw);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2100) {
    return { kind: 'unchanged' };
  }
  return { kind: 'set', value: (year * 100) + month };
}

function readinessOutcome(form: URLSearchParams): FieldOutcome {
  const raw = form.get('assessedProjectReadiness');
  if (raw === null) {
    return { kind: 'unchanged' };
  }
  if (raw === '') {
    return { kind: 'clear' };
  }
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 6 ? { kind: 'set', value: value as 1 | 2 | 3 | 4 | 5 | 6 } : { kind: 'unchanged' };
}

/** Handles `POST /woonbehoefte/cases/{caseReference}/assessment`. Bronwaarden zijn nooit onderdeel van deze form; alleen de vastgestelde waarden. */
export class WoonbehoefteAssessmentHandler {
  constructor(
    private readonly authorizationService: AuthorizationService,
    private readonly caseRepository: WoonbehoefteCaseRepository,
    private readonly auditTrail: AuditTrail,
  ) { }

  async handleRequest(
    identity: EmployeeIdentity, caseReference: string | undefined, cookieHeader: string | undefined,
    body: string | undefined, isBase64Encoded: boolean,
  ): Promise<ApiGatewayV2Response> {
    if (!caseReference) {
      return Response.error(400);
    }
    const begun = await beginWoonbehoefteAction(this.authorizationService, identity, cookieHeader, body, isBase64Encoded);
    if (isActionRejected(begun)) {
      return begun;
    }
    const { form, expectedVersion, back } = begun;

    const existingCase = await this.caseRepository.getCase(caseReference);
    if (!existingCase) {
      return Response.error(404);
    }

    const set: Partial<CaseAssessment> = {};
    const remove: (keyof CaseAssessment)[] = [];
    const changes: CaseActivityChange[] = [];

    const apply = (field: keyof CaseAssessment, outcome: FieldOutcome) => {
      const existing = existingCase.assessment[field];
      if (outcome.kind === 'set' && outcome.value !== existing) {
        (set as Record<string, unknown>)[field] = outcome.value;
        changes.push(buildChange(`assessment.${field}`, existing as CaseActivityChange['from'], outcome.value as CaseActivityChange['to']));
      } else if (outcome.kind === 'clear' && existing !== undefined) {
        remove.push(field);
        changes.push(buildChange(`assessment.${field}`, existing as CaseActivityChange['from']));
      }
    };

    for (const field of TERNARY_FIELDS) {
      apply(field, ternaryOutcome(form.get(field)));
    }
    for (const field of EXPLANATION_FIELDS) {
      apply(field, explanationOutcome(form.get(field)));
    }
    apply('assessedStartPeriod', periodOutcome(form, 'assessedStartMonth', 'assessedStartYear'));
    apply('assessedCompletionPeriod', periodOutcome(form, 'assessedCompletionMonth', 'assessedCompletionYear'));
    apply('assessedProjectReadiness', readinessOutcome(form));

    if (changes.length === 0) {
      return redirectAfterMutation(caseReference, 'OK', back, 'assessment');
    }

    const actorEmail = identity.email ?? identity.principalId;
    const result = await this.caseRepository.updateAssessment(caseReference, actorEmail, expectedVersion, { set, remove }, changes);
    if (result === 'OK') {
      await recordAudit(this.auditTrail, {
        eventType: 'WOONBEHOEFTE_ASSESSMENT_UPDATED',
        outcome: 'SUCCESS',
        correlationId: xRayTraceId(),
        resource: 'woonbehoefte',
        action: 'assessment_update',
        actorEmail,
        metadata: { caseReference, changedFieldCount: changes.length },
      });
    }

    return redirectAfterMutation(caseReference, result, back, 'assessment');
  }
}
