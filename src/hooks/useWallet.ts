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

export function useWallet() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWallet = useCallback(async () => {
    if (!user) { setWallet(null); setTransactions([]); setLoading(false); return; }
    try {
      setLoading(true); setError(null);
      const { data, error: walletError } = await supabase.rpc('get_my_wallet');
      if (walletError) throw walletError;
      setWallet((data as Wallet) || null);
    } catch (err: any) {
      console.error('Wallet error:', err);
      setError(err?.message || 'Wallet unavailable');
      setWallet(null);
    } finally { setLoading(false); }
  }, [user?.id]);

  const fetchTransactions = useCallback(async (limit = 100, offset = 0) => {
    if (!user) { setTransactions([]); return; }
    try {
      setTransactionsLoading(true);
      const { data, error: txError } = await supabase.rpc('get_my_wallet_transactions', { p_limit: limit, p_offset: offset });
      if (txError) throw txError;
      setTransactions((data as WalletTransaction[]) || []);
    } catch (err: any) {
      console.error('Wallet transactions error:', err);
      setError(err?.message || 'Transaction history unavailable');
      setTransactions([]);
    } finally { setTransactionsLoading(false); }
  }, [user?.id]);

  useEffect(() => { void fetchWallet(); }, [fetchWallet]);
  useEffect(() => { void fetchTransactions(); }, [fetchTransactions]);

  const updatePaymentMethods = async (mpesaPhone: string, paypalEmail: string) => {
    if (!user || !wallet) return { success: false, error: 'No wallet found' };
    try {
      const { data, error: updateError } = await supabase.rpc('update_wallet_payment_methods', {
        p_mpesa_phone: mpesaPhone || null,
        p_paypal_email: paypalEmail || null,
      });
      if (updateError) throw updateError;
      setWallet(data as Wallet);
      return { success: true };
    } catch (err: any) {
      console.error('Update payment methods error:', err);
      return { success: false, error: err?.message || 'Unable to update payment methods' };
    }
  };

  const refresh = useCallback(async () => {
    await Promise.all([fetchWallet(), fetchTransactions()]);
  }, [fetchWallet, fetchTransactions]);

  return { wallet, transactions, loading, transactionsLoading, error, fetchWallet, fetchTransactions, refresh, updatePaymentMethods };
}
