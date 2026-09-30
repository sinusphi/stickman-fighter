import rules from './rules.json';
import type { Resources } from '../simulation/types';
import rawMoves from './moves.json';
import poses from './poses.json';
import type { Animation, Rotation } from '../render/animation-types';
import { BUTTONS, type Button } from '../input/types';
import type { Box, Stance } from '../simulation/collision';

export type HitLevel = 'LOW' | 'MID' | 'HIGH';
/** Optional per-group values override the move's frame data. `activeFrames`
 * gives an early secondary strike (e.g. the knee before a kick) its own window
 * outside the move's main active phase; startup/active keep describing the main hit. */
export interface HitGroup {
  id: string; maxHitsPerTarget: number; hitLevel?: HitLevel; damage?: number;
  activeFrames?: [number, number];
  hitstun?: number; blockstun?: number; pushbackHit?: number; pushbackBlock?: number; hitstop?: number;
}
export const GROUP_FRAME_DATA = ['hitstun','blockstun','pushbackHit','pushbackBlock','hitstop'] as const;
/** Effective reaction value of one hit group: its own override or the move's value. */
export function groupValue(move: Move, group: HitGroup, key: typeof GROUP_FRAME_DATA[number]): number {
  return group[key] ?? move[key];
}
export interface Hitbox extends Box { hitGroup: string }
export interface FrameBoxes { hitboxes: Hitbox[]; hurtboxes: Box[]; pushbox: Box }
export interface CancelWindow { fromFrame: number; toFrame: number; on: ('hit' | 'block' | 'whiff')[]; type: 'chain' | 'target' | 'special' | 'super'; targetMoveIds: string[] }
export interface Move {
  schemaVersion: number; id: string; stance: Stance; button: Button;
  command: { type: 'normal' | 'motion' | 'hold'; directions: number[]; buttons: Button[]; trigger: 'pressed' | 'released'; priority: number; motionId?: string };
  animation: string; startup: number; active: number; recovery: number; damage: number; hitLevel: HitLevel;
  hitstun: number; blockstun: number; pushbackHit: number; pushbackBlock: number; hitstop: number;
  advance?: { frames: number; distance: number };
  groundHitReaction?: 'middlePunch'; slideSpeed?: number;
  airHitReaction: 'knockdown'; multiHit: boolean; hitGroups: HitGroup[];
  cancelWindows: CancelWindow[]; combo: { scalingPermille: number; juggleCost: number; juggleLimit: number };
  frameRanges: (FrameBoxes & { from: number; to: number })[];
}
export type CompiledMove = Move & { frames: FrameBoxes[]; duration: number };

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw Error(`Ungültige Spieldaten: ${message}`); }
function integer(value: number, min = 0): boolean { return Number.isSafeInteger(value) && value >= min; }
function validateBox(box: Box): void {
  assert(box && Number.isSafeInteger(box.x) && Number.isSafeInteger(box.y) && integer(box.width, 1) && integer(box.height, 1), 'Box muss ganzzahlige Position und positive Größe haben.');
}
export function validatePoses(value: unknown): void {
  const data=value as typeof poses;
  assert(data?.schemaVersion===2 && data.skeleton && Array.isArray(data.skeleton.bones),'Skelett fehlt.');
  const joints=new Set([data.skeleton.rootJoint]);
  for(const bone of data.skeleton.bones) {
    assert(joints.has(bone.parent) && !joints.has(bone.joint) && Number.isFinite(bone.length) && bone.length>0,'Knochenhierarchie oder Länge.');
    assert((bone.width===undefined || Number.isFinite(bone.width) && bone.width>0) && (bone.tipWidth===undefined || Number.isFinite(bone.tipWidth) && bone.tipWidth>0),'Segmentbreite.');
    joints.add(bone.joint);
  }
  assert(joints.has(data.skeleton.headJoint) && Number.isFinite(data.skeleton.headRadius) && data.skeleton.headRadius>0,'Kopfdefinition.');
  const segmentIds=new Set([...data.skeleton.bones.map(b=>b.joint),'headCircle']);
  const validateDepths=(value: unknown)=>assert(value && typeof value==='object' && !Array.isArray(value) && Object.entries(value).every(([id,depth])=>segmentIds.has(id) && typeof depth==='number' && Number.isFinite(depth)),'Segmenttiefe: bekannte Segmente und endliche Tiefenwerte erforderlich.');
  validateDepths(data.segmentDepths);
  assert(Object.keys(data.segmentDepths).length===segmentIds.size,'Standardtiefen müssen alle Segmente abdecken.');
  assert(data.skeleton.segments.length===data.skeleton.bones.length && data.skeleton.segments.every(([a,b],i)=>a===data.skeleton.bones[i].parent && b===data.skeleton.bones[i].joint),'Zeichenverbindungen.');
  for(const [id,pose] of Object.entries(data.poses)) {
    assert(Array.isArray(pose.root) && pose.root.length===2 && pose.root.every(Number.isFinite),`${id}: Wurzel.`);
    for(const bone of data.skeleton.bones) assert(Number.isFinite((pose.angles as Record<string,number>)[bone.joint]),`${id}: Gelenkwinkel ${bone.joint}.`);
  }
  for(const [id,animation] of Object.entries(data.animations as Record<string,Animation & {interpolation:string}>)) {
    assert(integer(animation.durationFrames,1) && animation.keyframes.length>0 && typeof animation.loop==='boolean' && animation.interpolation==='angles' && typeof animation.grounded==='boolean',`${id}: Animationsdauer oder Interpolation.`);
    assert(animation.clampFloor===undefined || typeof animation.clampFloor==='boolean',`${id}: Bodenbegrenzung.`);
    assert(animation.fixedLegDepth===undefined || typeof animation.fixedLegDepth==='boolean',`${id}: feste Beintiefe.`);
    assert(animation.legInterpolation===undefined || ['footIK','plantedSupport','plantedStraight','plantedPivot'].includes(animation.legInterpolation) && animation.grounded && ['leftFoot','rightFoot'].includes(animation.trail?.joint??''),`${id}: Beininterpolation benötigt einen geerdeten Tritt mit Fußspur.`);
    const topology=(r:Rotation)=>JSON.stringify({pivot:typeof r.pivot==='string'?r.pivot:'xy',branches:r.branches});
    const tracks=animation.keyframes[0].rotations??[];
    assert(animation.trails===undefined || Array.isArray(animation.trails),`${id}: zusätzliche Bewegungsspuren.`);
    const trails=[...(animation.trail?[animation.trail]:[]),...(animation.trails??[])];
    assert(trails.length<=4,`${id}: zu viele Bewegungsspuren.`);
    for(const trail of trails)assert((trail.directional===undefined || typeof trail.directional==='boolean') && joints.has(trail.joint) && integer(trail.fromFrame) && integer(trail.toFrame) && trail.toFrame>=trail.fromFrame && trail.toFrame<animation.durationFrames && Number.isFinite(trail.historyFrames) && trail.historyFrames>0 && trail.historyFrames<=30,`${id}: Bewegungsspur.`);
    let previous=-1;
    for(const key of animation.keyframes) {
      assert(key.turn===undefined || Number.isFinite(key.turn) && key.turn>=0 && key.turn<=1,`${id}: Körperdrehung.`);
      assert(key.yaw===undefined || Number.isFinite(key.yaw),`${id}: Blickwinkel.`);
      if(key.depths!==undefined)validateDepths(key.depths);
      assert(['linear','easeInQuad','easeOutCubic','smoothstep'].includes(key.easing) && integer(key.frame) && key.frame>previous && key.frame<animation.durationFrames && Object.hasOwn(data.poses,key.pose),`${id}: Keyframe/Pose.`);
      assert(key.rotations===undefined || Array.isArray(key.rotations),`${id}: Rotationstracks.`);
      const rotations=key.rotations??[];
      for(const rotation of rotations) {
        assert(rotation && Number.isFinite(rotation.angle),`${id}: Rotationswinkel.`);
        assert(typeof rotation.pivot==='string'?joints.has(rotation.pivot):Array.isArray(rotation.pivot) && rotation.pivot.length===2 && rotation.pivot.every(Number.isFinite),`${id}: Rotationspivot.`);
        if(rotation.branches!==undefined) {
          assert(Array.isArray(rotation.branches) && rotation.branches.length>0 && new Set(rotation.branches).size===rotation.branches.length,`${id}: Rotationsketten.`);
          assert(typeof rotation.pivot==='string' && rotation.branches.every(joint=>data.skeleton.bones.some(b=>b.joint===joint && b.parent===rotation.pivot)),`${id}: Teilketten müssen am gemeinsamen Pivot anschließen.`);
        }
      }
      assert(rotations.length===tracks.length && rotations.every((r,i)=>topology(r)===topology(tracks[i])),`${id}: Rotationstracks müssen über Keyframes dieselben Ketten/Pivotarten behalten.`);
      previous=key.frame;
    }
    assert(animation.keyframes[0].frame===0,`${id}: erster Keyframe muss Frame 0 sein.`);
  }
}
export function validateMoves(values: unknown): Record<string, CompiledMove> {
  assert(Array.isArray(values), 'Moves müssen eine Liste sein.');
  const result: Record<string, CompiledMove> = {};
  for (const move of values as Move[]) {
    assert(move && move.schemaVersion === 1 && typeof move.id === 'string' && move.id.length && !result[move.id], 'Move-ID oder Version.');
    assert(['standing','crouching','airborne'].includes(move.stance) && BUTTONS.includes(move.button), `${move.id}: Haltung/Button.`);
    assert(['LOW','MID','HIGH'].includes(move.hitLevel), `${move.id}: Hit-Level.`);
    assert(move.animation in poses.animations, `${move.id}: Animation fehlt.`);
    assert([move.startup,move.recovery,move.damage,move.hitstun,move.blockstun,move.pushbackHit,move.pushbackBlock,move.hitstop].every(n => integer(n)) && integer(move.active,1), `${move.id}: Frame-Data.`);
    assert(move.advance===undefined || integer(move.advance.frames,1) && move.advance.frames<=move.startup && integer(move.advance.distance) && move.stance!=='airborne',`${move.id}: Vorwärtsschritt.`);
    assert(move.groundHitReaction===undefined || move.groundHitReaction==='middlePunch',`${move.id}: Bodenreaktion.`);
    assert(move.slideSpeed===undefined || integer(move.slideSpeed),`${move.id}: Rutschgeschwindigkeit.`);
    assert(move.command && ['normal','motion','hold'].includes(move.command.type) && ['pressed','released'].includes(move.command.trigger) && move.command.buttons.every(b => BUTTONS.includes(b)) && move.command.directions.every(d=>integer(d,1)&&d<=9), `${move.id}: Command.`);
    if(move.command.type==='hold') {
      const {directions,buttons}=move.command;
      const single=buttons.length===1 && buttons[0]===move.button;
      const back=directions[0]===4 && ['LK','MK','HK'].includes(move.button) && single;
      const forward=directions[0]===6 && (single && ['HP','MK','HK'].includes(move.button) || move.button==='HK' && buttons.length===2 && buttons.includes('MK') && buttons.includes('HK'));
      assert(move.stance==='standing' && move.command.trigger==='pressed' && directions.length===1 && (back||forward),`${move.id}: Hold-Command nur für stehende Richtung+Angriffe.`);
    }
    assert(Array.isArray(move.cancelWindows) && Array.isArray(move.hitGroups) && move.hitGroups.length > 0 && move.hitGroups.every(g => typeof g.id === 'string' && integer(g.maxHitsPerTarget,1)), `${move.id}: Hit-/Cancel-Gruppen.`);
    assert(move.hitGroups.every(g=>(g.hitLevel===undefined || ['LOW','MID','HIGH'].includes(g.hitLevel)) && (g.damage===undefined || integer(g.damage))),`${move.id}: Treffergruppen-Level oder Schaden.`);
    assert(move.hitGroups.every(g=>GROUP_FRAME_DATA.every(key=>g[key]===undefined || integer(g[key]))),`${move.id}: Frame-Data der Treffergruppe.`);
    assert(move.hitGroups.every(g=>g.activeFrames===undefined || Array.isArray(g.activeFrames) && g.activeFrames.length===2 && integer(g.activeFrames[0]) && integer(g.activeFrames[1]) && g.activeFrames[0]<=g.activeFrames[1] && g.activeFrames[1]<move.startup+move.active+move.recovery),`${move.id}: Trefferfenster der Treffergruppe.`);
    assert(move.combo && [move.combo.scalingPermille,move.combo.juggleCost,move.combo.juggleLimit].every(n=>integer(n)), `${move.id}: Combo-Felder.`);
    assert(typeof move.multiHit === 'boolean' && move.airHitReaction === 'knockdown', `${move.id}: Trefferverhalten.`);
    assert(new Set(move.hitGroups.map(group=>group.id)).size===move.hitGroups.length && (move.multiHit || (move.hitGroups.length===1 && move.hitGroups[0].maxHitsPerTarget===1)),`${move.id}: Single-/Multi-Hit-Gruppen.`);
    const duration = move.startup + move.active + move.recovery;
    const frames: FrameBoxes[] = [];
    assert(Array.isArray(move.frameRanges), `${move.id}: Frames fehlen.`);
    for (const range of move.frameRanges) {
      assert(integer(range.from) && range.from === frames.length && integer(range.to) && range.to >= range.from && range.to < duration, `${move.id}: Frame-Lücke oder Überlappung.`);
      assert(Array.isArray(range.hitboxes) && Array.isArray(range.hurtboxes) && range.hurtboxes.length > 0, `${move.id}: Körperboxen fehlen.`);
      [...range.hitboxes, ...range.hurtboxes, range.pushbox].forEach(validateBox);
      for (const hit of range.hitboxes) {
        const group = move.hitGroups.find(g=>g.id===hit.hitGroup);
        assert(group, `${move.id}: unbekannte Hit-Gruppe.`);
        const [from, to] = group.activeFrames ?? [move.startup, move.startup + move.active - 1];
        assert(range.from >= from && range.to <= to, `${move.id}: Hitbox außerhalb ${group.activeFrames?`des Fensters von ${group.id}`:'Active'}.`);
      }
      for (let frame = range.from; frame <= range.to; frame++) frames.push(range);
    }
    assert(frames.length === duration, `${move.id}: unvollständige Frame-Abdeckung.`);
    result[move.id] = { ...move, frames, duration };
  }
  for (const stance of ['standing','crouching','airborne']) for (const button of BUTTONS)
    assert(Object.values(result).some(m => m.stance === stance && m.button === button && m.command.type === 'normal'), `${stance}/${button} fehlt.`);
  for (const move of Object.values(result)) for (const cancel of move.cancelWindows) {
    assert(integer(cancel.fromFrame) && integer(cancel.toFrame) && cancel.fromFrame <= cancel.toFrame && cancel.toFrame < move.duration && cancel.targetMoveIds.every(id=>id in result), `${move.id}: Cancel-Ziel oder Fenster.`);
    assert(['chain','target','special','super'].includes(cancel.type) && Array.isArray(cancel.on) && cancel.on.every(condition=>['hit','block','whiff'].includes(condition)),`${move.id}: Cancel-Art oder Bedingung.`);
  }
  return result;
}

export function validateResources(value: unknown): asserts value is Resources {
  const resources=value as Resources;
  for(const name of ['revenge','special'] as const) {
    const r=resources?.[name];
    assert(r && integer(r.max,1) && integer(r.current) && r.current<=r.max && integer(r.gainPerHit),`Ressource ${name}.`);
  }
}
validateResources(rules.resources);
validatePoses(poses);
export const MOVES = validateMoves(rawMoves);
