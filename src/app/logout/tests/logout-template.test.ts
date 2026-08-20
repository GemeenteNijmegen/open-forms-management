import { render } from '../../../shared/rendering/Renderer';
import logoutTemplate from '../templates/logout.mustache';

describe('logout.mustache', () => {
  it('renders a confirmation with a link back to /login', () => {
    const html = render(logoutTemplate, { title: 'Uitgelogd', features: [], currentPath: '/logout' });

    expect(html).toContain('Uitgelogd</h1>');
    expect(html).toContain('href="/login"');
  });
});
