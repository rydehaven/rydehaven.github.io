// rider.js — the Mixamo rider as a THREE.SkinnedMesh, posed on the bike every frame by riderpose.js,
// wearing the painted kit (recoloured per kit in the shader) and the downloaded helmet.
// The body can be reshaped to a real person's build: setBuild(cm, kg) thickens or slims the torso and limbs,
// and the caller scales the whole rider + bike by height (a taller rider rides a bigger bike).
// Files are fetched and parsed ONCE; every rider (you and the race field) shares them.
import * as THREE from 'three';
import { makeRiderPose } from './riderpose.js?v=75';
import { BIKE, helmetGeometry } from './bikegen.js?v=75';
import { KITS } from './kits.js?v=75';

const RIDER_FILES = { json: 'rider/rider.json', bin: 'rider/rider.bin', helmet: 'rider/helmet.bin', diff: 'textures/rider/kit_diff.jpg', nor: 'textures/rider/kit_nor.jpg' };
// Helmet: "Cycle Helmet" by markchester (Sketchfab, CC BY 4.0), converted by scripts/helmet_convert.py. Credited on the Credits page.
const HELMET_FIT = { pos: [0, 0.14, 0.03], tilt: 0.09, scale: [1.08, 1.08, 1.0] };   // helmet model -> Head bone space (metres)
export const REF_CM = 178, REF_KG = 72;                                        // the model's own build

function parseHelmet(buf) {                                                   // see helmet_convert.py for the layout
  const dv = new DataView(buf); let o = 4; const n = dv.getUint32(o, true); o += 4; const G = {};
  for (let g = 0; g < n; g++) {
    const nl = dv.getUint32(o, true); o += 4; const name = new TextDecoder().decode(new Uint8Array(buf, o, nl)); o += nl + ((4 - nl % 4) % 4);
    const nv = dv.getUint32(o, true), ni = dv.getUint32(o + 4, true); o += 8;
    const pos = new Float32Array(buf, o, nv * 3); o += nv * 12;
    const nb = new Int8Array(buf, o, nv * 3); o += nv * 3 + ((4 - (nv * 3) % 4) % 4);
    const idx = new Uint32Array(buf, o, ni); o += ni * 4;
    const nor = new Float32Array(nv * 3); for (let i = 0; i < nor.length; i++) nor[i] = nb[i] / 127;
    G[name] = { pos, nor, idx };
  }
  return G;
}

async function riderBytes(url) {                                              // Safari can't fetch data: URLs reliably
  if (url.startsWith('data:')) { const s = atob(url.slice(url.indexOf(',') + 1)), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b.buffer; }
  const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status);
  if (url.endsWith('.b64.txt')) { const s = atob((await r.text()).trim()), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b.buffer; } // hosts that only serve text
  return r.arrayBuffer();
}

// ---------- shared assets: loaded once ----------
let ASSETS = null;
function assets(anisotropy) {
  if (ASSETS) return ASSETS;
  ASSETS = (async () => {
    const rig = JSON.parse(new TextDecoder().decode(await riderBytes(RIDER_FILES.json)));
    const buf = await riderBytes(RIDER_FILES.bin), nv = rig.vertices, nt = rig.triangles;
    let o = 0;
    const F = (k) => { const a = new Float32Array(buf, o, k); o += k * 4; return a; };
    const pos = F(nv * 3), nor = F(nv * 3), uv = F(nv * 2), sw = F(nv * 4);
    const si = new Uint16Array(buf, o, nv * 4); o += nv * 8;
    const idx = new Uint32Array(buf, o, nt * 3);
    const tl = new THREE.TextureLoader();
    const load = (u, srgb) => new Promise((res, rej) => tl.load(u, (t) => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = anisotropy; res(t); }, undefined, rej));
    const [map, normalMap, helmetBuf] = await Promise.all([load(RIDER_FILES.diff, true), load(RIDER_FILES.nor, false), riderBytes(RIDER_FILES.helmet)]);
    const helmet = parseHelmet(helmetBuf);
    const body = analyseBody(rig, pos, sw, si);
    const pose = makeRiderPose(rig, BIKE);                                     // the fit to the bike is the same for everyone
    const liner = helmetGeometry({ shell: false });
    return { rig, nv, pos, nor, uv, sw, si, idx, map, normalMap, helmet, body, pose, liner };
  })();
  ASSETS.catch(() => { ASSETS = null; });
  return ASSETS;
}

