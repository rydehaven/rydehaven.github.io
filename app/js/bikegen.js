// bikegen.js — a modern road bike (and road helmet) built in code. Pure JS, no Three.js.
// Bike frame: +z forward, +y up, -x is the drive (right) side. Origin on the ground under the
// bottom bracket. Sizes are a real 56 cm road bike (meters).
//
// Output: parts, each { pivot: [x,y,z], geo: { material: { pos, nor, idx } } }, built around its pivot:
//   frame  (static)       wheelF / wheelR (spin about their axle, x axis)
//   crank  (spins about the bottom bracket, x axis)       pedalL / pedalR (ride on the crank, stay level)
// Materials: paint, carbon (black), metal, rubber, tape (bar tape + saddle), chrome

export const BIKE = (() => {
  const W = 0.336;                                   // wheel radius (700x25c)
  const BB = [0, W - 0.07, 0];                       // bottom bracket (70 mm drop)
  const RA = [0, W, -0.405], FA = [0, W, 0.575];     // rear / front axle
  const rad = (d) => (d * Math.PI) / 180;
  const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const seatDir = [0, Math.sin(rad(73.5)), -Math.cos(rad(73.5))];
  const STtop = add(BB, seatDir, 0.52);
  const HTtop = [0, BB[1] + 0.565, 0.39];            // stack 565, reach 390
  const htDir = [0, -Math.sin(rad(73)), Math.cos(rad(73))];
  const HTbot = add(HTtop, htDir, 0.15);
  const SADDLE = add(BB, seatDir, 0.735);            // saddle height ~735 mm from BB
  const BAR = [0, HTtop[1] + 0.05, HTtop[2] + 0.09];    // 90 mm stem, 20 mm of spacers
  const CRANK = 0.1725, PEDAL_X = 0.105;
  return { W, BB, RA, FA, STtop, HTtop, HTbot, SADDLE, BAR, CRANK, PEDAL_X, seatDir,
    HOODS: [[0.205, BAR[1] - 0.01, BAR[2] + 0.085], [-0.205, BAR[1] - 0.01, BAR[2] + 0.085]] };
})();

// ---------- primitive builders ----------
const newGB = () => ({ pos: [], nor: [], idx: [] });
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const nrm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function frameOf(d) { // two unit vectors perpendicular to d
  const a = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = nrm(vcross(d, a)), v = nrm(vcross(d, u)); return [u, v];
}
// tube from a to b, radius r0 -> r1, elliptical (sx, sy scale the vcross-section on the two side axes)
function tube(G, a, b, r0, r1 = r0, seg = 12, caps = true, sx = 1, sy = 1) {
  const d = nrm(vsub(b, a)), [u, v] = frameOf(d), base = G.pos.length / 3;
  for (const [p, r] of [[a, r0], [b, r1]]) for (let i = 0; i < seg; i++) {
    const t = (i / seg) * Math.PI * 2, c = Math.cos(t) * sx, s = Math.sin(t) * sy;
    G.pos.push(p[0] + (u[0] * c + v[0] * s) * r, p[1] + (u[1] * c + v[1] * s) * r, p[2] + (u[2] * c + v[2] * s) * r);
    const n = nrm([u[0] * c / sx + v[0] * s / sy, u[1] * c / sx + v[1] * s / sy, u[2] * c / sx + v[2] * s / sy]);
    G.nor.push(...n);
  }
  for (let i = 0; i < seg; i++) { const j = (i + 1) % seg; G.idx.push(base + i, base + j, base + seg + i, base + j, base + seg + j, base + seg + i); }
  if (caps) for (const [p, k, sgn] of [[a, 0, -1], [b, seg, 1]]) {
    const c = G.pos.length / 3; G.pos.push(...p); G.nor.push(d[0] * sgn, d[1] * sgn, d[2] * sgn);
    for (let i = 0; i < seg; i++) { const j = (i + 1) % seg; if (sgn > 0) G.idx.push(c, base + k + i, base + k + j); else G.idx.push(c, base + k + j, base + k + i); }
  }
}
// smooth tube through a list of points (bars, fork blades, seat stays)
function path(G, pts, r, seg = 14) { for (let i = 0; i < pts.length - 1; i++) tube(G, pts[i], pts[i + 1], r, r, seg, i === 0 || i === pts.length - 2); }
// torus around the x axis (tires)
function torusX(G, c, R, r, segU = 48, segV = 10) {
  const base = G.pos.length / 3;
  for (let i = 0; i <= segU; i++) for (let j = 0; j <= segV; j++) {
    const u = (i / segU) * Math.PI * 2, v = (j / segV) * Math.PI * 2;
    const ox = Math.sin(v) * r, rr = R + Math.cos(v) * r;
    G.pos.push(c[0] + ox, c[1] + Math.cos(u) * rr, c[2] + Math.sin(u) * rr);
    G.nor.push(Math.sin(v), Math.cos(u) * Math.cos(v), Math.sin(u) * Math.cos(v));
  }
  for (let i = 0; i < segU; i++) for (let j = 0; j < segV; j++) {
    const a = base + i * (segV + 1) + j, b = a + segV + 1;
    G.idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
}
// thick ring around the x axis (rims, chainring, cassette cogs): inner r0, outer r1, width w
function ringX(G, c, r0, r1, w, seg = 48) {
  const hw = w / 2;
  const P = (r, x, t) => [c[0] + x, c[1] + Math.cos(t) * r, c[2] + Math.sin(t) * r];
  const quadStrip = (fn, nfn) => { const base = G.pos.length / 3; for (let i = 0; i <= seg; i++) { const t = (i / seg) * Math.PI * 2; for (const k of [0, 1]) { G.pos.push(...fn(t, k)); G.nor.push(...nfn(t, k)); } }
    for (let i = 0; i < seg; i++) { const a = base + i * 2; G.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } };
  quadStrip((t, k) => P(r1, k ? hw : -hw, t), (t) => [0, Math.cos(t), Math.sin(t)]);          // outer band
  quadStrip((t, k) => P(r0, k ? -hw : hw, t), (t) => [0, -Math.cos(t), -Math.sin(t)]);        // inner band
  quadStrip((t, k) => P(k ? r0 : r1, hw, t), () => [1, 0, 0]);                                  // side +x
  quadStrip((t, k) => P(k ? r1 : r0, -hw, t), () => [-1, 0, 0]);                                // side -x
}
function boxC(G, c, sx, sy, sz) { // centered box
  const [x0, x1, y0, y1, z0, z1] = [c[0] - sx / 2, c[0] + sx / 2, c[1] - sy / 2, c[1] + sy / 2, c[2] - sz / 2, c[2] + sz / 2];
  const F = [[[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]], [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0]],
    [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0]], [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [0, -1, 0]],
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]]];
  for (const [a, b, cc, d, n] of F) { const base = G.pos.length / 3; for (const p of [a, b, cc, d]) { G.pos.push(...p); G.nor.push(...n); } G.idx.push(base, base + 1, base + 2, base, base + 2, base + 3); }
}
// lofted solid from vcross-sections (saddle, helmet): rings = [{ c:[x,y,z], rx, ry }] along z
function loft(G, rings, seg = 16, yOnly = false) {
  const base = G.pos.length / 3;
  for (const R of rings) for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    G.pos.push(R.c[0] + Math.cos(t) * R.rx, R.c[1] + Math.sin(t) * R.ry * (yOnly && Math.sin(t) < 0 ? 0.25 : 1), R.c[2]);
    G.nor.push(Math.cos(t) / R.rx, Math.sin(t) / R.ry, 0);
  }
  for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < seg; i++) {
    const a = base + k * (seg + 1) + i, b = a + seg + 1; G.idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  for (let i = base; i < G.pos.length / 3; i++) { const n = nrm(G.nor.slice(i * 3, i * 3 + 3)); G.nor.splice(i * 3, 3, ...n); }
}

