# Changelog – Stickman Fighter

## 2026-11-27 · Neue Eingabe für die Revenge-Kombos

- **Revenge-Kombos mit neuer Tastenkombination:** Statt Viertelkreis (↓ ↘ →, 236) jetzt **unten halten, vorwärts dazunehmen, beide halten, dann die Taste** (Motion `23`): P1 S halten, D dazu, dann R (LP, `revenge_combo`), F (LK, `revenge_combo_f`) oder V (RLK, `revenge_combo_v`); P2 ↓ halten, ← dazu, dann Num7 / Num4 / Num1. Vorwärts zeigt weiter zum Gegner.
- Unten muss zuerst kommen (direkt gedrücktes ↘ oder erst vorwärts zählt nicht), beide Richtungen dürfen beliebig lange gehalten werden (bis rund 2 Sekunden Eingabeverlauf), bis zu 3 Frames Loslassen vor der Taste ist erlaubt. Neues Motion-Flag `hold` in `motions.json`.
- Da ↘ eine Hocke ist, richten sich die Revenge-Kombos direkt aus der Hocke auf (Motions, die in einer Hockrichtung enden, dürfen Standing-Moves starten). Ohne volle Leiste bleibt die Eingabe der jeweilige hockende Angriff (`crouching_lp`, `crouching_lk`, `crouching_rlk`).
- Weil ↘ eine Hocke ist und kein Gehschritt mehr vor dem Angriff liegt, startet jede Revenge-Kombo 3 px weniger weit: `revenge_combo` bis 90 / 83 px (stehend / hockend), `revenge_combo_f` bis 93 / 99 px, `revenge_combo_v` bis 75 / 79 px.
- Kombo-Liste, Hinweise (EN/DE), Animationsvorschau, CPU-Eingabe und Move-Tabelle in beiden READMEs angepasst.
- **Replays:** `ENGINE_VERSION` 1.20.0, Moves/Motions geändert (Datenhash).
- Tests: `revenge-combo`, `revenge-variants`, `guard-break` und `input` auf die neue Eingabe umgestellt; Smokes `smoke:revenge-combo`, `smoke:guard-break` und `smoke:animation-preview` angepasst.

## 2026-11-27 · Jumping Uppercut mit zwei Treffern

- **Jumping Uppercut ist jetzt ein Zwei-Treffer-Angriff:** Erst ein gerader rechter Punch auf Kinnhöhe aus dem Stand (25 Schaden), dann zieht die Faust zur Brust zurück, die Hüfte geht tief, und beim Abspringen fährt derselbe Arm nach oben gestreckt als Uppercut in den Gegner (75 Schaden). Zusammen 100 statt 85. Beide Treffer HIGH (stehend blocken, gegen hockende Deckung gehen beide drüber).
- Frame-Data 6 / 16 / 34 (56 Frames wie bisher): Punch aktiv in Frame 6–8, Uppercut in Frame 14–21. Der Punch schiebt kaum (2 px) und hält 24 Frames Hitstun bzw. 16 Frames Blockstun, so dass der Uppercut sicher nachkommt, getroffen wie geblockt.
- Animation: neue Keyframes für Punch (7), Ausholen mit tiefer Hüfte (11) und Absprung mit hochgestrecktem Arm (15); Sprung, Rückenansicht am Apex und Landung bleiben wie gehabt, nur um einen Frame nach hinten verschoben.
- Sound: Der Punch klingt als leichter Schlag ohne Uppercut-Charakter, der Uppercut behält den „snap“.
- **Replays:** `ENGINE_VERSION` 1.19.0, Moves/Kontaktgeometrie geändert (Datenhash).
- Technik: Generator `generate:uppercut` erzeugt zwei Treffergruppen (`punch`, `main`) und räumt alte Keyframe-Posen auf, ohne die Reihenfolge in `poses.json` zu verschieben. Move-Tabelle in beiden READMEs neu erzeugt.
- Tests: `jumping-uppercut.test.ts` prüft Punch-Pose, Ausholen, Absprung, die Reihenfolge Punch → Uppercut bei Treffer und Block sowie 100 Schaden; `hit-sound`, `intro`, `throws` und das Fixture `contact-retiming.json` angepasst. Smoke `smoke:uppercut` zeigt die neuen Phasen.

## 2026-11-27 · Spieltempo

- **Neu: Spieltempo-Schalter** in der Arena-Leiste rechts neben der Arena-Auswahl (ersetzt den Text „Best of three“): Der Button **Tempo** schaltet das schnellere Tempo ein, der Schieberegler daneben wählt mit drei Positionen (links, Mitte, rechts) Stufe 1, 2 oder 3. Ist der Button aus, ist der Regler gesperrt und das Spiel läuft im Standardtempo. Stufe 1 = +20 %, Stufe 2 = +32 %, Stufe 3 = +40 %; die Prozentwerte erscheinen nirgends in der Oberfläche.
- Die aktive Stufe steht als deutliches Abzeichen mittig unter der Rundenanzeige („››› TEMPO 3“), Stufe 3 in Rot. Im Standardtempo bleibt die Stelle leer.
- Die Änderung greift sofort, ohne Neuladen und ohne Pause. Schalter und Stufe werden im `localStorage` gespeichert (`stickman.speed`), beim Ausschalten bleibt die gewählte Stufe erhalten.
- Umsetzung rein über die Uhr: `FixedLoop.speed` skaliert, wie schnell die 60-Hz-Schleife Wall-Clock-Zeit verbraucht, und multipliziert sich mit der K.-o.-Zeitlupe. Jeder Simulationsframe bleibt gleich, deshalb bleiben `ENGINE_VERSION` und Datenhash unverändert, Replays funktionieren mit jeder Stufe. Die Stufen stehen in `src/platform/game-speed.ts` (`SPEED_LEVELS`). Texte EN/DE.
- Tests: `game-speed.test.ts` (Stufen, Speichern/Laden, Frames pro Sekunde, HUD-Abzeichen ohne Prozent), Browser-Smoke `smoke:game-speed` misst das Tempo je Stufe im echten Spiel.

## 2026-11-27 · Revenge-Kombos unaufhaltbar

- **Behoben:** Eine Revenge-Kombo ließ sich noch stoppen, wenn der Gegner gerade angriff und vor dem ersten Kombo-Treffer traf. Der Angreifer landete im Hitstun, die Leiste war trotzdem leer; traf der Gegner im selben Frame, in dem ein Guard Break begann, wurde der Durchbruch abgebrochen und es sah aus wie geblockt. Die drei Revenge-Kombos sind jetzt **unaufhaltbar**: Vom ersten bis zum letzten Frame kann kein anderer Angriff den Angreifer treffen, ein schnellerer Schlag in den Anlauf geht durch ihn hindurch. Zwei unaufhaltbare Moves treffen sich weiterhin gegenseitig. Der Wirbel bleibt wie dokumentiert im Anlauf verwundbar.
- Dritte wiederverwendbare Eigenschaft in `src/simulation/guard-break.ts` (`UNSTOPPABLE_MOVES`, `shieldedFrom`), geprüft in `collectContacts`; gilt in Versus, Training und Survival.
- **Replays:** `ENGINE_VERSION` 1.18.0.
- Doku: beide READMEs im Abschnitt „Guard break“ / „Guard Break“ ergänzt.
- Tests: `guard-break.test.ts` prüft für alle drei Varianten, dass ein schnellerer Jab in den Anlauf durchgeht und alle sieben Treffer sitzen; `intro`/`throws` an die Engine-Version angepasst.

## 2026-11-27 · Guard Break, Combo-Lock und volle Leisten im Training

- **Neu: Guard Break.** Moves mit voller Leiste (alle drei Revenge-Kombos und der Wirbel) lassen sich nicht mehr abblocken. Trifft einer ihrer Schläge auf eine Deckung, frieren beide Kämpfer 30 Frames (eine halbe Sekunde) ein: Der Verteidiger bleibt in der Block-Pose, der Bildschirm blitzt auf, die Deckung bekommt Risse und der Verteidiger leuchtet immer heller auf. Danach bricht der Schlag durch, landet als normaler Treffer (mit Durchbruch-Blitz und Scherben) und die Kombo läuft bis zum Ende. Sound: der Block des Schlags plus eine aufsteigende Synth-Figur durch den Freeze, der Durchbruch klingt als Treffer.
- **Neu: Combo-Lock.** Sitzt ein Treffer dieser Moves, bleibt der Gegner im Hitstun (oder am Boden), bis der Move keinen Treffer mehr vor sich hat: kein Rückwärtslaufen, kein Sprung, kein Block. Ist der Gegner aus der Reichweite des nächsten Schlags gerutscht (Pushback, ein weit reichender Opener), wird er pixelweise herangezogen, höchstens 48 px, bis Box- und Posenkontakt passen.
- **Wiederverwendbar:** Guard Break und Combo-Lock sind zwei getrennte Move-Eigenschaften in `src/simulation/guard-break.ts` (`GUARD_BREAK_MOVES`, `COMBO_LOCK_MOVES`). Moves mit voller Leiste haben beide automatisch, weitere Moves lassen sich dort eintragen; alle anderen Angriffe bleiben blockbar. Freeze-Dauer und Zug-Reichweite stehen in `rules.json` (`guardBreak.freezeFrames`, `guardBreak.lockPullPixels`). Der Effekt ist eigenständig: `HitEffects.spawnGuardBreak` / `spawnGuardShatter`, neuer Partikeltyp `Crack`, Figuren-Aufleuchten in `src/render/guard-break.ts`, Sound `HitAudio.playGuardBreak`.
- **Neu im Training:** Zwei Haken neben dem Dummy-Button, „Revenge immer voll“ und „Special immer voll“, halten die jeweilige Leiste für beide Kämpfer voll; nach einem Move mit voller Leiste ist sie im nächsten Frame wieder voll. Die Optionen sind ein eigenes Steuerereignis (`trainingBars`, setzt nichts zurück), bleiben über Reset und Dummy-Wechsel erhalten und laufen in Replays mit. Texte EN/DE.
- **Behoben (UI):** Nach einem Mausklick auf einen Training-Haken bleibt der Fokus nicht mehr in der Checkbox, sonst wären die Spieltasten verschluckt worden.
- Survival: Guard Break und Combo-Lock wirken auch gegen Gegner (pro Gegnerpaar, Stagger-Buchhaltung unverändert).
- **Replays:** `ENGINE_VERSION` 1.17.0, `rules.json` geändert (Datenhash). Snapshots prüfen den offenen Guard Break, den Combo-Lock und die Trainingsoptionen.
- Doku: beide READMEs mit neuem Abschnitt „Guard break“ / „Guard Break“, Revenge- und Wirbel-Stichpunkte und Kombo-Hinweise (EN/DE) angepasst.
- Tests: neue `tests/unit/guard-break.test.ts` (Eigenschaften, Freeze-Ablauf, abgebrochener Durchbruch, Snapshots/Replays, Effekte, Sound, Trainingsoptionen). Angepasst: `revenge-combo` (Durchbruch statt Block, Lock gegen Rückwärtslaufen und Springen), `revenge-variants`, `special-spin` (Versus und Survival), `intro`/`throws` (Engine-Version). Neuer Browser-Smoke `guard-break` (Haken, Freeze in Block-Pose, Durchbruch, Lock, Nachfüllen).

