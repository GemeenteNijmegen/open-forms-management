import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ApiGatewayV2Response, Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';
import { Session } from '@gemeentenijmegen/session';
import loginTemplate from './templates/login.mustache';
import { render } from '../../shared/rendering/Renderer';

export class LoginPageRequestHandler {
  async handleRequest(cookieHeader: string | undefined, dynamoDBClient: DynamoDBClient, failed: boolean): Promise<ApiGatewayV2Response> {
    const session = new Session(cookieHeader ?? '', dynamoDBClient);
    await session.init();

    if (session.isLoggedIn()) {
      return Response.redirect('/');
    }

    const html = render(loginTemplate, { title: 'Inloggen', features: [], currentPath: '/login' }, { failed });
    return Response.html(html);
  }
}
