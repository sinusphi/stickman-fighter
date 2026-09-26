import reference from './figure-scale.json';

/** Each update adds one head radius at the preceding uniform scale. */
export const FIGURE_SCALE = ((reference.referenceHeight + reference.referenceHeadRadius) / reference.referenceHeight) ** reference.headRadiusIncrements;
