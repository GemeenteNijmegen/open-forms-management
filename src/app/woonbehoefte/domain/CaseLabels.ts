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

export const CHECK_OUTCOME_LABELS: Record<string, string> = {
  OK: 'Akkoord',
  CHANGES_NEEDED: 'Aanpassing gewenst',
};
