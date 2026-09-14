import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import { toast } from 'sonner';
import { ArrowDownToLine, ArrowUpRight, BarChart3, BadgeCheck, CheckCircle2, Clock3, CreditCard, DollarSign, Gift, Loader2, Megaphone, RefreshCw, ShieldCheck, Sparkles, Users, WalletCards, Zap } from 'lucide-react';

const labels: Record<string, string> = { tip: 'Tips', subscription: 'Subscriptions', super_follow: 'Super Follows', paid_content: 'Paid content', ad_revenue: 'Ad revenue', sponsorship: 'Sponsorships', digital_product: 'Digital products', live_event: 'Live events', live_gift: 'Live gifts', community: 'Communities', affiliate: 'Affiliate', payout: 'Payout', refund: 'Refund', chargeback: 'Chargeback' };
const money = (c: number, cur = 'USD') => new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format((c || 0) / 100);
type Account = { available_cents: number; pending_cents: number; lifetime_earned_cents: number; lifetime_paid_cents: number; currency: string };
type Profile = { verified: boolean; verified_tier: string | null };

const FEATURES = [
  { key: 'verification', title: 'Profile verification', description: 'Verified badge, trust signals and creator eligibility', icon: BadgeCheck, route: '/verify' },
  { key: 'tips', title: 'Tips', description: 'Let supporters send one-time tips', icon: Gift, route: '/creator-studio' },
  { key: 'subscriptions', title: 'Subscriptions', description: 'Recurring supporter memberships', icon: Users, route: '/premium' },
  { key: 'paid_content', title: 'Paid content', description: 'Sell premium posts and media', icon: WalletCards, route: '/creator-studio' },
  { key: 'ads', title: 'Ad revenue', description: 'Earn from eligible content and placements', icon: Megaphone, route: '/revenue-analytics' },
  { key: 'sponsorship', title: 'Sponsorships', description: 'Brand campaigns and sponsored content', icon: DollarSign, route: '/creator-studio' },
  { key: 'live', title: 'Live gifts', description: 'Monetize live streams and spaces', icon: Zap, route: '/start-stream' },
  { key: 'products', title: 'Digital products', description: 'Sell products directly to your audience', icon: CreditCard, route: '/products' },
  { key: 'community', title: 'Premium communities', description: 'Offer paid community access', icon: Users, route: '/communities' },
  { key: 'affiliate', title: 'Affiliate income', description: 'Earn from eligible referrals and commerce', icon: BarChart3, route: '/creator-studio' },
];

