// housegen.js — thatched stone cottages, generated in code (pure JS, no Three.js).
// Each house returns geometry per material, UVs in METERS (each material divides by its texture's size):
//   stone  castle_wall_slates   walls, chimney, door step
//   brick  medieval_red_brick   corner quoins, window/door surrounds, chimney cap
//   wood   roof_planks          door, shutters, window bars, wooden gables
//   thatch reed_roof_03         thick roof with rounded eaves
//   ridge  reed_roof_03_ridge   bound-reed band with stakes along the roof ridge (v = 0..1 down the band)
//   glass                       dark window panes
import { sampleRoute, heightAt } from './world.js?v=75';

const MATS = ['stone', 'brick', 'wood', 'thatch', 'ridge', 'glass'];
const newG = () => ({ pos: [], nor: [], uv: [], idx: [] });
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// polygon (3 or 4 points, any order around) facing roughly along nExp
function poly(G, P, UV, nExp) {
  let n = cross(sub(P[1], P[0]), sub(P[2], P[0]));
  if (dot(n, nExp) < 0) { P = P.slice().reverse(); UV = UV.slice().reverse(); n = n.map((v) => -v); }
  n = norm(n);
  const b = G.pos.length / 3;
  P.forEach((p, i) => { G.pos.push(...p); G.nor.push(...n); G.uv.push(...UV[i]); });
  for (let i = 1; i < P.length - 1; i++) G.idx.push(b, b + i, b + i + 1);
}
// axis-aligned box, meter UVs per face
function box(G, x0, x1, y0, y1, z0, z1, skipBottom = true) {
  if (x0 > x1) [x0, x1] = [x1, x0]; if (z0 > z1) [z0, z1] = [z1, z0];
  for (const [x, s] of [[x1, 1], [x0, -1]]) poly(G, [[x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0]], [[z0, y0], [z1, y0], [z1, y1], [z0, y1]], [s, 0, 0]);
  for (const [z, s] of [[z1, 1], [z0, -1]]) poly(G, [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], [0, 0, s]);
  poly(G, [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], [0, 1, 0]);
  if (!skipBottom) poly(G, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], [0, -1, 0]);
}

