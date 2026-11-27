// home.js — the app's home screen, split into pages: Home, Ride (free ride), Races, Workouts, Garage, Profile.
// One 3D garage view (your rider pedaling on the chosen bike) moves between the Home and Garage pages.
// Every Start button saves the choice and loads the ride (#courseId in the address).
import * as THREE from 'three';
import { buildBike } from './bike.js?v=75';
import { loadRider } from './rider.js?v=75';
import { BIKE_OPTIONS } from './bikegen.js?v=75';
import { APP_NAME, getProfile, setProfile, getBikeChoice, setBikeChoice, bikeStats, getRideOptions, setRideOptions, WORKOUTS, workoutPlan, workoutMinutes, zoneColor, flag, COUNTRY_CODES, countryName } from './settings.js?v=75';
import { raceSchedule, canJoin, JOIN_BEFORE_MIN, RACE_EVERY_MIN } from './races.js?v=75';
import { HOST_EMAIL } from './races.js?v=75';
const PROG_SPAN_MS = RACE_EVERY_MIN * 60000 - JOIN_BEFORE_MIN * 60000;   // the countdown bar fills between races
import { getQualityName, setQualityName } from './quality.js?v=75';
import { startMusic, stopMusic, playSfx, getSound, setSound } from './audio.js?v=75';
import { WORLDS } from '../maps/index.js?v=75';
import { KITS, PAINTS, paintById, getKit, setKit, isUnlocked, totalMiles } from './kits.js?v=75';
import { routeThumb } from './thumbs.js?v=75';
import { mi, ftStr, lb, kgFromLb, heightStr, cmFromFtIn, ftInFromCm, shortDist, MI } from './units.js?v=75';
import { buildFactor, heightScale } from './rider.js?v=75';
import { climbId, climbStats, efforts, paceTime, fmtClock, PACE_WKG } from './settings.js?v=75';

const byId = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PAGES = ['home', 'ride', 'races', 'workouts', 'koms', 'garage', 'profile', 'credits'];

