import { CaseStatus } from './CaseStatus';
import { CaseNoteCategory } from './WoonbehoefteCase';

export const NOTE_CATEGORY_LABELS: Record<CaseNoteCategory, string> = {
  GENERAL: 'Algemeen',
  CONTACT: 'Contact',
  ASSESSMENT: 'Beoordeling',
  ADDITIONAL_INFORMATION: 'Aanvullende informatie',
  ADMISSIBILITY: 'Ontvankelijkheid',
  CHECK: 'Check',
};

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  NEW: 'Nieuw',
  IN_PROGRESS: 'In behandeling',
  WAITING_FOR_ADDITIONAL_INFORMATION: 'Wacht op aanvullende informatie',
  PROPOSED_INADMISSIBLE: 'Voorgesteld niet-ontvankelijk',
  INADMISSIBLE: 'Niet-ontvankelijk',
  READY_FOR_RANKING: 'Gereed voor rangschikking',
};

export const APPLICANT_TYPE_LABELS: Record<string, string> = {
  INDIVIDUAL: 'Individueel',
  MUNICIPALITY_NIJMEGEN: 'Gemeente Nijmegen',
  PROJECT_APPLICANT: 'Projectaanvrager',
  UNKNOWN: 'Onbekend',
};

export const TERNARY_ASSESSMENT_LABELS: Record<string, string> = {
  YES: 'Ja',
  NO: 'Nee',
  NOT_APPLICABLE: 'N.v.t.',
  UNKNOWN: 'Onbekend',
};

export const TERNARY_ASSESSMENT_UNASSESSED_LABEL = 'Nog niet beoordeeld';

export const PROJECT_READINESS_LABELS: Record<number, string> = {
  1: 'Categorie 1 - civielrechtelijke overeenkomst en omgevingsvergunning',
  2: 'Categorie 2 - civielrechtelijke overeenkomst en onherroepelijk omgevingsplan/BOPA',
  3: 'Categorie 3 - onherroepelijke BOPA',
  4: 'Categorie 4 - vastgesteld omgevingsplan of vergunning voor een BOPA',
  5: 'Categorie 5 - civielrechtelijke overeenkomst',
  6: 'Categorie 6 - overige voorbereidende of verkennende bewijsstukken',
};

/** The full condition text per projectrijpheid-categorie, shown only for the category the aanvraag actually claims - never all six at once. */
export const PROJECT_READINESS_CONDITIONS: Record<number, string> = {
  1: 'Civielrechtelijke overeenkomst én omgevingsvergunning voor de feitelijke bouwactiviteit.',
  2: 'Civielrechtelijke overeenkomst én onherroepelijk omgevingsplan en/of onherroepelijke BOPA.',
  3: 'Onherroepelijke BOPA voor de projectlocatie.',
  4: 'Vastgesteld omgevingsplan of vergunning voor een BOPA voor de projectlocatie.',
  5: 'Alleen een civielrechtelijke overeenkomst.',
  6: 'Overige voorbereidende of verkennende stukken, bijvoorbeeld principebesluit, subsidiebeschikking, ontwerp-omgevingsplan/BOPA, '
    + 'optie- of grondreservering, woningbouwprogramma, stedenbouwkundig plan, woondeal, prestatieafspraken of relevante onderzoeken.',
};

export const CHECK_OUTCOME_LABELS: Record<string, string> = {
  OK: 'Akkoord',
  CHANGES_NEEDED: 'Aanpassing gewenst',
};
