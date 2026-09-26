import { neutralInput, type RawInput } from '../input/types';
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
    input.down = attacker.moveId !== null && MOVES[attacker.moveId].hitLevel === 'LOW';
  }
  return input;
}
