import { afterEach, expect, it, vi } from 'vitest';
import { AUDIO_MUTED_STORAGE_KEY, HitAudio, resolveImpact } from '../../src/platform/audio';
import { describeStrike, type SwingSound } from '../../src/platform/hit-sound';

class Param {
  value = 0;
  setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
}
class Node {
  gain = new Param(); frequency = new Param(); Q = new Param(); pan = new Param();
  threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param();
  connect = vi.fn(); disconnect = vi.fn(); start = vi.fn(); stop = vi.fn();
  onended: (() => void) | null = null;
  buffer: unknown; curve: unknown; type = ''; oversample = ''; loop = false;
}
class Context {
  static instances: Context[] = [];
  state = 'running'; currentTime = 1; sampleRate = 48000;
  destination = new Node(); nodes: Node[] = []; sources: Node[] = [];
  resume = vi.fn(() => Promise.resolve()); close = vi.fn(() => Promise.resolve());
  createBuffer = vi.fn(() => ({ getChannelData: () => new Float32Array(28800) }));
  constructor() { Context.instances.push(this); }
  createGain = () => this.node();
  createDynamicsCompressor = () => this.node();
  createBiquadFilter = () => this.node();
  createWaveShaper = () => this.node();
  createStereoPanner = () => this.node();
  createBufferSource = () => this.source();
  createOscillator = () => this.source();
  private node(): Node { const node = new Node(); this.nodes.push(node); return node; }
  private source(): Node { const node = this.node(); this.sources.push(node); return node; }
}
/** master, compressor, limiter */
const SHARED = 3;
function setup() {
  Context.instances = [];
  vi.stubGlobal('AudioContext', Context);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  return new HitAudio();
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const hk = describeStrike('standing_hk', undefined, 245760 * 0.2);
const lp = describeStrike('standing_lp');
const swing = (id = 'standing_hk'): SwingSound => ({ ...describeStrike(id), leadSeconds: 0.1 });
const layers = (sound: Parameters<typeof resolveImpact>[0]) => {
  const preset = resolveImpact(sound);
  return [...preset.noise, ...preset.tones].filter(layer => layer.gain >= 0.005).length;
};

it('is safe without AudioContext, including unlock, mute and every sound type', () => {
  vi.stubGlobal('AudioContext', undefined);
  const audio = new HitAudio();
  expect(() => { audio.playHit(hk); audio.playBlock(hk); audio.playSwing(swing()); audio.playContact({ ...hk, blocked: true, finisher: false }); audio.unlock(); audio.setMuted(true); }).not.toThrow();
});

it('creates audio lazily, connects master → compressor → limiter and reuses one noise buffer', () => {
  const audio = setup();
  expect(Context.instances).toHaveLength(0);
  audio.unlock();
  const context = Context.instances[0];
  const [master, compressor, limiter] = context.nodes;
  expect(master.gain.value).toBe(0.5);
  expect(master.connect).toHaveBeenCalledWith(compressor);
  expect(compressor.connect).toHaveBeenCalledWith(limiter);
  expect(limiter.connect).toHaveBeenCalledWith(context.destination);
  audio.playHit(hk); audio.playBlock(lp); audio.playSwing(swing());
  expect(Context.instances).toHaveLength(1);
  expect(context.createBuffer).toHaveBeenCalledTimes(1);
  const noise = context.sources.filter(source => source.buffer);
  expect(new Set(noise.map(source => source.buffer)).size).toBe(1);
  expect(context.sources).toHaveLength(layers(hk) + layers({ ...lp, blocked: true }) + 2);
  for (const source of context.sources) { expect(source.start).toHaveBeenCalledOnce(); expect(source.stop).toHaveBeenCalledOnce(); }
  // Off-centre hits are panned.
  expect(context.nodes.some(node => node.pan.value < 0)).toBe(true);
  for (const source of context.sources) source.onended?.();
  for (const node of context.nodes.slice(SHARED)) expect(node.disconnect).toHaveBeenCalledOnce();
  expect(master.disconnect).not.toHaveBeenCalled();
});

it('makes heavy hits louder, longer and deeper than light ones, and blocks distinct from hits', () => {
  const light = resolveImpact(lp), heavy = resolveImpact(describeStrike('spin_hk'));
  expect(heavy.gain).toBeGreaterThan(light.gain * 1.6);
  const body = (preset: typeof light) => preset.tones.find(layer => layer.role === 'body')!;
  expect(body(heavy).duration * heavy.duration).toBeGreaterThan(body(light).duration * light.duration * 3);
  expect(body(heavy).to * heavy.pitch).toBeLessThan(body(light).to * light.pitch / 2);
  expect(heavy.saturation).toBeGreaterThan(1); expect(light.saturation).toBeLessThan(0.3); // Below 0.3 no shaper is created.
  const block = resolveImpact({ ...describeStrike('spin_hk'), blocked: true });
  expect(block.noise.some(layer => layer.role === 'knock')).toBe(true);
  expect(block.saturation).toBe(0);
  expect(resolveImpact({ ...describeStrike('spin_hk'), finisher: true }).duration).toBeGreaterThan(heavy.duration);
});

it('bounds polyphony, lets hits steal swings but never the other way round', () => {
  const audio = setup();
  for (let i = 0; i < 12; i++) audio.playSwing(swing());
  const context = Context.instances[0];
  expect(context.sources).toHaveLength(12 * 2);
  audio.playHit(hk); // Steals the oldest swing.
  expect(context.sources).toHaveLength(24 + layers(hk));
  expect(context.sources[0].stop).toHaveBeenCalledTimes(2);
  for (let i = 0; i < 12; i++) audio.playHit(hk);
  const before = context.sources.length;
  audio.playSwing(swing()); // All slots hold hits now: the swing is dropped.
  expect(context.sources).toHaveLength(before);
  audio.setMuted(true);
  expect(context.nodes[0].gain.value).toBe(0);
  for (const node of context.nodes.slice(SHARED)) expect(node.disconnect).toHaveBeenCalledOnce();
  audio.playHit(hk);
  expect(context.sources).toHaveLength(before);
  audio.setMuted(false); audio.playHit(hk);
  expect(context.sources).toHaveLength(before + layers(hk));
});

it('skips suspended sounds without queueing and catches failed resume attempts', async () => {
  const audio = setup(); audio.unlock();
  const context = Context.instances[0]; context.state = 'suspended';
  context.resume.mockImplementationOnce(() => Promise.reject(Error('autoplay blocked')));
  audio.playHit(lp); audio.playSwing(swing());
  expect(context.resume).toHaveBeenCalledOnce();
  await Promise.resolve();
  expect(context.sources).toHaveLength(0);
  audio.unlock(); await Promise.resolve();
  context.state = 'running';
  expect(context.sources).toHaveLength(0);
  audio.playHit(hk); expect(context.sources).toHaveLength(layers(hk));
  context.state = 'closed'; audio.playHit(hk);
  expect(context.sources).toHaveLength(layers(hk));
});

it('loads and saves mute without requiring usable storage or audio hardware', () => {
  setup(); const setItem = vi.fn();
  vi.stubGlobal('localStorage', { getItem: () => 'true', setItem });
  const audio = new HitAudio(); audio.playHit(lp); audio.unlock();
  expect(audio.isMuted()).toBe(true); expect(Context.instances).toHaveLength(0);
  audio.setMuted(false);
  expect(setItem).toHaveBeenCalledWith(AUDIO_MUTED_STORAGE_KEY, 'false');
  vi.stubGlobal('localStorage', { getItem: () => { throw Error('denied'); }, setItem: () => { throw Error('denied'); } });
  vi.stubGlobal('AudioContext', class { constructor() { throw Error('no audio device'); } });
  const unavailable = new HitAudio();
  expect(() => { unavailable.setMuted(false); unavailable.unlock(); unavailable.playHit(hk); unavailable.playSwing(swing()); }).not.toThrow();
});

it('cleans up partially created voices if the browser rejects a node', () => {
  const audio = setup(); audio.unlock(); const context = Context.instances[0];
  vi.spyOn(context, 'createOscillator').mockImplementationOnce(() => { throw Error('unavailable'); });
  expect(() => audio.playHit(lp)).not.toThrow();
  for (const node of context.nodes.slice(SHARED)) expect(node.disconnect).toHaveBeenCalledOnce();
});

it('works without StereoPannerNode', () => {
  const audio = setup(); audio.unlock(); const context = Context.instances[0];
  (context as unknown as { createStereoPanner?: unknown }).createStereoPanner = undefined;
  expect(() => { audio.playHit(hk); audio.playSwing(swing()); }).not.toThrow();
  expect(context.sources.length).toBeGreaterThan(0);
});

it('plays a distinct charge-up for Revenge and Special, click-free and staggered', () => {
  const audio = setup(); audio.unlock();
  const context = Context.instances[0];
  audio.playResourceReady('revenge', -0.3);
  const revenge = context.sources.splice(0), revengeNodes = context.nodes.length;
  audio.playResourceReady('special', 0.3, 0.1);
  const special = context.sources.splice(0);
  // Revenge: low square arpeggio; Special: brighter triangle arpeggio; both with echoes.
  expect(revenge[0].type).toBe('square');
  expect(special[0].type).toBe('triangle');
  expect(revenge.length).toBe(9);
  expect(special.length).toBe(12);
  const firstFrequency = (source: InstanceType<typeof Node>) => source.frequency.setValueAtTime.mock.calls[0][0];
  expect(firstFrequency(revenge[0])).toBeLessThan(firstFrequency(special[0]));
  // Both arpeggios rise.
  for (const notes of [revenge, special]) expect(firstFrequency(notes[2])).toBeGreaterThan(firstFrequency(notes[0]));
  // The staggered Special starts 100 ms later.
  expect(special[0].start.mock.calls[0][0]).toBeCloseTo(revenge[0].start.mock.calls[0][0] + 0.1);
  // Every envelope starts and ends at silence, and every source stops after its fade-out.
  const envelopes = context.nodes.filter(node => node.gain.setValueAtTime.mock.calls.length);
  expect(envelopes.length).toBe(revenge.length + special.length);
  for (const node of envelopes) {
    expect(node.gain.setValueAtTime.mock.calls[0][0]).toBe(0.0001);
    expect(node.gain.exponentialRampToValueAtTime.mock.calls.at(-1)![0]).toBe(0.0001);
    // Attack of at least 15 ms.
    const [, attackAt] = node.gain.exponentialRampToValueAtTime.mock.calls[0], [, startAt] = node.gain.setValueAtTime.mock.calls[0];
    expect(attackAt - startAt).toBeGreaterThanOrEqual(0.015);
  }
  for (const source of [...revenge, ...special]) { expect(source.start).toHaveBeenCalledOnce(); expect(source.stop).toHaveBeenCalledOnce(); expect(source.stop.mock.calls[0][0]).toBeGreaterThan(source.start.mock.calls[0][0]); }
  // Two independent voices: finishing the first never touches the second.
  for (const source of revenge) source.onended?.();
  expect(context.nodes.slice(SHARED, revengeNodes).every(node => node.disconnect.mock.calls.length === 1)).toBe(true);
  expect(context.nodes.slice(revengeNodes).every(node => node.disconnect.mock.calls.length === 0)).toBe(true);
});

it('keeps the charge-up silent while muted or before the autoplay unlock', () => {
  const audio = setup();
  audio.setMuted(true); audio.playResourceReady('special');
  expect(Context.instances).toHaveLength(0);
  audio.setMuted(false);
  const suspended = setup();
  suspended.playResourceReady('revenge');
  const context = Context.instances[0];
  context.state = 'suspended';
  suspended.playResourceReady('revenge');
  expect(context.resume).toHaveBeenCalled();
  expect(() => { vi.stubGlobal('AudioContext', undefined); new HitAudio().playResourceReady('special'); }).not.toThrow();
});
