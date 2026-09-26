import type { Fighter, GameState } from '../simulation/types';
export type VisibleFighter = Pick<Fighter, 'x' | 'y' | 'vx' | 'vy' | 'facing' | 'state' | 'stateFrame' | 'crouching' | 'moveId' | 'moveFrame' | 'attackFacing' | 'hp' | 'resources'>;
export interface Observation {
  frame: number; fighters: [VisibleFighter, VisibleFighter];
  round: Pick<GameState['round'], 'phase' | 'timer'>;
  hitstop: number; lastContact: GameState['lastContact'];
}
export interface View {
  frame: number; self: VisibleFighter; opponent: VisibleFighter | null;
  round: Observation['round']; hitstop: number; lastContact: Observation['lastContact'];
}
function visible(f: Fighter): VisibleFighter {
  return { x:f.x, y:f.y, vx:f.vx, vy:f.vy, facing:f.facing, state:f.state, stateFrame:f.stateFrame,
    crouching:f.crouching, moveId:f.moveId, moveFrame:f.moveFrame, attackFacing:f.attackFacing, hp:f.hp,
    resources: { revenge:{...f.resources.revenge}, special:{...f.resources.special} } };
}
export function observe(game: GameState): Observation {
  return { frame:game.frame, fighters:[visible(game.fighters[0]), visible(game.fighters[1])],
    round:{ phase:game.round.phase, timer:game.round.timer }, hitstop:game.hitstop,
    lastContact:game.lastContact ? {...game.lastContact} : null };
}
export class Perception {
  private history: (Observation | undefined)[];
  constructor(readonly delay: number) { this.history = new Array(delay + 1); }
  reset(): void { this.history.fill(undefined); }
  next(now: Observation, player: 0 | 1): View {
    const size = this.history.length;
    this.history[now.frame % size] = now;
    const old = now.frame >= this.delay ? this.history[(now.frame - this.delay) % size] : undefined;
    const delayed = old?.frame === now.frame - this.delay ? old : undefined;
    return { frame:now.frame, self:now.fighters[player], opponent:delayed?.fighters[1-player] ?? null,
      round:now.round, hitstop:now.hitstop, lastContact:delayed?.lastContact ?? null };
  }
}