## 2026-11-27 · Revenge-Kombo: drei Varianten (LP, LK, RLK)

- **Neu:** Derselbe Viertelkreis vorwärts startet jetzt je nach Taste eine von drei Revenge-Kombos mit sieben Treffern: **236 + LP** (`revenge_combo`, wie bisher), **236 + LK** (`revenge_combo_f`, P1: F, P2: Num4) und **236 + RLK** (`revenge_combo_v`, P1: V, P2: Num1). Alle drei brauchen die volle Revenge-Leiste, leeren sie beim Start, sind nach dem ersten Treffer nicht mehr blockbar und werfen mit dem Finisher um. Ohne volle Leiste bleiben LK und RLK die normalen Low Kicks.
- **Variante F „Kick-Leiter“:** Rechts Low → Links Low → Rechts Middle → Links Middle → Rechts High → Links High → Stoßtritt. Nur Tritte, Start **LOW** (hockend blocken), die Beine wechseln auf der Stelle im 12-Frame-Takt, der Körper kriecht nur über die ganze Leiste nach vorn. Langsamer Anlauf für den Finisher: gerader Stoßtritt auf Hüfthöhe mit zurückgelehntem Oberkörper, der größte Pushback der drei. 10 / 79 / 16 Frames (105 gesamt), Schaden 35 + 35 + 55 + 60 + 80 + 90 + 135 = 490.
- **Variante V „Salve“:** Haken → Jab → Haken → Rechts Low → Links Middle → Links High → Uppercut. Start **MID** mit einem Schritt-Körperhaken (trifft auch hockende Gegner), schneller Faustrhythmus, dann ein rechter Low Kick als Mixup und zwei linke Tritte aus demselben angehobenen Knie. Der Finisher ist ein aufsteigender Uppercut aus tiefem Absenken der Hüfte, mit eigenem Uppercut-Treffersound. 8 / 64 / 10 Frames (82 gesamt, die kürzeste), Schaden 45 + 40 + 60 + 45 + 65 + 85 + 135 = 475.
- Startabstand (Mitte zu Mitte, ab 38 px): F bis 96 px stehend / 102 px hockend, V bis 78 px stehend / 82 px hockend. Beide behalten wie die Klassiker eine Reichweitenreserve: Sitzt der Opener, sitzen alle sieben Treffer, auch wenn der Gegner nach dem ersten Treffer 2 px weiter weg steht. Die Füße rutschen nie (Test über alle Frames, auch in Viertelframe-Schritten).
- **Technik:** Neue Motion `236+K` (LK, RLK) in `motions.json`, die bestehende `236+P` bleibt unverändert. Zwei neue Generatoren `generate:revenge-combo-f` und `generate:revenge-combo-v` (im `generate:check`); `scripts/kicks/generate.mjs` löscht beim Neuerzeugen jetzt nur noch die eigenen Frame-Posen `<id>_<n>`, weil `revenge_combo` sonst als Präfix die Posen von `revenge_combo_f` und `_v` mitlöschen würde. Finisher-Knockdown über `rules.hitStrength.overrides` (`revenge_combo_f:thrust`, `revenge_combo_v:upper`), Kontakt-Zuordnung in `pose-contact-moves.ts`. Der Treffersound kennt den Uppercut jetzt auch pro Treffergruppe (`upper`). Kombo-Liste mit eigenem Hinweistext je Variante (EN/DE), Animationsvorschau zeigt „236+LK“ bzw. „236+RLK“, Move-Tabelle und beide READMEs (neuer Abschnitt „Drei Varianten, ein Viertelkreis“) neu erzeugt. Die CPU setzt keine Revenge-Kombo ein.
- **Replays:** `ENGINE_VERSION` 1.16.0 (neue Motion und Moves ändern Datenhash und Simulation), ältere Replays werden abgewiesen.
- Tests: neue `tests/unit/revenge-variants.test.ts` für beide Varianten (Daten, Eingabe in beiden Blickrichtungen, Fehleingaben, Leiste, Reichweite stehend/hockend, Reichweitenreserve, Blocken mit der richtigen und falschen Deckung, Training/Replay, Survival gegen schwere Gegner und Bosse, CPU, Sound, keine rutschenden Füße). Angepasst: `combat`, `hit-strength`, `input`, `revenge-combo` (LK startet jetzt die Variante F), `intro`, `throws` (Engine-Version). Die Browser-Smokes `revenge-combo` und `animation-preview` prüfen die neuen Einträge und rendern Vorschaubilder; sie liefen in dieser Umgebung nicht, weil dort kein Chrome installiert ist.

## 2026-11-27 · Ansager entfernt, Durchsicht

- **Entfernt:** Alles rund um den Ansager. Die synthetische Stimme (espeak-ng) klang zu mechanisch, eine andere Lösung folgt später. Weg sind der Generator (`generate-announcer.mjs`, Zeilen, Presets, `generate:announcer` und sein `--check` in `generate:check`), die Dateien unter `public/sounds/announcer/`, die Intro-Hooks (`src/platform/announcer.ts`, Laden und Abspielen in `audio.ts`, Aufruf in `main.ts`) samt Test und Smoke-Prüfung. Das Runden-Intro zeigt READY UP!/FIGHT! weiter als Text. Rein präsentational, Replay-Vertrag unverändert.
- **Behoben:** Die Revenge-Kombo per Viertelkreis (Eintrag unten) war in der Doku beschrieben, der Code stand aber wieder auf dem alten Chord. Neu eingespielt und vervollständigt: Der CPU-Controller spielt Motion-Eingaben jetzt tatsächlich ab (Sequenz aus `motions.json`, Taste mit der letzten Richtung), die Animationsvorschau zeigt „236+LP“ statt „+LP“, der allgemeine Kombo-Hilfetext erklärt Motions (EN/DE), die README-Stichpunkte nennen nicht mehr D + F + G + H. Tests (`combat`, `maintenance`, `intro`, `throws`) an Motion-Moves und `ENGINE_VERSION` 1.15.0 angepasst.

## 2026-11-26 · Revenge-Kombo per Viertelkreis

- **Geändert:** Die Revenge-Kombo (`revenge_combo`) startet jetzt mit **Viertelkreis vorwärts + LP (236 + LP)** statt mit vorwärts + LK + LMK + HK. P1 von links: S halten, D dazunehmen, S loslassen und D weiter halten, dann R (P2 von rechts: ↓, ↓ + ←, ← + Num7). Vorwärts gilt wie immer relativ zum Gegner. Grund: Der alte Vierfach-Druck D + F + G + H kam auf manchen Tastaturen nicht vollständig an, P1 konnte die Kombo von links dann gar nicht starten.
- Genutzt wird die vorhandene Motion `236+P` aus `motions.json` (Gesamtfenster 20 Frames, Lücke höchstens 8, LP bis 3 Frames nach vorwärts, kurzes Neutral vor LP erlaubt). Ohne volle Leiste, in der Hocke, in der Luft, bei unvollständigem oder umgekehrtem Viertelkreis bleibt LP der normale Jab. Die Tasten F + G + H vorwärts verbrauchen die Leiste nicht mehr; der Chord-Eintrag in `CHORD_UPGRADES` ist entfernt.
- Animation, Treffer, Schaden, Reichweite (38–93 px stehend, 38–86 px hockend) und Frame-Daten sind unverändert.
- Generator-Basis (`scripts/kicks/generate.mjs`) kann jetzt Motion-Commands erzeugen (`motion` in der Definition). Das Schema prüft Motion-Moves (bekannte Motion, die den Button akzeptiert, im Stand) und erlaubt Ressourcen-Moves als Motion. Der CPU-Controller kann Motion-Eingaben abspielen; die CPU wählt die Revenge-Kombo weiterhin nicht.
- Kombo-Liste zeigt „Viertelkreis vorwärts (↓ ↘ →, 236) + LP“ mit den eigenen Tasten pro Spieler, neuer Hinweistext (EN/DE); der allgemeine Kombo-Hilfetext erklärt jetzt auch Motions. Move-Tabelle in beiden READMEs neu erzeugt.
- **Replays:** `ENGINE_VERSION` 1.15.0, ältere Replays werden abgewiesen.
- Tests: `revenge-combo.test.ts` auf die neue Eingabe umgestellt (Eingabevarianten in beiden Blickrichtungen, Fehleingaben, alter Chord ohne Wirkung), `smoke:revenge-combo` mit echter Tastatur (P1 von links, P2 von rechts, Survival), `smoke:animation-preview` prüft die Motion-Zeile.

## 2026-11-25 · Runden-Intro

