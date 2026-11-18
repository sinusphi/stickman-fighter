import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { HitAudio, resolveImpact, SAMPLE_HIT_GAIN, SAMPLE_BLOCK_GAIN, SAMPLE_SWING_GAIN, SYNTH_SLAP_MIX, SYNTH_BLOCK_MIX, type SampleMeta } from '../../src/platform/audio';
import { describeStrike, pickHitSample, pickBlockSample, pickSwingSample, sampleFiles, samplesEnabled, type SoundManifest, type HitStrength } from '../../src/platform/hit-sound';
import manifest from '../../src/data/sounds.json';
import metadata from '../../src/data/sound-meta.json';

const weight = (damage: number) => (damage - 25) / 85;
it('selects tiers, neighbouring tiers only near boundaries, and never crosses strike kinds', () => {
  const map: SoundManifest = { hit: { punch: { light: ['lp'], middle: ['mp'], high: ['hp'] }, kick: { middle: ['mk'] } } };
  for (const [tier, damage, file] of [['light', 30, 'lp'], ['middle', 60, 'mp'], ['high', 100, 'hp']] as const)
    expect(pickHitSample(map, 'punch', tier, weight(damage), () => 0)).toBe(file);
  for (const [tier, damage, neighbour] of [['light', 44, 'mp'], ['middle', 46, 'lp'], ['middle', 74, 'hp'], ['high', 76, 'mp']] as const) {
    expect(pickHitSample(map, 'punch', tier, weight(damage), () => 0.19)).toBe(neighbour);
    expect(pickHitSample(map, 'punch', tier, weight(damage), () => 0.2)).not.toBe(neighbour);
  }
  expect(pickHitSample(map, 'kick', 'middle', weight(46), () => 0)).toBe('mk');
  expect(pickHitSample(map, 'kick', 'light', weight(44), () => 0)).toBeNull();
});
it('avoids repeats, handles empty roles and uses the same knee file in all tiers', () => {
  const map: SoundManifest = { hit: { punch: { middle: ['a', 'b', 'a'] } }, block: ['a', 'b'], swing: ['a', 'b'] };
  expect(pickHitSample(map, 'punch', 'middle', 0.4, () => 0, 'a')).toBe('b');
  for (const pick of [pickBlockSample, pickSwingSample]) {
    expect(pick(map, () => 0, 'a')).toBe('b');
    expect(pick({}, () => 0)).toBeNull();
    expect(pick({ block: [], swing: [] }, () => 0)).toBeNull();
  }
  expect(pickHitSample({}, 'knee', 'high', 1)).toBeNull();
  expect(pickHitSample({ hit: { punch: { light: [], middle: ['b'] } } }, 'punch', 'light', weight(44), () => 0)).toBeNull();
  for (const tier of ['light', 'middle', 'high'] as HitStrength[])
    expect(pickHitSample(manifest, 'knee', tier, 0.5, () => 0, 'attacks/1A_attack_8.wav')).toBe('attacks/1A_attack_8.wav');
  expect(sampleFiles({ ...map, effort: { heavy: ['future.wav'] }, rate: { kick: 0.88 } })).toEqual(['a', 'b', 'future.wav']);
});
it('enables samples by default and disables only samples=0 without any browser requirement', () => {
  expect(samplesEnabled()).toBe(true);
  expect(samplesEnabled('?samples=1')).toBe(true);
  expect(samplesEnabled('?foo=1&samples=0')).toBe(false);
  expect(samplesEnabled('?samples=false')).toBe(true);
});
it('attenuates only overlapping noise roles, leaving all other impact properties intact', () => {
  for (const blocked of [false, true]) for (const id of ['standing_lp', 'standing_hk', 'jumping_uppercut', 'spin_hk']) {
    const sound = { ...describeStrike(id), blocked, finisher: true };
    const original = resolveImpact(sound), mixed = resolveImpact(sound, blocked ? SYNTH_BLOCK_MIX : SYNTH_SLAP_MIX);
    expect(resolveImpact(sound, undefined)).toEqual(original);
    expect(mixed).toEqual({ ...original, noise: original.noise.map(layer => ({ ...layer,
      gain: layer.gain * ((blocked ? ['thock', 'knock'] : ['slap']).includes(layer.role) ? 0.5 : 1),
    })) });
  }
});
it('ships complete roles and short, small WAVs with matching metadata', () => {
  const meta: Record<string, SampleMeta> = metadata;
  for (const kind of ['punch', 'kick', 'knee'] as const) for (const tier of ['light', 'middle', 'high'] as const)
    expect(manifest.hit[kind][tier].length).toBeGreaterThan(0);
  expect(manifest.block.length).toBeGreaterThan(0); expect(manifest.swing.length).toBeGreaterThan(0);
  for (const path of sampleFiles(manifest)) {
    const file = readFileSync(resolve('public/sounds', path));
    expect(file.toString('ascii', 0, 4)).toBe('RIFF');
    expect(meta[path].bytes).toBe(file.length);
    expect(meta[path].durationMs).toBeLessThan(700);
    expect(meta[path].trim).toBeGreaterThanOrEqual(0.5); expect(meta[path].trim).toBeLessThanOrEqual(1.6);
    expect(meta[path].peak * meta[path].trim).toBeLessThanOrEqual(0.98);
  }
  const totalBytes = (directory: string): number => readdirSync(directory).reduce((sum, name) => {
    const path = resolve(directory, name), stat = statSync(path);
    return sum + (stat.isDirectory() ? totalBytes(path) : stat.size);
  }, 0);
  expect(totalBytes('public/sounds')).toBeLessThan(150_000);
});

