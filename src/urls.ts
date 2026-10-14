/** Keep the static site's base path separate from the room server's origin. */
export function gameUrls(frontendOrigin: string, basePath: string, backendOrigin = frontendOrigin) {
  const backend = new URL(backendOrigin);
  if (!['http:', 'https:'].includes(backend.protocol) || backend.username || backend.password || backend.pathname !== '/' || backend.search || backend.hash) {
    throw new Error('The game backend must be an HTTP(S) origin.');
  }
  const home = new URL(basePath, frontendOrigin);
  return {
    home: home.pathname,
    asset: (path: string) => new URL(path, home).pathname,
    api: (path: string) => new URL(path, backend).href,
    socket: (code: string, id: string, token: string) => {
      const url = new URL(`/api/rooms/${encodeURIComponent(code)}/ws`, backend);
      url.protocol = backend.protocol === 'https:' ? 'wss:' : 'ws:';
      url.search = new URLSearchParams({ id, token }).toString();
      return url.href;
    },
    invite: (code: string) => {
      const url = new URL(home);
      url.search = new URLSearchParams({ room: code }).toString();
      return url.href;
    },
  };
}
