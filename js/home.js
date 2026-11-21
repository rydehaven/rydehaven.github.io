// home.js — the app's home screen, split into pages: Home, Ride (free ride), Races, Workouts, Garage, Profile.
// One 3D garage view (your rider pedaling on the chosen bike) moves between the Home and Garage pages.
// Every Start button saves the choice and loads the ride (#courseId in the address).
import * as THREE from 'three';
import { buildBike } from './bike.js';
import { loadRider } from './rider.js';
import { BIKE_OPTIONS } from './bikegen.js';
import { APP_NAME, getProfile, setProfile, getBikeChoice, setBikeChoice, bikeStats, getRideOptions, setRideOptions, WORKOUTS, workoutPlan, workoutMinutes, zoneColor, flag, COUNTRY_CODES, countryName } from './settings.js';
import { raceSchedule, canJoin, JOIN_BEFORE_MIN } from './races.js';

const byId = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const km = (m) => (m / 1000).toFixed(1);
const PAGES = ['home', 'ride', 'races', 'workouts', 'garage', 'profile'];

export function showHome({ MAPS, buildRoute }) {
  document.body.classList.add('menu');
  byId('loading')?.remove();
  byId('appName').textContent = APP_NAME; document.title = APP_NAME;

  const routes = Object.fromEntries(MAPS.map((m) => [m.id, buildRoute(m)]));
  const opts = getRideOptions();
  if (!MAPS.some((m) => m.id === opts.course)) opts.course = MAPS[0].id;
  const mapById = (id) => MAPS.find((m) => m.id === id);
  const start = (o) => { Object.assign(opts, { raceStart: 0, raceName: '' }, o); setRideOptions(opts); location.hash = opts.course; };

  // ---------- navigation ----------
  let garage = null;
  function go(page) {
    if (!PAGES.includes(page)) page = 'home';
    document.querySelectorAll('.page').forEach((p) => (p.hidden = p.dataset.page !== page));
    document.querySelectorAll('[data-go]').forEach((b) => b.setAttribute('aria-current', b.dataset.go === page ? 'page' : 'false'));
    try { sessionStorage.setItem('rydehaven.page', page); } catch (e) {}
    if (garage) garage.attach(byId(page === 'garage' ? 'garageStage' : 'homeStage'));
    byId('menu').scrollTop = 0;
    const h = document.querySelector(`.page[data-page="${page}"] h1`); if (h) h.focus({ preventScroll: true });
  }
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) { e.preventDefault(); go(b.dataset.go); } });

  // ---------- shared bits: route shape + elevation svg ----------
  const allY = MAPS.map((m) => { const R = routes[m.id]; let lo = Infinity, hi = -Infinity; for (let i = 0; i < R.n; i++) { lo = Math.min(lo, R.y[i]); hi = Math.max(hi, R.y[i]); } return [lo, hi]; });
  const span = Math.max(...allY.map(([lo, hi]) => hi - lo), 1);             // same height scale everywhere, so climbs compare honestly
  function routeSvg(R, cls = 'mc-map') {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < R.n; i++) { x0 = Math.min(x0, R.x[i]); x1 = Math.max(x1, R.x[i]); z0 = Math.min(z0, R.z[i]); z1 = Math.max(z1, R.z[i]); }
    const s = 84 / Math.max(x1 - x0, z1 - z0), ox = 48 - ((x0 + x1) / 2) * s, oz = 48 - ((z0 + z1) / 2) * s, pts = [];
    for (let k = 0; k <= 160; k++) { const i = Math.floor((k / 160) * (R.n - 1)); pts.push([(R.x[i] * s + ox).toFixed(1), (R.z[i] * s + oz).toFixed(1)]); }
    return `<svg class="${cls}" viewBox="0 0 96 96" aria-hidden="true"><polyline points="${pts.map((p) => p.join(',')).join(' ')}"/><circle cx="${pts[0][0]}" cy="${pts[0][1]}" r="3.5"/></svg>`;
  }
  function profileSvg(m) {
    const mi = MAPS.indexOf(m), R = routes[m.id], lo = allY[mi][0], N = 140, pts = [];
    for (let k = 0; k <= N; k++) { const i = Math.min(R.n - 1, Math.floor((k / N) * R.n)); pts.push(`${(k / N) * 300},${56 - ((R.y[i] - lo) / span) * 48}`); }
    const climbs = (m.climbs || []).map((c) => `<rect x="${c.from * 300}" y="0" width="${(c.to - c.from) * 300}" height="60"/>`).join('');
    return `<svg class="mc-prof" viewBox="0 0 300 60" preserveAspectRatio="none" aria-hidden="true"><g class="mc-climbs">${climbs}</g><polygon points="0,60 ${pts.join(' ')} 300,60"/></svg>`;
  }
  const courseStats = (m) => { const R = routes[m.id], s = [`${km(R.length)} km lap`, `${Math.round(R.ascent)} m climbing`]; if (m.climbs && m.climbs.length) s.push(`${m.climbs.length} climbs`); if (R.hairpins) s.push(`${R.hairpins} hairpins`); return s.join(' · '); };
  function workoutSvg(id) {
    const plan = workoutPlan(id), T = plan[plan.length - 1].t1;
    return `<svg class="wk-chart" viewBox="0 0 300 40" preserveAspectRatio="none" aria-hidden="true">${plan.map((iv) => {
      const x0 = (iv.t0 / T) * 300, x1 = (iv.t1 / T) * 300, h0 = (Math.min(1.3, iv.p0) / 1.3) * 40, h1 = (Math.min(1.3, iv.p1) / 1.3) * 40;
      return `<polygon fill="${zoneColor((iv.p0 + iv.p1) / 2)}" points="${x0},40 ${x0},${40 - h0} ${x1},${40 - h1} ${x1},40"/>`;
    }).join('')}</svg>`;
  }
  const peakW = (id) => Math.round(Math.max(...WORKOUTS[id].steps.map((s) => s.p ?? Math.max(s.p0, s.p1))) * getProfile().ftp);

  // ---------- profile chip + profile page (name, country, height, weight; FTP is estimated by the app) ----------
  const ftpLine = (p) => p.ftpFrom === 'detected'
    ? `${p.ftp} W · ${(p.ftp / p.kg).toFixed(2)} W/kg, measured from your rides`
    : `${p.ftp} W · starting estimate (2.5 W/kg). It updates on its own when you ride a strong 20-minute effort.`;
  function renderProfile() {
    const p = getProfile();
    byId('profileBtn').innerHTML = `<span class="pf-flag" aria-hidden="true">${flag(p.country)}</span>
      <span><b>${p.name ? esc(p.name) : 'Your profile'}</b><small>${p.cm} cm · ${p.kg} kg</small></span>`;
    const f = byId('profileForm');
    if (!f.country.options.length) f.country.innerHTML = COUNTRY_CODES.map((c) => [c, countryName(c)]).sort((a, b) => a[1].localeCompare(b[1]))
      .map(([c, n]) => `<option value="${c}">${flag(c)} ${esc(n)}</option>`).join('');
    f.name.value = p.name; f.country.value = p.country; f.cm.value = p.cm; f.kg.value = p.kg;
    byId('pfFtp').textContent = ftpLine(p);
  }
  byId('profileForm').onsubmit = (e) => {
    e.preventDefault(); const f = e.target, old = getProfile();
    setProfile({ ...old, name: f.name.value.trim().slice(0, 40), country: f.country.value, cm: +f.cm.value, kg: +f.kg.value });
    renderAll(); byId('pfSaved').textContent = 'Saved'; setTimeout(() => (byId('pfSaved').textContent = ''), 2000);
  };

  // ---------- Home: the four ways to ride ----------
  function renderHome() {
    const p = getProfile(), c = getBikeChoice(), next = raceSchedule(Date.now(), 1)[0];
    byId('hello').textContent = p.name ? `Ready to ride, ${p.name}?` : 'Ready to ride?';
    const mins = Math.max(0, Math.round((next.start - Date.now()) / 60000));
    const tiles = [
      ['ride', 'Free ride', `${MAPS.length} courses, ride at your own pace`, '<circle cx="6" cy="17" r="3.5"/><circle cx="18" cy="17" r="3.5"/><path d="M6 17l4-8h6l2 8M10 9l-1.5-3H6m8 3l-2 8"/>'],
      ['races', 'Races', `Next: ${esc(next.name)} in ${mins} min`, '<path d="M5 21V4m0 0h12l-2 4 2 4H5"/>'],
      ['workouts', 'Workouts', `${Object.keys(WORKOUTS).length} sessions set from your FTP`, '<path d="M3 20h18M5 20v-6m4 6V9m4 11v-8m4 8V5"/>'],
      ['garage', 'Garage', `${BIKE_OPTIONS.frame[c.frame].label} bike · ${BIKE_OPTIONS.wheels[c.wheels].label} wheels`, '<path d="M3 21V9l9-5 9 5v12M7 21v-8h10v8"/>'],
    ];
    byId('tiles').innerHTML = tiles.map(([pg, t, s2, ic]) => `<button class="tile" data-go="${pg}"><svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg><span class="t-txt"><b>${t}</b><span>${s2}</span></span><i aria-hidden="true">→</i></button>`).join('');
  }

  // ---------- Ride (free ride) ----------
  function renderRide() {
    byId('rideList').innerHTML = MAPS.map((m) => `<article class="ccard">
      <div class="cc-top">${routeSvg(routes[m.id])}<div class="mc-text"><h2 class="mc-name">${esc(m.name)}</h2><p class="mc-blurb">${esc(m.blurb)}</p></div></div>
      ${profileSvg(m)}<div class="cc-foot"><span class="mc-stats">${courseStats(m)}</span><button class="startBtn sm" data-ride="${m.id}">Ride</button></div></article>`).join('');
    byId('rideList').querySelectorAll('[data-ride]').forEach((b) => (b.onclick = () => start({ mode: 'free', course: b.dataset.ride })));
  }

  // ---------- Races: the schedule. Join opens 10 minutes before the start ----------
  const tfmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const dfmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  function renderRaces() {
    const now = Date.now(); let lastDay = '';
    byId('raceList').innerHTML = raceSchedule(now, 10).map((r) => {
      const m = mapById(r.course); if (!m) return '';
      const R = routes[m.id], day = dfmt.format(r.start), mins = Math.ceil((r.start - now) / 60000);
      const head = day !== lastDay ? `<h2 class="rl-day">${new Date(r.start).toDateString() === new Date(now).toDateString() ? 'Today' : day}</h2>` : ''; lastDay = day;
      const open = canJoin(r, now);
      const when = mins <= 60 ? `Starts in ${mins} min` : `In ${Math.floor(mins / 60)} h ${mins % 60 ? (mins % 60) + ' min' : ''}`;
      return `${head}<article class="race${open ? ' open' : ''}">
        <div class="r-time"><b>${tfmt.format(r.start)}</b><span>${when}</span></div>
        ${routeSvg(R)}
        <div class="r-main"><h3>${esc(r.name)}</h3><p>${esc(r.type)} · ${esc(m.name)} · ${r.laps} ${r.laps === 1 ? 'lap' : 'laps'}</p>
          <p class="r-stats">${km(r.laps * R.length)} km · ${Math.round(r.laps * R.ascent).toLocaleString()} m climbing</p></div>
        ${open ? `<button class="startBtn sm" data-join="${r.id}">Join race</button>` : `<span class="r-lock">Opens ${JOIN_BEFORE_MIN} min before</span>`}
      </article>`;
    }).join('');
    const list = raceSchedule(now, 10);
    byId('raceList').querySelectorAll('[data-join]').forEach((b) => (b.onclick = () => {
      const r = list.find((x) => x.id === b.dataset.join); start({ mode: 'race', course: r.course, laps: r.laps, raceStart: r.start, raceName: r.name });
    }));
  }
  const tick = setInterval(() => { if (!document.querySelector('.page[data-page="races"]').hidden) renderRaces(); renderHome(); }, 15000);

  // ---------- Workouts ----------
  let wkCourse = opts.course;
  function renderWorkouts() {
    const p = getProfile();
    byId('wkFtp').textContent = `Targets use your ${p.ftpFrom === 'detected' ? '' : 'estimated '}FTP of ${p.ftp} W.`;
    byId('wkList').innerHTML = Object.entries(WORKOUTS).map(([id, w]) => `<article class="wk">
      <div class="wk-h"><h2>${esc(w.name)}</h2><small>${workoutMinutes(id)} min · up to ${peakW(id)} W</small></div>
      ${workoutSvg(id)}<p class="wk-b">${esc(w.blurb)}</p>
      <button class="startBtn sm wide" data-wk="${id}">Start workout</button></article>`).join('');
    byId('wkCourse').innerHTML = MAPS.map((m) => `<option value="${m.id}"${m.id === wkCourse ? ' selected' : ''}>${esc(m.name)}</option>`).join('');
    byId('wkList').querySelectorAll('[data-wk]').forEach((b) => (b.onclick = () => start({ mode: 'workout', workout: b.dataset.wk, course: wkCourse })));
  }
  byId('wkCourse').onchange = (e) => { wkCourse = e.target.value; };

  // ---------- Garage ----------
  function renderGarage() {
    const c = getBikeChoice(), p = getProfile();
    const group = (key, title) => `<div class="bp-group"><h2 class="subHead">${title}</h2><div class="bp-opts">${Object.entries(BIKE_OPTIONS[key]).map(([id, o]) =>
      `<button class="bp-opt" data-k="${key}" data-id="${id}" aria-pressed="${c[key] === id}"><b>${o.label}</b><span>${o.blurb}</span><small>${(o.kg).toFixed(2)} kg${o.dCdA ? ` · ${Math.round(-o.dCdA * 1000) / 1000} m² less drag` : ''}</small></button>`).join('')}</div></div>`;
    const st = bikeStats(c), ref = bikeStats({ frame: 'climb', wheels: 'shallow' });
    const watts = Math.round(0.5 * 1.225 * (ref.CdA - st.CdA) * 11.1 ** 3);
    byId('bikePick').innerHTML = group('frame', 'Bike') + group('wheels', 'Wheels') +
      `<dl class="bp-stats"><div><dt>Bike weight</dt><dd>${st.kg.toFixed(2)} kg</dd></div><div><dt>Rider + bike</dt><dd>${(p.kg + st.kg).toFixed(1)} kg</dd></div>
        <div><dt>At 40 km/h</dt><dd>${watts > 0 ? `saves ~${watts} W` : 'lightest setup'}</dd></div></dl>`;
    byId('bikePick').querySelectorAll('.bp-opt').forEach((b) => (b.onclick = () => { const n = getBikeChoice(); n[b.dataset.k] = b.dataset.id; setBikeChoice(n); renderGarage(); renderHome(); garage && garage.setBike(n); }));
    const cap = `<b>${BIKE_OPTIONS.frame[c.frame].label} bike · ${BIKE_OPTIONS.wheels[c.wheels].label} wheels</b><span>${st.kg.toFixed(2)} kg</span>`;
    document.querySelectorAll('.h-cap').forEach((el) => (el.innerHTML = cap));
  }

  function renderAll() { renderProfile(); renderHome(); renderRide(); renderRaces(); renderWorkouts(); renderGarage(); }
  renderAll();
  try { garage = makeGarage(getBikeChoice()); } catch (e) { console.warn('garage view unavailable', e); document.body.classList.add('no3d'); }
  let first = 'home'; try { first = sessionStorage.getItem('rydehaven.page') || 'home'; } catch (e) {}
  go(first);
  return { dispose() { clearInterval(tick); if (garage) garage.dispose(); garage = null; } };
}

