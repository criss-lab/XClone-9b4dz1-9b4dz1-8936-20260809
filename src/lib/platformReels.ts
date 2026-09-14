// Platform-wide video handoff: ordinary videos keep their native controls,
// while a double-click opens the same immersive Reels player used by /videos.
if (typeof document !== 'undefined') {
  document.addEventListener('dblclick', event => {
    const target = event.target as HTMLElement | null;
    const video = target?.closest('video');
    if (!(video instanceof HTMLVideoElement)) return;
    const src = video.currentSrc || video.src;
    if (!src || window.location.pathname === '/videos') return;
    const url = new URL('/videos', window.location.origin);
    url.searchParams.set('start', src);
    window.location.assign(url.toString());
  }, true);
}
