/** Taekwondo_Kicking_Video.mp4, 14.2–15.5s: high round kick,
 * plant into the turn, opposite high spinning kick, controlled recovery.
 *
 * Bewegungsschema beider Kicks (Referenz 14.3s und 15.0s):
 * - Das Knie führt: der Fuß löst sich hinten, das Knie zieht nach vorne-oben
 *   zur Brust, die Ferse bleibt eng am Gesäß. Beim Knie an der Brust ist der
 *   Rumpf schon fast aufrecht und das Standbein fast gestreckt.
 * - Aus der Kammer schnellt der Unterschenkel heraus, während die Hüfte nach
 *   vorne schiebt. Gestreckt wird früh, eingezogen spät und langsam: das Knie
 *   bleibt nach dem Treffer oben, erst dann sinkt das Bein.
 * - Das Standbein bleibt während der Drehung nahezu gestreckt.
 * - Nach dem zweiten Kick kippt der Rumpf mit dem Restschwung nach vorne,
 *   während das Bein herunterkommt, bis in die Grundstellung.
 * Bewusst keine glatten Winkel und keine gespiegelten Arme: der jeweils
 * hintere Arm schwingt als Gegengewicht, der vordere bleibt an der Deckung.
 */
import { LEG } from './rig.mjs';
const RAD = Math.PI / 180;
export function doubleHighKickDefinition(G) {
  const home = { hip: G.hip, torso: G.torso, head: G.head, arms: G.arms };
  // A travelling turn: the left foot stays planted for the first kick, the
  // right foot lands ahead and carries the turn and the second kick.
  const advance = { frames: 44, distance: 42 };
  const offset = f => { const t = Math.min(1, f / advance.frames); return advance.distance * t * t * (3 - 2 * t); };
  const L0 = G.leftFoot[0], R0 = G.rightFoot[0];
  const R2 = 34;                              // Landepunkt rechts (Bodenkoordinaten)
  const L3 = L0 + advance.distance;           // Landepunkt links = Endstellung
  const R3 = R0 + advance.distance;           // rechter Fuß in der Endstellung
  const ground = (x, knee = 1, y = 0) => ({ foot: [x, y], knee, space: 'ground' });
  // Hüfthöhe für ein Standbein mit gegebener Kniebeuge (Grad), Fuß auf dem Boden.
  const stand = (f, hipX, footX, bend) => {
    const d = LEG * Math.cos(bend / 2 * RAD), dx = footX - offset(f) - hipX;
    return -Math.sqrt(d * d - dx * dx);
  };
  // Hüfte in Bodenkoordinaten führen: hip[0] ist relativ zum mitlaufenden Root.
  const hip = (f, worldX, footX, bend) => { const x = worldX - offset(f); return [x, stand(f, x, footX, bend)]; };
  return {
    id: 'double_high_kick', button: 'LMK', buttons: ['LK', 'LMK'], duration: 78,
    frame: { startup: 18, active: 30, recovery: 30 },
    advance,
    hit: { damage: 60, hitLevel: 'HIGH', hitstun: 34, blockstun: 18, pushbackHit: 512, pushbackBlock: 1024, hitstop: 7 },
    kickFoot: 'rightFoot',
    // Yaw must move the shoulder joints themselves, not just the eyes/layers.
    // Rotate the girdle relative to the leaning spine, keeping bone lengths.
    shoulders: (state, frame) => {
      const c = Math.cos(state.yaw * Math.PI / 180);
      const envelope = Math.min(1, frame / 6, (77 - frame) / 10);
      const weight = envelope * envelope * (3 - 2 * envelope);
      return Object.fromEntries(/** @type {[string, number][]} */ ([['l', 1], ['r', -1]]).map(([side, sign]) => {
        const angle = Math.atan2(sign * c * .82, -.57) * 180 / Math.PI;
        const delta = ((angle - G.shoulders[side] + 540) % 360) - 180;
        return [side, G.shoulders[side] + delta * weight];
      }));
    },
    strikes: [
      { from: 18, to: 21, joint: 'rightFoot', group: 'first' },
      { from: 44, to: 47, joint: 'leftFoot', group: 'second', hit: { damage: 80, pushbackHit: 6656, hitstun: 26, hitstop: 10 } },
    ],
    keys: [
      { f: 0, ...home, yaw: 0, headYaw: 0, left: ground(L0), right: ground(R0) },
      // ---------------------------------------------------- Kick 1 (rechts) --
      // Gewicht auf den vorderen Fuß, Rumpf richtet sich auf, Hüfte steigt,
      // die hintere Ferse hebt ab.
      { f: 3, hip: hip(3, 2, L0, 21), torso: -80, yaw: 4,
        arms: { l: [54, -58], r: [96, -26] }, right: { thigh: 94, shin: 130 } },
      // Der hintere Fuß löst sich, die Ferse zieht hoch, das Knie geht voran.
      { f: 5, hip: hip(5, 4, L0, 16), torso: -85, yaw: 11,
        arms: { l: [50, -61], r: [108, -4] }, right: { thigh: 76, shin: 133 } },
      { f: 8, hip: hip(8, 6, L0, 11), torso: -89, yaw: 27,
        arms: { l: [45, -63], r: [125, 26] }, right: { thigh: 28, shin: 141 } },
      // Knie an der Brust: Rumpf fast aufrecht, Standbein fast gestreckt.
      { f: 11, hip: hip(11, 8, L0, 6), torso: -92, head: -82, yaw: 46,
        arms: { l: [41, -62], r: [138, 50] }, right: { thigh: -58, shin: 67 } },
      { f: 12, hip: hip(12, 8.5, L0, 5), torso: -94, yaw: 53, right: { thigh: -61, shin: 64 } },
      // Satz nach vorne über das Standbein und gleichzeitig ausstrecken.
      { f: 15, ease: 'in', hip: hip(15, 12, L0, 3), torso: -99, head: -90, yaw: 70,
        arms: { l: [37, -60], r: [153, 70] }, right: { thigh: -46, shin: -43.5 } },
      { f: 18, hip: hip(18, 14, L0, 2), torso: -102, head: -93, yaw: 85,
        arms: { l: [40, -56], r: [160, 78] }, right: { thigh: -44, shin: -42 } },
      { f: 21, hip: hip(21, 16, L0, 2.5), torso: -102.5, yaw: 103, headYaw: 4,
        arms: { l: [47, -49], r: [164, 82] }, right: { thigh: -41, shin: -39.5 } },
      { f: 23, hip: hip(23, 17.5, L0, 3), torso: -101, yaw: 114, headYaw: 25,
        arms: { l: [55, -42], r: [164, 66] }, right: { thigh: -40, shin: -37.5 },
        left: ground(L0, -1) },
      // Spät und langsam einziehen: das Knie bleibt oben.
      { f: 26, hip: hip(26, 19.5, L0, 5), torso: -97, yaw: 136, headYaw: 75,
        arms: { l: [70, -60], r: [156, 12] }, right: { thigh: -37, shin: 28 } },
      { f: 28, hip: hip(28, 21, L0, 8), torso: -92, yaw: 155, headYaw: 135,
        arms: { l: [90, -80], r: [146, -32] }, right: { thigh: -26, shin: 86 } },
      // -------------------------------------------------------- Drehung ------
      // Das Bein sinkt fast gestreckt und setzt vorne auf.
      { f: 30, hip: hip(30, 22, L0, 12), torso: -88, yaw: 176, headYaw: 192,
        arms: { l: [106, -94], r: [134, -70] }, right: { thigh: 67, shin: 79 } },
      // Rücken zum Gegner, beide Füße am Boden, die Knie zeigen nach hinten.
      { f: 31, hip: hip(31, 23, L0, 16), torso: -86, head: -80, yaw: 190, headYaw: 222,
        arms: { l: [113, -98], r: [132, -86] }, right: ground(R2, -1) },
      // Gewicht auf den rechten Fuß, der gestreckt die Drehung trägt; die
      // linke Ferse hebt ab.
      // Die Ferse hebt ab, das Bein bleibt dabei fast gestreckt: der Knick
      // zur Kammer darf erst danach entstehen, sonst kippt das Knie um.
      { f: 33, hip: hip(33, 27.5, R2, 6), torso: -88, yaw: 218, headYaw: 262,
        arms: { l: [120, -100], r: [114, -96] }, left: { thigh: 108, shin: 100 } },
      // Das linke Bein pendelt gestreckt unter der Hüfte nach vorne; das Knie
      // geht erst jetzt auf und wechselt dabei die Seite, während das Bein
      // gerade ist.
      { f: 34, hip: hip(34, 29.2, R2, 5), torso: -88.5, yaw: 232, headYaw: 281,
        arms: { l: [119, -98], r: [105, -100] }, left: { thigh: 96, shin: 112 } },
      { f: 35, hip: hip(35, 31, R2, 4), torso: -89, yaw: 246, headYaw: 300,
        arms: { l: [117, -94], r: [98, -101] },
        left: { thigh: 80, shin: 122 }, right: ground(R2, 1) },
      { f: 36, hip: hip(36, 32.5, R2, 3.5), torso: -90, yaw: 258, headYaw: 317,
        arms: { l: [114, -86], r: [93, -102] }, left: { thigh: 50, shin: 132 } },
      // Das linke Knie zieht nach vorne-oben, Rumpf aufrecht.
      { f: 37, hip: hip(37, 34, R2, 3), torso: -91, head: -82, yaw: 270, headYaw: 334,
        arms: { l: [110, -78], r: [91, -101] }, left: { thigh: 22, shin: 138 } },
      { f: 39, hip: hip(39, 36, R2, 2.5), torso: -94, yaw: 293, headYaw: 356,
        arms: { l: [104, -50], r: [88, -94] }, left: { thigh: -57, shin: 66 } },
      { f: 40, hip: hip(40, 36.5, R2, 2), torso: -96, yaw: 303, headYaw: 360,
        arms: { l: [106, -36], r: [88, -90] }, left: { thigh: -60, shin: 63 } },
      // ---------------------------------------------------- Kick 2 (links) --
      { f: 42, ease: 'in', hip: hip(42, 37.5, R2, 2), torso: -100, head: -91, yaw: 328,
        arms: { l: [120, -6], r: [84, -62] }, left: { thigh: -43, shin: -41 } },
      { f: 44, hip: hip(44, 38, R2, 2), torso: -101.5, yaw: 339,
        arms: { l: [136, 30], r: [79, -40] }, left: { thigh: -42, shin: -40.5 } },
      { f: 47, hip: hip(47, 38.5, R2, 2), torso: -101, yaw: 356,
        arms: { l: [146, 46], r: [81, -34] }, left: { thigh: -40, shin: -38 } },
      { f: 49, hip: hip(49, 38.5, R2, 2.5), torso: -99, head: -88, yaw: 360,
        arms: { l: [144, 44], r: [84, -36] }, left: { thigh: -38.5, shin: -36 } },
      // Spät einziehen: das Knie bleibt hoch, der Rumpf kippt mit dem
      // Restschwung schon nach vorne.
      { f: 52, hip: hip(52, 39, R2, 4), torso: -93, head: -80,
        arms: { l: [128, 16], r: [92, -50] }, left: { thigh: -35, shin: 22 } },
      { f: 55, hip: hip(55, 39.5, R2, 6), torso: -87,
        arms: { l: [104, -24], r: [95, -55] }, left: { thigh: -24, shin: 86 } },
      { f: 58, hip: hip(58, 40.5, R2, 9), torso: -81,
        arms: { l: [82, -46], r: [93, -50] }, left: { thigh: 21, shin: 103 } },
      // Landung vorne in der Grundstellung, der Schwung trägt noch etwas nach.
      { f: 61, hip: [0, -46.4], torso: -75, head: -55,
        arms: { l: [66, -54], r: [89, -44] }, left: ground(L3) },
      { f: 63, hip: [0.4, -45.8], torso: -71.5 },
      // Der hintere Fuß setzt kurz nach in die Auslage.
      { f: 66, hip: [0.2, -46.3], torso: -72, arms: { l: [59, -54], r: [88, -42] },
        right: ground((R2 + R3) / 2 - 1, 1, -2.5) },
      { f: 69, hip: [0, -47], torso: -73.5, right: ground(R3) },
      { f: 72, ...home },
      { f: 77, ...home, left: ground(L3), right: ground(R3) },
    ],
  };
}
