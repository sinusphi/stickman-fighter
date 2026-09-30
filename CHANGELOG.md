# Changelog – Stickman Fighter

## 1.6.0 · 30.09.2026

- Spiel- und Replay-Engine-Version auf **1.6.0** angehoben.
- Versionsanzeige im Footer und die aktuelle Replay-Dokumentation synchronisiert.
- Replays aus älteren Engine-Versionen werden weiterhin eindeutig abgewiesen.

## 2026-09-30 · Standing Right Middle: Standbein nach hinten

### Behoben
- **Standbein beim rechten Middle Kick (`standing_mk`) stand vorne:** Beim Fix des rechten High Kicks wurde nur `standing_rhk` von `plantedStraight` auf `plantedPivot` umgestellt. `standing_mk` hat dieselbe Posenstruktur, blieb aber auf `plantedStraight` und nagelte den vorderen Fuß am Guard-Punkt fest. Jetzt ebenfalls `plantedPivot`: Von der Kniehebung bis zum Durchschwung steht das Standbein schräg hinter der Hüfte, deckungsgleich mit dem hinteren Standbein des linken Middle Kicks (`standing_lmk`).
- **Folgen für die Daten:** Trefferboxen und Kontaktgeometrie von `standing_mk` neu erzeugt (`generate:strike-boxes`, `generate:contacts`; 28 von 30 Frames). Die Figur steht im Tritt etwas höher, daher liegen Knie- und Kickboxen bis zu ca. 1,8 px tiefer und sind jetzt identisch mit `standing_lmk`. Framedata, Schaden, Stun und Reichweite unverändert. Der Replay-Datenhash ändert sich.
- Test `leg-kicks`: Die Pivot-Prüfung gilt jetzt für den rechten Middle **und** High Kick, jeweils gegen das linke Gegenstück.

### Prüfstand
- Typecheck, **603 Tests in 32 Dateien**, alle Generatorprüfungen und Produktionsbuild grün.
- Browser-Smokes nicht gelaufen (auf diesem Rechner kein Chrome/Chromium unter dem erwarteten Pfad).

---

## 2026-09-30 · Wartung: Prüfungen repariert, Changelog

Dieser Commit folgt direkt auf `14f6dc0`.

### Behoben
- **Kontaktgeometrie veraltet:** `npm run check` brach mit `Contact geometry stale` ab. Die K.O.-Posen wurden am 29.09. abends geändert (K.O.-Fall, Zeitlupe), `generate:contacts` lief danach nicht mehr. Neu erzeugt, betroffen ist nur die Animation `KO` (39 von 46 Frames). Da die Kontaktgeometrie Teil des Replay-Datenhashs ist, ändert sich der Hash erneut.
- **`smoke:cpu` scheiterte an der Sprache:** Der Smoke stammte aus der Zeit vor der Sprachumstellung und erwartete teils deutsche (`SCHWER`, `LEICHT VS SCHWER`), teils englische Texte (`Replay ended`). Erwartungen auf die englische Standardsprache angeglichen (`HARD`, `EASY VS HARD`). Spielcode unverändert.

### Erledigt ohne Codeänderung
- **`generate:tornado -- --check`** meldet keine veralteten Daten mehr (bereits im Stand von `14f6dc0` synchron).
- **`"hz": 70` in `rules.json`** war eine Testeinstellung zum Beschleunigen. Wieder auf 60 Hz, alle Unit-Tests grün.

### Prüfstand nach diesem Commit
- `npm run check`: Typecheck, **603 Tests in 32 Dateien**, alle Generatorprüfungen (spin-poses, spin-boxes, strike-boxes, walk, tornado, uppercut, contacts) und Produktionsbuild grün.
- Browser-Smokes (Chromium) grün: `smoke`, `smoke:cpu`, `smoke:spin`, `smoke:kicks`, `smoke:strikes`, `smoke:footwork`, `smoke:crouch`, `smoke:tornado`, `smoke:uppercut`, `smoke:contacts`, `smoke:knee`.

### Offene Punkte
Vier Browser-Smokes sind veraltet. Sie passen nicht mehr zu bewusst geänderten Vorgaben im Stand von `14f6dc0`; ein Spielfehler ist nicht nachgewiesen:
- `smoke:update` und `smoke:stages` erwarten Light als Start-Theme, Standard ist inzwischen Dark.
- `smoke:rotation` erwartet 180° bei Frame 42 der Drehung, gemessen werden 129,6° (Timing des Drehkicks wurde geändert).
- `smoke:style` scheitert an der Pixelmessung der Rumpfnaht (`torso seam`, Erwartung ≥ 188).
- Fünf Smokes (`strikes`, `footwork`, `crouch`, `tornado`, `uppercut`) haben den Browserpfad `/usr/bin/google-chrome-stable` fest eingetragen und ignorieren `CHROME_PATH`. Auf Rechnern ohne diesen Pfad starten sie nicht.

