import * as fs from 'fs';
import * as path from 'path';
import { forbiddenData } from './fixtures/forbidden';
import { homeEmpty, homeWithFeatures, notFoundData } from './fixtures/home';
import { loginData } from './fixtures/login';
import { logoutData } from './fixtures/logout';
import { sportAllDistricts, sportDukenburg, sportEmpty, sportPartialError } from './fixtures/sport';
import homeTemplate from '../app/home/templates/home.mustache';
import notFoundTemplate from '../app/home/templates/notFound.mustache';
import loginTemplate from '../app/login/templates/login.mustache';
import logoutTemplate from '../app/logout/templates/logout.mustache';
import sportTemplate from '../app/sport/templates/sport.mustache';
import { render } from '../shared/rendering/Renderer';
import forbiddenTemplate from '../shared/rendering/templates/forbidden.mustache';

// Path from preview/<page>.html back to src/app/static-resources/static
const STATIC_REL = '../src/app/static-resources/static';
const ROUTE_PATTERN = /href="(\/[a-zA-Z0-9-]*)"/g;

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

  const pages: Record<string, string> = {
    'home': render(homeTemplate, homeWithFeatures),
    'home-empty': render(homeTemplate, homeEmpty),
    'login': render(loginTemplate, loginData),
    'logout': render(logoutTemplate, logoutData),
    '403': render(forbiddenTemplate, forbiddenData),
    '404': render(notFoundTemplate, notFoundData),
    'sport-all-districts': render(sportTemplate, sportAllDistricts.page, sportAllDistricts.data),
    'sport-dukenburg': render(sportTemplate, sportDukenburg.page, sportDukenburg.data),
    'sport-empty': render(sportTemplate, sportEmpty.page, sportEmpty.data),
    'sport-partial-error': render(sportTemplate, sportPartialError.page, sportPartialError.data),
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
