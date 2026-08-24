import { PermissionCatalog } from '../../catalog/PermissionCatalog';
import { parsePermissionGrantRequest } from '../PermissionRequestValidation';

const catalog = new PermissionCatalog([
  {
    resource: 'sport',
    label: 'Sport',
    actions: [{ action: 'view', label: 'Bekijken' }],
    scopes: [{ key: 'districts', label: 'Wijken', values: [{ value: 'dukenburg', label: 'Dukenburg' }, { value: 'lindenholt', label: 'Lindenholt' }] }],
  },
]);

function form(entries: [string, string][]): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    params.append(key, value);
  }
  return params;
}

describe('parsePermissionGrantRequest', () => {
  it('parses a valid Sport request into a canonical grant, deduplicating repeated districts', () => {
    const parsed = parsePermissionGrantRequest(form([
      ['targetEmail', ' medewerker@nijmegen.nl '],
      ['resource', 'sport'],
      ['action', 'view'],
      ['districts', 'dukenburg'],
      ['districts', 'dukenburg'],
      ['districts', 'lindenholt'],
    ]), catalog);

    expect(parsed).toEqual({
      targetEmail: 'medewerker@nijmegen.nl',
      resource: 'sport',
      isResourceAdmin: false,
      actions: ['view'],
      scopes: { districts: ['dukenburg', 'lindenholt'] },
    });
  });

  it('translates the admin toggle into a canonical <resource>:* grant, without scopes', () => {
    const parsed = parsePermissionGrantRequest(form([
      ['targetEmail', 'beheerder@nijmegen.nl'],
      ['resource', 'sport'],
      ['accessMode', 'admin'],
      ['districts', 'dukenburg'],
    ]), catalog);

    expect(parsed).toEqual({ targetEmail: 'beheerder@nijmegen.nl', resource: 'sport', isResourceAdmin: true, actions: ['*'] });
  });

  it('rejects a manipulated request for an unregistered resource instead of writing anything', () => {
    const parsed = parsePermissionGrantRequest(form([
      ['targetEmail', 'medewerker@nijmegen.nl'],
      ['resource', 'app2'],
      ['action', 'view'],
    ]), catalog);

    expect(parsed).toBeUndefined();
  });

  it('drops an unknown district instead of granting it, keeping the empty scope restrictive rather than unscoped', () => {
    const parsed = parsePermissionGrantRequest(form([
      ['targetEmail', 'medewerker@nijmegen.nl'],
      ['resource', 'sport'],
      ['action', 'view'],
      ['districts', 'atlantis'],
    ]), catalog);

    expect(parsed).toEqual({
      targetEmail: 'medewerker@nijmegen.nl', resource: 'sport', isResourceAdmin: false, actions: ['view'], scopes: { districts: [] },
    });
  });

  it('rejects an invalid email and a request with no known action', () => {
    expect(parsePermissionGrantRequest(form([['targetEmail', 'not-an-email'], ['resource', 'sport'], ['action', 'view']]), catalog)).toBeUndefined();
    expect(parsePermissionGrantRequest(form([['targetEmail', 'medewerker@nijmegen.nl'], ['resource', 'sport'], ['action', 'delete']]), catalog)).toBeUndefined();
  });
});
