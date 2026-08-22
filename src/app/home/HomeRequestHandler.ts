import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import homeTemplate from './templates/home.mustache';
import notFoundTemplate from './templates/notFound.mustache';
import { EmployeeIdentity } from '../../shared/auth/EmployeeIdentity';
import { AuthorizationService } from '../../shared/authorization/AuthorizationService';
import { visibleFeatures } from '../../shared/navigation/FeatureRegistry';
import { REGISTERED_FEATURES } from '../../shared/navigation/RegisteredFeatures';
import { render } from '../../shared/rendering/Renderer';

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
