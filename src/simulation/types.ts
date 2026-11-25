import type { InputState, SocdConfig } from '../input/types';
import type { RoundState } from './rounds';
import type { TrainingState } from '../debug/training';
import type { HitLevel } from '../data/schema';

export type Facing = -1 | 1;
export type FighterState = 'Idle' | 'Walk' | 'Run' | 'Crouch' | 'CrouchWalk' | 'JumpSquat' | 'Airborne' | 'Landing' | 'Attack' | 'Hitstun' | 'Blockstun' | 'Knockdown' | 'KO' | 'Thrown';

export interface Resource { current: number; max: number; gainPerHit: number; gainPerBlock: number }
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
  /** Only while `Thrown`: the opponent's executing throw move (see simulation/throws). */
  thrownBy?: string;
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
  /**
   * Resistance against ground knockdowns (see rules.hitStrength). A grounded hit
   * whose strength reaches this value knocks the fighter down. Unset means
   * rules.hitStrength.defaultStability; later survival enemy types tune it.
   */
  stability?: number;
}

export type ContactPose = Pick<Fighter,'x'|'y'|'vx'|'facing'|'attackFacing'|'state'|'stateFrame'|'moveId'|'moveFrame'|'crouching'|'hitReaction'> & { hitLevel?: HitLevel };
export interface GameState {
  schemaVersion: number;
  frame: number;
  combatFrame: number;
  fighters: [Fighter, Fighter];
  inputConfig: { socd: SocdConfig; bufferFrames: number; autoBlock?: [boolean, boolean] };
  hitstop: number;
  lastContact: { attacker: number; defender: number; blocked: boolean; frame: number; hitLevel?: HitLevel; poses?: ContactPose[] } | null;
  measurements: { attacker: number; defender: number; attackerReady: number | null; defenderReady: number | null; complete: boolean }[];
  round: RoundState;
  training: TrainingState;
  /**
   * Survival only: a defender facing away from the attacker cannot block, so
   * attacks into the back always connect. Unset in versus, training and replays.
   */
  noRearGuard?: boolean;
}
