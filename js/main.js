// main.js — the shared ENGINE: start screen, then builds the chosen map (maps/*.js) and runs the ride.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildWorld, buildRoute, sampleRoute, heightAt, gridIndex, fbm } from './world.js';
import { SLOT_INFO, TEXLIB, SKY } from './config.js';
import { MAPS } from '../maps/index.js';
import { buildForest } from './trees.js';
import { placeholder, loadSlotFromConfig, loadSlotFromFiles, loadHDR, setAnisotropy } from './textures.js';
import { makeTerrainMaterial } from './terrainMaterial.js';
import { buildWalls } from './walls.js';
import { buildFinish } from './finish.js';
import { layoutHouses } from './housegen.js';
import { buildHouses } from './houses.js';
import { buildBike } from './bike.js';
import { getProfile, getBikeChoice, bikeStats, getRideOptions, workoutPlan, WORKOUTS, zoneColor, noteFtp, bodyDrag, BASE_CDA } from './settings.js';
import { showHome } from './home.js';
import { loadRider } from './rider.js';
import { trainer, setErg, setSim } from './trainer.js';
import { initDevices } from './devices.js';
import { getQualityName, setQualityName, getPreset, makeScaler, LEVELS } from './quality.js';

const $ = (id) => document.getElementById(id);
const status = (t) => { $('loading').textContent = t; };

// ---------- map choice: #mapid in the address, otherwise the start screen ----------
// Starting a ride from the home screen happens in place (no reload) so a paired trainer stays connected;
// leaving a ride reloads the page, which frees all the memory the world used.
initDevices();
let home = null, inRide = false;
addEventListener('hashchange', () => {
  const m = MAPS.find((x) => '#' + x.id === location.hash);
  if (m && home && !inRide) { home.dispose(); home = null; inRide = true; startGame(m); return; }
  location.reload();
});
const CHOSEN = MAPS.find((m) => '#' + m.id === location.hash);
if (CHOSEN) { inRide = true; await startGame(CHOSEN); } else home = showHome({ MAPS, buildRoute });

async function startGame(MAP) {
const WORLD = MAP.world;
if (!$('loading')) { const l = document.createElement('div'); l.id = 'loading'; l.textContent = 'Loading…'; document.body.appendChild(l); }
document.body.classList.remove('menu');
$('mapsBtn').onclick = () => { location.hash = ''; };
$('mapsBtn').textContent = 'Home';
$('mapName').textContent = MAP.name;

// ---------- renderer / scene ----------
const QNAME = getQualityName(), Q = getPreset(QNAME);           // graphics quality (Auto / Low / Medium / High)
const renderer = new THREE.WebGLRenderer({ antialias: Q.msaa, powerPreference: 'high-performance' });
const BASE_DPR = Math.min(devicePixelRatio, Q.dprMax);
renderer.setPixelRatio(BASE_DPR);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = Q.shadows;
renderer.shadowMap.type = Q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
const scaler = makeScaler(Q, (k) => { renderer.setPixelRatio(BASE_DPR * k); resize(); }); // auto resolution
$('view').appendChild(renderer.domElement);
setAnisotropy(renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
const SKYCOL = new THREE.Color(MAP.sky.color);
scene.background = SKYCOL;
const VIEW = MAP.sky.fogFar * Q.fogScale;                          // view distance for this quality
scene.fog = new THREE.Fog(SKYCOL, MAP.sky.fogNear * Q.fogScale, VIEW);
const camera = new THREE.PerspectiveCamera(60, 1, 0.3, VIEW * 1.15);
const hemi = new THREE.HemisphereLight(0xdbeeff, 0x4a5a3a, 1.1);
const sun = new THREE.DirectionalLight(0xfff1dd, 2.6);
sun.castShadow = Q.shadows;
if (Q.shadows) sun.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 1, far: 900 });
sun.shadow.bias = -0.0004;
scene.add(hemi, sun, sun.target);
const SUN_DIR = new THREE.Vector3(0.45, 0.8, 0.35).normalize();

// ---------- world ----------
status(`Building ${MAP.name}…`);
await new Promise((r) => setTimeout(r, 30));
const { route: R, terrain: T } = buildWorld(MAP);

// ---------- textures (placeholders first, then config files) ----------
const slotCfg = (k) => (MAP.textures && MAP.textures[k] ? TEXLIB[MAP.textures[k]] : null); // library entry or null
const hasSnow = WORLD.snowFrom < 5000;
const SLOTS = {};
for (const k of Object.keys(SLOT_INFO)) {
  SLOTS[k] = { ...placeholder(k), meters: slotCfg(k) ? slotCfg(k).meters : SLOT_INFO[k].meters, flipY: false, real: {} };
}

