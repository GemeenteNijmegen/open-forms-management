import { buildWoonbehoefteTabs } from '../WoonbehoefteTabs';

describe('buildWoonbehoefteTabs', () => {
  it('shows Aanvragen and Extra bewijzen but not Excel-overzichten for a viewer without exceloverzicht', () => {
    const tabs = buildWoonbehoefteTabs('aanvragen', true, false);
    expect(tabs.map((tab) => tab.label)).toEqual(['Aanvragen', 'Extra bewijzen']);
    expect(tabs.find((tab) => tab.label === 'Aanvragen')?.active).toBe(true);
  });

  it('shows only Excel-overzichten for a medewerker with just woonbehoefte:exceloverzicht', () => {
    const tabs = buildWoonbehoefteTabs('exceloverzichten', false, true);
    expect(tabs).toEqual([{ label: 'Excel-overzichten', href: '/woonbehoefte/overzichten', active: true }]);
  });

  it('shows all three tabs for a medewerker with both rights', () => {
    const tabs = buildWoonbehoefteTabs('additional-evidence', true, true);
    expect(tabs.map((tab) => tab.label)).toEqual(['Aanvragen', 'Extra bewijzen', 'Excel-overzichten']);
    expect(tabs.filter((tab) => tab.active)).toEqual([{ label: 'Extra bewijzen', href: '/woonbehoefte/additional-evidence', active: true }]);
  });

  it('shows nothing for a medewerker without any of the two rights', () => {
    expect(buildWoonbehoefteTabs('aanvragen', false, false)).toEqual([]);
  });
});