- **Neu:** Jede Versus-Runde (auch VS CPU und Demo, nicht Training, nicht Survival) beginnt mit einem Intro. Neue Rundenphase `'intro'` in `src/simulation/rounds.ts` mit den Schritten `ready` → `approach` → `salute`, danach `fighting` (Schritt `fight` hält nur noch das Banner). Logik in `src/simulation/intro.ts`.
- **Ablauf:** „READY UP!“ / „BEREITMACHEN!“ an den bisherigen Startpositionen (`INTRO_READY_FRAMES` 60). Dann laufen beide mit Gehgeschwindigkeit aufeinander zu (Walk-Animation, rund 37 Frames, je ~105 px), bis der Faustgruß-Abstand erreicht ist. Faustgruß: beide spielen `standing_lp` (`INTRO_SALUTE_FRAMES` 20, die Animation dauert 18), die Fäuste berühren sich auf dem Höhepunkt (Move-Frame 9) mit kleinem Funken und Ring, ohne Screenshake. Danach „FIGHT!“ / „LOS!“ (`INTRO_FIGHT_FRAMES` 40), Eingaben frei, Timer läuft ab hier.
- **Abstand aus den Daten:** Faustspitze = Hand-Gelenk plus Kapselradius der Hand-Kapseln von `standing_lp` aus der Kontaktgeometrie, skaliert und gerundet wie zur Laufzeit; Höhepunkt = Frame mit der größten Reichweite. Ergibt 74,9 px pro Seite, Abstand 38352 Subpixel (149,8 px). Startabstand bleibt 360 px, der Anlauf ist also deutlich sichtbar. Die Figuren stehen nach dem Intro dort, wo sie gegrüßt haben (knapp außerhalb der LP-Reichweite).
- **Kein Kampf im Intro:** Der Kampfschritt läuft im Intro gar nicht, also keine Hitbox, kein Schaden, keine Leiste, kein Swing-Sound. Eingaben sind gesperrt; eine durchs Intro gehaltene Taste zählt bei FIGHT nicht als Druck, gehaltene Richtungen wirken sofort. Die CPU wartet (wie bisher außerhalb von `fighting`).
- **Ansager:** rein präsentational (`src/platform/announcer.ts`), Hooks `ready_up` und `fight` zentral konfigurierbar. Gespielt wird `public/sounds/announcer/<name>.ogg|mp3|wav|m4a`, falls vorhanden, sonst bleibt es beim Text. Es werden noch keine Aufnahmen mitgeliefert.
- **Modi:** `createGame({ intro: true })` markiert ein Versus-Spiel (`roundIntro`); Resets und neue Runden spielen das Intro, Training nie. Tests und Survival-Sichten bleiben ohne Intro.
- **Replays:** `ENGINE_VERSION` 1.14.0, ältere Replays werden abgewiesen. Replays enthalten das Intro, Snapshots im Intro werden validiert (Phase, Schritt, Frames, voller Timer, kein Training).
- **Smokes:** neuer `smoke:intro` (Ablauf, gesperrte Eingaben, Faustgruß-Höhepunkt per Einzelschritt, Timer, DE-Banner, Training, Replay, Demo, Ansager-Requests). Alle übrigen Smokes laden die App mit dem neuen Testschalter `?intro=off` (`TEST_URL` in `scripts/smoke-env.mjs`, `SERVER_URL` ohne Query). Das Canvas trägt `data-round` (Phase und Intro-Schritt).
- Tests: `intro.test.ts` (Phasenfolge und Längen, Abstand aus der Kontaktgeometrie, Faustspitzen berühren sich exakt, beide Seiten gespiegelt und vertauscht, kein Schaden/keine Eingaben, gehaltene Taste, Timer erst ab FIGHT, Ansager-Cues, Determinismus, Replay, Snapshot-Validierung, Training).

## 2026-11-25 · Rennen

- **Neu:** Rennen. Zweimal schnell vorwärts tippen und beim zweiten Druck halten: Die Figur rennt mit `runSpeed` 1380 (rund 1,8-fache Gehgeschwindigkeit, neuer Wert in `rules.json`). Tippfenster 12 Frames vom Loslassen des ersten Tipps bis zum zweiten Druck (`RUN_TAP_FRAMES` in `src/input/run.ts`); dazwischen ist nur Neutral erlaubt. Erkannt wird auf der bereinigten, blickrichtungsrelativen Richtungshistorie, also nach SOCD und für Tastatur, D-Pad und Stick identisch. Tippen und sofort loslassen bleibt normales Gehen/Stehen.
- **Neuer Zustand `Run`:** endet sofort beim Loslassen (zurück zu Idle, ohne Rutschen), bei Hocke, Sprung (normaler Vorwärtssprung), Angriff, Block-Eingabe (zurück), Treffer/Stun/Wurf und beim Kontakt mit dem Gegner (Pushbox-Überlappung: Schub wie beim Gehen, danach Gehen, kein Durchlaufen). Danach braucht es einen neuen Doppeltipp. Aus dem Rennen sind alle normalen Angriffe, Hold-Moves und Würfe möglich, ohne Lauf-Bonus. Eine rennende Figur ist werfbar wie eine gehende.
- **Survival:** Rennen entlang der festen Blickrichtung wie im Versus; Doppeltipp zurück dreht weiterhin um, auch direkt aus dem Rennen. Gegner rennen nicht.
- **CPU:** rennt vorerst nicht. CPU-Eingaben tragen `noRun` (wird mit Replays aufgezeichnet), Survival-Gegner ebenso, damit zufällige 6-5-6-Muster der CPU kein Rennen auslösen.
- **Animation:** eigener Laufzyklus `Run` (20 Frames, Oberkörper weiter vorgeneigt, längere und höhere Schritte mit Fersen-Kick, Armschwung gegen die Beine), erzeugt von `scripts/generate-run-poses.py` (`npm run generate:run`, in `generate:check`), Kontaktgeometrie neu gebacken. In der Animationsvorschau unter Bewegung auswählbar. Hinweis im Kombo-Panel (Abschnitt „Bewegung“, EN/DE).
- **Replays:** `ENGINE_VERSION` 1.13.0, Datenhash ändert sich (Regeln, Kontaktgeometrie). Ältere Replays werden abgewiesen. Das Rennen ergibt sich deterministisch aus den aufgezeichneten Roh-Eingaben.
- Tests: `run.test.ts` (Tippfenster und Grenze, Halten vs. Loslassen, Zwischenrichtungen, SOCD, Spieler 2, CPU/`noRun`, alle Abbruchbedingungen, Geschwindigkeit, Angriff ohne Bonus, Replay-Determinismus, Standfuß ohne Rutschen, Survival inkl. Umdrehen und Gegner). Neuer Browser-Smoke `smoke:run` (Tastatur, D-Pad, Stick, Survival, Vorschau, Phasenbild in `test-results/run`).

## 2026-11-25 · Survival: Upgrades nach jedem Miniboss

- **Neu:** Roguelite-Schleife. Nach jedem besiegten Miniboss (sobald die Cleanup-Phase vorbei ist, plus 20 Frames; die Auswahl wartet, bis der Spieler frei steht, höchstens 90 Frames) hält der Lauf an und der Spieler wählt eine von drei zufälligen Upgrade-Karten: Tasten **1 / 2 / 3** oder mit der eigenen Steuerung ← → und eine Angriffstaste (auch Gamepad). Kurz nach dem Öffnen sind Kampftasten gesperrt, die bestätigende Taste löst beim Weiterspielen keinen Angriff aus. Während der Auswahl steht die Survival-Simulation komplett (kein Frame, kein Director, keine Piloten); nach der Wahl startet 40 Frames lang kein Gegner einen neuen Angriff.
- **Upgrades** (Werte pro Stufe zentral in `src/survival/config.ts` unter `upgrades`, gleiches Upgrade mehrfach wählbar bis zum Limit, ausgereizte werden nicht mehr angeboten): Max-Energie (+100, heilt sofort 150, Limit 4), Energie-Gewinn (+25 %, 3), Schaden (+15 % auf Schläge, Tritte und Würfe, 4), Revenge lädt schneller (+30 %, 3), Special lädt schneller (+30 %, Treffer und Blocks, 3), Deckung (geblockte Treffer kosten 50 % weniger Chip-Schaden und geben +3 Energie, 2), Standfest (+30 Standfestigkeit: Stufe 1 hält den Wirbel aus, Stufe 2 das Finale der Fünfer-Kombo; Revenge und Lufttreffer werfen weiter um, 2), Rückensinn (Rücken-Warnung 12 Frames länger, 3).
- **Alle acht umgesetzt, keines ausgelassen:** Keines braucht einen Eingriff in `src/simulation/`. Schaden, Revenge, Special und Standfestigkeit setzen nur die eigenen Fighter-Werte des Spielers (`damageScalePermille`, `resources.*.gainPerHit/gainPerBlock`, `stability`), Deckung erstattet den Chip-Schaden in der Survival-Schicht nach `resolveCombat` (ein Chip-K.O. bleibt ein K.O.), Energie und Max-Energie wirken in `gainEnergy`, der Rückensinn im Director.
- **Deterministisch:** Die Karten kommen aus einem eigenen, vom Seed abgeleiteten Zufallsstrom (`upgrades.seed`), getrennt vom Spawn-Strom: gleicher Seed, gleiche Karten; die Wahl ändert nie, welche Gegner kommen.
- **Anzeige:** Kartenauswahl als Overlay (Name, Stufe, Text, Stufen-Punkte), aktive Upgrades als Kürzel unter der Energieleiste des Spielers, im Endbanner aufgelistet. Texte EN/DE. Die HUD-Maximalenergie folgt der Max-Energie.
- **Balance-Lauf:** `npm run balance:survival` wählt jetzt nach jedem Boss eine zufällige Karte; neu sind `--upgrades on|off` und `--prefer <id>`. Messung (150 Seeds, Median defensiv / aggressiv): ohne Upgrades 166,5 / 226,4 s (identisch zur bisherigen Baseline), zufällige Wahl 169,8 / 229,0 s, Max-Energie bevorzugt 174,1 / 235,3 s, Energie-Gewinn 168,4 / 232,0 s, Schaden 169,3 / 228,5 s, die übrigen im Rauschen (±3 s). Der Bot sammelt nur 0,8 bzw. 2,2 Upgrades pro Lauf und stirbt fast immer im Boss-Duell; Schaden, Energie-Gewinn und Deckung wurden danach leicht angehoben (von 12 %, 20 %, +2).
- Testschalter für Browser-Smokes: `?survival-test=weak-boss` (erster Miniboss nach 2 s mit 1 hp).
- Versus, Training, Replays und Spieldaten unverändert: `ENGINE_VERSION` und Datenhash bleiben.
- Tests: `survival-upgrades.test.ts` (Ablauf und Pause, Auswahl deterministisch pro Seed, Spawns unabhängig von der Wahl, Stack-Limits, jede Wirkung einzeln, Angriffspause nach der Wahl, Menü-Eingabe), Boss-Timer-Test wählt jetzt die Karte, Balance-Test für `--upgrades`/`--prefer`. `smoke:survival` fällt den schwachen Test-Boss, prüft die Pause und wählt einmal per Ziffer und einmal per Steuerung.

## 2026-11-25 · Survival: headless Balance-Lauf