export function showHome({ MAPS, buildRoute }) {
  document.body.classList.add('menu');
  byId('loading')?.remove();
  byId('appName').textContent = APP_NAME; document.title = APP_NAME;
  startMusic();                                                                        // starts with your first click (browser rule)
  const uiClick = (e) => { if (e.target.closest && e.target.closest('button, .ccard, select, a')) playSfx('click'); };
  document.addEventListener('click', uiClick);

  const routes = Object.fromEntries(MAPS.map((m) => [m.id, buildRoute(m)]));
  const opts = getRideOptions();
  if (!MAPS.some((m) => m.id === opts.course)) opts.course = MAPS[0].id;
  const mapById = (id) => MAPS.find((m) => m.id === id);
  const start = (o) => { Object.assign(opts, { raceStart: 0, raceName: '' }, o); setRideOptions(opts); location.hash = opts.course; };

  // each section draws on its own: if one fails (old cached page, odd saved data) the rest of the screen still shows
  const safe = (name, fn) => { try { fn(); } catch (e) { console.error(name, e); const b = window.__showErr; if (b) b(name + ': ' + (e && e.message)); } };

  // ---------- navigation ----------
  let garage = null, curPage = 'home';
  function go(page) {
    if (!PAGES.includes(page)) page = 'home';
    document.querySelectorAll('.page').forEach((p) => (p.hidden = p.dataset.page !== page));
    document.querySelectorAll('[data-go]').forEach((b) => b.setAttribute('aria-current', b.dataset.go === page ? 'page' : 'false'));
    try { sessionStorage.setItem('rydehaven.page', page); } catch (e) {}
    curPage = page;
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
  const courseStats = (m) => { const R = routes[m.id], s = [`${mi(R.length)} mi lap`, `${ftStr(R.ascent)} ft climbing`]; const big = (m.climbs || []).filter((c) => !(m.climbs || []).some((o) => o !== c && o.from <= c.from && o.to >= c.to)).length; if (big) s.push(`${big} ${big === 1 ? 'climb' : 'climbs'}`); if (R.hairpins) s.push(`${R.hairpins} hairpins`); return s.join(' · '); };
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
      <span><b>${p.name ? esc(p.name) : 'Your profile'}</b><small>${heightStr(p.cm)}</small></span>`;
    const f = byId('profileForm');
    if (!f.country.options.length) f.country.innerHTML = COUNTRY_CODES.map((c) => [c, countryName(c)]).sort((a, b) => a[1].localeCompare(b[1]))
      .map(([c, n]) => `<option value="${c}">${flag(c)} ${esc(n)}</option>`).join('');
    const [hf, hi] = ftInFromCm(p.cm);
    f.name.value = p.name; f.country.value = p.country; f.hft.value = hf; f.hin.value = hi; f.lb.value = lb(p.kg);
    byId('pfFtp').textContent = ftpLine(p);
    showBuild();
  }
  const formBuild = () => { const f = byId('profileForm'); return { cm: cmFromFtIn(+f.hft.value || 0, +f.hin.value || 0), kg: kgFromLb(+f.lb.value || 0) }; };
  function showBuild() {                                                       // live preview while typing: the 3D rider reshapes
    const { cm, kg } = formBuild(); if (!(cm > 120 && kg > 30)) return;
    byId('pfBuild').innerHTML = `Your rider: <b>${heightStr(cm)}</b>. The rider in the Garage and on the road is sized to match.`;
    if (garage) garage.setBuild(cm, kg);
  }
  byId('profileForm').addEventListener('input', showBuild);
  byId('profileForm').onsubmit = (e) => {
    e.preventDefault(); const f = e.target, old = getProfile(), { cm, kg } = formBuild();
    setProfile({ ...old, name: f.name.value.trim().slice(0, 40), country: f.country.value, cm: Math.round(Math.min(215, Math.max(130, cm))), kg: Math.round(Math.min(150, Math.max(35, kg)) * 10) / 10 });
    renderAll(); byId('pfSaved').textContent = 'Saved'; setTimeout(() => (byId('pfSaved').textContent = ''), 2000);
  };

  // ---------- Settings (on the Profile page): graphics quality ----------
  const qs = byId('setQuality');
  const sv = getSound(), sm = byId('setMusic'), se = byId('setSfx'), so = byId('setMute');
  if (sm) { sm.value = Math.round(sv.music * 100); sm.oninput = () => setSound({ music: sm.value / 100 }); }
  if (se) { se.value = Math.round(sv.sfx * 100); se.oninput = () => setSound({ sfx: se.value / 100 }); se.onchange = () => playSfx('komStart'); }
  if (so) { so.checked = !sv.muted; so.onchange = () => setSound({ muted: !so.checked }); }
  if (qs) { qs.value = getQualityName(); qs.onchange = () => setQualityName(qs.value); }   // saved; your next ride uses it (no restart)

  // ---------- Home: the four ways to ride ----------
  function renderHome() {
    const p = getProfile(), c = getBikeChoice(), next = raceSchedule(Date.now(), 1)[0];
    byId('hello').textContent = p.name ? `Ready to ride, ${p.name}?` : 'Ready to ride?';
    const mins = Math.max(0, Math.round((next.start - Date.now()) / 60000));
    const inTxt = mins >= 1440 ? `on ${new Intl.DateTimeFormat('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' }).format(next.start)}` : mins >= 60 ? `in ${Math.floor(mins / 60)} h ${mins % 60} min` : `in ${mins} min`;
    const tiles = [
      ['ride', 'Free ride', `${WORLDS.length} worlds, ${MAPS.length} routes, ${MAPS.reduce((a, m) => a + (m.climbs || []).length, 0)} KOMs`, '<circle cx="6" cy="17" r="3.5"/><circle cx="18" cy="17" r="3.5"/><path d="M6 17l4-8h6l2 8M10 9l-1.5-3H6m8 3l-2 8"/>'],
      ['races', 'Races', next.start <= Date.now() ? `${esc(next.name)} is starting now` : `Next: ${esc(next.name)} ${inTxt}`, '<path d="M5 21V4m0 0h12l-2 4 2 4H5"/>'],
      ['workouts', 'Workouts', 'Coming soon', '<path d="M3 20h18M5 20v-6m4 6V9m4 11v-8m4 8V5"/>'],
      ['garage', 'Garage', `${paintById(c.color).name} ${BIKE_OPTIONS.frame[c.frame].label} bike · ${getKit().name} kit`, '<path d="M3 21V9l9-5 9 5v12M7 21v-8h10v8"/>'],
    ];
    byId('tiles').innerHTML = tiles.map(([pg, t, s2, ic]) => `<button class="tile" data-go="${pg}"><svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg><span class="t-txt"><b>${t}</b><span>${s2}</span></span><i aria-hidden="true">→</i></button>`).join('');
  }

  // ---------- Ride (free ride) ----------
  function renderRide() {   // grouped by world: world name + blurb, then its routes, each listing its KOM climbs
    byId('rideList').innerHTML = WORLDS.map((w) => `<section class="world" style="grid-column:span ${Math.min(3, w.routes.length)}">
      <div class="w-head"><h2>${esc(w.name)}</h2><p>${esc(w.blurb)} · ${w.routes.length} ${w.routes.length === 1 ? 'route' : 'routes'}</p></div>
      <div class="w-routes">${w.routes.map((m) => `<article class="ccard">
        <div class="cc-top">${routeSvg(routes[m.id])}<div class="mc-text"><small class="mc-world">Route</small><h3 class="mc-name">${esc(m.name)}</h3><p class="mc-blurb">${esc(m.blurb)}</p></div></div>
        ${profileSvg(m)}
        ${(m.climbs || []).length ? `<div class="kchips">${m.climbs.map((c) => `<button class="kchip" data-kom="${esc(climbId(m, c))}" title="${esc((m.climbs.find((o) => o !== c && o.from <= c.from && o.to >= c.to) ? 'Part of ' + m.climbs.find((o) => o !== c && o.from <= c.from && o.to >= c.to).name + '. ' : '') + 'See the leaderboard')}"><b>KOM</b>${esc(c.name)}</button>`).join('')}</div>` : ''}
        <div class="cc-foot"><span class="mc-stats">${courseStats(m)}</span><button class="startBtn sm" data-ride="${m.id}">Ride</button></div></article>`).join('')}</div></section>`).join('');
    byId('rideList').querySelectorAll('[data-ride]').forEach((b) => (b.onclick = () => start({ mode: 'free', course: b.dataset.ride })));
    byId('rideList').querySelectorAll('[data-kom]').forEach((b) => (b.onclick = () => { komSel = b.dataset.kom; go('koms'); safe('koms', renderKoms); }));
  }

  // ---------- KOMs: every named climb, its numbers and the all-time fastest times ----------
  // worked out the first time the KOMs page draws (inside its own error guard, so it can never blank the home screen)
  let ALLKOMS = null, PACE = null, komSel = null;
  function komData() {
    if (ALLKOMS) return;
    ALLKOMS = MAPS.flatMap((m) => (m.climbs || []).map((c) => ({ id: climbId(m, c), c, m, st: climbStats(routes[m.id], c) })));
    PACE = Object.fromEntries(ALLKOMS.map((k) => [k.id, PACE_WKG.map((wkg) => ({ wkg, t: paceTime(routes[k.m.id], k.c, wkg) }))]));
    komSel = komSel || (ALLKOMS[0] && ALLKOMS[0].id);
  }
  const dshort = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  // the climb's own elevation profile, drawn like a telemetry trace
  function komProfile(k) {
    const R = routes[k.m.id], N = 140, a = k.c.from, b = k.c.to, ys = [];
    for (let j = 0; j <= N; j++) ys.push(R.y[Math.min(R.n - 1, Math.floor((a + ((b - a) * j) / N) * R.n))]);
    const lo = Math.min(...ys), hi = Math.max(...ys), sp = Math.max(1, hi - lo);
    const pts = ys.map((y, j) => `${((j / N) * 600).toFixed(1)},${(150 - ((y - lo) / sp) * 118).toFixed(1)}`).join(' ');
    return `<svg class="kp" viewBox="0 0 600 160" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="kpFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5ff6ff" stop-opacity=".5"/><stop offset="1" stop-color="#2ec4b6" stop-opacity="0"/></linearGradient></defs>
      <polygon points="0,160 ${pts} 600,160" fill="url(#kpFill)"/><polyline points="${pts}"/></svg>`;
  }
  function renderKoms() {
    if (!byId('komList') || !byId('komBoard')) return;
    komData(); if (!ALLKOMS.length) return;
    const k = ALLKOMS.find((x) => x.id === komSel) || ALLKOMS[0]; komSel = k.id;
    byId('komList').innerHTML = WORLDS.map((w) => `<div class="kl-world"><h3>${esc(w.name)}</h3>${w.routes.flatMap((m) => (m.climbs || []).map((c) => {
      const id = climbId(m, c), best = efforts(id)[0], st = ALLKOMS.find((x) => x.id === id).st;
      return `<button class="kl-item" data-k="${esc(id)}" aria-pressed="${id === komSel}"><span class="kl-txt"><b>${esc(c.name)}</b><span>${esc(m.name)} · ${mi(st.len, 1)} mi · ${(st.avg * 100).toFixed(1)}%</span></span><span class="kl-rec"><small>Record</small>${best ? fmtClock(best.t) : '--:--'}</span></button>`;
    })).join('')}</div>`).join('');
    byId('komList').querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => { komSel = b.dataset.k; renderKoms(); if (matchMedia('(max-width: 800px)').matches) byId('komBoard').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));   // one column: jump to the board
    const me = getProfile().name || 'You';
    const rows = [...efforts(k.id).map((e) => ({ ...e, pace: false })), ...PACE[k.id].map((p) => ({ rider: `Pace rider`, t: p.t, wkg: p.wkg, pace: true }))].sort((a, b) => a.t - b.t);
    const real = rows.filter((r) => !r.pace), lead = rows.length ? rows[0].t : 0, mine = real.findIndex((r) => r.rider === me);
    let rank = 0;
    const R = routes[k.m.id];
    byId('komBoard').innerHTML = `<div class="kb-hero" style="background-image:url('${routeThumb(k.m, R, 900, 320)}')">
        <div class="kb-head"><small>${esc(k.m.worldName)} // ${esc(k.m.name)}</small><h2>${esc(k.c.name)}</h2><span class="kb-badge">KOM</span></div>
      </div>
      <div class="kb-prof">${komProfile(k)}<span class="kp-a">Start</span><span class="kp-b">Summit</span></div>
      <dl class="kb-tiles"><div><dt>Distance</dt><dd>${mi(k.st.len, 2)}<small>mi</small></dd></div><div><dt>Elevation</dt><dd>${ftStr(k.st.gain)}<small>ft</small></dd></div>
        <div><dt>Avg grade</dt><dd>${(k.st.avg * 100).toFixed(1)}<small>%</small></dd></div><div><dt>Max grade</dt><dd>${(k.st.max * 100).toFixed(0)}<small>%</small></dd></div></dl>
      <div class="kb-you${mine >= 0 ? ' has' : ''}"><small>Your best</small>${mine >= 0 ? `<b>${fmtClock(real[mine].t)}</b><span>Rank #${mine + 1} of ${real.length}${mine === 0 ? ' · you hold the KOM' : ` · ${fmtClock(real[mine].t - real[0].t)} behind the KOM`}</span>` : '<b>--:--</b><span>No time yet. Ride this climb and your time lands here automatically.</span>'}</div>
      <div class="lb" role="table" aria-label="Fastest times"><div class="lb-row lb-h" role="row"><span>#</span><span>Rider</span><span>Time</span><span>Gap</span><span>W/kg</span><span>Date</span></div>
      ${rows.slice(0, 30).map((r) => { const rk = r.pace ? 0 : ++rank; return `<div class="lb-row${r.pace ? ' pace' : ''}${!r.pace && r.rider === me ? ' me' : ''}${rk ? ` r${Math.min(rk, 4)}` : ''}" role="row">
        <span class="lb-rank">${r.pace ? 'PACE' : rk}</span><span class="lb-name">${esc(r.pace ? `Pace rider · ${r.wkg} W/kg` : r.rider)}</span><span class="lb-time">${fmtClock(r.t)}</span>
        <span class="lb-gap">${r.t === lead ? 'Leader' : '+' + fmtClock(r.t - lead)}</span><span class="lb-wkg">${r.wkg != null ? Number(r.wkg).toFixed(1) : ''}</span><span class="lb-date">${r.date ? dshort.format(r.date) : ''}</span></div>`; }).join('')}</div>
      <p class="dl-hint">Times are saved on this computer. Pace riders show how long the climb takes at a steady effort (165 lb rider), so you can see where you stand.</p>
      <button class="startBtn" data-ridek="${k.m.id}">Ride ${esc(k.m.name)}</button>`;
    byId('komBoard').querySelector('[data-ridek]').onclick = (e) => start({ mode: 'free', course: e.target.dataset.ridek });
  }

  // ---------- Races: the schedule, as event posters. Join opens 15 minutes before the start ----------
  const tfmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
  const dfmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const until = (ms) => { const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(x).padStart(2, '0')}`; };
  const dayLabel = (t, now) => { const d = new Date(t), n = new Date(now), tm = new Date(now + 86400000);
    return d.toDateString() === n.toDateString() ? 'Today' : d.toDateString() === tm.toDateString() ? 'Tomorrow' : dfmt.format(t); };
  let raceList = [];
  function raceCard(r, now, hero) {
    const m = mapById(r.course); if (!m) return '';
    const R = routes[m.id], open = canJoin(r, now), started = r.start <= now;
    const count = started ? 'Rolling out' : open ? `Starts in ${until(r.start - now)}` : `Opens in ${until(r.start - JOIN_BEFORE_MIN * 60000 - now)}`;
    const win = JOIN_BEFORE_MIN * 60000, prog = open ? 100 : Math.max(0, Math.min(100, 100 - ((r.start - win - now) / PROG_SPAN_MS) * 100));
    return `<article class="rc${hero ? ' hero' : ''}${open ? ' open' : ''}">
      <div class="rc-art" style="background-image:url('${routeThumb(m, R, hero ? 960 : 640, hero ? 420 : 360)}')">
        <span class="rc-tag">${esc(r.tag)}</span>${open ? '<span class="rc-live">Join now</span>' : ''}
        <div class="rc-when"><b>${tfmt.format(r.start)}</b><span>${dayLabel(r.start, now)}</span></div>
      </div>
      <div class="rc-body">
        <small class="rc-kind">${esc(r.type)} · ${esc(m.worldName)}</small>
        <h3>${esc(r.name)}</h3>
        <p class="rc-blurb">${esc(r.blurb)}</p>
        <dl class="rc-stats"><div><dt>Distance</dt><dd>${mi(r.laps * R.length)}<small>mi</small></dd></div><div><dt>Laps</dt><dd>${r.laps}</dd></div>
          <div><dt>Climbing</dt><dd>${ftStr(r.laps * R.ascent)}<small>ft</small></dd></div></dl>
        <p class="rc-field${joined(r) ? ' in' : ''}">${joined(r) ? 'In the field: you' : 'No riders in the field yet'}</p>
        <div class="rc-foot"><div class="rc-count" data-start="${r.start}"><span>${count}</span><i style="width:${prog.toFixed(1)}%"></i></div>
          ${open ? `<button class="startBtn sm" data-join="${r.id}">Join race</button>` : `<span class="r-lock">Join opens ${JOIN_BEFORE_MIN} min before</span>`}</div>
      </div></article>`;
  }
  // the races you've joined on this device (so the field shows you once you're in)
  const JOINED_KEY = 'rydehaven.joined';
  const joinedIds = () => { try { return JSON.parse(localStorage.getItem(JOINED_KEY) || '[]'); } catch (e) { return []; } };
  const joined = (r) => joinedIds().includes(r.id);
  const markJoined = (r) => { try { localStorage.setItem(JOINED_KEY, JSON.stringify([r.id, ...joinedIds().filter((x) => x !== r.id)].slice(0, 20))); } catch (e) {} };
  function hostBox() {
    const mail = HOST_EMAIL ? `mailto:${HOST_EMAIL}?subject=${encodeURIComponent('Rydehaven race idea')}&body=${encodeURIComponent('Race name:\nCourse and laps:\nDay and time:\nWho it is for:\n')}` : '';
    return `<section class="host"><div><small>Host a race</small><h2>Got an idea for a race?</h2>
      <p>Group ride, club race or a weekly series: tell us the course, how many laps, the day and time, and who it’s for. We’ll get back to you.</p></div>
      ${mail ? `<a class="startBtn sm" href="${esc(mail)}">Email us</a><span class="host-mail">${esc(HOST_EMAIL)}</span>` : ''}</section>`;
  }
  function renderRaces() {
    const now = Date.now(); raceList = raceSchedule(now, 13);   // the next 24 hours
    const [first, ...rest] = raceList;
    byId('raceList').innerHTML = `<div class="rc-hero-wrap"><h2 class="rl-day">Next race</h2>${raceCard(first, now, true)}</div>
      <h2 class="rl-day">Next 24 hours</h2><div class="rc-grid">${rest.map((r) => raceCard(r, now, false)).join('')}</div>${hostBox()}`;
    byId('raceList').querySelectorAll('[data-join]').forEach((b) => (b.onclick = () => {
      const r = raceList.find((x) => x.id === b.dataset.join); markJoined(r); start({ mode: 'race', course: r.course, laps: r.laps, raceStart: r.start, raceName: r.name });
    }));
  }
  function tickRaces() {                                                   // live countdowns; redraw when a join window opens
    const now = Date.now(), pg = document.querySelector('.page[data-page="races"]');
    if (!pg || pg.hidden || !raceList.length) return;
    if (raceList.some((r) => !!document.querySelector(`[data-join="${r.id}"]`) !== canJoin(r, now))) { renderRaces(); return; }
    document.querySelectorAll('.rc-count[data-start]').forEach((el) => {
      const st = +el.dataset.start, open = st - now <= JOIN_BEFORE_MIN * 60000;
      el.querySelector('span').textContent = st <= now ? 'Rolling out' : open ? `Starts in ${until(st - now)}` : `Opens in ${until(st - JOIN_BEFORE_MIN * 60000 - now)}`;
    });
  }
  const tick = setInterval(() => { tickRaces(); }, 1000);
  const tick2 = setInterval(() => { if (!document.querySelector('.page[data-page="races"]').hidden) renderRaces(); renderHome(); }, 60000);

  // ---------- Workouts: coming soon (the engine is still here, the page is parked) ----------
  function renderWorkouts() {
    byId('wkList').innerHTML = `<div class="soon">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20h18M5 20v-6m4 6V9m4 11v-8m4 8V5"/></svg>
      <b>Coming soon</b>
      <p>Structured workouts with ERG mode, built from your FTP, are on the way. Until then, free ride and races are open.</p>
      <div class="soon-btns"><button class="startBtn sm" data-go="ride">Free ride</button><button class="startBtn sm ghost" data-go="races">See races</button></div></div>`;
  }

  // ---------- Garage: bike, wheels, paint, kit (kits unlock with miles ridden) ----------
  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  function jerseySvg(k) {                                                    // a little jersey drawn in the kit's colours
    const J = hex(k.jersey), P2 = hex(k.p2), id = 'j' + k.id;
    const body = 'M24 5L28 4Q32 9 36 4L40 5L57 13L52 26L47 24L47 58Q32 61 17 58L17 24L12 26L7 13Z';
    const deco = {
      band: `<rect x="8" y="24" width="48" height="7" fill="${P2}"/>`,
      hoops: [24, 34, 44, 54].map((y) => `<rect x="0" y="${y}" width="64" height="5" fill="${P2}"/>`).join(''),
      sash: `<path d="M44 4L56 4 20 60 8 60z" fill="${P2}"/>`,
      split: `<rect x="32" y="0" width="32" height="64" fill="${P2}"/>`,
      fade: '', stripes: [22, 28, 34, 40].map((x) => `<rect x="${x}" y="0" width="1.6" height="64" fill="${P2}"/>`).join(''),
    }[k.pattern] || '';
    const fill = k.pattern === 'fade' ? `url(#g${id})` : J;
    return `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><clipPath id="${id}"><path d="${body}"/></clipPath>
      <linearGradient id="g${id}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${J}"/><stop offset="1" stop-color="${P2}"/></linearGradient></defs>
      <g clip-path="url(#${id})"><rect width="64" height="64" fill="${fill}"/>${deco}<path d="M7 13L12 26M57 13L52 26" stroke="${hex(k.accent)}" stroke-width="5"/><path d="M28 4Q32 9 36 4" fill="none" stroke="${hex(k.accent)}" stroke-width="2.5"/></g>
      <path d="${body}" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1.2"/></svg>`;
  }
  function renderGarage() {
    const c = getBikeChoice(), p = getProfile(), kit = getKit(), miles = totalMiles();
    const group = (key, title) => `<div class="bp-group"><h2 class="subHead">${title}</h2><div class="bp-opts">${Object.entries(BIKE_OPTIONS[key]).map(([id, o]) =>
      `<button class="bp-opt" data-k="${key}" data-id="${id}" aria-pressed="${c[key] === id}"><b>${o.label}</b><span>${o.blurb}</span><small>${lb(o.kg, 1)} lb${o.dCdA ? ` · ${Math.round(-o.dCdA * 10.764 * 100) / 100} ft² less drag` : ''}</small></button>`).join('')}</div></div>`;
    const st = bikeStats(c), ref = bikeStats({ frame: 'climb', wheels: 'shallow', color: c.color });
    const watts = Math.round(0.5 * 1.225 * (ref.CdA - st.CdA) * 11.18 ** 3);
    const paints = `<div class="bp-group"><h2 class="subHead">Paint <span class="sub-note">${esc(paintById(c.color).name)}</span></h2><div class="swatches">${PAINTS.map((pt) =>
      `<button class="sw" data-paint="${pt.id}" aria-pressed="${c.color === pt.id}" title="${esc(pt.name)}" aria-label="${esc(pt.name)}" style="--c:${hex(pt.color)}"></button>`).join('')}</div></div>`;
    const kits = `<div class="bp-group"><h2 class="subHead">Kit <span class="sub-note">${miles.toFixed(1)} mi ridden</span></h2><div class="kits">${KITS.map((k) => {
      const open = isUnlocked(k), pct = Math.min(100, (miles / Math.max(1, k.miles)) * 100);
      return `<button class="kit${open ? '' : ' locked'}" data-kit="${k.id}" aria-pressed="${kit.id === k.id}" ${open ? '' : 'aria-disabled="true"'}>
        ${jerseySvg(k)}<b>${esc(k.name)}</b>${open ? `<small>${k.miles ? `Unlocked at ${k.miles} mi` : 'Starter kit'}</small>` : `<small>🔒 Ride ${Math.ceil(k.miles - miles)} more mi</small><i style="width:${pct.toFixed(1)}%"></i>`}</button>`;
    }).join('')}</div></div>`;
    byId('bikePick').innerHTML = group('frame', 'Bike') + group('wheels', 'Wheels') + paints + kits +
      `<dl class="bp-stats"><div><dt>Bike weight</dt><dd>${lb(st.kg, 1)} lb</dd></div><div><dt>Rider + bike</dt><dd>${lb(p.kg + st.kg)} lb</dd></div>
        <div><dt>At 25 mph</dt><dd>${watts > 0 ? `saves ~${watts} W` : 'lightest setup'}</dd></div></dl>`;
    const pick = (n) => { setBikeChoice(n); renderGarage(); renderHome(); };
    byId('bikePick').querySelectorAll('.bp-opt').forEach((b) => (b.onclick = () => { const n = getBikeChoice(); n[b.dataset.k] = b.dataset.id; pick(n); garage && garage.setBike(n); }));
    byId('bikePick').querySelectorAll('[data-paint]').forEach((b) => (b.onclick = () => { const n = getBikeChoice(); n.color = b.dataset.paint; pick(n); garage && garage.setPaint(paintById(n.color).color); }));
    byId('bikePick').querySelectorAll('[data-kit]').forEach((b) => (b.onclick = () => {
      const k = KITS.find((x) => x.id === b.dataset.kit); if (!isUnlocked(k)) { b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); return; }
      setKit(k.id); renderGarage(); renderHome(); garage && garage.setKit(k);
    }));
    const cap = `<b>${esc(paintById(c.color).name)} ${BIKE_OPTIONS.frame[c.frame].label} · ${esc(kit.name)} kit</b><span>${lb(st.kg, 1)} lb bike · ${BIKE_OPTIONS.wheels[c.wheels].label} wheels</span>`;
    document.querySelectorAll('.h-cap').forEach((el) => (el.innerHTML = cap));
  }

  function renderAll() { safe('profile', renderProfile); safe('home', renderHome); safe('ride', renderRide); safe('races', renderRaces); safe('workouts', renderWorkouts); safe('koms', renderKoms); safe('garage', renderGarage); }
  renderAll();
  // the 3D garage: if the browser can't give us a graphics context right now (too many open, GPU busy or switching),
  // keep the menus working and try again a few times; if the context is lost later, rebuild it
  let g3dTries = 0, g3dTimer = 0;
  function startGarage() {
    clearTimeout(g3dTimer);
    try {
      garage = makeGarage(getBikeChoice(), getKit(), getProfile());
      document.body.classList.remove('no3d'); g3dTries = 0;
      garage.attach(byId(curPage === 'garage' ? 'garageStage' : 'homeStage'));
      garage.onLost = () => { const g = garage; garage = null; try { g.dispose(); } catch (e) {} document.body.classList.add('no3d'); g3dTimer = setTimeout(startGarage, 1500); };
    } catch (e) {
      console.warn('garage view unavailable, retrying', e); garage = null; document.body.classList.add('no3d');
      if (++g3dTries < 5) g3dTimer = setTimeout(startGarage, 1200 * g3dTries);
    }
  }
  startGarage();
  let first = 'home'; try { first = sessionStorage.getItem('rydehaven.page') || 'home'; } catch (e) {}
  go(first);
  return { dispose() { stopMusic(1.2); document.removeEventListener('click', uiClick); clearInterval(tick); clearInterval(tick2); if (garage) garage.dispose(); garage = null; } };
}

