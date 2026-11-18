/**
 * Dwit Chagi – gesprungener Rückwärtstritt mit halber Drehung.
 * Kommando: Zurück halten + RLK. Getreten wird mit dem hinteren (rechten) Bein.
 *
 * Referenz: pics/Taekwondo_Kicking_Video.mp4, 0:30.5–0:31.5. Im Treffer steht
 * der Körper mit Rücken und Seite zum Gegner, der Kopf schaut über die
 * Schulter, die Ferse stößt gerade nach hinten. Das Sprungbein hängt unter dem
 * Körper und winkelt zur Körpervorderseite ab, also vom Gegner weg.
 *
 * Bewegungsablauf (60 fps):
 *  f0–9   Laden: Gewicht auf den vorderen Fuß, Hüfte schiebt nach vorne, die
 *         Drehung beginnt am Boden (Ballen). Der Kopf bleibt beim Gegner.
 *  f9–11  Absprung. Die Drehung läuft hier schnell durch die Frontalansicht;
 *         das Sprungbein ist gestreckt, das Trittbein hängt locker, die Arme
 *         liegen eng am Körper, damit beim Seitenwechsel nichts springt.
 *  f11–15 Flug, Knie eng an der Brust (kleines Trägheitsmoment).
 *  f15–18 Kammer: das Knie sinkt unter die Hüfte, die Ferse kommt ans Gesäß
 *         und zeigt zum Gegner.
 *  f18–22 Die Ferse stößt gerade nach hinten, Bein waagerecht auf Kopfhöhe,
 *         Rücken zum Gegner (Yaw −172° … −180°), Oberkörper lehnt leicht vom
 *         Gegner weg, beide Fäuste bleiben vor der Brust.
 *  f22–31 Einziehen, das Sprungbein greift zur Landung.
 *  f31–49 Landung links, rechts setzt nach. Auf festen, fast gestreckten
 *         Beinen dreht die Figur weiter (gleiche Richtung) zurück in die
 *         Grundstellung; die Rückenansicht (−270°) liegt bei f41.
 *
 * Alle Glieder werden im Körperraum beschrieben (0° = Blickrichtung des
 * Körpers, 90° = unten, −90° = oben) und mit der Drehung (Yaw) in die
 * Bildebene projiziert. Knie und Ellenbogen zeigen damit immer zur
 * Körpervorderseite und wechseln ihre Seite nur in der Frontal- bzw.
 * Rückenansicht – dort sind die Glieder gestreckt bzw. eng am Körper.
 */
import { legIK } from './rig.mjs';

/** Guard-Arme, während der Rumpf lehnt (vom Left Turn Kick mitbenutzt): die
 * Fäuste bleiben vor Kinn und Brust und folgen der Neigung nur teilweise. */
export const ARM_FOLLOW = .35;
export const guardArms = guard => torso => ({
  l: guard.arms.l.map(a => a + (torso - guard.torso) * ARM_FOLLOW),
  r: guard.arms.r.map(a => a + (torso - guard.torso) * ARM_FOLLOW),
});

export const FIGURE_SCALE = ((105.53604992352896 + 12) / 105.53604992352896) ** 2;
/** Welteinheiten (wie in moves.json / 256) → Rig-Einheiten der Posendaten. */
export const rigUnits = world => world / FIGURE_SCALE;

const RAD = Math.PI / 180;

