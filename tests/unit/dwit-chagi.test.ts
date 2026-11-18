import { expect, it } from 'vitest';
import { MOVES, validateMoves } from '../../src/data/schema';
import moveData from '../../src/data/moves.json';
import poses from '../../src/data/poses.json';
import { advanceOffset, animations, samplePose } from '../../src/render/skeleton';
import { usesPoseContact } from '../../src/simulation/pose-contact';
import { createGame, step } from '../../src/simulation/state';
import { neutralInput, buttonBit } from '../../src/input/types';
import type { RawInput } from '../../src/input/types';
import contactGeometry from '../../src/data/contact-geometry';
import rules from '../../src/data/rules.json';
import { FIGURE_SCALE } from '../../src/data/figure-scale';


const ID = 'dwit_chagi';
// Zeitplan aus scripts/kicks/dwit-chagi.mjs (DWIT).
const DWIT = { takeoff: 10, touchdown: 31, travel: 38.5, frontView: 10.5, backView: 41 };
const back = (facing: number, button = false): RawInput =>
  ({ ...neutralInput(), left: facing === 1, right: facing === -1, buttons: button ? buttonBit('RLK') : 0 });

function setup(facing: 1 | -1 = 1) {
  const game = createGame();
  game.fighters[0].x = (facing === 1 ? 300 : 660) * 256; game.fighters[1].x = (facing === 1 ? 660 : 300) * 256;
  game.fighters[0].facing = game.fighters[0].attackFacing = facing; game.fighters[1].facing = -facing as 1 | -1;
  return game;
}

const world = (frame: number, facing = 1) => {
  const pose = samplePose(ID, frame, facing), dx = advanceOffset(ID, frame) * facing;
  return Object.fromEntries(Object.entries(pose).map(([joint, p]) => [joint, [p[0] + dx, p[1]]])) as Record<string, number[]>;
};
const deg = (a: number[], b: number[]) => Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
const wrap = (a: number) => ((a % 360) + 540) % 360 - 180;

/** Spielt den Tritt von P1 auf Abstand `distance` (px) und protokolliert die Treffer. */
function play(distance: number, defender: RawInput = neutralInput()) {
  const game = createGame(), [a, b] = game.fighters, hits: { damage: number; frame: number }[] = [];
  a.x = 400 * 256; b.x = a.x + distance * 256;
  for (let i = 0; i < 60; i++) {
    const hp = b.hp;
    step(game, [back(1, i === 0), i >= 8 ? defender : neutralInput()]);
    if (b.hp < hp) hits.push({ damage: hp - b.hp, frame: a.moveFrame });
  }
  return { game, hits };
}

it('trägt die Framedata (Sprung nach vorne, ein Treffer mit der Ferse)', () => {
  const move = MOVES[ID];
  expect([move.startup, move.active, move.recovery]).toEqual([19, 4, 27]);
  expect(move.duration).toBe(50);
  expect([move.damage, move.hitLevel, move.hitstun, move.blockstun, move.hitstop]).toEqual([105, 'HIGH', 30, 22, 14]);
  expect(move.button).toBe('RLK');
  expect(move.command).toMatchObject({ type: 'hold', directions: [4], buttons: ['RLK'], trigger: 'pressed' });
  // Der Sprung trägt nach vorne; der Ursprung läuft bis zum ersten Active-Frame mit.
  expect(move.advance!.frames).toBe(move.startup);
  expect(move.advance!.distance).toBe(Math.round(DWIT.travel * FIGURE_SCALE * 256));
  // Rückwärtstritt: das Knie zeigt vom Gegner weg, also kein Knie-Treffer.
  expect(move.multiHit).toBe(false);
  expect(move.hitGroups).toEqual([{ id: 'main', maxHitsPerTarget: 1 }]);
  expect(animations[ID].durationFrames).toBe(move.duration);
  expect(validateMoves(moveData)).toBeTruthy();
});

