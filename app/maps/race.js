// maps/race.js — RACE CIRCUIT: a lap course built for real racing. Flat valley roads broken up by
// three short, hard climbs; the last climb crests ~1.9 km from the line, then a fast descent and a
// flat run-in to the finish. No pinch points: a wide 7 m road all the way round.
//
// Unlike the other maps, the ELEVATION PROFILE is designed by hand (PROFILE below) and the land is
// shaped around the road, so every climb is exactly as long and steep as written here.
import { fbm, smooth } from '../js/noise.js?v=76';

export const RACE = (() => {
  // ---- the lap, segment by segment: [length m, climb m, climb name or null] ----
  const PROFILE = [
    [300, 0, null],          // past the finish line
    [1900, 4, null],         // valley road
    [400, 20, 'Farmhouse Climb'], [300, 27, 'Farmhouse Climb'], [500, 30, 'Farmhouse Climb'], // 1.2 km @ 6.4%, 9% kick
    [1000, 5, null],         // plateau
    [1200, -66, null],       // sweeping descent
    [2000, 0, null],         // long exposed flat
    [200, 18, 'The Wall'], [200, 30, 'The Wall'], [200, 18, 'The Wall'],                                // 600 m @ 11%, 15% ramp
    [800, -56, null],        // fast descent
    [1500, 0, null],         // flat
    [400, 36, 'Double Trouble'], [300, 6, 'Double Trouble'], [400, 32, 'Double Trouble'],     // two kicks, 9% + 8%
    [1000, -86, null],       // descent toward the finish
    [900, -18, null],        // flat run-in (slightly downhill) to the line
  ];
  const BASE_Y = 20;
  const T = PROFILE.reduce((a, s) => a + s[0], 0);                    // 13,500 m per lap
  const net = PROFILE.reduce((a, s) => a + s[1], 0);                  // must close the loop
  if (Math.abs(net) > 0.5) PROFILE[PROFILE.length - 1][1] -= net;

  // climbs as distance ranges (meters into the lap)
  const climbs = [];
  { let d = 0, cur = null;
    for (const [len, rise, name] of PROFILE) {
      if (name) { if (!cur || cur.name !== name) { cur = { name, start: d, end: d + len, gain: 0 }; climbs.push(cur); } else cur.end = d + len; cur.gain += rise; }
      else cur = null;
      d += len;
    } }
  function profileY(d) {                                              // elevation at distance d (meters, 0..T)
    let acc = 0, y = BASE_Y;
    for (const [len, rise] of PROFILE) { if (d <= acc + len) return y + rise * ((d - acc) / len); acc += len; y += rise; }
    return y;
  }

  // ---- route shape: closed Catmull-Rom loop, scaled so its length matches the profile ----
  const RAW = [
    [-400, -1400], [400, -1450], [1000, -1250], [1200, -800], [800, -500], [1100, -150], [1500, 100],
    [1400, 650], [1000, 900], [600, 700], [300, 1000], [500, 1400], [0, 1550], [-500, 1350], [-800, 1500],
    [-1300, 1300], [-1450, 800], [-1100, 500], [-1400, 100], [-1500, -400], [-1100, -600], [-700, -350],
    [-400, -700], [-900, -1000], [-1100, -1300],
  ];
  const cr = (p0, p1, p2, p3, t) => { const t2 = t * t, t3 = t2 * t; return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3); };
  function loop(P) {
    const m = P.length, pts = [];
    for (let i = 0; i < m; i++) {
      const a = P[(i - 1 + m) % m], b = P[i], c = P[(i + 1) % m], e = P[(i + 2) % m];
      for (let k = 0; k < 80; k++) { const t = k / 80; pts.push([cr(a[0], b[0], c[0], e[0], t), cr(a[1], b[1], c[1], e[1], t)]); }
    }
    return pts;
  }
  const len = (pts) => { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += Math.hypot(b[0] - a[0], b[1] - a[1]); } return s; };
  const scale = T / len(loop(RAW)) * 1.0015;                         // tiny bump: the engine's corner smoothing shortens it a hair
  const PTS = loop(RAW.map(([x, z]) => [x * scale, z * scale]));
  let maxR = 0; for (const [x, z] of PTS) maxR = Math.max(maxR, Math.hypot(x, z));

  // ---- land shaped around the road: smoothed road heights + gentle hills ----
  // coarse grid of "base height" = Gaussian-weighted average of nearby road heights
  const size = Math.ceil((maxR + 450) / 100) * 200, half = size / 2, GS = 40, GN = Math.round(size / GS) + 1;
  const base = new Float32Array(GN * GN), near = new Float32Array(GN * GN), local = new Float32Array(GN * GN);
  {
    const samp = []; let acc = 0;
    for (let i = 0; i < PTS.length; i++) {
      const a = PTS[i], b = PTS[(i + 1) % PTS.length];
      if (i % 4 === 0) samp.push([a[0], a[1], profileY((acc / len(PTS)) * T)]);
      acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    // two scales blended smoothly: near the road the land follows the road (sigma 170 m),
    // further out it relaxes to a broad average of the whole course (sigma 650 m) — no cliffs or trenches
    const s1 = 2 * 170 * 170, s2 = 2 * 650 * 650, K = 0.03, s3 = 2 * 55 * 55;
    for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
      const x = -half + i * GS, z = -half + j * GS;
      let w1 = 0, y1 = 0, w2 = 1e-9, y2 = 0, w3 = 1e-12, y3 = 0, dmin = 1e9;
      for (const [sx, sz, sy] of samp) {
        const d2 = (x - sx) ** 2 + (z - sz) ** 2; if (d2 < dmin) dmin = d2;
        const a = Math.exp(-d2 / s1), b = Math.exp(-d2 / s2);
        w1 += a; y1 += a * sy; w2 += b; y2 += b * sy;
        const c = Math.exp(-d2 / s3); w3 += c; y3 += c * sy;          // road height right here
      }
      base[j * GN + i] = (y1 + K * y2) / (w1 + K * w2); near[j * GN + i] = Math.sqrt(dmin);
      local[j * GN + i] = w3 > 1e-6 ? y3 / w3 : base[j * GN + i];
    }
  }
  const grid = (A, x, z) => {
    const fx = Math.min(GN - 1.001, Math.max(0, (x + half) / GS)), fz = Math.min(GN - 1.001, Math.max(0, (z + half) / GS));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const a = A[j * GN + i], b = A[j * GN + i + 1], c = A[(j + 1) * GN + i], d = A[(j + 1) * GN + i + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  };
  // ---- real hills: a rounded hill over each climb's summit (the road crosses its shoulder), plus
  // big rolling hills out in the fields. Everything fades out right beside the road so the road isn't buried.
  const PL = len(PTS);
  function posAt(frac) { let acc = 0; for (let i = 0; i < PTS.length; i++) { const a = PTS[i], b = PTS[(i + 1) % PTS.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (acc + l >= frac * PL) { const t = (frac * PL - acc) / l; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; } acc += l; } return PTS[0]; }
  const HILLS = [];
  for (const c of climbs) {
    const [sx, sz] = posAt(c.end / T), [mx, mz] = posAt(((c.start + c.end) / 2) / T);
    HILLS.push({ x: sx, z: sz, amp: Math.max(45, c.gain * 0.85), r: 300 });           // crest: rounded hill rising both sides of the summit
    HILLS.push({ x: (sx + mx) / 2, z: (sz + mz) / 2, amp: Math.max(25, c.gain * 0.45), r: 420 }); // broad shoulder the climb goes up
  }
  { // field hills: on a lattice, only where the road is far away
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let gz = -half + 300; gz < half - 300; gz += 420) for (let gx = -half + 300; gx < half - 300; gx += 420) {
      const x = gx + (rnd() - 0.5) * 260, z = gz + (rnd() - 0.5) * 260;
      if (grid(near, x, z) > 320 && Math.hypot(x, z) < maxR + 50 && rnd() > 0.25) HILLS.push({ x, z, amp: 25 + rnd() * 45, r: 230 + rnd() * 170 });
    }
  }
  const [fx0, fz0] = PTS[0]; // the finish line

  function naturalHeight(x, z) {
    const dR = grid(near, x, z);
    const flat = 1 - smooth(260, 560, Math.hypot(x - fx0, z - fz0)); // 1 = flat plain around the start/finish
    const keep = 1 - flat;
    // land sits at road level for the first ~40 m beside the road, then relaxes to the wider landscape
    let h = grid(local, x, z) + (grid(base, x, z) - grid(local, x, z)) * smooth(40, 280, dR) * keep;
    const fade = smooth(30, 220, dR);                                    // hills and bumps rise away from the road
    let hills = 0;
    for (const k of HILLS) { const d2 = (x - k.x) ** 2 + (z - k.z) ** 2; if (d2 < 9 * k.r * k.r) hills += k.amp * Math.exp(-d2 / (2 * k.r * k.r)); }
    h += hills * fade * keep;
    h += 22 * (fbm(x / 420 + 3, z / 420 - 2, 4, 61) - 0.5) * fade * keep;            // rolling ground
    h += 3 * (fbm(x / 120, z / 120, 3, 62) - 0.5) * (0.5 + 0.5 * fade) * keep;      // small undulations
    const r = Math.hypot(x, z), rw = r + 700 * (fbm(x / 700, z / 700, 3, 63) - 0.5);
    h += smooth(maxR + 120, maxR + 420, rw) * (80 + 220 * fbm(x / 300 + 9, z / 300, 4, 64)) * keep;  // hills closing the horizon
    return h;
  }

  return {
    id: 'race',
    name: 'Highcrest Circuit',
    blurb: 'A race circuit: fast valley roads, three short brutal climbs, and a descent to a flat finish.',
    world: {
      size, cells: Math.round(size / 5), chunks: Math.round(size / 400), ds: 1,   // 5 m terrain grid keeps it light
      roadHalf: 3.5,     // 7 m road, no pinch points
      shoulder: 0,       // no gravel strip: grass meets the asphalt
      corridor: 16,      // blend distance from road edge back to the land
      maxGrade: 0.16,
      rockFrom: 9999, snowFrom: 9999,
      trees: { count: 14000, treeLine: 9999, minH: 8, maxH: 17 },
      verge: [3.6, 4.9], vergeStrength: 0.15, // just a hint of wear at the asphalt edge (ground grid is 5 m, so keep it subtle)
      dirtPatches: 0.08,  // almost no brown patches in the fields
      rockSlope: [0.42, 0.6], // rock only on really steep ground, so the hills stay green
    },
    // color grade per terrain layer: pushes the dry Poly Haven grass toward summer green
    tints: { grass: [0.95, 1.18, 0.85], dirt: [0.9, 1.0, 0.9], rock: [0.92, 1.05, 0.92] },
    naturalHeight,
    routePolyline: () => ({ pts: PTS, hairpins: 0 }),
    elevation: (frac) => profileY(frac * T),   // designed profile (frac = 0..1 around the lap)
    climbs: climbs.map((c) => ({ name: c.name, from: c.start / T, to: c.end / T, gain: Math.round(c.gain), len: c.end - c.start })),
    race: { laps: 5 },
    // cottages taken out for now. To bring them back, restore this list (see README / housegen.js):
    // { d: 5950, side: 1, off: 22, W: 7, L: 12, Hw: 3.0, pitch: 52, chimneys: 1, gable: 'stone', jitter: 4 },
    // { d: 6090, side: -1, off: 20, W: 6.5, L: 10, Hw: 2.8, pitch: 50, chimneys: 1, gable: 'wood', jitter: -6 },
    // { d: 6240, side: 1, off: 27, W: 7.5, L: 14, Hw: 3.2, pitch: 48, chimneys: 2, gable: 'stone', jitter: -3 },
    // { d: 6460, side: -1, off: 24, W: 6, L: 9, Hw: 2.85, pitch: 55, chimneys: 0, gable: 'wood', jitter: 8 },
    // { d: 6640, side: 1, off: 19, W: 7, L: 11, Hw: 3.0, pitch: 50, chimneys: 1, gable: 'stone', jitter: -5 },
    houses: [],
    houseTextures: { stone: 'castle_wall_slates', brick: 'medieval_red_brick', wood: 'roof_planks', thatch: 'reed_roof_03', ridge: 'reed_roof_03_ridge' },
    walls: { wall: 'fort_wall', cap: 'fort_trim', cutMin: 2.2, fillMin: 3 },   // only where the road really cuts in / sits up high
    finish: { barriersBefore: 300, barriersAfter: 120, flammeRouge: true },
    textures: { road: 'asphalt_01', grass: 'rocky_terrain_02', dirt: 'sparse_grass', rock: 'rocky_terrain_03' },
    // fields: rocky_terrain_02 gives stones, patches and variation; grass_ground adds fine grass up close
    detail: { texture: 'grass_ground', meters: 2.5, strength: 0.75 },
    sky: {
      color: 0xc4d9e6, fogNear: 700, fogFar: 4200,
      hdr: 'textures/sky/citrus_orchard_puresky_2k.hdr',   // Poly Haven Citrus Orchard (Pure Sky): sunrise, partly cloudy
      exposure: 1.0, sunIntensity: 2.0, sunColor: 0xffe2c0, // low warm sunrise light
      brightness: 0.42,  // sky background brightness (the photo is very bright; 1.0 looks washed-out white)
    },
  };
})();