- **Neu:** `npm run balance:survival` spielt den Survival ohne Browser hunderte Male durch und misst die Balance, statt sie zu schätzen. Parameter: `--runs` (Anzahl Läufe, Standard 100), `--seed` (Seed-Start, 1), `--profile` (`defensive`, `aggressive` oder `all`), `--max-seconds` (maximale Spielzeit, 600), `--out` (Zielordner).
- **Bot** (`scripts/survival-balance-lib.ts`): Die Versus-CPU (`CpuPlayer` als Spieler 0) kämpft über die `pair`-Sicht jeweils gegen einen Zielgegner (nächster vorne, mit Hysterese; im Boss-Duell immer der Boss). Dazu kommt nur Survival-Verhalten: Umdrehen per Doppeltipp, wenn vorne niemand mehr steht, der Boss oder ein naher Gegner hinten ist oder (per Zufall je Profil) ein Rücken-Angreifer warnt. Zufällige Doppeltipps der CPU-Eingaben werden herausgefiltert, der Bot dreht nur absichtlich. Zwei Profile: `defensive` (Mittel-CPU, viel Blocken, wenig Angriff, reagiert fast immer auf Warnungen) und `aggressive` (Schwer-CPU, hohe Aggression, kurze Pausen, reagiert auf jede zweite Warnung).
- **Erfasst pro Lauf:** überlebte Zeit, besiegte Gegner pro Typ (inkl. Boss), erreichte Boss-Nummer, Todesursache (letzter Schadensgeber: Typ, vorne/hinten, Boss-Nummer), Energie am Ende jeder Minute, Energie gewonnen/verloren je Minute und gesamt, Drehungen.
- **Ausgabe** in `test-results/survival-balance/`: `summary.md` (Median, 10./90. Perzentil der Zeit, Kills, Boss-Verteilung, Todesursachen, Energiebilanz je Minute), `runs.csv` (ein Lauf pro Zeile) und `minutes.csv` (Lauf × Minute). Geladen wird der TS-Code wie bei `cpu:tournament` über Vites SSR-Loader; ein Lauf dauert etwa eine halbe Sekunde.
- **Wichtig:** Der Bot ist kein Mensch. Die Zahlen taugen für Vorher/Nachher-Vergleiche bei Tuning-Änderungen in `src/survival/config.ts` (gleiche Seeds, Profil und Limit), nicht für absolute Zeiten. Steht so auch in der Skript-Doku und in beiden READMEs.
- Keine Änderung an Simulation, Survival-Logik oder Spieldaten.
- Test: `survival-balance.test.ts` (gleicher Seed ergibt denselben Lauf für beide Profile, Energie-Buchhaltung konsistent, Berichte, Perzentile).

## 2026-11-25 · Survival: Würfe des Spielers

- **Neu:** Hüft- und Schulterwurf (6/4 + Wurf) funktionieren jetzt auch im Survival. Bisher wurde die Wurf-Taste dort maskiert. Nur der Spieler wirft; die Wurf-Taste der Gegner bleibt maskiert und der Director lässt weiterhin keinen Wurf-Move zu.
- **Ziel:** Der Griff prüft die Gegner von nah nach fern, der erste in Reichweite entscheidet. Es läuft die vorhandene Wurf-Logik aus `simulation/throws.ts` auf dem Paar [Spieler, Gegner]; `resolveThrows` nimmt dafür optional ein Werfbarkeits-Prädikat (Standard `isThrowable`, im Versus also unverändert).
- **Hitstun:** Im Survival sind Gegner im Hitstun am Boden zusätzlich werfbar (`survivalGrabbable`), im Versus bleibt es bei Stand/Gehen/Hocke.
- **Miniboss immun:** Steht der Boss als nächster Gegner in Reichweite, läuft der Versuch ins Leere (normale Fehlgriff-Recovery). Rückmeldung: gedämpfte Block-Funken mit grauem Ring am Boss, der dumpfe geblockte Wurf-Sound und kurz „ABGESCHÜTTELT“ / „SHRUGGED OFF“ über ihm (`state.shrug`). Heavy-Gegner sind werfbar.
- **Wirkung:** Umwerfen, Schaden und Leisten-Gain (Special für den Spieler, Revenge für den Gegner) wie im Versus; Energie wie ein einzelner Treffer (`energy.perHit`, kein Kombo-Bonus), Standfestigkeit wird beim Knockdown zurückgesetzt. Ein K.O. per Wurf zählt als Kill.
- **Fairness / Director:** Vom Wurfversuch bis `director.throwGraceFrames` (16) Frames nach dem Wurf startet kein Gegner einen neuen Angriff; vorbereitete CPU-Eingabefolgen und Rücken-Schläge, die noch nicht gestartet sind, werden verworfen, Tokens und Warnungen bleiben stehen. Begründung: Der Spieler steckt in der Wurfanimation und kann nicht blocken, ohne Pause würde die Menge jeden Wurf bestrafen; die kurze Frist danach gibt ihm eine faire Chance zu reagieren, danach ist der Druck sofort wieder da. Schon laufende Angriffe gehen weiter (ihr Startup war vor dem Wurf sichtbar), ein Treffer bricht den Wurf wie im Versus ab und der Gegner fällt ohne Schaden. Eine Unverwundbarkeit für den Werfer gibt es bewusst nicht, sonst wäre der Wurf ein Ausweichmanöver.
- Präsentation: Der geworfene Gegner hängt wie im Versus an den Händen des Spielers, Wurf-Effekte und -Sounds (Griff, Flug, Aufprall) laufen jetzt auch im Survival. `data-survival` hat zwei Felder mehr (gehaltene Gegner, abgeschüttelte Würfe).
- Keine Änderung am Versus-Verhalten und an den Spieldaten: `ENGINE_VERSION` und Datenhash bleiben (Survival hat keine Replays).
- Tests: `survival-throws.test.ts` (Wurf gegen jeden Gegnertyp, Rückwurf, Hitstun, nächstes Ziel, Boss-Immunität, Gegner werfen nie, K.O. per Wurf, Abbruch durch Treffer, Director-Pause über mehrere Seeds). `smoke:survival` wirft einen Gegner und lässt den Miniboss einen Wurf abschütteln.

## 2026-11-25 · Wirbel: erster Special-Move

- **Neu: Wirbel** (`special_spin`). Mit voller Special-Leiste startet **zurück (4) + LP + LK + MK** (P1: A + R + F + B, P2: → + Num7 + Num4 + Num2, Gamepad: zurück + X + A + B) einen 360°-Drehtritt mit dem hinteren Bein: Fersenstoß gerade nach hinten, dann mit dem Rücken zum Gegner ein Schwung vorne auf Hüfthöhe. 9 / 11 / 22 Frames (42 gesamt), keine Unverwundbarkeit. Ein Treffer pro Seite (Treffergruppen `back` 50 und `front` 60 Schaden), beide MID. Die Leiste wird beim Start geleert, auch bei einem Fehlschlag; die Revenge-Leiste bleibt unberührt. Ohne volle Leiste, in der Hocke oder in der Luft wirken die Tasten exakt wie bisher.
- **Befreiungsschlag:** Trefferstärke 160 für beide Gruppen (`rules.hitStrength.overrides`), wirft also Versus-Gegner (Stabilität 150) und im Survival Rookie bis Bruiser um; Heavy (170) und Minibosse (200) stecken den Treffer nur ein.
- **Eingabe:** Die Special-Leiste hatte bisher keinen Move. Gewählt ist ein Rückwärts-Dreier-Chord nur aus Tasten, die auch das Standard-Gamepad belegt (LMK, RLK, RHK sind dort frei, die Revenge-Kombo geht am Pad deshalb nur mit eigener Belegung). Kein Zweier-Teil davon ist ein bestehender Rückwärts-Chord (LK+LMK, MK+HP), Einzeltasten (Jab, Left Turn Kick, Spin Middle) und alle Chords bleiben unverändert (Architektur-Test, eigene Tests mit vollen Leisten). Rückwärtshalten dreht im Survival nicht um, nur der Doppeltipp.
- **Reichweite** (Mitte zu Mitte, bei Angriffsbeginn): vorne bis 89 px stehend / 81 px hockend, hinten bis 85 / 78 px. Durch den Rückwärtsschritt im Eingabeframe liegt der Startabstand vorne bei 87 / 79 px.
- Hit- und Hurtboxen kommen aus `spin-boxes.ts`: Der gemeinsame Kick-Generator kennt dafür `boxes: 'spin'`. Generator `scripts/generate-special-spin.mjs` (`npm run generate:special-spin`, im `generate:check`).
- Gilt in Versus, Training und Survival. Gegner hinter dem Spieler schauen ihn an und können ihn deshalb normal hockend blocken. Die CPU setzt ihn nicht ein (`KNOWLEDGE` ohne `command.resource`).
- Präsentation: eigener Starteffekt in Special-Farbe (Flash, Ring, Funken nach beiden Seiten) und eigener Start-Sound (Synth, helle Triangle-Figur); `newRevengeStarts` heißt jetzt `newResourceStarts` und meldet die Leiste mit. Treffer klingen als Dreh-Tritte. Kombo-Liste (EN/DE, eigener Leisten-Hinweis), Animationsvorschau, Move-Tabelle und beide READMEs ergänzt. `data-survival` am Canvas hat zwei Felder mehr (nächster Gegner hinten, Anzahl getroffener Gegner) für Smokes.
- Replay-Engine-Version (`ENGINE_VERSION`) **1.11.0 → 1.12.0**: neuer Move, neuer Chord und neue Trefferstärken ändern Simulation und Datenhash. Ältere Replays werden abgewiesen.
- Tests: `special-spin.test.ts` (Daten, Eingabe in allen Tastenreihenfolgen, Leiste leer auch bei Fehlschlag, Reichweite vorne/hinten, Blockbarkeit, Training/Replay, Survival mit Gegnern auf beiden Seiten, CPU, Sound, Standfuß). Neuer Smoke `smoke:special-spin`.

## 2026-11-25 · Survival: Lesbarkeit von HUD und Arena-Rand

- **Timer überlappt nicht mehr:** Die mittlere HUD-Spalte war fest 90 px (mobil 48 px) breit, die Survival-Zeit `m:ss` ist in 42 px Courier aber ~110 px breit („11:02“) und lief über die Energie des Gegners („181 / 520“). Die Spalte wächst jetzt mit dem Inhalt (`minmax(90px, max-content)`, Seitenspalten `minmax(0, 1fr)`), Timer und Bestzeit brechen nicht um. Im Survival ist die Zeit etwas kleiner (36 px, mobil 22 px), damit auch dreistellige Minuten („100:00“) Platz lassen. Namen und Energiewerte bekommen Abstand und kürzen notfalls mit „…“ statt zu überlappen.
- **Bossleiste unter dem HUD:** Die Miniboss-Leiste im Canvas saß fest auf y = 98 und lag bei mittleren und schmalen Fenstern unter Timer und Bestzeit. Sie rückt jetzt unter die Unterkante des DOM-HUD (in Canvas-Pixel umgerechnet), die Banner PAUSE / Rundenende rücken bei Bedarf mit.
- **Gegner am Rand – Befund:** Kein Bug. Stehende Gegner werden über `resolvePushboxes`/`clampToStage` immer ganz ins Bild geschoben (Pushbox 0..40 px an der Wand); simuliert über mehrere Seeds lag eine Körpermitte nur beim gewollten Hereinlaufen (`spawnOffset` 40 px, ~14 Frames) außerhalb. Halb angeschnitten stehen bleiben Gegner nur, wenn die Simulation einfriert: Hitstop, Pause oder nach Game Over (dort laufen hereinkommende Gegner nicht weiter).
- **Neu: Randpfeile.** Ein Gegner, dessen Körpermitte länger als 16 Simulations-Frames außerhalb liegt, bekommt am Bildrand über Kopfhöhe einen kleinen Pfeil in seiner Farbe (Bosse größer, mehrere pro Seite gestapelt). Ein Rücken-Angreifer in seiner Warnung pulsiert in der Revenge-Farbe mit „!“. Ein normales Hereinlaufen bleibt ohne Pfeil.
- Rein präsentational: keine Änderung an Simulation, `ENGINE_VERSION` oder Datenhash, keine neuen UI-Texte.
- Tests: `survival-edge.test.ts` (Verzögerung, Stapel, Warnung, K.o., Reset, Zustand unverändert), `hud.test.ts`. Neuer Smoke `smoke:survival-layout` prüft bei acht Fensterbreiten (1440 bis 360 px) mit Miniboss und Worst-Case-Texten („100:00“, „GEGNER 12“, „1520 / 1520“) die tatsächlichen Textboxen (DOM-Ranges) auf Überlappung, Abschneiden und Lage in der Arena, dazu die Bossleiste.

