// finish.js — race furniture: finish gantry with banner, painted finish line, crowd barriers
// along the final straight, and the "flamme rouge" (red kite) 1 km from the line.
import * as THREE from 'three';
import { sampleRoute } from './world.js?v=75';

function bannerTexture(text, bg, fg) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 128;
  const x = c.getContext('2d'); x.fillStyle = bg; x.fillRect(0, 0, 1024, 128);
  x.fillStyle = fg; x.font = '900 92px "Barlow Condensed", Impact, "Arial Black", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 512, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function placeAcross(obj, R, d, yOff = 0) { // local +z = along the road (symmetric objects only)
  const s = sampleRoute(R, d);
  obj.position.set(s.x, s.y + yOff, s.z);
  obj.rotation.y = Math.atan2(s.fx, s.fz);
  return s;
}

export function buildFinish({ scene, R, map }) {
  const f = map.finish; if (!f) return;
  const W = map.world, half = W.roadHalf + W.shoulder;
  const red = new THREE.MeshStandardMaterial({ color: 0xd71e28, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.5 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.35, metalness: 0.6 });

  // finish gantry with banner (both faces)
  const g = new THREE.Group(), span = 2 * half + 2.4;
  for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 0.6), dark); p.position.set(sx * span / 2, 3.5, 0); g.add(p); }
  const tex = bannerTexture('FINISH', '#2ec4b6', '#0f1b2d');
  const bar = new THREE.Mesh(new THREE.BoxGeometry(span + 0.6, 1.6, 0.5), [dark, dark, dark, dark, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 })]);
  bar.position.y = 6.4; g.add(bar);
  g.traverse((o) => { o.castShadow = true; });
  placeAcross(g, R, 0); scene.add(g);

  // painted finish line (checkered band) right under the gantry
  const lc = document.createElement('canvas'); lc.width = 256; lc.height = 16;
  { const x = lc.getContext('2d'); for (let i = 0; i < 32; i++) for (let j = 0; j < 2; j++) { x.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f0'; x.fillRect(i * 8, j * 8, 8, 8); } }
  const lineTex = new THREE.CanvasTexture(lc); lineTex.colorSpace = THREE.SRGBColorSpace; lineTex.magFilter = THREE.NearestFilter;
  const line = new THREE.Mesh(new THREE.PlaneGeometry(2 * W.roadHalf, 0.5), new THREE.MeshStandardMaterial({ map: lineTex, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  line.rotation.x = -Math.PI / 2; const lg = new THREE.Group(); lg.add(line); placeAcross(lg, R, 0, 0.05); scene.add(lg);

  // crowd barriers on both sides of the final straight and just past the line
  const unit = 2.5, segs = [];
  for (let d = -(f.barriersBefore || 0); d < (f.barriersAfter || 0); d += unit) segs.push(d);
  const panels = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 1.0, unit - 0.1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 }), segs.length * 2);
  const feet = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.08, 0.12), metal, segs.length * 4);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), o = new THREE.Object3D(), c = new THREE.Color();
  let pi = 0, fi = 0;
  for (const d of segs) for (const side of [-1, 1]) {
    const s = sampleRoute(R, d + unit / 2), rx = -s.fz, rz = s.fx, off = side * (half + 0.5);
    o.position.set(s.x + rx * off, s.y + 0.62, s.z + rz * off); o.rotation.set(0, Math.atan2(s.fx, s.fz), 0); o.updateMatrix();
    panels.setMatrixAt(pi, o.matrix); panels.setColorAt(pi++, c.set(Math.floor((d + 1000) / unit) % 2 ? 0x2ec4b6 : 0x1b2230));
    for (const e of [-1, 1]) {
      const fs = sampleRoute(R, d + unit / 2 + e * (unit / 2 - 0.25));
      o.position.set(fs.x + rx * off, fs.y + 0.04, fs.z + rz * off); o.updateMatrix(); feet.setMatrixAt(fi++, o.matrix);
    }
  }
  panels.castShadow = feet.castShadow = true; scene.add(panels, feet);

  // flamme rouge: red kite 1 km before the line
  if (f.flammeRouge) {
    const k = new THREE.Group();
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6.2, 10), metal); p.position.set(sx * (half + 0.9), 3.1, 0); k.add(p); }
    const kb = new THREE.Mesh(new THREE.BoxGeometry(2 * half + 2, 0.7, 0.2), [red, red, red, red,
      new THREE.MeshStandardMaterial({ map: bannerTexture('1 KM', '#d71e28', '#ffffff'), roughness: 0.6 }), new THREE.MeshStandardMaterial({ map: bannerTexture('1 KM', '#d71e28', '#ffffff'), roughness: 0.6 })]);
    kb.position.y = 5.9; k.add(kb);
    const tri = new THREE.Shape(); tri.moveTo(-1.1, 0); tri.lineTo(1.1, 0); tri.lineTo(0, -1.6); tri.closePath();
    const flag = new THREE.Mesh(new THREE.ShapeGeometry(tri), new THREE.MeshStandardMaterial({ color: 0xd71e28, roughness: 0.7, side: THREE.DoubleSide }));
    flag.position.y = 5.55; k.add(flag);
    k.traverse((x) => { x.castShadow = true; });
    placeAcross(k, R, R.length - 1000); scene.add(k);
  }
}

