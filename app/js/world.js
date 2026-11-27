// world.js — map-independent world generation (no Three.js). A MAP object (see maps/) supplies:
//   world settings, naturalHeight(x, z) and routePolyline() -> { pts: [[x, z], ...], hairpins }.
// The ROUTE is the source of truth: road mesh, terrain carving, props and ride physics read it.
import { fbm, smooth } from './noise.js?v=75';
export { fbm, smooth };

function circularSmooth(arr, win) {
  const n = arr.length, out = new Float64Array(n), h = win >> 1;
  let s = 0;
  for (let k = -h; k <= h; k++) s += arr[(k + n) % n];
  for (let i = 0; i < n; i++) {
    out[i] = s / (2 * h + 1);
    s += arr[(i + h + 1) % n] - arr[(i - h + n) % n];
  }
  return out;
}
function resampleClosed(P, step) {
  const cum = [0];
  for (let i = 1; i <= P.length; i++) { const a = P[i - 1], b = P[i % P.length]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const length = cum[cum.length - 1], n = Math.floor(length / step), ds = length / n;
  const x = new Float64Array(n), z = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const d = i * ds;
    while (cum[j + 1] < d) j++;
    const t = (d - cum[j]) / (cum[j + 1] - cum[j] || 1), a = P[j], b = P[(j + 1) % P.length];
    x[i] = a[0] + (b[0] - a[0]) * t; z[i] = a[1] + (b[1] - a[1]) * t;
  }
  return { x, z, n, ds, length };
}

export function buildRoute(map) {
  const W = map.world, naturalHeight = map.naturalHeight;
  const poly = map.routePolyline();
  // 1. resample at 2 m, round off corners (leg -> hairpin joins), resample at ds
  let r = resampleClosed(poly.pts, 2);
  let sx = r.x, sz = r.z;
  for (let p = 0; p < 3; p++) { sx = circularSmooth(sx, 9); sz = circularSmooth(sz, 9); }
  const pts = Array.from(sx, (v, i) => [v, sz[i]]);
  r = resampleClosed(pts, W.ds);
  const { n, ds, length } = r, x = new Float32Array(r.x), z = new Float32Array(r.z);
  // 2. elevation: follow the land, smoothed, gradient-limited, smoothed again
  let y = new Float64Array(n);
  if (map.elevation) {
    // designed profile: follow it exactly, only rounding the corners between segments
    for (let i = 0; i < n; i++) y[i] = map.elevation(i / n);
    y = circularSmooth(y, Math.round(30 / ds) | 1);
  } else {
    for (let i = 0; i < n; i++) y[i] = naturalHeight(x[i], z[i]);
    y = circularSmooth(y, Math.round(120 / ds) | 1);
  }
  const step = W.maxGrade * ds;
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 0; i < n; i++) { const p = y[(i - 1 + n) % n]; y[i] = Math.min(p + step, Math.max(p - step, y[i])); }
    for (let i = n - 1; i >= 0; i--) { const p = y[(i + 1) % n]; y[i] = Math.min(p + step, Math.max(p - step, y[i])); }
  }
  y = circularSmooth(y, Math.round((map.elevation ? 20 : 60) / ds) | 1);
  // 3. tangents + grade
  const fx = new Float32Array(n), fz = new Float32Array(n), grade = new Float32Array(n), yy = new Float32Array(y);
  let ascent = 0;
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n;
    const dx = x[b] - x[a], dz = z[b] - z[a], l = Math.hypot(dx, dz);
    fx[i] = dx / l; fz[i] = dz / l;
    grade[i] = (y[b] - y[a]) / (2 * ds);
    ascent += Math.max(0, y[(i + 1) % n] - y[i]);
  }
  return { n, ds, length, x, y: yy, z, fx, fz, grade, ascent, hairpins: poly.hairpins };
}

// Sample the route at any distance (wraps around the loop).
export function sampleRoute(R, dist) {
  const d = ((dist % R.length) + R.length) % R.length;
  const f = d / R.ds, i = Math.floor(f) % R.n, k = (i + 1) % R.n, t = f - Math.floor(f);
  const L = (a) => a[i] + (a[k] - a[i]) * t;
  const fx = L(R.fx), fz = L(R.fz), l = Math.hypot(fx, fz);
  return { d, x: L(R.x), y: L(R.y), z: L(R.z), fx: fx / l, fz: fz / l, grade: L(R.grade) };
}

