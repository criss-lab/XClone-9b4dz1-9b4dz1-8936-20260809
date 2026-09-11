import { useEffect, useState } from 'react';
import { Camera, Loader2, Upload } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

interface ProductionEditProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: any;
  onSuccess: () => void | Promise<void>;
}

function extension(file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '');
  return ext && ext.length <= 5 ? ext : 'jpg';
}

export function ProductionEditProfileDialog({ open, onOpenChange, profile, onSuccess }: ProductionEditProfileDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [website, setWebsite] = useState('');
  const [location, setLocation] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [twitter, setTwitter] = useState('');
  const [instagram, setInstagram] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [pronouns, setPronouns] = useState('');
  const [profession, setProfession] = useState('');
  const [education, setEducation] = useState('');
  const [languages, setLanguages] = useState('');
  const [interests, setInterests] = useState('');
  const [featuredLink, setFeaturedLink] = useState('');
  const [avatar, setAvatar] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !profile) return;
    const links = profile.social_links ?? {};
    setUsername(profile.username ?? '');
    setDisplayName(profile.display_name ?? '');
    setBio(profile.bio ?? '');
    setWebsite(profile.website ?? '');
    setLocation(profile.location ?? '');
    setBirthDate(profile.birth_date ?? '');
    setTwitter(links.twitter ?? links.x ?? '');
    setInstagram(links.instagram ?? '');
    setLinkedin(links.linkedin ?? '');
    setPronouns(links.pronouns ?? '');
    setProfession(links.profession ?? '');
    setEducation(links.education ?? '');
    setLanguages(links.languages ?? '');
    setInterests(links.interests ?? '');
    setFeaturedLink(links.featured_link ?? '');
    setAvatar(null);
    setCover(null);
    setAvatarPreview(profile.avatar_url ?? null);
    setCoverPreview(profile.cover_url ?? null);
  }, [open, profile]);

  const chooseImage = (file: File | undefined, kind: 'avatar' | 'cover') => {
    if (!file) return;
    const max = kind === 'avatar' ? 5 : 10;
    if (file.size > max * 1024 * 1024) {
      toast({ title: 'Image too large', description: `Maximum size is ${max}MB.`, variant: 'destructive' });
      return;
    }
    const preview = URL.createObjectURL(file);
    if (kind === 'avatar') {
      setAvatar(file);
      setAvatarPreview(preview);
    } else {
      setCover(file);
      setCoverPreview(preview);
    }
  };

  const uploadProfileImage = async (file: File, folder: 'avatars') => {
    if (!user) throw new Error('You must be signed in.');
    const path = `${folder}/${user.id}/${crypto.randomUUID()}.${extension(file)}`;
    const { error } = await supabase.storage.from('tv49-profile-media').upload(path, file, {
      cacheControl: '31536000',
      upsert: false,
      contentType: file.type || 'image/jpeg',
    });
    if (error) throw error;
    return supabase.storage.from('tv49-profile-media').getPublicUrl(path).data.publicUrl;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !profile) return;
    const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
    if (cleanUsername.length < 3) {
      toast({ title: 'Invalid username', description: 'Use at least 3 letters, numbers, or underscores.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      let avatarUrl = profile.avatar_url ?? null;
      let coverUrl = profile.cover_url ?? null;
      if (avatar) avatarUrl = await uploadProfileImage(avatar, 'avatars');
      if (cover) coverUrl = await uploadProfileImage(cover, 'avatars');

      const social_links = {
        ...(profile.social_links ?? {}),
        twitter: twitter.trim().replace(/^@/, ''),
        instagram: instagram.trim().replace(/^@/, ''),
        linkedin: linkedin.trim(),
        pronouns: pronouns.trim(),
        profession: profession.trim(),
        education: education.trim(),
        languages: languages.trim(),
        interests: interests.trim(),
        featured_link: featuredLink.trim(),
      };

      const { error } = await supabase.from('profiles').update({
        username: cleanUsername,
        display_name: displayName.trim(),
        bio: bio.trim() || null,
        website: website.trim() || null,
        location: location.trim() || null,
        birth_date: birthDate || null,
        avatar_url: avatarUrl,
        cover_url: coverUrl,
        social_links,
        updated_at: new Date().toISOString(),
      }).eq('id', user.id);
      if (error) throw error;

      const { error: authError } = await supabase.auth.updateUser({
        data: {
          username: cleanUsername,
          full_name: displayName.trim(),
          avatar_url: avatarUrl,
        },
      });
      if (authError) throw authError;

      toast({ title: 'Profile updated', description: 'Your profile is now saved to the production profile system.' });
      await onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      toast({ title: 'Could not update profile', description: error?.message || 'Please try again.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit profile</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <Label>Cover</Label>
            <label className="relative block mt-2 h-32 rounded-xl overflow-hidden bg-muted cursor-pointer">
              {coverPreview ? <img src={coverPreview} alt="Profile cover" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><Upload className="w-7 h-7 text-muted-foreground" /></div>}
              <span className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 flex items-center justify-center transition-opacity"><Camera className="w-7 h-7 text-white" /></span>
              <input type="file" accept="image/*" className="hidden" disabled={saving} onChange={e => chooseImage(e.target.files?.[0], 'cover')} />
            </label>
          </div>
          <div className="flex justify-center">
            <label className="relative w-24 h-24 rounded-full overflow-hidden bg-muted border-4 border-background cursor-pointer">
              {avatarPreview ? <img src={avatarPreview} alt="Profile avatar" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-2xl font-bold">{(username[0] || 'T').toUpperCase()}</div>}
              <span className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 flex items-center justify-center transition-opacity"><Camera className="w-6 h-6 text-white" /></span>
              <input type="file" accept="image/*" className="hidden" disabled={saving} onChange={e => chooseImage(e.target.files?.[0], 'avatar')} />
            </label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Label>Username</Label><Input value={username} onChange={e => setUsername(e.target.value)} maxLength={24} disabled={saving} required /></div>
            <div><Label>Display name</Label><Input value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={80} disabled={saving} /></div>
            <div className="md:col-span-2"><Label>Bio</Label><Textarea value={bio} onChange={e => setBio(e.target.value)} maxLength={160} rows={3} disabled={saving} /></div>
            <div><Label>Website</Label><Input type="url" value={website} onChange={e => setWebsite(e.target.value)} disabled={saving} placeholder="https://example.com" /></div>
            <div><Label>Location</Label><Input value={location} onChange={e => setLocation(e.target.value)} disabled={saving} /></div>
            <div><Label>Birth date</Label><Input type="date" value={birthDate} onChange={e => setBirthDate(e.target.value)} disabled={saving} /></div>
            <div><Label>Twitter / X</Label><Input value={twitter} onChange={e => setTwitter(e.target.value)} disabled={saving} placeholder="@handle" /></div>
            <div><Label>Instagram</Label><Input value={instagram} onChange={e => setInstagram(e.target.value)} disabled={saving} placeholder="@handle" /></div>
            <div><Label>LinkedIn</Label><Input value={linkedin} onChange={e => setLinkedin(e.target.value)} disabled={saving} placeholder="https://linkedin.com/in/..." /></div>
            <div><Label>Pronouns</Label><Input value={pronouns} onChange={e => setPronouns(e.target.value)} disabled={saving} placeholder="they/them" /></div>
            <div><Label>Profession</Label><Input value={profession} onChange={e => setProfession(e.target.value)} disabled={saving} placeholder="Designer at Testagram" /></div>
            <div><Label>Education</Label><Input value={education} onChange={e => setEducation(e.target.value)} disabled={saving} placeholder="University / school" /></div>
            <div><Label>Languages</Label><Input value={languages} onChange={e => setLanguages(e.target.value)} disabled={saving} placeholder="English, Swahili" /></div>
            <div className="md:col-span-2"><Label>Interests</Label><Input value={interests} onChange={e => setInterests(e.target.value)} disabled={saving} placeholder="Technology, music, football" /></div>
            <div className="md:col-span-2"><Label>Featured link</Label><Input type="url" value={featuredLink} onChange={e => setFeaturedLink(e.target.value)} disabled={saving} placeholder="https://..." /></div>
          </div>
          <div className="flex gap-3">
            <Button type="button" variant="outline" className="flex-1" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" className="flex-1" disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save changes'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
