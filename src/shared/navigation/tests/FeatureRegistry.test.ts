import { PermissionEvaluator } from '../../authorization/PermissionEvaluator';
import { PermissionGrant } from '../../authorization/PermissionGrant';
import { Feature } from '../Feature';
import { visibleFeatures } from '../FeatureRegistry';

const testFeature: Feature = {
  id: 'test-feature',
  label: 'Testfeature',
  route: '/test-feature',
  resource: 'testresource',
  action: 'view',
};

const otherFeature: Feature = {
  id: 'other-feature',
  label: 'Andere feature',
  route: '/other-feature',
  resource: 'other',
  action: 'view',
};

interface Case {
  name: string;
  features: Feature[];
  grants: PermissionGrant[];
  expected: Feature[];
}

const cases: Case[] = [
  {
    name: 'an empty registry stays empty regardless of grants',
    features: [],
    grants: [{ resource: '*', actions: ['*'] }],
    expected: [],
  },
  {
    name: 'no grants at all hides every feature',
    features: [testFeature, otherFeature],
    grants: [],
    expected: [],
  },
  {
    name: 'global admin sees every registered feature',
    features: [testFeature, otherFeature],
    grants: [{ resource: '*', actions: ['*'] }],
    expected: [testFeature, otherFeature],
  },
  {
    name: 'resource admin sees only features on their own resource',
    features: [testFeature, otherFeature],
    grants: [{ resource: 'testresource', actions: ['*'] }],
    expected: [testFeature],
  },
  {
    name: 'a normal grant shows only the feature matching its exact resource and action',
    features: [testFeature, otherFeature],
    grants: [{ resource: 'testresource', actions: ['view'] }],
    expected: [testFeature],
  },
  {
    name: 'a scoped grant is enough to show the feature, e.g. a single-district Sport grant',
    features: [testFeature, otherFeature],
    grants: [{ resource: 'testresource', actions: ['view'], scopes: { districts: ['dukenburg'] } }],
    expected: [testFeature],
  },
];

describe('visibleFeatures', () => {
  it.each(cases)('$name', ({ features, grants, expected }) => {
    const evaluator = new PermissionEvaluator(grants);
    expect(visibleFeatures(features, evaluator)).toEqual(expected);
  });

  describe('dedupeKey', () => {
    const primaryVariant: Feature = {
      id: 'variant-a', label: 'Variant A', route: '/variant-a', resource: 'testresource', action: 'view', dedupeKey: 'shared',
    };
    const fallbackVariant: Feature = {
      id: 'variant-b', label: 'Variant B', route: '/variant-b', resource: 'testresource', action: 'other', dedupeKey: 'shared',
    };

    it('keeps only the first visible feature sharing a dedupeKey, in array order', () => {
      const evaluator = new PermissionEvaluator([{ resource: 'testresource', actions: ['view', 'other'] }]);
      expect(visibleFeatures([primaryVariant, fallbackVariant], evaluator)).toEqual([primaryVariant]);
    });

    it('falls back to the second variant when only its own action is granted', () => {
      const evaluator = new PermissionEvaluator([{ resource: 'testresource', actions: ['other'] }]);
      expect(visibleFeatures([primaryVariant, fallbackVariant], evaluator)).toEqual([fallbackVariant]);
    });

    it('features without a dedupeKey are never deduplicated against each other', () => {
      const evaluator = new PermissionEvaluator([{ resource: 'testresource', actions: ['view'] }]);
      expect(visibleFeatures([testFeature, { ...testFeature, id: 'test-feature-2' }], evaluator)).toHaveLength(2);
    });
  });
});