// ---------- road + shoulders + markings (extruded along the spline) ----------
const camber = (s) => 0.04 * (1 - (s / WORLD.roadHalf) ** 2);
const ROAD_LIFT = 0.02;                                            // road ribbon sits this far above the route line
function ribbon(profile, every = 1) {
  // profile: [[s (m across, + = right), dy], ...]. UV = (s meters, distance meters).
  const rows = Math.floor(R.n / every) + 1, cols = profile.length;
  const pos = new Float32Array(rows * cols * 3), uv = new Float32Array(rows * cols * 2), idx = [];
  for (let r = 0; r < rows; r++) {
    const i = (r * every) % R.n, d = r * every * R.ds; // last row repeats sample 0 at d = length
    const rx = -R.fz[i], rz = R.fx[i];
    for (let c = 0; c < cols; c++) {
      const [s, dy] = profile[c], o = (r * cols + c);
      pos.set([R.x[i] + rx * s, R.y[i] + dy, R.z[i] + rz * s], o * 3);
      uv.set([s, d], o * 2);
    }
  }
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const a = r * cols + c, b = a + 1, e = a + cols, f = e + 1;
    idx.push(a, b, e, b, f, e); // CCW from above -> normals up
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const RH = WORLD.roadHalf, SH = WORLD.shoulder;
const roadProfile = []; for (let s = -RH; s <= RH + 1e-6; s += RH / 4) roadProfile.push([s, camber(s) + ROAD_LIFT]);
const shoulderL = [[-RH - SH, -0.35], [-RH - 0.5, -0.04], [-RH, 0]];
const shoulderR = [[RH, 0], [RH + 0.5, -0.04], [RH + SH, -0.35]];

function pbr(slot) {
  const S = SLOTS[slot];
  const m = new THREE.MeshStandardMaterial({ map: S.diff, normalMap: S.nor, roughnessMap: S.arm, aoMap: S.arm, metalness: 0 });
  return m;
}
const roadMat = pbr('road'), shoulderMat = pbr('shoulder');
const road = new THREE.Mesh(ribbon(roadProfile), roadMat);
const shoulders = new THREE.Group();
if (SH > 0) shoulders.add(new THREE.Mesh(ribbon(shoulderL), shoulderMat), new THREE.Mesh(ribbon(shoulderR), shoulderMat));
// asphalt always wins the depth test where the ground comes up to meet it (no flicker at the edge)
Object.assign(roadMat, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
road.receiveShadow = true; shoulders.children.forEach((m) => (m.receiveShadow = true));
scene.add(road, shoulders);

// no painted lines: narrow road, French style

// ---------- terrain chunks (world-space UVs in meters) ----------
const terrainMat = makeTerrainMaterial(['grass', 'dirt', 'rock', 'snow'].map((k) => SLOTS[k]), Q.terrainHQ);
['grass', 'dirt', 'rock', 'snow'].forEach((k, i) => { const t = MAP.tints && MAP.tints[k]; if (t) terrainMat.uniforms['tTint' + i].value.setRGB(t[0], t[1], t[2]); });
if (MAP.detail && TEXLIB[MAP.detail.texture]) { // fine detail texture over the grass layer
  const lib = TEXLIB[MAP.detail.texture];
  loadSlotFromConfig(lib).then((got) => {
    const u = terrainMat.uniforms;
    if (got.diff) u.tDetail.value = got.diff; if (got.nor) u.tDetailNor.value = got.nor;
    u.uDetail.value.set(1 / (MAP.detail.meters || lib.meters), MAP.detail.strength ?? 0.7);
  });
}
// Each chunk is built at up to 3 detail levels; far chunks use the coarse ones (4-16x fewer triangles).
// A skirt hangs down from every chunk edge so cracks between levels never show.
const C = WORLD.chunks, per = WORLD.cells / C;
const STEPS = [1]; for (const st of [2, 4, 5, 8, 10]) if (STEPS.length < 3 && per % st === 0 && st > STEPS[STEPS.length - 1]) STEPS.push(st);
function chunkGeo(cx, cz, st) {
  const n = per / st + 1, ring = 4 * (n - 1), V = n * n + ring;
  const pos = new Float32Array(V * 3), nor = new Float32Array(V * 3), col = new Float32Array(V * 3), snow = new Float32Array(V), uv = new Float32Array(V * 2), idx = [];
  const put = (o, gx, gz, drop) => {
    const g = gz * T.N + gx, x = -T.half + gx * T.sp, z = -T.half + gz * T.sp;
    pos.set([x, T.height[g] - drop, z], o * 3);
    nor.set(T.normal.subarray(g * 3, g * 3 + 3), o * 3);
    col.set(T.splat.subarray(g * 4, g * 4 + 3), o * 3); snow[o] = T.splat[g * 4 + 3];
    uv.set([x, z], o * 2);
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) put(j * n + i, cx * per + i * st, cz * per + j * st, 0);
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i, b = a + 1, e = a + n, f = e + 1; idx.push(a, e, b, b, e, f); }
  if (st > 1) { // skirt: walk the border, duplicate each vertex 6 m lower, stitch
    const border = [];
    for (let i = 0; i < n - 1; i++) border.push([i, 0]);
    for (let j = 0; j < n - 1; j++) border.push([n - 1, j]);
    for (let i = n - 1; i > 0; i--) border.push([i, n - 1]);
    for (let j = n - 1; j > 0; j--) border.push([0, j]);
    border.forEach(([i, j], k) => put(n * n + k, cx * per + i * st, cz * per + j * st, 6));
    for (let k = 0; k < ring; k++) {
      const [i0, j0] = border[k], [i1, j1] = border[(k + 1) % ring];
      const a = j0 * n + i0, b = j1 * n + i1, a2 = n * n + k, b2 = n * n + (k + 1) % ring;
      idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2);  // both windings: visible from either side
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('snow', new THREE.BufferAttribute(snow, 1));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeBoundingSphere();
  return geo;
}
const chunks = [];
for (let cz = 0; cz < C; cz++) for (let cx = 0; cx < C; cx++) {
  const geos = STEPS.map((st) => chunkGeo(cx, cz, st));
  const mesh = new THREE.Mesh(geos[0], terrainMat.material);
  mesh.receiveShadow = Q.shadows;
  scene.add(mesh);
  const x = -T.half + (cx + 0.5) * per * T.sp, z = -T.half + (cz + 0.5) * per * T.sp;
  chunks.push({ mesh, geos, x, z, r: per * T.sp * 0.71, level: 0 });
}
function updateTerrainLOD(cam) {
  for (const k of chunks) {
    const d = Math.max(0, Math.hypot(k.x - cam.x, k.z - cam.z) - k.r);
    const lv = Math.min(k.geos.length - 1, d < Q.lod[0] ? 0 : d < Q.lod[1] ? 1 : 2);
    if (lv !== k.level) { k.level = lv; k.mesh.geometry = k.geos[lv]; }
    k.mesh.visible = d < VIEW;
  }
}

// ---------- pine forest: Poly Haven pine_sapling_small as impostor cards (see trees.js) ----------
const TREE_LINE = WORLD.trees.treeLine;  // no trees above this height (m)
const HOUSES = layoutHouses(R, T, MAP);            // cottages (maps that list them)
const nearHouse = (x, z) => HOUSES.some((h) => (x - h.x) ** 2 + (z - h.z) ** 2 < (h.radius + 5) ** 2);
const placements = [];
{
  let tries = 0;
  const TREE_N = Math.round(WORLD.trees.count * Q.treeFrac);
  while (placements.length < TREE_N && tries++ < TREE_N * 25) {
    const x = (Math.random() - 0.5) * WORLD.size * 0.97, z = (Math.random() - 0.5) * WORLD.size * 0.97, g = gridIndex(T, x, z);
    if (nearHouse(x, z)) continue;                                          // keep gardens clear
    if (T.dist[g] < 8 || T.normal[g * 3 + 1] < 0.86 || T.splat[g * 4 + 2] > 0.3 || T.splat[g * 4 + 3] > 0.05) continue;
    const hgt = T.height[g], thin = (hgt - (TREE_LINE - 120)) / 120;    // forest thins out toward the tree line
    if (hgt > TREE_LINE || Math.random() < thin) continue;
    if (fbm(x / 160, z / 160, 3, 21) < 0.42) continue;                   // forest patches + clearings
    const alt = Math.max(0, Math.min(1, (hgt - 250) / (TREE_LINE - 250)));
    placements.push({ x, z, y: heightAt(T, x, z) - 0.15, h: (WORLD.trees.minH + Math.random() * (WORLD.trees.maxH - WORLD.trees.minH)) * (1 - 0.4 * alt), w: 0.85 + Math.random() * 0.35,
      rot: Math.random() * 6.283, tint: Math.random(), variant: Math.floor(Math.random() * 3) });
  }
}
const forest = buildForest({ scene, placements, aniso: renderer.capabilities.getMaxAnisotropy(), msaa: Q.msaa });
buildHouses({ scene, layout: HOUSES, map: MAP, lib: TEXLIB, loadSlot: loadSlotFromConfig, aniso: renderer.capabilities.getMaxAnisotropy() });

// ---------- stone retaining walls + parapets (maps that ask for them) ----------
buildWalls({ scene, R, T, map: MAP, lib: TEXLIB, loadSlot: loadSlotFromConfig, aniso: renderer.capabilities.getMaxAnisotropy() });

// ---------- start/finish: race furniture, or a simple arch (it also hides the loop's one UV seam) ----------
if (MAP.finish) buildFinish({ scene, R, map: MAP });
else {
  const s0 = sampleRoute(R, 0), rx = -s0.fz, rz = s0.fx, mat = new THREE.MeshStandardMaterial({ color: 0x18d6c0, roughness: 0.6 });
  const g = new THREE.Group();
  for (const side of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6, 0.4), mat); post.position.set(side * (RH + 1.5), 3, 0); g.add(post); }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(2 * RH + 3.4, 1.1, 0.3), new THREE.MeshStandardMaterial({ color: 0x18181c })); bar.position.y = 6; g.add(bar);
  g.position.set(s0.x, s0.y, s0.z); g.rotation.y = Math.atan2(-rz, rx); // local +x = road's right
  g.traverse((o) => (o.castShadow = true));
  scene.add(g);
}

