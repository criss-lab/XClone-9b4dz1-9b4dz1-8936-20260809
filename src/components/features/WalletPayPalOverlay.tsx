import { useEffect, useState } from 'react';
import { ExternalLink, Loader2, RefreshCw, WalletCards, X, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

type State = { balance: number | string; currency: string; username?: string; displayName?: string; avatar?: string };

function usePathname() {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const update = () => setPathname(window.location.pathname);
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    const emit = () => window.dispatchEvent(new Event('testagram:navigation'));

    window.history.pushState = function (...args) {
      originalPushState.apply(this, args);
      emit();
    };
    window.history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      emit();
    };

    window.addEventListener('popstate', update);
    window.addEventListener('testagram:navigation', update);
    update();

    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener('popstate', update);
      window.removeEventListener('testagram:navigation', update);
    };
  }, []);

  return pathname;
}

export default function WalletPayPalOverlay() {
  const pathname = usePathname();
  const [open, setOpen] = useState(true);
  const [state, setState] = useState<State | null>(null);
  const [amount, setAmount] = useState('10');
  const [currency, setCurrency] = useState('USD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    if (pathname !== '/wallet') return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setState(null);
      return;
    }
    try {
      const { data, error } = await supabase.functions.invoke('wallet-paypal', { body: { action: 'wallet' } });
      if (error || data?.error) throw new Error(error?.message || data?.error);
      setState({
        balance: data.wallet.balance,
        currency: data.wallet.currency,
        username: data.profile?.username,
        displayName: data.profile?.display_name,
        avatar: data.profile?.avatar_url,
      });
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Wallet service unavailable');
    }
  };

  useEffect(() => {
    if (pathname !== '/wallet') return;
    void load();
  }, [pathname]);

  useEffect(() => {
    if (pathname !== '/wallet') return;
    const p = new URLSearchParams(window.location.search);
    if (p.get('paypal') !== 'success') return;
    const key = Object.keys(localStorage).find(k => k.startsWith('testagram-paypal-order-'));
    const id = key ? localStorage.getItem(key) : null;
    if (!id) return;

    localStorage.removeItem(key);
    setBusy(true);
    supabase.functions.invoke('wallet-paypal', { body: { action: 'capture_order', orderId: id } })
      .then(({ data, error }) => {
        if (error || data?.error) throw new Error(error?.message || data?.error);
        toast.success('PayPal payment captured.');
        void load();
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Payment capture failed'))
      .finally(() => setBusy(false));
  }, [pathname]);

  if (pathname !== '/wallet' || !open || !state) return null;

  const start = async () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0 || n > 10000) {
      setError('Enter an amount between 1 and 10,000.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const { data, error } = await supabase.functions.invoke('wallet-paypal', {
        body: { action: 'create_order', amount: n, currency },
      });
      if (error || data?.error) throw new Error(error?.message || data?.error);
      const userId = (await supabase.auth.getUser()).data.user?.id;
      if (!userId) throw new Error('You must be signed in to start PayPal checkout.');
      localStorage.setItem(`testagram-paypal-order-${userId}`, data.orderId);
      window.location.assign(data.approvalUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start PayPal checkout');
      setBusy(false);
    }
  };

  return (
    <div className="fixed z-[500] bottom-24 right-3 w-[min(360px,calc(100vw-24px))] rounded-3xl border border-border bg-card shadow-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-black">PayPal Wallet</div>
          <div className="text-xs text-muted-foreground">{state.displayName || state.username || 'Your profile'} · @{state.username || 'user'}</div>
        </div>
        <button onClick={() => setOpen(false)} className="p-2 rounded-xl hover:bg-muted"><X className="h-4 w-4" /></button>
      </div>
      <div className="rounded-2xl bg-primary/10 p-3">
        <div className="text-xs text-muted-foreground">Real ledger balance</div>
        <div className="text-2xl font-black">{state.currency} {Number(state.balance).toFixed(2)}</div>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" className="h-10 rounded-xl border border-border bg-background px-3" />
        <select value={currency} onChange={e => setCurrency(e.target.value)} className="h-10 rounded-xl border border-border bg-background px-2">
          <option>USD</option><option>EUR</option><option>GBP</option>
        </select>
      </div>
      <button onClick={() => void start()} disabled={busy} className="w-full h-11 rounded-xl bg-[#ffc439] text-black font-black flex items-center justify-center gap-2">
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <><WalletCards className="h-5 w-5" /> Add with PayPal <ExternalLink className="h-4 w-4" /></>}
      </button>
      {error && <div className="flex gap-2 text-xs text-destructive"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}
      <button onClick={() => void load()} className="text-xs text-muted-foreground flex items-center gap-1"><RefreshCw className="h-3 w-3" /> Refresh balance</button>
    </div>
  );
}