// ---------- shaped tubes: airfoil / flat-back / round sections swept along a smooth path ----------
const SHAPES = {};
function shapeOutline(kind, n = 40) {
  if (SHAPES[kind]) return SHAPES[kind];
  const pts = [];
  if (kind === 'round') { for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2; pts.push([Math.cos(t) * 0.5, Math.sin(t) * 0.5]); } }
  else {
    // truncated NACA thickness: 'foil' = long Kamm tail (aero), 'flat' = short D / flat-back (climbing frames)
    const k = kind === 'foil' ? 0.8 : 0.55, th = (u) => 0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1015 * u ** 4;
    let mx = 0; for (let u = 0; u <= k; u += 0.005) mx = Math.max(mx, th(u));
    const m = Math.floor(n / 2) - 1, side = [];
    for (let i = 0; i <= m; i++) { const u = k * (1 - Math.cos((i / m) * Math.PI / 2)) ** 1.0; side.push([0.5 - u / k, (th(u) / mx) * 0.5]); }
    side[0][1] = 0;
    for (let i = 0; i < side.length; i++) pts.push(side[i]);                          // upper, leading edge -> tail
    for (let i = side.length - 1; i > 0; i--) pts.push([side[i][0], -side[i][1]]);    // lower, tail -> leading edge
  }
  return (SHAPES[kind] = pts);
}
function catmull(P, sub) { // smooth a list of sample objects {p,c,w}
  if (P.length < 3) { const o = []; for (let i = 0; i < P.length - 1; i++) for (let k = 0; k < sub; k++) { const t = k / sub; o.push(lerpS(P[i], P[i + 1], t)); } o.push(P[P.length - 1]); return o; }
  const o = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)].p, p1 = P[i].p, p2 = P[i + 1].p, p3 = P[Math.min(P.length - 1, i + 2)].p;
    for (let k = 0; k < sub; k++) {
      const t = k / sub, t2 = t * t, t3 = t2 * t, f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      o.push({ ...lerpS(P[i], P[i + 1], t), p: [0, 1, 2].map((j) => f(p0[j], p1[j], p2[j], p3[j])) });
    }
  }
  o.push(P[P.length - 1]); return o;
}
// round the ends of a swept tube (a quarter-circle taper over a short distance) so joints and tips look moulded, not cut off
function roundEnds(S, on) {
  if (!on || S.length < 2) return S;
  const out = S.slice(), K = 5;
  for (const [end, nb, put] of [[S[0], S[1], (x) => out.unshift(x)], [S[S.length - 1], S[S.length - 2], (x) => out.push(x)]]) {
    const d = nrm(vsub(end.p, nb.p)), r = Math.min(end.c, end.w) * 0.42;
    for (let k = 1; k <= K; k++) { const a = (k / K) * (Math.PI / 2) * 0.96, sc = Math.cos(a); put({ p: add3(end.p, d.map((v) => v * r * Math.sin(a))), c: end.c * sc, w: end.w * sc }); }
  }
  return out;
}
function lerpS(a, b, t) { return { p: a.p.map((v, j) => v + (b.p[j] - v) * t), c: a.c + (b.c - a.c) * t, w: a.w + (b.w - a.w) * t }; }
// sweep: samples [{p, c (depth along 'lead'), w (width across)}], shape kind, lead = direction the leading edge faces
function sweep(G, samples, kind = 'round', lead = [0, 0, 1], sub = 4, caps = true) {
  const S = roundEnds(catmull(samples, sub * 3), caps), O = shapeOutline(kind), n = O.length, base = G.pos.length / 3, rings = [];
  for (let i = 0; i < S.length; i++) {
    const d = nrm(vsub(S[Math.min(S.length - 1, i + 1)].p, S[Math.max(0, i - 1)].p));
    let L = vsub(lead, [d[0] * (d[0] * lead[0] + d[1] * lead[1] + d[2] * lead[2]), d[1] * (d[0] * lead[0] + d[1] * lead[1] + d[2] * lead[2]), d[2] * (d[0] * lead[0] + d[1] * lead[1] + d[2] * lead[2])]);
    if (len(L) < 0.25) { const up = Math.abs(d[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0]; L = vsub(up, d.map((v) => v * (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]))); }
    L = nrm(L); const X = nrm(vcross(d, L)), { p, c, w } = S[i];
    rings.push({ p, d });
    for (const [a, b] of O) { G.pos.push(p[0] + L[0] * a * c + X[0] * b * w, p[1] + L[1] * a * c + X[1] * b * w, p[2] + L[2] * a * c + X[2] * b * w); G.nor.push(0, 0, 0); }
  }
  const tri = (a, b, c, ref) => { // keep every face pointing away from the tube's centre line
    const P = (k) => G.pos.slice(k * 3, k * 3 + 3), A = P(a), Bv = P(b), C = P(c), fn = vcross(vsub(Bv, A), vsub(C, A));
    const m = [(A[0] + Bv[0] + C[0]) / 3 - ref[0], (A[1] + Bv[1] + C[1]) / 3 - ref[1], (A[2] + Bv[2] + C[2]) / 3 - ref[2]];
    if (fn[0] * m[0] + fn[1] * m[1] + fn[2] * m[2] < 0) G.idx.push(a, c, b); else G.idx.push(a, b, c);
    const f = G.idx.slice(-3); for (const k of f) for (let j = 0; j < 3; j++) G.nor[k * 3 + j] += (fn[0] * m[0] + fn[1] * m[1] + fn[2] * m[2] < 0 ? -fn[j] : fn[j]);
  };
  for (let r = 0; r < S.length - 1; r++) for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = base + r * n + i, b = base + r * n + j, c = a + n, d = b + n;
    const ref = rings[r].p.map((v, k) => (v + rings[r + 1].p[k]) / 2);
    tri(a, b, c, ref); tri(b, d, c, ref);
  }
  for (let k = base; k < G.pos.length / 3; k++) { const v = nrm(G.nor.slice(k * 3, k * 3 + 3)); G.nor.splice(k * 3, 3, ...v); }
  if (caps) for (const [r, sg] of [[0, -1], [S.length - 1, 1]]) {
    const { p, d } = rings[r], c0 = G.pos.length / 3; G.pos.push(...p); G.nor.push(d[0] * sg, d[1] * sg, d[2] * sg);
    for (let i = 0; i < n; i++) { const k = base + r * n + i; G.pos.push(...G.pos.slice(k * 3, k * 3 + 3)); G.nor.push(d[0] * sg, d[1] * sg, d[2] * sg); }
    for (let i = 0; i < n; i++) {
      const a = c0 + 1 + i, b = c0 + 1 + ((i + 1) % n), fn = vcross(vsub(G.pos.slice(a * 3, a * 3 + 3), p), vsub(G.pos.slice(b * 3, b * 3 + 3), p));
      if (fn[0] * d[0] * sg + fn[1] * d[1] * sg + fn[2] * d[2] * sg < 0) G.idx.push(c0, b, a); else G.idx.push(c0, a, b);
    }
  }
}
// revolve a closed (x, r) profile around the x axis (carbon rims)
function latheX(G, prof, seg = 72) {
  const n = prof.length, base = G.pos.length / 3, cx = prof.reduce((s, q) => s + q[0], 0) / n, cr = prof.reduce((s, q) => s + q[1], 0) / n;
  const en = prof.map((q, i) => { const a = prof[(i + n - 1) % n], b = prof[(i + 1) % n]; let nx = -(b[1] - a[1]), nr = b[0] - a[0]; const l = Math.hypot(nx, nr) || 1; nx /= l; nr /= l;
    if (nx * (q[0] - cx) + nr * (q[1] - cr) < 0) { nx = -nx; nr = -nr; } return [nx, nr]; });
  for (let i = 0; i <= seg; i++) { const t = (i / seg) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    prof.forEach(([x, r], k) => { G.pos.push(x, c * r, s * r); G.nor.push(en[k][0], c * en[k][1], s * en[k][1]); }); }
  for (let i = 0; i < seg; i++) for (let k = 0; k < n; k++) {
    const a = base + i * n + k, b = base + i * n + (k + 1) % n, c = a + n, d = b + n;
    const t = ((i + 0.5) / seg) * Math.PI * 2, mx = (prof[k][0] + prof[(k + 1) % n][0]) / 2 - cx, mr = (prof[k][1] + prof[(k + 1) % n][1]) / 2 - cr;
    const P = (q) => G.pos.slice(q * 3, q * 3 + 3), fn = vcross(vsub(P(b), P(a)), vsub(P(c), P(a))), out = [mx, Math.cos(t) * mr, Math.sin(t) * mr];
    if (fn[0] * out[0] + fn[1] * out[1] + fn[2] * out[2] < 0) G.idx.push(a, c, b, b, c, d); else G.idx.push(a, b, c, b, d, c);
  }
}