## 2026-11-25 · Seitenwahl gegen die CPU

- **Neu:** Button „Du: P1 / P2“ neben dem CPU-Schalter. Damit wählst du, welchen Kämpfer du im VS-CPU-Modus steuerst. Als P2 übernimmt die CPU Kämpfer 1 (mit der Stufe aus „CPU 1“), du steuerst Kämpfer 2 dann mit der P2-Belegung (Pfeiltasten + Numpad bzw. P2-Gamepad), WASD und die P1-Tasten bleiben wirkungslos.
- Die Wahl wird mit den CPU-Einstellungen gespeichert (`humanSide`). Im Training, Demo, Replay und Survival ist der Button gesperrt; der Trainings-Dummy bleibt immer P2.
- HUD: Namen, Modusanzeige, Stufe und CPU-Debugzeile folgen der gewählten Seite.
- Rein Eingabe-Routing vor der Simulation: keine Änderung an Engine-Version oder Datenhash, Replays speichern die Eingaben pro Kämpfer wie bisher.
- Tests: `cpu.test.ts`, `hud.test.ts`; `smoke:cpu` prüft Seitenwechsel, Eingabe-Routing im Replay, Persistenz und Sperre im Demo.
- **Survival als P2:** Die Seitenwahl gilt jetzt auch im Survival. Steht sie beim Start (F10) auf P2, steuerst du den Survival-Kämpfer mit der P2-Belegung (Pfeiltasten + Numpad bzw. P2-Gamepad), das HUD zeigt „PLAYER 02“. Die Seite bleibt für den ganzen Lauf fest; der Button ist im Survival weiter gesperrt.
- **Auto-Block im Survival:** Der Spieler bekommt den Auto-Block seiner Steuerungsseite (P1 oder P2), Gegner blocken nie automatisch. Der Auto-Block-Button zeigt im Survival jetzt den echten Zustand des Spielers (vorher stand er dort immer auf „Aus“) und wirkt sofort.
- Wieder reines Eingabe-Routing: keine Änderung an Engine-Version oder Datenhash. `hud.test.ts` und `smoke:survival` decken P2-Steuerung und Auto-Block-Anzeige ab.

## 1.12.0 · 22.11.2026

- App-Version (`package.json`, `package-lock.json`, README-Badges) **1.11.0 → 1.12.0**, Replay-Engine-Version (`ENGINE_VERSION`) **1.10.0 → 1.11.0**: Das Trefferstärke-/Knockdown-System, `rules.hitStrength` sowie die Rules-Änderungen an Revenge/Special seit 1.11.0 ändern Simulation und Replay-Datenhash. Ältere Replays werden eindeutig abgewiesen.
- Enthält den Survival-Modus (Teile 1 und 2), die Revenge-Kombo und die Änderungen der folgenden Einträge bis einschließlich „Special-Leiste von der Revenge-Leiste entkoppelt“.
- Die Revenge-Kombo (neuer Move, Dreier-Chord, `rules.hitStrength.overrides`) ändert Simulation und Datenhash ebenfalls. Engine 1.11.0 war noch nicht ausgeliefert (live: App 1.11.0, Engine 1.10.0; keine Tags), sie gehört deshalb zu Engine 1.11.0, ohne weitere Erhöhung.

## 2026-11-22 · Revenge-Kombo (7 Treffer)

- **Neu: Revenge-Kombo** (`revenge_combo`). Mit voller Revenge-Leiste startet **vorwärts (6) + LK + LMK + HK** (P1: D + F + G + H, P2: ← + Num4 + Num5 + Num6) eine Kombo mit sieben Treffern: Jab → Haken → Links Middle → Links High → Rechts Middle → Rechts High → schwerer Fauststoß. 6 / 61 / 10 Frames (77 gesamt), Schaden 40 + 60 + 65 + 80 + 65 + 80 + 110 = 500. Die Leiste wird beim Start geleert, auch bei einem Fehlschlag. Ohne volle Leiste, in der Hocke oder in der Luft verhalten sich die Tasten exakt wie bisher.
- **Nicht blockbar, sobald der Jab sitzt:** Der Abstand zwischen zwei Treffern ist immer mindestens 2 Frames kürzer als der Hitstun des vorigen (Unit-Test prüft das gegen die Move-Daten). Pushback gibt es nur beim Finisher. Der Finisher wirft um (Trefferstärke 240 über `revenge_combo:punch`, also auch Survival-Bosse). Wird der Jab geblockt, bleibt der Rest normal blockbar.
- **Step-in:** Der vordere Fuß setzt mit dem Jab nach vorn, der hintere zieht mit dem Haken nach (Vorschub 18 Rig-Einheiten in 16 Frames). Ohne diesen Schritt würde ein Jab aus voller Reichweite die folgenden Treffer zu kurz lassen. Kein Standfuß rutscht; jeder Wechsel des Standbeins hat eine eigene Gewichtsverlagerung, zwischen den Kicks eines Beins bleibt das Knie oben.
- **Startabstand** (Mitte zu Mitte): 38–93 px gegen einen stehenden, 38–86 px gegen einen hockenden Gegner. Der Jab ist auf Kinnhöhe des Hockenden gezielt; neues Move-Feld `standingHitstun` richtet einen hockenden Gegner im Hitstun auf (gezeichnet wurde der Hitstun schon immer stehend), damit auch die hohen Kicks treffen. Die Folgetreffer haben 3 px (stehend) bzw. 10 px (hockend) Reserve über die Jab-Reichweite hinaus.
- **Dreier-Chords:** `CHORD_UPGRADES` kennt jetzt zwei oder drei Tasten. Alle Partnertasten müssen im Fenster (weiter 3 Frames) gedrückt und gehalten sein, die Richtung über die ganze Historie. Neuer Travel-Modus `replace` (Vorschub des Einzel-Moves zurücknehmen und den der Kombo nachholen), damit jede Tastenreihenfolge denselben Weg ergibt. Bestehende Chords und Einzeltritte bleiben unverändert (Tests mit und ohne volle Leiste). Neues Command-Feld `resource` für Moves, die eine volle Leiste brauchen und leeren; Hold-Commands dürfen jetzt bis zu drei Tasten haben.
- Training: Die Leisten verhalten sich dort wie im Versus (keine Sonderbehandlung), die Kombo also auch.
- Survival: Stagger bricht die Revenge-Kombo nicht ab, der Finisher wirft selbst um. Leichte Gegner gehen vorher K.o.
- Die CPU setzt die Kombo vorerst nicht ein (`KNOWLEDGE` ohne Moves mit `command.resource`).
- Präsentation: Starteffekt (Flash, Ring, Funken nach vorn, kurzer Screenshake) und ein eigener Start-Sound (Synth), Treffer klingen je nach Gliedmaße als Schlag oder Tritt. Kombo-Liste, Animationsvorschau, Move-Tabelle und beide READMEs ergänzt.
- Generator `scripts/generate-revenge-combo.mjs` (`npm run generate:revenge-combo`, im `generate:check`). Der gemeinsame Kick-Generator kennt dafür `priority`, `resource`, `standingHitstun` und `hurtJoint`; Animationen dürfen bis zu 8 Bewegungsspuren haben.
- Tests: `tests/unit/revenge-combo.test.ts`, verallgemeinerter Chord-Test in `architecture.test.ts`; Browser-Smoke `npm run smoke:revenge-combo`. `data-survival` liefert für Smokes zusätzlich den Abstand zum nächsten Gegner vorn und die Treffer des aktuellen Spielerangriffs.
- Fix im Basis-Smoke: Er erwartete noch die Leisten-Zuwächse von vor der Rules-Änderung (Special 2 statt 3, Revenge 8 statt 3 nach einem LP).

## 2026-11-22 · Survival-Modus, Teil 2: Gegnermix, Miniboss, Energie

