// maps/countryside.js — ROLLING COUNTRYSIDE: a ~10 km loop of short punchy rollers through
// farmland and pine woods, with a twisty inner section. No snow, gentle grades.
import { fbm, smooth, gauss } from '../js/noise.js?v=76';

export const COUNTRYSIDE = (() => {
  const world = {
    size: 3800, cells: 950, chunks: 10, ds: 1,
    roadHalf: 3,       // 6 m country road
    shoulder: 0,       // no gravel strip: grass meets the asphalt
    corridor: 30,
    maxGrade: 0.08,
    rockFrom: 9999,    // no bare-rock altitude band
    snowFrom: 9999,    // no snow
    trees: { count: 12000, treeLine: 9999, minH: 8, maxH: 17 },
    verge: [3.1, 4.4], vergeStrength: 0.15, // just a hint of wear at the asphalt edge
    dirtPatches: 0.08,                       // almost no brown patches in the fields
    rockSlope: [0.45, 0.68],                 // rock only on true cliffs, so the hills around the farmland stay green
  };

  function naturalHeight(x, z) {
    let h = 70 * fbm(x / 720 + 11, z / 720 - 4, 5, 31);          // broad rolling hills
    h += 22 * fbm(x / 230, z / 230, 4, 33);                       // short rollers
    h -= 35 * gauss(x, z, 250, 150, 520);                         // a shallow central valley
    const r = Math.hypot(x, z);
    // irregular hills closing the horizon (warped + broken up, so no visible ring)
    const rw = r + 900 * (fbm(x / 650, z / 650, 3, 35) - 0.5);
    h += smooth(1450, 1850, rw) * (90 + 260 * fbm(x / 320 + 5, z / 320, 4, 36));
    return h;
  }

  // Loop control points (x, z). Edit these to redraw the route (keep the loop from crossing itself).
  const POINTS = [
    [-1250, -700], [-900, -1150], [-300, -1200], [200, -1000], [700, -1250], [1200, -1000], [1300, -450],
    [1000, -100], [1150, 350], [1250, 800], [850, 1200], [300, 1050], [-150, 1250], [-650, 1150],
    [-1100, 900], [-1250, 450], [-800, 300], [-400, 550], [0, 350], [200, -50], [-100, -400],
    [-600, -250], [-1000, -350],
  ];
  const cr = (p0, p1, p2, p3, t) => {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
  function routePolyline() {
    const P = POINTS.map(([x, z]) => [x * 0.85, z * 0.85]), m = P.length, pts = [];
    for (let i = 0; i < m; i++) {
      const a = P[(i - 1 + m) % m], b = P[i], c = P[(i + 1) % m], d = P[(i + 2) % m];
      for (let k = 0; k < 60; k++) { const t = k / 60; pts.push([cr(a[0], b[0], c[0], d[0], t), cr(a[1], b[1], c[1], d[1], t)]); }
    }
    return { pts, hairpins: 0 };
  }

  return {
    id: 'countryside',
    name: 'Harvest Hills Loop',
    climbs: [
      { name: 'Church Hill', from: 0.8436, to: 0.8993 },
    ],
    blurb: 'Rolling farmland and pine woods: short punchy rollers and a twisty inner loop.',
    world,
    naturalHeight,
    routePolyline,
    textures: { road: 'asphalt_02', grass: 'rocky_terrain_02', dirt: 'sparse_grass', rock: 'rocky_terrain_03' },
    // farmland look: grass pushed toward summer green, fine real grass up close, any rock tinted to blend with the fields
    tints: { grass: [0.95, 1.2, 0.84], dirt: [0.9, 1.0, 0.9], rock: [0.9, 1.06, 0.9] },
    detail: { texture: 'grass_ground', meters: 2.5, strength: 0.8 },
    sky: { color: 0xc6dbe8, fogNear: 600, fogFar: 3600 },
  };
})();
