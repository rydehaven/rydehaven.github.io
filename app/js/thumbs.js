// thumbs.js — event artwork for the Races page: a futuristic poster for each route, painted on a canvas from the
// route itself (its real elevation profile and map shape) over a stylised landscape for its world.
// No image files: every thumbnail is drawn here, once per route, and cached as a data URL.
import { fbm } from './noise.js?v=75';

const THEMES = {
  cretes: { sky: ['#0a0f2c', '#2b1055', '#d53a9d'], sun: ['#ffe36e', '#ff4f8b'], hills: ['#3a1c71', '#1c2b6b', '#0c1b3a'], grid: '#ff4fd8', line: '#5ff6ff', kind: 'valley' },
  alps: { sky: ['#020617', '#0b2a5b', '#3aa0d8'], sun: ['#e6fbff', '#7ad7ff'], hills: ['#1d3b6e', '#12284d', '#081631'], grid: '#3df0ff', line: '#b6ff5f', kind: 'peaks' },
  collines: { sky: ['#140b2e', '#5b1f5f', '#ff8a3d'], sun: ['#fff3a0', '#ff6a3d'], hills: ['#4a1f4f', '#2f1640', '#170c2a'], grid: '#ffb13d', line: '#2ef2c8', kind: 'rolling' },
};
const CACHE = new Map();

