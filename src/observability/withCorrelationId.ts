import { ApiGatewayV2Response } from '@gemeentenijmegen/apigateway-http/lib/V2/Response';

/** Adds `X-Correlation-Id` so the browser can pass it back on a later request (e.g. client-error telemetry) for a failed one. */
export function withCorrelationId(response: ApiGatewayV2Response, correlationId: string): ApiGatewayV2Response {
  return { ...response, headers: { ...response.headers, 'X-Correlation-Id': correlationId } };
}