export default function CreatorMonetizationCenter() {
  const { user } = useAuth();
  const navigate = useNavigate();
  useSEO({ noindex: true, title: 'Creator Monetization Center', url: '/monetization' });
  const [a, setA] = useState<Account | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ledger, setLedger] = useState<any[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [amount, setAmount] = useState('');
  const [provider, setProvider] = useState('paypal');
  const [destination, setDestination] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!user) return;
    silent ? setRefreshing(true) : setLoading(true);
    try {
      await supabase.rpc('ensure_monetization_account', { p_user_id: user.id });
      const [ar, lr, pr, sr, ur] = await Promise.all([
        supabase.from('monetization_accounts').select('available_cents,pending_cents,lifetime_earned_cents,lifetime_paid_cents,currency').eq('user_id', user.id).maybeSingle(),
        supabase.from('monetization_ledger').select('id,entry_type,direction,amount_cents,state,created_at,description').eq('account_user_id', user.id).order('created_at', { ascending: false }).limit(50),
        supabase.from('monetization_payouts').select('id,amount_cents,currency,provider,status,requested_at').eq('user_id', user.id).order('requested_at', { ascending: false }).limit(20),
        supabase.from('monetization_settings').select('minimum_payout_cents,creator_share_bps,platform_fee_bps,payout_hold_days').eq('id', true).maybeSingle(),
        supabase.from('user_profiles').select('verified,verified_tier').eq('id', user.id).maybeSingle(),
      ]);
      if (ar.error) throw ar.error;
      if (lr.error) throw lr.error;
      if (pr.error) throw pr.error;
      setA(ar.data);
      setLedger(lr.data || []);
      setPayouts(pr.data || []);
      setSettings(sr.data);
      setProfile(ur.data || null);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Could not load monetization');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    void load();
  }, [user, load, navigate]);

  const payout = async () => {
    if (!user || !a) return;
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) return toast.error('Enter a valid amount');
    if (cents > (a.available_cents || 0)) return toast.error('Insufficient available balance');
    if (settings?.minimum_payout_cents && cents < settings.minimum_payout_cents) return toast.error(`Minimum payout is ${money(settings.minimum_payout_cents, a.currency)}`);
    if (!destination.trim()) return toast.error('Enter a payout destination');
    setSending(true);
    try {
      const { error } = await supabase.rpc('request_monetization_payout', { p_amount_cents: cents, p_provider: provider, p_destination: { value: destination.trim() }, p_idempotency_key: `payout:${user.id}:${Date.now()}` });
      if (error) throw error;
      toast.success('Payout request submitted');
      setAmount(''); setDestination(''); await load(true);
    } catch (e: any) { toast.error(e?.message || 'Payout failed'); }
    finally { setSending(false); }
  };

  if (loading) return <><TopBar title="Monetization" /><div className="flex justify-center py-24"><Loader2 className="animate-spin" /></div></>;
  const cur = a?.currency || 'USD';
  const share = Number(settings?.creator_share_bps ?? 9000) / 100;
  const fee = Number(settings?.platform_fee_bps ?? 1000) / 100;
  const verified = Boolean(profile?.verified);

  return <>
    <TopBar title="Creator Monetization" />
    <main className="p-4 space-y-4 pb-24">
      <section className="rounded-3xl border border-border p-5 bg-gradient-to-br from-primary/15 via-background to-background">
        <div className="flex justify-between gap-3">
          <div><p className="text-xs font-black uppercase tracking-widest text-primary flex gap-2"><Sparkles className="w-4 h-4" />Creator wallet</p><h1 className="text-3xl font-black mt-1">{money(a?.available_cents || 0, cur)}</h1><p className="text-sm text-muted-foreground">Available balance</p></div>
          <button onClick={() => void load(true)} className="p-2 rounded-xl border border-border h-fit"><RefreshCw className={refreshing ? 'animate-spin' : ''} /></button>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-5">{[['Pending', a?.pending_cents], ['Lifetime', a?.lifetime_earned_cents], ['Paid out', a?.lifetime_paid_cents]].map(([l, v]) => <div key={String(l)} className="p-3 rounded-2xl bg-background/70 border border-border"><p className="text-[10px] text-muted-foreground">{l}</p><p className="font-black">{money(Number(v || 0), cur)}</p></div>)}</div>
      </section>

      <section className={`rounded-2xl border p-4 ${verified ? 'border-primary/30 bg-primary/5' : 'border-border'}`}>
        <div className="flex items-center gap-3"><div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center"><BadgeCheck className="w-6 h-6 text-primary" /></div><div className="flex-1"><p className="font-black">{verified ? 'Verified creator' : 'Get verified to unlock trust features'}</p><p className="text-xs text-muted-foreground">{verified ? `${profile?.verified_tier || 'Verified'} profile · eligible for creator trust benefits` : 'Verification is a monetization-adjacent trust feature and may unlock creator programs, premium tools and higher audience confidence.'}</p></div><button onClick={() => navigate('/verify')} className="rounded-xl bg-primary text-primary-foreground px-3 py-2 text-xs font-black">{verified ? 'Manage' : 'Get verified'}</button></div>
      </section>

      <section><div className="flex items-end justify-between mb-3"><div><p className="font-black text-lg">Monetization suite</p><p className="text-xs text-muted-foreground">One center for every creator revenue stream</p></div></div><div className="grid grid-cols-2 gap-3">{FEATURES.map(({ key, title, description, icon: Icon, route }) => <button key={key} onClick={() => navigate(route)} className="rounded-2xl border border-border p-4 text-left hover:bg-muted transition-colors"><Icon className="w-5 h-5 text-primary" /><div className="flex items-center gap-1.5 mt-2"><p className="font-bold text-sm">{title}</p>{key === 'verification' && verified && <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />}</div><p className="text-xs text-muted-foreground mt-1 leading-5">{description}</p></button>)}</div></section>

      <section className="grid grid-cols-2 gap-3">{[['Creator Studio', '/creator-studio', BarChart3], ['Payout Center', '/payouts', CreditCard], ['Digital Products', '/products', Gift], ['Revenue Analytics', '/revenue-analytics', BarChart3]].map(([t, r, I]) => <button key={String(r)} onClick={() => navigate(String(r))} className="rounded-2xl border border-border p-4 text-left hover:bg-muted"><I className="w-5 h-5 text-primary" /><p className="font-bold mt-2">{String(t)}</p><p className="text-xs text-muted-foreground">Open</p></button>)}</section>

      <section className="rounded-2xl border border-border overflow-hidden"><div className="p-4 flex gap-2 items-center border-b border-border"><ShieldCheck className="text-green-600" /><div><p className="font-black">Revenue rules</p><p className="text-xs text-muted-foreground">Canonical ledger policy</p></div></div><div className="grid grid-cols-3 divide-x divide-border text-center"><div className="p-3"><b>{share.toFixed(0)}%</b><p className="text-[10px] text-muted-foreground">creator</p></div><div className="p-3"><b>{fee.toFixed(0)}%</b><p className="text-[10px] text-muted-foreground">platform</p></div><div className="p-3"><b>{settings?.payout_hold_days ?? 7}d</b><p className="text-[10px] text-muted-foreground">hold</p></div></div></section>

      <section className="rounded-2xl border border-border p-4 space-y-3"><div className="flex gap-2 items-center"><ArrowDownToLine className="text-primary" /><div><p className="font-black">Request payout</p><p className="text-xs text-muted-foreground">Minimum {money(settings?.minimum_payout_cents ?? 1000, cur)}</p></div></div><div className="grid grid-cols-2 gap-2"><input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount" className="h-11 rounded-xl border border-border px-3 bg-background" /><select value={provider} onChange={e => setProvider(e.target.value)} className="h-11 rounded-xl border border-border px-3 bg-background"><option value="paypal">PayPal</option><option value="mpesa">M-Pesa</option><option value="bank">Bank</option></select></div><input value={destination} onChange={e => setDestination(e.target.value)} placeholder="Destination reference" className="w-full h-11 rounded-xl border border-border px-3 bg-background" /><button disabled={sending} onClick={payout} className="w-full h-11 rounded-xl bg-primary text-primary-foreground font-black flex items-center justify-center gap-2">{sending ? <Loader2 className="animate-spin" /> : <ArrowUpRight />}{sending ? 'Submitting…' : 'Request payout'}</button></section>

      <section className="rounded-2xl border border-border overflow-hidden"><div className="p-4 border-b border-border flex justify-between"><div><p className="font-black">Transaction ledger</p><p className="text-xs text-muted-foreground">Immutable creator economy feed</p></div><WalletCards /></div>{ledger.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">No transactions yet.</p> : ledger.slice(0, 15).map(e => <div key={e.id} className="p-3 border-b border-border flex gap-3 items-center"><div className={`w-9 h-9 rounded-full flex items-center justify-center ${e.direction === 'credit' ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'}`}>{e.direction === 'credit' ? <ArrowDownToLine /> : <ArrowUpRight />}</div><div className="flex-1"><p className="font-semibold text-sm">{labels[e.entry_type] || e.entry_type}</p><p className="text-[11px] text-muted-foreground flex gap-1"><Clock3 />{new Date(e.created_at).toLocaleString()} · {e.state}</p></div><b className={e.direction === 'credit' ? 'text-green-600' : 'text-red-600'}>{e.direction === 'credit' ? '+' : '-'}{money(e.amount_cents, cur)}</b></div>)}</section>

      <section className="rounded-2xl border border-border overflow-hidden"><div className="p-4 border-b border-border"><p className="font-black">Payout history</p></div>{payouts.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No payouts yet.</p> : payouts.map(p => <div key={p.id} className="p-3 flex items-center gap-3 border-b border-border"><CheckCircle2 className="text-primary" /><div className="flex-1"><p className="font-semibold">{p.provider}</p><p className="text-xs text-muted-foreground">{new Date(p.requested_at).toLocaleString()}</p></div><b>{money(p.amount_cents, p.currency || cur)}</b><span className="text-[10px] uppercase">{p.status}</span></div>)}</section>
    </main>
  </>;
}