// One cottage in local coordinates: ground at y = 0, ridge along z, front (door) wall at x = front * W/2.
export function houseGeometry(h) {
  const G = Object.fromEntries(MATS.map((m) => [m, newG()]));
  const { W, L, Hw } = h, p = (h.pitch * Math.PI) / 180, front = h.front || 1;
  const hw = W / 2, hl = L / 2, rise = hw * Math.tan(p), base = -1.5;

  // walls + quoins
  box(G.stone, -hw, hw, base, Hw, -hl, hl);
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    box(G.brick, sx * (hw - 0.5), sx * (hw + 0.03), base, Hw - 0.02, sz * (hl - 0.5), sz * (hl + 0.03));

  // gables: stone (part of the wall) or wooden boards
  for (const sz of [-1, 1]) {
    const z = sz * (hl + (h.gable === 'wood' ? 0.04 : 0));
    poly(h.gable === 'wood' ? G.wood : G.stone, [[-hw, Hw, z], [hw, Hw, z], [0, Hw + rise, z]], [[-hw, Hw], [hw, Hw], [0, Hw + rise]], [0, 0, sz]);
    if (h.gable === 'wood') { // stone behind the boards so nothing is see-through
      poly(G.stone, [[-hw, Hw, sz * hl], [hw, Hw, sz * hl], [0, Hw + rise, sz * hl]], [[-hw, Hw], [hw, Hw], [0, Hw + rise]], [0, 0, sz]);
    }
  }

  // openings. face = { axis: 'x' | 'z', s }, a0..a1 along the face, out = how far it stands proud of the wall
  const fbox = (Gm, face, a0, a1, y0, y1, o0, o1) => {
    if (face.axis === 'x') box(Gm, face.s * (hw + o0), face.s * (hw + o1), y0, y1, a0, a1);
    else box(Gm, a0, a1, y0, y1, face.s * (hl + o0), face.s * (hl + o1));
  };
  function windowAt(face, c, w = 0.85, ht = 1.0, sill = 0.85, shutters = true) {
    fbox(G.glass, face, c - w / 2, c + w / 2, sill, sill + ht, -0.02, 0.005);
    fbox(G.wood, face, c - 0.03, c + 0.03, sill, sill + ht, 0, 0.03);                 // window cross
    fbox(G.wood, face, c - w / 2, c + w / 2, sill + ht * 0.55 - 0.03, sill + ht * 0.55 + 0.03, 0, 0.03);
    fbox(G.brick, face, c - w / 2 - 0.22, c + w / 2 + 0.22, sill + ht, sill + ht + 0.24, -0.01, 0.06);   // lintel
    fbox(G.brick, face, c - w / 2 - 0.12, c + w / 2 + 0.12, sill - 0.12, sill, -0.01, 0.12);            // sill
    for (const e of [-1, 1]) fbox(G.brick, face, c + e * (w / 2) - (e < 0 ? 0.2 : 0), c + e * (w / 2) + (e > 0 ? 0.2 : 0), sill, sill + ht, -0.01, 0.05);
    if (shutters) for (const e of [-1, 1]) {
      const a = c + e * (w / 2 + 0.24);
      fbox(G.wood, face, Math.min(a, a + e * 0.42), Math.max(a, a + e * 0.42), sill - 0.02, sill + ht + 0.02, 0.05, 0.09);
    }
  }
  const frontF = { axis: 'x', s: front }, backF = { axis: 'x', s: -front };
  // door (front, middle)
  const dz = h.doorAt ?? 0;
  fbox(G.wood, frontF, dz - 0.5, dz + 0.5, 0, 1.95, -0.02, 0.06);
  fbox(G.brick, frontF, dz - 0.72, dz + 0.72, 1.95, 2.17, -0.01, 0.08);
  for (const e of [-1, 1]) fbox(G.brick, frontF, dz + e * 0.5 - (e < 0 ? 0.22 : 0), dz + e * 0.5 + (e > 0 ? 0.22 : 0), 0, 1.95, -0.01, 0.07);
  fbox(G.stone, frontF, dz - 0.8, dz + 0.8, -0.3, 0.16, 0, 0.6);                       // door step
  // windows: front + back, spaced along the wall, skipping the door
  const n = Math.max(1, Math.floor((L - 2) / 4.2));
  for (let i = 0; i < n + 1; i++) {
    const z = -hl + 1.4 + (i * (L - 2.8)) / Math.max(1, n);
    if (Math.abs(z - dz) > 1.6) windowAt(frontF, z);
    if (i % 2 === 0 || n < 3) windowAt(backF, z, 0.8, 1.0, 1.0, i % 2 === 0);
  }
  for (const sz of [-1, 1]) windowAt({ axis: 'z', s: sz }, 0, 0.7, 0.9, 0.9, false); // gable ends

  // ---- thatch roof: thick slab with rounded eaves, extruded along the ridge ----
  const t = 0.5, tv = t / Math.cos(p), eo = 0.4, go = 0.45, X = hw + eo, R0 = Hw + tv; // underside meets the wall top
  const top = (x) => R0 + rise - Math.abs(x) * Math.tan(p);
  const lip = (side) => { // semicircle from top edge to bottom edge, bulging outward
    const pts = [], cy = top(X) - tv / 2, r = tv / 2;
    for (let k = 1; k < 8; k++) { const a = Math.PI / 2 - (k * Math.PI) / 8; pts.push([side * (X + 0.35 * r * Math.cos(a) * 2), cy + r * Math.sin(a)]); }
    return pts;
  };
  // profile, counter-clockwise in (x, y)
  const prof = [];
  prof.push([-X, top(X) - tv]);                                 // left eave, underside
  { const l = lip(-1); for (let k = l.length - 1; k >= 0; k--) prof.push(l[k]); } // up around the left lip
  prof.push([-X, top(X)], [0, R0 + rise], [X, top(X)]);         // top surface
  for (const q of lip(1)) prof.push(q);                         // down around the right lip
  prof.push([X, top(X) - tv], [0, R0 + rise - tv]);             // underside
  let area = 0; for (let i = 0; i < prof.length; i++) { const a = prof[i], b = prof[(i + 1) % prof.length]; area += a[0] * b[1] - b[0] * a[1]; }
  const ccw = area > 0, z0 = -hl - go, z1 = hl + go;
  const slopeV = ([x, y]) => -(Math.abs(x) / Math.cos(p));       // meters down the slope from the ridge
  for (let i = 0; i < prof.length; i++) {
    const a = prof[i], b = prof[(i + 1) % prof.length], dx = b[0] - a[0], dy = b[1] - a[1];
    const nE = ccw ? [dy, -dx, 0] : [-dy, dx, 0];
    poly(G.thatch, [[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]],
      [[z0, slopeV(a)], [z0, slopeV(b)], [z1, slopeV(b)], [z1, slopeV(a)]], nE);
  }
  // end caps: two arms + the lips
  for (const [z, s] of [[z0, -1], [z1, 1]]) {
    const R = [0, R0 + rise, z], RU = [0, R0 + rise - tv, z];
    for (const side of [-1, 1]) {
      const T = [side * X, top(X), z], U = [side * X, top(X) - tv, z];
      poly(G.thatch, [T, R, RU, U], [[T[0], T[1]], [0, R[1]], [0, RU[1]], [U[0], U[1]]], [0, 0, s]);
      const c = [side * X, top(X) - tv / 2, z], l = lip(side);
      const ring = [[side * X, top(X)], ...l, [side * X, top(X) - tv]];   // lip points run top -> bottom
      for (let k = 0; k < ring.length - 1; k++) poly(G.thatch, [c, [ring[k][0], ring[k][1], z], [ring[k + 1][0], ring[k + 1][1], z]], [[c[0], c[1]], ring[k], ring[k + 1]], [0, 0, s]);
    }
  }
  // ridge band: one strip down each slope + a rounded roll along the top
  const band = 0.73, lift = 0.03, rz0 = z0 + 0.06, rz1 = z1 - 0.06;
  for (const side of [-1, 1]) {
    const nx = side * Math.sin(p), ny = Math.cos(p);
    const A = [0 + nx * lift, R0 + rise + ny * lift], B = [side * band * Math.cos(p) + nx * lift, R0 + rise - band * Math.sin(p) + ny * lift];
    poly(G.ridge, [[A[0], A[1], rz0], [B[0], B[1], rz0], [B[0], B[1], rz1], [A[0], A[1], rz1]],
      [[rz0, 1], [rz0, 0], [rz1, 0], [rz1, 1]], [nx, ny, 0]);
  }
  { const r = 0.2, cy = R0 + rise - 0.06, segs = 8;
    for (let k = 0; k < segs; k++) {
      const a0 = Math.PI / 2 + p - (k * 2 * p) / segs, a1 = Math.PI / 2 + p - ((k + 1) * 2 * p) / segs;
      const P0 = [r * Math.cos(a0), cy + r * Math.sin(a0)], P1 = [r * Math.cos(a1), cy + r * Math.sin(a1)];
      const nm = [Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), 0];
      poly(G.ridge, [[P0[0], P0[1], rz0], [P1[0], P1[1], rz0], [P1[0], P1[1], rz1], [P0[0], P0[1], rz1]], [[rz0, 0.98], [rz0, 0.98], [rz1, 0.98], [rz1, 0.98]], nm);
    } }

  // chimneys (stone stack through the ridge, brick cap)
  for (let c = 0; c < (h.chimneys || 0); c++) {
    const zc = (c === 0 ? 1 : -1) * (hl - 0.9), ytop = R0 + rise + 1.0;
    box(G.stone, -0.45, 0.45, Hw, ytop, zc - 0.45, zc + 0.45);
    box(G.brick, -0.55, 0.55, ytop, ytop + 0.22, zc - 0.55, zc + 0.55);
    box(G.brick, -0.14, 0.14, ytop + 0.22, ytop + 0.55, zc - 0.14, zc + 0.14);
  }
  return G;
}

