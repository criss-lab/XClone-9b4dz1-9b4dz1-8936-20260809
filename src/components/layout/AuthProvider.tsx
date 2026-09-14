import { useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { authService, mapSupabaseUser } from '@/lib/auth';
import { useAuthStore } from '@/stores/authStore';
import { Capacitor, PushNotifications } from '@/lib/capacitor-stub';

async function triggerKeygenForUser(userId: string) {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const backendUrl = import.meta.env.VITE_SUPABASE_URL;
    if (!token || !backendUrl) return;
    const response = await fetch(`${backendUrl}/functions/v1/federation-provision-actor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ user_id: userId }),
    });
    if (!response.ok) throw new Error(`Federation actor provisioning returned ${response.status}`);
  } catch (err) {
    console.warn('[ActivityPub] Actor provisioning failed (non-fatal):', err);
  }
}

export async function sendActivityNotification({
  recipientUserId,
  title,
  body,
  data,
}: {
  recipientUserId: string;
  title: string;
  body: string;
  data?: any;
}) {
  try {
    const notificationType = data?.type && ['like', 'repost', 'follow', 'reply', 'mention', 'verified'].includes(data.type)
      ? data.type
      : 'follow';
    await supabase.from('notifications').insert({
      user_id: recipientUserId,
      type: notificationType,
      from_user_id: data?.fromUserId ?? null,
      post_id: data?.postId ?? null,
    });
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const backendUrl = import.meta.env.VITE_SUPABASE_URL;
    if (token && backendUrl) {
      fetch(`${backendUrl}/functions/v1/send-push-notification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: recipientUserId, title, body, data }),
      }).then(() => {}, () => {});
    }
  } catch (error) {
    console.warn('[Notification] Failed to send activity notification:', error);
  }
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
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const routeData = action.notification.data;
      if (routeData?.route) window.location.href = routeData.route;
    });
  } catch (err) {
    console.error('[Push] Setup error:', err);
  }
}

async function hydrateAuthenticatedUser(user: User) {
  const profile = await authService.ensureProfile(user);
  const mapped = mapSupabaseUser(user);
  if (profile?.username) mapped.username = profile.username;
  if (profile?.avatar_url) mapped.avatar = profile.avatar_url;
  return mapped;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { login, logout, setLoading } = useAuthStore();

  useEffect(() => {
    let mounted = true;

    const hydrate = async (user: User) => {
      try {
        const mappedUser = await hydrateAuthenticatedUser(user);
        if (!mounted) return;
        login(mappedUser);
        setLoading(false);
        void registerPushNotifications(user.id);
        void triggerKeygenForUser(user.id);
      } catch (error) {
        console.error('[Auth] Profile hydration failed:', error);
        if (mounted) {
          login(mapSupabaseUser(user));
          setLoading(false);
        }
      }
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) void hydrate(session.user);
      else if (mounted) setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') && session?.user) {
        void hydrate(session.user);
      } else if (event === 'SIGNED_OUT') {
        logout();
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [login, logout, setLoading]);

  return <>{children}</>;
}
