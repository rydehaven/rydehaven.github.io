// field.js — the race field: computer riders who line up with you, race the course with the same physics as you,
// draft each other (and you, and you them), surge, fade, and sprint for the line.
// Each rider is matched to your level: their FTPs spread from ~18% weaker to ~18% stronger than yours (in W/kg),
// so riding at your limit puts you mid-pack and a great day wins it.
import * as THREE from 'three';
import { KITS, PAINTS } from './kits.js?v=75';
import { heightScale } from './rider.js?v=75';
import { RIDING_STYLES } from './riderpose.js?v=75';

const FIRST = ['Mateo', 'Ava', 'Lucas', 'Noor', 'Elias', 'Sofia', 'Kenji', 'Ingrid', 'Rafael', 'Maya', 'Tomás', 'Freya', 'Jonas', 'Leila', 'Owen', 'Chiara', 'Arjun', 'Hanna', 'Felix', 'Zoe', 'Dario', 'Signe', 'Malik', 'Nina'];
const LAST = ['Vega', 'Lindqvist', 'Okafor', 'Moreau', 'Tanaka', 'Rossi', 'Novak', 'Brennan', 'Alvarez', 'Kowalski', 'Haugen', 'Duarte', 'Fischer', 'Sato', 'Murphy', 'Costa', 'Varga', 'Nilsen', 'Keller', 'Ibarra'];
const FLAGS = ['US', 'GB', 'FR', 'IT', 'ES', 'NL', 'BE', 'DE', 'NO', 'DK', 'AU', 'CA', 'JP', 'CO', 'IE', 'PT', 'SI', 'NZ', 'CH', 'AT'];
const fieldFlag = (cc) => String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0)));

