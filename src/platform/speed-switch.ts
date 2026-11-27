import { loadGameSpeed, saveGameSpeed, isSpeedLevel, type GameSpeed } from './game-speed';
import { onLanguageChange, t } from './i18n';

/**
 * Game speed switch in the arena header: the button turns the boost on, the
 * three-position slider (left, middle, right) picks level 1, 2 or 3. The
 * slider only reacts while the boost is on. Applies live, no reload needed.
 */
export const speedSwitchMarkup = `<div class="speed-switch" role="group" data-i18n-aria-label="speed.group" aria-label="${t('speed.group')}">`
  + `<button type="button" id="speed-toggle" aria-pressed="false" data-i18n="speed.button">${t('speed.button')}</button>`
  + `<input type="range" id="speed-level" min="1" max="3" step="1" value="1" list="speed-stops" disabled data-i18n-aria-label="speed.slider" aria-label="${t('speed.slider')}">`
  + `<datalist id="speed-stops"><option value="1"></option><option value="2"></option><option value="3"></option></datalist></div>`;

export function setupSpeedSwitch(root: ParentNode, onChange: (speed: GameSpeed) => void): void {
  const speed = loadGameSpeed();
  const button = root.querySelector<HTMLButtonElement>('#speed-toggle')!;
  const slider = root.querySelector<HTMLInputElement>('#speed-level')!;
  function label(): void {
    button.title = t(speed.enabled ? 'speed.disable' : 'speed.enable');
    slider.setAttribute('aria-valuetext', t('speed.level', { level: speed.level }));
  }
  function apply(): void {
    button.setAttribute('aria-pressed', String(speed.enabled));
    slider.disabled = !speed.enabled;
    slider.value = String(speed.level);
    label();
    saveGameSpeed(speed);
    onChange({ ...speed });
  }
  button.addEventListener('click', () => { speed.enabled = !speed.enabled; apply(); });
  slider.addEventListener('input', () => {
    const level = Number(slider.value);
    if (isSpeedLevel(level) && level !== speed.level) { speed.level = level; apply(); }
  });
  // Arrow keys belong to player 2: hand the focus back to the game after a pick.
  slider.addEventListener('change', () => slider.blur());
  onLanguageChange(label);
  apply();
}
