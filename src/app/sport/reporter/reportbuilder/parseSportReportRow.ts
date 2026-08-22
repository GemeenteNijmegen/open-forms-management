import { SportReportRow } from './SportReportRow';
import { parseActivities, parseSportCsvRow, parseSubmittedAt } from '../../parseSportSubmission';

/** Builds the reporter's full row on top of the same validated CSV parse `parseSportSubmission` uses. */
export function parseSportReportRow(csvText: string, reference: string): SportReportRow {
  const row = parseSportCsvRow(csvText);

  return {
    reference,
    formName: row.Formuliernaam,
    submittedAt: parseSubmittedAt(row.Inzendingdatum),
    aanmeldType: row.aanmeldType,
    district: row.stadsdeel,

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
