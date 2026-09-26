# Stickman Fighter

![Gameplay-Demo](https://github.com/sinusphi/stickman-fighter/blob/main/pics/demo.gif)

[![Version](https://img.shields.io/badge/version-1.4.0-2563eb)](package.json)
[![Node.js](https://img.shields.io/badge/Node.js-22.12%2B-339933?logo=nodedotjs&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white)](https://vite.dev/)
[![Tests](https://img.shields.io/badge/tests-Vitest-6e9f18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![License](https://img.shields.io/badge/License-MIT-red.svg)](https://github.com/sinusphi/stickman-fighter/blob/main/LICENSE)

[English](README.md) · **Deutsch**

Ein lokales Kampfspiel für zwei Personen mit Strichmännchen, entwickelt mit TypeScript und Canvas 2D. Es verbindet deterministische Kämpfe mit 60 Hz mit Tastatur- und Gamepad-Steuerung, CPU-Gegnern, Trainingswerkzeugen, Replays und mehreren Arenen.


## Funktionen

- Lokaler Versus-, CPU- und CPU-gegen-CPU-Modus
- 33 Angriffe im Stand, in der Hocke und in der Luft sowie Dreh-, Tornado- und Komboangriffe
- Blocken, Springen, Best-of-three-Matches und Kampfbalken
- Trainingsmodus, Kampfboxanzeige, Einzelschritt und Animationsvorschau
- Deterministische Replay-Aufnahme sowie Import und Export
- Konfigurierbare Tastatur- und Gamepad-Steuerung
- Deutsche und englische Oberfläche, helles und dunkles Theme sowie drei Arenen


## Voraussetzungen

- Node.js 22.12+ (22.x), 24.x oder 26+
- npm


## Schnellstart

```sh
npm ci
npm run dev
```

Anschließend die im Terminal angezeigte Adresse öffnen, normalerweise <http://127.0.0.1:5173>.


## Standardsteuerung

| Aktion | Spieler 1 | Spieler 2 | Gamepad |
|---|---|---|---|
| Bewegung | W / A / S / D | Pfeiltasten | D-Pad / linker Stick |
| Leichter / mittlerer / schwerer Schlag | R / T / Y | Numpad 7 / 8 / 9 | X / Y / RB |
| Linker Low- / Middle- / Highkick | F / G / H | Numpad 4 / 5 / 6 | A / unbelegt / RT |
| Rechter Low- / Middle- / Highkick | V / B / N | Numpad 1 / 2 / 3 | unbelegt / B / unbelegt |
| Pause | P | P | — |

Richtungen gelten relativ zum Gegner: **6** vorwärts, **4** zurück, **2** hocken und **7/8/9** springen. Mit **Backspace** wird ein Match neu gestartet. Die Belegung kann im Spiel geändert werden.


## Befehle

| Befehl | Zweck |
|---|---|
| `npm run dev` | Entwicklungsserver starten |
| `npm run build` | Typen prüfen und Produktionsbuild erstellen |
| `npm run preview` | Produktionsbuild lokal anzeigen |
| `npm test` | Tests im Beobachtungsmodus ausführen |
| `npm run check` | Vollständige Prüfung ausführen |


## Projektstruktur

- `src/simulation/` — deterministische Kampf- und Matchlogik
- `src/render/` — Canvas-Darstellung und Animationen
- `src/data/` — Moves, Posen, Regeln und Konfiguration
- `tests/` — Unit- und Integrationstests
- `scripts/` — Datengeneratoren und Browser-Smoke-Tests


## Lizenz

Dieses Projekt ist lizensiert unter der **MIT License**. 
Siehe [LICENSE](https://github.com/sinusphi/stickman-fighter/blob/main/LICENSE) für weitere Details.


## Contributions

Beiträge zum Projekt sind stets willkommen, ebenso Bug Reports und Pull Requests. 

* [Pull requests](https://github.com/sinusphi/stickman-fighter/pulls)

* [Bug reports](https://github.com/sinusphi/stickman-fighter/issues)

* [Feature requests](https://github.com/sinusphi/stickman-fighter/issues)