export function makeField({ R, scene, count, profile, playerName, raceTotal, lateSec, roadHalf, placeOnRoad, sampleRoute, buildBike, loadRider, anisotropy }) {
  const rnd = Math.random, shuffled = (a) => a.map((x) => [rnd(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
  const fn = shuffled(FIRST), ln = shuffled(LAST), myWkg = profile.ftp / profile.kg;
  const bots = [];
  const laneMax = Math.max(0.8, roadHalf - 0.6);
  // start grid: rows of three; you are on the front row
  const gridLanes = [-0.35 * laneMax * 2 + 0.2, 0.15, 0.85 * laneMax].map((x) => Math.max(-laneMax, Math.min(laneMax, x)));
  const slots = []; for (let r = 0; slots.length < count + 1; r++) for (const L of gridLanes) slots.push({ d: -r * 2.4, lane: L });
  const mine = slots.splice(2, 1)[0];                                          // front row, right side (your usual line)
  for (let i = 0; i < count; i++) {
    const spread = count > 1 ? i / (count - 1) : 0.5;                          // evenly from weaker to stronger, with a little noise
    const wkg = Math.max(1.4, myWkg * (0.82 + 0.36 * spread) * (0.97 + rnd() * 0.06));
    const kg = 58 + rnd() * 26, cm = 163 + rnd() * 26, ftp = wkg * kg;
    const frame = rnd() < 0.6 ? 'aero' : 'climb', wheels = rnd() < 0.65 ? 'deep' : 'shallow';
    const bikeKg = (frame === 'aero' ? 5.9 : 5.2) + (wheels === 'deep' ? 1.55 : 1.22);
    const CdA = 0.335 * Math.pow(cm / 178, 0.725) * Math.pow(kg / 72, 0.425) + (frame === 'aero' ? -0.012 : 0) + (wheels === 'deep' ? -0.01 : 0);
    const slot = slots[i];
    bots.push({
      name: `${fn[i % fn.length]} ${ln[i % ln.length]}`, cc: FLAGS[Math.floor(rnd() * FLAGS.length)], kg, cm, ftp, wkg,
      mass: kg + bikeKg, CdA, intensity: 0.9 + rnd() * 0.07, sprint: 1.25 + rnd() * 0.35,
      d: slot.d, lane: slot.lane, laneT: slot.lane, v: 0, P: 0, E: 0, wbal: 18000 * (kg / 70), wmax: 18000 * (kg / 70),
      surge: 0, nextSurge: 40 + rnd() * 120, finishT: null, kit: KITS[Math.floor(rnd() * KITS.length)], paint: PAINTS[Math.floor(rnd() * PAINTS.length)].color,
      frame, wheels, group: null, bike: null, body: null, label: null, pose: { ...RIDING_STYLES.seated, lean: 0, effort: 0.8 }, draft: 0,
    });
  }
  if (lateSec > 0) for (const b of bots) { b.d += lateSec * 8.5; b.v = 8.5; }  // joined late: the field is already rolling

  // ---- 3D: a bike + rider for each, plus a floating name tag ----
  function nameTag(text) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
    g.fillStyle = 'rgba(9,20,36,0.78)'; g.beginPath(); if (g.roundRect) g.roundRect(4, 10, 248, 44, 22); else g.rect(4, 10, 248, 44); g.fill();
    g.fillStyle = '#fff'; g.font = '600 26px Barlow, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 33);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true })); s.scale.set(1.5, 0.375, 1); s.position.y = 2.25; s.renderOrder = 5;
    return s;
  }
  for (const b of bots) {
    b.group = new THREE.Group(); b.inner = new THREE.Group(); b.group.add(b.inner);
    b.bike = buildBike({ paint: b.paint, frame: b.frame, wheels: b.wheels });
    b.inner.add(b.bike.group); b.inner.scale.setScalar(heightScale(b.cm));
    b.label = nameTag(`${fieldFlag(b.cc)} ${b.name.split(' ')[0]} ${b.name.split(' ')[1][0]}.`); b.group.add(b.label);
    scene.add(b.group);
    loadRider({ anisotropy, kit: b.kit, cm: b.cm, kg: b.kg }).then((rb) => { b.body = rb; b.inner.add(rb.group); }).catch((e) => console.warn('field rider', e));
  }

  // drafting: how much less air a rider pushes, from riders just ahead in roughly the same line (up to ~33% right on a wheel)
  function draftFor(d, lane, others) {
    let best = 0;
    for (const o of others) {
      const gap = o.d - d; if (gap <= 0.3 || gap > 9) continue;
      const lat = Math.abs(o.lane - lane); if (lat > 1.6) continue;
      const k = (gap < 1.2 ? 1 : 1 - (gap - 1.2) / 7.8) * (1 - lat / 1.6);
      best = Math.max(best, 0.33 * k);
    }
    return best;
  }
  const others = (self, player) => { const a = bots.filter((x) => x !== self).map((x) => ({ d: x.d, lane: x.lane, v: x.v })); a.push({ d: player.d, lane: player.lane, v: player.v }); return a; };

  // power: race smart. Early on, ride tempo and sit on wheels (bunches form, like a real race); bridge to a wheel
  // that's close if the legs allow; surge now and then; go deep late; sprint the last 650 m. W' balance limits it all.
  function needP(b, v, th, draft) { return Math.max(0, v * (b.mass * 9.81 * (0.004 * Math.cos(th) + Math.sin(th)) + 0.5 * 1.225 * b.CdA * (1 - draft) * v * v)); }
  function botPower(b, s, raceT, dt, near) {
    const g = s.grade, th = Math.atan(g), toGo = raceTotal - b.d, late = toGo < raceTotal * 0.3;
    if (b.finishT !== null) return b.ftp * 0.45;                              // finished: spin home
    let P = b.ftp * (late ? b.intensity : b.intensity - 0.07);
    if (g > 0.02) P *= 1 + Math.min(0.28, (g - 0.02) * 3.2);                  // climbs: dig in
    else if (g < -0.02) P *= Math.max(0.15, 1 + g * 14);                      // descents: freewheel more
    const tank = b.wbal / b.wmax;
    if (near) {                                                               // someone just up the road
      const gap = near.d - b.d;
      if (gap < 3) {                                                          // on the wheel: hold it (speed match + a little gap control)
        const hold = needP(b, near.v, th, b.draft) + (gap - 1.1) * 45 + (near.v - b.v) * 60;
        P = Math.min(Math.max(hold, 0), b.ftp * (tank > 0.15 ? 1.45 : 0.98));
      } else if (gap < 30 && tank > 0.35) P = Math.max(P, Math.min(b.ftp * 1.18, needP(b, near.v + 0.8, th, 0)));   // bridge across
    }
    b.nextSurge -= dt;
    if (b.nextSurge <= 0 && toGo > 1500 && tank > 0.6) { b.surge = 6 + rnd() * 12; b.nextSurge = (late ? 50 : 110) + rnd() * 160; }
    if (b.surge > 0) { b.surge -= dt; P = Math.max(P, b.ftp * 1.35); }
    if (toGo < 650) P = Math.max(P, b.ftp * b.sprint * (toGo < 250 ? 1.15 : 1));   // the sprint
    if (b.wbal <= 0 && P > b.ftp * 0.96) P = b.ftp * 0.96;                   // empty tank: threshold is all that's left
    return P;
  }

  function update(dt, raceT, preRace, player, camPos) {
    // player: { d, lane, v }
    for (const b of bots) {
      const s = sampleRoute(R, b.d), th = Math.atan(s.grade);
      if (preRace) { b.v = 0; b.P = 0; }
      else {
        let near = null; for (const o of others(b, player)) { const gap = o.d - b.d; if (gap > 0.3 && gap < 30 && (!near || gap < near.d - b.d)) near = o; }
        b.draft = draftFor(b.d, b.lane, others(b, player));
        const target = botPower(b, s, raceT, dt, near);
        b.P += (target - b.P) * Math.min(1, dt * 2.5);
        b.wbal = Math.min(b.wmax, b.wbal - (b.P - b.ftp) * dt * (b.P > b.ftp ? 1 : 0.55));
        const F = b.mass * 9.81 * (0.004 * Math.cos(th) + Math.sin(th)) + 0.5 * 1.225 * b.CdA * (1 - b.draft) * b.v * b.v;
        b.v = Math.max(0, b.v + ((b.P / Math.max(b.v, 1) - F) / b.mass) * dt);
        const before = b.d; b.d += b.v * dt; b.E += b.P * dt;
        if (b.finishT === null && before < raceTotal && b.d >= raceTotal) { b.finishT = raceT - dt + ((raceTotal - before) / Math.max(1e-6, b.d - before)) * dt; b.finishE = b.E; }
      }
      // pick a line: hold your lane, but don't ride into the back of anyone; drift towards a wheel to draft
      let blocked = false;
      for (const o of others(b, player)) { const gap = o.d - b.d; if (gap > -0.6 && gap < 2.2 && Math.abs(o.lane - b.laneT) < 0.75) { blocked = true; break; } }
      if (blocked) {
        const opts = [b.laneT - 0.9, b.laneT + 0.9].filter((x) => Math.abs(x) <= laneMax);
        const free = opts.find((L) => !others(b, player).some((o) => Math.abs(o.d - b.d) < 2.2 && Math.abs(o.lane - L) < 0.75));
        if (free !== undefined) b.laneT = free;
      }
      b.lane += (b.laneT - b.lane) * Math.min(1, dt * 1.2);
    }
  }

  // draw: put each bike on the road and pose the near ones (far riders keep their last pose: nobody sees it)
  function draw(dt, t, camPos) {
    for (const b of bots) {
      const s = sampleRoute(R, b.d);
      placeOnRoad(b.group, s, b.lane);
      const dist = b.group.position.distanceTo(camPos);
      b.group.visible = dist < 600;
      b.label.visible = dist < 70 && dist > 2;
      if (!b.group.visible) continue;
      b.bike.update(dt, b.v, b.P > 20);
      const g = s.grade, p = b.P / Math.max(100, b.ftp);
      const want = g > 0.03 ? (p > 1.35 ? RIDING_STYLES.standing : RIDING_STYLES.climb) : p > 1.5 ? RIDING_STYLES.sprint : (g < -0.03 && b.v > 11) ? RIDING_STYLES.descend : b.v > 12.5 ? RIDING_STYLES.drops : RIDING_STYLES.seated;
      const k = Math.min(1, dt * 2.2), P = b.pose;
      for (const key of ['stand', 'tuck', 'tops', 'drops', 'upright']) P[key] += ((want[key] || 0) - P[key]) * k;
      P.effort += (p - P.effort) * Math.min(1, dt * 1.5);
      P.lean += (-Math.cos(b.bike.crank) * P.stand * (0.15 + 0.13 * P.drops) - P.lean) * Math.min(1, dt * 12);
      b.bike.group.rotation.z = P.lean;
      if (b.body && dist < 160) b.body.update(b.bike.crank, t, P);
    }
  }

  // standings: everyone, leader first. Finished riders by finish time, the rest by distance.
  function standings(player) {
    const all = bots.map((b) => ({ name: b.name, cc: b.cc, d: b.d, v: b.v, finishT: b.finishT, E: b.finishE ?? b.E, kg: b.kg, me: false }));
    all.push({ name: playerName, cc: profile.country, d: player.d, v: player.v, finishT: player.finishT, E: player.finishE ?? player.E, kg: profile.kg, me: true });
    return all.sort((a, b) => (a.finishT !== null && b.finishT !== null ? a.finishT - b.finishT : a.finishT !== null ? -1 : b.finishT !== null ? 1 : b.d - a.d));
  }

  return { bots, update, draw, standings, draftFor: (d, lane) => draftFor(d, lane, bots.map((x) => ({ d: x.d, lane: x.lane }))), gridSlot: mine };
}
