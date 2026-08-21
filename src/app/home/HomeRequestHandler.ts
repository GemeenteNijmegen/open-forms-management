import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import homeTemplate from './templates/home.mustache';
import notFoundTemplate from './templates/notFound.mustache';
import { EmployeeIdentity } from '../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../shared/authorization/AuthorizationService';
import { Feature } from '../../shared/navigation/Feature';
import { visibleFeatures } from '../../shared/navigation/FeatureRegistry';
import { render } from '../../shared/rendering/Renderer';

// Subproject 1 has no concrete Sport/resource features yet, so this is empty until subproject 2 registers
// real features. An empty registry means every medewerker sees the "no features" empty state.
const REGISTERED_FEATURES: Feature[] = [];

export class HomeRequestHandler {
  constructor(private readonly authorizationService: AuthorizationService) { }

  // The HTTP API's $default route sends every unmatched path here too, so this doubles as the 404 handler.
  async handleRequest(identity: EmployeeIdentity, path: string): Promise<ApiGatewayV2Response> {
    if (path !== '/') {
      const html = render(notFoundTemplate, { title: 'Pagina niet gevonden', features: [], currentPath: path, actorEmail: identity.email });
      return Response.html(html, 404);
    }

    const context = await this.authorizationService.loadContext(identity);
    const features = visibleFeatures(REGISTERED_FEATURES, context.evaluator);
    const html = render(homeTemplate, { title: 'Home', features, currentPath: '/', actorEmail: identity.email });
    return Response.html(html);
  }
}
