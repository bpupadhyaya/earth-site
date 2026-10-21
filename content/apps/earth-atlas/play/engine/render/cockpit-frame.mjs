// @ts-check
// The inside of a cockpit as drawing operations: the part of the aircraft the pilot sits behind. Two layers, both flat polygons and
// lines in canvas pixels (the same four operations as overlays.mjs, so WebGL and Canvas2D draw it alike):
//   under: window frame, header, glareshield and instrument panel, drawn before everything else so that instruments and labels sit on it
//   over:  the pilot's hands' work, drawn last: the yoke (airliner, light aircraft) or the cyclic and collective (helicopter), each
//          moving with what the player commands, so that stick and pedals can be seen to do something
// Pure function of its arguments: no clock, no state.
//   kind    'airliner' | 'light' | 'helicopter'
//   stick   [pitch, roll, yaw] each -1..1 (pitch > 0 = pulled back, roll > 0 = right)
//   lever   0..1 (collective, or the power lever)
import { clamp, num } from './geo.mjs';

/** Packed colour 0xRRGGBBAA. */
const C = (r, g, b, a = 255) => (((r << 24) | (g << 16) | (b << 8) | a) >>> 0);
const PANEL = C(19, 22, 29), PANEL_LO = C(9, 11, 15, 150), LIP = C(38, 44, 54), EDGE = C(128, 140, 158, 190), FRAME = C(15, 18, 23, 242), FRAME_LIT = C(74, 84, 100, 210);
const GLASS = C(255, 255, 255, 13), TINT = C(8, 10, 14, 84), PLASTIC = C(28, 32, 40, 240), PLASTIC_LIT = C(98, 108, 124, 230), RED = C(214, 52, 44), BOOT = C(10, 12, 15, 230);
const RAD = Math.PI / 180;

/**
 * @param {any} it the `cockpit` overlay item @param {{ W: number, H: number, dashTop: number, gap?: number[], floor?: number }} g
 *   dashTop: pixel row where the instrument panel begins (the top of the highest dock); gap: the free span between the two
 *   docks, [x0, x1], where the control column stands; floor: the bottom of the lowest dock (on a tall screen the wheel sits above it).
 * @returns {{ under: any[], over: any[] }}
 */
