import { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, Loader2, Wallet, History } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

interface WalletRow { id: string; balance: number; currency: string; }
interface TxRow { id: string; type: string; status: string; amount: number; currency: string; description: string | null; created_at: string; }

export function WalletCard({ username }: { username: string }) {
  const [wallet, setWallet] = useState<WalletRow | null>(null);
  const [transactions, setTransactions] = useState<TxRow[]>([]);
  const [amount, setAmount] = useState('10');
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user?.id;
      if (!userId) return;

      // Profile creation now provisions a wallet, but this keeps the UI safe for
      // legacy accounts created before the wallet trigger was installed.
      await supabase.rpc('ensure_user_wallet', { p_user_id: userId, p_currency: 'USD' });

      const [{ data: w, error: we }, { data: tx, error: te }] = await Promise.all([
        supabase.from('wallets').select('id,balance,currency').eq('user_id', userId).maybeSingle(),
        supabase.from('wallet_transactions').select('id,type,status,amount,currency,description,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(8),
      ]);
      if (we) throw we;
      if (te) throw te;
      setWallet(w as WalletRow | null);
      setTransactions((tx ?? []) as TxRow[]);
    } catch (e: any) {
      toast.error(e?.message || 'Unable to load wallet');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('token');
    if (!orderId || params.get('paypal') !== 'success') return;
    let active = true;
    (async () => {
      setPaying(true);
      try {
        const { data, error } = await supabase.functions.invoke('paypal-capture-order', { body: { orderId } });
        if (error || data?.error) throw new Error(error?.message || data?.error || 'PayPal capture failed');
        if (active) toast.success('PayPal payment completed and wallet credited.');
        await load();
        const url = new URL(window.location.href);
        url.searchParams.delete('token'); url.searchParams.delete('PayerID'); url.searchParams.delete('paypal');
        window.history.replaceState({}, '', url.toString());
      } catch (e: any) { if (active) toast.error(e?.message || 'Payment capture failed'); }
      finally { if (active) setPaying(false); }
    })();
    return () => { active = false; };
  }, [load]);

  const startTopUp = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 1 || value > 100000) { toast.error('Enter an amount between 1 and 100,000.'); return; }
    setPaying(true);
    try {
      const { data, error } = await supabase.functions.invoke('paypal-create-order', {
        body: {
          amount: value,
          currency: wallet?.currency || 'USD',
          return_url: `${window.location.origin}/profile/${encodeURIComponent(username)}?paypal=success`,
          cancel_url: `${window.location.origin}/profile/${encodeURIComponent(username)}?paypal=cancel`,
        },
      });
      if (error || data?.error) throw new Error(error?.message || data?.error || 'Could not create PayPal order');
      if (!data?.approvalUrl) throw new Error('PayPal approval URL was not returned');
      window.location.assign(data.approvalUrl);
    } catch (e: any) {
      toast.error(e?.message || 'Unable to start PayPal checkout');
      setPaying(false);
    }
  };

  if (loading) return <div className="mx-4 sm:mx-6 mb-5 rounded-2xl border border-border p-5 flex items-center gap-3 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" />Loading wallet…</div>;

  return <section className="mx-4 sm:mx-6 mb-5 rounded-2xl border border-border bg-card overflow-hidden">
    <div className="p-5 bg-gradient-to-br from-primary/10 to-transparent">
      <div className="flex items-center justify-between gap-4">
        <div><div className="flex items-center gap-2 text-sm text-muted-foreground"><Wallet className="w-4 h-4" />Wallet</div><div className="mt-1 text-3xl font-black tabular-nums">{Number(wallet?.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-base font-semibold text-muted-foreground">{wallet?.currency || 'USD'}</span></div></div>
        <div className="text-right text-xs text-muted-foreground">Real balance<br/>settled by PayPal</div>
      </div>
      <div className="mt-5 flex flex-col sm:flex-row gap-2">
        <input aria-label="Wallet top up amount" value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" className="h-11 flex-1 rounded-xl border border-border bg-background px-3 outline-none focus:ring-2 focus:ring-primary/30" placeholder="Amount" />
        <button disabled={paying} onClick={startTopUp} className="h-11 px-5 rounded-xl bg-primary text-primary-foreground font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60"><ArrowDownToLine className="w-4 h-4" />{paying ? 'Opening PayPal…' : 'Add money with PayPal'}</button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">You will be redirected to PayPal to approve the payment. Testagram only credits the wallet after PayPal reports a completed capture.</p>
    </div>
    <div className="p-5 border-t border-border">
      <div className="flex items-center gap-2 font-semibold text-sm mb-3"><History className="w-4 h-4" />Recent transactions</div>
      {transactions.length ? <div className="divide-y divide-border">{transactions.map(tx => <div key={tx.id} className="py-2.5 flex items-center justify-between gap-4 text-sm"><div><div className="font-medium capitalize">{tx.type}</div><div className="text-xs text-muted-foreground">{new Date(tx.created_at).toLocaleString()} · {tx.status}</div></div><div className={`font-bold tabular-nums ${tx.type === 'deposit' && tx.status === 'completed' ? 'text-emerald-600' : ''}`}>{tx.type === 'deposit' ? '+' : '-'}{Number(tx.amount).toFixed(2)} {tx.currency}</div></div>)}</div> : <p className="text-sm text-muted-foreground">No transactions yet.</p>}
    </div>
  </section>;
}
