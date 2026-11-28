import rules from '../data/rules.json';
import type { RawInput } from '../input/types';
import { createFighter, createRound } from './factory';
import type { GameState } from './types';
import type { IntroState } from './intro';

export interface RoundState {
  phase: 'intro' | 'fighting' | 'roundOver' | 'matchOver';
  number: number;
  timer: number;
  wins: [number, number];
  transition: number;
  winner: number | null;
  reason: 'KO' | 'TIME OVER' | 'DOUBLE KO' | 'DRAW' | null;
  /** Versus round intro progress; 'fight' only keeps the banner during the first fighting frames. */
  intro: IntroState | null;
  /** Leftover timer ticks (in percent of a frame) while the game runs above the standard pace. */
  timerCarry?: number;
}
/** Whether a new round of this game opens with the intro (versus only, never in training). */
export function playsIntro(game: GameState): boolean { return game.roundIntro === true && !game.training.enabled; }
export { createRound };
export function resetRound(game: GameState, inputs: [RawInput, RawInput]): void {
  const resources = game.fighters.map(fighter => structuredClone(fighter.resources));
  game.fighters = [createFighter(0),createFighter(1)];
  for (const f of game.fighters) {
    f.resources = resources[f.id];
    f.input.previous = { ...inputs[f.id], taps:0 };
  }
  game.hitstop=0; game.lastContact=null; game.measurements=[]; delete game.guardBreak;
  game.round = { ...createRound(playsIntro(game)), wins:game.round.wins, number:game.round.wins[0]+game.round.wins[1]+1 };
}
export function advanceRound(game: GameState, inputs: [RawInput, RawInput]): void {
  if (game.round.phase === 'roundOver' && --game.round.transition <= 0) resetRound(game,inputs);
}
export function resolveRound(game: GameState): void {
  const round = game.round;
  if (round.phase !== 'fighting') return;
  const pace = game.pace ?? 100;
  if (pace === 100) round.timer = Math.max(0,round.timer-1);
  else {
    // Faster pace: more frames per real second, the timer still counts real seconds.
    const carry = (round.timerCarry ?? 0) + 100, ticks = Math.floor(carry / pace);
    round.timerCarry = carry - ticks * pace;
    round.timer = Math.max(0,round.timer-ticks);
  }
  const [a,b]=game.fighters;
  if (a.hp>0 && b.hp>0 && round.timer>0) return;
  const knockout = a.hp===0 || b.hp===0;
  round.winner = a.hp===b.hp ? null : a.hp>b.hp ? 0 : 1;
  round.reason = knockout ? round.winner===null?'DOUBLE KO':'KO' : round.winner===null?'DRAW':'TIME OVER';
  if (round.winner!==null) round.wins[round.winner]++;
  round.phase = round.wins.some(wins=>wins>=rules.winsRequired)?'matchOver':'roundOver';
  round.transition=rules.roundTransition;
  round.intro=null;
  for(const f of game.fighters) { f.input.pending=null; f.advantage='n/a'; }
  game.measurements=[];
}