// ---------- bike choices: frame (aero / climbing) and wheels (deep / shallow) ----------
// kg = bike weight share; dCdA = drag change vs the round-tube baseline (m^2). Used by the ride physics.
export const BIKE_OPTIONS = {
  frame: {
    aero: { label: 'Aero', blurb: 'Deep airfoil tubes, dropped stays, one-piece wing bar', kg: 5.9, dCdA: -0.012 },
    climb: { label: 'Climbing', blurb: 'Light flat-back tubes, wavy fork and stays', kg: 5.2, dCdA: 0 },
  },
  wheels: {
    deep: { label: 'Deep', blurb: '62 mm carbon rims, bladed spokes', kg: 1.55, dCdA: -0.010 },
    shallow: { label: 'Shallow', blurb: '32 mm light climbing rims', kg: 1.22, dCdA: 0 },
  },

};

// ---------- the bike ----------
export function bikeParts({ frame = 'aero', wheels = 'deep' } = {}) {
  const B = BIKE, M = () => ({ paint: newGB(), carbon: newGB(), metal: newGB(), rubber: newGB(), tape: newGB(), chrome: newGB() });
  const parts = {}, AERO = frame === 'aero';
  const F = M(), at = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const Sp = (p, c, w) => ({ p, c, w }), Z = [0, 0, 1], Y = [0, 1, 0];
  const htD = nrm(vsub(B.HTbot, B.HTtop)), HTlow = add3(B.HTbot, htD.map((v) => v * 0.012));
  const HTtt = at(B.HTtop, B.HTbot, 0.14), HTdt = at(B.HTtop, B.HTbot, 0.82);
  const STj = add3(B.BB, B.seatDir.map((v) => v * ((HTtt[1] - B.BB[1]) / B.seatDir[1]))); // top of the seat tube
  if (AERO) {
    // ---- aero frame: deep Kamm-tail tubes, dropped seat stays, seat tube hugging the rear wheel ----
    sweep(F.paint, [Sp(add3(B.HTtop, [0, 0.004, -0.001]), 0.07, 0.036), Sp(at(B.HTtop, B.HTbot, 0.5), 0.074, 0.034), Sp(HTlow, 0.082, 0.04)], 'foil', Z, 3);  // head tube
    const STtt = STj;
    sweep(F.paint, [Sp(STtt, 0.04, 0.026), Sp(at(STtt, HTtt, 0.5), 0.036, 0.024), Sp(HTtt, 0.042, 0.028)], 'round', Y, 3);                                       // top tube (tall, slim)
    sweep(F.paint, [Sp(add3(B.BB, [0, 0.012, 0.018]), 0.06, 0.044), Sp(at(B.BB, HTdt, 0.35), 0.072, 0.036), Sp(at(B.BB, HTdt, 0.8), 0.078, 0.034), Sp(HTdt, 0.074, 0.036)], 'foil', Z, 4); // down tube
    const st = (t, dz) => add3(at(B.BB, B.STtop, t), [0, 0, dz]);
    sweep(F.paint, [Sp(add3(B.BB, [0, 0.01, -0.004]), 0.05, 0.036), Sp(st(0.28, 0.012), 0.072, 0.032), Sp(st(0.55, 0.01), 0.07, 0.028), Sp(st(0.8, 0.002), 0.056, 0.027), Sp(STj, 0.052, 0.027)], 'foil', Z, 4); // seat tube with wheel cut-out
    sweep(F.carbon, [Sp(at(B.BB, STj, 0.98), 0.05, 0.022), Sp(at(STj, B.SADDLE, 0.5), 0.048, 0.021), Sp(add3(B.SADDLE, [0, -0.012, 0.01]), 0.04, 0.02)], 'foil', Z, 3); // aero seatpost
    for (const s of [-1, 1]) {
      const ra = [s * 0.064, B.RA[1], B.RA[2]];
      sweep(F.paint, [Sp(add3(st(0.6, 0), [s * 0.014, 0, -0.012]), 0.03, 0.016), Sp(at(add3(st(0.6, 0), [s * 0.03, 0, -0.02]), ra, 0.5), 0.022, 0.012), Sp(ra, 0.018, 0.01)], 'flat', Z, 4); // dropped seat stays
      sweep(F.paint, [Sp([s * 0.036, B.BB[1], B.BB[2] - 0.035], 0.036, 0.022), Sp([s * 0.05, (B.BB[1] + B.RA[1]) / 2, (B.BB[2] + B.RA[2]) / 2], 0.028, 0.018), Sp(ra, 0.02, 0.012)], 'round', Y, 3); // chain stays
    }
    // fork: deep foil blades + wide crown
    for (const s of [-1, 1]) {
      const crown = [s * 0.034, B.HTbot[1] - 0.012, B.HTbot[2] + 0.008], ax = [s * 0.052, B.FA[1], B.FA[2]];
      sweep(F.paint, [Sp(crown, 0.056, 0.022), Sp(add3(at(crown, ax, 0.5), [0, 0, -0.006]), 0.046, 0.018), Sp(ax, 0.034, 0.014)], 'foil', Z, 4);
    }
    sweep(F.paint, [Sp(add3(B.HTbot, [-0.05, -0.012, 0.008]), 0.064, 0.03), Sp(add3(B.HTbot, [0, -0.008, 0.008]), 0.08, 0.038), Sp(add3(B.HTbot, [0.05, -0.012, 0.008]), 0.064, 0.03)], 'foil', Z, 3);
    // one-piece cockpit: aero spacer cover, integrated stem, wing-section tops
    const stemA = add3(B.HTtop, [0, 0.05, -0.015]), stemB = [0, B.BAR[1], B.BAR[2] - 0.004];
    sweep(F.carbon, [Sp(add3(B.HTtop, [0, -0.004, 0.001]), 0.07, 0.035), Sp(stemA, 0.062, 0.033)], 'foil', Z, 2);
    sweep(F.carbon, [Sp(add3(stemA, [0, -0.006, -0.012]), 0.04, 0.034), Sp(at(stemA, stemB, 0.5), 0.03, 0.03), Sp(stemB, 0.024, 0.04)], 'round', Y, 3);
  } else {
    // ---- climbing frame: flat-back tubes, hour-glass head tube, wavy fork and stays ----
    sweep(F.paint, [Sp(add3(B.HTtop, [0, 0.004, -0.001]), 0.05, 0.042), Sp(at(B.HTtop, B.HTbot, 0.45), 0.044, 0.035), Sp(HTlow, 0.058, 0.05)], 'flat', Z, 3);   // head tube
    const STtt = STj;
    sweep(F.paint, [Sp(STtt, 0.034, 0.03), Sp(at(STtt, HTtt, 0.5), 0.03, 0.03), Sp(HTtt, 0.036, 0.036)], 'round', Y, 3);                                          // sloping top tube
    sweep(F.paint, [Sp(add3(B.BB, [0, 0.012, 0.016]), 0.052, 0.064), Sp(at(B.BB, HTdt, 0.3), 0.05, 0.05), Sp(at(B.BB, HTdt, 0.75), 0.05, 0.042), Sp(HTdt, 0.054, 0.044)], 'flat', Z, 4); // down tube
    sweep(F.paint, [Sp(add3(B.BB, [0, 0.01, -0.003]), 0.046, 0.042), Sp(at(B.BB, STj, 0.5), 0.04, 0.032), Sp(STj, 0.042, 0.032)], 'flat', Z, 3);           // seat tube
    sweep(F.carbon, [Sp(at(B.BB, STj, 0.98), 0.034, 0.026), Sp(add3(B.SADDLE, [0, -0.012, 0.01]), 0.03, 0.024)], 'flat', Z, 3);                                  // seatpost
    for (const s of [-1, 1]) {
      const ra = [s * 0.064, B.RA[1], B.RA[2]], top = add3(at(B.BB, B.STtop, 0.8), [s * 0.016, 0, -0.016]);
      const n = nrm(vcross(vsub(ra, top), [1, 0, 0]));                                    // in-plane normal for the wave
      const wave = (t, a) => add3(at(top, ra, t), n.map((v) => v * a));
      sweep(F.paint, [Sp(top, 0.02, 0.016), Sp(wave(0.3, 0.006), 0.016, 0.013), Sp(wave(0.68, -0.004), 0.015, 0.012), Sp(ra, 0.016, 0.011)], 'round', Y, 5); // wavy seat stays
      const big = s < 0 ? 1.2 : 1;                                                        // asymmetric: drive side beefier
      sweep(F.paint, [Sp([s * 0.036, B.BB[1], B.BB[2] - 0.035], 0.032 * big, 0.02 * big), Sp(add3([s * 0.05, (B.BB[1] + B.RA[1]) / 2, (B.BB[2] + B.RA[2]) / 2], [0, -0.006, 0]), 0.024 * big, 0.016), Sp(ra, 0.018, 0.012)], 'round', Y, 4);
    }
    // wavy fork: blades bow back, then the tips sweep forward to the axle
    for (const s of [-1, 1]) {
      const crown = [s * 0.033, B.HTbot[1] - 0.012, B.HTbot[2] + 0.006], ax = [s * 0.05, B.FA[1], B.FA[2]];
      sweep(F.paint, [Sp(crown, 0.04, 0.026), Sp(add3(at(crown, ax, 0.3), [0, 0, 0.008]), 0.034, 0.021), Sp(add3(at(crown, ax, 0.68), [0, 0, -0.012]), 0.03, 0.018), Sp(add3(at(crown, ax, 0.9), [0, 0, -0.004]), 0.026, 0.015), Sp(ax, 0.022, 0.013)], 'flat', Z, 5);
    }
    sweep(F.paint, [Sp(add3(B.HTbot, [-0.046, -0.012, 0.006]), 0.046, 0.03), Sp(add3(B.HTbot, [0, -0.006, 0.006]), 0.06, 0.04), Sp(add3(B.HTbot, [0.046, -0.012, 0.006]), 0.046, 0.03)], 'flat', Z, 3);
    const stemA = add3(B.HTtop, [0, 0.05, -0.015]), stemB = [0, B.BAR[1], B.BAR[2] - 0.004];
    sweep(F.carbon, [Sp(add3(B.HTtop, [0, -0.004, 0.001]), 0.05, 0.04), Sp(stemA, 0.046, 0.038)], 'flat', Z, 2);     // spacer cover
    sweep(F.carbon, [Sp(add3(stemA, [0, -0.006, -0.012]), 0.036, 0.034), Sp(at(stemA, stemB, 0.5), 0.028, 0.028), Sp(stemB, 0.022, 0.034)], 'round', Y, 3);
  }
  tube(F.paint, add3(B.BB, [-0.046, 0, 0]), add3(B.BB, [0.046, 0, 0]), 0.024, 0.024, 32); // BB shell
  // saddle + rails
  const sd = B.SADDLE, sr = [];
  for (const [dz, rx, ry] of [[-0.12, 0.004, 0.004], [-0.115, 0.06, 0.018], [-0.08, 0.072, 0.022], [-0.02, 0.05, 0.02], [0.05, 0.022, 0.017], [0.13, 0.016, 0.014], [0.145, 0.004, 0.004]])
    sr.push({ c: [0, sd[1] + 0.035 + (dz > 0.08 ? -0.004 : 0), sd[2] + dz], rx, ry });
  loft(F.tape, sr, 16, true);
  tube(F.metal, [0.02, sd[1] + 0.02, sd[2] - 0.07], [0.02, sd[1] + 0.02, sd[2] + 0.08], 0.0035, 0.0035, 6);
  tube(F.metal, [-0.02, sd[1] + 0.02, sd[2] - 0.07], [-0.02, sd[1] + 0.02, sd[2] + 0.08], 0.0035, 0.0035, 6);
  // bar tops: wing section on the aero bike, round-ish on the climber; drops + hoods the same
  const bx = 0.205, by = B.BAR[1], bz = B.BAR[2];
  if (AERO) {
    sweep(F.carbon, [Sp([-0.172, by, bz + 0.004], 0.05, 0.014), Sp([0, by, bz - 0.002], 0.056, 0.016), Sp([0.172, by, bz + 0.004], 0.05, 0.014)], 'foil', Z, 4);
    for (const s of [-1, 1]) tube(F.tape, [s * 0.165, by, bz + 0.004], [s * bx, by, bz], 0.012, 0.0125, 12);
  } else {
    sweep(F.carbon, [Sp([-0.18, by, bz], 0.03, 0.024), Sp([0, by, bz], 0.032, 0.026), Sp([0.18, by, bz], 0.03, 0.024)], 'round', Z, 3);
    for (const s of [-1, 1]) tube(F.tape, [s * 0.172, by, bz], [s * bx, by, bz], 0.0125, 0.0125, 12);
  }
  for (const s of [-1, 1]) {
    const x = s * bx, drop = [[x, by, bz], [x, by - 0.005, bz + 0.05], [x, by - 0.03, bz + 0.085], [x, by - 0.075, bz + 0.095], [x, by - 0.115, bz + 0.075], [x, by - 0.13, bz + 0.035], [x, by - 0.132, bz - 0.02]];
    path(F.tape, drop, 0.0125, 10);
    const hood = [x, by + 0.012, bz + 0.085];
    loft(F.carbon, [{ c: [x, hood[1], hood[2] - 0.02], rx: 0.016, ry: 0.016 }, { c: [x, hood[1] + 0.008, hood[2] + 0.02], rx: 0.017, ry: 0.022 }, { c: [x, hood[1] + 0.012, hood[2] + 0.05], rx: 0.012, ry: 0.016 }, { c: [x, hood[1] + 0.012, hood[2] + 0.056], rx: 0.004, ry: 0.004 }], 10);
    path(F.carbon, [[x, hood[1] - 0.005, hood[2] + 0.045], [x, hood[1] - 0.06, hood[2] + 0.06], [x, hood[1] - 0.11, hood[2] + 0.045]], 0.006, 6);
  }
  // derailleurs, chain, cassette (no water bottle)
  boxC(F.metal, [-0.075, B.RA[1] - 0.06, B.RA[2] + 0.02], 0.02, 0.07, 0.03);
  boxC(F.metal, [-0.034, at(B.BB, B.STtop, 0.33)[1], at(B.BB, B.STtop, 0.33)[2] + 0.03], 0.012, 0.035, 0.05);
  tube(F.metal, [-0.045, B.BB[1] + 0.105, B.BB[2]], [-0.045, B.RA[1] + 0.045, B.RA[2]], 0.004, 0.004, 5);
  tube(F.metal, [-0.045, B.BB[1] - 0.105, B.BB[2]], [-0.045, B.RA[1] - 0.075, B.RA[2] + 0.02], 0.004, 0.004, 5);
  // 11-speed cassette (11-30): biggest cog inboard next to the spokes, smallest outboard
  const COGS = [30, 27, 24, 21, 19, 17, 15, 14, 13, 12, 11];
  COGS.forEach((teeth, k) => ringX(F.metal, [-0.024 - k * 0.0037, B.RA[1], B.RA[2]], 0.012, teeth * 0.00202, 0.0018, 28));
  parts.frame = { pivot: [0, 0, 0], geo: F };

  // ---- wheels (built at the origin; pivot = axle) ----
  const DEEP = wheels === 'deep', bead = B.W - 0.021, depth = DEEP ? 0.062 : 0.032, hw = DEEP ? 0.0145 : 0.0115;
  const rimProf = DEEP
    ? [[hw, bead], [hw + 0.0005, bead - 0.012], [hw - 0.001, bead - depth * 0.55], [hw * 0.62, bead - depth + 0.005], [0, bead - depth], [-hw * 0.62, bead - depth + 0.005], [-hw + 0.001, bead - depth * 0.55], [-hw - 0.0005, bead - 0.012], [-hw, bead]]
    : [[hw, bead], [hw, bead - 0.01], [hw * 0.8, bead - depth + 0.006], [0, bead - depth], [-hw * 0.8, bead - depth + 0.006], [-hw, bead - 0.01], [-hw, bead]];
  for (const [name, A] of [['wheelR', B.RA], ['wheelF', B.FA]]) {
    const G = M(), o = [0, 0, 0], r0 = bead - depth + 0.002;
    torusX(G.rubber, o, B.W - 0.012, 0.0125, 96, 16);                                   // 25c tire
    latheX(G.carbon, rimProf, 120);
    tube(G.metal, [-0.045, 0, 0], [0.045, 0, 0], DEEP ? 0.016 : 0.013, DEEP ? 0.016 : 0.013, 14); // hub
    for (const s of [-1, 1]) tube(G.metal, [s * 0.03, 0, 0], [s * 0.036, 0, 0], 0.024, 0.024, 16);  // hub flanges
    const N = DEEP ? 20 : 24;
    for (let k = 0; k < N; k++) {                                                        // bladed (deep) / round (shallow) spokes
      const t = (k / N) * Math.PI * 2, s = k % 2 ? 1 : -1;
      tube(G.chrome, [s * 0.033, Math.cos(t) * 0.022, Math.sin(t) * 0.022], [0, Math.cos(t) * r0, Math.sin(t) * r0], DEEP ? 0.0011 : 0.0009, DEEP ? 0.0011 : 0.0009, 4, false, DEEP ? 0.6 : 1, DEEP ? 2.2 : 1);
    }
    parts[name] = { pivot: A, geo: G };
  }
  // ---- crankset (pivot = bottom bracket) ----
  {
    const G = M();
    ringX(G.carbon, [-0.045, 0, 0], 0.07, 0.105, 0.004, 52);                // big chainring
    ringX(G.carbon, [-0.04, 0, 0], 0.055, 0.082, 0.004, 40);                // small chainring
    tube(G.metal, [-0.06, 0, 0], [0.06, 0, 0], 0.012, 0.012, 12);           // spindle
    // crank arms (at crank angle 0 the right arm points forward, the left arm back)
    tube(G.carbon, [-0.055, 0, 0], [-BIKE.PEDAL_X + 0.012, 0, BIKE.CRANK], 0.013, 0.009, 10, true, 0.6, 1);
    tube(G.carbon, [0.055, 0, 0], [BIKE.PEDAL_X - 0.012, 0, -BIKE.CRANK], 0.013, 0.009, 10, true, 0.6, 1);
    parts.crank = { pivot: B.BB, geo: G };
  }
  for (const [name, x] of [['pedalR', -BIKE.PEDAL_X], ['pedalL', BIKE.PEDAL_X]]) {
    const G = M();
    boxC(G.carbon, [0, 0, 0], 0.075, 0.016, 0.085);
    boxC(G.metal, [x > 0 ? -0.04 : 0.04, 0, 0], 0.02, 0.01, 0.01);
    parts[name] = { pivot: [x, 0, 0], geo: G };                             // positioned each frame from the crank angle
  }
  return parts;
}
function add3(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }

