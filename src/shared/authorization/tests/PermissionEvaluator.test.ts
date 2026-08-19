import { PermissionCheck, PermissionDecision, PermissionEvaluator } from '../PermissionEvaluator';
import { PermissionGrant } from '../PermissionGrant';

interface Case {
  name: string;
  grants: PermissionGrant[];
  check: PermissionCheck;
  expected: PermissionDecision;
}

const cases: Case[] = [
  {
    name: 'global admin allows any resource and action',
    grants: [{ resource: '*', actions: ['*'] }],
    check: { resource: 'testresource', action: 'view' },
    expected: 'ALLOW',
  },
  {
    name: 'global admin allows an unrelated resource with no other grants',
    grants: [{ resource: '*', actions: ['*'] }],
    check: { resource: 'other', action: 'delete' },
    expected: 'ALLOW',
  },
  {
    name: 'resource admin allows any action on its own resource',
    grants: [{ resource: 'testresource', actions: ['*'] }],
    check: { resource: 'testresource', action: 'delete' },
    expected: 'ALLOW',
  },
  {
    name: 'resource admin does not allow actions on another resource',
    grants: [{ resource: 'testresource', actions: ['*'] }],
    check: { resource: 'other', action: 'view' },
    expected: 'DENY',
  },
  {
    name: 'normal grant allows its exact action',
    grants: [{ resource: 'testresource', actions: ['view'] }],
    check: { resource: 'testresource', action: 'view' },
    expected: 'ALLOW',
  },
  {
    name: 'normal grant denies an action outside its action list',
    grants: [{ resource: 'testresource', actions: ['view'] }],
    check: { resource: 'testresource', action: 'delete' },
    expected: 'DENY',
  },
  {
    name: 'scoped grant allows a matching scope value',
    grants: [{ resource: 'testresource', actions: ['view'], scopes: { districts: ['dukenburg'] } }],
    check: { resource: 'testresource', action: 'view', scope: { districts: 'dukenburg' } },
    expected: 'ALLOW',
  },
  {
    name: 'scoped grant denies a non-matching scope value',
    grants: [{ resource: 'testresource', actions: ['view'], scopes: { districts: ['dukenburg'] } }],
    check: { resource: 'testresource', action: 'view', scope: { districts: 'lindenholt' } },
    expected: 'DENY',
  },
  {
    name: 'scoped grant denies a check with no scope at all',
    grants: [{ resource: 'testresource', actions: ['view'], scopes: { districts: ['dukenburg'] } }],
    check: { resource: 'testresource', action: 'view' },
    expected: 'DENY',
  },
  {
    name: 'scoped grant requires every scoped key to match',
    grants: [{
      resource: 'testresource',
      actions: ['view'],
      scopes: { districts: ['dukenburg'], teams: ['blue'] },
    }],
    check: { resource: 'testresource', action: 'view', scope: { districts: 'dukenburg', teams: 'red' } },
    expected: 'DENY',
  },
  {
    name: 'unscoped grant allows regardless of an unrelated scope on the check',
    grants: [{ resource: 'testresource', actions: ['view'] }],
    check: { resource: 'testresource', action: 'view', scope: { districts: 'lindenholt' } },
    expected: 'ALLOW',
  },
  {
    name: 'a wildcard scope value allows any requested value for that key',
    grants: [{ resource: 'testresource', actions: ['view'], scopes: { districts: ['*'] } }],
    check: { resource: 'testresource', action: 'view', scope: { districts: 'lindenholt' } },
    expected: 'ALLOW',
  },
  {
    name: 'a wildcard scope value still requires the check to supply that scope key',
    grants: [{ resource: 'testresource', actions: ['view'], scopes: { districts: ['*'] } }],
    check: { resource: 'testresource', action: 'view' },
    expected: 'DENY',
  },
  {
    name: 'a wildcard on one scope key does not bypass a concrete requirement on another key',
    grants: [{
      resource: 'testresource',
      actions: ['view'],
      scopes: { districts: ['*'], teams: ['blue'] },
    }],
    check: { resource: 'testresource', action: 'view', scope: { districts: 'lindenholt', teams: 'red' } },
    expected: 'DENY',
  },
  {
    name: 'a grant for a different resource does not match',
    grants: [{ resource: 'other', actions: ['view'] }],
    check: { resource: 'testresource', action: 'view' },
    expected: 'DENY',
  },
  {
    name: 'a resource admin grant for another resource does not leak into a scoped grant on the checked resource',
    grants: [
      { resource: 'other', actions: ['*'] },
      { resource: 'testresource', actions: ['view'], scopes: { districts: ['dukenburg'] } },
    ],
    check: { resource: 'testresource', action: 'view', scope: { districts: 'lindenholt' } },
    expected: 'DENY',
  },
  {
    name: 'no grants at all is a deny',
    grants: [],
    check: { resource: 'testresource', action: 'view' },
    expected: 'DENY',
  },
];

describe('PermissionEvaluator', () => {
  it.each(cases)('$name', ({ grants, check, expected }) => {
    const evaluator = new PermissionEvaluator(grants);
    expect(evaluator.evaluate(check)).toBe(expected);
  });
});
