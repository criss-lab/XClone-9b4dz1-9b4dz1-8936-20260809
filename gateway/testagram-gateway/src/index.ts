import { Hono } from 'hono'
import { cors } from 'hono/cors'

interface Env {
  SUPABASE_GATEWAY_URL?: string
  ALLOWED_ORIGINS?: string
}

const DEFAULT_GATEWAY_URL =
  'https://aepbqfrmheihfsauzcby.supabase.co/functions/v1/gateway-relay'

const app = new Hono<{ Bindings: Env }>()

const normalizeOrigin = (value: string) => value.trim().replace(/\/$/, '')

const allowedOrigins = (env: Env): Set<string> => {
  const configured = env.ALLOWED_ORIGINS
    ?.split(',')
    .map(normalizeOrigin)
    .filter(Boolean)

  return new Set(
    configured?.length
      ? configured
      : ['https://testagram.site', 'https://www.testagram.site'],
  )
}

const isAllowedOrigin = (origin: string | undefined, env: Env): boolean => {
  if (!origin) return false
  return allowedOrigins(env).has(normalizeOrigin(origin))
}

app.use(
  '*',
  cors({
    origin: (origin, c) =>
      isAllowedOrigin(origin, c.env) ? origin : undefined,
    allowMethods: ['POST', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type', 'Accept', 'X-Request-ID'],
    exposeHeaders: ['X-Request-ID'],
    maxAge: 86400,
  }),
)

app.options('*', (c) => c.body(null, 204))

app.get('/health', (c) =>
  c.json({ ok: true, service: 'testagram-gateway' }),
)

app.post('/api/gateway', async (c) => {
  const origin = c.req.header('Origin')
  if (origin && !isAllowedOrigin(origin, c.env)) {
    return c.json({ error: 'Origin not allowed' }, 403)
  }

  const upstream = c.env.SUPABASE_GATEWAY_URL ?? DEFAULT_GATEWAY_URL
  let upstreamUrl: URL

  try {
    upstreamUrl = new URL(upstream)
  } catch {
    return c.json({ error: 'Gateway upstream is misconfigured' }, 500)
  }

  if (upstreamUrl.protocol !== 'https:') {
    return c.json({ error: 'Gateway upstream must use HTTPS' }, 500)
  }

  const headers = new Headers(c.req.raw.headers)
  headers.delete('host')
  headers.delete('origin')
  headers.delete('content-length')

  try {
    const response = await fetch(upstreamUrl, {
      method: 'POST',
      headers,
      body: c.req.raw.body,
    })

    const responseHeaders = new Headers(response.headers)
    responseHeaders.delete('set-cookie')

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    })
  } catch (error) {
    console.error('gateway upstream request failed', error)
    return c.json({ error: 'Gateway upstream unavailable' }, 502)
  }
})

app.all('*', (c) => c.json({ error: 'Not found' }, 404))

export default app