// ---------- rider: generated road bike + the Mixamo rider in kit and helmet, pedaling procedurally ----------
const rider = new THREE.Group();
const BIKE_CHOICE = getBikeChoice(), BIKE_STATS = bikeStats(BIKE_CHOICE);
const bike = buildBike({ paint: (MAP.kit && MAP.kit.bike) || 0xd71e28, ...BIKE_CHOICE });
rider.add(bike.group);
rider.traverse((o) => (o.castShadow = true));
let riderBody = null;
loadRider({ helmetColor: (MAP.kit && MAP.kit.helmet) || 0xf2f3f5, anisotropy: renderer.capabilities.getMaxAnisotropy() })
  .then((rb) => { riderBody = rb; rider.add(rb.group); })
  .catch((e) => console.error('rider failed to load', e));
scene.add(rider);

// ---------- ride physics: power -> speed, using the spline's gradient ----------
const PROFILE = getProfile(), OPTS = getRideOptions(), PMAX = Math.max(600, Math.ceil((PROFILE.ftp * 2.4) / 50) * 50);
const ride = { d: 0, v: 8, P: Math.round((PROFILE.ftp * 0.65) / 5) * 5, lane: 1.1, mass: PROFILE.kg + BIKE_STATS.kg, CdA: BASE_CDA * bodyDrag(PROFILE) + (BIKE_STATS.CdA - BASE_CDA), Crr: 0.004, paused: false, cam: 0, t: 0, finished: false };
const RACE_CFG = OPTS.mode === 'race' ? { laps: OPTS.laps || (MAP.race && MAP.race.laps) || 3, start: OPTS.raceStart || 0, name: OPTS.raceName || 'Race' } : null, RACE_TOTAL = RACE_CFG ? RACE_CFG.laps * R.length : Infinity;
// workout (ERG): target power from the plan and your FTP; W/S or the slider add a bias on top
const WK = OPTS.mode === 'workout' ? { ...WORKOUTS[OPTS.workout], plan: workoutPlan(OPTS.workout), bias: 0, done: false } : null;
if (WK) WK.total = WK.plan[WK.plan.length - 1].t1;
function wkAt(t) {
  const i = WK.plan.findIndex((iv) => t < iv.t1); if (i < 0) return null;
  const iv = WK.plan[i], f = (t - iv.t0) / (iv.t1 - iv.t0);
  return { i, iv, share: iv.p0 + (iv.p1 - iv.p0) * f, left: iv.t1 - t };
}
const wkTarget = () => { const w = wkAt(ride.t); return w ? Math.max(0, Math.round(PROFILE.ftp * w.share + WK.bias)) : ride.P; };
// scheduled race: wait on the start line until the clock says go
let preRace = !!(RACE_CFG && RACE_CFG.start && RACE_CFG.start > Date.now());
function raceCountdown() {
  const left = (RACE_CFG.start - Date.now()) / 1000, b = $('finishBanner');
  if (left > 0) {
    b.querySelector('b').textContent = left > 10 ? fmtTime(Math.ceil(left)) : String(Math.ceil(left));
    b.querySelector('span').textContent = `${RACE_CFG.name} starts in`; b.hidden = false; return true;
  }
  preRace = false; ride.t = 0; ride.d = 0; banner('GO!', `${RACE_CFG.name} · ${RACE_CFG.laps} ${RACE_CFG.laps === 1 ? 'lap' : 'laps'}`);
  return false;
}
// FTP auto-detection: best 20-minute average power, x 0.95, raises the estimate (like Zwift)
const p20 = new Float32Array(1200); let p20i = 0, p20n = 0, p20sum = 0, secAcc = 0, secP = 0, ftpNow = PROFILE.ftp;
function trackFtp(dt) {
  secAcc += dt; secP += ride.P * dt; if (secAcc < 1) return;
  const avg = secP / secAcc; secAcc = 0; secP = 0;
  p20sum += avg - p20[p20i]; p20[p20i] = avg; p20i = (p20i + 1) % 1200; p20n = Math.min(1200, p20n + 1);
  if (p20n === 1200) { const est = Math.round((p20sum / 1200) * 0.95); if (est >= ftpNow + 3) { ftpNow = noteFtp(est); banner('New FTP', `${ftpNow} W · ${(ftpNow / PROFILE.kg).toFixed(2)} W/kg`); } }
}
// smart trainer: its power drives the ride; we send it the gradient (SIM) or the workout target (ERG) once a second
let ctlT = 0;
function useTrainer(dt, s) {
  if (!trainer.connected) return;
  ride.P += (trainer.power - ride.P) * Math.min(1, dt * 4);
  if ((ctlT -= dt) > 0 || !trainer.controllable) return; ctlT = 1;
  if (WK && !WK.done) setErg(wkTarget());
  else setSim(preRace ? 0 : sampleRoute(R, ride.d + 3).grade);
}
function step(dt) {
  const s = sampleRoute(R, ride.d), th = Math.atan(s.grade);
  if (preRace && raceCountdown()) { ride.v = 0; bike.update(dt, 0, false); if (riderBody) riderBody.update(bike.crank, ride.t); return s; }
  trackFtp(dt);
  const F = ride.mass * 9.81 * (ride.Crr * Math.cos(th) + Math.sin(th)) + 0.5 * 1.225 * ride.CdA * ride.v * ride.v;
  if (WK && !WK.done) {
    if (ride.t >= WK.total) { WK.done = true; banner('Workout complete', `${WK.name} · ${fmtTime(WK.total)}`); }
    else if (!trainer.connected) ride.P += (wkTarget() - ride.P) * Math.min(1, dt * 3); // no trainer: ERG eases onto each target
  }
  const a = (ride.P / Math.max(ride.v, 1) - F) / ride.mass;
  ride.v = Math.max(0, ride.v + a * dt);
  ride.d += ride.v * dt; ride.t += dt;
  useTrainer(dt, s);
  bike.update(dt, ride.v, ride.P > 5, trainer.connected && trainer.cadence !== null ? trainer.cadence : null);
  if (riderBody) riderBody.update(bike.crank, ride.t);
  if (RACE_CFG && !ride.finished && ride.d >= RACE_TOTAL) { ride.finished = true; showFinish(); }
  return s;
}
const fmtTime = (t) => { const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, sec = Math.floor(t % 60); return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0'); };
function banner(title, sub) {
  const b = $('finishBanner'); b.querySelector('b').textContent = title; b.querySelector('span').textContent = sub;
  b.hidden = false; setTimeout(() => { b.hidden = true; }, 7000);
}
function showFinish() { banner('Finished!', `${RACE_CFG.name} · ${(RACE_TOTAL / 1000).toFixed(1)} km in ${fmtTime(ride.t)}`); }

// ---------- camera ----------
const orbit = new OrbitControls(camera, renderer.domElement); orbit.enabled = false; orbit.enableDamping = true;
const camPos = new THREE.Vector3(), look = new THREE.Vector3();
function placeRider(s) {
  const rx = -s.fz, rz = s.fx;
  rider.position.set(s.x + rx * ride.lane, s.y + camber(ride.lane) + ROAD_LIFT + 0.004, s.z + rz * ride.lane); // tyres on the asphalt, not in it
  rider.rotation.set(0, Math.atan2(s.fx, s.fz), 0);
  rider.rotateX(-Math.atan(s.grade));
  sun.position.copy(rider.position).addScaledVector(SUN_DIR, 300); sun.target.position.copy(rider.position);
}
function updateCamera(s, snap) {
  if (ride.cam === 2) { orbit.update(); return; }
  const back = ride.cam === 0 ? 6.5 : 90, up = ride.cam === 0 ? 2.4 : 70;
  const ahead = sampleRoute(R, ride.d + (ride.cam === 0 ? 14 : 40));
  const tgt = new THREE.Vector3(rider.position.x - s.fx * back, 0, rider.position.z - s.fz * back);
  tgt.y = Math.max(heightAt(T, tgt.x, tgt.z) + 1.2, rider.position.y + up);
  snap ? camPos.copy(tgt) : camPos.lerp(tgt, 0.08);
  camera.position.copy(camPos);
  look.set(ahead.x, ahead.y + 1.2, ahead.z); camera.lookAt(look);
}

// ---------- HUD + elevation profile ----------
const prof = $('profile'), pctx = prof.getContext('2d');
let ymin = Infinity, ymax = -Infinity; for (let i = 0; i < R.n; i++) { ymin = Math.min(ymin, R.y[i]); ymax = Math.max(ymax, R.y[i]); }
function drawProfile() {
  const W = prof.clientWidth, H = prof.clientHeight, dpr = Math.min(devicePixelRatio, 2);
  if (prof.width !== W * dpr) { prof.width = W * dpr; prof.height = H * dpr; }
  pctx.setTransform(dpr, 0, 0, dpr, 0, 0); pctx.clearRect(0, 0, W, H);
  const X = (d) => (d / R.length) * W, Y = (y) => H - 6 - ((y - ymin) / (ymax - ymin + 1e-6)) * (H - 22);
  const stepPx = R.n / W;
  for (let px = 0; px < W; px++) {
    const i = Math.min(R.n - 1, Math.floor(px * stepPx)), g = R.grade[i];
    pctx.fillStyle = g > 0.06 ? '#e0452b' : g > 0.03 ? '#f39a2b' : g > -0.01 ? '#9cc65a' : '#5aa7c6';
    pctx.fillRect(px, Y(R.y[i]), 1, H - Y(R.y[i]));
  }
  const rxp = X(((ride.d % R.length) + R.length) % R.length);
  pctx.fillStyle = '#fff'; pctx.fillRect(rxp - 1, 0, 2, H);
  pctx.beginPath(); pctx.arc(rxp, Y(sampleRoute(R, ride.d).y) - 4, 5, 0, 7); pctx.fill();
  if (MAP.climbs && W > 420) { // climb names above their summits
    pctx.font = '600 11px Barlow, sans-serif'; pctx.textAlign = 'center'; pctx.fillStyle = 'rgba(255,255,255,.85)';
    for (const c of MAP.climbs) { const x = X(c.to * R.length), y = Y(sampleRoute(R, c.to * R.length).y); pctx.fillText(c.name, Math.min(W - 50, Math.max(50, x)), Math.max(10, y - 6)); }
  }
}
prof.addEventListener('click', (e) => { const r = prof.getBoundingClientRect(), lap = Math.floor(ride.d / R.length); ride.d = lap * R.length + ((e.clientX - r.left) / r.width) * R.length; updateCamera(sampleRoute(R, ride.d), true); });
$('climb').textContent = RACE_CFG
  ? `${(R.length / 1000).toFixed(1)} km lap · ${RACE_CFG.laps} laps (${(RACE_TOTAL / 1000).toFixed(1)} km) · ${Math.round(R.ascent)} m per lap`
  : `${(R.length / 1000).toFixed(1)} km loop · ${Math.round(R.ascent)} m climbing` + (R.hairpins ? ` · ${R.hairpins} hairpins` : '');
if (RACE_CFG) { $('lapMet').hidden = false; $('dstLabel').textContent = 'To go'; }
function climbStatus() { // "Le Mur · 340 m to top" or "Le Mur in 1.8 km"
  if (!MAP.climbs || !MAP.climbs.length) return '';
  const L = R.length, pos = ((ride.d % L) + L) % L;
  for (const c of MAP.climbs) { const a = c.from * L, b = c.to * L; if (pos >= a && pos < b) return `${c.name} · ${Math.round(b - pos)} m to the top`; }
  let best = null, bd = Infinity;
  for (const c of MAP.climbs) { let dd = c.from * L - pos; if (dd < 0) dd += L; if (dd < bd) { bd = dd; best = c; } }
  if (RACE_CFG && ride.d + bd >= RACE_TOTAL) return `Finish in ${((RACE_TOTAL - ride.d) / 1000).toFixed(1)} km`;
  return bd < 3000 ? `${best.name} in ${(bd / 1000).toFixed(1)} km · ${(best.len / 1000).toFixed(1)} km, +${best.gain} m` : '';
}

function hud(s) {
  const tc = trainer.connected;
  $('cadMet').hidden = !(tc && trainer.cadence !== null); if (tc && trainer.cadence !== null) $('hCad').textContent = Math.round(trainer.cadence);
  $('hrMet').hidden = !(trainer.hrConnected && trainer.hr); if (trainer.hrConnected && trainer.hr) $('hHr').textContent = trainer.hr;
  $('pow').disabled = tc && !(WK && !WK.done);
  $('hPow').textContent = Math.round(ride.P);
  $('hWkg').textContent = (ride.P / PROFILE.kg).toFixed(1);
  if (WK) drawWorkout();
  $('hSpd').textContent = (ride.v * 3.6).toFixed(1);
  $('hGrd').textContent = (s.grade * 100).toFixed(1);
  $('hDst').textContent = RACE_CFG ? (Math.max(0, RACE_TOTAL - ride.d) / 1000).toFixed(2) : (ride.d / 1000).toFixed(2);
  if (RACE_CFG) $('hLap').textContent = `${Math.min(RACE_CFG.laps, Math.floor(ride.d / R.length) + 1)}/${RACE_CFG.laps}`;
  $('climbNow').textContent = climbStatus();
  $('hEle').textContent = Math.round(s.y);
  $('pow').value = ride.P;
}

// ---------- workout panel: current interval, time left, next step, and the whole session as zone blocks ----------
const wkc = $('wkChart'), wctx = wkc.getContext('2d');
if (WK) { $('wkt').hidden = false; $('wkName').textContent = WK.name; }
function drawWorkout() {
  const w = WK.done ? null : wkAt(ride.t);
  if (w) {
    const nx = WK.plan[w.i + 1];
    $('wkNow').textContent = `${wkTarget()} W`;
    $('wkLeft').textContent = `${fmtTime(w.left)} left · step ${w.i + 1}/${WK.plan.length}`;
    $('wkNext').textContent = nx ? `Next: ${fmtTime(nx.t1 - nx.t0)} at ${Math.round(PROFILE.ftp * nx.p0)}${nx.p1 !== nx.p0 ? '–' + Math.round(PROFILE.ftp * nx.p1) : ''} W` : 'Last step';
    $('wkBias').textContent = WK.bias ? `${WK.bias > 0 ? '+' : ''}${WK.bias} W` : '';
  } else { $('wkNow').textContent = 'Done'; $('wkLeft').textContent = 'Free ride from here'; $('wkNext').textContent = ''; $('wkBias').textContent = ''; }
  const W = wkc.clientWidth, H = wkc.clientHeight, dpr = Math.min(devicePixelRatio, 2);
  if (wkc.width !== W * dpr) { wkc.width = W * dpr; wkc.height = H * dpr; }
  wctx.setTransform(dpr, 0, 0, dpr, 0, 0); wctx.clearRect(0, 0, W, H);
  for (const iv of WK.plan) {
    const x0 = (iv.t0 / WK.total) * W, x1 = (iv.t1 / WK.total) * W, y0 = H - (Math.min(1.35, iv.p0) / 1.35) * H, y1 = H - (Math.min(1.35, iv.p1) / 1.35) * H;
    wctx.globalAlpha = ride.t > iv.t1 ? 0.4 : 1; wctx.fillStyle = zoneColor((iv.p0 + iv.p1) / 2);
    wctx.beginPath(); wctx.moveTo(x0, H); wctx.lineTo(x0, y0); wctx.lineTo(x1 - 0.5, y1); wctx.lineTo(x1 - 0.5, H); wctx.fill();
  }
  wctx.globalAlpha = 1; const px = Math.min(1, ride.t / WK.total) * W;
  wctx.fillStyle = '#fff'; wctx.fillRect(px - 1, 0, 2, H);
}

// ---------- controls ----------
$('pow').max = PMAX;
const nudge = (dw) => { if (trainer.connected && !(WK && !WK.done)) return; if (WK && !WK.done) WK.bias = Math.max(-200, Math.min(200, WK.bias + dw)); else ride.P = Math.max(0, Math.min(PMAX, ride.P + dw)); };
$('pow').addEventListener('input', (e) => { if (WK && !WK.done) WK.bias = Math.round(+e.target.value - (wkTarget() - WK.bias)); else ride.P = +e.target.value; });
const camNames = ['Chase', 'Overhead', 'Free orbit'];
function setCam(i) {
  ride.cam = i; $('camBtn').textContent = 'Camera: ' + camNames[i];
  orbit.enabled = i === 2;
  if (i === 2) { orbit.target.copy(rider.position); camera.position.copy(rider.position).add(new THREE.Vector3(30, 25, 30)); }
}
$('camBtn').onclick = () => setCam((ride.cam + 1) % 3);
$('pauseBtn').onclick = () => { ride.paused = !ride.paused; $('pauseBtn').textContent = ride.paused ? 'Resume' : 'Pause'; };
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'w' || e.key === 'ArrowUp') nudge(WK && !WK.done ? 5 : 10);
  if (e.key === 's' || e.key === 'ArrowDown') nudge(WK && !WK.done ? -5 : -10);
  if (e.key === 'c') setCam((ride.cam + 1) % 3);
  if (e.key === ' ') { e.preventDefault(); $('pauseBtn').click(); }
});

