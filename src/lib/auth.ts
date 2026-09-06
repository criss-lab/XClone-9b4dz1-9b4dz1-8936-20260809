import { supabase, type User } from './cloudflare';
import { AuthUser } from '@/types/app-types';

export function mapSupabaseUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email || '',
    username: user.user_metadata?.username || user.user_metadata?.full_name || user.email?.split('@')[0] || user.id.slice(0, 8),
    avatar: user.user_metadata?.avatar_url || user.user_metadata?.picture,
  };
}

export class AuthService {
  async sendOtp(email: string) {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) throw error;
  }

  async verifyOtpAndSetPassword(email: string, token: string, password: string) {
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email', password });
    if (error) throw error;
    return data.user;
  }

  async signInWithPassword(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.user;
  }

  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  mapUser(user: User): AuthUser { return mapSupabaseUser(user); }
}

export const authService = new AuthService();
