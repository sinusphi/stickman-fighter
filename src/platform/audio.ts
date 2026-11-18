import { pickHitSample, pickBlockSample, pickSwingSample, sampleFiles, samplesEnabled, type SoundManifest, type ContactSound, type HitKind, type HitStyle, type HitZone, type StrikeSound, type SwingSound } from './hit-sound';
import soundManifest from '../data/sounds.json';
import soundMetadata from '../data/sound-meta.json';

/** Sample tuning: linear gains; only overlapping synth noise is attenuated. */
export const SAMPLE_HIT_GAIN = 0.9, SYNTH_SLAP_MIX = 0.5;
export const SAMPLE_BLOCK_GAIN = 0.8, SYNTH_BLOCK_MIX = 0.5;
export const SAMPLE_SWING_GAIN = 0.45, SYNTH_SWING_MIX = 1.0;
/** Per-play sample rate variation ±4%; final rate is clamped to 0.6 … 1.6. */
export const SAMPLE_RATE_RANDOM = 0.04;

export interface SampleMeta { durationMs: number; sampleRate: number; bytes: number; peak: number; rmsDb: number | null; onsetMs: number; peakMs: number; trim: number }
interface LoadedSample { buffer: AudioBuffer; meta: SampleMeta }
interface SampleLayer extends LoadedSample { rate: number; gain: number; delay: number; offset: number }
type Schedule = { source: AudioScheduledSourceNode; start: number; end: number; offset?: number };
interface AudioOptions { manifest?: SoundManifest; metadata?: Record<string, SampleMeta>; search?: string }

/* ---------------------------------------------------------------------------------------------
 * Tuning tables. Frequencies in Hz, durations in seconds, gains linear.
 * Every impact preset has a LIGHT and a HEAVY anchor; the hit's weight (0 … 1, from damage)
 * blends between them, so 30, 55, 85 and 110 damage all sound different, not just three tiers.
 * Layers are matched by position: both anchors must list the same layers (gain 0 disables one).
 * Roles let zone/style modifiers address a layer: slap = skin/impact noise, crack = bright
 * transient, thock = muffled guard noise, knock = hollow resonance, body = falling sine thump,
 * accent = short arcade click, sub = low boom.
 * ------------------------------------------------------------------------------------------- */
type NoiseRole = 'slap' | 'crack' | 'thock' | 'knock';
type ToneRole = 'body' | 'accent' | 'sub';
interface NoiseLayer { role: NoiseRole; filter: BiquadFilterType; from: number; to: number; q: number; duration: number; gain: number }
interface ToneLayer { role: ToneRole; wave: OscillatorType; from: number; to: number; duration: number; gain: number }
interface ImpactPreset { gain: number; saturation: number; noise: NoiseLayer[]; tones: ToneLayer[] }
interface Anchors<T> { light: T; heavy: T }

const n = (role: NoiseRole, filter: BiquadFilterType, from: number, to: number, q: number, duration: number, gain: number): NoiseLayer => ({ role, filter, from, to, q, duration, gain });
const o = (role: ToneRole, wave: OscillatorType, from: number, to: number, duration: number, gain: number): ToneLayer => ({ role, wave, from, to, duration, gain });

