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
export type EnemyTier = 'light' | 'medium' | 'heavy';
export interface EnemyType {
  tier: EnemyTier; hp: number; stability: number; poise: number; damagePermille: number;
  difficulty: 'easy' | 'medium' | 'hard'; aggression: number; reactionFrames: number; cost: number; killEnergy: number;
}

export const SURVIVAL = {
  player: {
    /** Energy at the start of a run. The run ends when it reaches 0. */
    hp: 1000,
  },

  enemies: {
    /** Simultaneous regular enemies (KO'd ones lying on the floor and the miniboss do not count). Dead ones are replaced. */
    max: 4,
    /** Frames before the first enemy appears. */
    firstSpawnFrames: 30,
    /** Minimum frames between two spawns. */
    spawnIntervalFrames: 120,
    /** How far outside the arena edge an enemy appears before walking in (px). */
    spawnOffset: 40,
    /** Frames a KO'd enemy stays on the floor before it vanishes. */
    koRemoveFrames: 90,
  },

  /**
   * Enemy archetypes, very light to heavy. All of them use the CPU brain
   * (`difficulty` picks the base profile from `src/data/ai-profiles.json`,
   * `aggression` and `reactionFrames` override it per archetype).
   *
   *  - hp:        energy until KO.
   *  - stability: a single grounded hit with at least this strength knocks it down at once.
   *  - poise:     stagger capacity. Every landed hit adds `stagger.perHit`, every
   *               further hit of a combo `stagger.comboHit`; when poise is full the
   *               enemy falls. With the defaults a `rookie` (poise 100) falls after
   *               5 single hits or after 3 hits of a combo (20 + 40 + 40).
   *  - damagePermille: its damage relative to a normal versus hit (1000 = 100 %).
   *  - aggression / reactionFrames: CPU eagerness (0..1) and reaction delay in frames.
   *  - cost:      share of the director's difficulty budget while it is alive.
   *  - killEnergy: energy the player gets back for the KO (before time decay).
   */
  types: {
    rookie:     { tier: 'light',  hp: 260, stability: 100, poise: 100, damagePermille: 400, difficulty: 'easy',   aggression: 0.12, reactionFrames: 36, cost: 1, killEnergy: 18 },
    brawler:    { tier: 'light',  hp: 320, stability: 110, poise: 130, damagePermille: 450, difficulty: 'easy',   aggression: 0.20, reactionFrames: 30, cost: 2, killEnergy: 24 },
    fighter:    { tier: 'medium', hp: 420, stability: 130, poise: 180, damagePermille: 500, difficulty: 'medium', aggression: 0.25, reactionFrames: 25, cost: 3, killEnergy: 34 },
    bruiser:    { tier: 'medium', hp: 520, stability: 150, poise: 240, damagePermille: 560, difficulty: 'medium', aggression: 0.34, reactionFrames: 22, cost: 4, killEnergy: 44 },
    heavy:      { tier: 'heavy',  hp: 700, stability: 170, poise: 340, damagePermille: 650, difficulty: 'hard',   aggression: 0.34, reactionFrames: 20, cost: 5, killEnergy: 60 },
  } satisfies Record<string, EnemyType>,

  /** Stagger per landed hit (see `types.poise`). */
  stagger: {
    perHit: 20,
    /** Hits that land while the enemy is still in hitstun (combo hits, from the second on). */
    comboHit: 40,
    /** Frames without a hit until the poise starts to recover. */
    recoverDelayFrames: 90,
    /** Poise recovered per frame afterwards. */
    recoverPerFrame: 1,
  },

  /**
   * The director's difficulty budget. Every living regular enemy costs its
   * `cost`; a new enemy may only be picked when it still fits into the budget.
   * The budget grows with the run time, so heavier types appear more often.
   */
  budget: {
    start: 7,
    /** Budget growth per second of run time. */
    growthPerSecond: 0.05,
    cap: 30,
    /** Base weights of the tiers for a pick. The medium and heavy weights grow with time. */
    weights: { light: 6, medium: 2.5, heavy: 0.6 },
    /** Weight added per minute of run time. */
    weightGrowthPerMinute: { light: 0, medium: 1.5, heavy: 1.2 },
    /** A replacement of the same tier as the one that just died is this many times more likely. */
    sameTierPreference: 3,
    /** Mix guarantee: while room is left, at least this many enemies of the tier are present. */
    minPresent: { light: 1, medium: 1, heavy: 0 },
    /** Not before this run time (seconds) a tier takes part at all. */
    tierFromSeconds: { light: 0, medium: 0, heavy: 50 },
    /** At most this many heavy enemies at once. */
    maxHeavy: 1,
  },

  /** Small waves between the bosses: a short burst of extra, mostly light enemies. */
  waves: {
    firstFrames: 20 * 60,
    intervalFrames: 25 * 60,
    /** Enemies per wave; grows by `growth` per wave (rounded down). */
    size: 3,
    growth: 0.5,
    maxSize: 6,
    /** The wave may exceed `enemies.max` by this many enemies. */
    extraSlots: 2,
    /** Tier weights of a wave pick (no heavy ones). */
    weights: { light: 5, medium: 1 },
    /** Frames between two enemies of the same wave. */
    gapFrames: 22,
    /** No wave this close (frames) before the next boss. */
    bossMarginFrames: 6 * 60,
  },

  /**
   * Miniboss. The timer only runs while no boss is alive; when one falls it
   * starts over with `intervalFrames`. Never two bosses at once. Each boss is
   * tougher than the one before (`growth` per boss on top of the base values).
   */
  boss: {
    /** Run time of the first boss (frames). Adjustable. */
    firstFrames: 30 * 60,
    /** Pause from a fallen boss to the next one (frames). Adjustable. */
    intervalFrames: 45 * 60,
    hp: 900, stability: 200, poise: 500, damagePermille: 600,
    aggression: 0.34, reactionFrames: 22,
    /** CPU profile by boss number (1-based); the last entry applies to every later boss. */
    difficulty: ['medium', 'hard'] as readonly ('easy' | 'medium' | 'hard')[],
    /** Per further boss: hp, poise and damage grow by this share of the base value. */
    growth: { hp: 0.3, poise: 0.25, damage: 0.12, aggression: 0.06, reactionFrames: -2 },
    /** Limits for the growing values. */
    maxAggression: 0.7, minReactionFrames: 12,
    /** Regular enemies (spectators) alive while a boss is around. */
    spectators: 3,
    /** Energy bonus for the KO (before time decay). May exceed full energy, see `energy.reserveCap`. */
    killEnergy: 320,
  },

  /** Boss duel and cleanup (director states, see director.ts). */
  duel: {
    /** Waiting distance of the spectators in front of the player / in the back (px). */
    spectatorDistance: 300,
    /** The boss gives its token back after this many attacks, then waits this many frames. */
    bossAttacksPerToken: 3,
    bossCooldownFrames: 45,
    /** After the boss fell: frames of heightened pressure. */
    cleanupFrames: 150,
    /** Extra front tokens during the cleanup. */
    cleanupExtraTokens: 1,
    /** Random delay [min, max] until the first waiting enemy may attack after the boss fell. */
    cleanupStartDelayFrames: [14, 32] as const,
    /** Spawn interval during the cleanup (frames), to fill the arena again quickly. */
    cleanupSpawnIntervalFrames: 50,
  },

  /**
   * Energy rewards (the player's hp). Small gains per landed hit and per KO,
   * a large bonus for a boss. Gains shrink slowly with the run time.
   */
  energy: {
    /** Energy per landed (not blocked) hit. */
    perHit: 3,
    /** Extra energy per hit from the second hit of a combo on. */
    perComboHit: 2,
    /** Full energy is never exceeded by hit and KO gains. Only the boss bonus may go up to this value. */
    reserveCap: 1400,
    /** Gain factor: 1 - perMinute * minutes, but never below `floor`. */
    decay: { perMinute: 0.08, floor: 0.5 },
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
    /**
     * Player throws: while the player executes a throw no enemy may start an
     * attack, and for this many frames after the throw (the player is free
     * again then and must get a fair chance to react). Attacks that were
     * already running when the grab happened go on.
     */
    throwGraceFrames: 16,
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

  /**
   * Roguelite upgrades: after every fallen miniboss (once its cleanup phase is
   * over) the run pauses and the player picks one of `cards` random upgrades.
   * The same upgrade may be picked again up to its `max` stacks; maxed ones
   * are no longer offered. The draw uses its own seeded stream (see
   * upgrades.ts), so the spawns of a run do not depend on the picks.
   */
  upgrades: {
    /** Off: no offers at all (balance comparisons). */
    enabled: true,
    /** Cards per offer (fewer when fewer upgrades are left). */
    cards: 3,
    /** Frames after the end of the cleanup phase until the choice opens. */
    delayFrames: 20,
    /** The choice waits until the player stands free (no attack, stun, jump); after this many frames it opens anyway. */
    maxWaitFrames: 90,
    /** After the pick no enemy starts a new attack for this many frames. */
    resumeGraceFrames: 40,
    /** Values per stack. Order = order of the cards and HUD badges. */
    effects: {
      /** Full energy grows by `amount`, the pick heals `heal` at once (up to the new full energy). */
      maxEnergy: { max: 4, amount: 100, heal: 150 },
      /** Every energy gain (hits, KOs, boss bonus) grows by `percent`. */
      energyGain: { max: 3, percent: 25 },
      /** The player's damage grows by `percent` (strikes and throws). */
      damage: { max: 4, percent: 15 },
      /** The Revenge bar fills `percent` faster from hits taken. */
      revenge: { max: 3, percent: 30 },
      /** The Special bar fills `percent` faster from hits and blocks. */
      special: { max: 3, percent: 30 },
      /** A blocked hit costs `chipPercent` less energy and gives `energy` back (a regular gain: time decay and Energy gain apply). */
      guard: { max: 2, chipPercent: 50, energy: 3 },
      /**
       * Stability (see rules.hitStrength) grows by `amount`: 180 holds the
       * Special spin (160), 210 the punch-combo finisher (200); Revenge (240)
       * and hits in the air always knock down.
       */
      stability: { max: 2, amount: 30 },
      /** Back attackers warn `frames` longer before they strike. */
      backWarning: { max: 3, frames: 12 },
    },
  },
};

export type SurvivalConfig = typeof SURVIVAL;
export type UpgradeId = keyof typeof SURVIVAL.upgrades.effects;

/**
 * Test switch for browser smokes (`?survival-test=weak-boss`): the first
 * miniboss comes after two seconds with 1 hp, so a single hit fells it and the
 * upgrade choice can be reached quickly. Any other value keeps the config.
 */
export function survivalTestConfig(search: string, config: SurvivalConfig = SURVIVAL): SurvivalConfig {
  if (new URLSearchParams(search).get('survival-test') !== 'weak-boss') return config;
  return { ...config, boss: { ...config.boss, firstFrames: 120, hp: 1 } };
}

/** localStorage key of the best survived time (frames). */
export const SURVIVAL_BEST_KEY = 'stickman-survival-best-v1';

export type EnemyTypeId = keyof typeof SURVIVAL.types;
