import { CpuPlayer } from '../src/ai';
import { createGame, step } from '../src/simulation/state';
import type { Difficulty } from '../src/ai/profiles';
import rules from '../src/data/rules.json';
export function tournament(a: Difficulty, b: Difficulty, rounds = 100, seed = 12000) {
  const result = { a,b,rounds,winsA:0,winsB:0,draws:0,ko:0,frames:0 };
  for(let i=0;i<rounds;i++) {
    const swapped=i%2===1, levels: [Difficulty,Difficulty]=swapped?[b,a]:[a,b];
    const game=createGame(), players=levels.map((p,id)=>new CpuPlayer(p,id as 0|1));
    players[0].reset(seed+i*2);players[1].reset(seed+i*2+1);
    while(game.round.phase==='fighting' && game.frame<rules.hz*150) {
      step(game,[players[0].next(game),players[1].next(game)]);
    }
    result.frames+=game.frame;
    if(game.round.reason==='KO')result.ko++;
    if(game.round.winner===null)result.draws++;
    else if(game.round.winner===(swapped?1:0))result.winsA++;
    else result.winsB++;
  }
  return result;
}
