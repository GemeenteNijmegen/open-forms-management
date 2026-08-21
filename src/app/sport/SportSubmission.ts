export type SportAanmeldType = 'kind' | 'volwassene';

export interface SportSubmissionChild {
  name: string;
  birthDate?: string;
  school?: string;
}

/** `reference` comes from the Object; every other field comes from its CSV document. */
export interface SportSubmission {
  reference: string;
  submittedAt: Date;
  district: string;
  aanmeldType: SportAanmeldType;
  contactName: string;
  phone: string;
  email: string;
  activities: string[];
  remark?: string;
  child?: SportSubmissionChild;
}
