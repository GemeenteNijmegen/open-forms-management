function handler(event) {
  var response = event.response;
  if (response.statusCode === 401 || response.statusCode === 403) {
    response.statusCode = 302;
    response.statusDescription = 'Found';
    response.headers.location = { value: '/login' };
  }
  return response;
}
