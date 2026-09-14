import { useCallback, useEffect, useState } from 'react';
import { DollarSign, Headphones, Users, Loader2, Save, LockKeyhole, Megaphone, Gift, Ticket } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

const FOLLOWER_REQUIREMENT = 400;

type Community = { id: string; display_name: string; name: string; member_count: number };
type Space = { id: string; title: string; is_live: boolean; listener_count: number };

type CommunityConfig = {
  enabled: boolean; membership_price_cents: number; paid_content_enabled: boolean;
  events_enabled: boolean; gifts_enabled: boolean; ads_enabled: boolean; sponsorships_enabled: boolean;
};
type SpaceConfig = {
  enabled: boolean; ticket_price_cents: number; recording_price_cents: number;
  gifts_enabled: boolean; ads_enabled: boolean; sponsorships_enabled: boolean;
};

const defaultCommunity: CommunityConfig = {
  enabled: false, membership_price_cents: 0, paid_content_enabled: false,
  events_enabled: false, gifts_enabled: true, ads_enabled: false, sponsorships_enabled: false,
};
const defaultSpace: SpaceConfig = {
  enabled: false, ticket_price_cents: 0, recording_price_cents: 0,
  gifts_enabled: true, ads_enabled: false, sponsorships_enabled: false,
};

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5 cursor-pointer hover:bg-muted/40">
      <span className="text-sm font-medium">{label}</span>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="h-4 w-4 accent-primary" />
    </label>
  );
}

