import type { Sound } from './feedback';
import { PHONE_SOUND_GAIN } from '../shared/tokens';

// Optional sound (PRD 7.8). Every cue is synthesized with Web Audio, so there
// are no audio files to download. Browsers block audio until a user gesture,
// so the context is created from the Enable motion tap (or a sound toggle on
// the watch view). Everything a sound marks is also shown on screen.

interface Note {
  readonly type: OscillatorType;
  readonly from: number;
  readonly to: number;
  readonly startS: number;
  readonly lengthS: number;
  readonly level: number;
}

// Short, soft cues; frequencies in Hz, times in seconds.
const RECIPES: Record<Sound, readonly Note[]> = {
  charge: [{ type: 'square', from: 660, to: 990, startS: 0, lengthS: 0.08, level: 0.5 }],
  select: [{ type: 'triangle', from: 1200, to: 1200, startS: 0, lengthS: 0.04, level: 0.6 }],
  ready: [{ type: 'triangle', from: 1500, to: 1500, startS: 0, lengthS: 0.05, level: 0.6 }],
  error: [{ type: 'sine', from: 220, to: 160, startS: 0, lengthS: 0.18, level: 0.8 }],
  boost: [{ type: 'sawtooth', from: 180, to: 720, startS: 0, lengthS: 0.3, level: 0.35 }],
  shield: [{ type: 'sine', from: 330, to: 330, startS: 0, lengthS: 0.35, level: 0.7 }, { type: 'sine', from: 495, to: 495, startS: 0, lengthS: 0.35, level: 0.4 }],
  gate: [{ type: 'sine', from: 880, to: 880, startS: 0, lengthS: 0.12, level: 0.7 }, { type: 'sine', from: 1320, to: 1320, startS: 0.08, lengthS: 0.18, level: 0.6 }],
  pickup: [{ type: 'triangle', from: 990, to: 1480, startS: 0, lengthS: 0.1, level: 0.6 }],
  clank: [{ type: 'square', from: 140, to: 90, startS: 0, lengthS: 0.12, level: 0.5 }, { type: 'triangle', from: 2200, to: 1800, startS: 0, lengthS: 0.08, level: 0.3 }],
  horn: [{ type: 'sawtooth', from: 196, to: 196, startS: 0, lengthS: 0.6, level: 0.4 }, { type: 'sawtooth', from: 247, to: 247, startS: 0, lengthS: 0.6, level: 0.3 }],
};

const MUTE_KEY = 'rr-muted';
const ATTACK_S = 0.005;
// Exponential ramps cannot reach zero.
const SILENT = 0.0001;

type AudioContextConstructor = new () => AudioContext;

function audioConstructor(): AudioContextConstructor | null {
  const w = window as typeof window & { webkitAudioContext?: AudioContextConstructor };
  return typeof window.AudioContext === 'function' ? window.AudioContext : w.webkitAudioContext ?? null;
}

function storedMuted(): boolean {
  try {
    return sessionStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

let context: AudioContext | null = null;
let muted = typeof window === 'undefined' ? false : storedMuted();
let gain = PHONE_SOUND_GAIN;
const listeners = new Set<(muted: boolean) => void>();

export function audioSupported(): boolean {
  return audioConstructor() !== null;
}

// Call directly from a tap handler.
export function unlockAudio(): void {
  const Ctor = audioConstructor();
  if (!Ctor) return;
  try {
    context ??= new Ctor();
    if (context.state === 'suspended') void context.resume();
    // iOS unlocks output only after something plays inside the gesture.
    const silent = context.createBuffer(1, 1, context.sampleRate);
    const source = context.createBufferSource();
    source.buffer = silent;
    source.connect(context.destination);
    source.start();
  } catch {
    context = null;
  }
}

export function audioUnlocked(): boolean {
  return context !== null && context.state === 'running';
}

export function setSoundGain(value: number): void {
  gain = value;
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    sessionStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    // Private mode can refuse storage; the toggle still works for this page.
  }
  for (const listener of listeners) listener(muted);
}

export function onMuteChange(listener: (muted: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function playSound(sound: Sound): void {
  if (muted || !context || context.state !== 'running') return;
  const start = context.currentTime;
  for (const note of RECIPES[sound]) {
    const osc = context.createOscillator();
    const env = context.createGain();
    const t0 = start + note.startS;
    const t1 = t0 + note.lengthS;
    osc.type = note.type;
    osc.frequency.setValueAtTime(note.from, t0);
    if (note.to !== note.from) osc.frequency.exponentialRampToValueAtTime(note.to, t1);
    env.gain.setValueAtTime(SILENT, t0);
    env.gain.exponentialRampToValueAtTime(Math.max(SILENT, gain * note.level), t0 + ATTACK_S);
    env.gain.exponentialRampToValueAtTime(SILENT, t1);
    osc.connect(env);
    env.connect(context.destination);
    osc.start(t0);
    osc.stop(t1 + ATTACK_S);
  }
}
