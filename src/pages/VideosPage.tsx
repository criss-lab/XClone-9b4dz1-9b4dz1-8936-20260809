import ReelsPage from '@/pages/ReelsPage';

/**
 * The primary short-video surface is now the immersive Reels experience.
 * Keep the existing /videos URL stable for bookmarks, deep links and SEO.
 */
export default function VideosPage() {
  return <ReelsPage />;
}
