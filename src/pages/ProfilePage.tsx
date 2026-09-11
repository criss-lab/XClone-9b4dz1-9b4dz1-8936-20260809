import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BarChart3, BadgeCheck, Calendar, Heart, Link as LinkIcon, Loader2, MessageCircle, Pencil, Pin, Repeat2, Search, Share2, UserPlus } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { useSEO } from '@/hooks/useSEO';
import { ProductionEditProfileDialog } from '@/components/features/ProductionEditProfileDialog';
import { WalletCard } from '@/components/features/WalletCard';
import { ProfileEnhancements } from '@/components/features/ProfileEnhancements';
import { toast } from 'sonner';

type Profile = { id:string; username:string; display_name:string; avatar_url:string|null; cover_url:string|null; bio:string|null; website:string|null; location:string|null; social_links:Record<string,string>; verified_tier:string; follower_count:number; following_count:number; created_at:string; protected_account:boolean; pinned_post_id:string|null };
type Post = { id:string; author_id:string; body:string|null; content:string|null; media_url:string|null; media_type:string|null; media_urls:any; image_url:string|null; video_url:string|null; is_video:boolean|null; created_at:string; like_count:number; reply_count:number; repost_count:number; quote_count:number; reply_to_post_id:string|null; quote_of_post_id:string|null };
type TabKey = 'posts'|'replies'|'reposts'|'media'|'likes';

const TABS: { key:TabKey; label:string }[] = [
  { key:'posts', label:'Posts' },
  { key:'replies', label:'Replies' },
  { key:'reposts', label:'Reposts' },
  { key:'media', label:'Media' },
  { key:'likes', label:'Likes' },
];

const POST_SELECT = 'id,author_id,body,content,media_url,media_type,media_urls,image_url,video_url,is_video,created_at,like_count,reply_count,repost_count,quote_count,reply_to_post_id,quote_of_post_id';

function textOf(post:Post){ return post.body ?? post.content ?? ''; }
function mediaOf(post:Post){
  if (post.media_url) return [{ url:post.media_url, type:post.media_type ?? (post.is_video ? 'video' : 'image') }];
  if (post.video_url) return [{ url:post.video_url, type:'video' }];
  if (post.image_url) return [{ url:post.image_url, type:'image' }];
  if (Array.isArray(post.media_urls)) return post.media_urls.map((m:any) => typeof m === 'string' ? {url:m,type:'image'} : {url:m?.url ?? m?.src,type:m?.type ?? 'image'}).filter((m:any)=>m.url);
  return [];
}
function timeLabel(value:string){ const d=new Date(value); const now=new Date(); const hours=Math.floor((now.getTime()-d.getTime())/3600000); if(hours<24) return `${hours || 1}h`; if(hours<168) return `${Math.floor(hours/24)}d`; return d.toLocaleDateString(undefined,{month:'short',day:'numeric'}); }