// ---------- KOM markers: an arch at the start and the top of every timed climb ----------
function komBanner(title, sub) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#0f1b2d'; x.fillRect(0, 0, 1024, 256);
  x.fillStyle = '#2ec4b6'; x.fillRect(0, 0, 1024, 150);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = '#0f1b2d'; x.font = '900 112px "Barlow Condensed", Impact, "Arial Black", sans-serif'; x.fillText(title, 512, 80, 980);
  x.fillStyle = '#ffffff'; x.font = '800 66px "Barlow Condensed", Impact, "Arial Black", sans-serif'; x.fillText(sub.toUpperCase(), 512, 205, 980);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

export function buildKomMarkers({ scene, R, map }) {
  const climbs = map.climbs || []; if (!climbs.length) return;
  const L = R.length, W = map.world, half = W.roadHalf + W.shoulder;
  // collect start/finish points; points close together share one arch
  const pts = [];
  for (const c of climbs) { pts.push({ d: c.from * L, kind: 'START', name: c.name }); pts.push({ d: c.to * L, kind: 'FINISH', name: c.name }); }
  pts.sort((a, b) => a.d - b.d);
  const groups = [];
  for (const p of pts) { const g = groups[groups.length - 1]; if (g && p.d - g.d < 25) g.items.push(p); else groups.push({ d: p.d, items: [p] }); }
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.5 });
  const teal = new THREE.MeshStandardMaterial({ color: 0x2ec4b6, roughness: 0.55 });
  for (const g of groups) {
    const near0 = Math.min(g.d, L - g.d) < 30;                // keep clear of the main start/finish arch
    const d = near0 ? (g.d < L / 2 ? 30 : L - 30) : g.d;
    const kinds = [...new Set(g.items.map((i) => i.kind))];
    const title = kinds.length > 1 ? 'KOM FINISH · START' : `KOM ${kinds[0]}`;
    const sub = [...new Set(g.items.map((i) => i.name))].join('  ·  ');
    const tex = komBanner(title, sub), bm = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    const a = new THREE.Group(), span = 2 * half + 2.2;
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.45, 6.4, 0.45), sx < 0 ? dark : dark); p.position.set(sx * span / 2, 3.2, 0); a.add(p); }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(span + 0.45, span / 4, 0.4), [dark, dark, dark, dark, bm, bm]);
    bar.position.y = 6.4 + span / 8 - 0.6; a.add(bar);
    a.traverse((o) => { o.castShadow = true; });
    placeAcross(a, R, d); scene.add(a);
    // painted line across the road
    const ln = new THREE.Mesh(new THREE.PlaneGeometry(2 * W.roadHalf, 0.45), kinds.includes('FINISH') ? teal : new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    if (ln.material === teal) { teal.polygonOffset = true; teal.polygonOffsetFactor = -2; teal.polygonOffsetUnits = -2; }
    ln.rotation.x = -Math.PI / 2; const lg = new THREE.Group(); lg.add(ln); placeAcross(lg, R, d, 0.05); scene.add(lg);
  }
}
