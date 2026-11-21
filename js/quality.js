// quality.js — graphics presets + automatic resolution scaling (keeps the frame rate up on laptops).
export const PRESETS = {
  //          max pixel   lowest auto  edge-                shadow   soft     trees   tree-shadow  terrain  view      terrain LOD switch
  //          ratio       res scale    smoothing  shadows   map      shadows  kept    radius (m)   detail   distance  distances (m)
  low:    { dprMax: 1, scaleMin: 0.5,  msaa: false, shadows: false, shadowSize: 0,    soft: false, treeFrac: 0.35, treeShadowR: 0,   terrainHQ: false, fogScale: 0.65, lod: [300, 800] },
  medium: { dprMax: 1, scaleMin: 0.6,  msaa: true,  shadows: true,  shadowSize: 1024, soft: false, treeFrac: 0.6,  treeShadowR: 70,  terrainHQ: false, fogScale: 0.85, lod: [450, 1200] },
  high:   { dprMax: 2, scaleMin: 0.7,  msaa: true,  shadows: true,  shadowSize: 2048, soft: true,  treeFrac: 1,    treeShadowR: 140, terrainHQ: true,  fogScale: 1,    lod: [700, 1800] },
};
export const LEVELS = ['auto', 'low', 'medium', 'high'];
const KEY = 'rydehaven.quality';

export function getQualityName() {
  try { const v = localStorage.getItem(KEY); if (LEVELS.includes(v)) return v; } catch {}
  return 'auto';
}
export function setQualityName(v) { try { localStorage.setItem(KEY, v); } catch {} }
// "auto" starts from medium (laptop-safe) and relies on resolution scaling
export function getPreset(name) { return { ...PRESETS[name === 'auto' ? 'medium' : name], name }; }

// Dynamic resolution: watches frame times and nudges the render scale to hold ~55-60 fps.
export function makeScaler(preset, apply) {
  let scale = 1, acc = 0, frames = 0, cooldown = 1.5, fps = 60, slowFor = 0;
  return {
    get fps() { return fps; }, get scale() { return scale; }, get struggling() { return slowFor > 6; },
    tick(dt) {
      acc += dt; frames++; cooldown -= dt;
      if (acc < 0.5) return;
      fps = frames / acc; acc = 0; frames = 0;
      if (cooldown > 0) return;
      let next = scale;
      if (fps < 48) next = Math.max(preset.scaleMin, scale - (fps < 35 ? 0.12 : 0.06));
      else if (fps > 58 && scale < 1) next = Math.min(1, scale + 0.04);
      slowFor = fps < 40 && scale <= preset.scaleMin + 1e-3 ? slowFor + 0.5 : 0;
      if (next !== scale) { scale = next; apply(scale); cooldown = 1; }
    },
  };
}