// ---------- texture slots: apply ----------
function applySlot(k) {
  const S = SLOTS[k];
  if (k === 'road' || k === 'shoulder') {
    const m = k === 'road' ? roadMat : shoulderMat;
    for (const t of [S.diff, S.nor, S.arm]) t.repeat.set(1 / S.meters, 1 / S.meters); // UVs are meters
    Object.assign(m, { map: S.diff, normalMap: S.nor, roughnessMap: S.arm, aoMap: S.arm });
    m.normalScale.set(1, S.flipY ? -1 : 1); m.roughness = 1; m.needsUpdate = true;
  } else {
    const i = { grass: 0, dirt: 1, rock: 2, snow: 3 }[k], u = terrainMat.uniforms;
    u['tDiff' + i].value = S.diff; u['tNor' + i].value = S.nor; u['tArm' + i].value = S.arm;
    u.tScale.value.setComponent(i, 1 / S.meters); u.tFlip.value.setComponent(i, S.flipY ? -1 : 1);
  }
  renderSlotUI(k);
}
function merge(k, got) {
  const S = SLOTS[k];
  for (const m of ['diff', 'nor', 'arm']) if (got[m]) { S[m] = got[m]; S.real[m] = true; }
  if ('flipY' in got) S.flipY = !!got.flipY;
  S.notes = got.notes || [];
  applySlot(k);
}

