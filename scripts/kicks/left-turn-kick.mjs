/** pics/Taekwondo_Kicking_Video.mp4, 3:22–3:24:
 * left kick into the turn, plant the left foot, lift the right knee, recover.
 * The right knee is a recovery chamber, not a second attack.
 */
import { guardArms } from './dwit-chagi.mjs';
export function leftTurnKickDefinition(G) {
  const arms = guardArms(G), L = G.leftFoot, R = G.rightFoot;
  const home = { hip: G.hip, torso: G.torso, head: G.head, arms: G.arms };
  const left = { foot: L, knee: 1, space: 'ground' };
  const right = { foot: R, knee: 1, space: 'ground' };
  return {
    id: 'left_turn_kick', button: 'LK', duration: 66,
    frame: { startup: 18, active: 4, recovery: 44 },
    hit: { damage: 70, hitLevel: 'HIGH', hitstun: 26, blockstun: 18, pushbackHit: 6656, pushbackBlock: 4096, hitstop: 10 },
    kickFoot: 'leftFoot', trail: { fromFrame: 14, toFrame: 23, historyFrames: 3 },
    keys: [
      { f: 0, ...home, yaw: 0, headYaw: 0, left, right },
      { f: 5, hip: [0, -44], torso: -87, arms, yaw: 25, headYaw: 15 },
      // Pivot on the right foot; the left knee leads the rising kick.
      { f: 10, hip: [0, -47], torso: -100, arms, yaw: 55, headYaw: 35,
        left: { thigh: -65, shin: 65 } },
      { f: 14, hip: [-1, -47], torso: -110, arms: { l: [-140, -80], r: [-15, -75] },
        yaw: 80, headYaw: 60, left: { thigh: -52, shin: 15 } },
      { f: 18, ease: 'in', hip: [-2, -47], torso: -116, head: -98, yaw: 95, headYaw: 75,
        left: { thigh: -38, shin: -46 } },
      { f: 21, ease: 'lin', yaw: 112, headYaw: 95, left: { thigh: -40, shin: -42 } },
      // Fold the striking leg before lowering it. The turn never reverses.
      { f: 26, hip: [0, -46], torso: -101, arms: { l: [-160, -100], r: [-45, -110] },
        yaw: 155, headYaw: 150, left: { thigh: -55, shin: 65 } },
      { f: 32, hip: [1, -44], torso: -91, arms, yaw: 205, headYaw: 210,
        left: { foot: [12, 0], knee: 1, space: 'ground' } },
      // Weight transfers to the planted left foot before the right knee rises.
      { f: 35, hip: [4, -46], yaw: 235, headYaw: 245 },
      { f: 41, hip: [7, -48], torso: -94, arms, yaw: 290, headYaw: 305,
        right: { thigh: -55, shin: 100 } },
      { f: 46, hip: [7, -48], torso: -93, yaw: 340, headYaw: 350,
        right: { thigh: -55, shin: 100 } },
      { f: 50, yaw: 360, headYaw: 360 },
      { f: 57, hip: [3, -44], torso: -85, arms, right },
      { f: 61, hip: G.hip, torso: G.torso, head: G.head, arms: G.arms, left },
      { f: 65, ...home, left, right },
    ],
  };
}
