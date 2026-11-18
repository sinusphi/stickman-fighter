import { neutralInput, type RawInput } from '../input/types';
import { requiresCrouchGuard } from '../simulation/guard';
import { nextHitLevel } from '../ai/knowledge';
import { MOVES } from '../data/schema';
import type { GameState } from '../simulation/types';

export type DummyMode = 'stand' | 'crouch' | 'block' | 'cpu';
export interface TrainingState { enabled: boolean; dummy: DummyMode }

export function dummyInput(game: GameState): RawInput {
  const input = neutralInput();
  if (game.training.dummy === 'crouch') input.down = true;
  if (game.training.dummy === 'block') {
    const [attacker, defender] = game.fighters;
    input.left = defender.facing === 1; input.right = defender.facing === -1;
    const move = attacker.moveId ? MOVES[attacker.moveId] : undefined;
    const level = nextHitLevel(attacker.moveId, attacker.moveFrame);
    input.down = Boolean(move && level && requiresCrouchGuard(level, move.stance, attacker.y<0));
  }
  return input;
}
