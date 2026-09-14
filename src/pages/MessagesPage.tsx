import { useState, useEffect, useRef } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Send, Search, BadgeCheck, Loader2, ArrowLeft, MessageSquare,
  X, Image as ImageIcon, Mic, Square, Users, Plus, UserPlus, Trash2,
  Volume2, VolumeX, Edit3, Shield, UserMinus, Check
} from 'lucide-react';
import { useNotificationSound } from '@/hooks/useNotificationSound';
import { GifPicker } from '@/components/features/GifPicker';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PageAdBanner } from '@/components/features/AdSenseAd';
function MessagesAdBanner() { return <PageAdBanner />; }

type ChatMode = 'dms' | 'groups';

export default function MessagesPage() {
  useSEO({ noindex: true, title: 'Messages', url: '/messages' });
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // ── DM state ───────────────────────────────────────────────────
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [messageText, setMessageText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showUserSearch, setShowUserSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [convFilter, setConvFilter] = useState('');
  const [showGifPicker, setShowGifPicker] = useState(false);

  // ── Story reply preview ────────────────────────────────────────
  const storyUrl = searchParams.get('storyUrl');
  const [storyPreview, setStoryPreview] = useState<string | null>(storyUrl);

  // ── Group chat state ───────────────────────────────────────────
  const [chatMode, setChatMode] = useState<ChatMode>('dms');
  const [groups, setGroups] = useState<any[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<any>(null);
  const [groupMessages, setGroupMessages] = useState<any[]>([]);
  const [groupMembers, setGroupMembers] = useState<any[]>([]);
  const [groupMsgText, setGroupMsgText] = useState('');
  const [sendingGroup, setSendingGroup] = useState(false);
  const [loadingGroups, setLoadingGroups] = useState(false);
  // Create group
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupAvatar, setGroupAvatar] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<any[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberResults, setMemberResults] = useState<any[]>([]);
  const [creatingGroup, setCreatingGroup] = useState(false);
  // Group members panel
  const [showGroupMembers, setShowGroupMembers] = useState(false);
  // Group admin controls
  const [showEditGroup, setShowEditGroup] = useState(false);
  const [editGroupName, setEditGroupName] = useState('');
  const [editGroupAvatar, setEditGroupAvatar] = useState('');
  const [savingGroupEdit, setSavingGroupEdit] = useState(false);
  const [memberActionId, setMemberActionId] = useState<string | null>(null);

  // Notification sounds
  const { play: playSound, isEnabled: isSoundEnabled, setEnabled: setSoundEnabled } = useNotificationSound();
  const [soundOn, setSoundOn] = useState(isSoundEnabled());
  const prevMsgCountRef = useRef(0);
  const prevGroupMsgCountRef = useRef(0);
  const toggleSound = () => { const next = !soundOn; setSoundEnabled(next); setSoundOn(next); };

  // ── Voice recording state ──────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false);
  const [uploadingVoice, setUploadingVoice] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── In-thread search ───────────────────────────────────────────
  const [showMsgSearch, setShowMsgSearch] = useState(false);
  const [msgSearchQuery, setMsgSearchQuery] = useState('');
  const [msgSearchResults, setMsgSearchResults] = useState<any[]>([]);
  const [searchingMsgs, setSearchingMsgs] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const groupPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // DM polling — 3-second fallback for when realtime misses messages
  const dmPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastDmCountRef = useRef(0);

  const scrollToBottom = () => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); };
  useEffect(() => { scrollToBottom(); }, [messages, groupMessages]);

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    fetchConversations();
    fetchGroups();
    const recipientUsername = searchParams.get('to');
    if (recipientUsername) startConversationWithUser(recipientUsername);
  }, [user]);

  useEffect(() => {
    if (!selectedConversation) {
      if (dmPollRef.current) clearInterval(dmPollRef.current);
      return;
    }
    fetchMessages(selectedConversation.id);
    // Realtime subscription
    const subscription = supabase
      .channel(`conversation:${selectedConversation.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `conversation_id=eq.${selectedConversation.id}` },
        (payload) => {
          setMessages(prev => {
            // Deduplicate by id
            if (prev.some(m => m.id === payload.new.id)) return prev;
            if ((payload.new as any).sender_id !== user?.id) playSound('dm');
            return [...prev, payload.new];
          });
          scrollToBottom();
        })
      .subscribe();
    // 3-second polling fallback — catches missed realtime events
    dmPollRef.current = setInterval(async () => {
      const { data } = await supabase
        .from('direct_messages')
        .select('*, sender:user_profiles!direct_messages_sender_id_fkey(*)')
        .eq('conversation_id', selectedConversation.id)
        .order('created_at', { ascending: true });
      const newMsgs = data ?? [];
      if (newMsgs.length > lastDmCountRef.current) {
        const incoming = newMsgs.slice(lastDmCountRef.current).filter((m: any) => m.sender_id !== user?.id);
        if (incoming.length > 0) {
          playSound('dm');
          scrollToBottom();
        }
        lastDmCountRef.current = newMsgs.length;
        setMessages(newMsgs);
        // Mark as read
        await supabase.from('direct_messages').update({ read: true })
          .eq('conversation_id', selectedConversation.id).eq('read', false).neq('sender_id', user!.id).then(() => {}, () => {});
        // Update unread badge in conversation list
        setConversations(prev => prev.map(c =>
          c.id === selectedConversation.id ? { ...c, unreadCount: 0 } : c
        ));
      }
    }, 3000);
    return () => {
      subscription.unsubscribe();
      if (dmPollRef.current) clearInterval(dmPollRef.current);
    };
  }, [selectedConversation?.id]);

  // Poll group messages every 3s
  useEffect(() => {
    if (selectedGroup) {
      fetchGroupMessages(selectedGroup.id);
      fetchGroupMembers(selectedGroup.id);
      groupPollRef.current = setInterval(() => fetchGroupMessages(selectedGroup.id), 3000);
    } else {
      if (groupPollRef.current) clearInterval(groupPollRef.current);
    }
    return () => { if (groupPollRef.current) clearInterval(groupPollRef.current); };
  }, [selectedGroup]);

  // ── DM helpers ─────────────────────────────────────────────────
  const startConversationWithUser = async (username: string) => {
    const { data: recipientProfile } = await supabase.from('user_profiles').select('*').eq('username', username).single();
    if (!recipientProfile) { toast.error('User not found'); return; }
    const { data: existing } = await supabase.from('conversations').select('*')
      .or(`and(participant_1.eq.${user!.id},participant_2.eq.${recipientProfile.id}),and(participant_1.eq.${recipientProfile.id},participant_2.eq.${user!.id})`)
      .maybeSingle();
    if (existing) {
      setSelectedConversation({ ...existing, otherUser: recipientProfile });
    } else {
      const { data: newConv } = await supabase.from('conversations')
        .insert({ participant_1: user!.id, participant_2: recipientProfile.id }).select().single();
      if (newConv) setSelectedConversation({ ...newConv, otherUser: recipientProfile });
    }
    setChatMode('dms');
  };

  const fetchConversations = async () => {
    if (!user) return;
    const { data } = await supabase.from('conversations').select('*')
      .or(`participant_1.eq.${user.id},participant_2.eq.${user.id}`)
      .order('last_message_at', { ascending: false });
    const enriched = await Promise.all((data || []).map(async (conv) => {
      const otherUserId = conv.participant_1 === user.id ? conv.participant_2 : conv.participant_1;
      const { data: otherUser } = await supabase.from('user_profiles').select('*').eq('id', otherUserId).single();
      const { data: lastMsg } = await supabase.from('direct_messages').select('*').eq('conversation_id', conv.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      const { count: unread } = await supabase.from('direct_messages').select('*', { count: 'exact', head: true }).eq('conversation_id', conv.id).eq('read', false).neq('sender_id', user.id);
      return { ...conv, otherUser, lastMessage: lastMsg, unreadCount: unread ?? 0 };
    }));
    setConversations(enriched);
    setLoading(false);
  };

  const fetchMessages = async (conversationId: string) => {
    const { data } = await supabase.from('direct_messages')
      .select(`*, sender:user_profiles!direct_messages_sender_id_fkey(*)`)
      .eq('conversation_id', conversationId).order('created_at', { ascending: true });
    const newMsgs = data || [];
    const incoming = newMsgs.filter((m: any) => m.sender_id !== user?.id);
    if (incoming.length > prevMsgCountRef.current) playSound('dm');
    prevMsgCountRef.current = incoming.length;
    setMessages(newMsgs);
    await supabase.from('direct_messages').update({ read: true })
      .eq('conversation_id', conversationId).eq('read', false).neq('sender_id', user!.id);
    setMessages(prev => prev.map(m => m.sender_id !== user!.id ? { ...m, read: true } : m));
    fetchConversations();
  };

  const sendMessage = async () => {
    const textToSend = storyPreview
      ? `📸 Story: ${storyPreview}${messageText.trim() ? '\n' + messageText.trim() : ''}`
      : messageText.trim();
    if (!textToSend || !selectedConversation) return;
    setSending(true);
    setMessageText('');
    setStoryPreview(null);
    const { error } = await supabase.from('direct_messages').insert({
      conversation_id: selectedConversation.id, sender_id: user!.id, content: textToSend,
    });
    if (error) { toast.error(error.message); setMessageText(textToSend); }
    else {
      await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', selectedConversation.id);
      fetchConversations();
    }
    setSending(false);
  };

  // ── Group helpers ──────────────────────────────────────────────
  const fetchGroups = async () => {
    if (!user) return;
    setLoadingGroups(true);
    const { data: memberRows } = await supabase.from('group_members').select('group_id').eq('user_id', user.id);
    if (!memberRows?.length) { setGroups([]); setLoadingGroups(false); return; }
    const groupIds = memberRows.map((r: any) => r.group_id);
    const { data: groupData } = await supabase.from('group_conversations').select('*').in('id', groupIds).order('last_message_at', { ascending: false });
    const enriched = await Promise.all((groupData ?? []).map(async (g: any) => {
      const { data: lastMsg } = await supabase.from('group_messages').select('*').eq('group_id', g.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      const { count: memberCount } = await supabase.from('group_members').select('*', { count: 'exact', head: true }).eq('group_id', g.id);
      return { ...g, lastMessage: lastMsg, memberCount: memberCount ?? 0 };
    }));
    setGroups(enriched);
    setLoadingGroups(false);
  };

  const fetchGroupMessages = async (groupId: string) => {
    const { data } = await supabase.from('group_messages')
      .select('*, sender:user_profiles!group_messages_sender_id_fkey(id, username, avatar_url, verified)')
      .eq('group_id', groupId).order('created_at', { ascending: true });
    const newMsgs = data ?? [];
    if (newMsgs.length > prevGroupMsgCountRef.current) playSound('group');
    prevGroupMsgCountRef.current = newMsgs.length;
    setGroupMessages(newMsgs);
  };

  const fetchGroupMembers = async (groupId: string) => {
    const { data } = await supabase.from('group_members')
      .select('*, user:user_profiles!group_members_user_id_fkey(id, username, avatar_url, verified)')
      .eq('group_id', groupId);
    setGroupMembers(data ?? []);
  };

  const sendGroupMessage = async () => {
    if (!groupMsgText.trim() || !selectedGroup) return;
    setSendingGroup(true);
    const text = groupMsgText.trim();
    setGroupMsgText('');
    await supabase.from('group_messages').insert({ group_id: selectedGroup.id, sender_id: user!.id, content: text });
    await supabase.from('group_conversations').update({ last_message_at: new Date().toISOString() }).eq('id', selectedGroup.id);
    setSendingGroup(false);
    fetchGroups();
  };

  const createGroup = async () => {
    if (!groupName.trim() || selectedMembers.length === 0) { toast.error('Enter a name and add at least one member'); return; }
    setCreatingGroup(true);
    const { data: group } = await supabase.from('group_conversations')
      .insert({ name: groupName.trim(), avatar_url: groupAvatar || null, creator_id: user!.id }).select().single();
    if (!group) { toast.error('Failed to create group'); setCreatingGroup(false); return; }
    const memberInserts = [
      { group_id: group.id, user_id: user!.id, role: 'admin' },
      ...selectedMembers.map(m => ({ group_id: group.id, user_id: m.id, role: 'member' })),
    ];
    await supabase.from('group_members').insert(memberInserts);
    toast.success(`Group "${groupName}" created!`);
    setShowCreateGroup(false);
    setGroupName('');
    setGroupAvatar('');
    setSelectedMembers([]);
    setMemberSearch('');
    setMemberResults([]);
    setCreatingGroup(false);
    fetchGroups();
    setSelectedGroup({ ...group, memberCount: selectedMembers.length + 1 });
    setChatMode('groups');
  };

  const searchMembers = async (q: string) => {
    if (!q.trim()) { setMemberResults([]); return; }
    const { data } = await supabase.from('user_profiles').select('id, username, avatar_url, verified')
      .ilike('username', `%${q}%`).neq('id', user!.id).limit(8);
    setMemberResults((data ?? []).filter((u: any) => !selectedMembers.find(m => m.id === u.id)));
  };

  const saveGroupEdit = async () => {
    if (!selectedGroup || !editGroupName.trim()) return;
    setSavingGroupEdit(true);
    await supabase.from('group_conversations')
      .update({ name: editGroupName.trim(), avatar_url: editGroupAvatar || null })
      .eq('id', selectedGroup.id);
    setSelectedGroup((g: any) => ({ ...g, name: editGroupName.trim(), avatar_url: editGroupAvatar || null }));
    setGroups(prev => prev.map(g => g.id === selectedGroup.id ? { ...g, name: editGroupName.trim(), avatar_url: editGroupAvatar || null } : g));
    toast.success('Group updated'); setShowEditGroup(false); setSavingGroupEdit(false);
  };

  const removeMember = async (memberId: string) => {
    if (!selectedGroup) return;
    await supabase.from('group_members').delete().eq('group_id', selectedGroup.id).eq('user_id', memberId);
    setGroupMembers(prev => prev.filter((m: any) => m.user_id !== memberId));
    setMemberActionId(null); toast.success('Member removed');
  };

  const promoteToAdmin = async (memberId: string) => {
    if (!selectedGroup) return;
    await supabase.from('group_members').update({ role: 'admin' }).eq('group_id', selectedGroup.id).eq('user_id', memberId);
    setGroupMembers(prev => prev.map((m: any) => m.user_id === memberId ? { ...m, role: 'admin' } : m));
    setMemberActionId(null); toast.success('Promoted to admin');
  };

  const leaveGroup = async (groupId: string) => {
    await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', user!.id);
    setSelectedGroup(null);
    fetchGroups();
    toast.success('Left group');
  };

  const filteredConversations = convFilter.trim()
    ? conversations.filter(c => c.otherUser?.username?.toLowerCase().includes(convFilter.toLowerCase()))
    : conversations;

  const searchMessages = async (query: string) => {
    if (!query.trim() || !selectedConversation) { setMsgSearchResults([]); return; }
    setSearchingMsgs(true);
    const { data } = await supabase.from('direct_messages').select('*').eq('conversation_id', selectedConversation.id).ilike('content', `%${query}%`).order('created_at', { ascending: false }).limit(50);
    setMsgSearchResults(data ?? []);
    setSearchingMsgs(false);
  };

  const searchUsers = async (query: string) => {
    if (!query.trim()) { setSearchResults([]); return; }
    const { data } = await supabase.from('user_profiles').select('*').or(`username.ilike.%${query}%,email.ilike.%${query}%`).neq('id', user!.id).limit(10);
    setSearchResults(data || []);
  };

  const startVoiceRecording = async () => {
    if (!selectedConversation) { toast.error('Select a conversation first'); return; }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(e => { toast.error(e.message); return null; });
    if (!stream) return;
    const mr = new MediaRecorder(stream);
    audioChunksRef.current = [];
    mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
    mr.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      setUploadingVoice(true);
      const fileName = `voice/${user!.id}/${Date.now()}.webm`;
      const { error } = await supabase.storage.from('posts').upload(fileName, blob);
      if (!error) {
        const { data: { publicUrl } } = supabase.storage.from('posts').getPublicUrl(fileName);
        await supabase.from('direct_messages').insert({ conversation_id: selectedConversation.id, sender_id: user!.id, content: publicUrl });
        await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', selectedConversation.id);
        fetchConversations();
      } else { toast.error('Failed to send voice message'); }
      setUploadingVoice(false);
    };
    mr.start();
    mediaRecorderRef.current = mr;
    setIsRecording(true);
    recordingTimerRef.current = setTimeout(stopVoiceRecording, 60000);
  };

  const stopVoiceRecording = () => {
    if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
    setIsRecording(false);
  };

  const handleGifSelect = async (gifUrl: string) => {
    setShowGifPicker(false);
    if (!selectedConversation) return;
    setSending(true);
    await supabase.from('direct_messages').insert({ conversation_id: selectedConversation.id, sender_id: user!.id, content: gifUrl });
    await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', selectedConversation.id);
    fetchConversations();
    setSending(false);
  };

  if (!user) return null;
  if (loading && !conversations.length) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const hasActiveChat = selectedConversation || selectedGroup;

  return (
    <div className="flex flex-col bg-background" style={{ height: '100dvh' }}>
      {showGifPicker && <GifPicker onSelect={handleGifSelect} onClose={() => setShowGifPicker(false)} />}
      {!hasActiveChat && <TopBar />}
      {!hasActiveChat && <MessagesAdBanner />}

      {/* Create Group Dialog */}
      {showCreateGroup && (
        <div className="fixed inset-0 z-[300] bg-black/60" onClick={() => setShowCreateGroup(false)}>
          <div className="absolute bottom-0 left-0 right-0 bg-background rounded-t-3xl p-5 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg">New Group</h2>
              <button onClick={() => setShowCreateGroup(false)} className="p-2 rounded-full hover:bg-muted"><X className="w-5 h-5" /></button>
            </div>
            <input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Group name *" className="w-full px-4 py-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            <input value={groupAvatar} onChange={e => setGroupAvatar(e.target.value)} placeholder="Avatar URL (optional)" className="w-full px-4 py-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            {selectedMembers.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {selectedMembers.map(m => (
                  <div key={m.id} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-primary/10 border border-primary/20 rounded-full text-xs font-semibold">
                    <div className="w-5 h-5 rounded-full bg-muted overflow-hidden">
                      {m.avatar_url ? <img src={m.avatar_url} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-[9px] font-bold">{m.username[0]?.toUpperCase()}</div>}
                    </div>
                    <span>{m.username}</span>
                    <button onClick={() => setSelectedMembers(p => p.filter(x => x.id !== m.id))} className="text-muted-foreground hover:text-destructive"><X className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input value={memberSearch} onChange={e => { setMemberSearch(e.target.value); searchMembers(e.target.value); }}
                placeholder="Search users to add…"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            {memberResults.length > 0 && (
              <div className="border border-border rounded-xl max-h-40 overflow-y-auto">
                {memberResults.map(u => (
                  <button key={u.id} onClick={() => { setSelectedMembers(p => [...p, u]); setMemberResults(p => p.filter(x => x.id !== u.id)); setMemberSearch(''); }}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted text-left">
                    <div className="w-9 h-9 rounded-full bg-muted overflow-hidden shrink-0">
                      {u.avatar_url ? <img src={u.avatar_url} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center font-bold text-sm">{u.username[0]?.toUpperCase()}</div>}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{u.username}</p>
                      <p className="text-xs text-muted-foreground">@{u.username}</p>
                    </div>
                    <UserPlus className="ml-auto w-4 h-4 text-primary" />
                  </button>
                ))}
              </div>
            )}
            <button onClick={createGroup} disabled={creatingGroup || !groupName.trim() || selectedMembers.length === 0}
              className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2">
              {creatingGroup ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
              {creatingGroup ? 'Creating…' : 'Create Group'}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* ── Sidebar ── */}
        <div className={`${hasActiveChat ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-80 border-r border-border`}>
          <div className="flex p-3 gap-2 border-b border-border shrink-0">
            <button onClick={() => setChatMode('dms')}
              className={`flex-1 py-2 rounded-full text-sm font-semibold transition-colors ${chatMode === 'dms' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
              Direct
            </button>
            <button onClick={() => setChatMode('groups')}
              className={`flex-1 py-2 rounded-full text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 ${chatMode === 'groups' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
              <Users className="w-3.5 h-3.5" />Groups
            </button>
          </div>

          {chatMode === 'dms' && (
            <>
              <div className="p-3 border-b border-border shrink-0 space-y-2">
                <Button onClick={() => setShowUserSearch(!showUserSearch)} className="w-full rounded-full">New Message</Button>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <input type="text" placeholder="Filter conversations…" value={convFilter} onChange={e => setConvFilter(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-muted rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground" />
                  {convFilter && <button onClick={() => setConvFilter('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>}
                </div>
              </div>
              {showUserSearch && (
                <div className="p-3 border-b border-border shrink-0">
                  <Input placeholder="Search users..." value={searchQuery} onChange={e => { setSearchQuery(e.target.value); searchUsers(e.target.value); }} className="rounded-full" autoFocus />
                  {searchResults.length > 0 && (
                    <div className="mt-2 bg-background border border-border rounded-lg max-h-60 overflow-y-auto">
                      {searchResults.map(r => (
                        <button key={r.id} onClick={() => { startConversationWithUser(r.username); setShowUserSearch(false); setSearchQuery(''); setSearchResults([]); }}
                          className="w-full p-3 hover:bg-muted flex items-center gap-3 text-left">
                          <div className="w-10 h-10 rounded-full bg-muted overflow-hidden shrink-0">
                            {r.avatar_url ? <img src={r.avatar_url} alt={r.username} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-bold">{r.username[0].toUpperCase()}</div>}
                          </div>
                          <div><div className="flex items-center gap-1"><span className="font-semibold">{r.username}</span>{r.verified && <BadgeCheck className="w-4 h-4 text-primary" />}</div><p className="text-sm text-muted-foreground">@{r.username}</p></div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="flex-1 overflow-y-auto">
                {filteredConversations.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-40" />
                    <p className="font-semibold mb-1">No messages yet</p>
                    <p className="text-sm">Start a conversation</p>
                  </div>
                ) : filteredConversations.map(conv => (
                  <button key={conv.id} onClick={() => { setSelectedConversation(conv); setSelectedGroup(null); }}
                    className={`w-full p-4 border-b border-border hover:bg-muted/50 flex items-start gap-3 text-left transition-colors ${selectedConversation?.id === conv.id ? 'bg-muted' : ''}`}>
                    <div className="w-12 h-12 rounded-full bg-muted overflow-hidden shrink-0">
                      {conv.otherUser?.avatar_url ? <img src={conv.otherUser.avatar_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-bold">{conv.otherUser?.username?.[0]?.toUpperCase()}</div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 mb-1">
                        <span className={`truncate ${conv.unreadCount > 0 ? 'font-bold text-foreground' : 'font-semibold'}`}>{conv.otherUser?.username}</span>
                        {conv.otherUser?.verified && <BadgeCheck className="w-4 h-4 text-primary shrink-0" />}
                        {conv.unreadCount > 0 && <span className="ml-auto shrink-0 min-w-[18px] h-[18px] bg-primary text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center px-1">{conv.unreadCount > 99 ? '99+' : conv.unreadCount}</span>}
                      </div>
                      {conv.lastMessage && <>
                        <p className={`text-sm truncate ${conv.unreadCount > 0 ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{conv.lastMessage.sender_id === user.id && 'You: '}{conv.lastMessage.content}</p>
                        <p className="text-xs text-muted-foreground mt-1">{formatDistanceToNow(new Date(conv.lastMessage.created_at), { addSuffix: true })}</p>
                      </>}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {chatMode === 'groups' && (
            <>
              <div className="p-3 border-b border-border shrink-0">
                <Button onClick={() => setShowCreateGroup(true)} className="w-full rounded-full flex items-center gap-2">
                  <Plus className="w-4 h-4" />New Group
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {loadingGroups ? (
                  <div className="flex items-center justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
                ) : groups.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    <Users className="w-12 h-12 mx-auto mb-3 opacity-40" />
                    <p className="font-semibold mb-1">No groups yet</p>
                    <p className="text-sm">Create a group to chat with multiple people</p>
                  </div>
                ) : groups.map(g => (
                  <button key={g.id} onClick={() => { setSelectedGroup(g); setSelectedConversation(null); }}
                    className={`w-full p-4 border-b border-border hover:bg-muted/50 flex items-start gap-3 text-left transition-colors ${selectedGroup?.id === g.id ? 'bg-muted' : ''}`}>
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary/20 to-purple-500/20 overflow-hidden shrink-0 flex items-center justify-center">
                      {g.avatar_url ? <img src={g.avatar_url} alt={g.name} className="w-full h-full object-cover" /> : <Users className="w-6 h-6 text-primary" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{g.name}</p>
                      <p className="text-xs text-muted-foreground">{g.memberCount} members</p>
                      {g.lastMessage && <p className="text-sm text-muted-foreground truncate mt-0.5">{g.lastMessage.content}</p>}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── Chat Area ── */}
        <div className={`${hasActiveChat ? 'flex' : 'hidden md:flex'} flex-col flex-1 min-w-0 min-h-0`}>
          {selectedConversation && !selectedGroup && (
            <>
              <div className="p-3 border-b border-border flex items-center gap-3 shrink-0 bg-background">
                <button onClick={() => setSelectedConversation(null)} className="md:hidden p-2 hover:bg-muted rounded-full"><ArrowLeft className="w-5 h-5" /></button>
                <div className="w-10 h-10 rounded-full bg-muted overflow-hidden shrink-0">
                  {selectedConversation.otherUser?.avatar_url ? <img src={selectedConversation.otherUser.avatar_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-bold">{selectedConversation.otherUser?.username?.[0]?.toUpperCase()}</div>}
                </div>
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/profile/${selectedConversation.otherUser?.username}`)}>
                  <div className="flex items-center gap-1"><span className="font-bold truncate">{selectedConversation.otherUser?.username}</span>{selectedConversation.otherUser?.verified && <BadgeCheck className="w-4 h-4 text-primary shrink-0" />}</div>
                  <p className="text-xs text-muted-foreground">@{selectedConversation.otherUser?.username}</p>
                </div>
                <button onClick={() => { setShowMsgSearch(s => !s); setMsgSearchQuery(''); setMsgSearchResults([]); }}
                  className={`p-2 rounded-full transition-colors ${showMsgSearch ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}>
                  <Search className="w-4 h-4" />
                </button>
              </div>
              {showMsgSearch && (
                <div className="px-3 py-2 border-b border-border bg-background shrink-0">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <input autoFocus type="text" placeholder="Search in this conversation…" value={msgSearchQuery}
                      onChange={e => { setMsgSearchQuery(e.target.value); searchMessages(e.target.value); }}
                      className="w-full pl-9 pr-9 py-2 bg-muted rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                    {msgSearchQuery && <button onClick={() => { setMsgSearchQuery(''); setMsgSearchResults([]); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>}
                  </div>
                  {msgSearchQuery.trim() && (
                    <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
                      {searchingMsgs ? <div className="flex items-center justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-primary" /></div>
                        : msgSearchResults.length === 0 ? <p className="text-xs text-muted-foreground text-center py-3">No messages found</p>
                        : msgSearchResults.map(m => (
                          <div key={m.id} className={`px-3 py-2 rounded-xl text-xs leading-relaxed border ${m.sender_id === user.id ? 'bg-primary/8 border-primary/15 ml-6' : 'bg-muted border-border mr-6'}`}>
                            <span className="font-semibold text-[10px] text-muted-foreground block mb-0.5">{m.sender_id === user.id ? 'You' : selectedConversation.otherUser?.username} · {formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}</span>
                            {m.content}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
                {storyPreview && (
                  <div className="mx-auto max-w-xs p-3 bg-muted/50 rounded-2xl border border-border text-center">
                    <p className="text-xs text-muted-foreground mb-2">Replying to story</p>
                    <img src={storyPreview} alt="story" className="w-full max-h-40 object-contain rounded-xl mb-2" onError={() => setStoryPreview(null)} />
                    <button onClick={() => setStoryPreview(null)} className="text-xs text-muted-foreground hover:text-destructive"><X className="w-3 h-3 inline mr-1" />Remove preview</button>
                  </div>
                )}
                {messages.length === 0 && <div className="text-center py-12 text-muted-foreground text-sm">Start a conversation with {selectedConversation.otherUser?.username}</div>}
                {messages.map(message => {
                  const isGif = message.content?.startsWith('https://media.tenor.com') || message.content?.endsWith('.gif');
                  const isVoice = message.content?.includes('/voice/') && (message.content?.endsWith('.webm') || message.content?.endsWith('.mp3'));
                  return (
                    <div key={message.id} className={`flex ${message.sender_id === user.id ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] rounded-2xl overflow-hidden ${isGif || isVoice ? 'bg-transparent' : message.sender_id === user.id ? 'px-4 py-2.5 bg-primary text-primary-foreground rounded-br-sm' : 'px-4 py-2.5 bg-muted rounded-bl-sm'}`}>
                        {isGif ? <img src={message.content} alt="GIF" className="rounded-2xl max-w-full max-h-56 object-contain" />
                          : isVoice ? <div className={`flex items-center gap-2 px-3 py-2.5 rounded-2xl min-w-[180px] ${message.sender_id === user.id ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-muted rounded-bl-sm'}`}><Mic className="w-4 h-4 shrink-0 opacity-70" /><audio src={message.content} controls className="flex-1 h-8 min-w-0" /></div>
                          : <p className="break-words text-sm leading-relaxed">{message.content}</p>}
                        <div className={`flex items-center justify-end gap-1 mt-1 ${message.sender_id === user.id ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                          <span className="text-xs">{formatDistanceToNow(new Date(message.created_at), { addSuffix: true })}</span>
                          {message.sender_id === user.id && <span className="text-[11px] font-medium">{message.read ? '✓✓' : '✓'}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
              <div className="shrink-0 border-t border-border bg-background px-3 py-3">
                {storyPreview && (
                  <div className="mb-2 flex items-center gap-2 px-3 py-1.5 bg-primary/5 border border-primary/20 rounded-xl">
                    <img src={storyPreview} className="w-8 h-8 rounded-lg object-cover" alt="" />
                    <span className="text-xs text-muted-foreground flex-1">📸 Story attached</span>
                    <button onClick={() => setStoryPreview(null)} className="text-muted-foreground hover:text-destructive"><X className="w-3.5 h-3.5" /></button>
                  </div>
                )}
                <div className="flex items-center gap-2 bg-muted rounded-full px-4 py-1">
                  <input type="text" placeholder={storyPreview ? 'Add a message… (optional)' : 'Type a message...'}
                    value={messageText} onChange={e => setMessageText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    className="flex-1 bg-transparent outline-none text-sm py-2 min-w-0" />
                  <button onClick={() => setShowGifPicker(true)} className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-muted/70"><ImageIcon className="w-4 h-4" /></button>
                  <button onClick={isRecording ? stopVoiceRecording : startVoiceRecording} disabled={uploadingVoice}
                    className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-full transition-colors ${isRecording ? 'bg-red-500 text-white animate-pulse' : uploadingVoice ? 'bg-muted opacity-50' : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}>
                    {uploadingVoice ? <Loader2 className="w-4 h-4 animate-spin" /> : isRecording ? <Square className="w-4 h-4 fill-current" /> : <Mic className="w-4 h-4" />}
                  </button>
                  <button onClick={sendMessage} disabled={(!messageText.trim() && !storyPreview) || sending}
                    className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40">
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </>
          )}

          {selectedGroup && !selectedConversation && (
            <>
              <div className="p-3 border-b border-border flex items-center gap-3 shrink-0 bg-background">
                <button onClick={() => setSelectedGroup(null)} className="md:hidden p-2 hover:bg-muted rounded-full"><ArrowLeft className="w-5 h-5" /></button>
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/20 to-purple-500/20 overflow-hidden shrink-0 flex items-center justify-center">
                  {selectedGroup.avatar_url ? <img src={selectedGroup.avatar_url} alt="" className="w-full h-full object-cover" /> : <Users className="w-5 h-5 text-primary" />}
                </div>
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setShowGroupMembers(v => !v)}>
                  <p className="font-bold truncate">{selectedGroup.name}</p>
                  <p className="text-xs text-muted-foreground">{selectedGroup.memberCount} members · tap to view</p>
                </div>
                <button onClick={toggleSound} className="p-2 rounded-full text-muted-foreground hover:bg-muted transition-colors">
                  {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                </button>
                {user?.id === selectedGroup.creator_id && (
                  <button onClick={() => { setEditGroupName(selectedGroup.name); setEditGroupAvatar(selectedGroup.avatar_url ?? ''); setShowEditGroup(true); }}
                    className="p-2 rounded-full text-muted-foreground hover:bg-muted transition-colors">
                    <Edit3 className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => leaveGroup(selectedGroup.id)} className="p-2 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {showGroupMembers && (
                <div className="border-b border-border bg-muted/20 p-3 flex gap-3 overflow-x-auto scrollbar-hide shrink-0">
                  {groupMembers.map(m => (
                    <div key={m.id} className="flex flex-col items-center gap-1 shrink-0 relative">
                      <button onClick={() => setMemberActionId(memberActionId === m.user_id ? null : m.user_id)}
                        className="w-10 h-10 rounded-full bg-muted overflow-hidden ring-2 ring-offset-1 ring-offset-background ring-border hover:ring-primary/40 transition-all">
                        {m.user?.avatar_url ? <img src={m.user.avatar_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-sm font-bold">{m.user?.username?.[0]?.toUpperCase()}</div>}
                      </button>
                      <span className="text-[9px] text-muted-foreground max-w-[40px] truncate">{m.user?.username}</span>
                      {m.role === 'admin' && <span className="text-[8px] bg-primary/10 text-primary px-1 rounded-full font-bold">Admin</span>}
                      {memberActionId === m.user_id && user?.id === selectedGroup.creator_id && m.user_id !== user?.id && (
                        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-50 bg-background border border-border rounded-xl shadow-xl py-1 min-w-[130px]">
                          {m.role !== 'admin' && (
                            <button onClick={() => promoteToAdmin(m.user_id)} className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted transition-colors">
                              <Shield className="w-3.5 h-3.5 text-primary" />Make Admin
                            </button>
                          )}
                          <button onClick={() => removeMember(m.user_id)} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-destructive hover:bg-destructive/10 transition-colors">
                            <UserMinus className="w-3.5 h-3.5" />Remove
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
                {groupMessages.length === 0 && <div className="text-center py-12 text-muted-foreground text-sm">No messages yet — say hi! 👋</div>}
                {groupMessages.map(msg => {
                  const isMine = msg.sender_id === user.id;
                  return (
                    <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'} gap-2`}>
                      {!isMine && (
                        <div className="w-7 h-7 rounded-full bg-muted overflow-hidden shrink-0 mt-auto mb-5">
                          {msg.sender?.avatar_url ? <img src={msg.sender.avatar_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-[10px] font-bold">{msg.sender?.username?.[0]?.toUpperCase()}</div>}
                        </div>
                      )}
                      <div className="max-w-[72%]">
                        {!isMine && <p className="text-[10px] text-muted-foreground mb-0.5 ml-1">@{msg.sender?.username}</p>}
                        <div className={`px-4 py-2.5 rounded-2xl ${isMine ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-muted rounded-bl-sm'}`}>
                          <p className="break-words text-sm leading-relaxed">{msg.content}</p>
                        </div>
                        <p className={`text-xs text-muted-foreground mt-0.5 ${isMine ? 'text-right' : 'text-left'}`}>{formatDistanceToNow(new Date(msg.created_at), { addSuffix: true })}</p>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
              <div className="shrink-0 border-t border-border bg-background px-3 py-3">
                <div className="flex items-center gap-2 bg-muted rounded-full px-4 py-1">
                  <input type="text" placeholder="Message group…" value={groupMsgText} onChange={e => setGroupMsgText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendGroupMessage(); } }}
                    className="flex-1 bg-transparent outline-none text-sm py-2 min-w-0" />
                  <button onClick={sendGroupMessage} disabled={!groupMsgText.trim() || sendingGroup}
                    className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40">
                    {sendingGroup ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </>
          )}

          {!hasActiveChat && (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Send className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p className="font-semibold text-lg mb-2">Select a conversation</p>
                <p className="text-sm">Choose from DMs or Groups</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