// ---------- terrain ----------
export function buildTerrain(R, map) {
  const W = map.world, naturalHeight = map.naturalHeight;
  const N = W.cells + 1, sp = W.size / W.cells, half = W.size / 2;
  const height = new Float32Array(N * N), dist = new Float32Array(N * N);

  const CELL = 36, grid = new Map(), key = (cx, cz) => cx * 100000 + cz;
  for (let i = 0; i < R.n; i += 2) {
    const k = key(Math.floor(R.x[i] / CELL), Math.floor(R.z[i] / CELL));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  // flat road bed: ground sits just under the asphalt out to `inner`, then blends back to the land
  const inner = W.roadHalf + W.shoulder + (W.roadBedExtra ?? 1.0), drop = W.roadBedDrop ?? 0.08;
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const px = -half + ix * sp, pz = -half + iz * sp, idx = iz * N + ix;
      const nat = naturalHeight(px, pz);
      // Inverse-distance blend of every road segment in range, so terrain between
      // stacked hairpin legs at different heights stays continuous (no steps).
      let best = 1e9, wsum = 0, ysum = 0;
      const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
      for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
        const list = grid.get(key(cx + ox, cz + oz));
        if (!list) continue;
        for (const i of list) {
          const k = (i + 2) % R.n;
          const ax = R.x[i], az = R.z[i], bx = R.x[k] - ax, bz = R.z[k] - az;
          let t = ((px - ax) * bx + (pz - az) * bz) / (bx * bx + bz * bz);
          t = Math.max(0, Math.min(1, t));
          const d = Math.hypot(px - ax - bx * t, pz - az - bz * t);
          if (d >= W.corridor) continue;
          const ry = R.y[i] + (R.y[k] - R.y[i]) * t - drop;
          const w = 1 / (Math.max(d - inner, 0) + 0.3) ** 4;
          wsum += w; ysum += w * ry;
          if (d < best) best = d;
        }
      }
      dist[idx] = best;
      if (wsum > 0) {
        const cover = 1 - smooth(inner, W.corridor, best);
        height[idx] = nat + (ysum / wsum - nat) * cover;
      } else height[idx] = nat;
    }
  }
  // normals + splat weights (grass, dirt, rock, snow)
  const normal = new Float32Array(N * N * 3), splat = new Float32Array(N * N * 4);
  const Hg = (ix, iz) => height[Math.min(N - 1, Math.max(0, iz)) * N + Math.min(N - 1, Math.max(0, ix))];
  for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
    const idx = iz * N + ix;
    let nx = -(Hg(ix + 1, iz) - Hg(ix - 1, iz)) / (2 * sp), nz = -(Hg(ix, iz + 1) - Hg(ix, iz - 1)) / (2 * sp), ny = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    normal.set([nx, ny, nz], idx * 3);
    const px = -half + ix * sp, pz = -half + iz * sp, h = height[idx], slope = 1 - ny;
    const n1 = fbm(px / 45, pz / 45, 3, 3), n2 = fbm(px / 90, pz / 90, 3, 5);
    let snow = smooth(W.snowFrom, W.snowFrom + 90, h + 70 * (n1 - 0.5)) * (1 - smooth(0.28, 0.45, slope));
    const rs = W.rockSlope || [0.2, 0.38];
    let rock = Math.max(smooth(rs[0], rs[1], slope), smooth(W.rockFrom, W.rockFrom + 140, h + 60 * (n2 - 0.5)));
    rock = Math.min(1, rock) * (1 - snow);
    const vg = W.verge || [W.roadHalf + 0.1, W.roadHalf + 1.8], vs = W.vergeStrength ?? 0.6, dp = W.dirtPatches === undefined ? 0.8 : W.dirtPatches;
    let dirt = Math.min(1, vs * (1 - smooth(vg[0], vg[1], dist[idx])) + dp * smooth(0.62, 0.76, n2));
    dirt *= (1 - snow) * (1 - rock);
    splat.set([Math.max(0, 1 - snow - rock - dirt), dirt, rock, snow], idx * 4);
  }
  return { N, sp, half, height, dist, normal, splat };
}

// Bilinear height lookup (for props, camera, etc.)
export function heightAt(T, x, z) {
  const fx = (x + T.half) / T.sp, fz = (z + T.half) / T.sp;
  const ix = Math.max(0, Math.min(T.N - 2, Math.floor(fx))), iz = Math.max(0, Math.min(T.N - 2, Math.floor(fz)));
  const tx = fx - ix, tz = fz - iz, h = T.height, N = T.N;
  const a = h[iz * N + ix], b = h[iz * N + ix + 1], c = h[(iz + 1) * N + ix], d = h[(iz + 1) * N + ix + 1];
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}
export function gridIndex(T, x, z) {
  const ix = Math.max(0, Math.min(T.N - 1, Math.round((x + T.half) / T.sp)));
  const iz = Math.max(0, Math.min(T.N - 1, Math.round((z + T.half) / T.sp)));
  return iz * T.N + ix;
}

export function buildWorld(map) {
  const route = buildRoute(map);
  const terrain = buildTerrain(route, map);
  return { route, terrain };
}