it('startet auf "Zurück halten + RLK" in beiden Blickrichtungen, egal wie lange zurück gehalten wird', () => {
  for (const facing of [1, -1] as const) for (const held of [0, 1, 20]) {
    const game = setup(facing);
    for (let i = 0; i < held; i++) step(game, [back(facing), neutralInput()]);
    step(game, [back(facing, true), neutralInput()]);
    expect(game.fighters[0].moveId).toBe(ID);
    expect(game.fighters[0].moveFrame).toBe(0);
    expect(game.fighters[0].attackFacing).toBe(facing);
  }
});

it('bleibt ohne gehaltenes Zurück der normale RLK, auch nach dem Loslassen', () => {
  for (const facing of [1, -1] as const) for (const scenario of ['neutral', 'released'] as const) {
    const game = setup(facing);
    if (scenario === 'released') { step(game, [back(facing), neutralInput()]); step(game); }
    step(game, [{ ...neutralInput(), buttons: buttonBit('RLK') }, neutralInput()]);
    expect(game.fighters[0].moveId).toBe('standing_rlk');
  }
});

it('löst nicht in der Hocke, im Sprung oder aus der Luft aus', () => {
  for (const posture of ['crouch', 'jump', 'air'] as const) {
    const game = setup(), f = game.fighters[0];
    if (posture === 'air') { f.state = 'Airborne'; f.y = -100 * 256; f.vy = 0; }
    step(game, [{ ...back(1, true), down: posture === 'crouch', up: posture === 'jump' }, neutralInput()]);
    expect(f.moveId).not.toBe(ID);
  }
});

it('trifft nur mit dem Fuß in den Active-Frames, Kontakt über die Pose', () => {
  const move = MOVES[ID];
  const geometry = contactGeometry as unknown as Record<string, { frames: { strikes: Record<string, number[]> }[] }>;
  for (let frame = 0; frame < move.duration; frame++) {
    expect(Object.keys(geometry[ID].frames[frame].strikes).filter(k => k !== 'main'), `${frame}`).toEqual([]);
    const active = frame >= move.startup && frame < move.startup + move.active;
    expect(move.frames[frame].hitboxes.some(box => box.hitGroup === 'main'), `${frame}`).toBe(active);
    if (!active) continue;
    // Die Trefferkapsel Knie→Fuß wird in mehrere Boxen zerlegt; der Fuß liegt in einer davon.
    const foot = samplePose(ID, frame, 1).rightFoot;
    expect(move.frames[frame].hitboxes.some(box =>
      foot[0] * 256 >= box.x && foot[0] * 256 <= box.x + box.width &&
      foot[1] * 256 >= box.y && foot[1] * 256 <= box.y + box.height)).toBe(true);
  }
  expect(usesPoseContact(ID)).toBe(true);
  expect(geometry[ID].frames.filter(f => f.strikes.main).length).toBe(move.active);
});

it('beginnt und endet in der Grundstellung', () => {
  const keys = animations[ID].keyframes;
  for (const key of [keys[0], keys.at(-1)!]) {
    expect((poses.poses as Record<string, unknown>)[key.pose]).toEqual(
      { ...poses.poses.guard, root: (poses.poses as Record<string, { root: number[] }>)[key.pose].root });
  }
  expect(keys.at(-1)!.frame).toBe(animations[ID].durationFrames - 1);
});

it('wird stehend geblockt und geht über einen Hockenden hinweg', () => {
  for (const [defender, expected] of [[neutralInput(), 'Hitstun'], [{ ...neutralInput(), right: true }, 'Blockstun'],
    [{ ...neutralInput(), right: true, down: true }, 'Crouch']] as const) {
    const game = setup(), [a, b] = game.fighters;
    // In der Ecke: ein gehaltener Block kann nicht aus der Reichweite laufen.
    b.x = rules.stageWidth - Math.ceil(16 * rules.unit * FIGURE_SCALE); a.x = b.x - 80 * 256;
    const hp = b.hp, seen = new Set<string>();
    step(game, [back(1, true), defender as RawInput]);
    for (let i = 0; i < MOVES[ID].duration; i++) { step(game, [back(1), defender as RawInput]); seen.add(b.state); }
    expect(a.moveId === null || a.moveId === ID).toBe(true);
    expect([...seen]).toContain(expected);
    if (expected === 'Crouch') expect([...seen]).not.toContain('Blockstun');
    expect(hp-b.hp).toBe(expected==='Crouch'?0:expected==='Blockstun'?Math.round(MOVES[ID].damage*.08):MOVES[ID].damage);
  }
});

