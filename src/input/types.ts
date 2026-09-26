export const BUTTONS = ['LP', 'MP', 'HP', 'LK', 'MK', 'HK', 'RLK', 'LMK', 'RHK'] as const;
export const BUTTON_MASK = (1 << BUTTONS.length) - 1;
export const BUTTON_LABELS: Record<typeof BUTTONS[number], string> = { LP:'Punch leicht', MP:'Punch mittel', HP:'Punch schwer', LK:'Links · Low', LMK:'Links · Middle', HK:'Links · High', RLK:'Rechts · Low', MK:'Rechts · Middle', RHK:'Rechts · High' };
export type Button = typeof BUTTONS[number];
export const buttonBit = (button: Button): number => 1 << BUTTONS.indexOf(button);
export type Direction = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type SocdMode = 'neutral' | 'positive' | 'lastInputWins';
export interface SocdConfig { horizontal: SocdMode; vertical: SocdMode }
export interface RawInput { left: boolean; right: boolean; up: boolean; down: boolean; buttons: number; taps?: number }
export const neutralInput = (): RawInput => ({ left: false, right: false, up: false, down: false, buttons: 0 });
export interface InputFrame { frame: number; direction: Direction; pressed: number; held: number; released: number }
export interface InputHistory { frames: (InputFrame | null)[]; cursor: number; length: number }
export interface InputState {
  history: InputHistory;
  previous: RawInput;
  horizontalLast: number;
  verticalLast: number;
  current: InputFrame;
  pending: { button: Button; expires: number; motions: string[] } | null;
  motions: string[];
  display: (InputFrame & { duration: number })[];
}