// ---------- texture slots: UI ----------
const panel = $('slots');
function renderSlotUI(k) {
  const S = SLOTS[k];
  let el = $('slot-' + k);
  if (!el) {
    el = document.createElement('div'); el.className = 'slot'; el.id = 'slot-' + k;
    el.innerHTML = `<div class="slot-h"><b>${SLOT_INFO[k].label}</b>
      <label class="m">tile <input type="number" min="0.25" step="0.25" value="${S.meters}"> m</label></div>
      <div class="chips"></div>
      <label class="drop">Drop Poly Haven maps here, or tap to choose<input type="file" multiple accept="image/*"></label>
      <div class="note"></div>`;
    panel.appendChild(el);
    el.querySelector('input[type=number]').addEventListener('change', (e) => { const v = +e.target.value; if (v > 0) { S.meters = v; applySlot(k); } });
    const take = async (files) => { if (!files.length) return; el.classList.add('busy'); merge(k, await loadSlotFromFiles([...files])); el.classList.remove('busy'); };
    el.querySelector('input[type=file]').addEventListener('change', (e) => take(e.target.files));
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('over'); take(e.dataTransfer.files); });
  }
  el.querySelector('.chips').innerHTML = [['diff', 'Color'], ['nor', 'Normal (GL)'], ['arm', 'AO/Rough']]
    .map(([m, n]) => `<span class="chip ${S.real[m] ? 'on' : ''}">${n}${S.real[m] ? '' : ' · placeholder'}</span>`).join('');
  el.querySelector('.note').textContent = (S.notes || []).join(' ');
}
for (const k of Object.keys(SLOTS)) applySlot(k); // builds the slot UI in order
if (!hasSnow) $('slot-snow').style.display = 'none';
// sky slot
{
  const el = document.createElement('div'); el.className = 'slot';
  el.innerHTML = `<div class="slot-h"><b>Sky (HDRI)</b></div><div class="chips"><span class="chip" id="skyChip">Flat sky · placeholder</span></div>
    <label class="m" id="skyRow" hidden style="display:flex;gap:8px;align-items:center;margin:6px 0 8px">Sky brightness
      <input id="skyBright" type="range" min="0.15" max="1.2" step="0.01" value="0.42" style="flex:1;width:auto"> <span id="skyBrightVal">0.42</span></label>
    <label class="drop">Drop a Poly Haven .hdr (1k–2k)<input type="file" accept=".hdr"></label>`;
  panel.appendChild(el);
  const take = async (f) => { if (!f) return; const t = await loadHDR(URL.createObjectURL(f)); if (t) setSky(t); };
  el.querySelector('#skyBright').addEventListener('input', (e) => setSkyBrightness(+e.target.value));
  el.querySelector('input').addEventListener('change', (e) => take(e.target.files[0]));
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('over'); take(e.dataTransfer.files[0]); });
}
const skyHorizon = new THREE.Color(0xc9d6df);
function setSkyBrightness(v) {        // background only; haze follows so far hills still melt into the sky
  scene.backgroundIntensity = v;
  if (scene.background && scene.background.isTexture) scene.fog.color.copy(skyHorizon).multiplyScalar(v);
  $('skyBright').value = v; $('skyBrightVal').textContent = v.toFixed(2);
}
function setSky(t) {
  const sky = MAP.sky || {};
  scene.background = t; scene.environment = t; scene.backgroundBlurriness = 0;
  if (t.userData.analysis) {
    const { sun: dir, horizon } = t.userData.analysis;
    if (sky.rotate && scene.backgroundRotation) { dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), sky.rotate); scene.backgroundRotation.y = sky.rotate; scene.environmentRotation.y = sky.rotate; } // newer three.js only
    dir.y = Math.max(dir.y, 0.3); SUN_DIR.copy(dir.normalize());          // sun + shadows come from where the sun is in the photo
    skyHorizon.copy(horizon);                                             // distance haze = the sky's own horizon color
  } else scene.fog.color.set(0xc9d6df);
  hemi.intensity = 0.15; sun.intensity = sky.sunIntensity ?? 2.2; if (sky.sunColor) sun.color.set(sky.sunColor);
  renderer.toneMappingExposure = sky.exposure ?? SKY.exposure;
  setSkyBrightness(sky.brightness ?? 0.42);
  $('skyRow').hidden = false;
  $('skyChip').textContent = 'HDRI loaded'; $('skyChip').classList.add('on');
}
if (innerWidth > 900) document.body.classList.add('panel-open');
$('panelBtn').onclick = () => document.body.classList.toggle('panel-open');