/** Clean hits. First knobs: gain (loudness spread light↔heavy), body duration (weight), crack (snap). */
export const HIT_PRESETS: Record<HitKind, Anchors<ImpactPreset>> = {
  // Punch: bright skin slap + short thump; heavy adds boom and crunch.
  punch: {
    light: { gain: 0.55, saturation: 0, noise: [n('slap', 'bandpass', 2900, 1800, 1.2, 0.04, 1.0), n('crack', 'highpass', 4200, 3600, 0.7, 0.012, 0.35)],
      tones: [o('body', 'sine', 300, 120, 0.06, 0.55), o('accent', 'square', 1100, 900, 0.01, 0.045), o('sub', 'sine', 60, 55, 0.08, 0)] },
    heavy: { gain: 1.0, saturation: 1.8, noise: [n('slap', 'bandpass', 1700, 650, 0.8, 0.09, 0.85), n('crack', 'highpass', 2800, 2200, 0.7, 0.028, 0.55)],
      tones: [o('body', 'sine', 200, 52, 0.17, 1.0), o('accent', 'square', 650, 520, 0.014, 0.05), o('sub', 'sine', 62, 50, 0.17, 0.55)] },
  },
  // Kick: dull, deeper and longer; heavy kicks get a long body, boom and saturation.
  kick: {
    light: { gain: 0.55, saturation: 0, noise: [n('slap', 'lowpass', 2600, 800, 0.9, 0.055, 0.95), n('crack', 'highpass', 3600, 3000, 0.7, 0.012, 0.22)],
      tones: [o('body', 'sine', 190, 80, 0.08, 0.7), o('accent', 'triangle', 420, 170, 0.028, 0.25), o('sub', 'sine', 52, 48, 0.1, 0)] },
    heavy: { gain: 1.0, saturation: 2.3, noise: [n('slap', 'lowpass', 1700, 260, 0.8, 0.17, 0.85), n('crack', 'highpass', 2400, 1900, 0.7, 0.032, 0.5)],
      tones: [o('body', 'sine', 135, 38, 0.25, 1.0), o('accent', 'triangle', 300, 90, 0.05, 0.3), o('sub', 'sine', 50, 42, 0.24, 0.7)] },
  },
  // Knee: short, dense, mid-range "thock" without a tail.
  knee: {
    light: { gain: 0.55, saturation: 0.8, noise: [n('slap', 'bandpass', 1100, 480, 1.4, 0.045, 0.9), n('crack', 'highpass', 3000, 2600, 0.7, 0.01, 0.15)],
      tones: [o('body', 'sine', 230, 85, 0.07, 0.9), o('accent', 'triangle', 520, 220, 0.02, 0.25), o('sub', 'sine', 58, 52, 0.08, 0.15)] },
    heavy: { gain: 0.8, saturation: 1.2, noise: [n('slap', 'bandpass', 950, 380, 1.3, 0.06, 0.9), n('crack', 'highpass', 2800, 2400, 0.7, 0.014, 0.25)],
      tones: [o('body', 'sine', 210, 70, 0.09, 1.0), o('accent', 'triangle', 480, 200, 0.024, 0.28), o('sub', 'sine', 56, 50, 0.1, 0.3)] },
  },
};

/** Strikes on the guard: muffled thock + hollow resonant "tok", no boom, no crunch. */
export const BLOCK_PRESETS: Anchors<ImpactPreset> = {
  light: { gain: 0.7, saturation: 0, noise: [n('thock', 'lowpass', 1500, 650, 1.6, 0.05, 1.3), n('knock', 'bandpass', 760, 700, 7, 0.055, 3.0), n('crack', 'bandpass', 3400, 3000, 1.5, 0.007, 0.5)],
    tones: [o('body', 'sine', 220, 130, 0.05, 0.6), o('sub', 'sine', 70, 65, 0.06, 0)] },
  heavy: { gain: 1.1, saturation: 0, noise: [n('thock', 'lowpass', 1000, 300, 1.4, 0.1, 1.3), n('knock', 'bandpass', 600, 540, 6, 0.085, 3.0), n('crack', 'bandpass', 2800, 2400, 1.5, 0.009, 0.5)],
    tones: [o('body', 'sine', 160, 75, 0.1, 0.9), o('sub', 'sine', 68, 60, 0.1, 0.15)] },
};
/** Kicks and knees on the guard sound lower and a bit longer than punches. */
export const BLOCK_KIND = { punch: { pitch: 1, duration: 1 }, kick: { pitch: 0.82, duration: 1.15 }, knee: { pitch: 0.9, duration: 0.9 } } as const;

