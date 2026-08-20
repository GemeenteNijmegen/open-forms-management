import { Feature } from './Feature';
import defaultIcon from './icons/default.mustache';

export interface NavigationItem {
  route: string;
  label: string;
  icon: string;
  current: boolean;
}

export class Navigation {
  readonly items: NavigationItem[];

  constructor(features: Feature[], currentPath: string) {
    this.items = features.map((feature) => ({
      route: feature.route,
      label: feature.label,
      icon: feature.icon ?? defaultIcon,
      current: feature.route === currentPath,
    }));
  }
}
