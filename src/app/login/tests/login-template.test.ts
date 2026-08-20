import { render } from '../../../shared/rendering/Renderer';
import loginTemplate from '../templates/login.mustache';

// Not wired into a route yet, see LoginRequestHandler/AuthRequestHandler: those keep their existing redirects.

describe('login.mustache', () => {
  it('renders a retry link back to /login', () => {
    const html = render(loginTemplate, { title: 'Inloggen', features: [], currentPath: '/login' });

    expect(html).toContain('Inloggen</h1>');
    expect(html).toContain('href="/login"');
  });
});