it('springt in der Drehung ab und trifft auf Kopfhöhe', () => {
  const guard = samplePose(ID, 0, 1), idle = samplePose('Idle', 0, 1);
  for (let frame = MOVES[ID].startup; frame < MOVES[ID].startup + MOVES[ID].active; frame++) {
    const pose = samplePose(ID, frame, 1);
    // Beide Füße in der Luft, Hüfte deutlich über der Grundstellung.
    expect(Math.max(pose.leftFoot[1], pose.rightFoot[1])).toBeLessThan(-20);
    expect(pose.hip[1]).toBeLessThan(guard.hip[1] - 15);
    // Trittfuß auf Höhe des gegnerischen Kopfes.
    expect(Math.abs(pose.rightFoot[1] - idle.head[1])).toBeLessThan(3);
    // Bein waagerecht und durchgestreckt: Hüfte, Knie und Fuß auf einer Höhe.
    expect(Math.abs(pose.rightFoot[1] - pose.hip[1])).toBeLessThan(2);
    expect(Math.abs(pose.rightKnee[1] - pose.hip[1])).toBeLessThan(1);
    expect(pose.rightFoot[0] - pose.hip[0]).toBeGreaterThan(49.5);
  }
});

it('trifft mit dem Rücken zum Gegner und dreht danach in derselben Richtung weiter', () => {
  const keys = animations[ID].keyframes;
  // Körper und Kopf drehen gleichsinnig über die hintere Schulter (negativ wie spin_mk).
  for (let i = 1; i < keys.length; i++) {
    expect(keys[i].yaw!).toBeLessThanOrEqual(keys[i - 1].yaw!);
    expect(keys[i].headYaw!).toBeLessThanOrEqual(keys[i - 1].headYaw!);
    // Der Kopf bleibt beim Gegner (schaut über die Schulter), höchstens 50° voraus.
    expect(keys[i].yaw! - keys[i].headYaw!, `f${i}`).toBeLessThanOrEqual(50);
    expect(keys[i].headYaw! - keys[i].yaw!, `f${i}`).toBeLessThanOrEqual(100);
  }
  // Im Treffer Rücken zum Gegner, Gesicht über die Schulter Richtung Kamera/Gegner.
  for (let frame = MOVES[ID].startup; frame < MOVES[ID].startup + MOVES[ID].active; frame++) {
    expect(keys[frame].yaw!).toBeLessThanOrEqual(-170); expect(keys[frame].yaw!).toBeGreaterThanOrEqual(-180);
    expect(keys[frame].headYaw!).toBeGreaterThan(-90);
  }
  expect(keys.at(-1)!.yaw).toBe(-360);
  expect(keys.at(-1)!.headYaw).toBe(-360);
  // Die Rückenansicht (−270°) wird erst auf beiden Füßen durchlaufen.
  const back = keys.findIndex(key => key.yaw! <= -270);
  for (const frame of [back - 1, back]) for (const foot of ['leftFoot', 'rightFoot']) expect(samplePose(ID, frame, 1)[foot][1]).toBeGreaterThan(-1.5);
  const kickEnd = MOVES[ID].startup + MOVES[ID].active - 1;
  const landing = keys.findIndex(key => key.frame > kickEnd && Math.max(...['leftFoot', 'rightFoot'].map(foot => samplePose(ID, key.frame, 1)[foot][1])) > -0.5 &&
    Math.min(samplePose(ID, key.frame, 1).leftFoot[1], samplePose(ID, key.frame, 1).rightFoot[1]) > -0.5);
  expect(landing).toBeGreaterThan(kickEnd);
  expect(landing).toBeLessThan(MOVES[ID].duration - 5);
});

