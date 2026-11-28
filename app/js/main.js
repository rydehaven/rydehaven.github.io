// main.js — the shared ENGINE: start screen, then builds the chosen map (maps/*.js) and runs the ride.
import * as THREE from 'three';
import { buildWorld, buildRoute, sampleRoute, heightAt, gridIndex, fbm } from './world.js?v=76';
import { SLOT_INFO, TEXLIB, SKY } from './config.js?v=76';
import { MAPS } from '../maps/index.js?v=76';
import { buildForest } from './trees.js?v=76';
import { placeholder, loadSlotFromConfig, loadSlotFromFiles, loadHDR, setAnisotropy } from './textures.js?v=76';
import { makeTerrainMaterial } from './terrainMaterial.js?v=76';
import { buildWalls } from './walls.js?v=76';
import { buildFinish, buildKomMarkers } from './finish.js?v=76';
import { makeRideAudio, playSfx, stopMusic, toggleMute, getSound, setSound } from './audio.js?v=76';
import { makePauseMenu } from './pausemenu.js?v=76';
import { makeRemote } from './remote.js?v=76';
import { layoutHouses } from './housegen.js?v=76';
import { buildHouses } from './houses.js?v=76';
import { buildBike } from './bike.js?v=76';
import { getProfile, getBikeChoice, bikeStats, getRideOptions, workoutPlan, WORKOUTS, zoneColor, noteFtp, bodyDrag, BASE_CDA } from './settings.js?v=76';
import { showHome } from './home.js?v=76';
import { loadRider } from './rider.js?v=76';
import { RIDING_STYLES } from './riderpose.js?v=76';
import { makeKomTracker, saveEffort, efforts, climbStats, fmtClock } from './settings.js?v=76';
import { trainer, setErg, setSim } from './trainer.js?v=76';
import { initDevices } from './devices.js?v=76';
import { getQualityName, setQualityName, getPreset, makeScaler, LEVELS } from './quality.js?v=76';
import { mi, mph, ft, ftStr, shortDist } from './units.js?v=76';
import { getKit, paintById, addMeters } from './kits.js?v=76';
import { heightScale } from './rider.js?v=76';

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
stopMusic(1.2);
const AUD = makeRideAudio();
const sndLabel = () => { $('sndBtn').textContent = getSound().muted ? 'Sound: Off' : 'Sound: On'; };
sndLabel(); $('sndBtn').onclick = () => { toggleMute(); sndLabel(); };
// shown until a trainer is paired: power only comes from the trainer
$('pairMsg').textContent = 'Rydehaven runs on your power. Wake your smart trainer, pair it, and start pedalling.';
let lastBeep = 0, lastLap = 0;
$('mapsBtn').onclick = () => { location.hash = ''; };
$('mapsBtn').textContent = 'Home';
$('mapName').textContent = MAP.name; $('mapName').title = MAP.worldName ? `${MAP.worldName} · ${MAP.name}` : MAP.name;

// ---------- renderer / scene ----------
const QNAME = getQualityName(), Q = getPreset(QNAME);           // graphics quality (Auto / Low / Medium / High)
const renderer = new THREE.WebGLRenderer({ antialias: Q.msaa, powerPreference: 'high-performance' });
let BASE_DPR = Math.min(devicePixelRatio, Q.dprMax);
renderer.setPixelRatio(BASE_DPR);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = Q.shadows;
renderer.shadowMap.type = Q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
const scaler = makeScaler(Q, (k) => { renderer.setPixelRatio(BASE_DPR * k); resize(); }); // auto resolution
$('view').appendChild(renderer.domElement);
// if the browser takes the graphics away (GPU switch, too many open 3D views), say so and offer a reload instead of freezing
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault(); renderer.setAnimationLoop(null);
  const q = $('qualHint'); q.hidden = false; q.firstChild.textContent = 'Your computer reset the 3D graphics. ';
  const btn = q.querySelector('button'); btn.textContent = 'Reload'; btn.onclick = () => location.reload();
});
if (renderer.getContext().isContextLost()) throw new Error('Your computer’s 3D graphics aren’t available right now. Close other programs that use 3D graphics, then restart Rydehaven.');
setAnisotropy(renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
const SKYCOL = new THREE.Color(MAP.sky.color);
scene.background = SKYCOL;
let VIEW = MAP.sky.fogFar * Q.fogScale;                          // view distance for this quality
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
      rot: Math.random() * 6.283, tint: Math.random(), variant: Math.floor(Math.random() * 6) });   // 0-5: three pines and three firs, mixed
  }
}
const forest = buildForest({ scene, placements, aniso: renderer.capabilities.getMaxAnisotropy(), msaa: Q.msaa });
buildHouses({ scene, layout: HOUSES, map: MAP, lib: TEXLIB, loadSlot: loadSlotFromConfig, aniso: renderer.capabilities.getMaxAnisotropy() });

// ---------- stone retaining walls + parapets (maps that ask for them) ----------
buildWalls({ scene, R, T, map: MAP, lib: TEXLIB, loadSlot: loadSlotFromConfig, aniso: renderer.capabilities.getMaxAnisotropy() });

