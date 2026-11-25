import type { GameState } from '../simulation/types';

/*
 * Round announcer (presentation only). Every cue maps to a recording base name
 * under public/sounds/announcer/; the first existing file of ANNOUNCER_EXTENSIONS
 * is played. Without a recording the cue stays silent and only the banner shows.
 * Recordings are not bundled yet; drop e.g. `ready_up.ogg` and `fight.ogg` there.
 */
export type AnnouncerCue = 'readyUp' | 'fight';
/** Central hook table: cue -> file base name. */
export const ANNOUNCER_FILES: Record<AnnouncerCue, string> = { readyUp: 'ready_up', fight: 'fight' };
export const ANNOUNCER_DIRECTORY = 'sounds/announcer/';
/** Tried in this order; the first file that loads and decodes wins. */
export const ANNOUNCER_EXTENSIONS = ['ogg', 'mp3', 'wav', 'm4a'] as const;
export const ANNOUNCER_GAIN = 0.9;

/** Candidate URLs (relative to the app base) for one cue. */
export function announcerPaths(cue: AnnouncerCue): string[] {
  return ANNOUNCER_EXTENSIONS.map(extension => `${ANNOUNCER_DIRECTORY}${ANNOUNCER_FILES[cue]}.${extension}`);
}

/**
 * Cues reached in this step: "ready up" on the first intro frame of a round,
 * "fight" when the intro hands over to the fight.
 */
export function newAnnouncerCues(game: GameState, previous: GameState): AnnouncerCue[] {
  const now = game.round.intro, then = previous.round.intro;
  const cues: AnnouncerCue[] = [];
  if (now?.step === 'ready' && now.frame === 1 && !(then?.step === 'ready' && then.frame === 1)) cues.push('readyUp');
  if (now?.step === 'fight' && then?.step !== 'fight') cues.push('fight');
  return cues;
}