/** Monotone kubische Hermite-Kurve durch [frame, wert]-Paare (kein Überschwingen). */
export function track(points) {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]), n = xs.length;
  const d = xs.slice(0, -1).map((x, i) => (ys[i + 1] - ys[i]) / (xs[i + 1] - x));
  const m = xs.map((_, i) => {
    if (i === 0 || i === n - 1) return 0;
    if (d[i - 1] * d[i] <= 0) return 0;
    const h0 = xs[i] - xs[i - 1], h1 = xs[i + 1] - xs[i], w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;
    return (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  });
  return f => {
    if (f <= xs[0]) return ys[0];
    if (f >= xs[n - 1]) return ys[n - 1];
    const i = xs.findIndex((x, k) => f >= x && f <= xs[k + 1]);
    const h = xs[i + 1] - xs[i], t = (f - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
/** Kubisches Segment mit vorgegebenen Endgeschwindigkeiten (Einheiten/Frame). */
const segment = (f0, y0, v0, f1, y1, v1) => f => {
  const h = f1 - f0, t = (f - f0) / h, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * v0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * v1;
};
/** Körperraum-Winkel → Bildwinkel bei gegebener Drehung. */
export const project = (angle, yaw) => Math.atan2(Math.sin(angle * RAD), Math.cos(angle * RAD) * Math.cos(yaw * RAD)) / RAD;
const smooth = t => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };
const lerpAngle = (a, b, t) => a + ((((b - a) % 360) + 540) % 360 - 180) * t;

/** Zeitplan des Tritts, auch für die Tests. */
export const DWIT = {
  takeoff: 10,          // Zehen des vorderen Fußes lösen sich
  apex: 20.5,           // Scheitel der Flugbahn = Mitte der Active-Frames
  touchdown: 31,        // linker Fuß setzt auf
  rightDown: 35,        // rechter Fuß setzt auf
  travel: 38.5,         // Sprungweite der Hüfte (Rig-Einheiten)
  frontView: 10.5,      // Brust zur Kamera (Yaw −90°), in der Luft beim Absprung
  backView: 41,         // Rücken zur Kamera (Yaw −270°), auf beiden Füßen
};

export function dwitChagiDefinition(G) {
  const { takeoff, apex, touchdown, rightDown, travel } = DWIT;
  const L0 = G.leftFoot[0], R0 = G.rightFoot[0];
  const L1 = L0 + travel, R1 = R0 + travel;   // Füße in der Endstellung
  // Der Fighter-Ursprung (Pushbox) läuft bis zum ersten Active-Frame mit
  // (ohne Mehrfachtreffer erlaubt das Schema keinen Schritt in den Active-Frames).
  const advance = { frames: 19, distance: travel };
  const offset = f => { const t = Math.max(0, Math.min(1, f / advance.frames)); return advance.distance * t * t * (3 - 2 * t); };

  // ---------------------------------------------------------- Drehung ----
  // Über die hintere Schulter (negativ, wie spin_mk). Halbe Drehung bis zum
  // Treffer, Rücken zum Gegner. Danach in derselben Richtung weiter bis −360°,
  // die Rückenansicht erst auf beiden Füßen.
  const yaw = track([[0, 0], [3, -6], [6, -26], [8, -50], [9, -68], [10, -84], [11, -100], [12, -116], [14, -138], [16, -155],
    [18, -167], [19, -172], [22, -180], [26, -190], [touchdown, -205], [35, -222], [38, -244], [DWIT.backView, -270], [44, -310], [47, -345], [49, -360]]);
  // Der Kopf bleibt so lange wie möglich beim Gegner und schaut im Treffer
  // über die Schulter (Gesicht zur Kamera). Nach dem Tritt führt er die
  // Weiterdrehung an.
  const headYaw = track([[0, 0], [6, -8], [10, -30], [14, -58], [18, -76], [22, -82], [25, -100], [28, -150], [touchdown, -205],
    [35, -250], [38, -285], [DWIT.backView, -315], [44, -345], [47, -358], [49, -360]]);

  // ------------------------------------------------------ Hüftbahn -------
  // x in Bodenkoordinaten (ab Startstellung). Beim Lösen der Zehen liegt die
  // Hüfte vor dem vorderen Fuß, danach gleichförmig nach vorne.
  const xTakeoff = L0 + 9;
  const hipX = track([[0, 0], [3, 1.5], [6, 8], [8, 14.5], [takeoff, xTakeoff], [13, 23.2], [20, 29.2], [26, 34.3],
    [touchdown, travel - .1], [34, travel + .9], [38, travel + .4], [44, travel], [49, travel]]);
  // y: Laden, Abdruck mit wachsender Geschwindigkeit, Parabel, Abfedern,
  // Aufrichten auf fast gestreckte Beine für die Weiterdrehung, Grundstellung.
  const yTakeoff = -Math.sqrt(49.9 ** 2 - (xTakeoff - L0) ** 2) + .3;
  const yApex = -85.5, g = 2 * (yTakeoff - yApex) / (apex - takeoff) ** 2;
  const vUp = -g * (apex - takeoff);
  const flightY = f => yApex + g / 2 * (f - apex) ** 2;
  const loadY = track([[0, G.hip[1]], [2, G.hip[1] + 1.2], [4, -43.8], [6, -41.6]]);
  const pushY = segment(6, -41.6, 0, takeoff, yTakeoff, vUp);
  const yTouch = flightY(touchdown), vTouch = g * (touchdown - apex);
  const absorbY = segment(touchdown, yTouch, vTouch, 35, -39.5, 0);
  const settleY = track([[35, -39.5], [37, -42.5], [39, -47.4], [40, -48.4], [42, -48.4], [44, -47.8], [49, G.hip[1]]]);
  const hipY = f => f <= 6 ? loadY(f) : f <= takeoff ? pushY(f) : f <= touchdown ? flightY(f) : f <= 35 ? absorbY(f) : settleY(f);

  // ------------------------------------------------- Rumpf und Kopf ------
  // Vorlage beim Laden und Abspringen, aufrecht in der Drehung, im Tritt
  // leicht nach vorne (= vom Gegner weg) als Gegengewicht zum Bein.
  const torso = track([[0, G.torso], [3, -72], [6, -72], [8, -76], [takeoff, -84], [12, -88], [15, -88], [17, -84],
    [19, -80], [22, -80], [25, -84], [28, -84], [touchdown, -78], [34, -72], [37, -78], [DWIT.backView, -86], [44, -80], [49, G.torso]]);
  // Neigung in Sprungrichtung (Bildebene, +x = zum Gegner). Sie gehört zur
  // Welt, nicht zum Körper: auch halb gedreht lehnt man in den Sprung.
  const lean = track([[0, 0], [4, 2], [7, 8], [takeoff, 10], [12, 6], [15, 1], [17, 0], [49, 0]]);
  // Kopfwinkel relativ zum Rumpf (Kinn vorne).
  const headRel = track([[0, G.head - G.torso], [6, 17], [takeoff, 9], [13, 5], [19, 6], [24, 10], [touchdown, 16], [49, G.head - G.torso]]);

  // ------------------------------------------------------------ Arme -----
  // [Oberarm, Unterarm] im Körperraum. Beide Fäuste bleiben vor der Brust
  // (Referenz). In der Frontal- und der Rückenansicht liegen die Arme eng
  // und senkrecht am Körper, damit der Seitenwechsel nicht springt.
  const armL = [
    track([[0, G.arms.l[0]], [4, 66], [7, 50], [DWIT.frontView, 74], [13, 66], [16, 58], [19, 54], [23, 56], [27, 58], [touchdown, 54],
      [35, 58], [38, 68], [DWIT.backView, 76], [44, 66], [49, G.arms.l[0]]]),
    track([[0, G.arms.l[1]], [4, -34], [7, -70], [DWIT.frontView, -80], [13, -84], [16, -82], [19, -76], [23, -70], [27, -62], [touchdown, -52],
      [35, -52], [38, -76], [DWIT.backView, -88], [44, -70], [49, G.arms.l[1]]]),
  ];
  const armR = [
    track([[0, G.arms.r[0]], [4, 96], [7, 64], [DWIT.frontView, 80], [13, 72], [16, 66], [19, 62], [23, 66], [27, 76], [touchdown, 78],
      [35, 80], [38, 80], [DWIT.backView, 80], [44, 84], [49, G.arms.r[0]]]),
    track([[0, G.arms.r[1]], [4, -26], [7, -66], [DWIT.frontView, -72], [13, -82], [16, -90], [19, -92], [23, -88], [27, -80], [touchdown, -64],
      [35, -60], [38, -70], [DWIT.backView, -78], [44, -64], [49, G.arms.r[1]]]),
  ];

  // ----------------------------------------------------------- Beine -----
  // Im Flug [Oberschenkel, Kniebeuge] im Körperraum; Unterschenkel = Summe.
  // Rechtes Trittbein: Ferse löst sich, hängt beim Absprung leicht gebeugt
  // hinter der Hüfte (die Frontalansicht wird schnell durchlaufen, dort
  // springt das Knie nur um wenige Einheiten),
  // Knie an die Brust, Kammer (Knie unter der Hüfte, Ferse am Gesäß), Stoß
  // nach hinten (Körperraum 180° = zum Gegner), Einziehen, pendelt unter dem
  // Körper nach vorne zur Landung (vor dem Körper = hinter dem Sprungfuß).
  const rThigh = track([[5, 104], [7, 106], [9, 106], [10, 104], [11, 98], [12, 80], [13, 54], [14, 40], [15, 38], [16, 62], [17, 100], [18, 142], [19, 180], [22, 180],
    [24, 166], [26, 132], [28, 108], [30, 88], [32, 74], [34, 70]]);
  const rKnee = track([[5, 30], [7, 62], [9, 56], [10, 34], [11, 40], [12, 70], [13, 92], [14, 118], [15, 126], [16, 146], [17, 150], [18, 74], [19, 0], [22, 0],
    [24, 54], [26, 100], [28, 86], [30, 60], [32, 36], [34, 20]]);
  // Linkes Sprungbein: streckt sich im Abdruck, hängt im Flug unter dem
  // Körper, Knie zur Körpervorderseite (im Treffer also vom Gegner weg),
  // greift zur Landung nach unten.
  const lThigh = track([[takeoff, 98], [12, 94], [14, 84], [16, 76], [18, 72], [20, 72], [22, 74], [25, 74], [28, 72], [touchdown - 1, 76]]);
  const lKnee = track([[takeoff, 12], [12, 22], [14, 46], [16, 64], [18, 74], [20, 76], [22, 72], [25, 58], [28, 38], [touchdown - 1, 18]]);

  // Knie am Boden zur Körpervorderseite: +1 solange die Brust zum Gegner zeigt.
  const kneeSide = f => Math.cos(yaw(f) * RAD) >= 0 ? 1 : -1;
  const air = (thigh, knee, f, y) => ({ thigh: project(thigh(f), y), shin: project(thigh(f) + knee(f), y) });
  const ground = (footX, hip, f) => legIK([footX - hip.world, -hip.y], kneeSide(f));
  const blendLeg = (a, b, t) => ({ thigh: lerpAngle(a.thigh, b.thigh, t), shin: lerpAngle(a.shin, b.shin, t) });

  const keys = [];
  for (let f = 0; f < 50; f++) {
    const y = yaw(f), hy = headYaw(f), world = hipX(f), hip = { world, y: hipY(f) };
    const t = torso(f);
    const l = lean(f), body = a => project(a, y) + l;
    // Linkes Bein: Boden bis zum Lösen, kurzer Übergang, Flug, Übergang, Boden.
    let left;
    if (f <= takeoff - 1) left = ground(L0, hip, f);
    else if (f <= takeoff + 1) left = blendLeg(ground(L0, hip, f), air(lThigh, lKnee, Math.max(f, takeoff), y), smooth((f - takeoff + 1) / 2));
    else if (f < touchdown - 1) left = air(lThigh, lKnee, f, y);
    else if (f < touchdown) left = blendLeg(air(lThigh, lKnee, f, y), ground(L1, hip, f), .55);
    else left = ground(L1, hip, f);
    // Rechtes Bein: Boden (Ferse hebt ab), Übergang, Flug, Übergang, Boden.
    let right;
    if (f <= 3) right = ground(R0, hip, f);
    else if (f <= 6) right = blendLeg(ground(R0 + 1.5 * (f - 3), { ...hip, y: hip.y + (f - 3) * .9 }, f), air(rThigh, rKnee, Math.max(f, 5), y), smooth((f - 3) / 3));
    else if (f < rightDown - 2) right = air(rThigh, rKnee, f, y);
    else if (f < rightDown) right = blendLeg(air(rThigh, rKnee, f, y), ground(R1, { ...hip, y: hip.y + (rightDown - f) * 1.2 }, f), smooth((f - rightDown + 3) / 3));
    else right = ground(R1, hip, f);
    keys.push({
      f, hip: [world - offset(f), hip.y], torso: body(t), head: project(t + headRel(f), hy) + l,
      arms: { l: [body(armL[0](f)), body(armL[1](f))], r: [body(armR[0](f)), body(armR[1](f))] },
      yaw: y, headYaw: hy,
      left: { thigh: left.thigh, shin: left.shin }, right: { thigh: right.thigh, shin: right.shin },
    });
  }

  return {
    id: 'dwit_chagi', button: 'RLK', name: 'Dwit Chagi', duration: 50,
    frame: { startup: 19, active: 4, recovery: 27 },
    advance,
    hit: { damage: 105, hitLevel: 'HIGH', hitstun: 30, blockstun: 22, pushbackHit: 14336, pushbackBlock: 9216, hitstop: 14 },
    kickFoot: 'rightFoot', trail: { fromFrame: 16, toFrame: 22, historyFrames: 3 },
    // Der Schultergürtel dreht mit (wie beim Double High Kick).
    shoulders: (state, frame) => {
      const c = Math.cos(state.yaw * RAD);
      const envelope = Math.min(1, frame / 5, (49 - frame) / 12);
      const weight = smooth(envelope);
      return Object.fromEntries(/** @type {[string, number][]} */ ([['l', 1], ['r', -1]]).map(([side, sign]) => {
        const angle = Math.atan2(sign * c * .82, -.57) / RAD;
        const delta = ((angle - G.shoulders[side] + 540) % 360) - 180;
        return [side, G.shoulders[side] + delta * weight];
      }));
    },
    keys,
  };
}
