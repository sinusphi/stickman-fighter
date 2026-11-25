import type { RawInput } from '../input/types';

/** Frames after the choice opened in which controller and fighting keys are ignored (no accidental pick while mashing). */
export const CHOICE_LOCK_FRAMES = 20;

/**
 * Menu input of the survival upgrade choice with the player's own controls
 * (keyboard or gamepad): left/right move the cursor, a newly pressed attack
 * button takes the highlighted card. The digit keys 1–3 pick directly (see
 * main.ts). Presentation side only; the pick itself goes through the session.
 *
 * Buttons still held at the pick are swallowed until they are released, so
 * the confirming press does not start an attack when the run resumes.
 */
export class UpgradeChoice {
  cursor = 0;
  private open = false;
  private lock = 0;
  private previous = { left: false, right: false, buttons: 0 };
  private held = 0;

  /**
   * One frame while a choice with `cards` cards is open (`cards` = 0: none).
   * Returns the index to pick, or null.
   */
  update(raw: RawInput, cards: number): number | null {
    const buttons = raw.buttons | (raw.taps ?? 0);
    if (!cards) { this.open = false; return null; }
    if (!this.open) {
      // Freshly opened: start in the middle; whatever is held now does not count as a press.
      this.open = true; this.cursor = Math.floor((cards - 1) / 2); this.lock = CHOICE_LOCK_FRAMES;
      this.previous = { left: raw.left, right: raw.right, buttons };
      return null;
    }
    this.cursor = Math.min(this.cursor, cards - 1);
    const before = this.previous;
    this.previous = { left: raw.left, right: raw.right, buttons };
    if (this.lock > 0) { this.lock--; return null; }
    if (raw.left && !before.left) this.cursor = Math.max(0, this.cursor - 1);
    if (raw.right && !before.right) this.cursor = Math.min(cards - 1, this.cursor + 1);
    return buttons & ~before.buttons ? this.cursor : null;
  }

  /** A card was taken (any way): buttons held right now stay swallowed until released. */
  picked(raw: RawInput | null): void {
    this.open = false;
    this.held = raw ? raw.buttons : 0;
  }

  /** Player input while the run goes on: masks the buttons held since the pick. */
  filter(raw: RawInput): RawInput {
    if (!this.held) return raw;
    this.held &= raw.buttons;
    return { ...raw, buttons: raw.buttons & ~this.held, taps: (raw.taps ?? 0) & ~this.held };
  }

  reset(): void { this.open = false; this.lock = 0; this.held = 0; this.cursor = 0; }
}
