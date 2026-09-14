import federation from './federation-entrypoint';

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && /^\/users\/[^/]+$/.test(url.pathname)) {
      const response = await federation.fetch(request, env, ctx);
      if (!response.ok) return response;
      const body = await response.json() as any;
      if (body?.id && body?.publicKey) {
        body.publicKey.id = `${body.id}#main-key`;
        body.publicKey.owner = body.id;
      }
      const headers = new Headers(response.headers);
      headers.set('Content-Type', 'application/activity+json; charset=utf-8');
      headers.set('Cache-Control', 'no-store');
      return new Response(JSON.stringify(body), { status: response.status, headers });
    }
    return federation.fetch(request, env, ctx);
  }
};
