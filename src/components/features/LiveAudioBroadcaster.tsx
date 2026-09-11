import { useState, useEffect, useRef } from 'react';
import { supabase, uploadMedia } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Mic, Square, Loader2, Radio } from 'lucide-react';

interface LiveAudioBroadcasterProps { spaceId: string; isHost: boolean; onBroadcastStart?: (url: string) => void; onBroadcastStop?: () => void; }

export function LiveAudioBroadcaster({ spaceId, isHost, onBroadcastStart, onBroadcastStop }: LiveAudioBroadcasterProps) {
  const { toast } = useToast();
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  const startBroadcast = async () => {
    if (!isHost) { toast({ title: 'Permission denied', description: 'Only the host can broadcast', variant: 'destructive' }); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 128000 });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = event => { if (event.data.size > 0) audioChunksRef.current.push(event.data); };
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await uploadRecording(audioBlob);
      };
      mediaRecorder.start(5000);
      setIsBroadcasting(true); setRecordingTime(0);
      const { error } = await supabase.from('spaces').update({ is_recording: true }).eq('id', spaceId);
      if (error) throw error;
      timerRef.current = window.setInterval(() => setRecordingTime(prev => prev + 1), 1000);
      toast({ title: 'Broadcasting started', description: 'Your audio is now live' });
      onBroadcastStart?.('live');
    } catch (error) {
      console.error('Error starting broadcast:', error);
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      toast({ title: 'Error', description: 'Failed to start audio broadcast. Please check microphone permissions.', variant: 'destructive' });
    }
  };

  const stopBroadcast = async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || !isBroadcasting) return;
    if (recorder.state !== 'inactive') recorder.stop();
    setIsBroadcasting(false);
    if (timerRef.current !== null) { window.clearInterval(timerRef.current); timerRef.current = null; }
    streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null;
    const { error } = await supabase.from('spaces').update({ is_recording: false }).eq('id', spaceId);
    if (error) console.error('Failed to finalize recording state:', error);
    onBroadcastStop?.();
  };

  const uploadRecording = async (audioBlob: Blob) => {
    setUploading(true);
    try {
      const userResult = await supabase.auth.getUser();
      const user = userResult.data.user;
      if (!user) throw new Error('You must be signed in to save a Space recording.');
      if (!audioBlob.size) throw new Error('The Space recording is empty.');

      // Space recordings use the canonical Cloudflare Worker -> R2 media path.
      // Do not use Supabase Storage directly: R2 is the authoritative media store.
      const file = new File([audioBlob], `space-${spaceId}-${Date.now()}.webm`, { type: 'audio/webm' });
      const asset = await uploadMedia(file, 'audio');
      const { error: dbError } = await supabase.from('space_recordings').insert({
        space_id: spaceId,
        host_id: user.id,
        title: `Recording ${new Date().toLocaleString()}`,
        audio_url: asset.url,
        duration_seconds: recordingTime,
      });
      if (dbError) throw dbError;
      toast({ title: 'Recording saved', description: 'Your Space audio is safely stored in Cloudflare R2.' });
    } catch (error) {
      console.error('Error uploading Space recording to Cloudflare R2:', error);
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Failed to save recording', variant: 'destructive' });
    } finally { setUploading(false); }
  };

  const formatTime = (seconds: number) => { const hrs = Math.floor(seconds / 3600); const mins = Math.floor((seconds % 3600) / 60); const secs = seconds % 60; return hrs > 0 ? `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}` : `${mins}:${secs.toString().padStart(2, '0')}`; };
  if (!isHost) return null;
  return <div className="border border-border rounded-lg p-4 bg-background space-y-4"><div className="flex items-center justify-between"><p className="text-sm font-semibold flex items-center"><Radio className="w-4 h-4 mr-2" />Live Broadcast</p>{isBroadcasting && <div className="flex items-center space-x-2"><div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" /><span className="text-sm font-mono">{formatTime(recordingTime)}</span></div>}</div>{!isBroadcasting && !uploading && <Button onClick={startBroadcast} className="w-full" size="lg"><Mic className="w-4 h-4 mr-2" /> Start Broadcasting</Button>}{isBroadcasting && <Button onClick={stopBroadcast} variant="destructive" className="w-full" size="lg"><Square className="w-4 h-4 mr-2" /> Stop Broadcast</Button>}{uploading && <div className="flex items-center justify-center space-x-2 py-3"><Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm text-muted-foreground">Saving recording to Cloudflare...</span></div>}<p className="text-xs text-muted-foreground">{isBroadcasting ? 'Your audio is being broadcast live to all listeners. The recording will be saved automatically to Cloudflare R2 when you stop.' : 'Click to start broadcasting live audio. The recording will be saved to Cloudflare R2 for playback.'}</p></div>;
}
