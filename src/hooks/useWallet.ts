import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from './useAuth';

export interface Wallet {
  id: string;
  user_id: string;
  balance: number;
  currency: string;
  total_deposited: number;
  total_withdrawn: number;
  mpesa_phone: string | null;
  paypal_email: string | null;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

export interface WalletTransaction {
  id: string;
  wallet_id: string;
  user_id: string;
  type: string;
  status: string;
  amount: number;
  currency: string;
  balance_before: number | null;
  balance_after: number | null;
  provider: string | null;
  provider_reference: string | null;
  provider_status: string | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  completed_at: string | null;
  payment_method: string | null;
  reference: string | null;
}

function emptyWallet(userId: string): Wallet {
  const now = new Date().toISOString();
  return {
    id: userId,
    user_id: userId,
    balance: 0,
    currency: 'USD',
    total_deposited: 0,
    total_withdrawn: 0,
    mpesa_phone: null,
    paypal_email: null,
    created_at: now,
    updated_at: now,
  };
}

export function useWallet() {
  const { user } = useAuth();
  const [walletState, setWalletState] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWallet = useCallback(async () => {
    if (!user) { setWalletState(null); setTransactions([]); setLoading(false); return; }
    try {
      setLoading(true); setError(null);
      const { data, error: walletError } = await supabase.rpc('get_my_wallet');
      if (walletError) throw walletError;
      const row = Array.isArray(data) ? data[0] : data;
      setWalletState(row ? (row as Wallet) : emptyWallet(user.id));
    } catch (err: any) {
      console.error('Wallet error:', err);
      setError(err?.message || 'Wallet unavailable');
      // Keep wallet pages render-safe even when the wallet RPC is temporarily
      // unavailable. This is a display fallback only; writes remain guarded.
      setWalletState(emptyWallet(user.id));
    } finally { setLoading(false); }
  }, [user?.id]);

  const fetchTransactions = useCallback(async (limit = 100, offset = 0) => {
    if (!user) { setTransactions([]); return; }
    try {
      setTransactionsLoading(true);
      const { data, error: txError } = await supabase.rpc('get_my_wallet_transactions', { p_limit: limit, p_offset: offset });
      if (txError) throw txError;
      setTransactions((Array.isArray(data) ? data : []) as WalletTransaction[]);
    } catch (err: any) {
      console.error('Wallet transactions error:', err);
      setError(err?.message || 'Transaction history unavailable');
      setTransactions([]);
    } finally { setTransactionsLoading(false); }
  }, [user?.id]);

  useEffect(() => { void fetchWallet(); }, [fetchWallet]);
  useEffect(() => { void fetchTransactions(); }, [fetchTransactions]);

  const updatePaymentMethods = async (mpesaPhone: string, paypalEmail: string) => {
    if (!user) return { success: false, error: 'Not authenticated' };
    try {
      const { data, error: updateError } = await supabase.rpc('update_wallet_payment_methods', {
        p_mpesa_phone: mpesaPhone || null,
        p_paypal_email: paypalEmail || null,
      });
      if (updateError) throw updateError;
      if (data) setWalletState(data as Wallet);
      return { success: true };
    } catch (err: any) {
      console.error('Update payment methods error:', err);
      return { success: false, error: err?.message || 'Unable to update payment methods' };
    }
  };

  const refresh = useCallback(async () => {
    await Promise.all([fetchWallet(), fetchTransactions()]);
  }, [fetchWallet, fetchTransactions]);

  return {
    wallet: user ? (walletState ?? emptyWallet(user.id)) : null,
    transactions,
    loading,
    transactionsLoading,
    error,
    fetchWallet,
    fetchTransactions,
    refresh,
    updatePaymentMethods,
  };
}
