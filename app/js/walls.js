// walls.js — stone walls beside the road, placed automatically from the terrain:
//  - RETAINING WALLS where the road cuts into a hillside (bank higher than the road)
//  - low PARAPETS where the road runs on an embankment (ground drops away)
// Walls use a tiling stone texture; the cap uses one band of a trim sheet (fort_trim).
import * as THREE from 'three';
import { heightAt } from './world.js?v=76';

const STEP = 2; // meters between wall rows

export function buildWalls({ scene, R, T, map, lib, loadSlot, aniso }) {
  const cfg = map.walls; if (!cfg) return null;
  const W = map.world, edge = W.roadHalf + W.shoulder;
  const n = Math.floor(R.length / STEP);
  const fin = map.finish ? [R.length - (map.finish.barriersBefore || 0) - 40, (map.finish.barriersAfter || 0) + 30] : null;

  // per side: classify each row as wall (cut), parapet (fill) or nothing
  const runs = [];
  for (const side of [-1, 1]) {
    const kind = new Int8Array(n), hgt = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const d = k * STEP, i = Math.floor(d / R.ds) % R.n, rx = -R.fz[i], rz = R.fx[i], y = R.y[i];
      if (fin && (d > fin[0] || d < fin[1])) continue;              // keep the finish area clear for barriers
      const hBank = heightAt(T, R.x[i] + rx * side * (edge + 5), R.z[i] + rz * side * (edge + 5)) - y;    // bank height a few m back
      const hNat = map.naturalHeight(R.x[i] + rx * side * (edge + 4), R.z[i] + rz * side * (edge + 4)) - y;
      if (hBank >= cfg.cutMin) { kind[k] = 1; hgt[k] = Math.min(3.0, Math.max(0.9, hBank * 0.7 + 0.3)); }
      else if (-hNat >= cfg.fillMin) { kind[k] = 2; hgt[k] = 0.9; }
    }
    // fill short gaps, drop short runs, smooth heights
    for (let k = 1; k < n - 5; k++) if (!kind[k] && kind[k - 1]) { for (let g = 1; g <= 5; g++) if (kind[k + g] === kind[k - 1]) { for (let q = 0; q < g; q++) { kind[k + q] = kind[k - 1]; hgt[k + q] = hgt[k - 1]; } break; } }
    let k = 0;
    while (k < n) {
      if (!kind[k]) { k++; continue; }
      const t = kind[k]; let e = k; while (e < n && kind[e] === t) e++;
      if ((e - k) * STEP >= 24) {
        const hs = []; for (let q = k; q < e; q++) { let s = 0, c = 0; for (let w = -6; w <= 6; w++) if (q + w >= k && q + w < e) { s += hgt[q + w]; c++; } hs.push(s / c); }
        runs.push({ side, type: t, k0: k, hs });
      }
      k = e;
    }
  }

  // geometry: wall body (inner face, top, outer face) + cap strip, UVs in meters along the road
  const body = { pos: [], uv: [], idx: [] }, cap = { pos: [], uv: [], idx: [] };
  const TRIM_V0 = 0.505, TRIM_V1 = 0.615; // the row of square cut blocks in the trim sheet
  function strip(G, rows, uFn, vs) { // rows: array of arrays of [x,y,z] across; vs: v per column
    const cols = rows[0].length, base = G.pos.length / 3;
    rows.forEach((r, ri) => r.forEach((p, ci) => { G.pos.push(...p); G.uv.push(uFn(ri), vs[ci]); }));
    for (let r = 0; r < rows.length - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const a = base + r * cols + c, b = a + 1, e = a + cols, f = e + 1; G.idx.push(a, b, e, b, f, e);
    }
  }
  let count = 0;
  for (const run of runs) {
    const thick = run.type === 1 ? 0.5 : 0.4, rowsB = [], rowsC = [], ramp = 3;
    run.hs.forEach((h0, q) => {
      const d = (run.k0 + q) * STEP, i = Math.floor(d / R.ds) % R.n, rx = -R.fz[i], rz = R.fx[i], y = R.y[i];
      const L = run.hs.length; const fade = Math.min(1, q / ramp, (L - 1 - q) / ramp); // walls rise out of the ground at their ends
      const h = Math.max(0.15, h0 * (0.35 + 0.65 * fade));
      const s0 = run.side * (edge + 0.15), s1 = s0 + run.side * thick;
      const P = (s, yy) => [R.x[i] + rx * s, y + yy, R.z[i] + rz * s];
      rowsB.push([P(s0, -0.7), P(s0, h), P(s1, h), P(s1, -1.5)]);
      const c0 = s0 - run.side * 0.06, c1 = s1 + run.side * 0.06;
      rowsC.push([P(c0, h), P(c0, h + 0.14), P(c1, h + 0.14), P(c1, h)]);
    });
    const ht = run.hs.reduce((a, b) => Math.max(a, b), 0);
    strip(body, rowsB, (r) => r * STEP, [0, ht + 0.7, ht + 0.7 + thick, 2 * ht + 2.2 + thick]); // v in meters, unfolded
    strip(cap, rowsC, (r) => (r * STEP) / 4, [TRIM_V0, TRIM_V0 + 0.02, TRIM_V1 - 0.02, TRIM_V1]);
    count++;
  }
  if (!count) return { count: 0 };
  const mk = (G) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(G.pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(G.uv, 2)); g.setIndex(G.idx); g.computeVertexNormals(); return g; };

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 0.95, side: THREE.DoubleSide });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x9a9284, roughness: 0.9, side: THREE.DoubleSide });
  const wall = new THREE.Mesh(mk(body), wallMat), capMesh = new THREE.Mesh(mk(cap), capMat);
  wall.castShadow = wall.receiveShadow = capMesh.receiveShadow = capMesh.castShadow = true;
  scene.add(wall, capMesh);

  const apply = (mat, got, meters, repeatV) => {
    for (const t of [got.diff, got.nor, got.arm]) if (t) { t.repeat.set(1 / meters, repeatV ? 1 / meters : 1); t.anisotropy = aniso; }
    if (got.diff) { mat.map = got.diff; mat.color.set(0xffffff); }
    if (got.nor) mat.normalMap = got.nor;
    if (got.arm) { mat.roughnessMap = got.arm; mat.aoMap = got.arm; mat.roughness = 1; }
    mat.needsUpdate = true;
  };
  if (lib[cfg.wall]) loadSlot(lib[cfg.wall]).then((got) => apply(wallMat, got, lib[cfg.wall].meters, true));
  if (lib[cfg.cap]) loadSlot(lib[cfg.cap]).then((got) => { for (const t of [got.diff, got.nor, got.arm]) if (t) { t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; } apply(capMat, got, 1, false); });
  return { count, meters: runs.reduce((a, r) => a + r.hs.length * STEP, 0) };
}
