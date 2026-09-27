# Stickman Fighter

![Gameplay-Demo](https://github.com/sinusphi/stickman-fighter/blob/main/pics/demo.gif)

[![Version](https://img.shields.io/badge/version-1.4.0-2563eb)](package.json)
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
- 33 standing, crouching, airborne, spin, tornado, and combo attacks
- Blocking, jumping, best-of-three matches, and combat meters
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
| Pause | P | P | — |

Directions are relative to the opponent: **6** forward, **4** back, **2** crouch, and **7/8/9** jump. 
Use **Backspace** to restart a match. Controls can be reassigned in the game.


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
