// textures.js — loads Poly Haven maps (from config paths or dropped files) with procedural fallbacks.
import * as THREE from 'three';

let ANISO = 8;
export function setAnisotropy(n) { ANISO = n; }

function prep(tex, srgb) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = ANISO;                       // crucial for a road seen at grazing angles
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ---------- procedural placeholders (tileable) ----------
function phash(ix, iy, p, s) { ix = ((ix % p) + p) % p; iy = ((iy % p) + p) % p;
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function pnoise(x, y, p, s) { const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = phash(ix, iy, p, s), b = phash(ix + 1, iy, p, s), c = phash(ix, iy + 1, p, s), d = phash(ix + 1, iy + 1, p, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy; }
function pfbm(u, v, base, oct, s) { let t = 0, a = 0.5, n = 0, f = base;
  for (let i = 0; i < oct; i++) { t += a * pnoise(u * f, v * f, f, s + i); n += a; a *= 0.5; f *= 2; } return t / n; }

const LOOK = {
  road:     { c: [62, 62, 66],   var: 26, base: 16, speck: 0.5, rough: 0.82, bump: 1.2 },
  shoulder: { c: [128, 116, 98], var: 60, base: 32, speck: 0.9, rough: 0.95, bump: 3 },
  grass:    { c: [74, 108, 46],  var: 40, base: 8,  speck: 0.3, rough: 0.9,  bump: 1.5 },
  dirt:     { c: [118, 90, 62],  var: 38, base: 6,  speck: 0.4, rough: 0.95, bump: 2 },
  rock:     { c: [128, 124, 118],var: 44, base: 4,  speck: 0.2, rough: 0.8,  bump: 4 },
  snow:     { c: [232, 237, 243],var: 14, base: 6,  speck: 0.1, rough: 0.55, bump: 0.8 },
};

export function placeholder(slot) {
  const L = LOOK[slot], S = 256, hgt = new Float32Array(S * S);
  const col = document.createElement('canvas'); col.width = col.height = S;
  const cx = col.getContext('2d'), img = cx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    let n = pfbm(u, v, L.base, 5, 3);
    if (slot === 'rock') n = 0.6 * n + 0.4 * pfbm(u * 0.25, v * 2, 4, 4, 7);          // streaks
    const sp = phash(x, y, S, 11) < 0.08 * L.speck ? (phash(x, y, S, 12) - 0.5) * 1.6 : 0; // speckle
    const k = (n - 0.5) * 2 + sp; hgt[y * S + x] = n + sp * 0.3;
    const i = (y * S + x) * 4;
    img.data[i] = L.c[0] + k * L.var; img.data[i + 1] = L.c[1] + k * L.var * (slot === 'grass' ? 1.2 : 1); img.data[i + 2] = L.c[2] + k * L.var * 0.9; img.data[i + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  // normal map from the height field
  const nc = document.createElement('canvas'); nc.width = nc.height = S;
  const nx = nc.getContext('2d'), ni = nx.createImageData(S, S), H = (x, y) => hgt[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let a = (H(x - 1, y) - H(x + 1, y)) * L.bump, b = (H(x, y + 1) - H(x, y - 1)) * L.bump, c = 1; // OpenGL (+Y up)
    const l = Math.hypot(a, b, c), i = (y * S + x) * 4;
    ni.data[i] = (a / l * 0.5 + 0.5) * 255; ni.data[i + 1] = (b / l * 0.5 + 0.5) * 255; ni.data[i + 2] = (c / l * 0.5 + 0.5) * 255; ni.data[i + 3] = 255;
  }
  nx.putImageData(ni, 0, 0);
  const arm = new THREE.DataTexture(new Uint8Array([255, Math.round(L.rough * 255), 0, 255]), 1, 1);
  return {
    diff: prep(new THREE.CanvasTexture(col), true),
    nor: prep(new THREE.CanvasTexture(nc), false),
    arm: prep(arm, false),
  };
}

// ---------- real files ----------
const loader = new THREE.TextureLoader();
export async function loadTex(url, srgb) {
  if (!url) return null;
  try { return prep(await loader.loadAsync(url), srgb); } catch { return null; }
}
function loadImg(url) {
  return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
}
// Pack separate AO + Roughness images into one ARM texture (R = AO, G = rough, B = metal 0)
export async function packArm(roughUrl, aoUrl) {
  const [r, a] = await Promise.all([loadImg(roughUrl), loadImg(aoUrl)]);
  if (!r && !a) return null;
  const src = r || a, w = src.naturalWidth, h = src.naturalHeight;
  const read = (im) => { if (!im) return null; const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0, w, h); return x.getImageData(0, 0, w, h).data; };
  const R = read(r), A = read(a), c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'), out = x.createImageData(w, h);
  for (let i = 0; i < w * h * 4; i += 4) { out.data[i] = A ? A[i] : 255; out.data[i + 1] = R ? R[i] : 230; out.data[i + 2] = 0; out.data[i + 3] = 255; }
  x.putImageData(out, 0, 0);
  return prep(new THREE.CanvasTexture(c), false);
}

// Load a slot's config files; returns { diff, nor, arm } with only the found maps filled.
export async function loadSlotFromConfig(cfg) {
  const f = cfg.files, out = {};
  const [diff, nor, arm] = await Promise.all([loadTex(f.diff, true), loadTex(f.nor, false), loadTex(f.arm, false)]);
  if (diff) out.diff = diff; if (nor) out.nor = nor;
  if (arm) out.arm = arm; else if (f.rough || f.ao) { const p = await packArm(f.rough, f.ao); if (p) out.arm = p; }
  return out;
}

// Classify a Poly Haven file name: brick_wall_diff_2k.jpg -> 'diff', ..._nor_gl_2k.jpg -> 'nor', etc.
export function classify(name) {
  const n = name.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/_\d+k$/, '');
  const rules = [
    ['nor_dx', /(nor_dx|normal_dx)$/], ['nor', /(nor_gl|normal_gl|normal|_nor)$/], ['arm', /_arm$/],
    ['rough', /_rough(ness)?$/], ['ao', /(_ao|occlusion)$/],
    ['skip', /(disp|displacement|height|bump|spec|metal|metallic|mask)$/],
    ['diff', /(diff|diffuse|col|color|albedo|basecolor|base_color)$/],
  ];
  for (const [k, re] of rules) if (re.test(n)) return k;
  return 'diff';
}

// Dropped files for one slot -> { diff, nor, arm, flipY, notes[] }
export async function loadSlotFromFiles(files) {
  const out = { notes: [] }, by = {};
  for (const f of files) by[classify(f.name)] = f;
  const url = (f) => (f ? URL.createObjectURL(f) : null);
  if (by.diff) out.diff = await loadTex(url(by.diff), true);
  if (by.nor) out.nor = await loadTex(url(by.nor), false);
  else if (by.nor_dx) { out.nor = await loadTex(url(by.nor_dx), false); out.flipY = true; out.notes.push('DirectX normal: flipped green. Prefer nor_gl.'); }
  if (by.arm) out.arm = await loadTex(url(by.arm), false);
  else if (by.rough || by.ao) out.arm = await packArm(url(by.rough), url(by.ao));
  if (by.skip) out.notes.push('Displacement/other maps ignored.');
  if (files.some((f) => /\.exr$/i.test(f.name))) out.notes.push('EXR not supported here: download JPG.');
  return out;
}

// .hdr (Radiance RGBE) loader that needs no network request: a built-in data: URL is decoded directly,
// a normal path is read with fetch. Decodes to float for analysis, uploads as half-float (filterable everywhere).
export async function loadHDR(url) {
  try {
    let bytes;
    if (url.startsWith('data:')) {
      const b64 = url.slice(url.indexOf(',') + 1), bin = atob(b64);
      bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      const r = await fetch(url); if (!r.ok) return null;
      if (url.endsWith('.b64.txt')) { const bin = atob((await r.text()).trim()); bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); }  // hosts that only serve text
      else bytes = new Uint8Array(await r.arrayBuffer());
    }
    const { width, height, data } = decodeRGBE(bytes);
    const half = new Uint16Array(data.length);
    for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.min(data[i], 65000));
    const t = new THREE.DataTexture(half, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
    t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.LinearSRGBColorSpace;
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.flipY = true;
    t.needsUpdate = true;
    t.userData.analysis = analyzeHDR({ image: { width, height, data } });
    return t;
  } catch (e) { console.warn('HDR failed:', e); loadHDR.lastError = e.message || String(e); return null; }
}

