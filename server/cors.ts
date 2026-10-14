/** Only the original site and the owner's GitHub Pages origin may use the API. */
export function originPolicy(request: Request, pagesOrigin: string) {
  const origin = request.headers.get('Origin');
  const allowed = !origin || origin === new URL(request.url).origin || origin === pagesOrigin;
  const headers: Record<string, string> = { Vary: 'Origin' };
  if (allowed && origin) headers['Access-Control-Allow-Origin'] = origin;
  return { allowed, headers };
}

export function preflight(request: Request, headers: Record<string, string>): Response {
  const method = request.headers.get('Access-Control-Request-Method');
  const requestedHeaders = (request.headers.get('Access-Control-Request-Headers') || '')
    .split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  if (!request.headers.get('Origin') || !['GET', 'POST'].includes(method || '') || requestedHeaders.some(value => value !== 'content-type')) {
    return new Response(null, { status: 403, headers });
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...headers,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
    },
  });
}