export function cockpitOps(it, g) {
  const { W, H } = g, V = Math.min(W, H), lw = Math.max(1, V * 0.0035);
  const kind = it.kind === 'helicopter' || it.kind === 'light' ? it.kind : 'airliner', heli = kind === 'helicopter';
  const st = Array.isArray(it.stick) ? it.stick : [0, 0, 0];
  const pitch = clamp(num(st[0], 0), -1, 1), roll = clamp(num(st[1], 0), -1, 1), yaw = clamp(num(st[2], 0), -1, 1), lever = clamp(num(it.lever, 0), 0, 1);
  const T = clamp(g.dashTop, H * 0.44, H * 0.82);
  /** @type {any[]} */ const under = [], over = [];
  const fill = (list, colour, pts) => list.push({ op: 'fill', colour, pts });
  const line = (list, colour, pts, width = lw, closed = false) => list.push({ op: 'line', colour, width, pts, closed });

  // ---- header: the roof edge across the top, lower in the middle ----
  const hdr = (heli ? 0.075 : 0.05) * V, bulge = (heli ? 0.035 : 0.03) * V, N = 14, edge = [];
  for (let i = 0; i <= N; i++) { const x = W * i / N, k = 1 - Math.pow(2 * i / N - 1, 2); edge.push(x, hdr + bulge * k); }
  const back = []; for (let i = N; i >= 0; i--) back.push(edge[2 * i], edge[2 * i + 1]);
  fill(under, FRAME, [0, 0, W, 0, ...back]);
  line(under, FRAME_LIT, edge, lw * 1.4);

  // ---- window posts ----
  const post = (side, x0, x1, y1x0, y1x1) => {   // side -1 left, +1 right; x at the top then at the dash
    const m = v => (side < 0 ? v : W - v);
    fill(under, FRAME, [m(x0), 0, m(x1), 0, m(y1x1), T, m(y1x0), T]);
    line(under, FRAME_LIT, [m(x1), 0, m(y1x1), T], lw);
  };
  if (heli) {
    // a bubble canopy: posts lean outward towards the floor, a thin centre post, chin windows below the panel line
    post(-1, W * 0.17, W * 0.22, W * 0.03, W * 0.075);
    post(1, W * 0.17, W * 0.22, W * 0.03, W * 0.075);
    fill(under, FRAME, [W * 0.492, hdr, W * 0.508, hdr, W * 0.512, T, W * 0.488, T]);
    line(under, FRAME_LIT, [W * 0.508, hdr, W * 0.512, T], lw);
    fill(under, TINT, [0, 0, W * 0.17, 0, W * 0.03, T, 0, T]);
    fill(under, TINT, [W, 0, W * 0.83, 0, W * 0.97, T, W, T]);
  } else {
    post(-1, W * 0.075, W * 0.12, 0, W * 0.05);
    post(1, W * 0.075, W * 0.12, 0, W * 0.05);
    fill(under, TINT, [0, 0, W * 0.075, 0, 0, T]);
    fill(under, TINT, [W, 0, W * 0.925, 0, W, T]);
  }
  // a reflection on the glass: one pale diagonal band
  fill(under, GLASS, [W * 0.2, hdr, W * 0.29, hdr, W * 0.17, T * 0.8, W * 0.09, T * 0.8]);

  // ---- glareshield and instrument panel ----
  const hump = (heli ? 0.045 : 0.022) * V, top = [], lip = 0.028 * V, body = [0, H];
  for (let i = 0; i <= N; i++) { const x = W * i / N, k = heli ? Math.max(0, 1 - Math.pow((2 * i / N - 1) / 0.5, 2)) : 1 - Math.pow(2 * i / N - 1, 2); top.push(x, T - hump * k); body.push(x, T - hump * k); }
  body.push(W, H);
  fill(under, PANEL, body);
  fill(under, PANEL_LO, [0, T + (H - T) * 0.45, W, T + (H - T) * 0.45, W, H, 0, H]);
  const band = []; for (let i = 0; i <= N; i++) band.push(top[2 * i], top[2 * i + 1]);
  for (let i = N; i >= 0; i--) band.push(top[2 * i], top[2 * i + 1] + lip);
  fill(under, LIP, band);
  line(under, EDGE, top, lw * 1.5);
  // a seam down the middle and two screws: enough to read as moulded panel rather than a flat bar
  line(under, C(0, 0, 0, 120), [W / 2, T + lip, W / 2, H], lw);

  // ---- the controls, drawn over the instruments ----
  const gap = g.gap && g.gap[1] - g.gap[0] > V * 0.12 ? g.gap : [W * 0.44, W * 0.56], cx = (gap[0] + gap[1]) / 2, room = (gap[1] - gap[0]) / 2;
  if (heli) {
    // cyclic: a stick from the floor with a grip on top; it leans with roll and comes back with pitch
    const bx = cx, by = H + V * 0.04, tx = cx + roll * V * 0.1, ty = H - V * 0.3 + pitch * V * 0.07;
    line(over, BOOT, [bx, by, tx, ty], V * 0.034);
    line(over, PLASTIC, [bx, by, tx, ty], V * 0.022);
    line(over, PLASTIC_LIT, [bx - V * 0.004, by, tx - V * 0.004, ty], lw);
    const gr = V * 0.036, grip = [];
    for (let i = 0; i < 12; i++) { const a = i / 12 * 2 * Math.PI; grip.push(tx + Math.cos(a) * gr * 0.62, ty + Math.sin(a) * gr); }
    fill(over, PLASTIC, grip); line(over, PLASTIC_LIT, grip, lw, true);
    fill(over, RED, [tx - gr * 0.2, ty - gr * 0.55, tx + gr * 0.2, ty - gr * 0.55, tx + gr * 0.2, ty - gr * 0.25, tx - gr * 0.2, ty - gr * 0.25]);
    // collective: a lever at the left that rises as power is added
    const lx = Math.max(W * 0.245, V * 0.2), cy = H - V * (0.05 + 0.2 * lever);
    line(over, BOOT, [lx, H + V * 0.02, lx - V * 0.02, cy], V * 0.03);
    line(over, PLASTIC, [lx, H + V * 0.02, lx - V * 0.02, cy], V * 0.019);
    const tw = []; for (let i = 0; i < 10; i++) { const a = i / 10 * 2 * Math.PI; tw.push(lx - V * 0.02 + Math.cos(a) * V * 0.021, cy + Math.sin(a) * V * 0.03); }
    fill(over, PLASTIC, tw); line(over, PLASTIC_LIT, tw, lw, true);
    // the pedals, seen as two plates at the bottom corners that push forward (up on the picture) with the yaw command
    for (const s of [-1, 1]) {
      const px = cx + s * Math.min(room * 0.9, V * 0.2), py = H - V * 0.02 - (s * yaw > 0 ? V * 0.025 : 0);
      fill(over, PLASTIC, [px - V * 0.05, py, px + V * 0.05, py, px + V * 0.045, py + V * 0.07, px - V * 0.045, py + V * 0.07]);
      line(over, PLASTIC_LIT, [px - V * 0.05, py, px + V * 0.05, py], lw * 1.4);
    }
  } else {
    // the pedestal: two thrust levers either side of the column, a flap lever with its detents, the trim wheel's mark, the gear lever
    const fl = clamp(num(it.flaps, 0), 0, 1), tr = clamp(num(it.trim, 0), -1, 1), gear = num(it.gear, 1), lv = V * 0.026;
    for (const s of [-1, 1]) {
      const lx = cx + s * Math.max(room * 0.62, V * 0.075), tip = H - V * (0.04 + 0.1 * lever);
      line(over, BOOT, [lx, H + V * 0.01, lx, tip], lv * 1.5); line(over, PLASTIC, [lx, H + V * 0.01, lx, tip], lv);
      const kn = []; for (let i = 0; i < 8; i++) { const a = i / 8 * 2 * Math.PI; kn.push(lx + Math.cos(a) * lv * 0.95, tip + Math.sin(a) * lv * 0.7); }
      fill(over, PLASTIC_LIT, kn);
    }
    if (kind === 'airliner') {
      const fx = cx + Math.max(room * 0.62, V * 0.075) + V * 0.07, fy0 = H - V * 0.2, fy1 = H - V * 0.04;
      line(over, BOOT, [fx - V * 0.016, fy0, fx - V * 0.016, fy1], lw * 1.2);
      for (let i = 0; i <= 5; i++) { const y = fy0 + (fy1 - fy0) * i / 5; line(over, EDGE, [fx - V * 0.028, y, fx - V * 0.006, y], lw); }
      const ly = fy0 + (fy1 - fy0) * fl;
      line(over, BOOT, [fx, ly, fx + V * 0.03, ly], lv * 1.2); fill(over, RED, [fx + V * 0.02, ly - lv * 0.5, fx + V * 0.04, ly - lv * 0.5, fx + V * 0.04, ly + lv * 0.5, fx + V * 0.02, ly + lv * 0.5]);
      // gear lever with a light: green down, dark up
      const gx = fx + V * 0.1, gy = H - V * (0.06 + 0.04 * (1 - gear));
      line(over, BOOT, [gx, H + V * 0.01, gx, gy], lv); fill(over, gear > 0.9 ? C(60, 220, 110) : C(70, 76, 86), [gx - lv * 0.7, gy - lv * 1.3, gx + lv * 0.7, gy - lv * 1.3, gx + lv * 0.7, gy - lv * 0.2, gx - lv * 0.7, gy - lv * 0.2]);
    }
    {   // the trim wheel's mark, on the left of the column: a slot and a pointer
      const tx = cx - Math.max(room * 0.62, V * 0.075) - V * 0.07, ty0 = H - V * 0.2, ty1 = H - V * 0.04;
      line(over, BOOT, [tx, ty0, tx, ty1], lw * 3); line(over, EDGE, [tx - V * 0.012, (ty0 + ty1) / 2, tx + V * 0.012, (ty0 + ty1) / 2], lw);
      const my = (ty0 + ty1) / 2 - tr * (ty1 - ty0) / 2; fill(over, C(255, 190, 40), [tx - V * 0.02, my, tx + V * 0.012, my - V * 0.012, tx + V * 0.012, my + V * 0.012]);
    }
    // yoke: a column to the floor, a U-shaped wheel that turns with roll and comes towards the pilot with pitch
    const R = Math.min(V * (kind === 'light' ? 0.12 : 0.1), Math.max(room * 1.15, V * 0.07)) * (1 + 0.16 * pitch), rest = W < H ? Math.min(T + (H - T) * 0.62, num(g.floor, H) - V * 0.1 * 0.8) : T + (H - T) * 0.62, hy = rest + pitch * V * 0.035;
    const a = -roll * 78 * RAD, ca = Math.cos(a), sa = Math.sin(a), P = (x, y) => [cx + (x * ca - y * sa) * R, hy + (x * sa + y * ca) * R];
    line(over, BOOT, [cx, hy, cx, H + V * 0.05], R * 0.34);
    line(over, PLASTIC, [cx, hy, cx, H + V * 0.05], R * 0.22);
    const U = [[-1, -0.62], [-0.98, 0.05], [-0.7, 0.42], [0, 0.56], [0.7, 0.42], [0.98, 0.05], [1, -0.62]].flatMap(p => P(p[0], p[1]));
    line(over, BOOT, U, R * 0.3);
    line(over, PLASTIC, U, R * 0.2);
    line(over, PLASTIC_LIT, [[-1, -0.62], [-0.98, 0.05], [-0.7, 0.42], [0, 0.56], [0.7, 0.42], [0.98, 0.05], [1, -0.62]].flatMap(p => P(p[0] - 0.05, p[1])), lw);
    const hub = []; for (let i = 0; i < 14; i++) { const t = i / 14 * 2 * Math.PI; hub.push(...P(Math.cos(t) * 0.22, 0.05 + Math.sin(t) * 0.22)); }
    fill(over, PLASTIC, hub); line(over, PLASTIC_LIT, hub, lw, true);
    // the two grips carry a button each; the left one is red
    fill(over, RED, [...P(-1.12, -0.5), ...P(-0.88, -0.5), ...P(-0.88, -0.36), ...P(-1.12, -0.36)]);
  }
  return { under, over };
}
