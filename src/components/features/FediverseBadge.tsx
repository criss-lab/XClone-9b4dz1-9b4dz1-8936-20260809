import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Globe, Copy, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';

interface FediverseBadgeProps { username: string; remoteFollowers?: number; compact?: boolean; }

const ORIGIN_LABEL = /^(open\s+(on|at)\s+origin|open\s+original|view\s+on\s+origin|view\s+original|open\s+source)$/i;

function scrubOriginLinks() {
  document.querySelectorAll('a,button').forEach(node => {
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (ORIGIN_LABEL.test(text)) {
      const anchor = node as HTMLAnchorElement;
      if (anchor.tagName === 'A') {
        anchor.removeAttribute('href');
        anchor.removeAttribute('target');
        anchor.removeAttribute('rel');
        anchor.style.display = 'none';
      } else {
        (node as HTMLElement).style.display = 'none';
      }
    }
  });
}

function isExternalPostLink(anchor: HTMLAnchorElement): boolean {
  if (!anchor.href || !/^https?:\/\//i.test(anchor.href)) return false;
  if (anchor.dataset.fediverseProfile === 'true') return false;
  if (anchor.closest('[data-fediverse-canonical-profile="true"]')) return false;
  return anchor.target === '_blank' || anchor.rel.includes('noopener');
}

export function FediverseBadge({ username, remoteFollowers = 0, compact = false }: FediverseBadgeProps) {
  const [copied, setCopied] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const handle = `@${username}@testagram.site`;

  useEffect(() => {
    if (!location.pathname.startsWith('/fediverse')) return;
    scrubOriginLinks();
    const observer = new MutationObserver(scrubOriginLinks);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a') as HTMLAnchorElement | null;
      if (!anchor || !isExternalPostLink(anchor)) return;
      const href = anchor.href;
      if (!href || href.startsWith(window.location.origin)) return;
      event.preventDefault();
      event.stopPropagation();
      navigate(`/fediverse/post?url=${encodeURIComponent(href)}`);
    };
    document.addEventListener('click', onClick, true);
    return () => { observer.disconnect(); document.removeEventListener('click', onClick, true); };
  }, [location.pathname, navigate]);

  const handleCopy = () => {
    navigator.clipboard.writeText(handle).then(() => { setCopied(true); toast.success('Fediverse handle copied!'); setTimeout(() => setCopied(false), 2000); });
  };

  if (compact) return <button onClick={handleCopy} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20 transition-colors text-xs font-medium text-purple-600 dark:text-purple-400"><Globe className="w-3 h-3" /><span className="hidden sm:inline">{handle}</span><span className="sm:hidden">Fediverse</span>{copied ? <CheckCircle className="w-3 h-3" /> : <Copy className="w-3 h-3 opacity-60" />}</button>;
  return <div className="flex items-center gap-2 p-3 bg-gradient-to-r from-purple-500/5 to-blue-500/5 border border-purple-500/15 rounded-xl"><div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center shrink-0"><Globe className="w-4 h-4 text-purple-500" /></div><div className="flex-1 min-w-0"><p className="text-xs font-semibold text-purple-600 dark:text-purple-400">Fediverse Identity</p><p className="text-xs text-muted-foreground font-mono truncate">{handle}</p>{remoteFollowers > 0 && <p className="text-xs text-muted-foreground">{remoteFollowers} remote followers</p>}</div><button onClick={handleCopy} className="p-2 hover:bg-purple-500/10 rounded-full transition-colors shrink-0">{copied ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-muted-foreground" />}</button></div>;
}
