import { CachedSportSubmission, SPORT_CACHE_VERSION } from '../../cache/SportCacheItem';
import { buildSportSubmissionsFromCache } from '../buildSportSubmissionsFromCache';

// A separate constant, not inlined into cached()'s return: mixing literal keys with a same-shaped
// `...dataOverrides` spread in one object literal makes TS flag every default field as "always overwritten".
const DEFAULT_DATA: CachedSportSubmission['data'] = {
  formName: 'Aanmelden sportactiviteit',
  submittedAt: new Date('2026-08-20T10:00:00Z'),
  district: 'dukenburg',
  aanmeldType: 'volwassene',
  childFirstName: '',
  childLastName: '',
  childBirthDate: '',
  educationType: '',
  primarySchool: '',
  schoolGroup: '',
  secondarySchool: '',
  contactFirstName: '',
  contactLastName: '',
  contactBirthDate: '',
  phone: '',
  email: '',
  secondContactFirstName: '',
  secondContactLastName: '',
  secondContactPhone: '',
  secondContactEmail: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  childInSportsClub: '',
  otherActivity: '',
  outreachWorkerName: '',
  outreachWorkerOrganization: '',
  consentContact: '',
  consentDataUse: '',
  consentPhotos: '',
  remark: '',
  activities: [],
};

function cached(overrides: Partial<CachedSportSubmission> & { objectUuid: string; data: Partial<CachedSportSubmission['data']> }): CachedSportSubmission {
  const { data: dataOverrides, ...rest } = overrides;
  const defaults: Omit<CachedSportSubmission, 'data'> = {
    status: 'READY',
    objectUuid: overrides.objectUuid,
    reference: `OF-${overrides.objectUuid}`,
    hasPdf: false,
    registrationAt: '2026-08-01',
    cachedAt: '2026-08-20T00:00:00.000Z',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    cacheVersion: SPORT_CACHE_VERSION,
  };
  return { ...defaults, ...rest, data: { ...DEFAULT_DATA, ...dataOverrides } };
}

describe('buildSportSubmissionsFromCache', () => {
  it('reconstructs a kind submission with the child as participant, a formatted school and a remark', () => {
    const submissions = buildSportSubmissionsFromCache([
      cached({
        objectUuid: 'child-1',
        hasPdf: true,
        data: {
          aanmeldType: 'kind',
          childFirstName: 'Test',
          childLastName: 'Kind',
          childBirthDate: '2015-06-01',
          primarySchool: 'De Basisschool',
          contactFirstName: 'Ouder',
          contactLastName: 'Voorbeeld',
          phone: '0612345678',
          email: 'ouder@example.invalid',
          activities: ['Zwemmen', 'Voetbal'],
          remark: 'Allergie',
        },
      }),
    ], ['dukenburg'], ['kind', 'volwassene']);

    expect(submissions).toHaveLength(1);
    const submission = submissions[0];
    expect(submission.aanmeldType).toBe('kind');
    expect(submission.child).toEqual({ name: 'Test Kind', birthDate: '2015-06-01', school: 'De Basisschool' });
    expect(submission.contactName).toBe('Ouder Voorbeeld');
    expect(submission.activities).toEqual(['Zwemmen', 'Voetbal']);
    expect(submission.remark).toBe('Allergie');
    expect(submission.hasPdf).toBe(true);
    expect(submission.objectUuid).toBe('child-1');
  });

  it('reconstructs a volwassene submission without a child object at all', () => {
    const submissions = buildSportSubmissionsFromCache([
      cached({
        objectUuid: 'adult-1',
        data: {
          aanmeldType: 'volwassene',
          contactFirstName: 'Test',
          contactLastName: 'Volwassene',
          phone: '0687654321',
          email: 'volwassene@example.invalid',
          activities: ['Yoga'],
        },
      }),
    ], ['dukenburg'], ['kind', 'volwassene']);

    expect(submissions[0].aanmeldType).toBe('volwassene');
    expect(submissions[0].child).toBeUndefined();
    expect(submissions[0].contactName).toBe('Test Volwassene');
  });

  it('falls back to the secondary school for a kind submission when there is no primary school', () => {
    const submissions = buildSportSubmissionsFromCache([
      cached({
        objectUuid: 'child-2',
        data: {
          aanmeldType: 'kind',
          childFirstName: 'Test',
          childLastName: 'Kind',
          primarySchool: '',
          secondarySchool: 'Voortgezet Voorbeeld',
        },
      }),
    ], ['dukenburg'], ['kind', 'volwassene']);

    expect(submissions[0].child?.school).toBe('Voortgezet Voorbeeld');
  });

  it('filters out districts and types the current view is not allowed/asking for', () => {
    const submissions = buildSportSubmissionsFromCache([
      cached({ objectUuid: 'wrong-district', data: { district: 'nijmegenNoord' } }),
      cached({ objectUuid: 'wrong-type', data: { aanmeldType: 'kind' } }),
      cached({ objectUuid: 'match', data: {} }),
    ], ['dukenburg'], ['volwassene']);

    expect(submissions.map((s) => s.objectUuid)).toEqual(['match']);
  });
});
