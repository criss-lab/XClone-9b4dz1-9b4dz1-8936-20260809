type FediverseStatus = {
  id?: string;
  uri?: string;
  url?: string;
  created_at?: string;
  published?: string;
  content?: string;
  text?: string;
  visibility?: string;
  sensitive?: boolean;
  spoiler_text?: string;
  reblogs_count?: number;
  favourites_count?: number;
  replies_count?: number;
  quotes_count?: number;
  media_attachments?: unknown[];
  account?: Record<string, unknown>;
  actor?: Record<string, unknown>;
};

const DEFAULT_INSTANCES = [
  'mastodon.social',
  'mastodon.online',
  'mstdn.social',
];

const json = (body: unknown, status = 200, cache = false) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': cache
      ? 'public, s-maxage=45, stale-while-revalidate=180'
      : 'private, max-age=5',
    'x-content-type-options': 'nosniff',
    'vary': 'Authorization',
  },
});

function scoreStatus(status: FediverseStatus): number {
  const created = new Date(status.created_at ?? status.published ?? 0).getTime();
  const ageHours = Math.max(0, (Date.now() - created) / 3_600_000);
  const freshness = 48 * Math.exp(-ageHours / 18);
  const engagement =
    Math.log1p(status.favourites_count ?? 0) * 5.5 +
    Math.log1p(status.reblogs_count ?? 0) * 7 +
    Math.log1p(status.replies_count ?? 0) * 4 +
    Math.log1p(status.quotes_count ?? 0) * 3;
  const media = (status.media_attachments?.length ?? 0) > 0 ? 5 : 0;
  const account = status.account ?? status.actor ?? {};
  const verified = Array.isArray((account as any)?.fields)
    && (account as any).fields.some((f: any) => f?.verified_at);
  const quality = verified ? 3 : 0;
  return Number((freshness + engagement + media + quality).toFixed(4));
}

function normalize(status: FediverseStatus, instance?: string) {
  const actor = status.account ?? status.actor ?? {};
  const url = status.url ?? status.uri ?? status.id ?? '';
  const actorUrl = (actor as any)?.url ?? '';
  let domain = instance ?? '';
  try { domain = new URL(actorUrl || url).hostname || domain; } catch {}

  return {
    ...status,
    id: status.id ?? status.uri ?? status.url,
    url,
    created_at: status.created_at ?? status.published ?? new Date().toISOString(),
    content: status.content ?? status.text ?? '',
    actor,
    source: 'fediverse',
    fediv: true,
    fediverse_domain: domain,
    platform_rank_score: scoreStatus(status),
  };
}

async function fetchJson(url: string, headers: HeadersInit = {}) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', ...headers },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`upstream ${response.status}`);
  return response.json();
}

async function fetchGateway(baseUrl: string, anonKey: string, authorization: string, limit: number) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/functions/v1/gateway-relay`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      apikey: anonKey,
      Authorization: authorization,
    },
    body: JSON.stringify({
      path: '/timeline/home',
      method: 'GET',
      params: { limit: String(Math.min(limit, 40)) },
    }),
  });
  if (!response.ok) throw new Error(`gateway ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload) ? payload : payload?.posts ?? payload?.data ?? [];
}

async function fetchPublicInstances(instances: string[], limit: number) {
  const perInstance = Math.min(20, Math.max(6, Math.ceil(limit / Math.max(1, instances.length)) + 4));
  const results = await Promise.allSettled(instances.map(async (host) => {
    const url = `https://${host}/api/v1/timelines/public?remote=true&limit=${perInstance}`;
    const data = await fetchJson(url);
    return (Array.isArray(data) ? data : []).map((item) => normalize(item, host));
  }));
  return results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
}

export const config = { runtime: 'edge' };

export default async function handler(request: Request) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get('limit') ?? '20');
  const limit = Math.min(40, Math.max(6, Number.isFinite(requestedLimit) ? requestedLimit : 20));
  const authorization = request.headers.get('authorization') ?? '';
  const hasUserToken = /^Bearer\s+\S+$/i.test(authorization);

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

  let statuses: any[] = [];
  let personalized = false;

  // Authenticated users get their federated home timeline through the existing gateway.
  // This keeps private/followed federation data behind the user's Supabase JWT.
  if (hasUserToken && supabaseUrl && supabaseAnonKey) {
    try {
      statuses = (await fetchGateway(supabaseUrl, supabaseAnonKey, authorization, limit)).map((item: FediverseStatus) => normalize(item));
      personalized = true;
    } catch {
      statuses = [];
    }
  }

  // Public fallback: pull remote public posts from several Mastodon instances in parallel.
  if (statuses.length === 0) {
    const configured = (process.env.FEDIVERSE_INSTANCES || '')
      .split(',')
      .map((host) => host.trim().replace(/^https?:\/\//, '').replace(/\/$/, ''))
      .filter(Boolean);
    const instances = configured.length > 0 ? configured.slice(0, 8) : DEFAULT_INSTANCES;
    try {
      statuses = await fetchPublicInstances(instances, limit);
    } catch {
      statuses = [];
    }
  }

  const deduped = new Map<string, any>();
  for (const status of statuses) {
    const normalized = status.fediv ? status : normalize(status);
    if (normalized.visibility && normalized.visibility !== 'public') continue;
    if (normalized.sensitive) continue;
    const key = normalized.url || normalized.uri || normalized.id;
    if (!key) continue;
    const previous = deduped.get(key);
    if (!previous || normalized.platform_rank_score > previous.platform_rank_score) deduped.set(key, normalized);
  }

  const ranked = [...deduped.values()]
    .sort((a, b) => b.platform_rank_score - a.platform_rank_score)
    .slice(0, limit);

  return json({
    posts: ranked,
    source: personalized ? 'gateway' : 'public-federated',
    ranked_by: 'testagram-platform',
    fetched_at: new Date().toISOString(),
  }, 200, !hasUserToken);
}
