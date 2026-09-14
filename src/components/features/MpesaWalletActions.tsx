import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Loader2, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import type { Wallet } from '@/hooks/useWallet';

export function MpesaWalletActions({ wallet, refresh }: { wallet: Wallet; refresh: () => Promise<void> }) {
  const [phone, setPhone] = useState(wallet.mpesa_phone || '');
  const [depositKes, setDepositKes] = useState('');
  const [withdrawKes, setWithdrawKes] = useState('');
  const [depositing, setDepositing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  const deposit = async () => {
    const amount = Math.ceil(Number(depositKes));
    if (!phone.trim()) return toast.error('Enter the M-Pesa phone number.');
    if (!Number.isFinite(amount) || amount < 10) return toast.error('Minimum M-Pesa deposit is KES 10.');
    setDepositing(true);
    try {
      const { data, error } = await supabase.functions.invoke('mpesa-stk-push', {
        body: { phone, amount, purpose: 'wallet_topup', metadata: { wallet_id: wallet.id } },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Unable to start M-Pesa deposit.');
      setDepositKes('');
      toast.success(data.customer_message || 'M-Pesa payment prompt sent. Enter your PIN to complete the deposit.');
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to start M-Pesa deposit.');
    } finally {
      setDepositing(false);
    }
  };

  const withdraw = async () => {
    const amount = Math.floor(Number(withdrawKes));
    if (!phone.trim()) return toast.error('Enter the M-Pesa phone number.');
    if (!Number.isFinite(amount) || amount < 10) return toast.error('Minimum M-Pesa withdrawal is KES 10.');
    setWithdrawing(true);
    try {
      const { data, error } = await supabase.functions.invoke('mpesa-b2c-payout', {
        body: { phone, amount, purpose: 'wallet_withdrawal', idempotency_key: crypto.randomUUID() },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Unable to start M-Pesa withdrawal.');
      setWithdrawKes('');
      toast.success(data.message || 'M-Pesa withdrawal submitted.');
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to start M-Pesa withdrawal.');
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border p-5 space-y-3">
        <div className="flex items-center gap-2 font-semibold"><Smartphone className="h-4 w-4" /> M-Pesa wallet</div>
        <p className="text-xs text-muted-foreground">Deposit in KES and receive the converted amount in your wallet. Withdrawals are sent back to M-Pesa after the wallet reserves the USD equivalent.</p>
        <Input inputMode="tel" placeholder="07XXXXXXXX" value={phone} onChange={e => setPhone(e.target.value)} />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3 rounded-xl bg-muted/30 p-4">
            <div className="flex items-center gap-2 font-semibold text-sm"><ArrowDownLeft className="h-4 w-4" /> Deposit</div>
            <Input type="number" min="10" step="1" placeholder="KES 1,000" value={depositKes} onChange={e => setDepositKes(e.target.value)} />
            <Button className="w-full" onClick={deposit} disabled={depositing}>
              {depositing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ArrowDownLeft className="h-4 w-4 mr-2" />}
              Pay with M-Pesa
            </Button>
          </div>
          <div className="space-y-3 rounded-xl bg-muted/30 p-4">
            <div className="flex items-center gap-2 font-semibold text-sm"><ArrowUpRight className="h-4 w-4" /> Withdraw</div>
            <Input type="number" min="10" step="1" placeholder="KES 1,000" value={withdrawKes} onChange={e => setWithdrawKes(e.target.value)} />
            <Button className="w-full" variant="outline" onClick={withdraw} disabled={withdrawing}>
              {withdrawing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ArrowUpRight className="h-4 w-4 mr-2" />}
              Send to M-Pesa
            </Button>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">The server applies the configured USD/KES rate. Provider callbacks, not the browser, finalize wallet credits.</p>
      </div>
    </div>
  );
}
