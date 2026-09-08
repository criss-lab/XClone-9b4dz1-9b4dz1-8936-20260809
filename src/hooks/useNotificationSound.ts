/** Web Audio notification sound generator. */
const STORAGE_KEY = 'notification_sounds';
export type SoundType = 'dm' | 'group' | 'like' | 'follow' | 'tip' | 'comment' | 'repost';
interface ToneConfig { freqs: number[]; gap: number; duration: number; volume: number; type: OscillatorType; decay: number; }
const SOUND_CONFIGS: Record<SoundType, ToneConfig> = {
  dm: { freqs: [880, 1109], gap: 120, duration: .45, volume: .18, type: 'sine', decay: .001 },
  group: { freqs: [1046, 1318], gap: 120, duration: .45, volume: .18, type: 'sine', decay: .001 },
  like: { freqs: [523, 659], gap: 100, duration: .35, volume: .12, type: 'sine', decay: .001 },
  follow: { freqs: [659, 784, 988], gap: 110, duration: .4, volume: .16, type: 'sine', decay: .001 },
  tip: { freqs: [784, 587], gap: 80, duration: .55, volume: .22, type: 'triangle', decay: .001 },
  comment: { freqs: [698, 880], gap: 90, duration: .3, volume: .13, type: 'sine', decay: .001 },
  repost: { freqs: [440, 440], gap: 100, duration: .15, volume: .10, type: 'square', decay: .001 },
};
export function useNotificationSound() {
  const isEnabled = () => typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) !== 'false';
  const setEnabled = (val: boolean) => localStorage.setItem(STORAGE_KEY, val ? 'true' : 'false');
  const play = (type: SoundType = 'dm') => {
    if (!isEnabled() || typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx(); const cfg = SOUND_CONFIGS[type];
      cfg.freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.connect(gain); gain.connect(ctx.destination);
        const startAt = ctx.currentTime + i * cfg.gap / 1000; osc.type = cfg.type; osc.frequency.setValueAtTime(freq, startAt);
        gain.gain.setValueAtTime(0, startAt); gain.gain.linearRampToValueAtTime(cfg.volume, startAt + .02); gain.gain.exponentialRampToValueAtTime(cfg.decay, startAt + cfg.duration);
        osc.start(startAt); osc.stop(startAt + cfg.duration + .05);
      });
    } catch { /* audio is optional */ }
  };
  return { play, isEnabled, setEnabled };
}