class Param {
  value = 0;
  setValueAtTime = vi.fn(); exponentialRampToValueAtTime = vi.fn();
}
class Node {
  gain = new Param(); frequency = new Param(); Q = new Param(); pan = new Param(); playbackRate = new Param();
  threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param();
  connect = vi.fn(); disconnect = vi.fn(); start = vi.fn(); stop = vi.fn();
  onended: (() => void) | null = null;
  buffer: unknown; curve: unknown; type = ''; oversample = ''; loop = false;
}
class Context {
  static instances: Context[] = [];
  state = 'running'; currentTime = 1; sampleRate = 48000;
  destination = new Node(); nodes: Node[] = []; sources: Node[] = [];
  decoded = { duration: 0.4 };
  decodeAudioData = vi.fn(async () => this.decoded);
  resume = vi.fn(async () => { this.state = 'running'; }); close = vi.fn(async () => {});
  createBuffer = vi.fn(() => ({ getChannelData: () => new Float32Array(10) }));
  constructor() { Context.instances.push(this); }
  createGain = () => this.node(); createDynamicsCompressor = () => this.node();
  createBiquadFilter = () => this.node(); createWaveShaper = () => this.node(); createStereoPanner = () => this.node();
  createBufferSource = () => this.source(); createOscillator = () => this.source();
  private node(): Node { const node = new Node(); this.nodes.push(node); return node; }
  private source(): Node { const node = this.node(); this.sources.push(node); return node; }
}
const meta: SampleMeta = { durationMs: 400, sampleRate: 7576, bytes: 6000, peak: 0.7, rmsDb: -15, onsetMs: 19, peakMs: 30, trim: 1.2 };
const testManifest: SoundManifest = { hit: { punch: { light: ['hit.wav'] }, kick: { light: ['hit.wav'] } }, block: ['block.wav'], swing: ['swing.wav'], rate: { punch: 1, kick: 0.88 } };
const testMeta = { 'hit.wav': meta, 'block.wav': meta, 'swing.wav': meta };
const strike = { ...describeStrike('standing_lp'), signature: 0, pan: 0.4, weight: 0.1 };
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function setup(options: ConstructorParameters<typeof HitAudio>[0] = {}) {
  Context.instances = [];
  vi.stubGlobal('AudioContext', Context);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  const fetcher = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }));
  vi.stubGlobal('fetch', fetcher);
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const audio = new HitAudio({ manifest: testManifest, metadata: testMeta, ...options });
  return { audio, fetcher };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const samples = (context: Context) => context.sources.filter(source => source.buffer === context.decoded);
const synthCount = (blocked: boolean) => {
  const preset = resolveImpact({ ...strike, blocked });
  return [...preset.noise, ...preset.tones].filter(layer => layer.gain >= 0.005).length;
};

