import { EsfFormValues } from './EsfSearchValidation';
import { CSRF_FORM_FIELD } from '../../../shared/security/csrf/CsrfProtection';
import { EsfSearchResult, EsfTask } from '../data/EsfSearchService';

export type EsfFailure = 'objects' | 'audit';

export interface EsfViewInput {
  csrfToken: string;
  values?: EsfFormValues;
  errors?: string[];
  result?: EsfSearchResult;
  failure?: EsfFailure;
}

export function buildEsfViewModel(input: EsfViewInput): Record<string, unknown> {
  const values = input.values ?? { periodenummer: '', zoeksoort: 'clientnummer', zoekwaarde: '' };
  const periode = values.periodenummer;
  return {
    csrfField: CSRF_FORM_FIELD,
    csrfToken: input.csrfToken,
    periodenummer: values.periodenummer,
    zoekwaarde: values.zoekwaarde,
    zoeksoortOptions: [
      { value: 'clientnummer', label: 'Clientnummer', selected: values.zoeksoort === 'clientnummer' },
      { value: 'dossiernummer', label: 'Dossiernummer', selected: values.zoeksoort === 'dossiernummer' },
    ],
    errors: input.errors ?? [],
    hasErrors: (input.errors ?? []).length > 0,
    failureMessage: input.failure ? FAILURE_MESSAGES[input.failure] : undefined,
    notFoundMessage: input.result?.outcome === 'NOT_FOUND' ? `Geen ESF-taken gevonden voor periode ${periode} en deze zoekopdracht.` : undefined,
    results: input.result?.outcome === 'FOUND' ? {
      heading: `Periode ${periode}: ${input.result.tasks.length} ${input.result.tasks.length === 1 ? 'ESF-taak' : 'ESF-taken'} gevonden`,
      tasks: input.result.tasks.map((task, i) => taskViewModel(task, i + 1)),
    } : undefined,
  };
}

function taskViewModel(task: EsfTask, number: number): Record<string, unknown> {
  return {
    heading: `ESF-taak ${number} · Periode ${task.periodenummer}`,
    objectUuid: task.objectUuid,
    clientnummer: task.clientnummer,
    dossiernummer: task.dossiernummer,
    records: task.records,
  };
}

const FAILURE_MESSAGES: Record<EsfFailure, string> = {
  objects: 'Er lijkt een probleem met de Objects API te zijn. De ESF-taken konden niet worden opgehaald.',
  audit: 'Zoeken is nu niet mogelijk omdat de zoekactie niet kon worden vastgelegd.',
};
