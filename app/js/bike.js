// bike.js — Three.js wrapper for the generated road bike: meshes, paint + RYDEHAVEN decal, wheel spin and cadence.
// Geometry is built once per frame/wheel combination and shared (the race field reuses it); materials are per bike.
import * as THREE from 'three';
import { bikeParts, BIKE, decalSpot } from './bikegen.js?v=76';
import { decalColor } from './kits.js?v=76';

const MAT = {
  carbon: { color: 0x0b0b0d, roughness: 0.32, metalness: 0.1 },
  metal: { color: 0x8d9095, roughness: 0.35, metalness: 0.8 },
  rubber: { color: 0x141414, roughness: 0.9, metalness: 0 },
  tape: { color: 0x111113, roughness: 0.75, metalness: 0 },
  chrome: { color: 0xb8bcc2, roughness: 0.3, metalness: 0.7 },
};

const GEO = new Map();                                    // "aero/deep" -> { part: { pivot, geos: [[material, geometry]] } }
function partsFor(frame, wheels) {
  const key = frame + '/' + wheels;
  if (GEO.has(key)) return GEO.get(key);
  const P = bikeParts({ frame, wheels }), out = {};
  for (const [k, part] of Object.entries(P)) {
    out[k] = { pivot: part.pivot, geos: [] };
    for (const [m, d] of Object.entries(part.geo)) {
      if (!d.idx.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(d.nor, 3));
      geo.setIndex(d.idx); geo.computeBoundingSphere();
      out[k].geos.push([m, geo]);
    }
  }
  GEO.set(key, out);
  return out;
}

// the wordmark, drawn once: white letters on transparent (the material colour tints it)
let DECAL_TEX = null;
function decalTexture() {
  if (DECAL_TEX) return DECAL_TEX;
  const c = document.createElement('canvas'); c.width = 1024; c.height = 112;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.textAlign = 'center';
  let size = 104; g.font = `700 ${size}px "Space Grotesk", "Barlow", Arial, sans-serif`;
  const word = 'RYDEHAVEN';
  while (g.measureText(word).width > 980 && size > 40) { size -= 2; g.font = `700 ${size}px "Space Grotesk", "Barlow", Arial, sans-serif`; }
  if ('letterSpacing' in g) g.letterSpacing = '6px';
  g.fillText(word, 512, 60);
  DECAL_TEX = new THREE.CanvasTexture(c); DECAL_TEX.colorSpace = THREE.SRGBColorSpace; DECAL_TEX.anisotropy = 8;
  return DECAL_TEX;
}
// a flat strip just proud of each side of the down tube, letters running BB -> head tube on the drive side, head tube -> BB on the other
function decalMeshes(frame, mat) {
  const D = decalSpot(frame), out = [];
  const dir = [D.b[0] - D.a[0], D.b[1] - D.a[1], D.b[2] - D.a[2]], L = Math.hypot(...dir), d = dir.map((v) => v / L);
  const up = [0, d[2], -d[1]];                              // in the frame's plane, pointing up (towards the top tube)
  for (const side of [-1, 1]) {
    const xa = side * (D.halfA + 0.0011), xb = side * (D.halfB + 0.0011), h = D.h / 2;
    const P = (p, x, k) => [x, p[1] + up[1] * h * k, p[2] + up[2] * h * k];
    const pos = [...P(D.a, xa, -1), ...P(D.b, xb, -1), ...P(D.b, xb, 1), ...P(D.a, xa, 1)];
    const uv = side < 0 ? [0, 0, 1, 0, 1, 1, 0, 1] : [1, 0, 0, 0, 0, 1, 1, 1];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([side, 0, 0, side, 0, 0, side, 0, 0, side, 0, 0], 3));
    g.setIndex(side < 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
    out.push(new THREE.Mesh(g, mat));
  }
  return out;
}

export function buildBike({ paint = 0xd71e28, frame = 'aero', wheels = 'deep', decal = true } = {}) {
  const mats = Object.fromEntries(Object.entries(MAT).map(([k, v]) => [k, new THREE.MeshStandardMaterial(v)]));
  // the road ribbon is drawn with a depth offset so it beats the terrain; tyres get a stronger one so the road never eats them
  Object.assign(mats.rubber, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  mats.paint = new THREE.MeshPhysicalMaterial({ color: paint, roughness: 0.3, metalness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.12 });
  mats.decal = new THREE.MeshStandardMaterial({ map: decalTexture(), color: decalColor(paint), transparent: true, roughness: 0.35, metalness: 0.1, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });
  const P = partsFor(frame, wheels), root = new THREE.Group(), G = {};
  for (const [k, part] of Object.entries(P)) {
    const g = new THREE.Group();
    for (const [m, geo] of part.geos) { const mesh = new THREE.Mesh(geo, mats[m]); mesh.castShadow = true; g.add(mesh); }
    g.position.set(...part.pivot);
    G[k] = g; root.add(g);
  }
  if (decal) for (const m of decalMeshes(frame, mats.decal)) G.frame.add(m);
  let crank = 0.4, ratio = 2.6;
  function setCrank(a) {
    crank = a; G.crank.rotation.x = a;
    const c = Math.cos(a), s = Math.sin(a), bb = BIKE.BB, R = BIKE.CRANK;
    G.pedalR.position.set(-BIKE.PEDAL_X, bb[1] - s * R, bb[2] + c * R);
    G.pedalL.position.set(BIKE.PEDAL_X, bb[1] + s * R, bb[2] - c * R);
  }
  setCrank(crank);
  return {
    group: root, mats,
    get crank() { return crank; },
    setPaint(hex) { mats.paint.color.set(hex); mats.decal.color.set(decalColor(hex)); },
    // speed m/s; pedaling false = coasting (cranks stop, wheels keep turning)
    update(dt, speed, pedaling = true, cadence = null) {
      const w = speed / BIKE.W;                                   // wheel rad/s
      G.wheelF.rotation.x += w * dt; G.wheelR.rotation.x += w * dt;
      // pick a "gear" so cadence sits near 88 rpm (9.2 rad/s), within a real 50/34 x 11-30 range
      const target = THREE.MathUtils.clamp(w / 9.2, 34 / 30, 50 / 11) / (34 / 30) * (34 / 30);
      ratio += (target - ratio) * Math.min(1, dt * 1.5);          // shift smoothly
      if (cadence !== null) { if (cadence > 5) setCrank(crank + (cadence / 60) * Math.PI * 2 * dt); }   // real cadence from the trainer
      else if (pedaling && speed > 0.3) setCrank(crank + (w / ratio) * dt);
      else if (speed > 3) { const lv = Math.round(crank / Math.PI) * Math.PI; setCrank(crank + (lv - crank) * Math.min(1, dt * 3)); }   // coasting: pedals drift level
    },
    setCrank,
    dispose() { for (const m of Object.values(mats)) m.dispose(); },   // geometry is shared: never disposed here
  };
}
