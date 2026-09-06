import { useEffect } from 'react';
import { supabase } from '@/lib/cloudflare';
import { useAuthStore } from '@/stores/authStore';
import { mapSupabaseUser } from '@/lib/auth';
import { Capacitor, PushNotifications } from '@/lib/capacitor-stub';

const API_URL = (import.meta.env.VITE_CLOUDFLARE_API_URL || '').replace(/\/$/, '');

async function triggerKeygenForUser(userId: string) {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token || !API_URL) return;
    const existing = await supabase.from('activitypub_keys').select('id').eq('user_id', userId).maybeSingle();
    if (existing.data) return;
    await fetch(`${API_URL}/api/functions/activitypub-keygen`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ user_id: userId }),
    });
  } catch (err) { console.warn('[ActivityPub] Keygen failed (non-fatal):', err); }
}

export async function sendActivityNotification({ recipientUserId, title, body, data }: { recipientUserId: string; title: string; body: string; data?: any }) {
  try {
    const notificationType = data?.type && ['like','repost','follow','reply','mention','verified'].includes(data.type) ? data.type : 'follow';
    const { error: dbError } = await supabase.from('notifications').insert({ user_id: recipientUserId, type: notificationType, from_user_id: data?.fromUserId ?? null, post_id: data?.postId ?? null });
    if (dbError) console.warn('[Notification] DB insert failed:', dbError.message);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (token && API_URL) fetch(`${API_URL}/api/functions/send-push-notification`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ user_id: recipientUserId, title, body, data }) }).catch(() => {});
  } catch (error) { console.warn('[Notification] Failed:', error); }
}

async function registerPushNotifications(userId: string) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const permResult = await PushNotifications.requestPermissions();
    if (permResult.receive !== 'granted') return;
    await PushNotifications.register();
    PushNotifications.addListener('registration', async (token) => {
      await supabase.from('fcm_tokens').upsert({ user_id: userId, token: token.value, platform: Capacitor.getPlatform(), updated_at: new Date().toISOString() }, { onConflict: 'user_id,token' });
    });
    PushNotifications.addListener('registrationError', (error) => console.error('[Push] Registration error:', error));
    PushNotifications.addListener('pushNotificationReceived', (notification) => console.log('[Push] Received:', notification));
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => { const routeData = action.notification.data; if (routeData?.route) window.location.href = routeData.route; });
  } catch (err) { console.error('[Push] Setup error:', err); }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { login, logout, setLoading } = useAuthStore();
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (mounted && session?.user) { login(mapSupabaseUser(session.user)); registerPushNotifications(session.user.id); triggerKeygenForUser(session.user.id); }
      if (mounted) setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === 'SIGNED_IN' && session?.user) { login(mapSupabaseUser(session.user)); setLoading(false); registerPushNotifications(session.user.id); triggerKeygenForUser(session.user.id); }
      else if (event === 'SIGNED_OUT') { logout(); setLoading(false); }
      else if (event === 'TOKEN_REFRESHED' && session?.user) login(mapSupabaseUser(session.user));
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, [login, logout, setLoading]);
  return <>{children}</>;
}
