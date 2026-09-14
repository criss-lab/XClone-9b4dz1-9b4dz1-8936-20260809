import { Users, Radio } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

export function CommunitySpacesHubNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const communities = location.pathname.startsWith('/communities') || location.pathname.startsWith('/c/');
  return (
    <div className="px-4 pt-3 pb-2 border-b border-border bg-background">
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-muted/50 p-1">
        <button onClick={() => navigate('/communities')} className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition-colors ${communities ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`} aria-current={communities ? 'page' : undefined}>
          <Users className="h-4 w-4" /> Communities
        </button>
        <button onClick={() => navigate('/spaces')} className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition-colors ${!communities ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`} aria-current={!communities ? 'page' : undefined}>
          <Radio className="h-4 w-4" /> Spaces
        </button>
      </div>
    </div>
  );
}
