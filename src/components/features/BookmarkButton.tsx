import { useState, useEffect } from 'react';
import { Bookmark } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { updateInterestSignal } from '@/services/recommendations';

interface BookmarkButtonProps {
  postId: string;
}

export function BookmarkButton({ postId }: BookmarkButtonProps) {
  const { user } = useAuth();
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      checkBookmark();
    }
  }, [postId, user]);

  const checkBookmark = async () => {
    if (!user) return;

    const { data } = await supabase
      .from('bookmarks')
      .select('id')
      .eq('post_id', postId)
      .eq('user_id', user.id)
      .maybeSingle();

    setIsBookmarked(!!data);
  };

  const toggleBookmark = async () => {
    if (!user) {
      toast.error('Please log in to bookmark posts');
      return;
    }

    setLoading(true);

    try {
      if (isBookmarked) {
        const { error } = await supabase
          .from('bookmarks')
          .delete()
          .eq('post_id', postId)
          .eq('user_id', user.id);

        if (error) throw error;
        setIsBookmarked(false);
        toast.success('Removed from bookmarks');
      } else {
        const { error } = await supabase
          .from('bookmarks')
          .insert({
            post_id: postId,
            user_id: user.id
          });

        if (error) throw error;
        setIsBookmarked(true);
        toast.success('Added to bookmarks');
        // Update interest signal — fire-and-forget
        updateInterestSignal(user.id, postId, 'bookmark').then(() => {}, () => {});
      }
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={toggleBookmark}
      disabled={loading}
      className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors group"
    >
      <Bookmark
        className={`w-5 h-5 group-hover:scale-110 transition-transform ${
          isBookmarked ? 'fill-primary text-primary' : ''
        }`}
      />
    </button>
  );
}
