import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BadgeCheck, Calendar, Check, Copy, ExternalLink, Heart, Image as ImageIcon, Link as LinkIcon, Loader2, MapPin, MoreHorizontal, Pencil, Share2, ShieldBan, UserPlus, UserRoundMinus, VolumeX } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { useSEO } from '@/hooks/useSEO';
import { ProductionEditProfileDialog } from '@/components/features/ProductionEditProfileDialog';
import { toast } from 'sonner';

interface ProfileRow {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  cover_url: string | null;
  bio: string | null;
  website: string | null;
  location: string | null;
  social_links: Record<string, string>;
  verified_tier: string;
  follower_count: number;
  following_count: number;
  profile_views: number;
  protected_account: boolean;
  birth_date: string | null;
  created_at: string;
}

interface ProfilePost {
  id: string;
  author_id: string;
  body: string;
  media_url: string | null;
  media_type: string | null;
  created_at: string;
  edited_at: string | null;
  like_count: number;
  reply_count: number;
  repost_count: number;
  quote_count: number;
  media: Array<{ id: string; media_url: string; media_type: string | null }>;
}

function Avatar({ profile, size = 'md' }: { profile: Pick<ProfileRow, 'username' | 'display_name' | 'avatar_url'>; size?: 'sm' | 'md' | 'lg' }) {
  const classes = size === 'lg' ? 'w-28 h-28 text-3xl' : size === 'sm' ? 'w-10 h-10 text-sm' : 'w-20 h-20 text-2xl';
  return profile.avatar_url
    ? <img src={profile.avatar_url} alt={profile.display_name || profile.username} className={`${classes} rounded-full object-cover border-4 border-background`} />
    : <div className={`${classes} rounded-full border-4 border-background bg-primary/10 text-primary flex items-center justify-center font-bold`}>{(profile.display_name || profile.username || 'T')[0].toUpperCase()}</div>;
}

function formatCount(value: number) {
  return Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0);
}