- **Gegnertypen** (`SURVIVAL.types`): `rookie`, `brawler` (leicht), `fighter`, `bruiser` (mittel), `heavy` (schwer), jeweils mit eigenen Werten für Lebenspunkte, Stabilität (Einzeltreffer-Knockdown), Standfestigkeit (`poise`), Schaden, Aggressivität und Reaktionszeit (überschreiben das CPU-Profil), Budgetkosten und Energie-Belohnung. `CpuPlayer` bekommt dafür einen optionalen Parameter `overrides`; ohne ihn ändert sich nichts.
- **Umkippen durch Treffer** (`SURVIVAL.stagger`): Jeder Treffer füllt die Standfestigkeit (20, ab dem zweiten Treffer einer Combo 40), voll = Knockdown. Der sehr leichte Gegner (poise 100) fällt nach 5 Einzeltreffern oder nach 3 Combo-Treffern. Die Standfestigkeit erholt sich nach 90 Frames ohne Treffer. Der Einzeltreffer-Knockdown aus Teil 1 bleibt. Geblockte Treffer zählen nicht.
- **Schwierigkeitsbudget** (`SURVIVAL.budget`, `src/survival/spawner.ts`): Jeder lebende Gegner kostet sein `cost`; das Budget startet bei 7 und wächst um 0,05 pro Sekunde. Gewichte pro Stufe, Mischgarantie (mindestens ein leichter und ein mittlerer, sobald Platz ist), schwere erst ab 50 s und höchstens einer gleichzeitig. Stirbt ein Gegner, ist sein Tier beim Nachspawn dreimal so wahrscheinlich. Kleine Wellen (`SURVIVAL.waves`) schicken zwischen den Bossen ein paar Extra-Gegner, meist leichte.
- **Miniboss** (`SURVIVAL.boss`): erster nach 30 s Spielzeit, Timer läuft nur ohne Boss in der Arena und startet neu mit 45 s, sobald der Boss besiegt und verschwunden ist. Nie zwei Bosse. Jeder weitere hat mehr Lebenspunkte, Standfestigkeit, Schaden und Aggressivität und reagiert schneller (`boss.growth`, mit Obergrenzen). Er läuft auf der Seite herein, in die der Spieler schaut, ist etwas größer gezeichnet, goldfarben und hat einen Lebensbalken. Ein Boss schiebt sich durch die Gegnermenge, damit Zuschauer das Duell nicht blockieren.
- **Director-Zustände:** `normal` wie in Teil 1; `duel` (Boss ist der einzige Angreifer, alle anderen warten ohne Token am Rand, auch ein Boss im Rücken greift mit Warnung an); `cleanup` nach dem Fall des Bosses (150 Frames: Cooldowns und Gnadenfristen weg, Rücken-Gegner mit vollen Rechten, ein Extra-Token, kurze Startverzögerung, schnelleres Nachspawnen).
- **Energie** (`SURVIVAL.energy`): kleine Gains pro Treffer (3, in Combos +2) und pro KO (je nach Typ), großer Bonus fürs Besiegen eines Bosses (320), der über die volle Energie hinaus bis `reserveCap` (1400) als Reserve zählt. Normale Gains füllen nie über 100 %. Alle Gains sinken um 8 % pro Minute, höchstens auf die Hälfte. Kurze „+N“-Anzeige über dem Spieler.
- HUD: Bosslinie (`BOSS IN 0:23` bzw. `BOSS 2`), zurückgewonnene Energie, Energieanzeige des fokussierten Gegners mit dessen Maximum.
- Keine Änderung an `src/simulation/`, `rules.json` oder den Spieldaten: Replay-Engine-Version und Datenhash bleiben unverändert.
- Tests: `tests/unit/survival-mix.test.ts` (Typen, Stagger, Budget und Mix, Boss-Timer, Director-Zustände, Energie); `smoke:survival` prüft zusätzlich den ersten Miniboss.

## 2026-11-22 · Survival-Modus, Teil 1: Fundament

- **Neu: Survival-Modus** (F10 oder Button „Survival“). Der Spieler startet in der Mitte, Gegner laufen immer wieder von links und rechts herein, Tote werden bis zur Maximalzahl nachgespawnt. Kein reguläres Ende: Der Lauf endet erst bei leerer Energie. Highscore ist die überlebte Zeit (HUD-Timer, Banner am Ende, Bestzeit im `localStorage`). Backspace startet einen neuen Lauf, F10 führt zurück in den Versus. Würfe sind im Survival vorerst deaktiviert.
- **Blickrichtung per Doppeltipp:** Im Survival bleibt die Blickrichtung fest, Rückwärtslaufen dreht nicht um. Doppeltipp nach hinten dreht mit kurzer Animation (8 Frames, Gelenke schließen sich zur Frontansicht, beide Augen sichtbar), währenddessen weder Angriff noch Laufen. Nur aus Stand oder Laufen; während Angriffen und Combos wird der Doppeltipp ignoriert, ein Rückwärtsdruck mit Taste startet weiterhin den Command-Move.
- **Director** (`src/survival/director.ts`): Angriffs-Tokens vorne (2) mit Vorrang, eigenes kleines Rücken-Budget (1, 300 Frames Cooldown). Rücken-Angreifer laufen heran, blinken mit „!“ (32 Frames) und schlagen dann einmal zu. Rücken-Gegner rücken auf, sobald vorne höchstens einer übrig ist oder der Spieler sich umdreht, danach 50 Frames Gnadenfrist. Nach jeder Drehung wird sofort neu einsortiert. Zufällige Startverzögerung pro Token, Sperre für identische Moves (40 Frames) und Mindestabstand zwischen Angriffsstarts (10 Frames) gegen synchrone Moves. Volle Auswertung alle 6 Frames. Gegner ohne Token lauern auf Abstand und blocken gelegentlich.
- Angriffe in den Rücken sind im Survival nicht blockbar (`GameState.noRearGuard`, nur dort gesetzt).
- **Knockdown-Änderung (alle Modi):** Neues Trefferstärke-System (`rules.hitStrength`). Stärke = Schaden oder Override; ein Bodentreffer mit Stärke ≥ Stabilität wirft um (kurzer Hüpfer nach hinten, dann Knockdown und Aufstehen). Standard-Stabilität 150, der Finisher der Fünfer-Combo (`middle_high_punch_combo:punch`) hat Stärke 200 und ist damit im Versus der einzige Bodentreffer, der umwirft. Neues optionales Feld `Fighter.stability` für spätere Gegnertypen; der Survival-Basisgegner hat 100, dort werfen also auch schwere Treffer um.
- Der vorhandene CPU-Gegner bekommt nur einen optionalen `gate`-Hook und `interrupt()`; ohne Gate (Versus, Demo, Training) verhält er sich unverändert.
- Alle Survival-Werte stehen zentral in `src/survival/config.ts`.
- Ändert `rules.json` und damit den Replay-Datenhash; gehört zur Engine-Version 1.11.0.
- Tests: `tests/unit/survival.test.ts`, `tests/unit/hit-strength.test.ts`; Browser-Smoke `npm run smoke:survival`.

## 2026-11-22 · „Leiste voll“-Sounds wieder hörbar, Revenge noch großzügiger

- **Fix:** Die „Leiste voll“-Sounds waren praktisch unhörbar. Gemessen lagen sie bei ca. −40 dBFS, also 15–20 dB unter den Treffern, und starteten exakt gleichzeitig mit dem Treffer, der die Leiste füllt. Dadurch gingen sie im Treffersound und im Kompressor unter. Jetzt liegen sie auf Trefferniveau (≈ −21,5 dBFS, Revenge-Gain 0,05 → 0,4, Special 0,07 → 0,55) und setzen 120 ms nach dem Treffer ein (`READY_OFFSET`). Rein präsentational.
- `smoke:audio-loudness` misst jetzt auch beide Ready-Cues (−25 … −18 dBFS), damit das nicht wieder passiert.
- Revenge lädt bei erlittenen Treffern noch großzügiger (`gainPerHit` 16 → 25). Voll nach rund 400 statt 625 Schaden.
- Ändert `rules.json` und damit den Replay-Datenhash; gehört zur Engine-Version 1.11.0.

## 2026-11-22 · Revenge lädt schneller, dezentere „Leiste voll“-Sounds

- Revenge lädt bei erlittenen Treffern deutlich großzügiger (`gainPerHit` 10 → 16). Die Leiste ist jetzt nach rund 625 statt 1000 Schaden voll, also nicht mehr erst kurz vor dem K.o.
- Ändert `rules.json` und damit den Replay-Datenhash; gehört zur Engine-Version 1.11.0.
- Die „Leiste voll“-Sounds sind neu: statt Sweep mit Schimmer jetzt ein kurzes, leises Chiptune-Arpeggio mit zwei weichen Echos (Revenge: tiefes Square-Moll, Special: helles Triangle-Dur bis zur Oktave). Rein präsentational.

## 2026-11-22 · Special-Leiste von der Revenge-Leiste entkoppelt

- Special und Revenge füllten sich bisher exakt gleich und waren deshalb immer gleichzeitig voll.
- Special lädt bei gelandeten Treffern jetzt langsamer (`gainPerHit` 10 → 7), Revenge bleibt bei 10.
- Neu: Geblockte Treffer geben dem Angreifer ein kleines bisschen Special (`gainPerBlock` 1, mindestens 1 Punkt). Revenge bekommt bei Block weiterhin nichts.
- Ändert `rules.json` und damit den Replay-Datenhash; gehört zur Engine-Version 1.11.0.

## 1.11.0 · 22.11.2026

- App-Version (`package.json`) **1.10.0 → 1.11.0**, Replay-Engine-Version (`ENGINE_VERSION`) **1.9.0 → 1.10.0**: Die neue Taste THROW (Button-Bit 9, `BUTTON_MASK` jetzt 1023), der neue Zustand `Thrown`, fünf Wurf-Moves samt Posen und Kontaktgeometrie sowie `rules.normalPriority` ändern Simulation und Replay-Datenhash. Ältere Replays werden eindeutig abgewiesen.
- Steuerungs-Schema (`stickman.controls`, `controls.json`) **2 → 3** mit Migration; gespeicherte Belegungen bleiben erhalten.
- Der „Leiste voll“-Effekt ist rein präsentational und ändert weder Datenhash noch Engine-Version.
- `package-lock.json` stand noch auf 1.9.1 und ist jetzt ebenfalls auf 1.11.0.

## 2026-11-22 · „Leiste voll“: Revenge und Special

Rein präsentational wie die Treffereffekte: alles wird aus zwei aufeinanderfolgenden Spielständen abgeleitet, nichts wird in den `GameState` geschrieben. Löst deshalb identisch in Replays und in der CPU-Demo aus.

### Neu
- **Auslöser** (`src/platform/resource-ready.ts`): pro Kämpfer und Leiste genau beim Übergang `current < max` → `current == max`. Füllen sich mehrere Leisten im selben Schritt, werden sie um 6 Schritte versetzt (P1 vor P2, Revenge vor Special).
- **HUD:** kurzer heller Flash und danach ein ruhiges Glow-Pulsieren (1,6 s, deutlich unter 3 Blitzen pro Sekunde) auf `.resource-track`, solange die Leiste voll ist, dazu das Label „REVENGE READY“ / „SPECIAL READY“ (DE: „REVENGE BEREIT“ / „SPECIAL BEREIT“). Statische Hervorhebung und Label hängen nur am Füllstand; Flash und Pulsieren am Schalter „Effekte“. Bei `prefers-reduced-motion` ersetzt ein statisches Highlight Flash und Puls. Beim Absinken verschwindet alles.
- **Canvas-Burst** am Kämpfer aus dem vorhandenen Partikelpool (Limit 192, geseedeter Zufall, keine Allokation pro Frame): neue Partikelarten Halo (expandierender Ring), Aura (kurzer Körperschimmer), Spark und Star. Revenge: schneller Ring, aggressive, schnell aufsteigende Funken in `palette.revenge`. Special: ruhiger, langsamer Ring mit funkelnden Sternen in `palette.special`. Kein Screen-Shake.
- **Sound** `HitAudio.playResourceReady`: synthetischer Charge-up-Chirp mit Schimmer am Ende. Revenge tiefer und kantiger (Sägezahn 98 → 392 Hz durch einen sich öffnenden Tiefpass, leichte Sättigung, Square-Arpeggio), Special heller (Dreieck 330 → 1320 Hz, Sinus-Arpeggio und Glocken-Oberton bei 2,76×). Mindestens 18 ms Attack und exponentielles Ausblenden vor jedem Stopp; zwei Trigger kurz hintereinander laufen als getrennte Stimmen. Stummschaltung, Autoplay-Unlock und Stimmenverwaltung wie bei allen Sounds.
- Tests: `effects.test.ts` (+6: Übergang, bereits volle Leiste, Rundenwechsel mit erhaltenen Ressourcen, Versatz, Partikellimit, GameState unverändert, Effekte aus, echtes Gameplay deterministisch), `audio.test.ts` (+2: Revenge/Special verschieden, klickfreie Hüllkurven, Versatz, Mute, Unlock), `hud.test.ts` (+2). `smoke:effects` erweitert: Burst sichtbar, Ready-Label, Dark/Light.

