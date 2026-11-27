import { expect, it } from 'vitest';
import { MOVES } from '../../src/data/schema';
import { mappedStrikeJoint } from '../../src/data/pose-contact-moves';
import { classifyHit, describeStrike, newContactSounds, newSwingSounds, swingCues, type ContactSound, type SwingSound } from '../../src/platform/hit-sound';
import { createGame, snapshot, step } from '../../src/simulation/state';
import { buttonBit, neutralInput, type Button, type RawInput } from '../../src/input/types';
import type { GameState } from '../../src/simulation/types';

it('describes every move and hit group with a valid, damage-based sound', () => {
  const identities = new Set<string>();
  let groups = 0;
  for (const move of Object.values(MOVES)) for (const group of move.hitGroups) {
    const sound = describeStrike(move.id, group.id);
    expect(['punch', 'kick', 'knee', 'throw']).toContain(sound.kind);
    expect(sound.kind === 'throw').toBe(Boolean(move.throw));
    expect(['light', 'middle', 'high']).toContain(sound.strength);
    expect(['head', 'body', 'legs']).toContain(sound.zone);
    expect(['normal', 'spin', 'uppercut']).toContain(sound.style);
    expect(sound.weight).toBeGreaterThanOrEqual(0); expect(sound.weight).toBeLessThanOrEqual(1);
    expect(Math.abs(sound.signature)).toBeLessThanOrEqual(1);
    // Mixed combos map their groups to limbs (pose-contact-moves); a hand group is a punch.
    const joint = mappedStrikeJoint(move.id, group.id);
    if (!move.throw) expect(sound.kind === 'punch').toBe(group.id !== 'knee' && group.id !== 'kick' &&
      (group.id === 'punch' || (joint ? joint.endsWith('Hand') : move.button.endsWith('P'))));
    identities.add(sound.signature.toFixed(3)); groups++;
  }
  // Every technique keeps its own timbre, even with identical kind/strength/zone.
  expect(identities.size).toBeGreaterThan(groups * 0.9);
  expect(describeStrike('standing_hk')).toEqual(describeStrike('standing_hk'));
});

it('derives strength from damage, so special moves on light buttons sound heavy', () => {
  expect(classifyHit('standing_lp')).toEqual({ kind: 'punch', strength: 'light' });
  expect(classifyHit('standing_hk')).toEqual({ kind: 'kick', strength: 'high' });
  expect(classifyHit('jumping_uppercut', 'main')).toEqual({ kind: 'punch', strength: 'high' });
  expect(classifyHit('jumping_uppercut', 'punch')).toEqual({ kind: 'punch', strength: 'light' });
  expect(classifyHit('standing_rlk')).toEqual({ kind: 'kick', strength: 'light' });
  expect(classifyHit('standing_lmk')).toEqual({ kind: 'kick', strength: 'middle' });
  expect(classifyHit('dwit_chagi')).toEqual({ kind: 'kick', strength: 'high' }); // RLK button, 105 damage
  expect(classifyHit('standing_mk', 'knee')).toEqual({ kind: 'knee', strength: 'light' });
  expect(classifyHit('spin_high_middle_combo', 'high')).toEqual({ kind: 'kick', strength: 'high' });
  expect(classifyHit('middle_high_low_combo', 'low')).toEqual({ kind: 'kick', strength: 'light' });
  expect(classifyHit('missing')).toEqual({ kind: 'kick', strength: 'middle' });
  expect(describeStrike('standing_lp').weight).toBeLessThan(describeStrike('standing_mp').weight);
  expect(describeStrike('standing_mp').weight).toBeLessThan(describeStrike('standing_hp').weight);
  expect(describeStrike('spin_hk').weight).toBe(1);
  expect(describeStrike('jumping_uppercut', 'main').style).toBe('uppercut');
  expect(describeStrike('jumping_uppercut', 'punch').style).toBe('normal');
  expect(describeStrike('dwit_chagi').style).toBe('spin');
  expect(describeStrike('left_turn_kick').zone).toBe('head');
  expect(describeStrike('crouching_lk').zone).toBe('legs');
  expect(describeStrike('standing_lp', undefined, 0).pan).toBeLessThan(0);
  expect(describeStrike('standing_lp', undefined, 245760).pan).toBeGreaterThan(0);
});

const input = (buttons: Button[] = [], extra: Partial<RawInput> = {}): RawInput => ({ ...neutralInput(), ...extra, buttons: buttons.reduce((mask, b) => mask | buttonBit(b), 0) });
function run(game: GameState, frames: number, first: RawInput, { second = neutralInput() } = {}) {
  const contacts: ContactSound[] = [], swings: (SwingSound & { frame: number })[] = [];
  for (let frame = 0; frame < frames; frame++) {
    const previous = snapshot(game);
    step(game, [frame === 0 ? first : neutralInput(), second]);
    contacts.push(...newContactSounds(game, previous));
    swings.push(...newSwingSounds(game, previous).map(swing => ({ ...swing, frame: game.fighters[0].moveFrame })));
  }
  return { contacts, swings };
}
const close = () => { const game = createGame(); game.fighters[0].x = 480 * 256; game.fighters[1].x = 520 * 256; return game; };