---

## 2026-09-29 · Knie-Treffer, Jumping Uppercut, Posenkontakt, i18n (`14f6dc0`)

Arbeitsstand 25.–29.09. nach Update 13, Engine-Version **1.4.0** (Datenhash geändert, ältere Replays werden abgewiesen). 100 Dateien, +38.556 / −16.219.

### Neu
- **Jumping Uppercut (rechts):** vorne halten + Z (P2: vorne + Numpad 9). 56 Frames (12 Startup / 9 aktiv / 35 Recovery), Drehung bis zur Rückenansicht und zurück, Trefferbox folgt dem rechten Unterarm. Generator `generate:uppercut`, Smoke `smoke:uppercut`. Damit 33 Angriffsvarianten.
- **Knie-Treffer vor Middle-/Highkicks (MK, LMK, HK, RHK stehend):** eigene Treffergruppe `knee` (30 Schaden, MID, 15 Hitstun, 11 Blockstun, 8 Frames Hitstop). Aus der Nähe trifft zuerst das Knie und danach der Kick (Kombozähler 2), aus der Distanz nur der Kick. Kick-Framedata unverändert. Darstellung: Kniespur als Bogen mit Pfeil und Stoßring-Impuls (`src/render/impact.ts`). Smoke `smoke:knee`.
- **Echter Posenkontakt:** Haken, normale Middle-/Highkicks und Drehkicks brauchen zusätzlich zur Rechteckprüfung Kontakt ihrer Arm-/Beinkapsel mit der aktuellen Körperpose (`src/simulation/pose-contact.ts`, `contact-geometry.json`, Generator `generate:contacts`, Smoke `smoke:contacts`). Kontaktposen werden für Hitstop und Replays gespeichert.
- **Zweisprachige Oberfläche (EN/DE):** `src/platform/i18n.ts`, Standardsprache Englisch, Speicherung unter `stickman.language`.
- **K.O.-Zeitlupe:** `src/platform/slow-motion.ts`, 0,4-fache Wandzeitgeschwindigkeit bis alle Figuren ihre Endpose erreicht haben (rein präsentational).
- **Weichere Arm-Interpolation** mit monotonen kubischen Tangenten (`src/render/arm-interpolation.ts`).
- **Standard-Steuerung als Datei:** `src/data/default-controls.json`.
- Neue Tests u. a. für Knie, Uppercut, Tornado-Kombo, Posenkontakt, i18n, K.O.-Zeitlupe, Arm-Interpolation, Stance-Extremitäten (603 Tests grün).

### Geändert
- **Angriffstempo nach Demo-Auswertung** (`docs/demo-review.md`): Haken (HP) jetzt 28 / 26 / 28 Frames (Stand / Hocke / Luft, vorher 41 / 40 / 36). Highkicks auf Middlekick-Zeit: 37 / 37 / 39 (vorher 51–54 / 48–50 / 47–49). 6+HK / 4+HK 37 statt 65 / 47. Tornado + hoher Spin 69 statt 79. Schaden, Stun und Rückstoß unverändert.
- **Standing Middle/High links/rechts:** mehr Rücklage beim linken High, bessere Rückführung der Beine (kein Sprung in die Deckung mehr), rechter Middle/High mit gestrecktem Standbein (`legInterpolation: plantedStraight`) und Durchschwungpose, damit er als Kick mit dem rechten Bein lesbar ist.
- **Zeitlich getrennte Trefferfenster:** Schema erlaubt je Treffergruppe eigenes `activeFrames` und eigene Reaktionswerte; `resolveCombat` liest Reaktionen pro Gruppe.
- **CPU-Gegner:** Abstandsverhalten überarbeitet (29.09. abends, nicht im Projektplan dokumentiert) (`src/ai/brain.ts`, `index.ts`, `profiles.ts`).
- **Hocke:** nur Vorwärts-Laufzyklus, `crouchBackwardSpeed` aus `rules.json` entfernt. Numpad: 3 = hockend vorwärts, 1 = hocken und blocken.
- Spin-Trefferfenster: einzelner Spin (HIGH) jetzt Frames 18–20, in der Kombo 50–52.
- Theme-Start ohne gespeicherte Auswahl jetzt Dark (vorher Light).
- Animationsvorschau zeigt den Vorwärtsschritt (`advance`) wie im Spiel.
- `npm run check` enthält zusätzlich `generate:uppercut` und `generate:contacts`.
- README: Abschnitt „Prüfen und Git“ ersatzlos gestrichen, alte Anweisungsdateien im Wurzelverzeichnis (`anweisungen_…`, `aweisungen_…_update_01.md`) sind gelöscht und liegen unter `instructions/`.

---

