import * as fs from 'fs';
import * as path from 'path';
import { forbiddenData } from './fixtures/forbidden';
import { homeWithFeatures, noPermissionsData, notFoundData } from './fixtures/home';
import { loginData } from './fixtures/login';
import { logoutData } from './fixtures/logout';
import { permissionsRemoveConfirm, permissionsSportAdmin, permissionsSuperadmin, permissionsUserMultiResource } from './fixtures/permissions';
import {
  sportShellAllDistricts, sportShellDukenburg, sportSubmissionsAllDistricts, sportSubmissionsContentVariety,
  sportSubmissionsDukenburg, sportSubmissionsEmpty, sportSubmissionsHasMore, sportSubmissionsStale,
} from './fixtures/sport';
import { sportReporterActiveAndReady, sportReporterEmpty, sportReporterTooLargeAndFailed } from './fixtures/sportReporter';
import {
  woonbehoefteDetailInadmissible, woonbehoefteDetailManyDocuments, woonbehoefteDetailNormal, woonbehoefteDetailProposedInadmissible,
  woonbehoefteDetailSaved, woonbehoefteDetailSourceError, woonbehoefteDetailViewOnly,
  woonbehoefteOverviewEmpty, woonbehoefteOverviewViewOnly, woonbehoefteOverviewWithMix,
} from './fixtures/woonbehoefte';
import homeTemplate from '../app/home/templates/home.mustache';
import noPermissionsTemplate from '../app/home/templates/no-permissions.mustache';
import notFoundTemplate from '../app/home/templates/notFound.mustache';
import loginTemplate from '../app/login/templates/login.mustache';
import logoutTemplate from '../app/logout/templates/logout.mustache';
import permissionEditTemplate from '../app/permissions/templates/permission-edit.mustache';
import permissionRemoveConfirmTemplate from '../app/permissions/templates/permission-remove-confirm.mustache';
import permissionsTemplate from '../app/permissions/templates/permissions.mustache';
import sportReportsTemplate from '../app/sport/templates/sport-reports.mustache';
import sportSubmissionsTemplate from '../app/sport/templates/sport-submissions.mustache';
import sportTemplate from '../app/sport/templates/sport.mustache';
import woonbehoefteDetailTemplate from '../app/woonbehoefte/templates/woonbehoefte-detail.mustache';
import woonbehoefteOverviewTemplate from '../app/woonbehoefte/templates/woonbehoefte-overview.mustache';
import { render, renderFragment, PageViewModel } from '../shared/rendering/Renderer';
import forbiddenTemplate from '../shared/rendering/templates/forbidden.mustache';

// Path from preview/<page>.html back to src/app/static-resources/static
const STATIC_REL = '../src/app/static-resources/static';
const ROUTE_PATTERN = /href="(\/[a-zA-Z0-9-]*)"/g;
const SUBMISSIONS_CONTAINER_PATTERN = /<div id="sport-submissions"[^>]*>[\s\S]*?<\/div>/;

// The preview has no real backend: `sport-submissions.js` would immediately fetch and fail. Previewing the
// Sport shell instead embeds an already-rendered fragment directly and drops the live script, so the static
// HTML shows what a real loaded page looks like instead of the script's own network-failure message.
function renderSportPage(shellFixture: { page: PageViewModel; data: object }, submissionsViewModel: object): string {
  const shellHtml = render(sportTemplate, shellFixture.page, { ...shellFixture.data, isAanmeldingenTab: true })
    .replace('<script src="/static/js/sport-submissions.js" defer></script>\n', '');
  const fragmentHtml = renderFragment(sportSubmissionsTemplate, submissionsViewModel);
  return shellHtml.replace(SUBMISSIONS_CONTAINER_PATTERN, `<div id="sport-submissions" aria-live="polite" aria-busy="false">${fragmentHtml}</div>`);
}

// Read at call time, not module load time, so tests can chdir into a temp directory before calling renderAll().
function outDir(): string {
  return path.join(process.cwd(), 'preview');
}

