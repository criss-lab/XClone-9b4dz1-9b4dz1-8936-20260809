import { useState, useEffect, useCallback } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, Flame, Coins, Calendar, Trophy, Zap, Gift } from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { PageAdBanner } from '@/components/features/AdSenseAd';

const DAY_REWARDS = [10, 15, 20, 25, 30, 40, 50];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function DailyRewardsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  useSEO({ noindex: true, title: 'Daily Rewards', url: '/rewards' });
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [reward, setReward] = useState<any>(null);
  const [walletCredits, setWalletCredits] = useState(0);
  const [canClaim, setCanClaim] = useState(false);
  const [nextClaimIn, setNextClaimIn] = useState('');

  const updateCountdown = useCallback(() => {
    const now = new Date();
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    const diff = Math.max(0, midnight.getTime() - now.getTime());
    setNextClaimIn(`${Math.floor(diff / 3600000)}h ${Math.floor((diff % 3600000) / 60000)}m`);
  }, []);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: rewardData, error: rewardError }, { data: walletData, error: walletError }] = await Promise.all([
      supabase.from('daily_rewards').select('*').eq('user_id', user.id).maybeSingle(),
      supabase.from('user_wallets').select('credits').eq('user_id', user.id).maybeSingle(),
    ]);
    if (rewardError) console.warn('[DailyRewards] reward read failed', rewardError);
    if (walletError) console.warn('[DailyRewards] wallet read failed', walletError);
    setReward(rewardData);
    setWalletCredits(Number(walletData?.credits ?? 0));
    const available = !rewardData?.last_claimed_at || !isSameDay(new Date(rewardData.last_claimed_at), new Date());
    setCanClaim(available);
    if (!available) updateCountdown();
    setLoading(false);
  }, [user?.id, updateCountdown]);

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    void fetchData();
  }, [user?.id, fetchData, navigate]);

  useEffect(() => {
    if (!canClaim) {
      const timer = window.setInterval(updateCountdown, 60000);
      return () => window.clearInterval(timer);
    }
  }, [canClaim, updateCountdown]);

  const handleClaim = async () => {
    if (!user || !canClaim || claiming) return;
    setClaiming(true);
    const { data, error } = await supabase.rpc('claim_daily_reward');
    if (error) {
      const alreadyClaimed = /already claimed/i.test(error.message || '');
      toast.error(alreadyClaimed ? 'Reward already claimed today' : 'Failed to claim reward');
      await fetchData();
      setClaiming(false);
      return;
    }
    const result = data as { streak_day?: number; credits_earned?: number; wallet_credits?: number } | null;
    const earned = Number(result?.credits_earned ?? 0);
    const streak = Number(result?.streak_day ?? 1);
    toast.success(streak === 7 ? `+${earned} credits! 🏆 Max streak reached!` : `+${earned} credits earned! Day ${streak} streak!`);
    await fetchData();
    setClaiming(false);
  };

  if (!user) return null;
  const streakDay = Number(reward?.streak_day ?? 0);
  const nextRewardDay = canClaim ? (reward ? Math.min(streakDay + 1, 7) : 1) : streakDay;
  const nextCredits = DAY_REWARDS[nextRewardDay - 1] ?? 10;

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <TopBar title="Daily Rewards" showBack />
      <PageAdBanner />
      {loading ? <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div> : (
        <div className="max-w-lg mx-auto p-4 space-y-5">
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-orange-500/20 via-amber-500/10 to-yellow-500/5 border border-orange-500/20 p-6 text-center">
            <Flame className="w-14 h-14 text-orange-500 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-1">Current Streak</p>
            <p className="text-6xl font-black tracking-tight">{streakDay}</p>
            <p className="text-sm font-medium text-muted-foreground mt-1">{streakDay === 0 ? 'Start your streak today!' : streakDay === 7 ? 'Max streak reached! 🏆' : `${7 - streakDay} days to max streak`}</p>
          </div>
          <div className="flex items-center justify-between bg-muted/50 rounded-xl px-5 py-4 border border-border">
            <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center"><Coins className="w-5 h-5 text-primary" /></div><div><p className="text-xs text-muted-foreground">Wallet Credits</p><p className="text-2xl font-bold">{formatNumber(walletCredits)}</p></div></div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/wallet')} className="text-primary text-xs">View Wallet</Button>
          </div>
          <div className="bg-muted/50 rounded-2xl border border-border p-5"><h3 className="font-bold mb-4 flex items-center gap-2"><Calendar className="w-5 h-5 text-primary" />Weekly Streak Calendar</h3><div className="grid grid-cols-7 gap-2">{DAY_REWARDS.map((credits, i) => { const day = i + 1; const current = day === streakDay; const next = day === nextRewardDay && canClaim; const past = day < streakDay; return <div key={day} className={`flex flex-col items-center gap-1 p-2 rounded-xl ${current ? 'bg-primary text-primary-foreground shadow-md' : next ? 'bg-primary/20 border-2 border-primary/50' : past ? 'bg-green-500/10 border border-green-500/20' : 'bg-background border border-border opacity-50'}`}><span className="text-[10px] font-medium">{DAY_LABELS[i]}</span><div className="text-base">{past ? '✓' : current ? '🔥' : next ? '🎁' : day === 7 ? '🏆' : credits}</div><span className="text-[9px] font-semibold">+{credits}</span></div>; })}</div></div>
          {canClaim ? <div className="rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 p-5 flex flex-col items-center gap-3"><div className="flex items-center gap-2"><Gift className="w-5 h-5 text-primary" /><p className="font-semibold">Day {nextRewardDay} Reward Available!</p></div><p className="text-3xl font-black text-primary">+{nextCredits} Credits</p><Button onClick={handleClaim} disabled={claiming} size="lg" className="w-full rounded-xl h-12 text-base font-bold">{claiming ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Zap className="w-5 h-5 mr-2" />Claim Reward</>}</Button></div> : <div className="rounded-2xl bg-muted/50 border border-border p-5 flex flex-col items-center gap-2"><Trophy className="w-8 h-8 text-muted-foreground" /><p className="font-semibold">Already claimed today!</p><p className="text-sm text-muted-foreground">Come back in <span className="font-bold text-foreground">{nextClaimIn}</span></p></div>}
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2"><p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Streak Tips</p><ul className="text-sm text-muted-foreground space-y-1.5"><li>🔥 Claim every day to keep your streak alive</li><li>🏆 Day 7 gives you the max reward: <strong className="text-foreground">50 credits</strong></li><li>🪙 Use credits to boost posts, unlock features, and more</li></ul></div>
        </div>
      )}
    </div>
  );
}