export function decodeRGBE(bytes) {
  let p = 0; const line = () => { let s = ''; while (p < bytes.length && bytes[p] !== 10) s += String.fromCharCode(bytes[p++]); p++; return s; };
  if (!line().startsWith('#?')) throw new Error('not a .hdr file');
  for (let l = line(); l.trim() !== ''; l = line()) if (l.startsWith('FORMAT') && !l.includes('32-bit_rle_rgbe')) throw new Error('unsupported HDR format');
  const dims = line().split(/\s+/), H = +dims[1], W = +dims[3];
  if (!(W > 0 && H > 0)) throw new Error('bad HDR size');
  const out = new Float32Array(W * H * 4), row = new Uint8Array(W * 4);
  for (let y = 0; y < H; y++) {
    if (bytes[p] === 2 && bytes[p + 1] === 2 && ((bytes[p + 2] << 8) | bytes[p + 3]) === W) {   // new-style RLE
      p += 4;
      for (let c = 0; c < 4; c++) for (let x = 0; x < W;) {
        let n = bytes[p++];
        if (n > 128) { n -= 128; const v = bytes[p++]; for (let k = 0; k < n; k++) row[(x++) * 4 + c] = v; }
        else for (let k = 0; k < n; k++) row[(x++) * 4 + c] = bytes[p++];
      }
    } else { for (let x = 0; x < W; x++) { row.set(bytes.subarray(p, p + 4), x * 4); p += 4; } }  // flat
    for (let x = 0; x < W; x++) {
      const e = row[x * 4 + 3], o = (y * W + x) * 4;
      if (e) { const f = Math.pow(2, e - 136); out[o] = row[x * 4] * f; out[o + 1] = row[x * 4 + 1] * f; out[o + 2] = row[x * 4 + 2] * f; }
      out[o + 3] = 1;
    }
  }
  return { width: W, height: H, data: out };
}