function rewriteStatic(html: string): string {
  return html
    .replace(/href="\/static/g, `href="${STATIC_REL}`)
    .replace(/src="\/static/g, `src="${STATIC_REL}`);
}

function rewriteRoutes(html: string, routeToFile: Record<string, string>): string {
  return html.replace(ROUTE_PATTERN, (match, route) => {
    const file = routeToFile[route];
    return file ? `href="${file}.html"` : match;
  });
}

async function writeHtml(name: string, html: string, routeToFile: Record<string, string>): Promise<void> {
  const dir = outDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.html`), rewriteRoutes(rewriteStatic(html), routeToFile));
  console.log(`  preview/${name}.html`);
}

// Every page rendered in renderAll() below needs an entry here too: this is how its own links become
// clickable in the preview instead of 404ing on a non-existent file:///<route>. A route referenced by a
// fixture that ISN'T in this map (e.g. a feature whose page doesn't exist yet) gets an automatic stub
// page instead, see below, so a new fixture route never needs to be registered here just to stay clickable.
const ROUTE_TO_PREVIEW_FILE: Record<string, string> = {
  '/': 'home',
  '/login': 'login',
  '/logout': 'logout',
  '/sport': 'sport-all-districts',
  '/sport/overzichten': 'sport-reporter-active-and-ready',
  '/permissions': 'permissions-superadmin',
  '/woonbehoefte': 'woonbehoefte-overview-mix',
};

function stubFileName(route: string): string {
  return `stub${route.replace(/\//g, '-')}`;
}

const STUB_PAGE_TEMPLATE = `{{>header}}
<main id="main-content">
  <h1>{{title}}</h1>
  <p class="utrecht-paragraph">Automatisch gegenereerde placeholder, zodat elke link in de preview ergens
  naartoe gaat. Er is nog geen echte pagina voor deze route.</p>
  <p><a class="utrecht-button utrecht-button--secondary-action" href="/">Terug naar home</a></p>
</main>
{{>footer}}`;

function findUnregisteredRoutes(pages: string[]): string[] {
  const routes = new Set<string>();
  for (const html of pages) {
    for (const [, route] of html.matchAll(ROUTE_PATTERN)) {
      if (!(route in ROUTE_TO_PREVIEW_FILE)) {
        routes.add(route);
      }
    }
  }
  return [...routes];
}

export async function renderAll(): Promise<void> {
  console.log('Rendering previews...');
  // A page renamed/removed from `pages` below would otherwise leave its old file on disk indefinitely.
  fs.rmSync(outDir(), { recursive: true, force: true });

  const pages: Record<string, string> = {
    'home': render(homeTemplate, homeWithFeatures),
    'no-permissions': render(noPermissionsTemplate, noPermissionsData),
    'login': render(loginTemplate, loginData),
    'login-failed': render(loginTemplate, loginData, { failed: true }),
    'logout': render(logoutTemplate, logoutData),
    '403': render(forbiddenTemplate, forbiddenData),
    '404': render(notFoundTemplate, notFoundData),
    'sport-all-districts': renderSportPage(sportShellAllDistricts, sportSubmissionsAllDistricts),
    'sport-dukenburg': renderSportPage(sportShellDukenburg, sportSubmissionsDukenburg),
    'sport-submissions-empty': renderSportPage(sportShellAllDistricts, sportSubmissionsEmpty),
    'sport-submissions-stale': renderSportPage(sportShellAllDistricts, sportSubmissionsStale),
    'sport-submissions-has-more': renderSportPage(sportShellAllDistricts, sportSubmissionsHasMore),
    'sport-submissions-content-variety': renderSportPage(sportShellAllDistricts, sportSubmissionsContentVariety),
    'sport-reporter-empty': render(sportReportsTemplate, sportReporterEmpty.page, { ...sportReporterEmpty.data, isOverzichtenTab: true }),
    'sport-reporter-active-and-ready': render(sportReportsTemplate, sportReporterActiveAndReady.page, { ...sportReporterActiveAndReady.data, isOverzichtenTab: true }),
    'sport-reporter-too-large-and-failed': render(sportReportsTemplate, sportReporterTooLargeAndFailed.page, { ...sportReporterTooLargeAndFailed.data, isOverzichtenTab: true }),
    'permissions-superadmin': render(permissionsTemplate, permissionsSuperadmin.page, permissionsSuperadmin.data),
    'permissions-sport-admin': render(permissionsTemplate, permissionsSportAdmin.page, permissionsSportAdmin.data),
    'permissions-user-multi-resource': render(permissionEditTemplate, permissionsUserMultiResource.page, permissionsUserMultiResource.data),
    'permissions-remove-confirm': render(permissionRemoveConfirmTemplate, permissionsRemoveConfirm.page, permissionsRemoveConfirm.data),
    'woonbehoefte-overview-mix': render(woonbehoefteOverviewTemplate, woonbehoefteOverviewWithMix.page, woonbehoefteOverviewWithMix.data),
    'woonbehoefte-overview-empty': render(woonbehoefteOverviewTemplate, woonbehoefteOverviewEmpty.page, woonbehoefteOverviewEmpty.data),
    'woonbehoefte-overview-view-only': render(woonbehoefteOverviewTemplate, woonbehoefteOverviewViewOnly.page, woonbehoefteOverviewViewOnly.data),
    'woonbehoefte-detail-normal': render(woonbehoefteDetailTemplate, woonbehoefteDetailNormal.page, woonbehoefteDetailNormal.data),
    'woonbehoefte-detail-source-error': render(woonbehoefteDetailTemplate, woonbehoefteDetailSourceError.page, woonbehoefteDetailSourceError.data),
    'woonbehoefte-detail-many-documents': render(woonbehoefteDetailTemplate, woonbehoefteDetailManyDocuments.page, woonbehoefteDetailManyDocuments.data),
    'woonbehoefte-detail-proposed-inadmissible': render(
      woonbehoefteDetailTemplate, woonbehoefteDetailProposedInadmissible.page, woonbehoefteDetailProposedInadmissible.data,
    ),
    'woonbehoefte-detail-inadmissible': render(woonbehoefteDetailTemplate, woonbehoefteDetailInadmissible.page, woonbehoefteDetailInadmissible.data),
    'woonbehoefte-detail-view-only': render(woonbehoefteDetailTemplate, woonbehoefteDetailViewOnly.page, woonbehoefteDetailViewOnly.data),
    'woonbehoefte-detail-saved': render(woonbehoefteDetailTemplate, woonbehoefteDetailSaved.page, woonbehoefteDetailSaved.data),
  };

  const stubRoutes = findUnregisteredRoutes(Object.values(pages));
  const routeToFile = { ...ROUTE_TO_PREVIEW_FILE, ...Object.fromEntries(stubRoutes.map((route): [string, string] => [route, stubFileName(route)])) };

  for (const route of stubRoutes) {
    const stubPage = render(STUB_PAGE_TEMPLATE, {
      title: `Nog geen preview: ${route}`,
      features: homeWithFeatures.features,
      actorEmail: homeWithFeatures.actorEmail,
      currentPath: route,
    });
    await writeHtml(stubFileName(route), stubPage, routeToFile);
  }
  for (const [name, html] of Object.entries(pages)) {
    await writeHtml(name, html, routeToFile);
  }

  console.log('Done.');
}

if (require.main === module) {
  renderAll().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
