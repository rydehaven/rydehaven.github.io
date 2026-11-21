// houses.js — turns housegen.js output into Three.js meshes with the map's Poly Haven textures.
import * as THREE from 'three';
import { houseMeshes, HOUSE_MATS } from './housegen.js';

export function buildHouses({ scene, layout, map, lib, loadSlot, aniso }) {
  if (!layout.length) return;
  const tex = map.houseTextures || {};
  const M = houseMeshes(layout);
  const base = { stone: 0x7d7468, brick: 0x8a4a34, wood: 0x6b4a2e, thatch: 0x7a6a4c, ridge: 0x6f604a, glass: 0x1a2026 };
  for (const m of HOUSE_MATS) {
    const g = M[m]; if (!g.idx.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    geo.setIndex(g.idx); geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ color: base[m], roughness: m === 'glass' ? 0.12 : 0.95, metalness: m === 'glass' ? 0.3 : 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    const entry = tex[m] && lib[tex[m]];
    if (!entry) continue;
    loadSlot(entry).then((got) => {
      const ridge = m === 'ridge';
      for (const t of [got.diff, got.nor, got.arm]) if (t) {
        t.anisotropy = aniso;
        if (ridge) { t.repeat.set(1 / entry.meters, 1); t.wrapT = THREE.ClampToEdgeWrapping; } // band: v already 0..1
        else t.repeat.set(1 / entry.meters, 1 / entry.meters);                                  // UVs are meters
        t.needsUpdate = true;
      }
      if (got.diff) { mat.map = got.diff; mat.color.set(0xffffff); }
      if (got.nor) mat.normalMap = got.nor;
      if (got.arm) { mat.roughnessMap = got.arm; mat.aoMap = got.arm; mat.roughness = 1; }
      mat.needsUpdate = true;
    });
  }
}