// ---------- 3D garage: rider on the chosen bike, pedaling on a slow turntable ----------
function makeGarage(choice, kit, prof) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', 'Your rider and bike, drag to turn');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'default' });   // 'default': don't make a dual-GPU Mac switch graphics chips just for the menu
  if (renderer.getContext().isContextLost()) { renderer.dispose(); throw new Error('WebGL context unavailable'); }
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
  let bike = null, body = null, curKit = kit, build = { cm: prof.cm, kg: prof.kg };
  function setBike(c) {
    if (bike) { inner.remove(bike.group); bike.dispose(); }
    bike = buildBike({ ...c, paint: paintById(c.color).color }); bike.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    inner.add(bike.group);
  }
  setBike(choice);
  const fitHeight = () => { inner.scale.setScalar(heightScale(build.cm)); };   // a taller rider rides a bigger bike
  fitHeight();
  loadRider({ anisotropy: renderer.capabilities.getMaxAnisotropy(), kit: curKit, cm: build.cm, kg: build.kg })
    .then((rb) => { body = rb; body.setKit(curKit); body.setBuild(build.cm, build.kg); inner.add(rb.group); }).catch((e) => console.warn('rider failed to load', e));

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
  const api = { setBike, attach, onLost: null,
    setPaint(hex) { if (bike) bike.setPaint(hex); },
    setKit(k) { curKit = k; if (body) body.setKit(k); },
    setBuild(cm, kg) { build = { cm, kg }; fitHeight(); if (body) body.setBuild(cm, kg); },
    dispose() { renderer.setAnimationLoop(null); ro.disconnect(); canvas.remove(); renderer.dispose(); } };
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); renderer.setAnimationLoop(null); if (api.onLost) setTimeout(() => api.onLost(), 0); });
  return api;
}
