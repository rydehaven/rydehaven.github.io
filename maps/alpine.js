// maps/alpine.js — MOUNTAIN MAP: valley start -> hairpin climb up the south face -> balcony road
// along the contour near the top -> faster hairpin descent -> valley road home.
import { hash, fbm, ridged, smooth, gauss } from '../js/noise.js';

export const ALPINE = (() => {
  const world = {
    size: 3600,        // terrain is size x size meters, centered on 0,0
    cells: 900,        // grid cells per side (4 m spacing)
    chunks: 9,         // terrain split into chunks x chunks meshes
    ds: 1,             // route sample spacing (m)
    roadHalf: 2.5,     // half road width (m) -> 5 m road, like a French col road
    shoulder: 0,       // no gravel strip: grass meets the asphalt
    corridor: 34,      // distance over which terrain blends back to natural (m)
    maxGrade: 0.12,    // steepest grade allowed anywhere on the route
    rockFrom: 520,     // bare rock starts here (m)
    snowFrom: 690,     // snow starts here (m)
  };

  // The climb: tweak these to change the character of the mountain road.
  const CLIMB = {
    up:   { xL: -1150, xR: -480, z0: -1100, grade: 0.058, radius: 16 }, // the big climb (west)
    down: { xL: 480,  xR: 1150, z0: -1100, grade: 0.072, radius: 16 },  // the descent (east)
    topHeight: 560,    // where the hairpins stop and the balcony road starts (m)
    valleyZ: -1290,    // valley road line
  };
  // Natural landscape before the road is carved in.
  function massif(x, z, scale, seed) {
    // domain-warped fbm for the big shapes + ridged detail for crests
    const wx = 0.9 * fbm(x / (scale * 1.6), z / (scale * 1.6), 3, seed + 40), wz = 0.9 * fbm(x / (scale * 1.6) + 7, z / (scale * 1.6), 3, seed + 41);
    const m = fbm(x / scale + wx, z / scale + wz, 5, seed);
    const r = ridged(x / (scale * 0.55) + wz, z / (scale * 0.55) + wx, 3, seed + 3);
    return smooth(0.3, 0.78, m) * (0.55 + 0.45 * r);
  }
  function naturalHeight(x, z) {
    // south face: valley floor (z < -1050) rising to a crest around z = 400
    const t = (z + 1050) / 1450, lin = Math.min(1, Math.max(0, t));
    const north = smooth(330, 800, z + 900 * (fbm(x / 600, 3.3, 3, 50) - 0.5));        // wavy crest line
    let h = 640 * (0.6 * lin + 0.4 * smooth(0, 1, t));
    h += 12 * fbm(x / 260, z / 260, 4, 1);
    h += 70 * (fbm(x / 380, z / 520, 4, 11) - 0.5) * lin * (1 - north);   // spurs and gullies on the face
    // high peaks behind the crest
    h += north * (140 + 820 * massif(x, z, 850, 4));
    h += 300 * gauss(x, z, -700, 950, 450) + 280 * gauss(x, z, 720, 1000, 420);
    // walls closing the valley (south) and the sides (east/west)
    h += smooth(-1430, -1780, z + 650 * (fbm(x / 520, 9.1, 3, 51) - 0.5)) * (180 + 420 * massif(x + 3000, z, 500, 9));
    h += smooth(1330, 1780, Math.abs(x) + 1000 * (fbm(z / 520, 4.7 + Math.sign(x), 3, 52) - 0.5)) * (200 + 450 * massif(x, z + 3000, 520, 12));
    return h;
  }

  // ---------- route construction ----------
  const H = naturalHeight;
  // distance up the slope (dz) so that a leg from (xa,za) to (xb, za+dz) climbs at `grade`
  function legDz(xa, za, xb, grade) {
    let lo = 2, hi = 800;
    for (let k = 0; k < 40; k++) {
      const m = (lo + hi) / 2, len = Math.hypot(xb - xa, m), rise = H(xb, za + m) - H(xa, za);
      if (rise > grade * len) hi = m; else lo = m;
    }
    return (lo + hi) / 2;
  }
  function arc(pts, xb, zEnd, out, r) { // 180° hairpin bulging out past the leg end
    const zc = zEnd + r;
    for (let k = 1; k <= 14; k++) { const th = -Math.PI / 2 + (Math.PI * k) / 14; pts.push([xb + out * r * Math.cos(th), zc + r * Math.sin(th)]); }
    return zEnd + 2 * r;
  }
  // Hairpin ladder generated bottom -> top. lastOut = heading (+1 east / -1 west) wanted at the top.
  function ladder({ xL, xR, z0, grade, radius }, startLeft, topY, lastOut) {
    const pts = []; let x = startLeft ? xL : xR, z = z0, hairpins = 0;
    pts.push([x, z]);
    let goRight = startLeft;
    for (let guard = 0; guard < 60; guard++) {
      // hairpins don't line up in a column: jitter each end by up to ±90 m
      const jit = 180 * (hash(guard, xL | 0, 77) - 0.5);
      const xb = (goRight ? xR : xL) + jit, out = goRight ? 1 : -1, dz = legDz(x, z, xb, grade), zEnd = z + dz;
      const bow = 12 + 26 * hash(guard, 5, 91);           // legs curve instead of running ruler-straight
      const n = Math.ceil(Math.hypot(xb - x, dz) / 20);
      for (let i = 1; i <= n; i++) { const t = i / n; pts.push([x + (xb - x) * t, z + dz * t + bow * Math.sin(Math.PI * t)]); }
      if (H(xb, zEnd) >= topY) {
        let zTop = zEnd;
        if (out !== lastOut) { zTop = arc(pts, xb, zEnd, out, radius); hairpins++; }
        return { pts, top: [xb, zTop], hairpins };
      }
      z = arc(pts, xb, zEnd, out, radius); hairpins++; x = xb; goRight = !goRight;
    }
    throw new Error('ladder did not reach the top');
  }
  // z where the natural height equals y at a given x (the slope rises with z)
  function contourZ(x, y) {
    let lo = -1050, hi = 700;
    for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (H(x, m) < y) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }

  function routePolyline(C = CLIMB) {
    const up = ladder(C.up, true, C.topHeight, +1);       // climb: arrive at the top heading east
    const dn = ladder(C.down, false, C.topHeight, -1);    // descent built as a climb, then reversed
    const down = dn.pts.slice().reverse();
    const [ax, az] = up.top, [bx, bz] = dn.top, ha = H(ax, az), hb = H(bx, bz);
    const traverse = [];
    const steps = Math.ceil((bx - ax) / 25);
    for (let i = 1; i < steps; i++) {               // balcony road following the contour
      const x = ax + ((bx - ax) * i) / steps, y = ha + (hb - ha) * (i / steps);
      traverse.push([x, contourZ(x, y)]);
    }
    const V = C.valleyZ, wig = (x) => 18 * Math.sin(x / 140) + 10 * Math.sin(x / 61 + 1);
    const valleyWest = [], valleyEast = [];
    for (let x = 0; x >= -1000; x -= 25) valleyWest.push([x, V + wig(x)]);
    valleyWest.push([-1100, V + 20], [-1170, V + 70], [-1200, V + 120], [-1170, -1140]);
    valleyEast.push([1170, -1140], [1200, V + 120], [1170, V + 70], [1100, V + 20]);
    for (let x = 1000; x > 0; x -= 25) valleyEast.push([x, V + wig(x)]);
    return {
      pts: [...valleyWest, ...up.pts, ...traverse, ...down, ...valleyEast],
      hairpins: up.hairpins + dn.hairpins, climbHairpins: up.hairpins,
    };
  }


  return {
    id: 'alpine',
    name: 'Col des Pins',
    blurb: 'Hairpin climb up a south face, a balcony road under snowy peaks, then a fast descent.',
    world: { ...world, cells: world.cells, trees: { count: 14000, treeLine: 470, minH: 7, maxH: 16 } },
    naturalHeight,
    routePolyline: () => routePolyline(),
    textures: { road: 'asphalt_02', grass: 'rocky_terrain_02' },
    sky: { color: 0xb7d3e6, fogNear: 500, fogFar: 4200 },
  };
})();