it('emits exactly three hit sounds for a real multi-hit combo including every hitstop frame', () => {
  const game = close();
  const { contacts } = run(game, 170, input(['LMK', 'MK'], { right: true }));
  expect(game.fighters[0].hitTargets).toEqual(['middle:1', 'high:1', 'low:1']);
  expect(contacts.map(c => [c.kind, c.strength, c.blocked])).toEqual([['kick', 'middle', false], ['kick', 'high', false], ['kick', 'light', false]]);
  expect(contacts.map(c => c.zone)).toEqual(['body', 'head', 'legs']);
});

it('plays blocked contacts once as block sounds', () => {
  const game = close(); game.training = { enabled: true, dummy: 'block' };
  const { contacts } = run(game, 60, input(['LP']));
  expect(game.fighters[1].hp).toBe(1000);
  expect(contacts).toHaveLength(1);
  expect(contacts[0]).toMatchObject({ kind: 'punch', strength: 'light', blocked: true, finisher: false });
});

it('reports both strikes of a trade and falls back to the previous move id', () => {
  const game = createGame();
  game.fighters[0].moveId = 'standing_lp'; game.fighters[1].moveId = 'standing_hk';
  game.fighters[0].attackId = game.fighters[1].attackId = 1;
  const previous = snapshot(game);
  game.fighters[0].hitTargets.push('main:1'); game.fighters[1].hitTargets.push('main:0');
  game.fighters[1].moveId = null; // The simulation clears the hit fighter's move.
  game.lastContact = { frame: 5, attacker: 1, defender: 0, blocked: false };
  expect(newContactSounds(game, previous).map(c => [c.kind, c.strength])).toEqual([['punch', 'light'], ['kick', 'high']]);
  // Same values in the next snapshot: nothing new.
  expect(newContactSounds(game, snapshot(game))).toEqual([]);
  // A new attack starts counting from an empty target list.
  const reused = snapshot(game); reused.fighters[0].attackId = 0;
  expect(newContactSounds(game, reused)).toHaveLength(1);
});

it('marks the knockout hit as finisher', () => {
  const game = close(); game.fighters[1].hp = 10;
  const { contacts } = run(game, 30, input(['LP']));
  expect(contacts).toHaveLength(1);
  expect(contacts[0].finisher).toBe(true);
});

it('does not replay an old hit on resets, training changes, or round transitions', () => {
  for (const transition of ['reset', 'training', 'dummy', 'round'] as const) {
    const game = createGame();
    game.lastContact = { frame: 0, attacker: 0, defender: 1, blocked: false };
    game.fighters[0].moveId = 'standing_lp'; game.fighters[0].attackId = 3; game.fighters[0].hitTargets = ['main:1'];
    if (transition === 'dummy') game.training.enabled = true;
    if (transition === 'round') { game.round.phase = 'roundOver'; game.round.transition = 1; }
    const previous = snapshot(game);
    step(game, [neutralInput(), neutralInput()], transition === 'reset' ? [{ type: 'reset' }] : transition === 'training' || transition === 'dummy' ? [{ type: 'training', enabled: true, dummy: 'crouch' }] : []);
    expect(newContactSounds(game, previous)).toEqual([]);
    expect(newSwingSounds(game, previous)).toEqual([]);
  }
});

it('times every whoosh to peak on the first active frame of each separate strike', () => {
  // Throws have no hitboxes; their flight whoosh is cued by the throw table (newThrowSounds).
  for (const move of Object.values(MOVES).filter(m => !m.throw)) {
    const cues = swingCues(move.id);
    expect(cues.length).toBeGreaterThan(0);
    for (const cue of cues) {
      expect(cue.frame).toBeGreaterThanOrEqual(0);
      expect(move.frames[cue.frame + cue.lead].hitboxes.length).toBeGreaterThan(0);
      if (cue.frame + cue.lead > 0) expect(move.frames[cue.frame + cue.lead - 1].hitboxes.some(box => box.hitGroup === cue.groupId)).toBe(false);
    }
  }
  const count = (id: string) => swingCues(id).length;
  expect([count('standing_lp'), count('standing_mk'), count('double_high_kick'), count('spin_high_middle_combo'), count('tornado_spin_combo'), count('middle_high_low_combo')]).toEqual([1, 1, 2, 2, 2, 3]);
  expect(swingCues('standing_mk')[0].groupId).toBe('main'); // Knee and foot: one leg motion, one whoosh.
});

it('plays whooshes on whiffs too, once per strike and without double cues after chord upgrades', () => {
  const far = createGame();
  const lp = run(far, 40, input(['LP']));
  expect(lp.contacts).toEqual([]);
  expect(lp.swings.map(s => [s.kind, s.frame])).toEqual([['punch', swingCues('standing_lp')[0].frame]]);
  const combo = run(close(), 170, input(['LMK', 'MK'], { right: true }));
  expect(combo.swings).toHaveLength(3);
  expect(combo.swings.every(s => s.kind === 'kick' && s.leadSeconds > 0)).toBe(true);
});
