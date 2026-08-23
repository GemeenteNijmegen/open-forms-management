import { parseActivities, parseSportCsvRow, parseSubmittedAt } from './parseSportSubmission';
import { SportAanmeldType } from './SportSubmission';

/**
 * Every explicitly known and validated business field from one Sport CSV row, independent of what the
 * Sportpagina or the reporter currently show. This is what the cache stores, so a later feature can show
 * more fields without a second CSV interpretation or a cache-model change.
 */
export interface SportSubmissionDetails {
  formName: string;
  submittedAt: Date;
  district: string;
  aanmeldType: SportAanmeldType;

  childFirstName: string;
  childLastName: string;
  childBirthDate: string;
  educationType: string;
  primarySchool: string;
  schoolGroup: string;
  secondarySchool: string;

  contactFirstName: string;
  contactLastName: string;
  contactBirthDate: string;
  phone: string;
  email: string;

  secondContactFirstName: string;
  secondContactLastName: string;
  secondContactPhone: string;
  secondContactEmail: string;

  emergencyContactName: string;
  emergencyContactPhone: string;

  childInSportsClub: string;
  otherActivity: string;
  outreachWorkerName: string;
  outreachWorkerOrganization: string;
  consentContact: string;
  consentDataUse: string;
  consentPhotos: string;
  remark: string;

  activities: string[];
}

/** Builds the cache's rich row on top of the same validated CSV parse `parseSportSubmission` and the reporter use. */
export function buildSportSubmissionDetails(csvText: string): SportSubmissionDetails {
  const row = parseSportCsvRow(csvText);

  return {
    formName: row.Formuliernaam,
    submittedAt: parseSubmittedAt(row.Inzendingdatum),
    district: row.stadsdeel,
    aanmeldType: row.aanmeldType,

    childFirstName: row.voornaamKind,
    childLastName: row.achternaamKind,
    childBirthDate: row.geboortedatumKind,
    educationType: row.soortOnderwijsDatUwKindVolgt,
    primarySchool: row.basisschool,
    schoolGroup: row.groep,
    secondarySchool: row.voorgezetOnderwijs,

    contactFirstName: row.voornaam,
    contactLastName: row.achternaam,
    contactBirthDate: row.geboortedatum,
    phone: row.telefoonnummer,
    email: row.eMailadres,

    secondContactFirstName: row.voornaamTweedeContact,
    secondContactLastName: row.achternaamTweedeContact,
    secondContactPhone: row.telefoonnummerTweedeContact,
    secondContactEmail: row.eMailadresTweedeContact,

    emergencyContactName: row.naamNoodgevallen,
    emergencyContactPhone: row.telefoonnummerNoodgevallen,

    childInSportsClub: row.sportUwKindBijEenSportvereniging,
    otherActivity: row.sportactiviteitAnders,
    outreachWorkerName: row.naamAmbulantBegeleider,
    outreachWorkerOrganization: row.organisatieAmbulantBegeleider,
    consentContact: row.toestemmingContactOpnemen,
    consentDataUse: row.toestemmingGegevens,
    consentPhotos: row.toestemmingFotos,
    remark: row.opmerking,

    activities: parseActivities(row.aanmeldenSportactiviteit, row.sportactiviteitenData),
  };
}
