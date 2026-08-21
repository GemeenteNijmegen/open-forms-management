import { PermissionEvaluator } from '../../../shared/authorization/PermissionEvaluator';
import { resolveAllowedDistricts } from '../SportDistrictAuthorization';

describe('resolveAllowedDistricts', () => {
  it('returns every district for a global admin', () => {
    const evaluator = new PermissionEvaluator([{ resource: '*', actions: ['*'] }]);
    expect(resolveAllowedDistricts(evaluator)).toHaveLength(7);
  });

  it('returns every district for a Sport resource admin', () => {
    const evaluator = new PermissionEvaluator([{ resource: 'sport', actions: ['*'] }]);
    expect(resolveAllowedDistricts(evaluator)).toHaveLength(7);
  });

  it('returns only the granted districts for a medewerker with multiple district grants', () => {
    const evaluator = new PermissionEvaluator([
      { resource: 'sport', actions: ['view'], scopes: { districts: ['dukenburg', 'lindenholt'] } },
    ]);
    expect(resolveAllowedDistricts(evaluator)).toEqual(['dukenburg', 'lindenholt']);
  });

  it('returns no districts without a Sport grant', () => {
    const evaluator = new PermissionEvaluator([]);
    expect(resolveAllowedDistricts(evaluator)).toEqual([]);
  });
});