## 2026-09-25 · Update 13 – Arena-Hintergründe (`196adf5`)
- Drei wählbare Hintergründe: **Dojo, Dach, Schrein**, gespeichert unter `stickman.stage`.
- 2D-Tiefe: schiefe Einpunkt-Perspektive, atmosphärische Farbmischung, Kameraparallaxe, Offscreen-Cache, Kontaktschatten, Halo-Strich für Overlay-Texte.
- Rein präsentational, Simulation und Replays unberührt. Neuer Smoke `smoke:stages`.
- `package.json` auf 1.4.0. (`ENGINE_VERSION` blieb in diesem Commit 1.2.0.)
- 16 Dateien, +953 / −79.

## 2026-09-25 · Update 12 – CPU-Gegner (`d4c7c57`)
- P2 wahlweise vom Computer, regelbasierte Utility-KI mit Schwierigkeitsstufen.
- CPU erzeugt normale `RawInput`s (virtueller Controller), sieht nur eine `Observation`, reagiert verzögert und macht Fehler. Keine Änderung an Simulation oder Move-Daten.
- Neu: `src/ai/` (brain, controller, knowledge, observation, profiles, rng), `cpu-tournament`, `cpu-benchmark`, `smoke:cpu`.
- 19 Dateien, +783 / −8.

## 2026-09-19 · Fußarbeit und Kick-Vorbereitung
- `8e7a1ed` Kick-Vorbereitung im Tempo begrenzt, Vorwärtsschritte und Geh-Zyklen mit Bodenkontakt (`generate-walk-poses.py`, `smoke:footwork`).
- `462b53e` Umstellen der Beine vor normalen Kicks verlangsamt, Schlagtempo bleibt.
- `7574de0` Animationen auf 125 % Dauer statt halbe Geschwindigkeit (23 Dateien, +10.299 / −6.528).

## 2026-09-18 · Kicks, Blickrichtung, Augen
- `98fc97f` Rechte Kicks als Gegenstück der linken Referenz.
- `ef8fb48` Drehender linker Körperschlag, rechte Kicks, gleitende Treffer-Reaktion.
- `72587a4` Getrennte Tasten für linke und rechte Kicks (F/G/H, V/B/N) samt fehlenden Beinanimationen.
- `8f60efa` Unterarm-Überdeckung beim Drehen zur Vorderansicht korrigiert.
- `22f33e5` Gliedmaßen-Überdeckung folgt der Blickrichtung (Vorderansicht links).
- `be6d827` Zentrale Spiegelung der Figur, jeder gerenderte Frame abgedeckt, Augen verbessert. Entspricht strukturell dem Auftrag „Update 11“ (Blickrichtungs-Bug).
- `3151e44` Update 10: Augengeometrie zweite Korrektur, Nahaufnahmen als Referenz.
- `9f35683` Update 09: Augen-Eckpunkte nach vermessener Vorlage.

## 2026-09-16 · Updates 04–08 – Darstellung (Engine 1.2.0)
- `143e645` **Update 08:** nahtloser Oberkörper, K.O.-Sequenz, gespiegelte Figuren.
- `b3cca10` **Update 07:** einheitliche Figurenfarben, nahtlose Gelenke.
- `10e6f57` **Update 06:** gesättigte Farben, animierte Segmenttiefe.
- `feb31ab` **Update 05:** proportionale Figurengröße, Blau/Rot-Themefarben.
- `14f928f` **Update 04:** gefüllte Figuren mit Kontur, leuchtendes Dreiecksauge.

## 2026-09-15 · Updates 02–03 (Engine 1.1.0 → 1.2.0)
- `6d4835e` **Update 03:** drei spielbare Drehkicks mit Haltetaste nach hinten, Tornado → Spin (Engine 1.2.0). 23 Dateien, +13.075.
- `274d086` **Update 02:** 2D-Rotation, Bewegungsspuren, Trefferreaktionen.

## 2026-09-13 · Update 01 (`706ce49`, Engine 1.1.0)
- Festes Skelett, Deckungshaltung, Themes (Light/Dark), Ressourcen-HUD. 31 Dateien, +5.398 / −1.689.

## 2026-09-11 · Meilensteine M1–M5 (Engine 1.0.0)
- `04fdfdc` **M5:** Training, Debug-Werkzeuge, deterministische Replays, Abnahmeprüfungen (Branch `milestone/m5`).
- `c9b24d6` **M4:** Rundenablauf, Lebensbalken, Timer, Best of Three.
- `66a7537` **M3:** 18 Moves, Frame-Kampf, Blocken, Hitbox-Overlay.
- `db9d740` **M2:** deterministische Eingaben, Motionen, Controller-Mapping, Bewegung.
- `7c30ca4` **M1:** deterministische Schleife, datengetriebenes Stickman-Rendering (Initial-Commit, 20 Dateien).

---
