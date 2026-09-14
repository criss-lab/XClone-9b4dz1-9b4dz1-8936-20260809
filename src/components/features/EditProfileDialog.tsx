import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, Camera, Upload } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface EditProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile?: Record<string, any> | null;
  onSuccess: () => void | Promise<void>;
}

export function EditProfileDialog({ open, onOpenChange, profile, onSuccess }: EditProfileDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState(''); const [bio, setBio] = useState(''); const [website, setWebsite] = useState('');
  const [location, setLocation] = useState(''); const [birthDate, setBirthDate] = useState(''); const [phone, setPhone] = useState('');
  const [twitterHandle, setTwitterHandle] = useState(''); const [instagramHandle, setInstagramHandle] = useState(''); const [linkedinUrl, setLinkedinUrl] = useState('');
  const [avatar, setAvatar] = useState<File | null>(null); const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [coverImage, setCoverImage] = useState<File | null>(null); const [coverPreview, setCoverPreview] = useState<string | null>(null);

  useEffect(() => { if (user && open) loadCurrentProfile(); }, [user, open, profile]);
  const loadCurrentProfile = async () => {
    if (!user) return;
    try {
      const { data } = await supabase.from('user_profiles').select('*').eq('id', user.id).single();
      const current = data ?? profile;
      if (current) { setUsername(current.username || ''); setBio(current.bio || ''); setWebsite(current.website || ''); setLocation(current.location || ''); setBirthDate(current.birth_date || ''); setPhone(current.phone || ''); setTwitterHandle(current.twitter_handle || ''); setInstagramHandle(current.instagram_handle || ''); setLinkedinUrl(current.linkedin_url || ''); setAvatarPreview(current.avatar_url || null); setCoverPreview(current.cover_image || null); }
    } catch (error) { console.error('Error loading profile:', error); }
  };
  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 2 * 1024 * 1024) { toast({ title: 'Error', description: 'Image must be less than 2MB', variant: 'destructive' }); return; } setAvatar(file); setAvatarPreview(URL.createObjectURL(file)); };
  const handleCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 5 * 1024 * 1024) { toast({ title: 'Error', description: 'Cover image must be less than 5MB', variant: 'destructive' }); return; } setCoverImage(file); setCoverPreview(URL.createObjectURL(file)); };
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!user) return; setLoading(true);
    try {
      let avatarUrl = avatarPreview; let coverUrl = coverPreview;
      if (avatar) { const ext = avatar.name.split('.').pop(); const fileName = `avatars/${user.id}.${ext}`; const { error } = await supabase.storage.from('posts').upload(fileName, avatar, { cacheControl: '3600', upsert: true }); if (error) throw error; avatarUrl = supabase.storage.from('posts').getPublicUrl(fileName).data.publicUrl; }
      if (coverImage) { const ext = coverImage.name.split('.').pop(); const fileName = `covers/${user.id}.${ext}`; const { error } = await supabase.storage.from('posts').upload(fileName, coverImage, { cacheControl: '3600', upsert: true }); if (error) throw error; coverUrl = supabase.storage.from('posts').getPublicUrl(fileName).data.publicUrl; }
      const { error: updateError } = await supabase.from('user_profiles').update({ username: username.trim(), bio: bio.trim(), website: website.trim(), location: location.trim(), birth_date: birthDate || null, phone: phone.trim(), twitter_handle: twitterHandle.trim(), instagram_handle: instagramHandle.trim(), linkedin_url: linkedinUrl.trim(), avatar_url: avatarUrl, cover_image: coverUrl }).eq('id', user.id);
      if (updateError) throw updateError;
      await supabase.auth.updateUser({ data: { username: username.trim(), avatar_url: avatarUrl } });
      toast({ title: 'Success', description: 'Profile updated successfully' }); await onSuccess(); onOpenChange(false);
    } catch (error: any) { console.error('Error updating profile:', error); toast({ title: 'Error', description: error.message || 'Failed to update profile', variant: 'destructive' }); }
    finally { setLoading(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Edit profile</DialogTitle></DialogHeader><form onSubmit={handleSubmit} className="space-y-6"><div><Label>Cover Image</Label><label className="relative cursor-pointer group block mt-2"><div className="w-full h-32 rounded-lg bg-muted overflow-hidden">{coverPreview ? <img src={coverPreview} alt="Cover" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-muted-foreground"><Upload className="w-8 h-8" /></div>}</div><div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100"><Camera className="w-8 h-8 text-white" /></div><input type="file" accept="image/*" className="hidden" onChange={handleCoverChange} disabled={loading} /></label></div><div className="flex justify-center"><label className="relative cursor-pointer group"><div className="w-24 h-24 rounded-full bg-muted overflow-hidden border-4 border-background">{avatarPreview ? <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-2xl font-bold">{username[0]?.toUpperCase()}</div>}</div><input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} disabled={loading} /></label></div><div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div className="space-y-2"><Label>Username *</Label><Input value={username} onChange={e => setUsername(e.target.value)} required disabled={loading} /></div><div className="space-y-2"><Label>Email (read-only)</Label><Input value={user?.email || ''} disabled className="bg-muted" /></div><div className="space-y-2 md:col-span-2"><Label>Bio</Label><Textarea value={bio} onChange={e => setBio(e.target.value)} maxLength={160} rows={3} disabled={loading} /></div><div className="space-y-2"><Label>Location</Label><Input value={location} onChange={e => setLocation(e.target.value)} disabled={loading} /></div><div className="space-y-2"><Label>Website</Label><Input type="url" value={website} onChange={e => setWebsite(e.target.value)} disabled={loading} /></div><div className="space-y-2"><Label>Phone</Label><Input type="tel" value={phone} onChange={e => setPhone(e.target.value)} disabled={loading} /></div><div className="space-y-2"><Label>Birth Date</Label><Input type="date" value={birthDate} onChange={e => setBirthDate(e.target.value)} disabled={loading} /></div><div className="space-y-2"><Label>Twitter Handle</Label><Input value={twitterHandle} onChange={e => setTwitterHandle(e.target.value)} disabled={loading} /></div><div className="space-y-2"><Label>Instagram Handle</Label><Input value={instagramHandle} onChange={e => setInstagramHandle(e.target.value)} disabled={loading} /></div><div className="space-y-2 md:col-span-2"><Label>LinkedIn URL</Label><Input type="url" value={linkedinUrl} onChange={e => setLinkedinUrl(e.target.value)} disabled={loading} /></div></div><div className="flex space-x-2 pt-4"><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading} className="flex-1">Cancel</Button><Button type="submit" disabled={loading} className="flex-1">{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Changes'}</Button></div></form></DialogContent></Dialog>;
}
