import { logger } from '../../../observability/Logger';
import { Feature } from '../../navigation/Feature';
import { render } from '../Renderer';

const PAGE = '{{>header}}<p>content</p>{{>footer}}';

const testFeature: Feature = {
  id: 'test-feature', label: 'Testfeature', route: '/test-feature', resource: 'testresource', action: 'view',
};

const otherFeature: Feature = {
  id: 'other-feature', label: 'Andere feature', route: '/other-feature', resource: 'other', action: 'view',
};

describe('render', () => {
  beforeEach(() => {
    jest.spyOn(logger, 'error').mockImplementation(() => { });
  });

  it('renders the page template, with the title in <title>', () => {
    const html = render(PAGE, { title: 'Home', features: [], currentPath: '/' });

    expect(html).toContain('<title>Home - Open Forms Management</title>');
    expect(html).toContain('<p>content</p>');
  });

  it('HTML-escapes viewmodel values by default', () => {
    const html = render(PAGE, { title: 'Home', features: [], currentPath: '/', actorEmail: '<script>alert(1)</script>' });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('lists every visible feature as a navigation link when there are any', () => {
    const html = render(PAGE, { title: 'Home', features: [testFeature], currentPath: '/' });

    expect(html).toContain('aria-label="Hoofdnavigatie"');
    expect(html).toContain('href="/test-feature"');
    expect(html).toContain('Testfeature');
  });

  it('renders no navigation element at all when there are no visible features, instead of an empty one', () => {
    const html = render(PAGE, { title: 'Home', features: [], currentPath: '/' });

    expect(html).not.toContain('aria-label="Hoofdnavigatie"');
  });

  it('marks the nav item matching currentPath as current in both the sidenav and the mobile menu', () => {
    const html = render(PAGE, {
      title: 'Home', features: [testFeature, otherFeature], currentPath: '/other-feature', actorEmail: 'medewerker@nijmegen.nl',
    });

    const currentLinks = [...html.matchAll(/<a[^>]*href="\/other-feature"[^>]*>[\s\S]*?<\/a>/g)];
    const otherLinks = [...html.matchAll(/<a[^>]*href="\/test-feature"[^>]*>[\s\S]*?<\/a>/g)];

    expect(currentLinks).toHaveLength(2);
    expect(currentLinks.every((match) => match[0].includes('aria-current="page"'))).toBe(true);
    expect(otherLinks).toHaveLength(2);
    expect(otherLinks.every((match) => !match[0].includes('aria-current="page"'))).toBe(true);
  });

  it('shows the actor email and a logout link in the header when actorEmail is set', () => {
    const html = render(PAGE, { title: 'Home', features: [], currentPath: '/', actorEmail: 'medewerker@nijmegen.nl' });

    expect(html).toContain('medewerker@nijmegen.nl');
    expect(html).toContain('href="/logout"');
  });

  it('shows no account menu or logout link when actorEmail is not set', () => {
    const html = render(PAGE, { title: 'Login', features: [], currentPath: '/login' });

    expect(html).not.toContain('accountmenu');
    expect(html).not.toContain('href="/logout"');
  });

  it('reaches the logout link on mobile even when there are no visible features, since the menu opens on actorEmail alone', () => {
    const html = render(PAGE, { title: 'Home', features: [], currentPath: '/', actorEmail: 'admin@nijmegen.nl' });

    expect(html).toContain('id="mobile-menu"');
    expect(html).toContain('href="/logout"');
  });

  it('has a skip link to the main landmark, so keyboard users can bypass the header nav', () => {
    const html = render(PAGE, { title: 'Home', features: [], currentPath: '/' });

    expect(html).toContain('<a href="#main-content" class="nijmegen-skip-link">Direct naar inhoud</a>');
  });

  it('makes page-specific data available to the template, without letting it override title/nav', () => {
    const html = render('{{>header}}<p>{{count}}</p>{{>footer}}', { title: 'Home', features: [], currentPath: '/' }, { count: 3, title: 'Overridden' });

    expect(html).toContain('<p>3</p>');
    expect(html).toContain('<title>Home - Open Forms Management</title>');
  });

  it('logs an ERROR and rethrows when the template fails to render', () => {
    expect(() => render('{{#unclosed}}', { title: 'Home', features: [], currentPath: '/' })).toThrow();

    expect(logger.error).toHaveBeenCalledWith('Failed to render page', {
      title: 'Home', reason: expect.any(String),
    });
  });
});
