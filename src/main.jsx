import { createRoot } from 'react-dom/client';
import './index.css';
import { AppBootBoundary } from './components/layout/AppBootBoundary';
import { AuthProvider } from './components/layout/AuthProvider';
import './lib/platformReels';

const container = document.getElementById('root');
if (!container) throw new Error('Testagram root element is missing');

function canonicalizeLegacyLocalPostUrl() {
  const match = window.location.pathname.match(/^\/post\/local:([^/]+)$/);
  if (!match) return;
  const canonical = `/post/${match[1]}${window.location.search}${window.location.hash}`;
  window.history.replaceState(window.history.state, '', canonical);
}
canonicalizeLegacyLocalPostUrl();

const root = createRoot(container);

document.addEventListener('click', event => {
  const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!target) return;
  const href = target.getAttribute('href');
  if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
  let url;
  try { url = new URL(href, window.location.href); } catch { return; }

  if (url.origin === window.location.origin) {
    const legacy = url.pathname.match(/^\/post\/local:([^/]+)$/);
    if (legacy) {
      event.preventDefault();
      event.stopPropagation();
      window.history.pushState(window.history.state, '', `/post/${legacy[1]}${url.search}${url.hash}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
    return;
  }

  const label = (target.textContent || target.getAttribute('aria-label') || '').trim().toLowerCase();
  const inFediverseArea = window.location.pathname.startsWith('/fediverse');
  const looksLikeOriginAction = label.includes('open on origin') || label.includes('view on origin');
  if (!inFediverseArea && !looksLikeOriginAction) return;

  // Do not hijack remote actor/profile links. They must be allowed to open the
  // canonical profile or the new in-app /fediverse/profile route.
  if (target.getAttribute('data-fediverse-profile') === 'true' || url.pathname.startsWith('/fediverse/profile')) return;

  event.preventDefault();
  event.stopPropagation();
  const internal = `/fediverse/post?url=${encodeURIComponent(url.toString())}`;
  window.location.assign(internal);
}, true);

function renderBootError(error) {
  console.error('[Testagram boot] Module load failure', error);
  const message = error instanceof Error ? error.message : String(error);
  const safe = message.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  container.innerHTML = `<main class="min-h-screen bg-background text-foreground flex items-center justify-center p-6"><section class="w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-xl"><div class="text-3xl mb-3">⚠️</div><h1 class="text-xl font-black">Testagram could not load</h1><p class="mt-2 text-sm text-muted-foreground">A production JavaScript module failed before React could start.</p><pre class="mt-4 max-h-40 overflow-auto rounded-xl bg-muted p-3 text-xs whitespace-pre-wrap break-words">${safe}</pre><button onclick="location.reload()" class="mt-5 w-full rounded-xl bg-primary px-4 py-3 font-bold text-primary-foreground">Reload Testagram</button></section></main>`;
}

import('./App')
  .then(async ({ default: App }) => {
    const isRemoteProfile = window.location.pathname === '/fediverse/profile';
    if (isRemoteProfile) {
      const { default: FediverseProfilePage } = await import('./pages/FediverseProfilePage');
      root.render(<AppBootBoundary><AuthProvider><FediverseProfilePage /></AuthProvider></AppBootBoundary>);
      return;
    }
    root.render(<AppBootBoundary><App /></AppBootBoundary>);
    import('./components/features/WalletPayPalOverlay')
      .then(({ default: WalletPayPalOverlay }) => {
        const host = document.createElement('div');
        host.id = 'testagram-wallet-overlay';
        document.body.appendChild(host);
        createRoot(host).render(<WalletPayPalOverlay />);
      })
      .catch(error => console.warn('[Testagram wallet] Optional wallet UI disabled:', error));
  })
  .catch(renderBootError);