// Place map.houses along the route: { d, side, off, W, L, Hw, pitch, chimneys, gable, jitter }
export function layoutHouses(R, T, map) {
  const out = [];
  for (const h of map.houses || []) {
    const s = sampleRoute(R, h.d), rx = -s.fz, rz = s.fx;
    const x = s.x + rx * h.side * h.off, z = s.z + rz * h.side * h.off;
    const rot = Math.atan2(s.fx, s.fz) + ((h.jitter || 0) * Math.PI) / 180;
    const c = Math.cos(rot), sn = Math.sin(rot);
    const corner = (lx, lz) => [x + lx * c + lz * sn, z - lx * sn + lz * c];
    let yMin = Infinity;
    for (const [lx, lz] of [[-h.W / 2, -h.L / 2], [h.W / 2, -h.L / 2], [h.W / 2, h.L / 2], [-h.W / 2, h.L / 2], [0, 0]]) {
      const [cx, cz] = corner(lx, lz); yMin = Math.min(yMin, heightAt(T, cx, cz));
    }
    out.push({ ...h, front: h.side, x, y: yMin - 0.05, z, rot, radius: Math.hypot(h.W, h.L) / 2 + 1, corner });
  }
  return out;
}

// Bake houses into one geometry per material (world space).
export function houseMeshes(layout) {
  const M = Object.fromEntries(MATS.map((m) => [m, newG()]));
  for (const h of layout) {
    const G = houseGeometry(h), c = Math.cos(h.rot), s = Math.sin(h.rot);
    for (const m of MATS) {
      const g = G[m], D = M[m], b = D.pos.length / 3;
      for (let i = 0; i < g.pos.length; i += 3) {
        const lx = g.pos[i], ly = g.pos[i + 1], lz = g.pos[i + 2];
        D.pos.push(h.x + lx * c + lz * s, h.y + ly, h.z - lx * s + lz * c);
        const nx = g.nor[i], ny = g.nor[i + 1], nz = g.nor[i + 2];
        D.nor.push(nx * c + nz * s, ny, -nx * s + nz * c);
      }
      D.uv.push(...g.uv);
      for (const k of g.idx) D.idx.push(k + b);
    }
  }
  return M;
}
export const HOUSE_MATS = MATS;