// ---------- start/finish: race furniture, or a simple arch (it also hides the loop's one UV seam) ----------
try { buildKomMarkers({ scene, R, map: MAP }); } catch (e) { console.warn('kom markers', e); }
if (MAP.finish) buildFinish({ scene, R, map: MAP });
else {
  const s0 = sampleRoute(R, 0), rx = -s0.fz, rz = s0.fx, mat = new THREE.MeshStandardMaterial({ color: 0x2ec4b6, roughness: 0.6 });
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
let bike = buildBike({ ...BIKE_CHOICE, paint: paintById(BIKE_CHOICE.color).color });
rider.add(bike.group);
rider.traverse((o) => (o.castShadow = true));
let riderBody = null;
const MYPROFILE = getProfile();
rider.scale.setScalar(heightScale(MYPROFILE.cm));                                // your height: a taller rider on a bigger bike
loadRider({ kit: getKit(), cm: MYPROFILE.cm, kg: MYPROFILE.kg, anisotropy: renderer.capabilities.getMaxAnisotropy() })
  .then((rb) => { riderBody = rb; rider.add(rb.group); })
  .catch((e) => console.error('rider failed to load', e));
scene.add(rider);

// ---------- ride physics: power -> speed, using the spline's gradient ----------
const PROFILE = getProfile(), OPTS = getRideOptions(), PMAX = Math.max(600, Math.ceil((PROFILE.ftp * 2.4) / 50) * 50);
const ride = { d: 0, v: 0, P: 0, mt: 0, lane: 1.1, mass: PROFILE.kg + BIKE_STATS.kg, CdA: BASE_CDA * bodyDrag(PROFILE) + (BIKE_STATS.CdA - BASE_CDA), Crr: 0.004, paused: false, cam: 0, t: 0, E: 0, finished: false };
const RACE_CFG = OPTS.mode === 'race' ? { laps: OPTS.laps || (MAP.race && MAP.race.laps) || 3, start: OPTS.raceStart || 0, name: OPTS.raceName || 'Race' } : null, RACE_TOTAL = RACE_CFG ? RACE_CFG.laps * R.length : Infinity;
// workout (ERG): target power from the plan and your FTP, sent to the trainer
const WK = OPTS.mode === 'workout' ? { ...WORKOUTS[OPTS.workout], plan: workoutPlan(OPTS.workout), bias: 0, done: false } : null;
if (WK) WK.total = WK.plan[WK.plan.length - 1].t1;
function wkAt(t) {
  const i = WK.plan.findIndex((iv) => t < iv.t1); if (i < 0) return null;
  const iv = WK.plan[i], f = (t - iv.t0) / (iv.t1 - iv.t0);
  return { i, iv, share: iv.p0 + (iv.p1 - iv.p0) * f, left: iv.t1 - t };
}
const wkTarget = () => { const w = wkAt(ride.mt); return w ? Math.max(0, Math.round(PROFILE.ftp * w.share + WK.bias)) : ride.P; };
// scheduled race: wait on the start line until the clock says go
let preRace = !!(RACE_CFG && RACE_CFG.start && RACE_CFG.start > Date.now()), rolling = false;   // rolling: you've pedalled off the start line
const LATE = RACE_CFG && RACE_CFG.start && !preRace ? Math.max(0, Math.min(90, (Date.now() - RACE_CFG.start) / 1000)) : 0;
if (LATE) ride.t = LATE;                                                         // joined after the gun: the race clock is already running
ride.finishT = null;
// the race field. No computer riders: until real riders can join online, you ride the race on your own.
// (field.js still draws other riders, ready for when online racing arrives)
const FIELD = null;
function raceCountdown() {
  const left = (RACE_CFG.start - Date.now()) / 1000, b = $('finishBanner');
  if (left > 0) {
    const c = Math.ceil(left); if (c <= 5 && c !== lastBeep) { lastBeep = c; playSfx('beep'); }
    b.querySelector('b').textContent = left > 10 ? fmtTime(Math.ceil(left)) : String(Math.ceil(left));
    b.querySelector('span').textContent = `${RACE_CFG.name} starts in`; b.hidden = false; return true;
  }
  preRace = false; rolling = false; ride.t = 0; ride.d = 0; ride.E = 0; komJump = true; playSfx('go'); banner('GO!', `${RACE_CFG.name} · ${RACE_CFG.laps} ${RACE_CFG.laps === 1 ? 'lap' : 'laps'}`);
  return false;
}
// FTP auto-detection: best 20-minute average power, x 0.95, raises the estimate
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
// ---------- KOMs: time every named climb, save to the all-time leaderboard ----------
const KOM = makeKomTracker(MAP, R);
const KSTAT = Object.fromEntries(KOM.climbs.map((c) => [c.id, climbStats(R, c)]));
let komJump = true;
function komCheck() { try { komCheck1(); } catch (e) { console.error('KOM', e); } }   // KOM timing can never stop the ride
function komCheck1() {
  const L = R.length, pos = ((ride.d % L) + L) % L;
  for (const e of KOM.update(pos, ride.t, ride.E, komJump)) {
    const w = e.energy / Math.max(1, e.t), rider = PROFILE.name || 'You';
    const r = saveEffort(e.climb.id, { rider, t: e.t, w: Math.round(w), wkg: +(w / PROFILE.kg).toFixed(2), date: Date.now() });
    playSfx(r.rank === 1 || r.pb ? 'record' : 'komFinish');
    banner(`${e.climb.name} · ${fmtClock(e.t)}`, r.rank === 1 ? 'Fastest ever: you hold the KOM!' : r.pb ? `New personal best · #${r.rank} all time` : `#${r.rank} all time · your best ${fmtClock(r.prevBest)}`);
  }
  if (!komJump && KOM.started.length) playSfx('komStart');
  komJump = false;
}

// ---------- riding position: picked from the road and your effort, blended smoothly ----------
// seated on the hoods, seated climbing on the tops, out of the saddle on steep bits / hard surges,
// sprinting in the drops, tucked on fast descents, low in the drops when going fast on the flat
const POSE = { stand: 0, tuck: 0, tops: 0, drops: 0, upright: 0, lean: 0, effort: 0.7 };
let poseName = 'seated', poseHold = 0, standClock = 0;
function pickPose(dt, s) {
  const p = ride.P / Math.max(100, PROFILE.ftp), g = s.grade, v = ride.v, coasting = ride.P <= 5;
  standClock += dt;
  let want = 'seated';
  if (g > 0.03) {                                                                // climbing: always on the hoods
    if (p > 1.4) want = 'standing';                                               // only a hard surge gets you out of the saddle
    else want = 'climb';
  }
  else if (p > 1.6 || (p > 1.3 && v > 11)) want = 'sprint';                      // sprints in the drops only off the climbs
  else if ((g < -0.025 && v > 11 && p < 0.5) || (coasting && v > 10)) want = 'descend';
  else if (v > 12.5 && p > 0.6) want = 'drops';
  if (want !== poseName && (poseHold -= dt) <= 0) { poseName = want; poseHold = 1.2; }   // no flickering between positions
  const T = RIDING_STYLES[poseName], k = Math.min(1, dt * (poseName === 'sprint' ? 4 : 2.2));
  for (const key of ['stand', 'tuck', 'tops', 'drops', 'upright']) POSE[key] += ((T[key] || 0) - POSE[key]) * k;
  // out of the saddle the bike rocks under you with each pedal stroke (more in a sprint)
  POSE.effort += (p - POSE.effort) * Math.min(1, dt * 1.5);
  const rockAmp = POSE.stand * (0.15 + 0.13 * POSE.drops);                     // ~9° standing, ~16° in a sprint: the bike is thrown side to side
  POSE.lean += (-Math.cos(bike.crank) * rockAmp - POSE.lean) * Math.min(1, dt * 12);
  return POSE;
}
function step(dt) {
  const s = sampleRoute(R, ride.d), th = Math.atan(s.grade);
  if (preRace && raceCountdown()) { ride.v = 0; bike.update(dt, 0, false); if (riderBody) riderBody.update(bike.crank, ride.t); return s; }
  trackFtp(dt);
  ride.draft = FIELD ? FIELD.draftFor(ride.d, ride.lane) : 0;                  // sitting on a wheel saves up to a third of your drag
  const F = ride.mass * 9.81 * (ride.Crr * Math.cos(th) + Math.sin(th)) + 0.5 * 1.225 * ride.CdA * (1 - ride.draft) * ride.v * ride.v;
  if (WK && !WK.done) {
    if (ride.mt >= WK.total) { WK.done = true; banner('Workout complete', `${WK.name} · ${fmtTime(WK.total)}`); }
  }
  const a = (ride.P / Math.max(ride.v, 1) - F) / ride.mass;
  ride.v = Math.max(0, ride.v + a * dt);
  if (!rolling) { if (ride.P > 5) rolling = true; else ride.v = 0; }             // on the start line you stay put until you pedal
  const dBefore = ride.d;
  ride.d += ride.v * dt; ride.t += dt; ride.E += ride.P * dt;
  if (ride.P > 5) ride.mt += dt;                                                  // your clock only runs while you pedal
  if (RACE_CFG && ride.finishT === null && dBefore < RACE_TOTAL && ride.d >= RACE_TOTAL) { ride.finishT = ride.t - dt + ((RACE_TOTAL - dBefore) / Math.max(1e-6, ride.d - dBefore)) * dt; ride.finishE = ride.E; }
  komCheck();
  useTrainer(dt, s);
  bike.update(dt, ride.v, ride.P > 5, trainer.connected && trainer.cadence !== null ? trainer.cadence : null);
  if (riderBody) riderBody.update(bike.crank, ride.t, pickPose(dt, s));
  if (RACE_CFG && !ride.finished && ride.d >= RACE_TOTAL) { ride.finished = true; showFinish(); }
  const lapNow = Math.floor(ride.d / R.length); if (lapNow > lastLap && !ride.finished) playSfx('lap'); lastLap = lapNow;
  return s;
}
const fmtTime = (t) => { const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, sec = Math.floor(t % 60); return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0'); };
function banner(title, sub) {
  const b = $('finishBanner'); b.querySelector('b').textContent = title; b.querySelector('span').textContent = sub;
  b.hidden = false; setTimeout(() => { b.hidden = true; }, 7000);
}
let sndCrank = 0, sndRpm = 0;                                                    // cadence for the pedalling sound
function showFinish() {
  playSfx('finish');
  if (!FIELD) { banner('Finished!', `${RACE_CFG.name} · ${mi(RACE_TOTAL)} mi in ${fmtTime(ride.finishT ?? ride.t)}`); return; }
  const place = FIELD.standings(playerState()).findIndex((r) => r.me) + 1;
  banner(place === 1 ? 'You won!' : `${ordinal(place)} place`, `${RACE_CFG.name} · ${fmtTime(ride.finishT ?? ride.t)}`);
  setTimeout(() => { $('results').hidden = false; drawResults(); }, 2500);
}
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const playerState = () => ({ d: ride.d, lane: ride.lane, v: ride.v, finishT: ride.finishT, E: ride.E, finishE: ride.finishE });
const escH = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const flagE = (cc) => (/^[A-Z]{2}$/.test(cc || '') ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '');
function drawResults() {
  if ($('results').hidden || !FIELD) return;
  const st = FIELD.standings(playerState()), me = st.findIndex((r) => r.me) + 1;
  $('resTitle').innerHTML = me === 1 ? 'Winner! <span>1st</span>' : `You finished <span>${ordinal(me)}</span>`;
  $('resSub').textContent = `${RACE_CFG.name} · ${mi(RACE_TOTAL)} mi · ${st.length} riders`;
  const winT = st[0].finishT;
  $('resRows').innerHTML = st.map((r, i) => {
    const t = r.finishT !== null ? (i === 0 ? fmtTime(r.finishT) : '+' + fmtTime(r.finishT - winT)) : `${mi(Math.max(0, RACE_TOTAL - r.d), 1)} mi to go`;
    const wk = r.finishT !== null ? (r.E / Math.max(1, r.finishT) / (r.me ? PROFILE.kg : r.kg)).toFixed(1) : '';
    return `<tr class="${r.me ? 'me' : ''}"><td>${i + 1}</td><td>${flagE(r.cc)} ${escH(r.name)}</td><td>${t}</td><td>${wk}</td></tr>`;
  }).join('');
}
$('resRide').onclick = () => { $('results').hidden = true; };
$('resHome').onclick = () => { location.hash = ''; };
// live positions: you, the leaders, and the riders right around you, with time gaps
function drawBoard() {
  if (!FIELD) return;
  const st = FIELD.standings(playerState()), mi0 = st.findIndex((r) => r.me), v = Math.max(3, ride.v);
  $('rbPos').textContent = `${mi0 + 1}/${st.length}`; $('rbOf').textContent = preRace ? 'On the grid' : ride.draft > 0.12 ? 'In the draft' : 'Position';
  const show = new Set([0, 1, 2, mi0 - 2, mi0 - 1, mi0, mi0 + 1, mi0 + 2].filter((i) => i >= 0 && i < st.length));
  let html = '', last = -1;
  for (const i of [...show].sort((a, b) => a - b)) {
    if (last >= 0 && i > last + 1) html += '<div class="rb-row"><em>⋯</em><span></span><span></span></div>';
    const r = st[i], gap = r.me ? '' : r.finishT !== null ? 'finished' : (() => { const s = (r.d - ride.d) / v, a = Math.abs(s); return (s >= 0 ? '+' : '−') + (a < 60 ? a.toFixed(1) + 's' : fmtTime(a)); })();
    html += `<div class="rb-row${r.me ? ' me' : ''}"><em>${i + 1}</em><span>${flagE(r.cc)} ${escH(r.me ? 'You' : r.name)}</span><s>${gap}</s></div>`;
    last = i;
  }
  $('rbRows').innerHTML = html;
  const hb = $('hud').getBoundingClientRect(); if (innerWidth > 700) $('raceBoard').style.top = Math.round(hb.bottom + 10) + 'px';
}
if (FIELD) $('raceBoard').hidden = false;

// ---------- camera ----------
const camPos = new THREE.Vector3(), look = new THREE.Vector3();
function placeOnRoad(g, s, lane) {
  const rx = -s.fz, rz = s.fx;
  g.position.set(s.x + rx * lane, s.y + camber(lane) + ROAD_LIFT + 0.004, s.z + rz * lane); // tyres on the asphalt, not in it
  g.rotation.set(0, Math.atan2(s.fx, s.fz), 0);
  g.rotateX(-Math.atan(s.grade));
}
function placeRider(s) {
  placeOnRoad(rider, s, ride.lane);
  bike.group.rotation.z = POSE.lean;                                             // only the bike rocks; the rider's body moves on its own
  sun.position.copy(rider.position).addScaledVector(SUN_DIR, 300); sun.target.position.copy(rider.position);
}
// cameras: 0 chase (close behind) · 1 sideline (roadside spectator, pans as you pass, then hops ahead)
//          2 front (riding backwards in front of you) · 3 side (alongside, drivetrain side) · 4 overhead (helicopter, close)
const CAMS = ['Chase', 'Sideline', 'Front', 'Side', 'Overhead'];
const SPOT = { d: -1e9, p: new THREE.Vector3() };
const CAMF = new THREE.Vector2(0, 1);                    // smoothed travel direction: cameras turn smoothly through bends
let camY = null, sideSign = 1, sideHold = 0;
function setFov(f) { if (Math.abs(camera.fov - f) > 0.01) { camera.fov = f; camera.updateProjectionMatrix(); } }
function updateCamera(s, snap) {
  const P = rider.position;
  if (snap) CAMF.set(s.fx, s.fz); else { CAMF.x += (s.fx - CAMF.x) * 0.06; CAMF.y += (s.fz - CAMF.y) * 0.06; } CAMF.normalize();
  const fx = CAMF.x, fz = CAMF.y, rx = -fz, rz = fx;   // forward and right (chain side)
  const tgt = new THREE.Vector3(), lk = new THREE.Vector3(); let fov = 60, clear = 0.8;
  if (ride.cam === 0) {                                   // chase: higher up, so you can pick out your rider in a bunch
    const ahead = sampleRoute(R, ride.d + 12);
    tgt.set(P.x - fx * 4.8, P.y + 2.7, P.z - fz * 4.8); clear = 1.6;
    lk.set(ahead.x, P.y + (ahead.y - P.y) * 0.5 + 0.25, ahead.z);
  } else if (ride.cam === 1) {                            // sideline: stand at the roadside, follow the rider with a zoom lens
    if (snap || ride.d - SPOT.d > 22 || SPOT.d - ride.d > 80) {
      SPOT.d = ride.d + 45; const q = sampleRoute(R, SPOT.d), off = WORLD.roadHalf + WORLD.shoulder + 2.5;
      const a = [q.x - q.fz * off, q.z + q.fx * off], b = [q.x + q.fz * off, q.z - q.fx * off];
      const [x, z] = heightAt(T, a[0], a[1]) <= heightAt(T, b[0], b[1]) ? a : b;       // the lower (open) side of the road
      SPOT.p.set(x, heightAt(T, x, z) + 1.7, z); snap = true;
    }
    tgt.copy(SPOT.p); lk.set(P.x, P.y + 0.9, P.z);
    fov = THREE.MathUtils.clamp(2 * Math.atan(1.6 / Math.max(1, tgt.distanceTo(lk))) * 180 / Math.PI, 14, 55);
  } else if (ride.cam === 2) {                            // front, looking back at the rider
    tgt.set(P.x + fx * 4.4, P.y + 1.4, P.z + fz * 4.4);
    lk.set(P.x, P.y + 1.0, P.z);
  } else if (ride.cam === 3) {                            // side view, from whichever side of the road is open
    const hr = heightAt(T, P.x + rx * 4.8, P.z + rz * 4.8), hl = heightAt(T, P.x - rx * 4.8, P.z - rz * 4.8);
    const want = hr <= hl + 0.3 ? 1 : -1;
    if (want !== sideSign && (sideHold -= 1) <= 0) { sideSign = want; sideHold = 90; snap = true; } else if (want === sideSign) sideHold = 90;
    tgt.set(P.x + rx * 4.8 * sideSign + fx * 0.2, P.y + 1.2, P.z + rz * 4.8 * sideSign + fz * 0.2);
    lk.set(P.x + fx * 0.2, P.y + 0.85, P.z + fz * 0.2);
  } else {                                                // overhead, close enough to see the rider
    const ahead = sampleRoute(R, ride.d + 8);
    tgt.set(P.x - fx * 14, P.y + 17, P.z - fz * 14); clear = 3;
    lk.set(ahead.x, ahead.y, ahead.z);
  }
  // keep the camera above the ground, but ease up and down instead of popping
  const minY = heightAt(T, tgt.x, tgt.z) + clear, wantY = Math.max(tgt.y, minY);
  camY = snap || camY === null || ride.cam === 1 ? wantY : camY + (wantY - camY) * 0.12;
  tgt.y = Math.max(camY, minY - 0.3);
  setFov(fov);
  camPos.copy(tgt);                                       // the camera rides with you: no lag, so no jitter
  camera.position.copy(camPos); look.copy(lk); camera.lookAt(look);
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
// (clicking the profile to jump along the course was a testing tool; removed)
$('climb').textContent = RACE_CFG
  ? `${mi(R.length)} mi lap · ${RACE_CFG.laps} ${RACE_CFG.laps === 1 ? 'lap' : 'laps'} (${mi(RACE_TOTAL)} mi) · ${ftStr(R.ascent)} ft per lap`
  : `${mi(R.length)} mi loop · ${ftStr(R.ascent)} ft climbing` + (R.hairpins ? ` · ${R.hairpins} hairpins` : '');
if (RACE_CFG) { $('lapMet').hidden = false; $('dstLabel').textContent = 'To go'; }
function climbStatus() { // [mode, html]: a live KOM panel on a climb, otherwise the next climb or the finish
  if (RACE_CFG && ride.finishT !== null) return ['msg', escH(`Finished in ${fmtTime(ride.finishT)}`)];
  if (!KOM.climbs.length) return RACE_CFG && RACE_TOTAL - ride.d < 3000 ? ['msg', `<i>Finish</i> ${mi(Math.max(0, RACE_TOTAL - ride.d))} mi`] : ['', ''];
  const L = R.length, pos = ((ride.d % L) + L) % L, cur = KOM.current(pos, ride.t);
  if (cur) {
    const c = KOM.climbs.find((x) => x.id === cur.id), len = c ? c.b - c.a : cur.toGo + 1, f = Math.max(0, Math.min(1, 1 - cur.toGo / len)), best = efforts(cur.id)[0];
    let delta = '';
    if (best && f > 0.05) { const d = cur.elapsed - best.t * f; delta = `<em class="${d <= 0 ? 'ahead' : 'behind'}">${d <= 0 ? '−' : '+'}${fmtClock(Math.abs(d))}</em>`; }
    return ['live', `<div class="kn-top"><i>KOM</i><b>${escH(cur.name)}</b><span>${fmtClock(cur.elapsed)}</span></div>
      <div class="kn-bar"><s style="width:${(f * 100).toFixed(1)}%"></s></div>
      <div class="kn-sub"><span>${shortDist(cur.toGo)} to go</span><span>${best ? `Record ${fmtClock(best.t)} ${delta}` : 'No record yet'}</span></div>`];
  }
  let next = null, bd = Infinity;
  for (const c of KOM.climbs) { let dd = c.a - pos; if (dd < 0) dd += L; if (dd < bd || (dd === bd && c.b - c.a > next.b - next.a)) { bd = dd; next = c; } }
  if (RACE_CFG && ride.d + bd >= RACE_TOTAL) return ['msg', `<i>Finish</i> ${mi(RACE_TOTAL - ride.d)} mi`];
  const st = KSTAT[next.id];
  return bd < 3000 ? ['msg', `<i>KOM ahead</i> ${escH(next.name)} in ${mi(bd)} mi · ${mi(st.len, 2)} mi at ${(st.avg * 100).toFixed(1)}%`] : ['', ''];
}
let climbHtml = '';
function showClimb() {
  const [mode, html] = climbStatus(), el = $('climbNow');
  if (html !== climbHtml) { climbHtml = html; el.innerHTML = html; }
  if (el.dataset.mode !== mode) el.dataset.mode = mode;
}

let gbg = '', zbg = '';
function hud(s) {
  const tc = trainer.connected;
  const needPair = !tc && !ride.finished; if ($('pairPrompt').hidden === needPair) $('pairPrompt').hidden = !needPair;   // power only comes from a trainer
  $('cadMet').hidden = !(tc && trainer.cadence !== null); if (tc && trainer.cadence !== null) $('hCad').textContent = Math.round(trainer.cadence);
  $('hrMet').hidden = !(trainer.hrConnected && trainer.hr); if (trainer.hrConnected && trainer.hr) $('hHr').textContent = trainer.hr;
  $('hPow').textContent = Math.round(ride.P);
  $('hWkg').textContent = (ride.P / PROFILE.kg).toFixed(1);
  $('hTime').textContent = fmtTime(RACE_CFG ? ride.t : ride.mt);                 // races: the race clock; otherwise time spent pedalling
  const zc = zoneColor(ride.P / Math.max(100, PROFILE.ftp)); if (zbg !== zc) { zbg = zc; $('zoneBar').style.background = zc; }
  if (WK) drawWorkout();
  $('hSpd').textContent = mph(ride.v);
  $('hGrd').textContent = (s.grade * 100).toFixed(1);
  const gc = s.grade > 0.08 ? '#e0452b' : s.grade > 0.05 ? '#f07a2b' : s.grade > 0.02 ? '#f3c02b' : s.grade > -0.02 ? '#9cc65a' : '#5aa7c6';
  if (gbg !== gc) { gbg = gc; $('gbGrade').style.background = gc; $('gbGrade').style.color = s.grade > 0.05 ? '#fff' : '#0f1b2d'; }
  $('hDst').textContent = RACE_CFG ? mi(Math.max(0, RACE_TOTAL - ride.d), 2) : mi(ride.d, 2);
  if (RACE_CFG) $('hLap').textContent = `${Math.min(RACE_CFG.laps, Math.floor(ride.d / R.length) + 1)}/${RACE_CFG.laps}`;
  showClimb();
  drawBoard(); if (FIELD && ride.finishT !== null) drawResults();
  $('hEle').textContent = ftStr(s.y);
}

// ---------- workout panel: current interval, time left, next step, and the whole session as zone blocks ----------
const wkc = $('wkChart'), wctx = wkc.getContext('2d');
if (WK) { $('wkt').hidden = false; $('wkName').textContent = WK.name; }
function drawWorkout() {
  const w = WK.done ? null : wkAt(ride.mt);
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
    wctx.globalAlpha = ride.mt > iv.t1 ? 0.4 : 1; wctx.fillStyle = zoneColor((iv.p0 + iv.p1) / 2);
    wctx.beginPath(); wctx.moveTo(x0, H); wctx.lineTo(x0, y0); wctx.lineTo(x1 - 0.5, y1); wctx.lineTo(x1 - 0.5, H); wctx.fill();
  }
  wctx.globalAlpha = 1; const px = Math.min(1, ride.mt / WK.total) * W;
  wctx.fillStyle = '#fff'; wctx.fillRect(px - 1, 0, 2, H);
}

// ---------- controls ----------
function setCam(i) {
  ride.cam = i; $('camBtn').textContent = 'Camera: ' + CAMS[i];
  updateCamera(sampleRoute(R, ride.d), true);
}
$('camBtn').onclick = () => setCam((ride.cam + 1) % CAMS.length);
// ---------- the ride menu (pause screen): garage, devices, settings, chat ----------
// swap the bike live from the menu. Paint is just a colour; frame and wheels change weight and drag (free rides only)
function applyBike(c, paintOnly) {
  if (paintOnly) { bike.setPaint(paintById(c.color).color); return; }
  if (RACE_CFG) return;
  const old = bike; rider.remove(old.group);
  old.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  for (const m of Object.values(old.mats || {})) if (m && m.dispose) m.dispose();
  bike = buildBike({ ...c, paint: paintById(c.color).color });
  bike.group.traverse((o) => (o.castShadow = true));
  rider.add(bike.group);
  const st = bikeStats(c); ride.mass = PROFILE.kg + st.kg; ride.CdA = BASE_CDA * bodyDrag(PROFILE) + (st.CdA - BASE_CDA);
}
let REMOTE = null;
const MENU = makePauseMenu({
  remote: () => REMOTE,
  race: !!RACE_CFG, raceName: RACE_CFG ? RACE_CFG.name : MAP.name,
  room: RACE_CFG ? 'race-' + Math.round((RACE_CFG.start || 0) / 60000) + '-' + MAP.id : 'ride-' + MAP.id,
  setPaused: (v) => { ride.paused = v; },
  cams: CAMS, getCam: () => ride.cam, setCam,
  applyBike, applyKit: (k) => { if (riderBody && riderBody.setKit) riderBody.setKit(k); },
  quality: { get: getQualityName, set: (n) => applyQualityLive(n) },
  sound: { get: getSound, set: (o) => { setSound(o); sndLabel(); } },
  leave: () => { location.hash = ''; },
});
// ---------- Rydehaven Remote: live stats to a phone, camera and emotes back ----------
let remoteToasted = false;
const EMOTES = { thumbs: '👍', party: '🎉', wave: '👋', fire: '🔥', strong: '💪', hands: '🙌' };
const emoteEl = document.createElement('div'); emoteEl.id = 'emote'; emoteEl.hidden = true; document.body.appendChild(emoteEl);
let emoteUntil = 0;
function showEmote(k) { if (!EMOTES[k]) return; emoteEl.textContent = EMOTES[k]; emoteEl.hidden = false; emoteEl.classList.remove('pop'); void emoteEl.offsetWidth; emoteEl.classList.add('pop'); emoteUntil = performance.now() + 3200; }
const emoteV = new THREE.Vector3();
function placeEmote() {
  if (emoteEl.hidden) return;
  if (performance.now() > emoteUntil) { emoteEl.hidden = true; return; }
  emoteV.copy(rider.position); emoteV.y += 2.3; emoteV.project(camera);
  if (emoteV.z > 1) { emoteEl.style.opacity = '0'; return; }
  emoteEl.style.opacity = ''; emoteEl.style.left = ((emoteV.x + 1) / 2 * innerWidth) + 'px'; emoteEl.style.top = ((1 - emoteV.y) / 2 * innerHeight) + 'px';
}
function remoteState() {
  const L = R.length, pos = ((ride.d % L) + L) % L, sp = sampleRoute(R, ride.d), cur = KOM.current(pos, ride.t);
  let kom = null;
  if (cur) { const c = KOM.climbs.find((x) => x.id === cur.id), len = c ? c.b - c.a : cur.toGo + 1, best = efforts(cur.id)[0];
    kom = { n: cur.name, e: Math.round(cur.elapsed), tg: Math.round(cur.toGo), f: +Math.max(0, Math.min(1, 1 - cur.toGo / len)).toFixed(3), b: best ? Math.round(best.t) : null }; }
  else { let nx = null, bd = Infinity; for (const c of KOM.climbs) { let dd = c.a - pos; if (dd < 0) dd += L; if (dd < bd) { bd = dd; nx = c; } } if (nx) kom = { n: nx.name, in: Math.round(bd) }; }
  return { p: Math.round(ride.P), w: +(ride.P / PROFILE.kg).toFixed(1), hr: trainer.hrConnected && trainer.hr ? trainer.hr : null, c: trainer.connected && trainer.cadence !== null ? Math.round(trainer.cadence) : null,
    v: +ride.v.toFixed(2), d: Math.round(ride.d), f: +(pos / L).toFixed(4), g: +sp.grade.toFixed(3), y: Math.round(sp.y), el: Math.round(RACE_CFG ? ride.t : ride.mt),
    cam: ride.cam, pz: ride.paused ? 1 : 0, tc: trainer.connected ? 1 : 0, kom,
    race: RACE_CFG ? { n: RACE_CFG.name, lap: Math.min(RACE_CFG.laps, Math.floor(ride.d / L) + 1), laps: RACE_CFG.laps, tg: Math.round(Math.max(0, RACE_TOTAL - ride.d)), st: RACE_CFG.start, fin: ride.finished ? 1 : 0, ft: ride.finishT !== null && ride.finishT !== undefined ? Math.round(ride.finishT) : null } : null };
}
{
  const N = 160, pts = [], elev = [];
  for (let i = 0; i < N; i++) { const q = sampleRoute(R, (i / N) * R.length); pts.push([q.x, q.z]); elev.push(q.y); }
  REMOTE = makeRemote({
    route: { name: MAP.name, length: R.length, pts, elev, climbs: (MAP.climbs || []).map((c) => ({ n: c.name, a: c.from, b: c.to })) },
    getState: remoteState,
    onCmd: (c) => {
      if (c.a === 'cam' && Number.isInteger(c.i) && c.i >= 0 && c.i < CAMS.length) setCam(c.i);
      if (c.a === 'emote') showEmote(c.k);
    },
    onChange: () => { MENU.refreshRemote(); if (REMOTE && REMOTE.linked && !remoteToasted) { remoteToasted = true; MENU.notice('Phone linked: Rydehaven Remote is live'); } if (REMOTE && !REMOTE.linked) remoteToasted = false; },
  });
}
$('pauseBtn').textContent = 'Menu';
$('pauseBtn').onclick = () => MENU.toggle();
$('chatBtn').onclick = () => MENU.toggle('chat');

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || document.querySelector('dialog[open]')) return;
  if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); MENU.toggle(); return; }
  if (MENU.open) return;
  if (e.key === 'c') setCam((ride.cam + 1) % CAMS.length);
  if (e.key >= '1' && e.key <= String(CAMS.length)) setCam(+e.key - 1);
  if (e.key === 'm') { $('sndBtn').click(); MENU.refreshSettings(); }
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
// change graphics quality during a ride without restarting it. Edge smoothing and the number of trees are fixed when a
// ride is built, so those two follow the new setting from the next ride; everything else switches on the spot.
function applyQualityLive(name) {
  setQualityName(name);
  const was = { shadows: Q.shadows, soft: Q.soft, size: Q.shadowSize };
  Object.assign(Q, getPreset(name), { msaa: Q.msaa, treeFrac: Q.treeFrac, terrainHQ: Q.terrainHQ });
  BASE_DPR = Math.min(devicePixelRatio, Q.dprMax); renderer.setPixelRatio(BASE_DPR * scaler.scale); resize();
  VIEW = MAP.sky.fogFar * Q.fogScale; scene.fog.near = MAP.sky.fogNear * Q.fogScale; scene.fog.far = VIEW;
  camera.far = VIEW * 1.15; camera.updateProjectionMatrix();
  if (was.shadows !== Q.shadows || was.soft !== Q.soft || was.size !== Q.shadowSize) {
    renderer.shadowMap.enabled = Q.shadows; renderer.shadowMap.type = Q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap; sun.castShadow = Q.shadows;
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    if (Q.shadows) sun.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
    scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
  }
}
$('qualHint').querySelector('button').onclick = () => { applyQualityLive('low'); $('qualHint').hidden = true; };
let pt = 0, lt = 1, odoT = 0, odoLast = ride.d;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!ride.paused) s = step(dt); else s = sampleRoute(R, ride.d);
  if (FIELD) { if (!ride.paused) FIELD.update(dt, ride.t, preRace, playerState()); FIELD.draw(ride.paused ? 0 : dt, ride.t, camera.position); }
  if ((odoT += dt) > 1) { odoT = 0; const dd = ride.d - odoLast; odoLast = ride.d;
    if (dd > 0 && dd < 80) for (const k of addMeters(dd)) { playSfx('record'); banner('Kit unlocked!', `${k.name} · pick it in the Garage`); } }
  { const dc = bike.crank - sndCrank; sndCrank = bike.crank; if (dt > 0) sndRpm += (Math.max(0, dc / dt) * 60 / (2 * Math.PI) - sndRpm) * Math.min(1, dt * 4); }
  AUD.update({ v: preRace ? 0 : ride.v, pedaling: ride.P > 5 && !preRace, paused: ride.paused, crank: bike.crank, cadence: sndRpm });
  placeRider(s); updateCamera(s, false);
  if ((pt += dt) > 0.1) { pt = 0; hud(s); drawProfile(); }
  if ((lt += dt) > 0.25) { lt = 0; updateTerrainLOD(camera.position); forest.update(camera.position, rider.position, VIEW, Q.treeShadowR);
    $('fps').textContent = `${Math.round(scaler.fps)} fps · ${Math.round(scaler.scale * 100)}%`; }
  if (QNAME !== 'high') scaler.tick(clock.elapsedTime > 2 ? dt : 0.0001); // ignore the loading hitch
  if (scaler.struggling && QNAME === 'auto' && !lowHinted) { lowHinted = true; $('qualHint').hidden = false; }
  placeEmote();
  renderer.render(scene, camera);
});
} // end startGame