// ---------- 3D garage: rider on the chosen bike, pedaling on a slow turntable ----------
function makeGarage(choice) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', 'Your rider and bike, drag to turn');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(28, 1, 0.1, 50);

  scene.add(new THREE.HemisphereLight(0xdfe8f2, 0x20242a, 0.9));
  const key = new THREE.DirectionalLight(0xfff1e0, 2.6); key.position.set(2.5, 4.5, 3); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -1.6, right: 1.6, top: 2.2, bottom: -0.4, near: 0.5, far: 12 }); key.shadow.bias = -0.0005;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x5fe6d6, 1.2); rim.position.set(-3, 2.2, -3.5); scene.add(rim);
  const fill = new THREE.DirectionalLight(0x9fc4ff, 0.6); fill.position.set(-3, 1.5, 3); scene.add(fill);
  const c2 = document.createElement('canvas'); c2.width = c2.height = 256;
  const g = c2.getContext('2d'), grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,255,255,0.22)'); grd.addColorStop(0.55, 'rgba(255,255,255,0.08)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c2), transparent: true, depthWrite: false }));
  pool.rotation.x = -Math.PI / 2; scene.add(pool);
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.ShadowMaterial({ opacity: 0.45 }));
  catcher.rotation.x = -Math.PI / 2; catcher.position.y = 0.001; catcher.receiveShadow = true; scene.add(catcher);

  const turn = new THREE.Group(), inner = new THREE.Group(); inner.position.z = -0.08; turn.add(inner); scene.add(turn);
  let bike = null, body = null;
  function setBike(c) {
    if (bike) { inner.remove(bike.group); bike.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    bike = buildBike({ paint: 0xd71e28, ...c }); bike.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    inner.add(bike.group);
  }
  setBike(choice);
  loadRider({ anisotropy: renderer.capabilities.getMaxAnisotropy() }).then((rb) => { body = rb; inner.add(rb.group); }).catch((e) => console.warn('rider failed to load', e));

  let angle = 0.9, drag = null, idle = 9;
  canvas.addEventListener('pointerdown', (e) => { drag = e.clientX; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (drag === null) return; angle += (e.clientX - drag) * 0.008; drag = e.clientX; idle = 0; });
  const end = () => { drag = null; }; canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);

  let host = null;
  function size() {
    if (!host) return;
    const r = host.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height);
    renderer.setSize(w, h, false); cam.aspect = w / h;
    const fit = Math.max(1, 1.25 / cam.aspect);                                           // keep the whole bike in narrow views
    cam.position.set(0, 1.05, 4.6 * fit); cam.lookAt(0, 0.78, 0); cam.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(size);
  function attach(el) { if (!el || el === host) return; if (host) ro.unobserve(host); host = el; el.prepend(canvas); ro.observe(el); size(); }

  let last = performance.now(), t = 0;
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!host || host.closest('.page').hidden) return;                                   // nothing on screen: skip the work
    t += dt; idle += dt;
    if (!reduce && drag === null && idle > 1.5) angle += dt * 0.25;
    turn.rotation.y = angle;
    if (!reduce) bike.update(dt, 7.5, true);
    if (body) body.update(bike.crank, t);
    renderer.render(scene, cam);
  });
  return { setBike, attach, dispose() { renderer.setAnimationLoop(null); ro.disconnect(); canvas.remove(); renderer.dispose(); } };
}
