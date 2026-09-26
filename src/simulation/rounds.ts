import rules from '../data/rules.json';
import type { RawInput } from '../input/types';
import { createFighter } from './state';
import type { GameState } from './types';

export interface RoundState {
  phase: 'fighting' | 'roundOver' | 'matchOver';
  number: number;
  timer: number;
  wins: [number, number];
  transition: number;
  winner: number | null;
  reason: 'KO' | 'TIME OVER' | 'DOUBLE KO' | 'DRAW' | null;
}
export function createRound(): RoundState {
  return { phase:'fighting', number:1, timer:rules.roundSeconds*rules.hz, wins:[0,0], transition:0, winner:null, reason:null };
}
export function resetRound(game: GameState, inputs: [RawInput, RawInput]): void {
  const resources = game.fighters.map(fighter => structuredClone(fighter.resources));
  game.fighters = [createFighter(0),createFighter(1)];
  for (const f of game.fighters) {
    f.resources = resources[f.id];
    f.input.previous = { ...inputs[f.id], taps:0 };
  }
  game.hitstop=0; game.lastContact=null; game.measurements=[];
  game.round = { ...createRound(), wins:game.round.wins, number:game.round.wins[0]+game.round.wins[1]+1 };
}
export function advanceRound(game: GameState, inputs: [RawInput, RawInput]): void {
  if (game.round.phase === 'roundOver' && --game.round.transition <= 0) resetRound(game,inputs);
}
export function resolveRound(game: GameState): void {
  const round = game.round;
  if (round.phase !== 'fighting') return;
  round.timer = Math.max(0,round.timer-1);
  const [a,b]=game.fighters;
  if (a.hp>0 && b.hp>0 && round.timer>0) return;
  const knockout = a.hp===0 || b.hp===0;
  round.winner = a.hp===b.hp ? null : a.hp>b.hp ? 0 : 1;
  round.reason = knockout ? round.winner===null?'DOUBLE KO':'KO' : round.winner===null?'DRAW':'TIME OVER';
  if (round.winner!==null) round.wins[round.winner]++;
  round.phase = round.wins.some(wins=>wins>=rules.winsRequired)?'matchOver':'roundOver';
  round.transition=rules.roundTransition;
  for(const f of game.fighters) { f.input.pending=null; f.advantage='n/a'; }
  game.measurements=[];
}
