import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Loader2, WalletCards } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import type { Wallet } from '@/hooks/useWallet';

const PAYPAL_API = (import.meta.env.VITE_PAYPAL_API_URL || 'https://testagram-api.nahashonnyaga794.workers.dev').replace(/\/$/, '');

async function paypalRequest(path: string, options: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Please sign in again.');
  const response = await fetch(`${PAYPAL_API}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `PayPal request failed (${response.status})`);
  return body;
}

export function PayPalWalletActions({ wallet, refresh }: { wallet: Wallet; refresh: () => Promise<void> }) {
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [depositing, setDepositing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('token') || params.get('paypal_order_id');
    if (!orderId) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await paypalRequest(`/api/paypal/orders/${encodeURIComponent(orderId)}/capture`, { method: 'POST', body: '{}' });
        if (!cancelled) toast.success(result.idempotent ? 'PayPal payment already credited.' : 'PayPal deposit credited to your wallet.');
        if (!cancelled) await refresh();
      } catch (error) {
        if (!cancelled) toast.error(error instanceof Error ? error.message : 'PayPal payment could not be captured.');
      } finally {
        const clean = new URL(window.location.href);
        clean.searchParams.delete('token');
        clean.searchParams.delete('PayerID');
        clean.searchParams.delete('paypal_order_id');
        window.history.replaceState({}, '', clean.toString());
      }
    })();
    return () => { cancelled = true; };
  }, [refresh]);

  const deposit = async () => {
    const amount = Number(depositAmount);
    if (!Number.isFinite(amount) || amount <= 0) return toast.error('Enter a valid USD deposit amount.');
    setDepositing(true);
    try {
      const returnUrl = new URL(window.location.href).toString();
      const cancelUrl = new URL(window.location.href).toString();
      const result = await paypalRequest('/api/paypal/orders', { method: 'POST', body: JSON.stringify({ amount, currency: 'USD', return_url: returnUrl, cancel_url: cancelUrl }) });
      if (!result.approval_url) throw new Error('PayPal approval URL was not returned.');
      window.location.assign(result.approval_url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to start PayPal deposit.');
      setDepositing(false);
    }
  };

  const withdraw = async () => {
    const amount = Number(withdrawAmount);
    if (!Number.isFinite(amount) || amount <= 0) return toast.error('Enter a valid USD withdrawal amount.');
    if (amount > Number(wallet.balance || 0)) return toast.error('Insufficient wallet balance.');
    if (!wallet.paypal_email) return toast.error('Add your PayPal email in payment methods first.');
    setWithdrawing(true);
    try {
      await paypalRequest('/api/paypal/withdrawals', { method: 'POST', body: JSON.stringify({ amount }) });
      toast.success('PayPal withdrawal submitted. Your balance was reserved and will be refunded automatically if PayPal rejects the payout.');
      setWithdrawAmount('');
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to start PayPal withdrawal.');
    } finally { setWithdrawing(false); }
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-2xl border p-5 space-y-3">
        <div className="flex items-center gap-2 font-semibold"><ArrowDownLeft className="h-4 w-4" /> PayPal Deposit</div>
        <p className="text-xs text-muted-foreground">Pay securely in USD. The wallet is credited only after PayPal reports a completed capture.</p>
        <Input type="number" min="0.01" step="0.01" placeholder="10.00" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} />
        <Button className="w-full" onClick={deposit} disabled={depositing}>
          {depositing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <WalletCards className="h-4 w-4 mr-2" />}
          Continue with PayPal
        </Button>
      </div>
      <div className="rounded-2xl border p-5 space-y-3">
        <div className="flex items-center gap-2 font-semibold"><ArrowUpRight className="h-4 w-4" /> PayPal Withdrawal</div>
        <p className="text-xs text-muted-foreground">Withdraw to <strong>{wallet.paypal_email || 'your PayPal email'}</strong>. Funds are atomically reserved before payout.</p>
        <Input type="number" min="0.01" step="0.01" max={wallet.balance} placeholder="10.00" value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)} />
        <Button className="w-full" variant="outline" onClick={withdraw} disabled={withdrawing}>
          {withdrawing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ArrowUpRight className="h-4 w-4 mr-2" />}
          Withdraw with PayPal
        </Button>
      </div>
    </div>
  );
}
