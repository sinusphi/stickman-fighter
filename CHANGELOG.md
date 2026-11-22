# Changelog – Stickman Fighter

## 1.12.0 · 22.11.2026

- App-Version (`package.json`, `package-lock.json`, README-Badges) **1.11.0 → 1.12.0**, Replay-Engine-Version (`ENGINE_VERSION`) **1.10.0 → 1.11.0**: Das Trefferstärke-/Knockdown-System, `rules.hitStrength` sowie die Rules-Änderungen an Revenge/Special seit 1.11.0 ändern Simulation und Replay-Datenhash. Ältere Replays werden eindeutig abgewiesen.
- Enthält den Survival-Modus (Teil 1) und die Änderungen der folgenden Einträge bis einschließlich „Special-Leiste von der Revenge-Leiste entkoppelt“.

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