export default function AudioCommunityMonetizationPanel() {
  const { user } = useAuth();
  const [followers, setFollowers] = useState(0);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [communityConfigs, setCommunityConfigs] = useState<Record<string, CommunityConfig>>({});
  const [spaceConfigs, setSpaceConfigs] = useState<Record<string, SpaceConfig>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: profile }, { data: ownedCommunities }, { data: hostedSpaces }] = await Promise.all([
      supabase.from('profiles').select('follower_count').eq('id', user.id).maybeSingle(),
      supabase.from('communities').select('id,display_name,name,member_count').eq('owner_id', user.id).order('created_at', { ascending: false }),
      supabase.from('audio_spaces').select('id,title,is_live,listener_count').eq('host_id', user.id).order('created_at', { ascending: false }).limit(20),
    ]);
    const followerCount = Number(profile?.follower_count ?? 0);
    setFollowers(followerCount);
    const comms = (ownedCommunities ?? []) as Community[];
    const hosted = (hostedSpaces ?? []) as Space[];
    setCommunities(comms);
    setSpaces(hosted);

    const [commRows, spaceRows] = await Promise.all([
      comms.length ? supabase.from('community_monetization').select('*').in('community_id', comms.map(c => c.id)) : Promise.resolve({ data: [] as any[] }),
      hosted.length ? supabase.from('audio_space_monetization').select('*').in('space_id', hosted.map(s => s.id)) : Promise.resolve({ data: [] as any[] }),
    ]);
    const nextComms: Record<string, CommunityConfig> = {};
    for (const c of comms) nextComms[c.id] = { ...defaultCommunity };
    for (const row of (commRows.data ?? []) as any[]) nextComms[row.community_id] = {
      enabled: Boolean(row.enabled), membership_price_cents: Number(row.membership_price_cents ?? 0),
      paid_content_enabled: Boolean(row.paid_content_enabled), events_enabled: Boolean(row.events_enabled),
      gifts_enabled: Boolean(row.gifts_enabled), ads_enabled: Boolean(row.ads_enabled), sponsorships_enabled: Boolean(row.sponsorships_enabled),
    };
    const nextSpaces: Record<string, SpaceConfig> = {};
    for (const s of hosted) nextSpaces[s.id] = { ...defaultSpace };
    for (const row of (spaceRows.data ?? []) as any[]) nextSpaces[row.space_id] = {
      enabled: Boolean(row.enabled), ticket_price_cents: Number(row.ticket_price_cents ?? 0), recording_price_cents: Number(row.recording_price_cents ?? 0),
      gifts_enabled: Boolean(row.gifts_enabled), ads_enabled: Boolean(row.ads_enabled), sponsorships_enabled: Boolean(row.sponsorships_enabled),
    };
    setCommunityConfigs(nextComms);
    setSpaceConfigs(nextSpaces);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const saveCommunity = async (communityId: string) => {
    const config = communityConfigs[communityId] ?? defaultCommunity;
    if (config.enabled && followers < FOLLOWER_REQUIREMENT) {
      toast.error(`You need at least ${FOLLOWER_REQUIREMENT} followers to monetize a community.`);
      return;
    }
    setSaving(`community:${communityId}`);
    const { error } = await supabase.rpc('set_community_monetization', {
      p_community_id: communityId,
      p_enabled: config.enabled,
      p_membership_price_cents: Math.round(config.membership_price_cents),
      p_paid_content_enabled: config.paid_content_enabled,
      p_events_enabled: config.events_enabled,
      p_gifts_enabled: config.gifts_enabled,
      p_ads_enabled: config.ads_enabled,
      p_sponsorships_enabled: config.sponsorships_enabled,
    });
    setSaving(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Community monetization saved');
    await load();
  };

  const saveSpace = async (spaceId: string) => {
    const config = spaceConfigs[spaceId] ?? defaultSpace;
    if (config.enabled && followers < FOLLOWER_REQUIREMENT) {
      toast.error(`You need at least ${FOLLOWER_REQUIREMENT} followers to monetize an audio Space.`);
      return;
    }
    setSaving(`space:${spaceId}`);
    const { error } = await supabase.rpc('set_audio_space_monetization', {
      p_space_id: spaceId,
      p_enabled: config.enabled,
      p_ticket_price_cents: Math.round(config.ticket_price_cents),
      p_recording_price_cents: Math.round(config.recording_price_cents),
      p_gifts_enabled: config.gifts_enabled,
      p_ads_enabled: config.ads_enabled,
      p_sponsorships_enabled: config.sponsorships_enabled,
    });
    setSaving(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Audio Space monetization saved');
    await load();
  };

  if (!user || loading) return null;
  if (!communities.length && !spaces.length) return null;

  const eligible = followers >= FOLLOWER_REQUIREMENT;
  const updateCommunity = (id: string, patch: Partial<CommunityConfig>) => setCommunityConfigs(prev => ({ ...prev, [id]: { ...(prev[id] ?? defaultCommunity), ...patch } }));
  const updateSpace = (id: string, patch: Partial<SpaceConfig>) => setSpaceConfigs(prev => ({ ...prev, [id]: { ...(prev[id] ?? defaultSpace), ...patch } }));

  return (
    <section className="mt-6 rounded-3xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2"><DollarSign className="w-5 h-5 text-primary" /><h2 className="text-lg font-bold">Community & Audio Monetization</h2></div>
          <p className="text-sm text-muted-foreground mt-1">Turn communities and live audio into memberships, tickets, gifts, ads and sponsorship revenue.</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${eligible ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}>
          {eligible ? '400+ eligible' : `${followers}/400 followers`}
        </span>
      </div>
      {!eligible && <div className="mb-4 flex items-center gap-2 rounded-xl bg-amber-500/10 p-3 text-sm"><LockKeyhole className="w-4 h-4 shrink-0" />Monetization activation is locked until you reach {FOLLOWER_REQUIREMENT} followers.</div>}

      <div className="space-y-4">
        {communities.map(c => {
          const cfg = communityConfigs[c.id] ?? defaultCommunity;
          return <div key={c.id} className="rounded-2xl border border-border p-4">
            <div className="flex items-center gap-2 mb-3"><Users className="w-4 h-4 text-primary" /><div><h3 className="font-bold">{c.display_name}</h3><p className="text-xs text-muted-foreground">{c.member_count ?? 0} members</p></div></div>
            <div className="grid sm:grid-cols-2 gap-2">
              <Toggle label="Enable paid community" checked={cfg.enabled} onChange={enabled => updateCommunity(c.id, { enabled })} />
              <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2"><DollarSign className="w-4 h-4 text-muted-foreground" /><Input type="number" min="0" step="0.01" value={(cfg.membership_price_cents / 100).toFixed(2)} disabled={!cfg.enabled} onChange={e => updateCommunity(c.id, { membership_price_cents: Math.round(Number(e.target.value || 0) * 100) })} className="h-8 border-0 p-0 focus-visible:ring-0" placeholder="Membership price" /></div>
              <Toggle label="Paid posts/content" checked={cfg.paid_content_enabled} onChange={paid_content_enabled => updateCommunity(c.id, { paid_content_enabled })} />
              <Toggle label="Paid community events" checked={cfg.events_enabled} onChange={events_enabled => updateCommunity(c.id, { events_enabled })} />
              <Toggle label="Member gifts" checked={cfg.gifts_enabled} onChange={gifts_enabled => updateCommunity(c.id, { gifts_enabled })} />
              <Toggle label="Ads" checked={cfg.ads_enabled} onChange={ads_enabled => updateCommunity(c.id, { ads_enabled })} />
              <Toggle label="Sponsorships" checked={cfg.sponsorships_enabled} onChange={sponsorships_enabled => updateCommunity(c.id, { sponsorships_enabled })} />
            </div>
            <Button onClick={() => saveCommunity(c.id)} disabled={saving === `community:${c.id}`} className="mt-3 w-full rounded-xl">{saving === `community:${c.id}` ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}Save community monetization</Button>
          </div>;
        })}

        {spaces.map(s => {
          const cfg = spaceConfigs[s.id] ?? defaultSpace;
          return <div key={s.id} className="rounded-2xl border border-border p-4">
            <div className="flex items-center gap-2 mb-3"><Headphones className="w-4 h-4 text-primary" /><div><h3 className="font-bold">{s.title}</h3><p className="text-xs text-muted-foreground">{s.is_live ? 'Live' : 'Space'} · {s.listener_count ?? 0} listeners</p></div></div>
            <div className="grid sm:grid-cols-2 gap-2">
              <Toggle label="Enable Space monetization" checked={cfg.enabled} onChange={enabled => updateSpace(s.id, { enabled })} />
              <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2"><Ticket className="w-4 h-4 text-muted-foreground" /><Input type="number" min="0" step="0.01" value={(cfg.ticket_price_cents / 100).toFixed(2)} disabled={!cfg.enabled} onChange={e => updateSpace(s.id, { ticket_price_cents: Math.round(Number(e.target.value || 0) * 100) })} className="h-8 border-0 p-0 focus-visible:ring-0" placeholder="Ticket price" /></div>
              <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2"><Headphones className="w-4 h-4 text-muted-foreground" /><Input type="number" min="0" step="0.01" value={(cfg.recording_price_cents / 100).toFixed(2)} disabled={!cfg.enabled} onChange={e => updateSpace(s.id, { recording_price_cents: Math.round(Number(e.target.value || 0) * 100) })} className="h-8 border-0 p-0 focus-visible:ring-0" placeholder="Recording price" /></div>
              <Toggle label="Listener gifts" checked={cfg.gifts_enabled} onChange={gifts_enabled => updateSpace(s.id, { gifts_enabled })} />
              <Toggle label="Ads" checked={cfg.ads_enabled} onChange={ads_enabled => updateSpace(s.id, { ads_enabled })} />
              <Toggle label="Sponsorships" checked={cfg.sponsorships_enabled} onChange={sponsorships_enabled => updateSpace(s.id, { sponsorships_enabled })} />
            </div>
            <Button onClick={() => saveSpace(s.id)} disabled={saving === `space:${s.id}`} className="mt-3 w-full rounded-xl">{saving === `space:${s.id}` ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}Save Space monetization</Button>
          </div>;
        })}
      </div>
      <p className="mt-4 text-[11px] text-muted-foreground">Revenue from memberships, paid events/content, tickets, recordings, gifts, ads and sponsorships is routed through Testagram&apos;s server-authoritative monetization ledger. Platform payout rules and the 400-follower eligibility guard remain enforced server-side.</p>
    </section>
  );
}