// Read the HDRI itself: where the sun is (brightest spot) and the average color along the horizon,
// so the game's sun, shadows and distance haze match the photo.
export function analyzeHDR(t) {
  const { width: W, height: H, data: D } = t.image, ch = D.length / (W * H);
  let best = -1, bx = 0, by = 0;
  for (let y = 0; y < H * 0.55; y++) for (let x = 0; x < W; x++) {        // upper half (+ a bit): sky only
    const o = (y * W + x) * ch, l = 0.2126 * D[o] + 0.7152 * D[o + 1] + 0.0722 * D[o + 2];
    if (l > best) { best = l; bx = x; by = y; }
  }
  const dirFrom = (px, py) => {                                             // matches three.js equirect mapping (flipY)
    const u = (px + 0.5) / W, v = 1 - (py + 0.5) / H, th = (u - 0.5) * 2 * Math.PI, lat = (v - 0.5) * Math.PI;
    return new THREE.Vector3(Math.cos(th) * Math.cos(lat), Math.sin(lat), Math.sin(th) * Math.cos(lat));
  };
  const sun = dirFrom(bx, by);
  let r = 0, g = 0, b = 0, n = 0;                                           // horizon band, 1-8 degrees up
  const y0 = Math.floor(H * (0.5 - 8 / 180)), y1 = Math.floor(H * (0.5 - 1 / 180));
  for (let y = y0; y <= y1; y++) for (let x = 0; x < W; x += 2) { const o = (y * W + x) * ch; r += D[o]; g += D[o + 1]; b += D[o + 2]; n++; }
  return { sun, sunLum: best, horizon: new THREE.Color(r / n, g / n, b / n) };
}
