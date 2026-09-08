from pathlib import Path
import re

HOME = Path('src/pages/HomePage.tsx')
CARD = Path('src/components/features/FederatedPostCard.tsx')
IMPORT = "import { FederatedPostCard } from '@/components/features/FederatedPostCard';\n"
ANCHOR = "import * as federation from '@/api/federation';\n"

HELPER = r'''
  // Unified For You feed: XClone-native and Fediverse posts share one ranking pool.
  const fetchUnifiedForYouFeed = async (): Promise<FeedItem[]> => {
    const [localResult, fedResult] = await Promise.allSettled([
      fetchFeed(0),
      fetchFederatedPosts(),
    ]);

    const localItems: FeedItem[] = localResult.status === 'fulfilled' ? localResult.value : [];
    const fedPosts = fedResult.status === 'fulfilled' ? fedResult.value : [];
    const fedItems: FeedItem[] = fedPosts.map((post: any) => ({
      type: 'fedpost' as const,
      data: { ...post, _unified_origin: 'fediverse' },
    }));

    const score = (item: FeedItem): number => {
      const p: any = item.data ?? {};
      const created = new Date(p.created_at ?? p.published ?? p.published_at ?? 0).getTime();
      const ageHours = Number.isFinite(created) ? Math.max(0, (Date.now() - created) / 3_600_000) : 999;
      const freshness = Math.exp(-ageHours / 18) * 40;

      if (item.type === 'fedpost') {
        const remoteRank = Number(p.platform_rank_score ?? 0);
        const likes = Number(p.favourites_count ?? p.likes_count ?? 0);
        const boosts = Number(p.reblogs_count ?? p.boosts_count ?? 0);
        const replies = Number(p.replies_count ?? 0);
        return freshness + Math.log1p(likes) * 4 + Math.log1p(boosts) * 5 + Math.log1p(replies) * 3 + remoteRank * 1.35 + 2;
      }

      return freshness +
        Math.log1p(Number(p.likes_count ?? 0)) * 5 +
        Math.log1p(Number(p.reposts_count ?? 0)) * 7 +
        Math.log1p(Number(p.replies_count ?? 0)) * 4 +
        Math.log1p(Number(p.views_count ?? 0)) * 1.5 +
        (p.is_video ? 6 : (p.image_url || p.media_urls?.length) ? 3 : 0) +
        (p.user_profiles?.verified ? 3 : 0);
    };

    return [...localItems, ...fedItems]
      .filter((item) => item.type === 'post' || item.type === 'fedpost')
      .sort((a, b) => score(b) - score(a))
      .slice(0, PAGE_SIZE);
  };
'''


def apply() -> bool:
    home = HOME.read_text()
    original = home

    if IMPORT not in home:
        if ANCHOR not in home:
            raise RuntimeError('HomePage federation import anchor not found')
        home = home.replace(ANCHOR, ANCHOR + IMPORT, 1)

    if 'const fetchUnifiedForYouFeed = async' not in home:
        marker = '\n  const fetchInitialFeed = async (skipCache = false) => {'
        if marker not in home:
            raise RuntimeError('HomePage fetchInitialFeed marker not found')
        home = home.replace(marker, HELPER + marker, 1)

    # Replace the first initial local-feed assignment inside fetchInitialFeed.
    old = "      const items = await fetchFeed(0);\n      setFeedItems(items);"
    new = "      const items = activeTab === 'foryou'\n        ? await fetchUnifiedForYouFeed()\n        : await fetchFeed(0);\n      setFeedItems(items);"
    if old in home:
        home = home.replace(old, new, 1)

    # Remove the old read-only inline card; the dedicated component is interactive.
    start_marker = '// ── Federated Post Card ───────────────────────────────────────────────────────'
    end_marker = '// ── Inline Suggestions ────────────────────────────────────────────────────────'
    start = home.find(start_marker)
    if start >= 0:
        end = home.find(end_marker, start)
        if end < 0:
            raise RuntimeError('Inline Suggestions marker not found after old Fediverse card')
        home = home[:start] + home[end:]

    if home != original:
        HOME.write_text(home)
        return True
    return False


if __name__ == '__main__':
    if not CARD.exists():
        raise RuntimeError('FederatedPostCard.tsx is missing; source must be committed separately')
    print('fediverse-unified:', 'changed' if apply() else 'already applied')