function PostItem({ post, liked, onLike, onOpen }: { post: ProfilePost; liked: boolean; onLike: (id: string) => void; onOpen: (id: string) => void }) {
  const media = post.media.length ? post.media : (post.media_url ? [{ id: `${post.id}-primary`, media_url: post.media_url, media_type: post.media_type }] : []);
  return (
    <article className="p-4 border-b border-border hover:bg-muted/20 transition-colors">
      <button className="text-left w-full" onClick={() => onOpen(post.id)}>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          <span>{new Date(post.created_at).toLocaleString()}</span>
          {post.edited_at && <span>· edited</span>}
        </div>
        {post.body && <p className="whitespace-pre-wrap text-[15px] leading-6 break-words">{post.body}</p>}
      </button>
      {media.length > 0 && (
        <div className={`grid gap-2 mt-3 ${media.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {media.slice(0, 4).map(item => item.media_type?.startsWith('video') ? (
            <video key={item.id} src={item.media_url} controls playsInline className="w-full max-h-[520px] rounded-2xl object-cover bg-black" />
          ) : (
            <img key={item.id} src={item.media_url} alt="Post media" loading="lazy" className="w-full max-h-[520px] rounded-2xl object-cover bg-muted" />
          ))}
        </div>
      )}
      <div className="flex items-center gap-6 pt-3 text-xs text-muted-foreground">
        <button type="button" onClick={() => onLike(post.id)} className={`inline-flex items-center gap-1.5 hover:text-red-500 ${liked ? 'text-red-500' : ''}`}><Heart className={`w-4 h-4 ${liked ? 'fill-current' : ''}`} />{formatCount(post.like_count)}</button>
        <button type="button" onClick={() => onOpen(post.id)} className="hover:text-primary">{formatCount(post.reply_count)} replies</button>
        <span>{formatCount(post.repost_count)} reposts</span>
      </div>
    </article>
  );
}

export default function ProfilePage() {
  const { username } = useParams<{ username: string }>();
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [posts, setPosts] = useState<ProfilePost[]>([]);
  const [likedPostIds, setLikedPostIds] = useState<string[]>([]);
  const [followers, setFollowers] = useState<ProfileRow[]>([]);
  const [following, setFollowing] = useState<ProfileRow[]>([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [pendingFollow, setPendingFollow] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [tab, setTab] = useState<'posts' | 'media' | 'followers' | 'following'>('posts');
  const [loading, setLoading] = useState(true);
  const [savingLike, setSavingLike] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const isOwn = Boolean(profile && currentUser?.id === profile.id);

  useSEO({
    title: profile ? `@${profile.username} on Testagram` : 'Profile',
    description: profile?.bio || (profile ? `View @${profile.username}'s profile on Testagram.` : 'Testagram profile'),
    image: profile?.avatar_url || undefined,
    url: profile ? `/profile/${profile.username}` : undefined,
    type: 'profile',
  });

  const loadPosts = useCallback(async (profileId: string) => {
    const { data, error } = await supabase
      .from('posts')
      .select('id, author_id, body, media_url, media_type, created_at, edited_at, like_count, reply_count, repost_count, quote_count')
      .eq('author_id', profileId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    const rows = (data ?? []) as ProfilePost[];
    const ids = rows.map(p => p.id);
    let mediaRows: Array<{ id: string; post_id: string; media_url: string; media_type: string | null }> = [];
    if (ids.length) {
      const { data: mediaData } = await supabase.from('post_media').select('id, post_id, media_url, media_type').in('post_id', ids).order('sort_order', { ascending: true });
      mediaRows = mediaData ?? [];
    }
    const mediaByPost = new Map<string, typeof mediaRows>();
    for (const row of mediaRows) mediaByPost.set(row.post_id, [...(mediaByPost.get(row.post_id) ?? []), row]);
    setPosts(rows.map(post => ({ ...post, media: mediaByPost.get(post.id) ?? [] })));
    if (currentUser?.id && ids.length) {
      const { data: likes } = await supabase.from('post_likes').select('post_id').eq('user_id', currentUser.id).in('post_id', ids);
      setLikedPostIds((likes ?? []).map(row => row.post_id));
    } else {
      setLikedPostIds([]);
    }
  }, [currentUser?.id]);

  const loadRelationshipState = useCallback(async (profileId: string) => {
    if (!currentUser?.id || currentUser.id === profileId) return;
    const [{ data: follow }, { data: request }, { data: block }, { data: mute }] = await Promise.all([
      supabase.from('follows').select('follower_id').eq('follower_id', currentUser.id).eq('following_id', profileId).maybeSingle(),
      supabase.from('follow_requests').select('status').eq('requester_id', currentUser.id).eq('target_id', profileId).eq('status', 'pending').maybeSingle(),
      supabase.from('user_blocks').select('blocker_id').eq('blocker_id', currentUser.id).eq('blocked_id', profileId).maybeSingle(),
      supabase.from('mutes').select('muter_id').eq('muter_id', currentUser.id).eq('muted_id', profileId).maybeSingle(),
    ]);
    setIsFollowing(Boolean(follow));
    setPendingFollow(Boolean(request));
    setIsBlocked(Boolean(block));
    setIsMuted(Boolean(mute));
  }, [currentUser?.id]);

  const loadProfile = useCallback(async () => {
    if (!username) return;
    setLoading(true);
    try {
      const normalized = username.trim().replace(/^@/, '').toLowerCase();
      const { data, error } = await supabase.from('profiles').select('*').ilike('username', normalized).maybeSingle();
      if (error) throw error;
      if (!data) {
        setProfile(null);
        setPosts([]);
        return;
      }
      const profileData = data as ProfileRow;
      setProfile(profileData);
      await Promise.all([loadPosts(profileData.id), loadRelationshipState(profileData.id)]);
      const [{ data: followerRows }, { data: followingRows }] = await Promise.all([
        supabase.from('follows').select('follower:profiles!follows_follower_id_fkey(*)').eq('following_id', profileData.id).limit(100),
        supabase.from('follows').select('following:profiles!follows_following_id_fkey(*)').eq('follower_id', profileData.id).limit(100),
      ]);
      setFollowers((followerRows ?? []).map((row: any) => row.follower).filter(Boolean));
      setFollowing((followingRows ?? []).map((row: any) => row.following).filter(Boolean));
      if (currentUser?.id && currentUser.id !== profileData.id) {
        await supabase.from('browsing_history').insert({ user_id: currentUser.id, profile_id: profileData.id, view_type: 'profile' });
      }
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [username, currentUser?.id, loadPosts, loadRelationshipState]);

  useEffect(() => { void loadProfile(); }, [loadProfile]);

  const toggleFollow = async () => {
    if (!currentUser?.id || !profile || isOwn) return;
    if (isBlocked) {
      toast.error('Unblock this account before following.');
      return;
    }
    try {
      if (isFollowing) {
        const { error } = await supabase.from('follows').delete().eq('follower_id', currentUser.id).eq('following_id', profile.id);
        if (error) throw error;
        setIsFollowing(false);
      } else if (pendingFollow) {
        await supabase.from('follow_requests').delete().eq('requester_id', currentUser.id).eq('target_id', profile.id).eq('status', 'pending');
        setPendingFollow(false);
      } else if (profile.protected_account) {
        const { error } = await supabase.from('follow_requests').insert({ requester_id: currentUser.id, target_id: profile.id, status: 'pending' });
        if (error) throw error;
        setPendingFollow(true);
      } else {
        const { error } = await supabase.from('follows').insert({ follower_id: currentUser.id, following_id: profile.id });
        if (error) throw error;
        setIsFollowing(true);
      }
      await loadProfile();
    } catch (error: any) {
      toast.error(error?.message || 'Follow action failed');
    }
  };

  const toggleLike = async (postId: string) => {
    if (!currentUser?.id || savingLike) {
      if (!currentUser?.id) toast.error('Sign in to like posts.');
      return;
    }
    setSavingLike(postId);
    try {
      const liked = likedPostIds.includes(postId);
      if (liked) {
        const { error } = await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', currentUser.id);
        if (error) throw error;
        setLikedPostIds(prev => prev.filter(id => id !== postId));
        setPosts(prev => prev.map(p => p.id === postId ? { ...p, like_count: Math.max(0, p.like_count - 1) } : p));
      } else {
        const { error } = await supabase.from('post_likes').insert({ post_id: postId, user_id: currentUser.id });
        if (error) throw error;
        setLikedPostIds(prev => [...prev, postId]);
        setPosts(prev => prev.map(p => p.id === postId ? { ...p, like_count: p.like_count + 1 } : p));
      }
    } catch (error: any) {
      toast.error(error?.message || 'Like failed');
    } finally {
      setSavingLike(null);
    }
  };

  const toggleBlock = async () => {
    if (!currentUser?.id || !profile || isOwn) return;
    try {
      if (isBlocked) {
        await supabase.from('user_blocks').delete().eq('blocker_id', currentUser.id).eq('blocked_id', profile.id);
        setIsBlocked(false);
      } else {
        await supabase.from('user_blocks').insert({ blocker_id: currentUser.id, blocked_id: profile.id });
        await supabase.from('follows').delete().eq('follower_id', currentUser.id).eq('following_id', profile.id);
        setIsBlocked(true);
        setIsFollowing(false);
        setPendingFollow(false);
      }
      setMenuOpen(false);
    } catch (error: any) {
      toast.error(error?.message || 'Block action failed');
    }
  };

  const toggleMute = async () => {
    if (!currentUser?.id || !profile || isOwn) return;
    try {
      if (isMuted) {
        await supabase.from('mutes').delete().eq('muter_id', currentUser.id).eq('muted_id', profile.id);
        setIsMuted(false);
      } else {
        await supabase.from('mutes').insert({ muter_id: currentUser.id, muted_id: profile.id });
        setIsMuted(true);
      }
      setMenuOpen(false);
    } catch (error: any) {
      toast.error(error?.message || 'Mute action failed');
    }
  };

  const shareProfile = async () => {
    if (!profile) return;
    const url = `${window.location.origin}/profile/${profile.username}`;
    try {
      if (navigator.share) await navigator.share({ title: `@${profile.username} on Testagram`, text: profile.bio || `View @${profile.username}'s profile`, url });
      else await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* user cancelled share */ }
  };

  const visiblePosts = useMemo(() => tab === 'media' ? posts.filter(post => post.media.length || post.media_url) : posts, [posts, tab]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>;
  }

  if (!profile) {
    return <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-6"><h1 className="text-xl font-bold">Profile not found</h1><p className="text-sm text-muted-foreground">This username does not exist on the production profile database.</p><button onClick={() => navigate('/')} className="px-4 py-2 rounded-full bg-primary text-primary-foreground">Go home</button></div>;
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="relative h-44 sm:h-56 bg-muted overflow-hidden">
        {profile.cover_url && <img src={profile.cover_url} alt="Profile cover" className="w-full h-full object-cover" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/35 to-transparent" />
      </div>

      <div className="px-4 sm:px-6">
        <div className="flex items-end justify-between -mt-14 relative">
          <Avatar profile={profile} size="lg" />
          <div className="flex items-center gap-2 pb-2">
            {isOwn ? (
              <button onClick={() => setShowEdit(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-background font-semibold text-sm"><Pencil className="w-4 h-4" />Edit profile</button>
            ) : (
              <button onClick={toggleFollow} className={`inline-flex items-center gap-2 px-4 py-2 rounded-full font-semibold text-sm ${isFollowing ? 'border border-border bg-background' : 'bg-primary text-primary-foreground'}`}>
                {isFollowing ? <Check className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                {isFollowing ? 'Following' : pendingFollow ? 'Requested' : 'Follow'}
              </button>
            )}
            <button onClick={shareProfile} className="w-10 h-10 rounded-full border border-border bg-background flex items-center justify-center" aria-label="Share profile">{copied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}</button>
            {!isOwn && <div className="relative"><button onClick={() => setMenuOpen(v => !v)} className="w-10 h-10 rounded-full border border-border bg-background flex items-center justify-center"><MoreHorizontal className="w-4 h-4" /></button>{menuOpen && <div className="absolute right-0 top-12 z-30 w-48 rounded-2xl border border-border bg-background shadow-xl p-1"><button onClick={toggleMute} className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl hover:bg-muted text-left text-sm"><VolumeX className="w-4 h-4" />{isMuted ? 'Unmute' : 'Mute'}</button><button onClick={toggleBlock} className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl hover:bg-muted text-left text-sm text-destructive"><ShieldBan className="w-4 h-4" />{isBlocked ? 'Unblock' : 'Block'}</button></div>}</div>}
          </div>
        </div>

        <div className="pt-3 pb-5">
          <div className="flex items-center gap-2"><h1 className="text-xl font-extrabold">{profile.display_name || profile.username}</h1>{profile.verified_tier && profile.verified_tier !== 'none' && <BadgeCheck className="w-5 h-5 text-primary" />}</div>
          <p className="text-sm text-muted-foreground">@{profile.username}</p>
          {profile.bio && <p className="mt-3 whitespace-pre-wrap leading-6">{profile.bio}</p>}
          <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3 text-sm text-muted-foreground">
            {profile.location && <span className="inline-flex items-center gap-1"><MapPin className="w-4 h-4" />{profile.location}</span>}
            {profile.website && <a href={profile.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><LinkIcon className="w-4 h-4" />Website</a>}
            <span className="inline-flex items-center gap-1"><Calendar className="w-4 h-4" />Joined {new Date(profile.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</span>
          </div>
          <div className="flex gap-5 mt-4 text-sm"><button onClick={() => setTab('followers')}><strong>{formatCount(followers.length)}</strong> <span className="text-muted-foreground">Followers</span></button><button onClick={() => setTab('following')}><strong>{formatCount(following.length)}</strong> <span className="text-muted-foreground">Following</span></button><span><strong>{formatCount(posts.length)}</strong> <span className="text-muted-foreground">Posts</span></span></div>
          {Object.values(profile.social_links ?? {}).some(Boolean) && <div className="flex gap-3 mt-3 text-sm"><span className="text-muted-foreground">Social:</span>{profile.social_links.twitter && <a href={`https://x.com/${profile.social_links.twitter.replace(/^@/, '')}`} target="_blank" rel="noreferrer" className="text-primary">X</a>}{profile.social_links.instagram && <a href={`https://instagram.com/${profile.social_links.instagram.replace(/^@/, '')}`} target="_blank" rel="noreferrer" className="text-primary">Instagram</a>}{profile.social_links.linkedin && <a href={profile.social_links.linkedin} target="_blank" rel="noreferrer" className="text-primary">LinkedIn</a>}</div>}
        </div>
      </div>

      <div className="sticky top-0 z-20 border-y border-border bg-background/95 backdrop-blur flex overflow-x-auto">
        {([['posts', 'Posts'], ['media', 'Media'], ['followers', 'Followers'], ['following', 'Following']] as const).map(([key, label]) => <button key={key} onClick={() => setTab(key)} className={`px-5 py-3.5 text-sm font-semibold shrink-0 border-b-2 ${tab === key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}>{label}</button>)}
      </div>

      {tab === 'followers' || tab === 'following' ? (
        <div className="divide-y divide-border">{(tab === 'followers' ? followers : following).map(item => <button key={item.id} onClick={() => navigate(`/profile/${item.username}`)} className="w-full p-4 flex items-center gap-3 text-left hover:bg-muted/20"><Avatar profile={item} size="sm" /><span className="min-w-0"><span className="block font-semibold truncate">{item.display_name || item.username}</span><span className="block text-sm text-muted-foreground truncate">@{item.username}</span></span></button>)}{(tab === 'followers' ? followers : following).length === 0 && <div className="p-10 text-center text-muted-foreground">No {tab} yet.</div>}</div>
      ) : (
        <div>{visiblePosts.map(post => <PostItem key={post.id} post={post} liked={likedPostIds.includes(post.id)} onLike={toggleLike} onOpen={id => navigate(`/post/${id}`)} />)}{visiblePosts.length === 0 && <div className="p-12 text-center text-muted-foreground"><ImageIcon className="w-8 h-8 mx-auto mb-2" /><p>No {tab === 'media' ? 'media' : 'posts'} yet.</p></div>}</div>
      )}

      {isOwn && <ProductionEditProfileDialog open={showEdit} onOpenChange={setShowEdit} profile={profile} onSuccess={loadProfile} />}
    </div>
  );
}