export function routeThumb(map, R, w = 640, h = 360) {
  const key = `${map.id}:${w}x${h}`;
  if (CACHE.has(key)) return CACHE.get(key);
  const T = THEMES[map.worldId] || THEMES.cretes;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), horizon = h * 0.58;

  // sky
  const sky = g.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, T.sky[0]); sky.addColorStop(0.55, T.sky[1]); sky.addColorStop(1, T.sky[2]);
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  // stars
  let seed = [...map.id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  g.fillStyle = 'rgba(255,255,255,0.8)';
  for (let i = 0; i < 70; i++) { const x = rnd() * w, y = rnd() * horizon * 0.6, r = rnd() * 1.2 + 0.2; g.globalAlpha = 0.3 + rnd() * 0.7; g.fillRect(x, y, r, r); }
  g.globalAlpha = 1;
  // aurora ribbon for the mountains
  if (T.kind === 'peaks') {
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      for (let x = 0; x <= w; x += 8) { const y = h * (0.12 + 0.05 * k) + Math.sin(x / 90 + k) * 14 + fbm(x / 120, k, 2, 5) * 30; x ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.strokeStyle = `rgba(${k ? '120,255,190' : '90,220,255'},${0.18 - k * 0.04})`; g.lineWidth = 26 - k * 6; g.shadowColor = '#6fffe0'; g.shadowBlur = 30; g.stroke();
    }
    g.shadowBlur = 0;
  }
  // the sun: banded, synthwave style
  const sx = w * 0.68, sy = horizon - h * 0.02, sr = h * 0.27;
  const sg = g.createLinearGradient(0, sy - sr, 0, sy + sr * 0.3); sg.addColorStop(0, T.sun[0]); sg.addColorStop(1, T.sun[1]);
  g.save(); g.shadowColor = T.sun[1]; g.shadowBlur = 60; g.fillStyle = sg;
  g.beginPath(); g.arc(sx, sy, sr, Math.PI, 0); g.fill(); g.restore();
  g.save(); g.beginPath(); g.arc(sx, sy, sr + 1, Math.PI, 0); g.clip(); g.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 6; k++) { const y = sy - k * sr * 0.13, th = 7 - k * 1.1; g.fillRect(sx - sr - 2, y - th, sr * 2 + 4, th); }
  g.restore();

  // the cut sun bands show the sky behind
  g.save(); g.globalCompositeOperation = 'destination-over'; g.fillStyle = sky; g.fillRect(0, 0, w, h); g.restore();
  // landscape layers
  const layer = (yBase, amp, freq, col, sharp, o) => {
    const P = new Path2D(); P.moveTo(0, h);
    for (let x = 0; x <= w; x += 3) {
      let n = fbm(x / freq + o, o * 0.7, 4, 11 + o);
      if (sharp) n = 1 - Math.abs(n * 2 - 1);                       // ridges
      P.lineTo(x, yBase - n * amp);
    }
    P.lineTo(w, h); P.closePath(); g.fillStyle = col; g.fill(P);
    return P;
  };
  if (T.kind === 'peaks') {
    const back = layer(horizon, h * 0.42, 140, T.hills[0], true, 1);
    // snow caps: the top of the back range, fading out down the slopes
    const snow = g.createLinearGradient(0, horizon - h * 0.42, 0, horizon - h * 0.16); snow.addColorStop(0, 'rgba(225,246,255,0.95)'); snow.addColorStop(0.5, 'rgba(160,215,255,0.45)'); snow.addColorStop(1, 'rgba(160,215,255,0)');
    g.save(); g.clip(back); g.fillStyle = snow; g.fillRect(0, 0, w, horizon); g.restore();
    layer(horizon + 4, h * 0.3, 110, T.hills[1], true, 4);
    layer(horizon + 10, h * 0.16, 80, T.hills[2], false, 8);
  } else if (T.kind === 'rolling') {
    layer(horizon - 4, h * 0.16, 260, T.hills[0], false, 2);
    layer(horizon + 2, h * 0.12, 180, T.hills[1], false, 5);
    // a row of tiny pine silhouettes
    g.fillStyle = T.hills[2];
    for (let x = 0; x < w; x += 7 + rnd() * 9) { const base = horizon + 4 - fbm(x / 180 + 5, 3.5, 4, 16) * h * 0.12, th = 8 + rnd() * 12; g.beginPath(); g.moveTo(x, base - th); g.lineTo(x + 4, base); g.lineTo(x - 4, base); g.fill(); }
    layer(horizon + 8, h * 0.06, 140, T.hills[2], false, 9);
  } else {
    layer(horizon, h * 0.26, 170, T.hills[0], false, 3);
    layer(horizon + 4, h * 0.18, 120, T.hills[1], true, 6);
    layer(horizon + 8, h * 0.07, 90, T.hills[2], false, 9);
  }

  // perspective grid floor
  const floor = g.createLinearGradient(0, horizon, 0, h); floor.addColorStop(0, '#05030f'); floor.addColorStop(1, '#0d0620');
  g.fillStyle = floor; g.fillRect(0, horizon + 8, w, h - horizon);
  g.save(); g.beginPath(); g.rect(0, horizon + 8, w, h); g.clip();
  g.strokeStyle = T.grid; g.shadowColor = T.grid; g.shadowBlur = 8; g.lineWidth = 1.2;
  const vx = w * 0.5;
  for (let k = -14; k <= 14; k++) { g.globalAlpha = 0.55; g.beginPath(); g.moveTo(vx + k * 8, horizon + 8); g.lineTo(vx + k * w * 0.16, h); g.stroke(); }
  for (let k = 1; k < 14; k++) { const y = horizon + 8 + (h - horizon) * Math.pow(k / 13, 2.2); g.globalAlpha = 0.25 + 0.5 * (k / 13); g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  g.restore(); g.globalAlpha = 1;

  // the route's real elevation profile, glowing across the lower third
  if (R && R.n) {
    let lo = Infinity, hi = -Infinity; for (let i = 0; i < R.n; i++) { lo = Math.min(lo, R.y[i]); hi = Math.max(hi, R.y[i]); }
    const px0 = w * 0.05, px1 = w * 0.95, base = h * 0.93, top = h * 0.68, N = 220, pts = [];
    for (let k = 0; k <= N; k++) { const i = Math.min(R.n - 1, Math.floor((k / N) * R.n)); pts.push([px0 + (px1 - px0) * (k / N), base - ((R.y[i] - lo) / Math.max(30, hi - lo)) * (base - top)]); }
    const fill = g.createLinearGradient(0, top, 0, base); fill.addColorStop(0, hexA(T.line, 0.45)); fill.addColorStop(1, hexA(T.line, 0.02));
    g.beginPath(); g.moveTo(px0, base); pts.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(px1, base); g.closePath(); g.fillStyle = fill; g.fill();
    g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.strokeStyle = T.line; g.lineWidth = 2.5; g.shadowColor = T.line; g.shadowBlur = 14; g.stroke(); g.shadowBlur = 0;
    // climbs marked with ticks
    g.fillStyle = '#fff';
    for (const cl of map.climbs || []) { const x = px0 + (px1 - px0) * cl.to; g.globalAlpha = 0.85; g.fillRect(x - 1, top - 10, 2, 8); }
    g.globalAlpha = 1;

    // route map, top right, inside a HUD ring
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < R.n; i++) { x0 = Math.min(x0, R.x[i]); x1 = Math.max(x1, R.x[i]); z0 = Math.min(z0, R.z[i]); z1 = Math.max(z1, R.z[i]); }
    const cx = w - h * 0.17, cy = h * 0.19, rr = h * 0.13, s = (rr * 1.45) / Math.max(x1 - x0, z1 - z0);
    g.fillStyle = 'rgba(5,8,20,0.55)'; g.beginPath(); g.arc(cx, cy, rr * 1.12, 0, 7); g.fill();
    g.strokeStyle = hexA(T.line, 0.6); g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, rr * 1.12, 0, 7); g.stroke();
    g.setLineDash([3, 5]); g.beginPath(); g.arc(cx, cy, rr * 1.25, -1.2, 2.2); g.stroke(); g.setLineDash([]);
    g.beginPath();
    for (let k = 0; k <= 200; k++) { const i = Math.floor((k / 200) * (R.n - 1)), x = cx + (R.x[i] - (x0 + x1) / 2) * s, y = cy + (R.z[i] - (z0 + z1) / 2) * s; k ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.shadowColor = T.line; g.shadowBlur = 10; g.stroke(); g.shadowBlur = 0;
  }
  // corner brackets + scanlines
  g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 2;
  const br = 16, m = 10;
  for (const [x, y, dx, dy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]]) { g.beginPath(); g.moveTo(x, y + dy * br); g.lineTo(x, y); g.lineTo(x + dx * br, y); g.stroke(); }
  g.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);

  const url = c.toDataURL('image/jpeg', 0.86);
  CACHE.set(key, url);
  return url;
}
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