function PostCard({ post, profile, navigate, reposted=false, pinned=false }:{post:Post; profile:Profile; navigate:(path:string)=>void; reposted?:boolean; pinned?:boolean}){
 const media=mediaOf(post);
 return <article className="border-t border-border px-4 py-3 hover:bg-muted/20 transition-colors">
   {reposted && <div className="ml-10 mb-1 text-xs font-semibold text-muted-foreground flex items-center gap-1"><Repeat2 className="w-3.5 h-3.5"/>Reposted by @{profile.username}</div>}
   {pinned && <div className="ml-10 mb-1 text-xs font-semibold text-muted-foreground flex items-center gap-1"><Pin className="w-3.5 h-3.5"/>Pinned post</div>}
   <div className="flex gap-3">
     <button className="shrink-0" onClick={()=>navigate(`/profile/${profile.username}`)} aria-label={`View @${profile.username}`}>
       <div className="w-10 h-10 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center font-bold">{profile.avatar_url ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover"/> : (profile.display_name||profile.username)[0]?.toUpperCase()}</div>
     </button>
     <div className="min-w-0 flex-1">
       <button onClick={()=>navigate(`/post/${post.id}`)} className="w-full text-left">
         <div className="flex items-center gap-1.5 text-sm"><span className="font-bold truncate">{profile.display_name||profile.username}</span>{profile.verified_tier && profile.verified_tier!=='none' && <BadgeCheck className="w-4 h-4 text-primary shrink-0"/>}<span className="text-muted-foreground truncate">@{profile.username} · {timeLabel(post.created_at)}</span></div>
         {post.reply_to_post_id && <div className="text-xs text-muted-foreground mt-0.5">Replying to a conversation</div>}
         <p className="mt-1 whitespace-pre-wrap break-words leading-5">{textOf(post)}</p>
       </button>
       {media.length>0 && <div className={`mt-3 grid gap-1.5 ${media.length>1?'grid-cols-2':''}`}>
         {media.slice(0,4).map((m:any,i:number)=><div key={`${m.url}-${i}`} className="overflow-hidden rounded-2xl bg-muted min-h-0">
           {String(m.type).startsWith('video') ? <video src={m.url} controls playsInline className="w-full max-h-[520px] object-cover"/> : <img src={m.url} alt="Post media" loading="lazy" className="w-full max-h-[520px] object-cover"/>}
         </div>)}
       </div>}
       <div className="mt-2.5 grid grid-cols-5 max-w-xl text-muted-foreground">
         <button onClick={()=>navigate(`/post/${post.id}`)} className="inline-flex items-center gap-1.5 text-xs hover:text-primary"><MessageCircle className="w-4 h-4"/>{post.reply_count||0}</button>
         <button onClick={()=>navigate(`/post/${post.id}`)} className="inline-flex items-center gap-1.5 text-xs hover:text-primary"><Repeat2 className="w-4 h-4"/>{post.repost_count||0}</button>
         <button onClick={()=>navigate(`/post/${post.id}`)} className="inline-flex items-center gap-1.5 text-xs hover:text-rose-500"><Heart className="w-4 h-4"/>{post.like_count||0}</button>
         <button onClick={()=>navigate(`/post/${post.id}`)} className="inline-flex items-center gap-1.5 text-xs hover:text-primary"><BarChart3 className="w-4 h-4"/>{post.quote_count||0}</button>
         <button onClick={()=>navigate(`/post/${post.id}`)} className="inline-flex items-center gap-1.5 text-xs hover:text-primary"><Share2 className="w-4 h-4"/></button>
       </div>
     </div>
   </div>
 </article>;
}

export default function ProfilePage(){
 const {username}=useParams<{username:string}>();
 const {user}=useAuth();
 const navigate=useNavigate();
 const [profile,setProfile]=useState<Profile|null>(null);
 const [posts,setPosts]=useState<Post[]>([]);
 const [replies,setReplies]=useState<Post[]>([]);
 const [reposts,setReposts]=useState<Post[]>([]);
 const [likes,setLikes]=useState<Post[]>([]);
 const [loading,setLoading]=useState(true);
 const [following,setFollowing]=useState(false);
 const [edit,setEdit]=useState(false);
 const [tab,setTab]=useState<TabKey>('posts');
 const [shareBusy,setShareBusy]=useState(false);

 useSEO({title:profile?`@${profile.username} on Testagram`:'Profile',description:profile?.bio||'Testagram profile',image:profile?.avatar_url||undefined,url:profile?`/profile/${profile.username}`:undefined,type:'profile'});

 useEffect(()=>{
   let alive=true;
   (async()=>{
     if(!username)return;
     setLoading(true);
     try{
       const name=username.replace(/^@/,'').toLowerCase();
       const {data,error}=await supabase.from('profiles').select('*').ilike('username',name).maybeSingle();
       if(error)throw error;
       if(!data){if(alive)setProfile(null);return;}
       const p=data as Profile;
       if(alive)setProfile(p);

       const base=()=>supabase.from('posts').select(POST_SELECT).eq('author_id',p.id).is('deleted_at',null).order('created_at',{ascending:false}).limit(50);
       const [postRes,replyRes,repostRes,likeRes,followRes]=await Promise.all([
         base().is('reply_to_post_id',null),
         base().not('reply_to_post_id','is',null),
         supabase.from('post_reposts').select('post_id,created_at').eq('user_id',p.id).order('created_at',{ascending:false}).limit(50),
         supabase.from('post_likes').select('post_id,created_at').eq('user_id',p.id).order('created_at',{ascending:false}).limit(50),
         user?.id&&user.id!==p.id ? supabase.from('follows').select('follower_id').eq('follower_id',user.id).eq('following_id',p.id).maybeSingle() : Promise.resolve({data:null,error:null} as any),
       ]);
       if(postRes.error)throw postRes.error;
       if(replyRes.error)throw replyRes.error;
       if(alive){setPosts((postRes.data??[]) as Post[]);setReplies((replyRes.data??[]) as Post[]);setFollowing(Boolean((followRes as any).data));}

       const repostIds=(repostRes.data??[]).map((r:any)=>r.post_id).filter(Boolean);
       const likeIds=(likeRes.data??[]).map((r:any)=>r.post_id).filter(Boolean);
       const [repostPosts,likePosts]=await Promise.all([
         repostIds.length ? supabase.from('posts').select(POST_SELECT).in('id',repostIds).is('deleted_at',null) : Promise.resolve({data:[],error:null} as any),
         likeIds.length ? supabase.from('posts').select(POST_SELECT).in('id',likeIds).is('deleted_at',null) : Promise.resolve({data:[],error:null} as any),
       ]);
       if(repostPosts.error)throw repostPosts.error;
       if(likePosts.error)throw likePosts.error;
       const orderBy=(ids:string[],rows:any[])=>{const rank=new Map(ids.map((id,i)=>[id,i]));return (rows??[]).slice().sort((a:any,b:any)=>(rank.get(a.id)??999)-(rank.get(b.id)??999));};
       if(alive){setReposts(orderBy(repostIds,repostPosts.data??[]) as Post[]);setLikes(orderBy(likeIds,likePosts.data??[]) as Post[]);}
     }catch(e:any){if(alive)toast.error(e?.message||'Failed to load profile');}
     finally{if(alive)setLoading(false);}
   })();
   return()=>{alive=false};
 },[username,user?.id]);

 const toggleFollow=async()=>{
   if(!user||!profile){if(!user)navigate('/auth');return;}
   try{
     if(following){const {error}=await supabase.from('follows').delete().eq('follower_id',user.id).eq('following_id',profile.id);if(error)throw error;setFollowing(false);}
     else{const {error}=await supabase.from('follows').insert({follower_id:user.id,following_id:profile.id});if(error)throw error;setFollowing(true);}
   }catch(e:any){toast.error(e?.message||'Follow failed');}
 };

 const shareProfile=async()=>{
   if(!profile)return;
   setShareBusy(true);
   try{
     const url=window.location.href;
     if(navigator.share)await navigator.share({title:`@${profile.username} on Testagram`,text:profile.bio||`View @${profile.username} on Testagram`,url});
     else if(navigator.clipboard){await navigator.clipboard.writeText(url);toast.success('Profile link copied');}
   }catch(e:any){if(e?.name!=='AbortError')toast.error('Could not share profile');}
   finally{setShareBusy(false);}
 };

 const mediaPosts=useMemo(()=>posts.filter(p=>mediaOf(p).length>0),[posts]);
 const activeItems=tab==='posts'?posts:tab==='replies'?replies:tab==='reposts'?reposts:tab==='media'?mediaPosts:likes;

 if(loading)return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary"/></div>;
 if(!profile)return <div className="min-h-screen flex flex-col items-center justify-center gap-3"><h1 className="text-xl font-bold">Profile not found</h1><button onClick={()=>navigate('/')} className="px-4 py-2 rounded-full bg-primary text-primary-foreground">Go home</button></div>;
 const own=user?.id===profile.id;
 const pinned=profile.pinned_post_id ? posts.find(p=>p.id===profile.pinned_post_id) : null;
 const displayPosts=pinned && tab==='posts' ? [pinned,...posts.filter(p=>p.id!==pinned.id)] : activeItems;

 return <div className="min-h-screen bg-background pb-20">
   <header className="sticky top-0 z-30 h-14 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75 flex items-center px-3">
     <button onClick={()=>navigate(-1)} className="w-10 h-10 rounded-full hover:bg-muted flex items-center justify-center" aria-label="Back"><ArrowLeft className="w-5 h-5"/></button>
     <div className="ml-2 min-w-0 flex-1"><div className="font-bold truncate">{profile.display_name||profile.username}</div><div className="text-xs text-muted-foreground">{posts.length + replies.length} posts</div></div>
     <button onClick={()=>navigate('/search')} className="w-10 h-10 rounded-full hover:bg-muted flex items-center justify-center" aria-label="Search"><Search className="w-5 h-5"/></button>
   </header>

   <div className="h-44 sm:h-56 bg-muted relative overflow-hidden">
     {profile.cover_url && <img src={profile.cover_url} alt="Cover" className="w-full h-full object-cover"/>}
   </div>

   <section className="px-4 sm:px-6">
     <div className="flex items-end justify-between -mt-12 relative">
       <div className="w-24 h-24 rounded-full border-4 border-background overflow-hidden bg-primary/10 flex items-center justify-center text-3xl font-bold shadow-sm">
         {profile.avatar_url?<img src={profile.avatar_url} alt={profile.display_name||profile.username} className="w-full h-full object-cover"/>:(profile.display_name||profile.username)[0]?.toUpperCase()}
       </div>
       <div className="flex gap-2 pb-2">
         {own ? <button onClick={()=>setEdit(true)} className="px-4 py-2 rounded-full border bg-background font-semibold inline-flex gap-2"><Pencil className="w-4 h-4"/>Edit profile</button> : <button onClick={toggleFollow} className={`px-4 py-2 rounded-full font-semibold inline-flex gap-2 ${following?'border border-border bg-background text-foreground':'bg-foreground text-background'}`}><UserPlus className="w-4 h-4"/>{following?'Following':'Follow'}</button>}
         <button onClick={shareProfile} disabled={shareBusy} className="w-10 h-10 rounded-full border bg-background flex items-center justify-center" aria-label="Share profile"><Share2 className="w-4 h-4"/></button>
       </div>
     </div>

     <div className="py-4">
       <div className="flex items-center gap-2"><h1 className="text-2xl font-black truncate">{profile.display_name||profile.username}</h1>{profile.verified_tier&&profile.verified_tier!=='none'&&<BadgeCheck className="w-5 h-5 text-primary shrink-0"/>}</div>
       <p className="text-muted-foreground">@{profile.username}</p>
       {profile.bio&&<p className="mt-3 whitespace-pre-wrap leading-6">{profile.bio}</p>}
       <ProfileEnhancements profile={profile}/>
       <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3 text-sm text-muted-foreground">
         {profile.location&&<span>{profile.location}</span>}
         {profile.website&&<a href={profile.website.startsWith('http')?profile.website:`https://${profile.website}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><LinkIcon className="w-3.5 h-3.5"/>Website</a>}
         <span className="inline-flex gap-1 items-center"><Calendar className="w-4 h-4"/>Joined {new Date(profile.created_at).toLocaleDateString(undefined,{month:'short',year:'numeric'})}</span>
       </div>
       <div className="flex gap-5 mt-4 text-sm"><button className="hover:underline"><b>{profile.following_count??0}</b> Following</button><button className="hover:underline"><b>{profile.follower_count??0}</b> Followers</button></div>
     </div>
   </section>

   {own&&<WalletCard username={profile.username}/>} 

   <nav className="sticky top-14 z-20 border-y border-border bg-background/95 backdrop-blur" aria-label="Profile content tabs">
     <div className="overflow-x-auto overscroll-x-contain scrollbar-hide">
       <div className="flex min-w-max px-2">
         {TABS.map(item=><button key={item.key} onClick={()=>setTab(item.key)} className={`relative min-w-[92px] sm:min-w-[110px] px-4 py-4 text-sm font-semibold flex items-center justify-center transition-colors ${tab===item.key?'text-foreground':'text-muted-foreground hover:text-foreground'}`}>
           {item.label}
           {tab===item.key&&<span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-1 w-10 rounded-full bg-primary"/>}
         </button>)}
       </div>
     </div>
   </nav>

   <section className="border-b border-border">
     {displayPosts.map((post)=><PostCard key={post.id} post={post} profile={profile} navigate={navigate} reposted={tab==='reposts'} pinned={tab==='posts'&&pinned?.id===post.id}/>) }
     {!displayPosts.length&&<div className="py-16 px-6 text-center text-muted-foreground">
       {tab==='posts'?'No posts yet.':tab==='replies'?'No replies yet.':tab==='reposts'?'No reposts yet.':tab==='media'?'No media posts yet.':'No liked posts yet.'}
     </div>}
   </section>

   {own&&<ProductionEditProfileDialog open={edit} onOpenChange={setEdit} profile={profile} onSuccess={()=>location.reload()}/>} 
 </div>;
}
