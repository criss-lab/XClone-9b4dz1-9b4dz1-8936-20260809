import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Loader2, ShieldAlert, CheckCircle, XCircle, Clock, AlertTriangle, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

// Module-level — esbuild guard
const STATUS_CONFIG = {
  pending:  { label: 'Under Review',  bg: 'bg-orange-500/10 border-orange-500/20', text: 'text-orange-600' },
  approved: { label: 'Approved ✓',    bg: 'bg-green-500/10 border-green-500/20',  text: 'text-green-600' },
  denied:   { label: 'Denied',        bg: 'bg-red-500/10 border-red-500/20',      text: 'text-red-600'   },
} as const;

function getStatusCfg(status: string) {
  if (status === 'approved') return STATUS_CONFIG.approved;
  if (status === 'denied')   return STATUS_CONFIG.denied;
  return STATUS_CONFIG.pending;
}

export default function AppealsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [activeBan, setActiveBan] = useState<any | null>(null);
  const [appeals, setAppeals] = useState<any[]>([]);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [banRes, appealsRes] = await Promise.all([
      supabase.from('user_bans').select('*').eq('user_id', user.id).eq('is_active', true).order('banned_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('moderation_appeals').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(10),
    ]);
    setActiveBan(banRes.data ?? null);
    setAppeals(appealsRes.data ?? []);
    setLoading(false);
  }, [user]);

  useEffect(() => { if (user) fetchData(); else { setLoading(false); } }, [user]);

  const handleSubmitAppeal = async () => {
    if (!user || !reason.trim()) return;
    setSubmitting(true);
    const { error } = await supabase.from('moderation_appeals').insert({
      user_id: user.id,
      ban_id: activeBan?.id ?? null,
      reason: reason.trim(),
      status: 'pending',
    });
    if (error) { toast.error(error.message); setSubmitting(false); return; }
    // Notify regulators
    const { data: regs } = await supabase.from('platform_regulators').select('user_id');
    for (const reg of regs ?? []) {
      await supabase.from('platform_inbox').insert({
        user_id: reg.user_id,
        subject: `📋 New appeal from @${user.username}`,
        body: `@${user.username} submitted a ban appeal.\n\nReason: "${reason.trim().slice(0, 200)}"\n\nReview in Regulator Panel → Moderation tab.`,
        type: 'update', icon_emoji: '📋',
        cta_label: 'Review Appeal', cta_url: '/regulator',
      }).then(() => {}, () => {});
    }
    toast.success('Appeal submitted! The regulator will review your case.');
    setReason('');
    setSubmitted(true);
    fetchData();
    setSubmitting(false);
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <TopBar title="Appeals" showBack />
        <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
          <ShieldAlert className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-30" />
          <p className="text-muted-foreground font-semibold">Sign in to submit an appeal</p>
          <button onClick={() => navigate('/auth')} className="mt-4 px-6 py-2.5 bg-primary text-primary-foreground rounded-full font-bold hover:opacity-90">Sign In</button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const hasPendingAppeal = appeals.some(a => a.status === 'pending');

  return (
    <div className="min-h-screen bg-background pb-20">
      <TopBar title="Account Appeals" showBack />

      <div className="p-4 space-y-5">
        {/* Hero */}
        <div className="bg-gradient-to-br from-orange-500/10 via-background to-red-500/5 border border-orange-500/20 rounded-2xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-2xl bg-orange-500/10 flex items-center justify-center">
              <ShieldAlert className="w-6 h-6 text-orange-500" />
            </div>
            <div>
              <h1 className="text-lg font-black">Account Appeals</h1>
              <p className="text-xs text-muted-foreground">Contest a ban or policy decision</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            If you believe your account was restricted in error, you can submit an appeal here. The platform regulator will review your case and respond via your platform inbox.
          </p>
        </div>

        {/* Current ban status */}
        {activeBan ? (
          <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-2xl">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
              <h3 className="font-bold text-sm text-red-600">Active Account Restriction</h3>
            </div>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <p><span className="font-semibold text-foreground">Type:</span> {activeBan.ban_type === 'permanent' ? '🚫 Permanent Ban' : `⏱ Temporary Ban (${activeBan.duration_hours}h)`}</p>
              <p><span className="font-semibold text-foreground">Reason:</span> {activeBan.reason ?? 'Policy violation'}</p>
              <p><span className="font-semibold text-foreground">Strike:</span> {activeBan.strike_count ?? 1}/3</p>
              {activeBan.expires_at && (
                <p><span className="font-semibold text-foreground">Expires:</span> {formatDistanceToNow(new Date(activeBan.expires_at), { addSuffix: true })}</p>
              )}
            </div>
          </div>
        ) : (
          <div className="p-4 bg-green-500/5 border border-green-500/20 rounded-2xl flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
            <p className="text-sm font-semibold text-green-700 dark:text-green-400">No active restrictions on your account</p>
          </div>
        )}

        {/* Submit appeal form */}
        {(activeBan || true) && !hasPendingAppeal && (
          <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Send className="w-4 h-4 text-primary" />
              <h3 className="font-bold text-sm">Submit an Appeal</h3>
            </div>
            {submitted && (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-green-500/10 border border-green-500/20 rounded-xl">
                <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
                <p className="text-sm font-semibold text-green-600">Appeal submitted successfully!</p>
              </div>
            )}
            <div>
              <label className="text-sm font-semibold mb-1.5 block">Your Appeal Reason *</label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={5}
                maxLength={800}
                placeholder="Explain why you believe the restriction was applied in error. Be specific and honest. Include any relevant context that may help the regulator understand your situation."
                className="w-full px-3 py-2.5 bg-muted/40 border border-border rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 leading-relaxed placeholder:text-muted-foreground/50"
              />
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px] text-muted-foreground">Be respectful and honest. False appeals may result in additional strikes.</p>
                <span className={`text-[10px] font-mono ${reason.length > 750 ? 'text-destructive' : 'text-muted-foreground'}`}>{reason.length}/800</span>
              </div>
            </div>
            <button
              onClick={handleSubmitAppeal}
              disabled={submitting || !reason.trim() || reason.length < 20}
              className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {submitting ? 'Submitting…' : 'Submit Appeal'}
            </button>
            {reason.trim().length > 0 && reason.trim().length < 20 && (
              <p className="text-[10px] text-orange-500 text-center">Please provide at least 20 characters of explanation.</p>
            )}
          </div>
        )}

        {hasPendingAppeal && (
          <div className="p-4 bg-orange-500/5 border border-orange-500/20 rounded-2xl flex items-center gap-3">
            <Clock className="w-5 h-5 text-orange-500 shrink-0" />
            <div>
              <p className="text-sm font-bold text-orange-600">Appeal Under Review</p>
              <p className="text-xs text-muted-foreground mt-0.5">You have a pending appeal. The regulator will respond via your inbox.</p>
            </div>
          </div>
        )}

        {/* Appeal history */}
        {appeals.length > 0 && (
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="font-bold text-sm">Appeal History</h3>
            </div>
            <div className="divide-y divide-border">
              {appeals.map((appeal: any) => {
                const cfg = getStatusCfg(appeal.status);
                return (
                  <div key={appeal.id} className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] font-black px-2.5 py-1 rounded-full border ${cfg.bg} ${cfg.text}`}>
                        {cfg.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(appeal.created_at), { addSuffix: true })}</span>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">"{appeal.reason}"</p>
                    {appeal.regulator_note && (
                      <div className="px-3 py-2 bg-primary/5 border border-primary/20 rounded-xl">
                        <p className="text-[10px] font-bold text-primary mb-0.5">Regulator Response:</p>
                        <p className="text-xs text-foreground">{appeal.regulator_note}</p>
                      </div>
                    )}
                    {appeal.reviewed_at && (
                      <p className="text-[10px] text-muted-foreground">Reviewed {formatDistanceToNow(new Date(appeal.reviewed_at), { addSuffix: true })}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Info box */}
        <div className="p-4 bg-muted/30 border border-border rounded-2xl space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">How Appeals Work</h4>
          <div className="space-y-1.5 text-xs text-muted-foreground">
            <p>1. Submit your appeal with a clear, honest explanation</p>
            <p>2. The platform regulator (@Shee) reviews your case</p>
            <p>3. Decision is communicated via your platform inbox</p>
            <p>4. If approved, your restriction will be lifted immediately</p>
            <p>5. One appeal per ban — additional appeals may be dismissed</p>
          </div>
        </div>
      </div>
    </div>
  );
}