// try the paths in config.js (silently keeps placeholders for anything missing)
for (const k of Object.keys(SLOT_INFO)) { const cfg = slotCfg(k); if (cfg) loadSlotFromConfig(cfg).then((got) => { if (Object.keys(got).length) merge(k, got); }); }
loadHDR((MAP.sky && MAP.sky.hdr) || SKY.hdr).then((t) => {
  if (t) setSky(t);
  else if (MAP.sky && MAP.sky.hdr) { $('skyChip').textContent = 'Sky failed to load: ' + (loadHDR.lastError || 'file missing'); $('skyChip').style.color = '#ffb4a0'; }
});

// ---------- loop ----------
function resize() {
  const w = $('view').clientWidth, h = $('view').clientHeight;
  renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); drawProfile();
}
new ResizeObserver(resize).observe($('view'));
resize();
let s = sampleRoute(R, ride.d); placeRider(s); updateCamera(s, true);
$('loading').remove();
const clock = new THREE.Clock();
let lowHinted = false;
const qn = { auto: 'Auto', low: 'Low', medium: 'Medium', high: 'High' };
$('qualBtn').textContent = 'Quality: ' + qn[QNAME];
$('qualBtn').onclick = () => { setQualityName(LEVELS[(LEVELS.indexOf(QNAME) + 1) % LEVELS.length]); location.reload(); };
$('qualHint').querySelector('button').onclick = () => { setQualityName('low'); location.reload(); };
let pt = 0, lt = 1;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!ride.paused) s = step(dt); else s = sampleRoute(R, ride.d);
  placeRider(s); updateCamera(s, false);
  if ((pt += dt) > 0.1) { pt = 0; hud(s); drawProfile(); }
  if ((lt += dt) > 0.25) { lt = 0; updateTerrainLOD(camera.position); forest.update(camera.position, rider.position, VIEW, Q.treeShadowR);
    $('fps').textContent = `${Math.round(scaler.fps)} fps · ${Math.round(scaler.scale * 100)}%`; }
  if (QNAME !== 'high') scaler.tick(clock.elapsedTime > 2 ? dt : 0.0001); // ignore the loading hitch
  if (scaler.struggling && QNAME === 'auto' && !lowHinted) { lowHinted = true; $('qualHint').hidden = false; }
  renderer.render(scene, camera);
});
} // end startGame