interface Modifier { gain?: number; pitch?: number; duration?: number; saturation?: number; roles?: Partial<Record<NoiseRole | ToneRole, number>> }
/** Head: brighter, more crack. Body: reference. Legs: slappier, less boom. */
export const ZONE_MODIFIERS: Record<HitZone, Modifier> = {
  head: { pitch: 1.12, duration: 0.9, roles: { crack: 1.6, sub: 0.8 } },
  body: {},
  legs: { pitch: 1.06, duration: 0.85, roles: { slap: 1.15, body: 0.7, sub: 0.4, crack: 0.6 } },
};
/** Spinning techniques land with more crack and boom, uppercuts with more snap. */
export const STYLE_MODIFIERS: Record<HitStyle, Modifier> = {
  normal: {},
  spin: { gain: 1.05, duration: 1.15, saturation: 0.3, roles: { crack: 1.3, sub: 1.25 } },
  uppercut: { pitch: 1.05, roles: { crack: 1.4, accent: 1.5 } },
};
/** Round-ending hit: longer, deeper, more boom. */
export const FINISHER_MODIFIER: Modifier = { gain: 1.1, pitch: 0.9, duration: 1.6, saturation: 0.6, roles: { sub: 1.8, body: 1.2 } };
/** Fixed per-move timbre (signature −1 … 1): pitch ±6 %, noise filter ±12 %. */
const SIGNATURE_PITCH = 0.06, SIGNATURE_FILTER = 0.12;
/** Per-play randomness so repeated hits do not sound like a machine gun. */
const RANDOM_PITCH = 0.04, RANDOM_GAIN = 0.05;

/** Whoosh: band-passed noise swelling up to the first active frame, then falling away. */
interface SwingLayer { filter: BiquadFilterType; from: number; peak: number; to: number; q: number; gain: number }
interface SwingPreset { gain: number; tail: number; layers: SwingLayer[] }
const w = (filter: BiquadFilterType, from: number, peak: number, to: number, q: number, gain: number): SwingLayer => ({ filter, from, peak, to, q, gain });
export const SWING_PRESETS: Record<HitKind, Anchors<SwingPreset>> = {
  punch: {
    light: { gain: 0.11, tail: 0.05, layers: [w('bandpass', 1300, 3400, 1900, 1.4, 1), w('lowpass', 500, 900, 400, 0.7, 0)] },
    heavy: { gain: 0.24, tail: 0.09, layers: [w('bandpass', 800, 2300, 1100, 1.0, 1), w('lowpass', 300, 700, 250, 0.7, 0.5)] },
  },
  kick: {
    light: { gain: 0.12, tail: 0.08, layers: [w('bandpass', 600, 1700, 850, 1.1, 1), w('lowpass', 250, 600, 220, 0.7, 0.3)] },
    heavy: { gain: 0.3, tail: 0.14, layers: [w('bandpass', 380, 1150, 480, 0.8, 1), w('lowpass', 180, 450, 150, 0.7, 0.7)] },
  },
  knee: {
    light: { gain: 0.1, tail: 0.05, layers: [w('bandpass', 700, 1500, 800, 1.2, 1), w('lowpass', 250, 500, 220, 0.7, 0.3)] },
    heavy: { gain: 0.12, tail: 0.06, layers: [w('bandpass', 600, 1300, 700, 1.1, 1), w('lowpass', 220, 450, 200, 0.7, 0.4)] },
  },
};
/** Spins carry the whoosh longer and lower; uppercuts sweep higher. */
export const SWING_STYLE = { normal: { pitch: 1, tail: 1, gain: 1 }, spin: { pitch: 0.88, tail: 1.35, gain: 1.15 }, uppercut: { pitch: 1.1, tail: 1, gain: 1.05 } } as const;
const SWING_MIN_RISE = 0.025;
/** Below this drive the WaveShaper would be inaudible, so no node is created. */
const MIN_SATURATION = 0.3;

/** Uncorrected output levels in dBFS (loudest 100 ms), at weights 0, .25, .5, .75, 1.
 * Neutral timbre; hybrid includes WAV + synth + saturation, synth covers missing/disabled WAVs.
 * Level correction belongs AFTER saturation: its drive otherwise makes heavy hits much louder.
 * Keep these anchors in sync with the real-waveform checks in audio-loudness-smoke.mjs. */