// where the RYDEHAVEN decal goes on each side of the down tube: { a, b (ends on the tube's centre line), halfA, halfB (side half-widths), h (letter band height) }
export function decalSpot(frame = 'aero') {
  const B = BIKE, at = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const HTdt = at(B.HTtop, B.HTbot, 0.82);
  return frame === 'aero'
    ? { a: at(B.BB, HTdt, 0.36), b: at(B.BB, HTdt, 0.8), halfA: 0.018, halfB: 0.017, h: 0.04 }
    : { a: at(B.BB, HTdt, 0.34), b: at(B.BB, HTdt, 0.78), halfA: 0.0245, halfB: 0.0215, h: 0.03 };
}

// where each pedal spindle is for a crank angle (radians, 0 = right crank forward), in bike coords
export function pedalPositions(angle) {
  const B = BIKE, c = Math.cos(angle), s = Math.sin(angle);
  return {
    right: [-B.PEDAL_X, B.BB[1] - s * B.CRANK, B.BB[2] + c * B.CRANK],
    left: [B.PEDAL_X, B.BB[1] + s * B.CRANK, B.BB[2] - c * B.CRANK],
  };
}

// ---------- road helmet (centered on the head, +z forward, +y up; ~0.27 m long) ----------
export function helmetGeometry({ shell = true } = {}) {   // shell:false -> just the dark foam liner + straps (worn under the downloaded helmet model)
  // A road helmet fitted to the rider's head, built in the Head bone's own space (metres, +y up, +z = face).
  // Outer shell (white) + inner liner (black foam, seen through the vents and at the rim), long vent channels,
  // a rear retention cradle and thin straps that follow the face down to a buckle under the chin.
  const G = { shell: newGB(), vents: newGB(), straps: newGB() };
  const C = [0, 0.105, 0.022];                                           // centre of the cranium
  const OUT = { rx: 0.11, ry: 0.13, rzF: 0.128, rzB: 0.142 }, IN = shell ? { rx: 0.093, ry: 0.121, rzF: 0.113, rzB: 0.118 } : { rx: 0.09, ry: 0.119, rzF: 0.111, rzB: 0.113 };
  const D = Math.PI / 180;
  const rimY = (th) => {                                                  // lower edge: high at the brow, low over the back of the head
    const c = Math.cos(th);
    if (!shell) return c > 0 ? 0.108 + 0.04 * c * c : 0.108 + 0.02 * c * c;   // liner stays tucked inside the downloaded shell
    return c > 0 ? 0.088 + 0.04 * c * c : 0.088 - 0.03 * c * c;
  };
  const surf = (S, th, ph, tail) => {
    const c = Math.cos(ph), rz = Math.cos(th) > 0 ? S.rzF : S.rzB;
    let x = S.rx * c * Math.sin(th), y = S.ry * Math.sin(ph), z = rz * c * Math.cos(th);
    if (tail && Math.cos(th) < 0) { const k = -Math.cos(th) * c; y -= 0.012 * k * k; x *= 1 - 0.14 * k * k; }   // tapered tail
    if (tail && Math.cos(th) > 0) { const k = Math.cos(th) * Math.max(0, 1 - ph * 1.6); z += 0.002 * k; }        // slight brow lip
    return [C[0] + x, C[1] + y, C[2] + z];
  };
  const NU = 96, NV = 30;
  const phOf = (th, t) => { const p0 = Math.asin(Math.max(-0.95, Math.min(0.95, (rimY(th) - C[1]) / OUT.ry))); return p0 + (Math.PI / 2 - p0) * Math.pow(t, 0.9); };
  // vents: long front-to-back channels plus rear exhausts, in (azimuth deg, height 0..1)
  const isVent = (thDeg, t) => {
    const a = ((thDeg + 540) % 360) - 180, A = Math.abs(a);
    for (const c of [7, 22, 38]) if (Math.abs(A - c) < 3.4 && t > 0.14 && t < 0.86 && !(t > 0.46 && t < 0.52)) return true;      // long front-to-top channels
    if (Math.abs(A - 55) < 3.2 && t > 0.2 && t < 0.62) return true;                                                                // outer front vent
    if (Math.abs(A - 78) < 6 && t > 0.3 && t < 0.42) return true;                                                                   // side port
    if (Math.abs(A - 104) < 7 && t > 0.34 && t < 0.46) return true;
    for (const c of [138, 156, 172]) if (Math.abs(A - c) < 3.4 && t > 0.12 && t < 0.6) return true;                               // rear exhausts
    return false;
  };
  const grid = (S, tail) => { const g = []; for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) { const th = (i / NU) * 2 * Math.PI; g.push(surf(S, th, phOf(th, j / NV), tail)); } return g; };
  const go = grid(OUT, true), gi = grid(IN, false), id = (i, j) => j * (NU + 1) + i;
  const emit = (B, quads) => {                                            // quads of points -> triangles with smooth-ish normals
    const base = B.pos.length / 3, map = new Map(), acc = [];
    const vid = (p) => { const k = p.map((v) => v.toFixed(5)).join(','); if (!map.has(k)) { map.set(k, base + acc.length); acc.push({ p, n: [0, 0, 0] }); } return map.get(k); };
    for (const [q, out] of quads) {
      const v = q.map(vid), fn = vcross(vsub(q[1], q[0]), vsub(q[2], q[0])), cen = q.reduce((s, p) => s.map((x, k) => x + p[k] / 4), [0, 0, 0]);
      const dirOut = vsub(cen, C), flip = (fn[0] * dirOut[0] + fn[1] * dirOut[1] + fn[2] * dirOut[2] < 0) === out;
      const f = flip ? [v[0], v[2], v[1], v[0], v[3], v[2]] : [v[0], v[1], v[2], v[0], v[2], v[3]];
      B.idx.push(...f);
      const fnn = flip ? fn.map((x) => -x) : fn;
      for (const k of v) for (let c = 0; c < 3; c++) acc[k - base].n[c] += fnn[c];
    }
    for (const a of acc) { B.pos.push(...a.p); B.nor.push(...nrm(a.n)); }
  };
  const shellQ = [], linerQ = [];
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const thD = ((i + 0.5) / NU) * 360, t = (j + 0.5) / NV, v = isVent(thD, t);
    const qo = [go[id(i, j)], go[id(i + 1, j)], go[id(i + 1, j + 1)], go[id(i, j + 1)]], qi = [gi[id(i, j)], gi[id(i + 1, j)], gi[id(i + 1, j + 1)], gi[id(i, j + 1)]];
    if (!v) shellQ.push([qo, true]);
    linerQ.push([qi, true]);                                              // liner faces outward: it's what you see through the vents
    if (v && shell) {                                                     // vent side walls (outer edge down to the liner)
      const nb = [[i, j - 1, [0, 1]], [i + 1, j, [1, 2]], [i, j + 1, [2, 3]], [i - 1, j, [3, 0]]];
      for (const [ni, nj, [e0, e1]] of nb) {
        const nth = (((ni + NU) % NU) + 0.5) / NU * 360;
        if (isVent(nth, (nj + 0.5) / NV)) continue;
        linerQ.push([[qo[e0], qo[e1], qi[e1], qi[e0]], true]);
      }
    }
  }
  // rim band: outer edge to liner edge, all the way round
  if (shell) for (let i = 0; i < NU; i++) linerQ.push([[go[id(i, 0)], go[id(i + 1, 0)], gi[id(i + 1, 0)], gi[id(i, 0)]], false]);
  if (shell) emit(G.shell, shellQ); emit(G.vents, linerQ);
  // straps: front and rear of the ear meet below it, then run along the jaw to a buckle under the chin
  const ST = {
    front: [[0.083, 0.122, 0.05], [0.0804, 0.0997, 0.0422], [0.0832, 0.0865, 0.031], [0.0823, 0.0738, 0.0263], [0.0795, 0.0592, 0.025], [0.0725, 0.0441, 0.0231], [0.0686, 0.0375, 0.0194], [0.0587, 0.0168, 0.0129]],
    back: [[0.072, 0.118, -0.042], [0.0691, 0.0908, -0.0277], [0.0694, 0.0772, -0.0167], [0.0686, 0.0668, -0.0106], [0.0687, 0.0581, -0.0031], [0.0676, 0.0466, 0.0055], [0.0635, 0.0327, 0.0099], [0.0587, 0.0168, 0.0129]],
    chin: [[0.0587, 0.0168, 0.0129], [0.0588, 0.0085, 0.0184], [0.058, 0.0025, 0.02], [0.055, -0.012, 0.0319], [0.0506, -0.0138, 0.0405], [0.0448, -0.0204, 0.0472], [0.0357, -0.0265, 0.0538], [0.0238, -0.0328, 0.0571], [0.0161, -0.0335, 0.0604]],
  };
  for (const s of [-1, 1]) for (const k of ['front', 'back', 'chin']) path(G.straps, ST[k].map((p) => [p[0] * s, p[1], p[2]]), 0.0026, 5);
  boxC(G.straps, [0, -0.0345, 0.0615], 0.032, 0.008, 0.012);             // buckle
  for (const s of [-1, 1]) boxC(G.straps, [s * 0.0587, 0.0168, 0.0129], 0.006, 0.012, 0.012);   // strap splitters
  return G;
}

