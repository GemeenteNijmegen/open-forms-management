import { CachedSportSubmission } from '../cache/SportCacheItem';
import { SportAanmeldType, SportSubmission, SportSubmissionChild } from '../sportdata/SportSubmission';

/** Adapts the cache's rich `SportSubmissionDetails` back into the compact `SportSubmission` shape `SportViewModel` already renders. */
export function toSportSubmission(cached: CachedSportSubmission): SportSubmission {
  const { data } = cached;
  const school = data.primarySchool || data.secondarySchool || undefined;
  const child: SportSubmissionChild | undefined = data.aanmeldType === 'kind' ? {
    name: `${data.childFirstName} ${data.childLastName}`.trim(),
    ...(data.childBirthDate ? { birthDate: data.childBirthDate } : {}),
    ...(school ? { school } : {}),
  } : undefined;

  return {
    reference: cached.reference,
    submittedAt: data.submittedAt,
    district: data.district,
    aanmeldType: data.aanmeldType,
    contactName: `${data.contactFirstName} ${data.contactLastName}`.trim(),
    phone: data.phone,
    email: data.email,
    activities: data.activities,
    ...(data.remark ? { remark: data.remark } : {}),
    ...(child ? { child } : {}),
    objectUuid: cached.objectUuid,
    hasPdf: cached.hasPdf,
  };
}

/** Narrows cached submissions to the requested/allowed districts and aanmeldTypes, the same way `SportFilter` intersects with permissions. */
export function buildSportSubmissionsFromCache(
  cachedSubmissions: CachedSportSubmission[], allowedDistricts: string[], allowedTypes: SportAanmeldType[],
): SportSubmission[] {
  const allowed = new Set(allowedDistricts);
  const allowedAanmeldTypes = new Set(allowedTypes);
  return cachedSubmissions
    .filter((cached) => allowed.has(cached.data.district) && allowedAanmeldTypes.has(cached.data.aanmeldType))
    .map(toSportSubmission);
}
