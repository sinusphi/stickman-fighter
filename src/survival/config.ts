/**
 * Survival mode – every tuning value in one place.
 *
 * Units: frames are simulation steps at 60 Hz (60 = one second), distances are
 * arena pixels (the arena is 960 px wide). All values are moderate starting
 * points meant to be adjusted over several play-test rounds.
 *
 * Global hit strength and knockdown values (they act in every mode) live in
 * `src/data/rules.json` under `hitStrength`.
 */
export const SURVIVAL = {
  player: {
    /** Energy at the start of a run. The run ends when it reaches 0. */
    hp: 1000,
  },

  enemies: {
    /** Simultaneous enemies (KO'd ones lying on the floor do not count). Dead ones are replaced. */
    max: 4,
    /** Energy of the basic enemy. */
    hp: 260,
    /** Enemy damage relative to a normal versus hit (1000 = 100 %). */
    damagePermille: 400,
    /** Hits with a strength (damage or rules override) of at least this value knock the enemy down. */
    stability: 100,
    /** CPU profile of the basic enemy (`src/data/ai-profiles.json`). */
    difficulty: 'easy' as 'easy' | 'medium' | 'hard',
    /** Frames before the first enemy appears. */
    firstSpawnFrames: 30,
    /** Minimum frames between two spawns. */
    spawnIntervalFrames: 120,
    /** How far outside the arena edge an enemy appears before walking in (px). */
    spawnOffset: 40,
    /** Frames a KO'd enemy stays on the floor before it vanishes. */
    koRemoveFrames: 90,
  },

  turn: {
    /** Duration of the turn animation. No attack and no walking meanwhile. */
    frames: 8,
    /** Maximum frames between the two taps in the opposite direction. */
    doubleTapFrames: 14,
  },

  director: {
    /** Full token re-evaluation every N frames (a player turn always triggers one immediately). */
    intervalFrames: 6,
    /** Simultaneous attackers in front of the player. */
    frontTokens: 2,
    /** Simultaneous attackers in the player's back. */
    backTokens: 1,
    /** Frames after a back attack before the next back attacker may start. */
    backCooldownFrames: 420,
    /** Frames an enemy waits after giving its token back before it can get a new one. */
    tokenCooldownFrames: 100,
    /** A token is given back after at most this many frames. */
    tokenMaxFrames: 210,
    /** A token is given back after this many attacks. */
    attacksPerToken: 2,
    /** Random delay [min, max] after receiving a token before the first attack. */
    startDelayFrames: [12, 36] as const,
    /** Two different enemies may not start the identical move within this many frames. */
    sameMoveLockFrames: 40,
    /** Minimum frames between attack starts of any two enemies. */
    attackGapFrames: 20,
    /** Visible warning (flashing, "!") before a back attacker strikes. */
    backWarningFrames: 32,
    /** A back attacker walks up to this distance before its warning starts (px). */
    backStrikeDistance: 105,
    /** Back enemies move up to full attack rights when at most this many enemies are left in front. */
    promoteFrontAtMost: 1,
    /** After moving up (threshold or player turn) an enemy waits this long before it may attack. */
    promotionGraceFrames: 50,
  },

  lurk: {
    /** Waiting distance of enemies without a token in front of the player (px). */
    frontDistance: 190,
    /** Waiting distance in the player's back (px). */
    backDistance: 250,
    /** Additional distance per further waiting enemy on the same side (px). */
    spacing: 70,
    /** No step when closer than this to the waiting spot (px). */
    deadband: 10,
    /** Random shift of the waiting spot ("lurking") (px, ±). */
    shuffle: 26,
    /** Frames [min, max] until the waiting spot shifts again. */
    shuffleFrames: [40, 100] as const,
    /** Chance that a waiting enemy guards when the player attacks it. */
    blockChance: 0.6,
  },
};

export type SurvivalConfig = typeof SURVIVAL;

/** localStorage key of the best survived time (frames). */
export const SURVIVAL_BEST_KEY = 'stickman-survival-best-v1';
