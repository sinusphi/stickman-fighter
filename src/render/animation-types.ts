/** Angles use screen coordinates: +Y down, positive rotation clockwise. */
export interface Rotation {
  pivot: string | number[];
  /** Omit for the whole rig; otherwise rotate these complete subtrees. */
  branches?: string[];
  /** Unwrapped degrees: 720 means two clockwise turns. */
  angle: number;
}
export interface AnglePose { root: number[]; angles: Record<string, number>; rotations?: Rotation[] }
export interface Trail { directional?: boolean; joint: string; fromFrame: number; toFrame: number; historyFrames: number }
/** Bone child joint IDs, plus headCircle. Higher values paint in front. */
export type SegmentDepths = Record<string, number>;
export interface Animation {
  durationFrames: number; loop: boolean; grounded: boolean;
  /** Keep the initial facing-dependent leg layers during a turn. This preserves
   * the normal guard overlap and the support/kick leg through side views. */
  fixedLegDepth?: boolean;
  /** Preserve authored hops while preventing interpolation below the floor. */
  clampFloor?: boolean;
  /** Grounded kicks follow foot paths with a planted support and fixed bones. */
  legInterpolation?: string;
  trail?: Trail;
  /** Additional presentation-only paths let a combo hand the visual emphasis
   * from one striking limb to the next without changing legacy move data. */
  trails?: Trail[];
  keyframes: { frame: number; pose: string; easing: string; rotations?: Rotation[]; depths?: SegmentDepths; turn?: number; yaw?: number }[];
}
