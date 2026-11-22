# Stickman Fighter

![Gameplay-Demo](https://github.com/sinusphi/stickman-fighter/blob/main/pics/demo.gif)

[![Version](https://img.shields.io/badge/version-1.12.0-2563eb)](package.json)
[![Node.js](https://img.shields.io/badge/Node.js-22.12%2B-339933?logo=nodedotjs&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white)](https://vite.dev/)
[![Tests](https://img.shields.io/badge/tests-Vitest-6e9f18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-red.svg)](https://github.com/sinusphi/stickman-fighter/blob/main/LICENSE)

**English** · [Deutsch](README.de.md)

[▶ Play now](https://stickman-fighter.sinusphi.com/)

A local two-player stick-figure fighting game built with TypeScript and Canvas 2D. 
It combines deterministic 60 Hz combat with keyboard and gamepad controls, CPU opponents, training tools, replays, and multiple arenas.


## Features

- Local versus, CPU, and CPU-versus-CPU modes
- 35 standing, crouching, airborne, spin, tornado, and combo attacks, plus two throws (hip throw and shoulder throw with side switch)
- Blocking, jumping, best-of-three matches, and combat meters with a "bar full" burst, sound and READY display
- Hit effects: sparks, screen shake, dust, speed lines, KO flash, and a combo counter (switchable in the settings)
- Survival mode: endless enemies from both sides, the survived time is the score
- Training mode, hitbox display, frame stepping, and animation preview
- Deterministic replay recording, import, and export
- Configurable keyboard and gamepad controls
- English and German interface, light and dark themes, and three arenas


## Requirements

- Node.js 22.12+ (22.x), 24.x, or 26+
- npm


## Getting started

```sh
npm ci
npm run dev
```

Open the address shown in the terminal, usually <http://127.0.0.1:5173>.


## Default controls

| Action | Player 1 | Player 2 | Gamepad |
|---|---|---|---|
| Movement | W / A / S / D | Arrow keys | D-pad / left stick |
| Light / medium / heavy punch | R / T / Y | Numpad 7 / 8 / 9 | X / Y / RB |
| Left low / middle / high kick | F / G / H | Numpad 4 / 5 / 6 | A / unassigned / RT |
| Right low / middle / high kick | V / B / N | Numpad 1 / 2 / 3 | unassigned / B / unassigned |
| Throw (with 6 or 4) | C | Numpad 0 | LB |
| Pause | P | P | — |

Directions are relative to the opponent: **6** forward, **4** back, **2** crouch, and **7/8/9** jump. 
Throws: **6 + Throw** hip throw, **4 + Throw** shoulder throw (the opponent lands behind you). They only grab a standing or crouching opponent within arm's reach, cannot be blocked, and a missed grab has a long recovery. Numpad 0 is the code `Numpad0` (the "0 / Ins" key, regardless of NumLock), not the separate Insert key. 
Use **Backspace** to restart a match. Controls can be reassigned in the game.


## Survival mode

Press **F10** (or the Survival button) to start, F10 again returns to versus. Player 1 starts in the middle of the arena while enemies keep walking in from the left and the right. The run only ends when your energy is empty; the survived time is the score, and the best time is kept in the browser. **Backspace** starts a new run.

- Your facing stays fixed: walking backwards does not turn you around. **Double-tap backwards** to turn (a short turn animation; no attacks meanwhile). A single back press can still open a command move.
- Only a few enemies in front of you attack at the same time, the others lurk at a distance. Enemies behind you rarely attack, and every attack from behind is announced: the attacker flashes and shows a **!**. Attacks into your back cannot be blocked.
- The finisher of the five-hit combo knocks the opponent down in every mode; in survival, other heavy hits also knock the basic enemy down.
- Enemies come in several types from very light to heavy (own energy, stability, aggression and reaction time). Every hit staggers an enemy; when its poise is full it falls: a very light enemy after about five hits, after about three hits of a combo. Heavier types take more.
- The director fills the enemy slots from a difficulty budget that grows with the run time, always with a mix of light and medium types and now and then a heavy one. A fallen light enemy is mostly replaced by a light one. Small waves add a few extra enemies in between.
- **Miniboss:** the first one appears after 30 seconds of run time. While a boss lives, the boss timer stands still and nobody else attacks (duel: all other enemies just watch from the edge). When the boss has left the arena, the next one follows after 45 seconds, each one tougher. When a boss falls, the waiting enemies attack again at once.
- **Energy:** every landed hit and every KO gives a little energy back, a miniboss a lot (it may fill the energy above 100 % as a reserve). The gains shrink slowly with the run time.

All survival tuning values (enemy types, difficulty budget, boss times, energy gains, enemy count, attack tokens, back budget, cooldowns, thresholds, turn time) are in `src/survival/config.ts`; hit strength and knockdown values are in `src/data/rules.json` (`hitStrength`).


## Move list

<details>
<summary>All attacks with inputs and frame data</summary>

<!-- move-table:start (generated by npm run generate:move-table) -->
39 moves. Directions are relative to the opponent (6 forward, 4 back); keys for the starting positions with default controls (P1 left, P2 right). Frames at 60 Hz, startup counted from frame 0. Knee hit groups of the standing middle/high kicks are included in the damage. Throws grab a standing or crouching opponent that can act, up to 36 px beyond the own pushbox; frame data of throws: grab frame / whiff recovery, damage on impact.

| Move | ID | Input | P1 | P2 | Startup / Active / Recovery | Total | Damage | Block level |
|---|---|---|---|---|---|---:|---|---|
| Standing LP | `standing_lp` | Standing · LP | R | Num7 | 5 / 3 / 10 | 18 | 30 | HIGH |
| Standing MP | `standing_mp` | Standing · MP | T | Num8 | 8 / 3 / 17 | 28 | 55 | MID |
| Standing HP | `standing_hp` | Standing · HP | Y | Num9 | 8 / 3 / 17 | 28 | 85 | HIGH |
| Standing LK | `standing_lk` | Standing · LK | F | Num4 | 17 / 3 / 10 | 30 | 35 | LOW |
| Standing MK | `standing_mk` | Standing · MK | B | Num2 | 17 / 3 / 10 | 30 | 65 + 30 | MID |
| Standing HK | `standing_hk` | Standing · HK | H | Num6 | 17 / 3 / 10 | 30 | 95 + 30 | HIGH / MID |
| Crouching LP | `crouching_lp` | Crouching · LP | hold S + R | hold ↓ + Num7 | 5 / 3 / 10 | 18 | 25 | MID |
| Crouching MP | `crouching_mp` | Crouching · MP | hold S + T | hold ↓ + Num8 | 8 / 3 / 15 | 26 | 50 | MID |
| Crouching HP | `crouching_hp` | Crouching · HP | hold S + Y | hold ↓ + Num9 | 8 / 3 / 15 | 26 | 80 | MID |
| Crouching LK | `crouching_lk` | Crouching · LK | hold S + F | hold ↓ + Num4 | 17 / 3 / 9 | 29 | 30 | LOW |
| Jump LP | `airborne_lp` | Jump · LP | in the air R | in the air Num7 | 5 / 4 / 11 | 20 | 30 | MID |
| Jump MP | `airborne_mp` | Jump · MP | in the air T | in the air Num8 | 8 / 5 / 15 | 28 | 50 | MID |
| Jump HP | `airborne_hp` | Jump · HP | in the air Y | in the air Num9 | 8 / 5 / 15 | 28 | 75 | MID |
| Jump LK | `airborne_lk` | Jump · LK | in the air F | in the air Num4 | 19 / 4 / 9 | 32 | 35 | LOW |
| Jump MK | `airborne_mk` | Jump · MK | in the air B | in the air Num2 | 19 / 4 / 9 | 32 | 60 | MID |
| Jump HK | `airborne_hk` | Jump · HK | in the air H | in the air Num6 | 19 / 4 / 9 | 32 | 90 | MID |
| Spin Middle Kick | `spin_mk` | 4 + MK | hold A + B | hold → + Num2 | 18 / 6 / 29 | 53 | 80 | MID |
| Spin High Kick | `spin_hk` | 6 + HK | hold D + H | hold ← + Num6 | 17 / 3 / 10 | 30 | 110 | HIGH |
| Standing RLK | `standing_rlk` | Standing · RLK | V | Num1 | 17 / 3 / 10 | 30 | 35 | LOW |
| Standing LMK | `standing_lmk` | Standing · LMK | G | Num5 | 17 / 3 / 10 | 30 | 65 + 30 | MID |
| Standing RHK | `standing_rhk` | Standing · RHK | N | Num3 | 17 / 3 / 10 | 30 | 95 + 30 | HIGH / MID |
| Crouching RLK | `crouching_rlk` | Crouching · RLK | hold S + V | hold ↓ + Num1 | 17 / 3 / 9 | 29 | 30 | LOW |
| Jump RLK | `airborne_rlk` | Jump · RLK | in the air V | in the air Num1 | 19 / 4 / 9 | 32 | 35 | LOW |
| Jump LMK | `airborne_lmk` | Jump · LMK | in the air G | in the air Num5 | 19 / 4 / 9 | 32 | 60 | MID |
| Jump RHK | `airborne_rhk` | Jump · RHK | in the air N | in the air Num3 | 19 / 4 / 9 | 32 | 90 | MID |
| Tornado Kick | `tornado_mk` | 6 + MK | hold D + B | hold ← + Num2 | 28 / 5 / 22 | 55 | 80 | MID |
| Spin Kick (links) | `forward_spin_hk` | 4 + HK | hold A + H | hold → + Num6 | 17 / 3 / 10 | 30 | 100 | HIGH |
| Tornado → Spin Kick | `tornado_spin_combo` | 6 + MK + HK | hold D + B + H | hold ← + Num2 + Num6 | 28 / 32 / 10 | 70 | 80 + 100 | MID / HIGH |
| Jumping Uppercut | `jumping_uppercut` | 6 + HP | hold D + Y | hold ← + Num9 | 12 / 9 / 35 | 56 | 85 | HIGH |
| Dwit Chagi | `dwit_chagi` | 4 + RLK | hold A + V | hold → + Num1 | 19 / 4 / 27 | 50 | 105 | HIGH |
| Left Turn Kick | `left_turn_kick` | 4 + LK | hold A + F | hold → + Num4 | 18 / 4 / 44 | 66 | 70 | HIGH |
| Double High Kick | `double_high_kick` | 4 + LK + LMK | hold A + F + G | hold → + Num4 + Num5 | 18 / 30 / 30 | 78 | 60 + 80 | HIGH |
| Spin High → Spin Middle | `spin_high_middle_combo` | 6 + RLK + MK | hold D + V + B | hold ← + Num1 + Num2 | 17 / 36 / 29 | 82 | 110 + 80 | HIGH / MID |
| Middle → High → Low | `middle_high_low_combo` | 6 + LMK + MK | hold D + G + B | hold ← + Num5 + Num2 | 17 / 37 / 13 | 67 | 65 + 95 + 35 | MID / HIGH / LOW |
| Right Middle → High → Left Middle → High → Medium Punch | `middle_high_punch_combo` | 6 + HK + RHK | hold D + H + N | hold ← + Num6 + Num3 | 17 / 66 / 14 | 97 | 65 + 95 + 65 + 95 + 50 | MID / HIGH |
| Medium Punch → Right High | `punch_kick_combo` | 6 + MP + RHK | hold D + T + N | hold ← + Num8 + Num3 | 8 / 15 / 11 | 34 | 55 + 95 | MID / HIGH |
| Right Middle → Body Hook | `kick_punch_combo` | 4 + MK + HP | hold A + B + Y | hold → + Num2 + Num9 | 17 / 16 / 14 | 47 | 65 + 85 | MID |
| Hip Throw | `throw_forward` | 6 + THROW | hold D + C | hold ← + Num0 | 4 / 1 / 22 (whiff) | 27 | 110 | unblockable (throw) |
| Shoulder Throw | `throw_back` | 4 + THROW | hold A + C | hold → + Num0 | 4 / 1 / 22 (whiff) | 27 | 130 | unblockable (throw) |
<!-- move-table:end -->

</details>


## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Type-check and create a production build |
| `npm run preview` | Preview the production build |
| `npm test` | Run tests in watch mode |
| `npm run check` | Run the complete validation suite |


## Project structure

- `src/simulation/` — deterministic combat and match logic
- `src/survival/` — survival mode: simulation, director, enemy control and its configuration
- `src/render/` — Canvas rendering and animation
- `src/data/` — moves, poses, rules, and configuration
- `tests/` — unit and integration tests
- `scripts/` — data generators and browser smoke tests


## License

This project is licensed under the **MIT License**. 
See [LICENSE](https://github.com/sinusphi/stickman-fighter/blob/main/LICENSE) for details.


## Contributions

Contributions are welcome.

* [Pull requests](https://github.com/sinusphi/stickman-fighter/pulls)

* [Bug reports](https://github.com/sinusphi/stickman-fighter/issues)

* [Feature requests](https://github.com/sinusphi/stickman-fighter/issues)