// ---------- body build: per-vertex "how to thicken this bit" ----------
// Each vertex moves away from the bone(s) it follows. Torso bones push out round a vertical axis (more at the belly),
// limb bones push out from the bone's own line. Factors grow with BMI relative to the model (≈22.7).
const TORSO = { Hips: 1, Spine: 1, Spine1: 1, Spine2: 1, LeftShoulder: 0.5, RightShoulder: 0.5 };
const LIMB = { LeftUpLeg: ['LeftLeg', 0.95], RightUpLeg: ['RightLeg', 0.95], LeftLeg: ['LeftFoot', 0.6], RightLeg: ['RightFoot', 0.6],
  LeftArm: ['LeftForeArm', 0.85], RightArm: ['RightForeArm', 0.85], LeftForeArm: ['LeftHand', 0.5], RightForeArm: ['RightHand', 0.5], Neck: ['Head', 0.6] };
const UPPER = new Set(['Spine', 'Spine1', 'Spine2', 'LeftShoulder', 'RightShoulder', 'Neck']), SLEEVE = new Set(['LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm']);
const SHORTS = new Set(['Hips', 'LeftUpLeg', 'RightUpLeg']);
export function analyseBody(rig, pos, sw, si) {
  const names = rig.bones.map((b) => b.name), nb = names.length, nv = rig.vertices;
  const bpos = rig.inverseBind.map((m) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(m).invert()));
  const kind = new Int8Array(nb), expo = new Float32Array(nb), seg = [];
  names.forEach((n, i) => { if (TORSO[n]) { kind[i] = 1; expo[i] = TORSO[n]; } else if (LIMB[n]) { kind[i] = 2; expo[i] = LIMB[n][1]; seg[i] = [bpos[i], bpos[names.indexOf(LIMB[n][0])]]; } });
  // displacement per vertex for a girth factor of e (=2.718): dir * (offset), blended over the skin weights
  const dirT = new Float32Array(nv * 3), part = new Float32Array(nv), p = new THREE.Vector3(), q = new THREE.Vector3(), ab = new THREE.Vector3();
  const zc = bpos[names.indexOf('Spine')].z;
  for (let v = 0; v < nv; v++) {
    p.fromArray(pos, v * 3);
    let dx = 0, dy = 0, dz = 0, best = -1, bw = -1;
    for (let k = 0; k < 4; k++) {
      const w = sw[v * 4 + k], b = si[v * 4 + k]; if (w > bw) { bw = w; best = b; }
      if (w <= 0 || !kind[b]) continue;
      if (kind[b] === 1) { const front = p.z > zc ? 1.35 : 0.7; dx += w * expo[b] * p.x; dz += w * expo[b] * (p.z - zc) * front; }
      else { const [a, c] = seg[b]; ab.subVectors(c, a); const t = Math.max(0, Math.min(1, q.subVectors(p, a).dot(ab) / ab.lengthSq())); q.copy(a).addScaledVector(ab, t); q.subVectors(p, q).multiplyScalar(w * expo[b]); dx += q.x; dy += q.y; dz += q.z; }
    }
    dirT[v * 3] = dx; dirT[v * 3 + 1] = dy; dirT[v * 3 + 2] = dz;
    const n = names[best];
    part[v] = SLEEVE.has(n) ? 3 : UPPER.has(n) || (n === 'Hips' && p.y > 1.05) ? 1 : SHORTS.has(n) ? 0 : 2;
  }
  return { dirT, part };
}
// The rider always looks like a fit cyclist: the shape follows your build only within a narrow, athletic range
// (nobody's rider looks very heavy or very thin). Your real weight still drives the physics (climbing, drag).
export function buildFactor(cm, kg) {                          // 1 = the model's build; 0.9 lean … 1.12 solid
  const bmi = kg / (cm / 100) ** 2, ref = REF_KG / (REF_CM / 100) ** 2;
  return Math.max(0.9, Math.min(1.12, Math.pow(bmi / ref, 0.75)));
}
export const heightScale = (cm) => Math.max(0.86, Math.min(1.16, cm / REF_CM));

