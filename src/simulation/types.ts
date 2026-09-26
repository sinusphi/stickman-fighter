import type { InputState, SocdConfig } from '../input/types';
import type { RoundState } from './rounds';
import type { TrainingState } from '../debug/training';
import type { HitLevel } from '../data/schema';

export type Facing = -1 | 1;
export type FighterState = 'Idle' | 'Walk' | 'Crouch' | 'CrouchWalk' | 'JumpSquat' | 'Airborne' | 'Landing' | 'Attack' | 'Hitstun' | 'Blockstun' | 'Knockdown' | 'KO';

export interface Resource { current: number; max: number; gainPerHit: number }
export type Resources = Record<'revenge' | 'special', Resource>;

export interface Fighter {
  resources: Resources;
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: Facing;
  state: FighterState;
  stateFrame: number;
  hitReaction?: 'middlePunch';
  hp: number;
  input: InputState;
  crouching: boolean;
  remaining: number;
  jumpX: number;
  airAttackUsed: boolean;
  landingRecovery: number;
  moveId: string | null;
  moveFrame: number;
  attackFacing: Facing;
  attackId: number;
  hitTargets: string[];
  comboCount: number;
  damageScalePermille: number;
  juggleState: number;
  advantage: number | 'pending' | 'n/a';
}

export interface GameState {
  schemaVersion: number;
  frame: number;
  combatFrame: number;
  fighters: [Fighter, Fighter];
  inputConfig: { socd: SocdConfig; bufferFrames: number };
  hitstop: number;
  lastContact: { attacker: number; defender: number; blocked: boolean; frame: number; hitLevel?: HitLevel } | null;
  measurements: { attacker: number; defender: number; attackerReady: number | null; defenderReady: number | null; complete: boolean }[];
  round: RoundState;
  training: TrainingState;
}
