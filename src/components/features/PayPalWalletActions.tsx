import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, Loader2, Mail, WalletCards } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { FunctionsHttpError } from '@supabase/supabase-js';
import type { Wallet } from '@/hooks/useWallet';

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

async function functionErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof FunctionsHttpError)) {
    return error instanceof Error ? error.message : fallback;
  }

  try {
    const text = await error.context.text();
    const body = JSON.parse(text);
    return body?.detail || body?.error || error.message || fallback;
  } catch {
    return error.message || fallback;
  }
}

function validEmail(value: string) {
  return value.length <= 254 && EMAIL_RE.test(value.trim().toLowerCase());
}

export function PayPalWalletActions({ wallet, refresh }: { wallet: Wallet; refresh: () => Promise<void> }) {
  const [paypalEmail, setPaypalEmail] = useState(wallet.paypal_email || '');
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [depositing, setDepositing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  useEffect(() => {
    setPaypalEmail(wallet.paypal_email || '');
  }, [wallet.paypal_email]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('token') || params.get('paypal_order_id');
    if (!orderId) return;

    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('paypal-capture-order', {
          body: { orderId },
        });
        if (error) throw new Error(await functionErrorMessage(error, 'PayPal payment could not be captured.'));
        if (data?.error) throw new Error(data.detail || data.error);

        if (!cancelled) {
          toast.success(data?.alreadyCaptured || data?.wallet?.idempotent
            ? 'PayPal payment was already credited.'
            : 'PayPal payment completed and wallet credited.');
          await refresh();
        }
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

  const saveEmail = async () => {
    const email = paypalEmail.trim().toLowerCase();
    if (!validEmail(email)) {
      toast.error('Enter a valid PayPal email address.');
      return false;
    }

    setSavingEmail(true);
    try {
      const { data, error } = await supabase.rpc('update_wallet_payment_methods', {
        p_mpesa_phone: wallet.mpesa_phone || null,
        p_paypal_email: email,
      });
      if (error) throw error;
      if (!data) throw new Error('PayPal email could not be saved.');
      setPaypalEmail(email);
      await refresh();
      toast.success('PayPal email saved.');
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save PayPal email.');
      return false;
    } finally {
      setSavingEmail(false);
    }
  };

  const deposit = async () => {
    const amount = Number(depositAmount);
    const email = paypalEmail.trim().toLowerCase();

    if (!validEmail(email)) {
      toast.error('Enter and save your PayPal email before continuing.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
      toast.error('Enter a valid USD deposit amount between $1 and $100,000.');
      return;
    }

    setDepositing(true);
    try {
      const saved = email === (wallet.paypal_email || '').trim().toLowerCase()
        ? true
        : await saveEmail();
      if (!saved) return;

      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.delete('token');
      currentUrl.searchParams.delete('PayerID');
      currentUrl.searchParams.delete('paypal_order_id');
      const returnUrl = currentUrl.toString();

      const { data, error } = await supabase.functions.invoke('paypal-create-order', {
        body: {
          amount,
          currency: 'USD',
          paypal_email: email,
          return_url: returnUrl,
          cancel_url: returnUrl,
        },
      });

      if (error) {
        throw new Error(await functionErrorMessage(error, 'Unable to create PayPal order.'));
      }
      if (data?.error) throw new Error(data.detail || data.error);
      if (!data?.approvalUrl) throw new Error('PayPal approval URL was not returned.');

      window.location.assign(data.approvalUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to start PayPal deposit.');
      setDepositing(false);
    }
  };

  const withdraw = async () => {
    const amount = Number(withdrawAmount);
    const email = paypalEmail.trim().toLowerCase();

    if (!validEmail(email)) {
      toast.error('Enter a valid PayPal email address first.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid USD withdrawal amount.');
      return;
    }
    if (amount > Number(wallet.balance || 0)) {
      toast.error('Insufficient wallet balance.');
      return;
    }

    setWithdrawing(true);
    try {
      if (email !== (wallet.paypal_email || '').trim().toLowerCase()) {
        const saved = await saveEmail();
        if (!saved) return;
      }

      toast.error('PayPal withdrawals require the payout service to be enabled for this account.');
    } finally {
      setWithdrawing(false);
    }
  };

  const emailChanged = paypalEmail.trim().toLowerCase() !== (wallet.paypal_email || '').trim().toLowerCase();

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-2xl border p-5 space-y-3">
        <div className="flex items-center gap-2 font-semibold">
          <ArrowDownLeft className="h-4 w-4" /> PayPal Deposit
        </div>
        <p className="text-xs text-muted-foreground">
          Enter your PayPal email first. Testagram uses it as your saved PayPal wallet identity; payment approval happens securely on PayPal.
        </p>
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2" htmlFor="paypal-email">
            <Mail className="h-4 w-4" /> PayPal email
          </label>
          <Input
            id="paypal-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={paypalEmail}
            onChange={(event) => setPaypalEmail(event.target.value)}
            onBlur={() => { if (paypalEmail.trim()) void saveEmail(); }}
            disabled={savingEmail || depositing}
          />
          {validEmail(paypalEmail.trim().toLowerCase()) && !emailChanged && (
            <p className="text-xs text-green-600 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> PayPal email saved
            </p>
          )}
          {emailChanged && validEmail(paypalEmail.trim().toLowerCase()) && (
            <Button type="button" variant="outline" size="sm" onClick={() => void saveEmail()} disabled={savingEmail}>
              {savingEmail && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save PayPal email
            </Button>
          )}
        </div>
        <Input
          type="number"
          min="1"
          max="100000"
          step="0.01"
          placeholder="10.00"
          value={depositAmount}
          onChange={(event) => setDepositAmount(event.target.value)}
          disabled={depositing}
          aria-label="PayPal deposit amount in USD"
        />
        <Button className="w-full" onClick={() => void deposit()} disabled={depositing || savingEmail || !validEmail(paypalEmail.trim().toLowerCase())}>
          {depositing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <WalletCards className="h-4 w-4 mr-2" />}
          {depositing ? 'Opening PayPal…' : 'Continue with PayPal'}
        </Button>
      </div>

      <div className="rounded-2xl border p-5 space-y-3">
        <div className="flex items-center gap-2 font-semibold">
          <ArrowUpRight className="h-4 w-4" /> PayPal Withdrawal
        </div>
        <p className="text-xs text-muted-foreground">
          Withdrawals use the saved PayPal email: <strong>{wallet.paypal_email || paypalEmail || 'not set'}</strong>.
        </p>
        <Input
          type="number"
          min="0.01"
          step="0.01"
          max={wallet.balance}
          placeholder="10.00"
          value={withdrawAmount}
          onChange={(event) => setWithdrawAmount(event.target.value)}
          disabled={withdrawing}
          aria-label="PayPal withdrawal amount in USD"
        />
        <Button className="w-full" variant="outline" onClick={() => void withdraw()} disabled={withdrawing || !validEmail(paypalEmail.trim().toLowerCase())}>
          {withdrawing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ArrowUpRight className="h-4 w-4 mr-2" />}
          Withdraw with PayPal
        </Button>
      </div>
    </div>
  );
}
