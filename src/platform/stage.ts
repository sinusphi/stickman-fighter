import { DEFAULT_STAGE, STAGE_IDS, STAGES, isStageId, type StageId } from '../render/stages';

export const STAGE_STORAGE_KEY = 'stickman.stage';

/** Segmented stage switch in the arena header; presentation state like the theme. */
export const stageSwitchMarkup = `<div class="stage-switch" role="group" aria-label="Arena-Hintergrund"><span class="eyebrow">Arena</span>${STAGE_IDS.map(id=>`<button type="button" data-stage="${id}" aria-pressed="false">${STAGES[id].label}</button>`).join('')}</div>`;

export function loadStage(): StageId {
  try { const stored=localStorage.getItem(STAGE_STORAGE_KEY);if(isStageId(stored))return stored; } catch { /* Storage denied: session default. */ }
  return DEFAULT_STAGE;
}

export function setupStage(root: ParentNode, onChange: (stage: StageId) => void): void {
  let stage=loadStage();
  const buttons=[...root.querySelectorAll<HTMLButtonElement>('[data-stage]')];
  function apply(): void {
    for(const button of buttons)button.setAttribute('aria-pressed',String(button.dataset.stage===stage));
    onChange(stage);
  }
  for(const button of buttons)button.addEventListener('click',()=>{
    const next=button.dataset.stage;
    if(!isStageId(next))return;
    stage=next;apply();
    try { localStorage.setItem(STAGE_STORAGE_KEY,stage); } catch { /* Keep the applied session preference. */ }
  });
  apply();
}
