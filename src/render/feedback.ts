import { MOVES, type HitLevel } from '../data/schema';
import { animations } from './skeleton';
import type { GameState } from '../simulation/types';

/** Frames the winner takes to lower his arms after a knockout. */
export const RELAX_FRAMES = Math.round(animations.KO.durationFrames*1.5);

/** Presentation only. Retained until recovery, including after the attacker recovers. */
export class HitFeedback {
  koFrames = [0,0];
  /** Presentation only: how long the surviving winner has been lowering his arms. */
  relaxFrames = [0,0];
  levels: (HitLevel | undefined)[] = [undefined,undefined];
  reset(game?: GameState): void {
    this.levels=[undefined,undefined];
    this.relaxFrames=[0,0];
    this.koFrames=game?.fighters.map(f=>f.state==='KO'?game.round.phase==='fighting'?f.stateFrame:animations.KO.durationFrames-1:0)??[0,0];
    // An imported snapshot can begin in stun, before any locally observed contact.
    if(game?.lastContact && !game.lastContact.blocked) {
      const contact=game.lastContact,moveId=game.fighters[contact.attacker].moveId;
      this.levels[contact.defender]=contact.hitLevel??(moveId?MOVES[moveId]?.hitLevel:undefined);
    }
  }
  update(game: GameState, previous: GameState): void {
    for(const f of game.fighters) {
      // Rounds freeze fighter stateFrame; advance only presentation on game steps.
      const old=previous.fighters[f.id];
      this.koFrames[f.id]=f.state!=='KO'||old.state!=='KO'?0:
        Math.min(animations.KO.durationFrames-1,this.koFrames[f.id]+(previous.hitstop?0:1));
      // The winner keeps his guard up until he stands still, then lets the arms sink.
      const opponent=game.fighters[1-f.id];
      this.relaxFrames[f.id]=opponent.state==='KO'&&f.state==='Idle'&&f.y===0
        ? Math.min(RELAX_FRAMES,this.relaxFrames[f.id]+(previous.hitstop?0:1)) : 0;
      if(f.hp<previous.fighters[f.id].hp) {
        const attacker=previous.fighters[1-f.id],current=game.fighters[1-f.id];
        const moveId=attacker.moveId??current.moveId;
        const contact=game.lastContact;
        this.levels[f.id]=(contact?.defender===f.id?contact.hitLevel:undefined)??(moveId?MOVES[moveId]?.hitLevel:undefined);
      } else if(!['Hitstun','Knockdown','KO'].includes(f.state))this.levels[f.id]=undefined;
    }
  }
}
