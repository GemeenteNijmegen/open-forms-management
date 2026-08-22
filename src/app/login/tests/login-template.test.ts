import { render } from '../../../shared/rendering/Renderer';
import loginTemplate from '../templates/login.mustache';

describe('login.mustache', () => {
  it('renders the login button without the failure message by default', () => {
    const html = render(loginTemplate, { title: 'Inloggen', features: [], currentPath: '/login' }, { failed: false });

    expect(html).toContain('Inloggen</h1>');
    expect(html).toContain('href="/login/start"');
    expect(html).not.toContain('Het inloggen is niet gelukt');
  });

  it('renders the failure message after a failed login attempt', () => {
    const html = render(loginTemplate, { title: 'Inloggen', features: [], currentPath: '/login' }, { failed: true });

    expect(html).toContain('Het inloggen is niet gelukt. Probeer het opnieuw.');
    expect(html).toContain('href="/login/start"');
  });
});