type SoundRole = 'hit' | 'block' | 'swing' | 'finisher';
const SOUND_LEVELS: Record<'hybrid' | 'synth', Record<SoundRole, Record<HitKind, number[]>>> = {
  hybrid: {
    hit: {
      punch: [-22.0, -19.7, -15.6, -12.6, -10.6],
      kick: [-21.5, -18.9, -13.6, -11.2, -9.4],
      knee: [-19.6, -18.0, -16.2, -14.8, -13.7],
    },
    block: {
      punch: [-22.7, -21.1, -19.7, -18.6, -17.6],
      kick: [-21.2, -19.6, -18.2, -17.1, -16.1],
      knee: [-22.2, -20.6, -19.3, -18.1, -17.1],
    },
    swing: {
      punch: [-27.4, -24.0, -21.4, -19.5, -18.0],
      kick: [-27.0, -23.6, -21.0, -19.1, -17.4],
      knee: [-27.1, -23.7, -21.4, -19.3, -17.7],
    },
    finisher: {
      punch: [-19.1, -16.3, -12.5, -10.2, -8.9],
      kick: [-18.6, -15.5, -11.0, -9.1, -7.9],
      knee: [-15.9, -14.2, -12.8, -11.8, -11.0],
    },
  },
  synth: {
    hit: {
      punch: [-43.9, -36.9, -31.0, -25.7, -21.3],
      kick: [-40.7, -33.2, -26.5, -21.0, -16.9],
      knee: [-37.3, -35.3, -33.4, -31.7, -30.1],
    },
    block: {
      punch: [-41.7, -38.7, -35.9, -33.4, -31.0],
      kick: [-41.2, -38.1, -35.2, -32.6, -30.0],
      knee: [-42.5, -39.6, -36.8, -34.4, -32.1],
    },
    swing: {
      punch: [-46.5, -44.0, -41.9, -40.2, -38.6],
      kick: [-46.7, -43.6, -41.3, -39.3, -37.7],
      knee: [-49.8, -49.4, -49.0, -48.7, -48.3],
    },
    finisher: {
      punch: [-36.9, -29.2, -22.8, -18.1, -14.6],
      kick: [-33.1, -24.9, -18.3, -14.2, -11.2],
      knee: [-29.4, -27.5, -25.7, -24.1, -22.7],
    },
  },
};

const MASTER_GAIN = 0.5, MAX_VOICES = 12, NOISE_SECONDS = 0.6, ATTACK_SECONDS = 0.002, SILENCE = 0.0001;
export const AUDIO_MUTED_STORAGE_KEY = 'stickman.audio.muted';

/* ------------------------------------------------------------------------------------------- */

function blend<T>(a: T, b: T, t: number): T {
  if (typeof a === 'number') return (a + ((b as number) - a) * t) as T;
  if (Array.isArray(a)) return a.map((item, i) => blend(item, (b as unknown[])[i], t)) as T;
  if (a && typeof a === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(a)) result[key] = blend((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], t);
    return result as T;
  }
  return a;
}
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Small, two-dB light/heavy spread; whooshes sit four dB below contacts. */
function soundLevelGain(sound: StrikeSound, role: SoundRole, sampled: boolean): number {
  const weight = clamp01(sound.weight), position = weight * 4, index = Math.min(3, Math.floor(position));
  const levels = SOUND_LEVELS[sampled ? 'hybrid' : 'synth'][role][sound.kind];
  const measured = levels[index] + (levels[index + 1] - levels[index]) * (position - index);
  const target = (role === 'swing' ? -26 : role === 'block' ? -23 : -22) + weight * 2;
  const style = sound.style === 'spin' && role !== 'block' ? (sampled ? 1 : 2) : 0;
  // Low strikes reduce the synth's body/sub layers; compensate their lost energy.
  const zone = !sampled && sound.zone === 'legs' && (role === 'hit' || role === 'finisher') ? 3.5 : 0;
  return 10 ** ((target - measured - style + zone) / 20);
}

/** Resolved impact: preset blended by weight with every modifier applied. Exported for tests/tools. */
export function resolveImpact(sound: StrikeSound & { blocked?: boolean; finisher?: boolean }, sampleMix?: number): ImpactPreset & { pitch: number; filter: number; duration: number } {
  const anchors = sound.blocked ? BLOCK_PRESETS : HIT_PRESETS[sound.kind];
  const preset = blend(anchors.light, anchors.heavy, clamp01(sound.weight));
  const modifiers: Modifier[] = sound.blocked
    ? [BLOCK_KIND[sound.kind]]
    : [ZONE_MODIFIERS[sound.zone], STYLE_MODIFIERS[sound.style], ...(sound.finisher ? [FINISHER_MODIFIER] : [])];
  let pitch = 1 + sound.signature * SIGNATURE_PITCH, duration = 1, gain = preset.gain, saturation = preset.saturation;
  const roles: Record<string, number> = {};
  for (const m of modifiers) {
    pitch *= m.pitch ?? 1; duration *= m.duration ?? 1; gain *= m.gain ?? 1;
    if (saturation > 0 || m.saturation) saturation += m.saturation ?? 0;
    for (const [role, factor] of Object.entries(m.roles ?? {})) roles[role] = (roles[role] ?? 1) * factor;
  }
  if (sampleMix !== undefined) for (const role of sound.blocked ? ['thock', 'knock'] : ['slap']) roles[role] = (roles[role] ?? 1) * sampleMix;
  const filter = 1 + ((sound.signature * 7.3) % 1) * SIGNATURE_FILTER;
  return {
    gain, saturation, pitch, filter, duration,
    noise: preset.noise.map(layer => ({ ...layer, gain: layer.gain * (roles[layer.role] ?? 1) })),
    tones: preset.tones.map(layer => ({ ...layer, gain: layer.gain * (roles[layer.role] ?? 1) })),
  };
}

