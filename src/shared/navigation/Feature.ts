export interface Feature {
  id: string;
  label: string;
  route: string;
  resource: string;
  action: string;
  icon?: string;
  /**
   * When set, visibleFeatures keeps only the first visible feature sharing this key. Lets one nav slot
   * resolve to a different route depending on which of several actions a medewerker actually has, without
   * every page handler composing that logic itself.
   */
  dedupeKey?: string;
}
