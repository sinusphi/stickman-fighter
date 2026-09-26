export type Theme = 'light' | 'dark';
import { onLanguageChange, t } from './i18n';
export const PALETTE_KEYS = ['arena','text','muted','ground','p1','p2','revenge','special','hurt','push','hit','rigLight','rigOutline','eye','eyeGlow',
  'stageShadow','stageLight',
  'dojoCeiling','dojoPaper','dojoWood','dojoTrim','dojoFloor','dojoFloorAlt','dojoAccent','dojoLamp','dojoHaze',
  'roofSky','roofHaze','roofCity','roofWindow','roofFloor','roofLine','roofWall','roofMetal',
  'shrineSky','shrineHaze','shrineMountain','shrineMoon','shrineGround','shrineStone','shrineGate','shrineFoliage'] as const;
const eyeReference = [[.71,-.10],[.58,.15],[.88,.28]];
const eyeCenter = [(.71+.58+.88)/3,(-.10+.15+.28)/3];
/** Presentation only: never used to author collision boxes or change bone lengths. */
export const FIGURE_STYLE = {
  headRadius: 12,
  outlineWidth: .85,
  widths: {
    torso: [10.5, 9], neck: [8, 7], shoulder: [8, 8],
    upperArm: [8, 7.5], forearm: [7.5, 6.8],
    thigh: [9.5, 8.5], shin: [8.5, 7.5],
  },
  lightAlpha: .14,
  outlineMix: .7,
  // A, B, C in head radii; +X faces forward, +Y points down.
  eye: {
    vertices: eyeReference.map(p=>p.map((v,i)=>eyeCenter[i]+(v-eyeCenter[i])*1.21)),
    glowBlur: 5, glowRadius: .42, glowAlpha: .28,
  },
} as const;
export type Palette = Record<typeof PALETTE_KEYS[number], string> & { boxAlpha: number };
export function readPalette(): Palette {
  const style=getComputedStyle(document.documentElement);
  return {...Object.fromEntries(PALETTE_KEYS.map(key=>[key,style.getPropertyValue(`--${key}`).trim()])),boxAlpha:Number(style.getPropertyValue('--box-alpha'))} as Palette;
}
export function setupTheme(button: HTMLButtonElement, onChange: (palette: Palette)=>void): void {
  let theme:Theme='dark';
  try { if(localStorage.getItem('stickman.theme')==='light')theme='light'; } catch { /* Session-only theme when storage is denied. */ }
  function apply(): void {
    document.documentElement.dataset.theme=theme;
    button.textContent=theme==='dark'?'☀':'☾';
    button.setAttribute('aria-pressed',String(theme==='dark'));
    button.setAttribute('aria-label',t(theme==='dark'?'theme.light':'theme.dark'));
    button.title=t(theme==='dark'?'theme.lightTitle':'theme.darkTitle');
    const page=getComputedStyle(document.documentElement).getPropertyValue('--page').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',page);
    onChange(readPalette());
  }
  button.addEventListener('click',()=>{
    theme=theme==='light'?'dark':'light';apply();
    try { localStorage.setItem('stickman.theme',theme); } catch { /* Keep the applied session preference. */ }
  });
  onLanguageChange(apply);
  apply();
}