type Priority = 1 | 2;
interface Voice { priority: Priority; sources: AudioScheduledSourceNode[]; nodes: AudioNode[]; dispose: () => void }

/** Presentation only. Construction/import never touches Web Audio or simulation RNG. */
export class HitAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices: Voice[] = [];
  private muted = false;
  private unavailable = false;
  private resuming = false;

  private readonly manifest: SoundManifest;
  private readonly metadata: Record<string, SampleMeta>;
  private readonly samplesOn: boolean;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly last: Partial<Record<'hit' | 'block' | 'swing', string>> = {};
  private loadStarted = false;
  private unlocked = false;

  constructor(options: AudioOptions = {}) {
    this.manifest = options.manifest ?? soundManifest;
    this.metadata = options.metadata ?? soundMetadata;
    this.samplesOn = samplesEnabled(options.search ?? globalThis.location?.search ?? '');
    try { this.muted = globalThis.localStorage?.getItem(AUDIO_MUTED_STORAGE_KEY) === 'true'; } catch { /* Session-only preference. */ }
  }

  isMuted(): boolean { return this.muted; }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try { globalThis.localStorage?.setItem(AUDIO_MUTED_STORAGE_KEY, String(muted)); } catch { /* Storage may be disabled. */ }
    if (this.master) this.master.gain.value = muted ? 0 : MASTER_GAIN;
    if (muted) for (const voice of [...this.voices]) voice.dispose();
  }

  unlock(): void {
    if (this.muted) return;
    this.unlocked = true;
    const context = this.getContext();
    if (context?.state === 'running') this.loadSamples(context);
    else if (context && context.state !== 'closed') this.resume(context);
  }

  /** Hit or block, whichever the contact was. */
  playContact(sound: ContactSound): void {
    if (sound.blocked) this.playBlock(sound); else this.playHit(sound);
  }

  playHit(sound: StrikeSound & { finisher?: boolean }): void {
    const context = this.ready(2);
    if (context) this.playImpact(context, sound, false);
  }

  playBlock(sound: StrikeSound): void {
    const context = this.ready(2);
    if (context) this.playImpact(context, sound, true);
  }

  playSwing(sound: SwingSound): void {
    const context = this.ready(1);
    if (context) this.swing(context, sound);
  }

  /** Running context with a free (or stolen) voice slot, otherwise null. */
  private ready(priority: Priority): AudioContext | null {
    if (this.muted) return null;
    const context = this.getContext();
    if (!context || context.state === 'closed') return null;
    if (context.state !== 'running') { this.resume(context); return null; }
    if (this.voices.length >= MAX_VOICES) {
      // Steal the oldest voice of the lowest priority, never a more important one.
      const lowest = Math.min(...this.voices.map(voice => voice.priority));
      if (lowest > priority) return null;
      this.voices.find(voice => voice.priority === lowest)!.dispose();
    }
    return context;
  }

  private resume(context: AudioContext): void {
    if (this.resuming) return;
    this.resuming = true;
    try {
      void context.resume().then(() => { this.resuming = false; if (this.unlocked && context.state === 'running') this.loadSamples(context); }, () => { this.resuming = false; });
    } catch { this.resuming = false; }
  }

  /** Once per instance, only after a gesture and a running context. Every failure is local. */
  private loadSamples(context: AudioContext): void {
    if (this.loadStarted || !this.samplesOn || typeof globalThis.fetch !== 'function' || typeof context.decodeAudioData !== 'function') return;
    this.loadStarted = true;
    for (const path of sampleFiles(this.manifest)) {
      void (async () => {
        try {
          const response = await fetch(`${import.meta.env.BASE_URL}sounds/${path}`);
          if (!response.ok) return;
          const buffer = await context.decodeAudioData(await response.arrayBuffer());
          const meta = this.metadata[path];
          if (buffer.duration > 0 && meta && Number.isFinite(meta.trim) && meta.trim > 0 &&
            Number.isFinite(meta.onsetMs) && meta.onsetMs >= 0 && meta.onsetMs / 1000 < buffer.duration &&
            Number.isFinite(meta.peakMs) && meta.peakMs >= 0) this.buffers.set(path, buffer);
        } catch { /* Missing files, network, decoding: keep the original synth. */ }
      })();
    }
  }

  private sample(role: 'hit' | 'block' | 'swing', sound: StrikeSound): LoadedSample | null {
    // No extra randomness in synth-only mode, including unavailable or still-loading samples.
    if (!this.samplesOn || !this.buffers.size) return null;
    const path = role === 'hit'
      ? pickHitSample(this.manifest, sound.kind, sound.strength, sound.weight, Math.random, this.last.hit)
      : role === 'block' ? pickBlockSample(this.manifest, Math.random, this.last.block)
        : pickSwingSample(this.manifest, Math.random, this.last.swing);
    const buffer = path ? this.buffers.get(path) : undefined;
    if (!path || !buffer) return null;
    this.last[role] = path;
    return { buffer, meta: this.metadata[path] };
  }

  private playImpact(context: AudioContext, sound: StrikeSound & { finisher?: boolean }, blocked: boolean): void {
    const sample = this.sample(blocked ? 'block' : 'hit', sound);
    const preset = resolveImpact({ ...sound, blocked, finisher: !blocked && sound.finisher }, sample ? (blocked ? SYNTH_BLOCK_MIX : SYNTH_SLAP_MIX) : undefined);
    let layer: SampleLayer | undefined;
    if (sample) {
      const rate = this.sampleRate(preset.pitch * (this.manifest.rate?.[sound.kind] ?? 1));
      layer = { ...sample, rate, delay: 0, offset: sample.meta.onsetMs / 1000,
        gain: (blocked ? SAMPLE_BLOCK_GAIN : SAMPLE_HIT_GAIN) * sample.meta.trim * (0.55 + 0.45 * clamp01(sound.weight)) *
          (!blocked && sound.finisher ? 1.15 : 1) * (1 - RANDOM_GAIN + Math.random() * RANDOM_GAIN * 2) };
    }
    this.impact(context, preset, sound.pan, soundLevelGain(sound, blocked ? 'block' : sound.finisher ? 'finisher' : 'hit', !!sample), layer);
  }

  private sampleRate(pitch: number): number {
    return Math.min(1.6, Math.max(0.6, pitch * (1 - SAMPLE_RATE_RANDOM + Math.random() * SAMPLE_RATE_RANDOM * 2)));
  }

  /** Join the existing voice, preserving its pan, saturation, priority and disposal. */
  private sampleSource(context: AudioContext, voice: Voice, output: GainNode, track: <T extends AudioNode>(node: T) => T, layer: SampleLayer, voiceGain: number, time: number): Schedule {
    const source = track(context.createBufferSource()), amp = track(context.createGain());
    voice.sources.push(source);
    source.buffer = layer.buffer; source.playbackRate.value = layer.rate;
    // The voice output also carries the synth's overall gain. Keep sample gain in absolute units.
    amp.gain.value = layer.gain / voiceGain;
    source.connect(amp); amp.connect(output);
    const start = time + layer.delay;
    return { source, start, end: start + (layer.buffer.duration - layer.offset) / layer.rate, offset: layer.offset };
  }

  private getContext(): AudioContext | null {
    if (this.context || this.unavailable) return this.context;
    if (typeof globalThis.AudioContext !== 'function') return null;
    let context: AudioContext | null = null;
    const nodes: AudioNode[] = [];
    try {
      context = new AudioContext();
      const master = context.createGain(); nodes.push(master);
      const compressor = context.createDynamicsCompressor(); nodes.push(compressor);
      master.gain.value = MASTER_GAIN;
      // Catch transient and stacked multi-hit peaks after per-voice level correction.
      compressor.threshold.value = -10;
      compressor.knee.value = 8;
      compressor.ratio.value = 6;
      compressor.attack.value = 0.002;
      compressor.release.value = 0.12;
      // Last-resort soft clip: stacked transients slip through the compressor attack.
      const limiter = context.createWaveShaper(); nodes.push(limiter);
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(i * 2 / (curve.length - 1) - 1);
      limiter.curve = curve;
      master.connect(compressor); compressor.connect(limiter); limiter.connect(context.destination);
      const noise = context.createBuffer(1, Math.ceil(context.sampleRate * NOISE_SECONDS), context.sampleRate);
      const samples = noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      this.context = context; this.master = master; this.noise = noise;
      return context;
    } catch {
      // Audio devices/implementations can be unavailable even when the API exists.
      for (const node of nodes) node.disconnect();
      try { void context?.close().catch(() => {}); } catch { /* Unavailable context. */ }
      this.unavailable = true;
      return null;
    }
  }

  /** Voice bookkeeping: output (→ saturation) → level correction (→ pan) → master. */
  private voice(context: AudioContext, priority: Priority, gain: number, saturation: number, pan: number, levelGain: number, build: (voice: Voice, output: GainNode, track: <T extends AudioNode>(node: T) => T) => { source: AudioScheduledSourceNode; start: number; end: number; offset?: number }[]): void {
    const voice: Voice = { priority, sources: [], nodes: [], dispose: () => {
      for (const source of voice.sources) {
        source.onended = null;
        try { source.stop(); } catch { /* Already ended or not started. */ }
      }
      for (const node of voice.nodes) node.disconnect();
      this.voices = this.voices.filter(active => active !== voice);
    } };
    const track = <T extends AudioNode>(node: T): T => { voice.nodes.push(node); return node; };
    this.voices.push(voice);
    try {
      const output = track(context.createGain()); output.gain.value = gain;
      let tail: AudioNode = output;
      if (saturation >= MIN_SATURATION) {
        const shaper = track(context.createWaveShaper()), curve = new Float32Array(512);
        for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i * 2 / (curve.length - 1) - 1) * saturation) / Math.tanh(saturation);
        shaper.curve = curve; shaper.oversample = '2x';
        tail.connect(shaper); tail = shaper;
      }
      const level = track(context.createGain()); level.gain.value = levelGain;
      tail.connect(level); tail = level;
      if (pan !== 0 && typeof context.createStereoPanner === 'function') {
        const panner = track(context.createStereoPanner()); panner.pan.value = pan;
        tail.connect(panner); tail = panner;
      }
      tail.connect(this.master!);
      const schedule = build(voice, output, track);
      let remaining = schedule.length;
      if (!remaining) { voice.dispose(); return; }
      for (const { source, start, end, offset } of schedule) {
        source.onended = () => { if (--remaining === 0) voice.dispose(); };
        if (offset === undefined) source.start(start); else (source as AudioBufferSourceNode).start(start, offset);
        source.stop(end);
      }
    } catch { voice.dispose(); /* Never interrupt gameplay for an audio failure. */ }
  }

  private noiseSource(context: AudioContext, voice: Voice, track: <T extends AudioNode>(node: T) => T): AudioBufferSourceNode {
    const source = track(context.createBufferSource()); voice.sources.push(source);
    source.buffer = this.noise; source.loop = true;
    return source;
  }

  private impact(context: AudioContext, preset: ReturnType<typeof resolveImpact>, pan: number, levelGain: number, sample?: SampleLayer): void {
    const time = context.currentTime;
    const pitch = preset.pitch * (1 - RANDOM_PITCH + Math.random() * RANDOM_PITCH * 2);
    const gain = preset.gain * (1 - RANDOM_GAIN + Math.random() * RANDOM_GAIN * 2);
    this.voice(context, 2, gain, preset.saturation, pan, levelGain, (voice, output, track) => {
      const schedule: { source: AudioScheduledSourceNode; start: number; end: number; offset?: number }[] = [];
      const envelope = (source: AudioScheduledSourceNode, signal: AudioNode, level: number, seconds: number, offset?: number): void => {
        const amp = track(context.createGain());
        amp.gain.setValueAtTime(SILENCE, time);
        amp.gain.exponentialRampToValueAtTime(level, time + ATTACK_SECONDS);
        amp.gain.exponentialRampToValueAtTime(SILENCE, time + seconds);
        signal.connect(amp); amp.connect(output);
        schedule.push({ source, start: time, end: time + seconds + 0.005, offset });
      };
      for (const layer of preset.noise) {
        if (layer.gain < 0.005) continue;
        const seconds = layer.duration * preset.duration;
        const source = this.noiseSource(context, voice, track), filter = track(context.createBiquadFilter());
        filter.type = layer.filter; filter.Q.value = layer.q;
        filter.frequency.setValueAtTime(layer.from * pitch * preset.filter, time);
        filter.frequency.exponentialRampToValueAtTime(layer.to * pitch * preset.filter, time + seconds);
        source.connect(filter); envelope(source, filter, layer.gain, seconds, Math.random() * NOISE_SECONDS * 0.5);
      }
      for (const layer of preset.tones) {
        if (layer.gain < 0.005) continue;
        const seconds = layer.duration * preset.duration;
        const source = track(context.createOscillator()); voice.sources.push(source);
        source.type = layer.wave;
        source.frequency.setValueAtTime(layer.from * pitch, time);
        source.frequency.exponentialRampToValueAtTime(layer.to * pitch, time + seconds);
        envelope(source, source, layer.gain, seconds);
      }
      if (sample) schedule.push(this.sampleSource(context, voice, output, track, sample, gain, time));
      return schedule;
    });
  }

  private swing(context: AudioContext, sound: SwingSound): void {
    const sample = this.sample('swing', sound);
    const preset = blend(SWING_PRESETS[sound.kind].light, SWING_PRESETS[sound.kind].heavy, clamp01(sound.weight));
    const style = SWING_STYLE[sound.style], time = context.currentTime;
    const pitch = style.pitch * (1 + sound.signature * SIGNATURE_PITCH) * (1 - RANDOM_PITCH + Math.random() * RANDOM_PITCH * 2);
    const rise = Math.max(SWING_MIN_RISE, sound.leadSeconds), fall = preset.tail * style.tail;
    const gain = preset.gain * style.gain * (1 - RANDOM_GAIN + Math.random() * RANDOM_GAIN * 2);
    this.voice(context, 1, gain, 0, sound.pan, soundLevelGain(sound, 'swing', !!sample), (voice, output, track) => {
      const schedule: { source: AudioScheduledSourceNode; start: number; end: number; offset?: number }[] = [];
      for (const layer of preset.layers) {
        const level = layer.gain * (sample ? SYNTH_SWING_MIX : 1);
        if (level < 0.005) continue;
        const source = this.noiseSource(context, voice, track), filter = track(context.createBiquadFilter()), amp = track(context.createGain());
        filter.type = layer.filter; filter.Q.value = layer.q;
        filter.frequency.setValueAtTime(layer.from * pitch, time);
        filter.frequency.exponentialRampToValueAtTime(layer.peak * pitch, time + rise);
        filter.frequency.exponentialRampToValueAtTime(layer.to * pitch, time + rise + fall);
        amp.gain.setValueAtTime(SILENCE, time);
        amp.gain.exponentialRampToValueAtTime(level, time + rise);
        amp.gain.exponentialRampToValueAtTime(SILENCE, time + rise + fall);
        source.connect(filter); filter.connect(amp); amp.connect(output);
        schedule.push({ source, start: time, end: time + rise + fall + 0.005, offset: Math.random() * NOISE_SECONDS * 0.5 });
      }
      if (sample) {
        const rate = this.sampleRate(style.pitch * BLOCK_KIND[sound.kind].pitch * (1.1 - 0.2 * clamp01(sound.weight)));
        schedule.push(this.sampleSource(context, voice, output, track, {
          ...sample, rate, offset: 0, delay: Math.max(0, sound.leadSeconds - sample.meta.peakMs / 1000 / rate),
          gain: SAMPLE_SWING_GAIN * (0.35 + 0.65 * clamp01(sound.weight)) * sample.meta.trim,
        }, gain, time));
      }
      return schedule;
    });
  }
}
