import { EsfTask } from '../../app/esf/data/EsfSearchService';
import { buildEsfViewModel, EsfViewInput } from '../../app/esf/ui/EsfViewModel';
import { Feature } from '../../shared/navigation/Feature';

const esfFeature: Feature = { id: 'esf', label: 'ESF-controle', route: '/esf', resource: 'esf', action: 'view' };
const page = { title: 'ESF-controle', features: [esfFeature], currentPath: '/esf', actorEmail: 'medewerker@nijmegen.nl' };
const values = { periodenummer: '202610', zoeksoort: 'clientnummer', zoekwaarde: '100000001' };

function fixture(input: Omit<EsfViewInput, 'csrfToken'>) {
  return { page, data: buildEsfViewModel({ ...input, csrfToken: 'preview-csrf-token' }) };
}

function task(dossiernummer: string, statuses: string[]): EsfTask {
  return {
    objectUuid: '00000000-0000-4000-8000-000000000042',
    periodenummer: '202610',
    clientnummer: '100000001',
    dossiernummer,
    records: statuses.map((status, i) => ({ index: i + 1, status, registrationAt: `2026-10-${String(2 + i * 3).padStart(2, '0')}` })),
  };
}

export const esfSearchForm = fixture({});
export const esfOneTask = fixture({ values, result: { outcome: 'FOUND', tasks: [task('90000001', ['open', 'open', 'afgerond', 'verwerkt'])] } });
export const esfNotFound = fixture({ values, result: { outcome: 'NOT_FOUND' } });
export const esfInvalidInput = fixture({
  values: { periodenummer: '202613', zoeksoort: 'clientnummer', zoekwaarde: '' },
  errors: ['Vul de periode in als JJJJMM, bijvoorbeeld 202610.', 'Vul een nummer in van maximaal 30 tekens, zonder dubbele underscore.'],
});
export const esfUnavailable = fixture({ values, failure: 'objects' });
