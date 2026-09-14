import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Hash, Loader2, TrendingUp, Users, Check, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { PostCard } from '@/components/features/PostCard';
import { InteractiveFederatedPostCard } from '@/components/features/InteractiveFederatedPostCard';
import { unifiedHashtagFeed, followHashtag, unfollowHashtag, isFollowingHashtag } from '@/api/social';
import { formatNumber } from '@/lib/utils';
import { useSEO, buildHashtagLD, buildOgImageUrl } from '@/hooks/useSEO';

function cleanTag(value = '') { return value.replace(/^#/, '').trim().toLowerCase(); }

export default function HashtagPage() {
  const { tag: routeTag } = useParams<{ tag: string }>();
  const tag = useMemo(() => cleanTag(routeTag), [routeTag]);
  const { user } = useAuth(); const navigate = useNavigate();
  const [hashtag, setHashtag] = useState<any>(null); const [items, setItems] = useState<any[]>([]); const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState(false); const [followBusy, setFollowBusy] = useState(false); const [mode, setMode] = useState<'recent' | 'top'>('recent');

  useSEO({ title:`#${tag} — Testagram`, description:`Browse native and federated posts using #${tag}. Follow the hashtag to keep it in your home feed.`, image:buildOgImageUrl({tag}), url:`/hashtag/${tag}`, type:'website', keywords:`${tag}, hashtag, Testagram, Fediverse`, structuredData:buildHashtagLD(tag,hashtag?.usage_count ?? items.length) });

  const load = useCallback(async () => {
    if (!tag) return; setLoading(true);
    try {
      const [tagResult, feed] = await Promise.all([supabase.from('hashtags').select('*').eq('tag',tag).maybeSingle(), unifiedHashtagFeed(tag,80)]);
      if (tagResult.error) throw tagResult.error;
      const nativeIds = feed.filter((x:any)=>x?.kind==='post' && x?.id).map((x:any)=>x.id);
      let nativeById = new Map<string,any>();
      if (nativeIds.length) {
        const {data,error}=await supabase.from('posts').select('*').in('id',nativeIds).is('deleted_at',null);
        if(error) throw error; nativeById=new Map((data??[]).map((p:any)=>[p.id,p]));
      }
      setHashtag(tagResult.data);
      setItems(feed.map((x:any)=>x?.kind==='post' ? (nativeById.get(x.id) ?? x) : x));
      if(user && tagResult.data?.id) setFollowing(await isFollowingHashtag(tagResult.data.id)); else setFollowing(false);
    } catch(error:any){ console.error('[hashtag]',error); toast.error(error?.message||'Unable to load hashtag'); setItems([]); }
    finally{ setLoading(false); }
  },[tag,user?.id]);
  useEffect(()=>{void load();},[load]);

  const toggleFollow=async()=>{ if(!user){navigate('/auth');return;} if(!hashtag?.id){toast.error('This hashtag is not indexed yet');return;} setFollowBusy(true); try{ if(following){await unfollowHashtag(hashtag.id);setFollowing(false);toast.success(`Unfollowed #${tag}`);}else{await followHashtag(hashtag.id);setFollowing(true);toast.success(`Following #${tag}`);} }catch(error:any){toast.error(error?.message||'Hashtag follow failed');}finally{setFollowBusy(false);} };
  const sorted=useMemo(()=>mode==='recent'?items:[...items].sort((a,b)=>{const score=(x:any)=>Number(x.likes_count??x.like_count??0)+Number(x.boosts_count??x.reposts_count??0)+Number(x.replies_count??x.reply_count??0);return score(b)-score(a)||Date.parse(String(b.created_at??b.published_at??0))-Date.parse(String(a.created_at??a.published_at??0));}),[items,mode]);
  if(loading)return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary"/></div>;
  return <div className="min-h-screen bg-background pb-20"><header className="sticky top-0 z-30 h-14 border-b border-border bg-background/90 backdrop-blur flex items-center px-3"><button onClick={()=>navigate(-1)} className="w-10 h-10 rounded-full hover:bg-muted flex items-center justify-center" aria-label="Back"><ArrowLeft className="w-5 h-5"/></button><div className="ml-2 flex-1 font-bold truncate">#{tag}</div></header>
    <section className="p-5 border-b border-border bg-gradient-to-br from-primary/10 to-background"><div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2"><Hash className="w-6 h-6 text-primary"/><h1 className="text-3xl font-black">#{tag}</h1></div><div className="mt-2 flex gap-4 text-sm text-muted-foreground"><span><strong className="text-foreground">{formatNumber(hashtag?.usage_count??items.length)}</strong> posts</span>{hashtag&&<span className="inline-flex items-center gap-1"><Users className="w-4 h-4"/>{formatNumber(hashtag.follower_count??0)} followers</span>}</div></div>{user&&hashtag&&<Button onClick={toggleFollow} disabled={followBusy} variant={following?'outline':'default'} className="rounded-full shrink-0">{followBusy?<Loader2 className="w-4 h-4 animate-spin"/>:following?<><Check className="w-4 h-4 mr-1"/>Following</>:'Follow'}</Button>}</div>{following&&<p className="mt-4 text-sm text-primary">Posts from this hashtag are eligible for your home feed.</p>}</section>
    <div className="border-b border-border flex"><button onClick={()=>setMode('recent')} className={`flex-1 py-3 text-sm font-semibold border-b-2 ${mode==='recent'?'border-primary':'border-transparent text-muted-foreground'}`}>Recent</button><button onClick={()=>setMode('top')} className={`flex-1 py-3 text-sm font-semibold border-b-2 inline-flex justify-center gap-1 ${mode==='top'?'border-primary':'border-transparent text-muted-foreground'}`}><TrendingUp className="w-4 h-4"/>Top</button></div>
    {sorted.length===0?<div className="py-16 text-center text-muted-foreground"><Hash className="w-10 h-10 mx-auto mb-3 opacity-30"/><p>No posts found for #{tag} yet.</p></div>:<div>{sorted.map((item:any,index:number)=>{const native=item?.kind==='post'||item?.source==='testagram';if(native)return <PostCard key={`native-${item.id}-${index}`} post={item} onUpdate={load}/>;const remote=item?.uri||item?.url||item?.id;return <InteractiveFederatedPostCard key={`remote-${remote}-${index}`} post={item}/>;})}</div>}
  </div>;
}
