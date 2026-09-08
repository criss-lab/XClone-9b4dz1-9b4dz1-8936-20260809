import federation from './federation-entrypoint';

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const response = await federation.fetch(request, env, ctx);
    const type = response.headers.get('content-type') || '';
    if (!type.includes('activity+json')) return response;
    try {
      const body = await response.json() as any;
      if (body?.id && body?.publicKey) {
        body.publicKey.id = `${body.id}#main-key`;
        body.publicKey.owner = body.id;
        const headers = new Headers(response.headers);
        headers.set('Content-Type', 'application/activity+json; charset=utf-8');
        headers.set('Cache-Control', 'no-store');
        headers.set('X-Testagram-Federation-Key-Fix', '1');
        return new Response(JSON.stringify(body), { status: response.status, headers });
      }
    } catch (_) {}
    return response;
  }
};
