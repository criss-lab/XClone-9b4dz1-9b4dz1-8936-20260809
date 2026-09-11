from pathlib import Path

fed = Path('src/api/federation.ts')
s = fed.read_text()
old = "export async function postStatus(payload: { content: string; mediaIds?: string[]; visibility?: 'public' | 'unlisted' | 'followers' | 'direct'; inReplyTo?: string; sensitive?: boolean; spoilerText?: string; }): Promise<any> { return relay('/posts', 'POST', payload); }"
new = "export async function postStatus(payload: { content: string; mediaIds?: string[]; visibility?: 'public' | 'unlisted' | 'followers' | 'direct'; inReplyTo?: string; sensitive?: boolean; spoilerText?: string; mentions?: Array<{ href: string; name: string; acct?: string }>; hashtags?: Array<{ href: string; name: string }>; }): Promise<any> { return relay('/posts', 'POST', payload); }"
if old in s:
    fed.write_text(s.replace(old, new))

comp = Path('src/components/features/ComposePost.tsx')
s = comp.read_text()
start = s.find('  const handleContentChange = useCallback(async (val: string) => {')
end = s.find('  const insertMention = useCallback', start)
if start < 0 or end < 0:
    raise RuntimeError('ComposePost handler boundary not found')
fn = r'''  const handleContentChange = useCallback(async (val: string) => {
    setContent(val);
    const urlMatch = val.match(/https?:\/\/[^\s]+/);
    if (urlMatch) setLinkPreview({ url: urlMatch[0], isEmbed: !!detectEmbed(urlMatch[0]) }); else setLinkPreview(null);
    const ta = textareaRef.current;
    const pos = ta?.selectionStart ?? val.length;
    const before = val.slice(0, pos);
    const atMatch = before.match(/(^|\s)@([A-Za-z0-9_@.-]*)$/);
    if (atMatch) {
      const q = atMatch[2]; setMentionQuery(q); setMentionIdx(0); mentionSearchRef.current = q;
      if (!q) { setMentionResults([]); return; }
      try {
        const { data } = await supabase.functions.invoke('fediverse-autocomplete', { body: { mode: 'mention', q } });
        if (mentionSearchRef.current === q) setMentionResults(Array.isArray(data) ? data : []);
      } catch {
        const localQ = q.split('@')[0];
        const { data } = await supabase.from('user_profiles').select('id, username, display_name, avatar_url').ilike('username', `${localQ}%`).limit(8);
        if (mentionSearchRef.current === q) setMentionResults((data || []).map((x: any) => ({ kind: 'local', ...x, name: x.display_name || x.username, handle: `@${x.username}` })));
      }
      return;
    }
    setMentionQuery(null); setMentionResults([]);
    const hashMatch = before.match(/(^|\s)#([A-Za-z0-9_]*)$/);
    if (hashMatch && hashMatch[2]) {
      try {
        const { data } = await supabase.functions.invoke('fediverse-autocomplete', { body: { mode: 'hashtag', q: hashMatch[2] } });
        window.dispatchEvent(new CustomEvent('testagram-hashtag-suggestions', { detail: Array.isArray(data) ? data : [] }));
      } catch { /* preserve existing hashtag behavior */ }
    } else window.dispatchEvent(new CustomEvent('testagram-hashtag-suggestions', { detail: [] }));
  }, []);

'''
comp.write_text(s[:start] + fn + s[end:])
s = comp.read_text().replace("const insertMention = useCallback((username: string) => {", "const insertMention = useCallback((handle: string) => {", 1)
s = s.replace("before.replace(/@(\\w*)$/, `@${username} `)", "before.replace(/(^|\\s)@[A-Za-z0-9_@.-]*$/, `$1${handle.startsWith('@') ? handle : `@${handle}`} `)", 1)
comp.write_text(s)