it('springt nach vorne ab: Hüfte vor dem Sprungfuß, Vorlage, Flug nach vorne', () => {
  const { takeoff, touchdown } = DWIT;
  for (const facing of [1, -1] as const) {
    // Letzter Bodenkontakt des linken Fußes: das Bein drückt schräg nach hinten.
    const off = world(takeoff - 1, facing);
    expect(off.leftFoot[1]).toBeGreaterThan(-.5);
    expect((off.hip[0] - off.leftFoot[0]) * facing).toBeGreaterThan(5);
    expect(world(takeoff + 1, facing).leftFoot[1]).toBeLessThan(-3);
    // Der Oberkörper lehnt beim Abdruck in Sprungrichtung.
    for (const frame of [7, 8, 9]) { const p = world(frame, facing); expect((p.neck[0] - p.hip[0]) * facing).toBeGreaterThan(6); }
    // Die Hüfte läuft vom Laden bis zur Landung ohne Umkehr nach vorne.
    for (let frame = 1; frame <= touchdown; frame++)
      expect((world(frame, facing).hip[0] - world(frame - 1, facing).hip[0]) * facing).toBeGreaterThan(0);
    expect((world(touchdown, facing).hip[0] - world(0, facing).hip[0]) * facing).toBeGreaterThan(30);
  }
  // Wurfparabel: steigt bis zur Mitte der Active-Frames, fällt danach, Scheitel bei f20/21.
  const heights = Array.from({ length: DWIT.touchdown - DWIT.takeoff + 1 }, (_, i) => samplePose(ID, DWIT.takeoff + i, 1).hip[1]);
  const apex = DWIT.takeoff + heights.indexOf(Math.min(...heights));
  expect([20, 21]).toContain(apex);
  for (let i = 1; i < heights.length; i++) {
    if (DWIT.takeoff + i <= 20) expect(heights[i]).toBeLessThan(heights[i - 1]);
    if (DWIT.takeoff + i > 21) expect(heights[i]).toBeGreaterThan(heights[i - 1]);
  }
});

it('Rückwärtstritt: Ferse am Gesäß, dann stößt das Bein gerade zum Gegner', () => {
  for (const facing of [1, -1] as const) {
    // Kammer: Knie unter der Hüfte, Ferse am Gesäß.
    const chamber = samplePose(ID, 17, facing);
    expect(Math.hypot(chamber.rightFoot[0] - chamber.hip[0], chamber.rightFoot[1] - chamber.hip[1])).toBeLessThan(20);
    expect(chamber.rightKnee[1]).toBeGreaterThan(chamber.hip[1] + 15);
    // Die Ferse läuft von der Kammer bis zum Treffer stetig zum Gegner.
    for (let frame = 17; frame <= MOVES[ID].startup; frame++)
      expect((samplePose(ID, frame, facing).rightFoot[0] - samplePose(ID, frame - 1, facing).rightFoot[0]) * facing).toBeGreaterThan(0);
  }
});

it('winkelt das Sprungbein vom Gegner weg ab (Knie zur Körpervorderseite)', () => {
  for (const facing of [1, -1] as const) for (let frame = 16; frame <= 24; frame++) {
    const p = samplePose(ID, frame, facing);
    // Knie liegt weiter vom Gegner weg als Hüfte und Fuß, der Fuß zeigt zum Gegner.
    expect((p.leftKnee[0] - p.hip[0]) * facing, `f${frame}`).toBeLessThan(-4);
    expect((p.leftFoot[0] - p.leftKnee[0]) * facing, `f${frame}`).toBeGreaterThan(8);
  }
});

