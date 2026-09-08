import { useEffect, useState } from 'react';
import { ExternalLink, Loader2, WalletCards } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

export function PayPalWalletPanel() {
  const [amount, setAmount] = useState('10');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('paypal') !== 'success') return;
    const orderId = params.get('token');
    if (!orderId) return;
    let active = true;
    (async () => {
      setBusy(true);
      try {
        const { data, error } = await supabase.functions.invoke('paypal-capture-order', { body: { orderId } });
        if (error || data?.error) throw new Error(error?.message || data?.error || 'PayPal capture failed');
        if (active) toast.success('PayPal payment completed and wallet credited.');
        const url = new URL(window.location.href);
        url.searchParams.delete('paypal'); url.searchParams.delete('token'); url.searchParams.delete('PayerID');
        window.history.replaceState({}, '', url.toString());
        window.location.reload();
      } catch (e: any) { if (active) toast.error(e?.message || 'Unable to capture PayPal payment'); }
      finally { if (active) setBusy(false); }
    })();
    return () => { active = false; };
  }, []);

  const start = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 1 || value > 100000) { toast.error('Enter an amount between 1 and 100,000 USD.'); return; }
    setBusy(true);
    try {
      const returnUrl = `${window.location.origin}/wallet?paypal=success`;
      const cancelUrl = `${window.location.origin}/wallet?paypal=cancel`;
      const { data, error } = await supabase.functions.invoke('paypal-create-order', { body: { amount: value, currency: 'USD', return_url: returnUrl, cancel_url: cancelUrl } });
      if (error || data?.error) throw new Error(error?.message || data?.error || 'Unable to create PayPal order');
      if (!data?.approvalUrl) throw new Error('PayPal approval URL was not returned');
      window.location.assign(data.approvalUrl);
    } catch (e: any) { toast.error(e?.message || 'Unable to start PayPal checkout'); setBusy(false); }
  };

  return <section className="bg-card border-2 border-primary/20 rounded-2xl p-5">
    <div className="flex items-start gap-3">
      <div className="p-3 rounded-xl bg-primary/10"><WalletCards className="w-5 h-5 text-primary" /></div>
      <div className="min-w-0 flex-1"><h3 className="font-bold">Add money with PayPal</h3><p className="text-xs text-muted-foreground mt-0.5">Secure hosted PayPal checkout. Your wallet is credited only after a completed capture.</p></div>
    </div>
    <div className="mt-4 flex flex-col sm:flex-row gap-2"><input aria-label="PayPal wallet top-up amount" value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" className="h-11 flex-1 rounded-xl border border-border bg-background px-3" placeholder="10.00" /><button disabled={busy} onClick={start} className="h-11 px-5 rounded-xl bg-primary text-primary-foreground font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}{busy ? 'Opening PayPal…' : 'Continue with PayPal'}</button></div>
  </section>;
}