### Hinweis
- Ressourcen bleiben über Rundenwechsel erhalten (`resetRound`). Eine schon volle Leiste löst beim Rundenstart daher keinen neuen Burst aus, zeigt aber sofort den Ready-Zustand. Training-Wechsel und Neustart setzen die Leisten zurück.

## 2026-11-22 · Würfe: Hüftwurf und Schulterwurf

### Neu
- **Taste THROW** als vollwertiger zehnter Button (am Ende von `BUTTONS`, niedrigste `normalPriority`): P1 **C** (`KeyC`), P2 **Numpad 0** (`Numpad0`, die Taste „0 / Einfg“, unabhängig von NumLock), Gamepad **LB** (Button 4). Einstellungs-Panel, Steuerungsanzeige, Eingabeanzeige im Debug-Overlay, Move-/Kombo-Liste (EN/DE) und beide README-Steuerungstabellen.
- **Controls-Migration v2 → v3** in `validateControls`: THROW bekommt seinen Standard, sonst die erste freie Taste; `padButtons.THROW` = 4. Alle übrigen Belegungen bleiben unverändert, auch über v1 → v2 → v3 in einem Schritt.
- **Eingabe:** 6 + THROW → `throw_forward`, 4 + THROW → `throw_back` (Hold-Command, nur im Stand, relativ zum Gegner). Neutral, Diagonalen, Hocke, Luft, Angriff oder Stun lösen nichts aus; der Buffer verhält sich wie bei allen Hold-Moves. `validateMoves` nimmt nur THROW von der Pflicht eines Normal-Moves aus; THROW ist nicht in `CROUCH_BUTTONS`.
- **Daten** (`moves.json`, Feld `throw`, Schema und Validierung erweitert): Wurfversuche `throw_forward` / `throw_back` (Greifreichweite, Ausführung), Ausführungen `throw_forward_exec` / `throw_back_exec` (Bahn-Tabelle pro Frame, Release- und Aufprall-Frame, Clip des Geworfenen) und `throw_break` (Wurf-Clash). Würfe haben keine Hitboxen.
- **Regeln** (`src/simulation/throws.ts`): Greifen am ersten aktiven Frame, nur gegen einen Gegner am Boden in Idle, Walk, Crouch oder CrouchWalk innerhalb der Greifbox. Nicht blockbar, kein Combo-Anschluss. Verfehlt: lange Recovery. Treffer während des Startups bricht über den normalen Hitstun ab. **Wurf-Clash:** erreichen beide im selben Schritt ihren Greif-Frame in gegenseitiger Reichweite, scheitern beide, werden symmetrisch auseinandergeschoben und erholen sich kurz. Während `Thrown` folgt der Geworfene der Tabelle und ist unverwundbar; beim Aufprall Schaden, Ressourcen (`addHitResource`), Hitstop, `lastContact`, danach Knockdown mit `rules.knockdownFrames` und `recoverGround`. K.o. durch Wurf über die normale Rundenlogik. Training: kein HP-Verlust.
- **Seitenwechsel und Ecke:** Der Schulterwurf legt den Gegner hinter den Werfer. Wird der Geworfene von der Bühnengrenze geklemmt, weicht der Werfer um denselben Betrag aus; die Bahn bleibt stetig, niemand verlässt die Bühne, nach dem Aufprall überlappen die Pushboxen nicht.
- **Animation** über den Generator `generate:throws` (`scripts/generate-throws.mjs`, mit `--check` in `generate:check` und damit in `npm run check`), auf Basis von `scripts/kicks/rig.mjs`: Werfer-Clips für Versuch/Fehlgriff, Hüftwurf, Schulterwurf und Clash (ein Keyframe pro Frame, feste Knochenlängen, Arm-IK zu Zielpunkten der Hände) und Clips des Geworfenen. Bis zum Release hängt der Hals des Geworfenen exakt an den abgetasteten Händen des Werfers; einknickende Beine werden per IK auf den Boden gestellt. Danach folgt die Hüfte einer gekrümmten Flugbahn. Die Ganzkörperrotation (über 270°) ist in die absoluten Winkel eingebacken, der letzte Frame ist exakt die Knockdown-Pose (beim Schulterwurf gespiegelt), sodass beim Übergang nichts springt oder kreiselt.
- **Renderer** (minimal): Clip des Geworfenen über `thrownBy`, feste Blickrichtung zum Werfer während `Thrown`, Animationsflag `clampBody` (kein Gelenk unter dem Boden, `jointBottom`), Zeichenposition des Geworfenen aus der Bahn-Tabelle bei `moveFrame + alpha` (sonst hinge er einen Frame hinter den Händen). K.o. durch Wurf beginnt den K.-o.-Clip liegend.
- **Effekte:** Greif-Spark an den Händen, beim Aufprall großer Spark, Impact-Ring, Staub, Screen-Shake nach den bestehenden Regeln und Knockdown-Landung; Clash-Spark. Der Kombo-Zähler zeigt einen Wurf als „1 HIT“ / „1 TREFFER“. Alles über „Effekte“ bzw. „Screen-Shake“ schaltbar.
- **Sound:** `classifyHit`/`describeStrike` kennen die Art `throw`. Greifen: kurzer Stoff-/Griff-Thud (Synth), Flug: vorhandenes Whoosh-Sample (Hybrid, sonst Synth) mit Spitze auf dem Aufprall, Aufprall: tiefer, schwerer Slam (Synth, da kein Sample). Pegel mit `smoke:audio-loudness` vermessen.
- **CPU:** einfache Heuristik in `UtilityBrain` (Gegner wahrgenommen im Greifbereich, greifbar, steht still, hockt oder blockt durch Zurückgehen), Häufigkeit über das neue Profilfeld `throwChance` (leicht 0,02, mittel 0,14, schwer 0,32 pro Entscheidung), höchstens ein Wurf alle 240 Frames, mit dem Rücken zur Wand bevorzugt der Schulterwurf. Eigener abgeleiteter Zufallsstrom, damit alle übrigen Entscheidungen unverändert bleiben.
- **Werkzeuge:** Hitbox-Anzeige zeigt die Greifbox („GRAB“, am Greif-Frame „GRAB!“), Frame-Anzeige die Phasen STARTUP/GRAB/RECOVERY, THROW, THROW BREAK und THROWN. Animationsvorschau mit eigener Gruppe „Würfe“; bei den Ausführungen wird der Geworfene mitgezeichnet. Replay-Validierung kennt `Thrown` und prüft, dass genau der laufende Wurf des Gegners ihn hält.
- Tests `throws.test.ts` (44 Fälle): Taste/Priorität/Validierung, 6+THROW und 4+THROW in beiden Blickrichtungen, Buffer, falsche Richtung/neutral/Hocke/Luft/Stun, Reichweite knapp drin/knapp draußen, alle nicht greifbaren Zustände, Fehlgriff mit Recovery, Clash in beiden Spielerreihenfolgen, Unblockbarkeit (auch mit Auto-Block), Abbruch im Startup, Seitenwechsel und Ecken, Unverwundbarkeit, Schaden/Ressourcen/Hitstop/K.o./Training, Rundenende während des Wurfs, Replay-Roundtrip mit Snapshot mitten im Wurf, Snapshot-Validierung, Generator-Konsistenz (`--check`), Animations-Invarianten, Effekte, Sounds, CPU. `devices.test.ts` (+5): Standardbelegung, Migration v2 → v3 inklusive belegter Standardtaste, Laden gespeicherter v2-Belegungen, Pflichtfeld in v3. Neuer Smoke `smoke:throws` (C und Numpad0 aus echtem Laufen, Wurfeffekte in Dark/Light, UI EN/DE), aufgenommen in die Kern-Smokes.

### Gewählte Werte
- **Greifreichweite** `range` 29 × 256 (ungeskaliert) ab der Vorderkante der Pushbox, im Spiel ≈ 36 px. Gegriffen wird bis ≈ 75 px Mittenabstand; Pushboxen berühren sich bei ≈ 40 px, Stand-LP trifft bis ≈ 87 px.
- **Versuch:** 4 Frames Startup, Greif-Frame 4 (5. Frame), Fehlgriff-Recovery 22 Frames, gesamt 27. Hitstop beim Greifen 6.
- **Hüftwurf:** 110 Schaden, Ausführung 40 Frames, Release Frame 12, Aufprall Frame 20, Hitstop beim Aufprall 12. **Schulterwurf:** 130 Schaden, 46 Frames, Release 16, Aufprall 26, Hitstop 12. Danach Knockdown 30 Frames.
- **Clash:** 14 Frames, beide werden je 14 px auseinandergeschoben, Hitstop 6.

### Geändert
- Bestehende Tests nur dort angepasst, wo sie die alte Tasten- oder Move-Zahl fest kodierten: `combat.test.ts` (14 Hold-Angriffe ohne Würfe), `replay.test.ts` (ungültiges Button-Bit jetzt `BUTTON_MASK + 1` statt 512, das jetzt THROW ist), `leg-kicks.test.ts` (v1-Migration endet bei Schema 3 mit 14 Tasten), `hit-sound.test.ts` (Art `throw`; Würfe haben keine Swing-Cues), `cpu.test.ts` (`KNOWLEDGE` ohne Würfe), `hud.test.ts` (Fake-Elemente mit `classList`). Die Guard-Tests mit den „unaffected-moves“-Fixtures und alle Posen-/Kontakt-Hashes sind unverändert grün; bestehende Moves, Posen, Animationen und Kontaktgeometrie sind unverändert.
- `KNOWLEDGE` (Schlag-Repertoire der CPU) enthält keine Würfe; sie werden über die Greifreichweite gewählt.
- Footer: „TEN BUTTONS“ / „ZEHN BUTTONS“.
- `smoke:animation-preview`: Würfe als eigene Gruppe und eigener Listenabschnitt.

