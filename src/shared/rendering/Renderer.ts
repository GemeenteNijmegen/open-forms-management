import Mustache from 'mustache';
import footerTemplate from './templates/footer.mustache';
import headerTemplate from './templates/header.mustache';
import sidenavTemplate from './templates/sidenav.mustache';
import { errorReason } from '../../observability/errorReason';
import { logger } from '../../observability/Logger';
import { Feature } from '../navigation/Feature';
import { Navigation } from '../navigation/Navigation';

export interface PageViewModel {
  title: string;
  features: Feature[];
  currentPath: string;
  actorEmail?: string;
}

export function render(pageTemplate: string, viewModel: PageViewModel, pageData: Record<string, unknown> = {}): string {
  const nav = new Navigation(viewModel.features, viewModel.currentPath).items;
  const data = {
    ...pageData,
    title: viewModel.title,
    actorEmail: viewModel.actorEmail,
    currentYear: new Date().getFullYear(),
    nav,
    hasSidenav: nav.length > 0,
  };
  try {
    return Mustache.render(pageTemplate, data, {
      header: headerTemplate,
      footer: footerTemplate,
      sidenav: sidenavTemplate,
    });
  } catch (error) {
    logger.error('Failed to render page', { title: viewModel.title, reason: errorReason(error) });
    throw error;
  }
}

/** Renders a template on its own, without the page shell: for a server-rendered fragment an already-loaded page fetches separately. */
export function renderFragment<T extends object>(template: string, data: T): string {
  try {
    return Mustache.render(template, data);
  } catch (error) {
    logger.error('Failed to render fragment', { reason: errorReason(error) });
    throw error;
  }
}
