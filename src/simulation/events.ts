import type { GameState } from './types';
import type { DummyMode } from '../debug/training';
import { createGame } from './state';

export type ControlEvent =
  | { type: 'reset' }
  | { type: 'training'; enabled: boolean; dummy: DummyMode }
  | { type: 'inputConfig'; config: GameState['inputConfig'] };

export function applyEvents(game: GameState, events: ControlEvent[]): void {
  for (const event of events) {
    if (event.type === 'inputConfig') game.inputConfig = structuredClone(event.config);
    if (event.type === 'training') {
      const toggled = event.enabled !== game.training.enabled;
      game.training = { enabled: event.enabled, dummy: event.dummy };
      if (toggled) applyEvents(game, [{ type: 'reset' }]);
    }
    if (event.type === 'reset') {
      const { frame, combatFrame, inputConfig, training } = game;
      Object.assign(game, createGame(), { frame, combatFrame, inputConfig, training });
    }
  }
}
