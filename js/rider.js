// rider.js — the Mixamo rider as a THREE.SkinnedMesh, posed on the bike every frame by riderpose.js,
// wearing the painted kit and the generated helmet.
import * as THREE from 'three';
import { makeRiderPose } from './riderpose.js';
import { BIKE, helmetGeometry } from './bikegen.js';

const RIDER_FILES = { json: 'rider/rider.json', bin: 'rider/rider.bin', diff: 'textures/rider/kit_diff.jpg', nor: 'textures/rider/kit_nor.jpg' };
const HELMET_FIT = { pos: [0, 0.095, 0.035], tilt: 0.55 };                    // on the Head bone, fitted to the Mannequin skull

async function riderBytes(url) {                                              // Safari can't fetch data: URLs reliably
  if (url.startsWith('data:')) { const s = atob(url.slice(url.indexOf(',') + 1)), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b.buffer; }
  const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status);
  if (url.endsWith('.b64.txt')) { const s = atob((await r.text()).trim()), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b.buffer; } // hosts that only serve text
  return r.arrayBuffer();
}

export async function loadRider({ helmetColor = 0xf2f3f5, anisotropy = 4 } = {}) {
  const rig = JSON.parse(new TextDecoder().decode(await riderBytes(RIDER_FILES.json)));
  const buf = await riderBytes(RIDER_FILES.bin), nv = rig.vertices, nt = rig.triangles;
  let o = 0;
  const F = (k) => { const a = new Float32Array(buf, o, k); o += k * 4; return a; };
  const pos = F(nv * 3), nor = F(nv * 3), uv = F(nv * 2), sw = F(nv * 4);
  const si = new Uint16Array(buf, o, nv * 4); o += nv * 8;
  const idx = new Uint32Array(buf, o, nt * 3);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));

  const tl = new THREE.TextureLoader();
  const load = (u, srgb) => new Promise((res, rej) => tl.load(u, (t) => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = anisotropy; res(t); }, undefined, rej));
  const [map, normalMap] = await Promise.all([load(RIDER_FILES.diff, true), load(RIDER_FILES.nor, false)]);
  const mat = new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.62, metalness: 0 });

  // skeleton straight from the converted rig
  const bones = rig.bones.map((b) => { const bn = new THREE.Bone(); bn.name = b.name; new THREE.Matrix4().fromArray(b.matrix).decompose(bn.position, bn.quaternion, bn.scale); return bn; });
  rig.bones.forEach((b, i) => { if (b.parent >= 0) bones[b.parent].add(bones[i]); });
  const inv = rig.inverseBind.map((m) => new THREE.Matrix4().fromArray(m));
  const mesh = new THREE.SkinnedMesh(geo, mat);
  const root = bones[rig.bones.findIndex((b) => b.parent < 0)];
  mesh.add(root); mesh.bind(new THREE.Skeleton(bones, inv), new THREE.Matrix4());
  mesh.castShadow = true; mesh.frustumCulled = false;                       // bounds follow the bike group instead

  // helmet on the head bone
  const H = helmetGeometry(), hmats = {
    shell: new THREE.MeshStandardMaterial({ color: helmetColor, roughness: 0.3, metalness: 0.05 }),
    vents: new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.8 }),
    straps: new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.85 }),
  };
  const helmet = new THREE.Group();
  for (const [k, d] of Object.entries(H)) {
    if (!d.idx.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(d.nor, 3)); g.setIndex(d.idx);
    const m = new THREE.Mesh(g, hmats[k]); m.castShadow = true; helmet.add(m);
  }
  helmet.position.set(...HELMET_FIT.pos); helmet.rotation.x = HELMET_FIT.tilt;
  bones[rig.bones.findIndex((b) => b.name === 'Head')].add(helmet);

  const R = makeRiderPose(rig, BIKE);
  const group = new THREE.Group(); group.scale.setScalar(R.scale); group.add(mesh);
  function update(crank, t) {
    const p = R.pose(crank, t);
    for (let i = 0; i < bones.length; i++) { const a = p.quats[i]; bones[i].quaternion.set(a[0], a[1], a[2], a[3]); }
    root.position.set(p.hips[0], p.hips[1], p.hips[2]);
  }
  update(0.4, 0);
  return { group, mesh, helmet, update, materials: { kit: mat, ...hmats } };
}
