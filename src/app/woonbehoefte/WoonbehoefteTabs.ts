export interface WoonbehoefteTab {
  label: string;
  href: string;
  active: boolean;
}

export type WoonbehoefteTabId = 'aanvragen' | 'additional-evidence' | 'exceloverzichten';

const TAB_DEFINITIONS: { id: WoonbehoefteTabId; label: string; href: string }[] = [
  { id: 'aanvragen', label: 'Aanvragen', href: '/woonbehoefte' },
  { id: 'additional-evidence', label: 'Extra bewijzen', href: '/woonbehoefte/additional-evidence' },
  { id: 'exceloverzichten', label: 'Excel-overzichten', href: '/woonbehoefte/overzichten' },
];

/**
 * Aanvragen en Extra bewijzen zijn zichtbaar bij woonbehoefte:view, Excel-overzichten bij
 * woonbehoefte:exceloverzicht. Elke overview-handler bouwt deze array na zijn eigen
 * requireAuthorization-check en geeft 'm door als tabs, in plaats van een losse boolean per tab.
 */
export function buildWoonbehoefteTabs(activeTab: WoonbehoefteTabId, canView: boolean, canExcelOverview: boolean): WoonbehoefteTab[] {
  return TAB_DEFINITIONS
    .filter((tab) => (tab.id === 'exceloverzichten' ? canExcelOverview : canView))
    .map((tab) => ({ label: tab.label, href: tab.href, active: tab.id === activeTab }));
}
