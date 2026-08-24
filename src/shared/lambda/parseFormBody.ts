/** Decodes an API Gateway v2 POST body (possibly base64-encoded) into `application/x-www-form-urlencoded` fields. */
export function parseFormBody(body: string | undefined, isBase64Encoded: boolean): URLSearchParams {
  if (!body) {
    return new URLSearchParams();
  }
  return new URLSearchParams(isBase64Encoded ? Buffer.from(body, 'base64').toString('utf-8') : body);
}