it('loads unique files once only on unlock and uses synth while decoding is pending', async () => {
  const { audio, fetcher } = setup();
  expect(Context.instances).toHaveLength(0); expect(fetcher).not.toHaveBeenCalled();
  audio.unlock(); const context = Context.instances[0];
  audio.playHit(strike); expect(samples(context)).toHaveLength(0);
  await flush(); audio.unlock(); await flush();
  expect(fetcher).toHaveBeenCalledTimes(3); expect(context.decodeAudioData).toHaveBeenCalledTimes(3);
  expect(fetcher.mock.calls.map(call => String((call as unknown[])[0]))).toEqual(sampleFiles(testManifest).map(path => `${import.meta.env.BASE_URL}sounds/${path}`));
  audio.playHit(strike); expect(samples(context)).toHaveLength(1);
});
it('starts punch and block samples at contact with onset offset, rate and independent gain in the synth voice', async () => {
  const { audio } = setup(); audio.unlock(); await flush(); const context = Context.instances[0];
  audio.playHit(strike); audio.playBlock({ ...strike, kind: 'kick' });
  expect(context.sources).toHaveLength(synthCount(false) + synthCount(true) + 2);
  const [hit, block] = samples(context);
  expect(hit.start).toHaveBeenCalledWith(1, 0.019); expect(block.start).toHaveBeenCalledWith(1, 0.019);
  expect(hit.playbackRate.value).toBeCloseTo(resolveImpact(strike).pitch);
  expect(block.playbackRate.value).toBeCloseTo(0.82 * 0.88);
  for (const [source, level] of [[hit, SAMPLE_HIT_GAIN], [block, SAMPLE_BLOCK_GAIN]] as const) {
    const amp = source.connect.mock.calls[0][0] as Node, output = amp.connect.mock.calls[0][0] as Node;
    expect(amp.gain.value * output.gain.value).toBeCloseTo(level * 1.2 * (0.55 + 0.45 * 0.1));
    expect(source.stop).toHaveBeenCalledWith(1 + (0.4 - 0.019) / source.playbackRate.value);
  }
  expect(context.nodes.filter(node => node.pan.value === 0.4)).toHaveLength(2);
});
it('applies kick tuning and finisher gain, and clamps sample playback rates', async () => {
  const { audio } = setup(); audio.unlock(); await flush(); const context = Context.instances[0];
  audio.playHit({ ...strike, kind: 'kick', finisher: true });
  const source = samples(context)[0];
  expect(source.playbackRate.value).toBeCloseTo(0.88 * 0.9 * 1.12);
  const amp = source.connect.mock.calls[0][0] as Node, output = amp.connect.mock.calls[0][0] as Node;
  expect(amp.gain.value * output.gain.value).toBeCloseTo(SAMPLE_HIT_GAIN * 1.2 * 0.595 * 1.15);
  for (const [rate, expected] of [[0.01, 0.6], [10, 1.6]]) {
    const { audio: other } = setup({ manifest: { ...testManifest, rate: { punch: rate } } });
    other.unlock(); await flush(); other.playHit(strike);
    expect(samples(Context.instances[0])[0].playbackRate.value).toBe(expected);
  }
});
it('aligns the whoosh sample peak with the active frame, using a delayed start and full waveform', async () => {
  const { audio } = setup(); audio.unlock(); await flush(); const context = Context.instances[0];
  audio.playSwing({ ...strike, leadSeconds: 0.12 });
  const source = samples(context)[0], rate = 1.1 - 0.2 * strike.weight;
  expect(source.start.mock.calls[0][0]).toBeCloseTo(1 + 0.12 - 0.03 / rate, 10);
  expect(source.start.mock.calls[0][1]).toBe(0);
  expect(source.playbackRate.value).toBeCloseTo(rate);
  const amp = source.connect.mock.calls[0][0] as Node, output = amp.connect.mock.calls[0][0] as Node;
  expect(amp.gain.value * output.gain.value).toBeCloseTo(SAMPLE_SWING_GAIN * (0.35 + 0.65 * 0.1) * 1.2);
  audio.playSwing({ ...strike, leadSeconds: 0 });
  expect(samples(context)[1].start).toHaveBeenCalledWith(1, 0);
});
it('keeps samples in the 12-voice priority limit and stops even scheduled samples when muted', async () => {
  const { audio } = setup(); audio.unlock(); await flush(); const context = Context.instances[0];
  for (let i = 0; i < 12; i++) audio.playSwing({ ...strike, leadSeconds: 0.2 });
  const oldest = samples(context)[0]; audio.playHit(strike);
  expect(oldest.stop).toHaveBeenCalledTimes(2); expect(oldest.disconnect).toHaveBeenCalledOnce();
  for (let i = 0; i < 11; i++) audio.playHit(strike);
  const before = context.sources.length; audio.playSwing({ ...strike, leadSeconds: 0.2 });
  expect(context.sources).toHaveLength(before);
  audio.setMuted(true);
  for (const source of samples(context)) { expect(source.stop).toHaveBeenCalledTimes(2); expect(source.disconnect).toHaveBeenCalledOnce(); }
  audio.playHit(strike); expect(context.sources).toHaveLength(before);
});
it('waits for a suspended context to resume before loading', async () => {
  const { audio, fetcher } = setup();
  audio.playHit(strike); const context = Context.instances[0]; context.state = 'suspended';
  audio.unlock(); expect(fetcher).not.toHaveBeenCalled();
  await flush(); expect(fetcher).toHaveBeenCalledTimes(3);
});
it.each(['fetch-reject', 'fetch-throw', 'http', 'decode-reject', 'no-decode', 'no-fetch', 'empty', 'disabled', 'no-context'])(
  'falls back silently with %s and preserves synth levels', async mode => {
    const { audio, fetcher } = setup(mode === 'empty' ? { manifest: {} } : mode === 'disabled' ? { search: '?samples=0' } : {});
    if (mode === 'no-context') vi.stubGlobal('AudioContext', undefined);
    if (mode === 'no-fetch') vi.stubGlobal('fetch', undefined);
    if (mode === 'fetch-reject') fetcher.mockRejectedValue(Error('network'));
    if (mode === 'fetch-throw') fetcher.mockImplementation(() => { throw Error('fetch'); });
    if (mode === 'http') fetcher.mockResolvedValue({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) });
    // Create the context without unlocking or triggering a load.
    audio.playHit(strike);
    const context = Context.instances[0];
    if (mode === 'no-decode') Object.defineProperty(context, 'decodeAudioData', { value: undefined });
    if (mode === 'decode-reject') context.decodeAudioData.mockRejectedValue(Error('bad wav'));
    audio.unlock(); await flush();
    const from = context?.sources.length ?? 0;
    expect(() => { audio.playHit(strike); audio.playBlock(strike); audio.playSwing({ ...strike, leadSeconds: 0.1 }); }).not.toThrow();
    if (context) {
      expect(samples(context)).toHaveLength(0);
      expect(context.sources.length - from).toBe(synthCount(false) + synthCount(true) + 2);
      const slap = context.sources[from], filter = slap.connect.mock.calls[0][0] as Node, amp = filter.connect.mock.calls[0][0] as Node;
      expect(amp.gain.exponentialRampToValueAtTime.mock.calls[0][0]).toBe(resolveImpact(strike).noise[0].gain);
    }
    if (['no-decode', 'no-fetch', 'empty', 'disabled', 'no-context'].includes(mode)) expect(fetcher).not.toHaveBeenCalled();
  },
);
it('isolates one corrupt sample without suppressing successfully decoded roles', async () => {
  const { audio } = setup(); audio.playHit(strike); const context = Context.instances[0];
  context.decodeAudioData.mockRejectedValueOnce(Error('bad block'));
  audio.unlock(); await flush(); audio.playBlock(strike); audio.playHit(strike);
  expect(samples(context)).toHaveLength(1);
});

it('reads the real URL query when no explicit test override is supplied', async () => {
  vi.stubGlobal('location', { search: '?samples=0' });
  const { audio, fetcher } = setup(); audio.unlock(); await flush(); audio.playHit(strike);
  expect(fetcher).not.toHaveBeenCalled(); expect(samples(Context.instances[0])).toHaveLength(0);
});
