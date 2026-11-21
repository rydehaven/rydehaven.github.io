// bike.js — Three.js wrapper for the generated road bike: meshes, wheel spin and cadence.
import * as THREE from 'three';
import { bikeParts, BIKE } from './bikegen.js';

const MAT = {
  carbon: { color: 0x0b0b0d, roughness: 0.32, metalness: 0.1 },
  metal: { color: 0x8d9095, roughness: 0.35, metalness: 0.8 },
  rubber: { color: 0x141414, roughness: 0.9, metalness: 0 },
  tape: { color: 0x111113, roughness: 0.75, metalness: 0 },
  chrome: { color: 0xb8bcc2, roughness: 0.3, metalness: 0.7 },
};

export function buildBike({ paint = 0xd71e28, frame = 'aero', wheels = 'deep' } = {}) {
  const mats = Object.fromEntries(Object.entries(MAT).map(([k, v]) => [k, new THREE.MeshStandardMaterial(v)]));
  // the road ribbon is drawn with a depth offset so it beats the terrain; tyres get a stronger one so the road never eats them
  Object.assign(mats.rubber, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  mats.paint = new THREE.MeshStandardMaterial({ color: paint, roughness: 0.28, metalness: 0.25 });
  const toGroup = (part) => {
    const g = new THREE.Group();
    for (const [m, d] of Object.entries(part.geo)) {
      if (!d.idx.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(d.nor, 3));
      geo.setIndex(d.idx); geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mats[m]); mesh.castShadow = true; g.add(mesh);
    }
    g.position.set(...part.pivot);
    return g;
  };
  const P = bikeParts({ frame, wheels }), root = new THREE.Group(), G = {};
  for (const k of Object.keys(P)) { G[k] = toGroup(P[k]); root.add(G[k]); }
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
    // speed m/s; pedaling false = coasting (cranks stop, wheels keep turning)
    update(dt, speed, pedaling = true, cadence = null) {
      const w = speed / BIKE.W;                                   // wheel rad/s
      G.wheelF.rotation.x += w * dt; G.wheelR.rotation.x += w * dt;
      // pick a "gear" so cadence sits near 88 rpm (9.2 rad/s), within a real 50/34 x 11-30 range
      const target = THREE.MathUtils.clamp(w / 9.2, 34 / 30, 50 / 11) / (34 / 30) * (34 / 30);
      ratio += (target - ratio) * Math.min(1, dt * 1.5);          // shift smoothly
      if (cadence !== null) { if (cadence > 5) setCrank(crank + (cadence / 60) * Math.PI * 2 * dt); }   // real cadence from the trainer
      else if (pedaling && speed > 0.3) setCrank(crank + (w / ratio) * dt);
    },
    setCrank,
  };
}
