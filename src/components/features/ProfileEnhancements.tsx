import { BriefcaseBusiness, GraduationCap, Languages, Sparkles, UserRound } from 'lucide-react';

type ProfileEnhancementsProps = { profile: any };

export function ProfileEnhancements({ profile }: ProfileEnhancementsProps) {
  const links = profile?.social_links ?? {};
  const items = [
    links.pronouns && { icon: UserRound, label: 'Pronouns', value: links.pronouns },
    links.profession && { icon: BriefcaseBusiness, label: 'Work', value: links.profession },
    links.education && { icon: GraduationCap, label: 'Education', value: links.education },
    links.languages && { icon: Languages, label: 'Languages', value: links.languages },
  ].filter(Boolean) as Array<{ icon: any; label: string; value: string }>;
  const interests = String(links.interests || '').split(',').map((x: string) => x.trim()).filter(Boolean).slice(0, 8);
  const featured = String(links.featured_link || '').trim();
  if (!items.length && !interests.length && !featured) return null;
  return (
    <section className="mt-4 rounded-2xl border border-border bg-card/60 p-4">
      <div className="flex items-center gap-2 font-semibold"><Sparkles className="w-4 h-4 text-primary" /> About this profile</div>
      {items.length > 0 && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">{items.map(({ icon: Icon, label, value }) => <div key={label} className="flex items-start gap-2"><Icon className="w-4 h-4 mt-0.5 text-muted-foreground" /><div><div className="text-xs text-muted-foreground">{label}</div><div className="text-sm font-medium">{value}</div></div></div>)}</div>}
      {interests.length > 0 && <div className="mt-4"><div className="text-xs text-muted-foreground mb-2">Interests</div><div className="flex flex-wrap gap-2">{interests.map((interest: string) => <span key={interest} className="px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">{interest}</span>)}</div></div>}
      {featured && <a href={featured} target="_blank" rel="noreferrer" className="mt-4 inline-flex text-sm text-primary hover:underline">Featured link →</a>}
    </section>
  );
}
