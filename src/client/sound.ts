/** Small synthesized cues. Everything is optional and fails silently. */
import { KEYS, readText, writeText } from './storage';

export type Cue = 'phase' | 'good' | 'hurt' | 'death' | 'message';

let context: AudioContext | null = null;
let enabled = readText('local', KEYS.sound) !== 'off';

export const soundEnabled = () => enabled;

export function setSound(on: boolean) {
  enabled = on;
  writeText('local', KEYS.sound, on ? 'on' : 'off');
}

const CUES: Record<Cue, { type: OscillatorType; notes: number[]; length: number; volume: number }> = {
  phase: { type: 'sine', notes: [440], length: 0.3, volume: 0.035 },
  good: { type: 'sine', notes: [523, 784], length: 0.22, volume: 0.03 },
  hurt: { type: 'triangle', notes: [196, 147], length: 0.28, volume: 0.06 },
  death: { type: 'sine', notes: [330, 247, 196], length: 0.32, volume: 0.04 },
  message: { type: 'sine', notes: [880], length: 0.12, volume: 0.018 },
};

export function play(cue: Cue) {
  if (!enabled) return;
  try {
    context ||= new AudioContext();
    if (context.state === 'suspended') void context.resume();
    const { type, notes, length, volume } = CUES[cue];
    notes.forEach((frequency, i) => {
      const start = context!.currentTime + i * length * 0.8;
      const osc = context!.createOscillator();
      const gain = context!.createGain();
      osc.type = type;
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(volume, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
      osc.connect(gain).connect(context!.destination);
      osc.start(start);
      osc.stop(start + length);
    });
  } catch {
    // Audio is decoration.
  }
}
