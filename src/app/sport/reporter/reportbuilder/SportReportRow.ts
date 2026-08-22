import { SportAanmeldType } from '../../sportdata/SportSubmission';

/**
 * One Sport submission mapped to every business field the Excel export needs (`references/sport-excel-data-contract.md`),
 * not just the compact set the `/sport` page shows. `district` is the raw CSV key (e.g. `dukenburg`), like
 * `SportSubmission.district`; the writer maps it to its readable label.
 */
export interface SportReportRow {
  reference: string;
  formName: string;
  submittedAt: Date;
  aanmeldType: SportAanmeldType;
  district: string;

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

  /** Readable, deterministically ordered labels of the selected activities, e.g. from `parseActivities`. */
  activities: string[];
}