// ---------- kit shader: recolour the painted kit (black kit → jersey/shorts colours + pattern, teal → accent, white → socks) ----------
const col = (h) => new THREE.Color(h);
function kitMaterial(A) {
  const mat = new THREE.MeshStandardMaterial({ map: A.map, normalMap: A.normalMap, roughness: 0.62, metalness: 0 });
  const U = { kJersey: { value: col(0x11141c) }, kShorts: { value: col(0x0b0b0e) }, kAccent: { value: col(0x2ec4b6) }, kSocks: { value: col(0xffffff) }, kP2: { value: col(0x2ec4b6) }, kPattern: { value: 1 } };
  mat.userData.kit = U;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float kitPart;\nvarying float vPart;\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPart = kitPart; vBind = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying float vPart; varying vec3 vBind;
uniform vec3 kJersey, kShorts, kAccent, kSocks, kP2; uniform float kPattern;
vec3 jerseyAt(vec3 b) {
  int pt = int(kPattern + 0.5);
  if (pt == 2) return mix(kJersey, kP2, step(0.5, fract(b.y * 11.0)));                                   // hoops
  if (pt == 3) return mix(kJersey, kP2, 1.0 - smoothstep(0.045, 0.055, abs(b.y - 1.22 - 0.85 * b.x) * 0.76)); // sash
  if (pt == 4) return b.x < 0.0 ? kJersey : kP2;                                                         // split
  if (pt == 6) return mix(kJersey, kP2, smoothstep(1.1, 1.5, b.y));                                     // fade
  if (pt == 7) return mix(kJersey, kP2, step(0.86, fract(b.x * 18.0)));                                // pinstripes
  return kJersey;
}`).replace('#include <map_fragment>', `#include <map_fragment>
{
  vec3 t = diffuseColor.rgb; float mx = max(t.r, max(t.g, t.b)), mn = min(t.r, min(t.g, t.b));
  float shade = clamp(mix(1.0, (t.r + t.g + t.b) / 0.026, 0.3), 0.7, 1.3);
  bool teal0 = t.g > 0.25 && t.r < 0.16 && t.b > 0.2, skin = t.r > t.g * 1.22 && t.r > t.b * 1.5 && t.r > 0.1, dark = (mx < 0.075 && mx - mn < 0.03) || ((vPart < 1.5 || vPart > 2.5) && !skin && !teal0), teal = t.g > 0.25 && t.r < 0.16 && t.b > 0.2, white = mn > 0.45 && mx - mn < 0.16;
  int pt = int(kPattern + 0.5);
  if (dark && vPart < 0.5) diffuseColor.rgb = kShorts * shade;
  else if (dark && vPart > 0.5 && vPart < 1.5) diffuseColor.rgb = jerseyAt(vBind) * shade;
  else if (dark && vPart > 2.5) diffuseColor.rgb = jerseyAt(vBind) * shade;
  else if (teal) diffuseColor.rgb = (vPart > 0.5 && vPart < 1.5) ? (pt == 1 ? kP2 : jerseyAt(vBind)) : kAccent;
  else if (white && vPart > 1.5 && vPart < 2.5) diffuseColor.rgb = kSocks * (t.r + t.g + t.b) / 2.5;
}`);
  };
  mat.customProgramCacheKey = () => 'rydehaven-kit';
  return mat;
}
const PATTERN_ID = { solid: 0, band: 1, hoops: 2, sash: 3, split: 4, fade: 6, stripes: 7 };

export async function loadRider({ helmetColor = 0xf2f3f5, anisotropy = 4, kit = null, cm = REF_CM, kg = REF_KG } = {}) {
  const A = await assets(anisotropy);
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(new Float32Array(A.pos), 3);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('normal', new THREE.BufferAttribute(A.nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(A.uv, 2));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(A.sw, 4));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(A.si, 4));
  geo.setAttribute('kitPart', new THREE.BufferAttribute(A.body.part, 1));
  geo.setIndex(new THREE.BufferAttribute(A.idx, 1));
  const mat = kitMaterial(A);

  // skeleton straight from the converted rig
  const rig = A.rig;
  const bones = rig.bones.map((b) => { const bn = new THREE.Bone(); bn.name = b.name; new THREE.Matrix4().fromArray(b.matrix).decompose(bn.position, bn.quaternion, bn.scale); return bn; });
  rig.bones.forEach((b, i) => { if (b.parent >= 0) bones[b.parent].add(bones[i]); });
  const inv = rig.inverseBind.map((m) => new THREE.Matrix4().fromArray(m));
  const mesh = new THREE.SkinnedMesh(geo, mat);
  const root = bones[rig.bones.findIndex((b) => b.parent < 0)];
  mesh.add(root); mesh.bind(new THREE.Skeleton(bones, inv), new THREE.Matrix4());
  mesh.castShadow = true; mesh.frustumCulled = false;                       // bounds follow the bike group instead

  // helmet on the head bone: the downloaded model, plus a dark foam liner and chin straps fitted to the head
  const hmats = {
    shell: new THREE.MeshStandardMaterial({ color: helmetColor, roughness: 0.32, metalness: 0.05 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0f0f11, roughness: 0.6 }),
    dial: new THREE.MeshStandardMaterial({ color: 0x2ec4b6, roughness: 0.4 }),
    visor: new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.08, metalness: 0.4, transparent: true, opacity: 0.88 }),
    straps: new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.85 }),
  };
  const mk = (d, m) => { const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.pos instanceof Float32Array ? d.pos : new Float32Array(d.pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(d.nor instanceof Float32Array ? d.nor : new Float32Array(d.nor), 3));
    g.setIndex(new THREE.BufferAttribute(d.idx instanceof Uint32Array ? d.idx : new Uint32Array(d.idx), 1));
    const me = new THREE.Mesh(g, m); me.castShadow = true; return me; };
  const head = bones[rig.bones.findIndex((b) => b.name === 'Head')];
  const helmet = new THREE.Group();
  for (const [k, d] of Object.entries(A.helmet)) if (d.idx.length) helmet.add(mk(d, hmats[k] || hmats.black));
  helmet.position.set(...HELMET_FIT.pos); helmet.rotation.x = HELMET_FIT.tilt; helmet.scale.set(...HELMET_FIT.scale);
  head.add(helmet);
  head.add(mk(A.liner.vents, hmats.black), mk(A.liner.straps, hmats.straps));

  const R = A.pose;
  const group = new THREE.Group(); group.scale.setScalar(R.scale); group.add(mesh);
  function update(crank, t, style) {
    const p = R.pose(crank, t, style);
    for (let i = 0; i < bones.length; i++) { const a = p.quats[i]; bones[i].quaternion.set(a[0], a[1], a[2], a[3]); }
    root.position.set(p.hips[0], p.hips[1], p.hips[2]);
  }
  // body shape from height + weight (the caller scales rider + bike for height)
  function setBuild(cmV, kgV) {
    const f = buildFactor(cmV, kgV), arr = posAttr.array, d = A.body.dirT, src = A.pos;
    const k = Math.log(f);                                                     // girth factor per unit exponent
    for (let i = 0; i < arr.length; i++) arr[i] = src[i] + d[i] * k;
    posAttr.needsUpdate = true;
    return f;
  }
  function setKit(k) {
    const U = mat.userData.kit;
    U.kJersey.value.set(k.jersey); U.kShorts.value.set(k.shorts); U.kAccent.value.set(k.accent); U.kSocks.value.set(k.socks); U.kP2.value.set(k.p2);
    U.kPattern.value = PATTERN_ID[k.pattern] ?? 0;
    hmats.shell.color.set(k.helmet); hmats.dial.color.set(k.accent);
  }
  setBuild(cm, kg);
  setKit(kit || { ...KITS[0], helmet: helmetColor });
  update(0.4, 0);
  return { group, mesh, helmet, update, setBuild, setKit, materials: { kit: mat, ...hmats } };
}