### Hinweis
- Ein Gegner im Startup eines eigenen (späteren) Wurfs ist im Angriff und damit nicht greifbar; nur gleichzeitig ausgelöste Würfe ergeben einen Clash.
- Kurz nach dem Aufstehen gibt es keinen gesonderten Wurfschutz.

### Prüfstand nach beiden Einträgen
- Typecheck (App und Skripte), **926 Tests in 50 Dateien**, alle Generatorprüfungen (inklusive `generate:throws -- --check`) und Produktionsbuild grün.
- `biome lint` meldet weiterhin Fehler (keine `biome.json`); die Zahl in `src/`, `scripts/` und `tests/` ist gegenüber dem Ausgangsstand unverändert, der Anstieg der Gesamtzahl stammt aus dem neu gebauten `dist/`. Die neuen Dateien sind lint-frei.
- Browser-Smokes (Chrome) grün: `smoke`, `audio`, `audio-loudness`, `update`, `cpu`, `stage`, `style`, `animation-preview`, `contact-timing`, `effects`, `punch-kick-combos`, `throws`. `smoke:rotation` nicht erneut geprüft (scheiterte schon vorher). `cpu:tournament` (schwer 91 % gegen mittel, mittel 95 % gegen leicht) und `cpu-benchmark` laufen.

---

## 1.10.0 · 21.11.2026

- App-Version (`package.json`) **1.9.1 → 1.10.0**, Replay-Engine-Version (`ENGINE_VERSION`) **1.8.0 → 1.9.0**: Die zwei neuen Kombos ändern Moves, Posen und Kontaktgeometrie und damit den Replay-Datenhash. Ältere Replays werden eindeutig abgewiesen.
- Die Treffereffekte sind rein präsentational und ändern weder Datenhash noch Engine-Version.

## 2026-11-21 · Zwei neue Kombos: Jab → High Kick und Middle Kick → Körperhaken

### Neu
- **`punch_kick_combo` (vorwärts 6 + MP + RHK, P1 T + N, P2 Num8 + Num3):** mittlerer Jab, Körperdrehung zurück auf 0, Guard-Übergang mit abhebender Ferse, rechter High Kick auf stehendem linkem Fuß. 34 Frames (8 / 15 / 11), Treffer `punch` 55 MID (Frame 8–10), `kick` 95 HIGH (Frame 20–22), zusammen 150. Basis sind die Posen `standing_mp_*` und `standing_rhk_*`; der Jab ist um 5° tiefer angesetzt, damit der MID-Treffer auch eine hockende Deckung erreicht.
- **`kick_punch_combo` (zurück 4 + MK + HP, P1 B + Y, P2 Num2 + Num9):** rechter Middle Kick, das Standbein bleibt bis zur Landung exakt am Boden, dann ein Ausfallschritt mit Körperhaken und eigener Körperdrehung. 47 Frames (17 / 16 / 14), Treffer `kick` 65 MID (Frame 17–19), `punch` 85 MID (Frame 30–32), zusammen 150. Basis sind `standing_mk_*` und `standing_hp_*`; der Haken wird mit Arm und Rumpf auf Körperhöhe geneigt (MID).
- **Akkordeingabe** über `CHORD_UPGRADES`: beide Tastenreihenfolgen, bis zu 3 Frames versetzt. Quellen sind die Einzel-Moves, die die Engine für die jeweilige Taste wirklich startet: 6+MP `standing_mp`, 6+RHK `standing_rhk`, 4+MK `spin_mk`, 4+HP `standing_hp`. Keine bestehende Eingabe wird verdrängt (6+HP bleibt `jumping_uppercut`, auch mit MK).
- **Timing statt Stun-Werte:** Erster Treffer ohne Pushback, Stun-Werte unverändert von `standing_mp` bzw. `standing_mk` übernommen. Der zweite Treffer liegt 12 bzw. 13 Frames nach dem ersten und damit sicher im Hitstun (23 / 25) und Blockstun (16 / 18). Der Finisher schiebt wie bei den übrigen Kombos zurück (5632 / 4096). Hüftschub (Kick) bzw. Ausfallschritt (Haken) sorgen dafür, dass der zweite Treffer überall dort ankommt, wo der erste trifft.
- Generatoren `generate:punch-kick` und `generate:kick-punch` (Basis `scripts/kicks/generate.mjs`), beide mit `--check` in `npm run check`. Hit-Gruppen, Trails, Strike-Boxen, Posenkontakt (`pose-contact-moves.ts`) und Kontaktgeometrie neu erzeugt.
- Kombo-Liste (EN/DE), Animationsvorschau, Hit-/Swing-Sounds (`classifyHit`: Gruppe `kick` klingt immer nach Tritt), CPU-Wissen (automatisch über `KNOWLEDGE`).
- Tests `punch-kick-combos.test.ts` (22 Fälle): Akkord in beiden Reihenfolgen und im 3-Frame-Fenster ohne Wiederholung, Einzel-Moves erhalten, falsche Richtung/neutral/Hocke/späte Akkorde lösen nichts aus, beide Treffer genau einmal und in Reihenfolge bei 30–75 px in beiden Blickrichtungen inklusive Replay, durchgehender Blockstun bis zum zweiten Treffer, feste Knochenlängen, kein Bodendurchdringen, Start- und Endpose = Idle, geerdetes Standbein. Smoke `smoke:punch-kick-combos`.

### Geändert
- **Move-Tabelle in beiden READMEs:** `generate:move-table` schreibt die Tabelle jetzt auf Englisch in `README.md` und auf Deutsch in `README.de.md` (aufklappbarer Abschnitt „Move list“ / „Moveliste“). README: 35 Angriffe.
- `combat.test.ts`: 14 statt 12 Hold-Angriffe. `hit-sound.test.ts`: Regel für Gruppe `kick` ergänzt.

### Behoben
- **`npm run generate:move-table -- --check` scheiterte seit `e1b4677`** mit `README.md: move-table markers missing`, weil die Marker nie in der README standen. Marker in beiden READMEs ergänzt.

### Hinweis
- MID muss in diesem Spiel hockend, HIGH stehend geblockt werden. Wer den Jab von `punch_kick_combo` hockend blockt und hocken bleibt, duckt den High Kick ab. Wer auf Stehblock wechselt, blockt beide; stehen ohne Block kassiert beide.

## 2026-11-21 · Treffereffekte: Funken, Shake, Staub, Kombo-Zähler

Rein präsentational: `src/render/effects.ts` (`HitEffects`) leitet alles aus `hitTargets`, `lastContact`, Positionen und Zuständen zweier aufeinanderfolgender Spielstände ab und schreibt nie in den `GameState`. Simulation, Snapshots, Replays, `DATA_HASH` und `ENGINE_VERSION` sind unberührt.

### Neu
- **Hit-Sparks** am Trefferpunkt (Spitze des treffenden Glieds, auf die Gegnerfront begrenzt): Linienburst plus Funkenstern mit Arena-Halo. Größe und Anzahl folgen Schaden und HitLevel (LOW < MID < HIGH); Schläge bilden einen kompakten Stern, Tritte einen längeren Fächer. Schwere und HIGH-Treffer bekommen zusätzliche Akzentstriche. Geblockte Treffer: kleiner, weniger Strahlen, gedämpfte Farbe, Block-Bogen.
- **Screen-Shake** bei schweren Treffern ab 45 Schaden, mit dem Schaden skaliert und auf 8 px begrenzt. Dazu bei Knockdown-Landung und K.o. Beim Block nur 15 %. Exponentielles Abklingen (×0,8 pro Schritt), deterministisch.
- **Staub und Bodenreaktionen:** Staubwölkchen bei Landung, Knockdown und Rutschen nach Treffer oder Block.
- **Kombo-Zähler** („2 HITS“ / „2 TREFFER“ samt Kombo-Schaden) mit Pop und Fade, in Spielerfarbe mit Halo. Endet, sobald der Gegner wieder handeln kann; zählt Mehrfachtreffer-Kombos korrekt mit (Tornado 2, Middle-High-Punch 5).
- **Zusätzlich:** Speed-Lines hinter Dreh- und Tornado-Angriffen und im Sprung, K.-o.-Aufblitzen mit leichtem Zoom auf den Getroffenen, Impact-Ring beim Landen.
- **Einstellungen:** Schalter „Effekte“ und „Screen-Shake“ (Shake samt K.-o.-Zoom) im Settings-Panel, EN/DE, gespeichert unter `stickman.effects` und `stickman.shake` (`on`/`off`). Ohne gespeicherte Wahl schaltet `prefers-reduced-motion` Shake und Zoom aus.
- **Zeitbasis:** ein Schritt pro Simulationsschritt, im Hitstop weiterlaufend, mit der K.-o.-Zeitlupe verlangsamt. Bei Pause und Einzelschritt steht alles still (neue Treffer erscheinen trotzdem); im Pausenbild wird kein Shake angewendet. Reset bei Neustart, Rundenwechsel, Replay-Start und Replay-Ende.
- **Technik:** eigener geseedeter Zufall (mulberry32), Partikelpool mit hartem Limit von 192 (Typed Arrays, ältester wird recycelt), keine Allokation pro Frame. Kamera mit leichtem Overscan im logischen 960×420-Raum, also unabhängig von der `fitCanvas`-Skalierung. Gemessen (Chrome headless, 3×-Canvas): 0,73 statt 0,71 ms pro Renderaufruf.
- Tests `effects.test.ts` (23 Fälle): Spawn-Regeln je HitLevel/Treffertyp/Block, deterministisches Shake-Abklingen, Begrenzung, Partikellimit, Reset, Pause, Reduced-Motion-Standard, Speicherung, Kombo-Zähler an echten Kombos, keine Zustandsänderung. Smoke `smoke:effects` (Schalter, Persistenz, Reduced Motion, Sichtbarkeit in Dark/Light auf allen drei Arenen).

### Prüfstand nach beiden Einträgen
- Typecheck (App und Skripte), **837 Tests in 49 Dateien**, alle Generatorprüfungen und Produktionsbuild grün.
- `npm run check` bricht dennoch beim Lint-Schritt ab: `biome lint` meldet schon auf dem unveränderten Stand 672 Fehler (keine `biome.json`, unter anderem wird `dist/` mitgeprüft). Die neuen Dateien sind lint-frei, die übrigen Schritte liefen einzeln.
- Browser-Smokes (Chrome) grün: alle außer `rotation`, der schon vorher scheiterte (siehe 30.09.).

---

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