it('wechselt Knie und Füße nie sprunghaft die Seite (kein Umklappen in der Drehung)', () => {
  // Außer im Stoß und Einziehen bis zur Landung des Trittbeins (f16–31) und beim Hochziehen im
  // Absprung (f6–13) bewegt sich kein Knie und kein Fuß relativ zur Hüfte mehr als 12 Einheiten pro Frame.
  const rel = (p: Record<string, number[]>, j: string) => [p[j][0] - p.hip[0], p[j][1] - p.hip[1]];
  for (let frame = 1; frame < MOVES[ID].duration; frame++) {
    const a = samplePose(ID, frame - 1, 1), b = samplePose(ID, frame, 1);
    for (const j of ['leftKnee', 'leftFoot', 'rightKnee', 'rightFoot']) {
      if (j.startsWith('right') && ((frame >= 16 && frame <= 31) || (frame >= 6 && frame <= 13))) continue;
      const [x0, y0] = rel(a, j), [x1, y1] = rel(b, j);
      expect(Math.hypot(x1 - x0, y1 - y0), `${j} f${frame - 1}→f${frame}`).toBeLessThan(12);
    }
  }
});

it('trifft aus der Nähe und aus der Ferne mit einem Treffer, Block und Hocke wie bisher', () => {
  for (const distance of [60, 100]) {
    const { hits } = play(distance);
    expect(hits.map(h => h.damage)).toEqual([105]);
    expect(hits[0].frame).toBe(MOVES[ID].startup);
  }
  expect(play(60, { ...neutralInput(), right: true }).hits).toEqual([{damage:Math.round(MOVES[ID].damage*.08),frame:MOVES[ID].startup}]);
  const crouch = play(60, { ...neutralInput(), right: true, down: true });
  expect(crouch.hits).toEqual([]); expect(crouch.game.fighters[1].state).not.toBe('Blockstun');
});

it('beugt Knie und Ellenbogen nur zur Körpervorderseite (abseits Frontal- und Rückenansicht)', () => {
  const keys = animations[ID].keyframes;
  // Außerhalb von ±25° um die Frontal-/Rückenansicht zeigt die Körpervorderseite eindeutig zur einen Seite.
  const side = keys.filter(k => Math.abs(Math.cos(k.yaw! * Math.PI / 180)) > Math.sin(25 * Math.PI / 180)).map(k => k.frame);
  expect(side.length).toBeGreaterThan(35);
  for (const frame of side) {
    const p = samplePose(ID, frame, 1), front = Math.sign(Math.cos(keys[frame].yaw! * Math.PI / 180));
    for (const leg of ['left', 'right']) {
      const flex = wrap(deg(p[`${leg}Knee`], p[`${leg}Foot`]) - deg(p.hip, p[`${leg}Knee`])) * front;
      expect(flex, `${leg} Knie f${frame}`).toBeGreaterThan(-1.5);
    }
    for (const arm of ['left', 'right']) {
      const flex = wrap(deg(p[`${arm}Shoulder`], p[`${arm}Elbow`]) - deg(p[`${arm}Elbow`], p[`${arm}Hand`])) * front;
      expect(flex, `${arm} Ellenbogen f${frame}`).toBeGreaterThan(-1);
      expect(flex, `${arm} Ellenbogen f${frame}`).toBeLessThan(170);
    }
  }
});

it('lehnt beim Tritt leicht vom Gegner weg, beide Fäuste bleiben vor der Brust', () => {
  for (const facing of [1, -1] as const) for (let frame = 19; frame <= 22; frame++) {
    const p = samplePose(ID, frame, facing), lean = (p.hip[0] - p.neck[0]) * facing;
    expect(lean).toBeGreaterThan(1); expect(lean).toBeLessThan(30 * Math.sin(15 * Math.PI / 180));
    // Körpervorderseite zeigt vom Gegner weg: beide Hände liegen auf dieser Seite, nah am Körper.
    for (const hand of ['leftHand', 'rightHand']) {
      expect((p[hand][0] - p.neck[0]) * facing, `${hand} f${frame}`).toBeLessThan(0);
      expect(Math.hypot(p[hand][0] - p.neck[0], p[hand][1] - p.neck[1]), `${hand} f${frame}`).toBeLessThan(30);
    }
  }
});
