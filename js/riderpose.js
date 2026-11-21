// riderpose.js — puts a Mixamo-rigged rider on the generated bike and pedals it. Pure JS (no Three.js).
// Rider space: +y up, +z forward, +x = rider's LEFT (same axes as the bike). Units: meters.
// makeRiderPose(rig, BIKE) -> { scale, pose(crankAngle, t) -> { hips: [x,y,z], quats: [[x,y,z,w] per bone] } }
// The returned bone quaternions are LOCAL (relative to the parent), ready for bone.quaternion.

// ---- tiny math ----
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qaxis = (ax, an) => { const s = Math.sin(an / 2), l = Math.hypot(ax[0], ax[1], ax[2]) || 1; return [ax[0] / l * s, ax[1] / l * s, ax[2] / l * s, Math.cos(an / 2)]; };
const qrot = (q, v) => { const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q)); return [p[0], p[1], p[2]]; };
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const rsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const rdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const rlen = (a) => Math.hypot(a[0], a[1], a[2]);
const rnrm = (a) => { const l = rlen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function qFromMat(m) { // m = [x axis, y axis, z axis] columns
  const [a, b, c] = m, tr = a[0] + b[1] + c[2];
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; return [(b[2] - c[1]) / s, (c[0] - a[2]) / s, (a[1] - b[0]) / s, 0.25 * s]; }
  if (a[0] > b[1] && a[0] > c[2]) { const s = Math.sqrt(1 + a[0] - b[1] - c[2]) * 2; return [0.25 * s, (b[0] + a[1]) / s, (c[0] + a[2]) / s, (b[2] - c[1]) / s]; }
  if (b[1] > c[2]) { const s = Math.sqrt(1 + b[1] - a[0] - c[2]) * 2; return [(b[0] + a[1]) / s, 0.25 * s, (c[1] + b[2]) / s, (c[0] - a[2]) / s]; }
  const s = Math.sqrt(1 + c[2] - a[0] - b[1]) * 2; return [(c[0] + a[2]) / s, (c[1] + b[2]) / s, 0.25 * s, (a[1] - b[0]) / s];
}
const frame = (d, p) => { const x = rnrm(d), y = rnrm(rsub(p, [x[0] * rdot(p, x), x[1] * rdot(p, x), x[2] * rdot(p, x)])); return [x, y, crs(x, y)]; };
// rotation taking direction d0 (with side vector p0) onto d1 (with side p1)
const align = (d0, p0, d1, p1) => qmul(qFromMat(frame(d1, p1)), qinv(qFromMat(frame(d0, p0))));
function mat4ToTQ(m) { // column-major 4x4 -> translation + rotation quaternion (assumes no scale)
  return { t: [m[12], m[13], m[14]], q: qFromMat([[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]]) };
}
// two-bone IK: joint positions a (root), target t, lengths l1 l2, bend hint direction -> middle joint
function ik2(a, t, l1, l2, bend) {
  let d = rsub(t, a), D = rlen(d); const maxD = (l1 + l2) * 0.999;
  if (D > maxD) { t = add(a, rnrm(d), maxD); d = rsub(t, a); D = maxD; }
  const dn = rnrm(d), x = (D * D + l1 * l1 - l2 * l2) / (2 * D), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const side = rnrm(rsub(bend, [dn[0] * rdot(bend, dn), dn[1] * rdot(bend, dn), dn[2] * rdot(bend, dn)]));
  return { mid: add(add(a, dn, x), side, h), t };
}

export function makeRiderPose(rig, BIKE, opts = {}) {
  const bones = rig.bones, n = bones.length, idx = Object.fromEntries(bones.map((b, i) => [b.name, i]));
  const local = bones.map((b) => mat4ToTQ(b.matrix));
  // rest world transforms
  const RQ = [], RP = [];
  bones.forEach((b, i) => {
    if (b.parent < 0) { RQ[i] = local[i].q; RP[i] = local[i].t; }
    else { RQ[i] = qmul(RQ[b.parent], local[i].q); RP[i] = add(RP[b.parent], qrot(RQ[b.parent], local[i].t)); }
  });
  const P = (name) => RP[idx[name]];
  const L = (a, b) => rlen(rsub(P(a), P(b)));
  const thigh = L('LeftUpLeg', 'LeftLeg'), shin = L('LeftLeg', 'LeftFoot'), footL = L('LeftFoot', 'LeftToeBase');
  const uarm = L('LeftArm', 'LeftForeArm'), farm = L('LeftForeArm', 'LeftHand');
  const restFootAng = Math.atan2(P('LeftFoot')[1] - P('LeftToeBase')[1], P('LeftToeBase')[2] - P('LeftFoot')[2]);

  // ---- fit: saddle + pedals give the leg reach; scale the rider so the knee keeps ~150° at the bottom ----
  const saddleTop = [0, BIKE.SADDLE[1] + 0.057, BIKE.SADDLE[2] - 0.05];
  const hipAbove = 0.085, hipFwd = 0.035, sole = 0.028, toeDownAvg = 0.25;
  const hipOff = rsub(P('LeftUpLeg'), P('Hips'));                                    // hip joint below/aside the pelvis
  function ankleTarget(pedal, crank, side) {                                          // ankle from pedal + ankling
    const td = toeDownAvg + 0.13 * Math.sin(crank + (side > 0 ? Math.PI : 0) - 0.6); // more toe-down at the back of the stroke
    const ball = [pedal[0], pedal[1] + sole, pedal[2] + 0.005];
    const a = restFootAng + td * 0.0 + td;                                            // ankle sits above-behind the ball
    return { ball, ankle: [pedal[0], ball[1] + Math.sin(a) * footL, ball[2] - Math.cos(a) * footL], td };
  }
  let scale = 1;
  for (let it = 0; it < 30; it++) {                                                   // fixed-point: scale so max reach = 96.5% of the leg
    const hip = add([0, saddleTop[1] + hipAbove * scale, saddleTop[2] + hipFwd], hipOff, scale);
    let maxD = 0;
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const ped = [BIKE.PEDAL_X, BIKE.BB[1] + s * BIKE.CRANK, BIKE.BB[2] - c * BIKE.CRANK];
      const an = ankleTarget(ped, a, 1).ankle; maxD = Math.max(maxD, rlen(rsub(an, hip)));
    }
    scale = maxD / (0.965 * (thigh + shin));
  }
  const S = scale;
  const hipsPos = [0, saddleTop[1] + hipAbove * S, saddleTop[2] + hipFwd - 0.02];

  // ---- torso lean: bend the spine until the hands reach the hoods with slightly bent elbows ----
  // wrist sits just behind and above the hood (palm on top of it, fingers over the front)
  const hand = (side) => [side * (BIKE.HOODS[0][0] - 0.005), BIKE.BAR[1] + 0.075, BIKE.BAR[2] + 0.01];
  const pelvisPitch = 0.58;                                                           // pelvis rolled forward (rad)
  const spineNames = ['Spine', 'Spine1', 'Spine2'];
  function shoulderAt(bend) {
    const W = {}, Ps = {};
    W.Hips = qmul(qaxis([1, 0, 0], pelvisPitch), RQ[idx.Hips]); Ps.Hips = hipsPos;
    let parent = 'Hips';
    for (const [k, nm] of spineNames.entries()) {
      Ps[nm] = add(Ps[parent], qrot(W[parent], local[idx[nm]].t), S);
      W[nm] = qmul(qaxis([1, 0, 0], pelvisPitch + bend * (k + 1) / 3), RQ[idx[nm]]); parent = nm;
    }
    Ps.LeftShoulder = add(Ps.Spine2, qrot(W.Spine2, local[idx.LeftShoulder].t), S);
    const Wsh = qmul(W.Spine2, local[idx.LeftShoulder].q);
    return add(Ps.LeftShoulder, qrot(Wsh, local[idx.LeftArm].t), S);
  }
  let lo = 0, hi = 1.4;
  for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (rlen(rsub(hand(1), shoulderAt(m))) > 0.95 * (uarm + farm) * S) lo = m; else hi = m; }
  const spineBend = (lo + hi) / 2;

  // ---- per-frame pose ----
  const leftHandBones = bones.map((b, i) => i).filter((i) => /^(Left|Right)Hand(Index|Middle|Ring|Pinky|Thumb)\d$/.test(bones[i].name));
  function pose(crank, t = 0) {
    const W = new Array(n), Pw = new Array(n);
    const rock = Math.sin(crank * 2) * 0.008;                                         // pelvis rocks a touch; spine soaks it up so shoulders + head stay still
    const set = (i, q) => { W[i] = q; };
    for (let i = 0; i < n; i++) {
      const b = bones[i], nm = b.name, par = b.parent;
      Pw[i] = par < 0 ? hipsPos.slice() : add(Pw[par], qrot(W[par], local[i].t), S);
      let q = par < 0 ? RQ[i] : qmul(W[par], local[i].q);                             // default: keep the rest bend
      if (nm === 'Hips') q = qmul(qmul(qaxis([1, 0, 0], pelvisPitch), qaxis([0, 0, 1], rock)), RQ[i]);
      else if (spineNames.includes(nm)) { const k = spineNames.indexOf(nm) + 1; q = qmul(qaxis([1, 0, 0], pelvisPitch + spineBend * k / 3), RQ[i]); }
      else if (/^(Left|Right)Shoulder$/.test(nm)) { const sd = nm.startsWith('Left') ? 1 : -1; q = qmul(W[par], qmul(qaxis([0, 1, 0], -sd * 0.22), local[i].q)); }   // shoulders rolled forward, not spread
      else if (nm === 'Neck') q = qmul(qaxis([1, 0, 0], (pelvisPitch + spineBend) * 0.35), RQ[i]);
      else if (nm === 'Head') q = qmul(qaxis([1, 0, 0], -0.12), RQ[i]);               // chin up, eyes up the road
      else if (/^(Left|Right)Arm$/.test(nm)) {
        const sd = nm.startsWith('Left') ? 1 : -1, fa = idx[(sd > 0 ? 'Left' : 'Right') + 'ForeArm'], hd = idx[(sd > 0 ? 'Left' : 'Right') + 'Hand'];
        const { mid, t: tg } = ik2(Pw[i], hand(sd), uarm * S, farm * S, [sd * 0.3, -0.45, -0.5]);
        q = qmul(align(rsub(RP[fa], RP[i]), [0, 0, -1], rsub(mid, Pw[i]), rsub(mid, add(Pw[i], rnrm(rsub(tg, Pw[i])), rdot(rsub(mid, Pw[i]), rnrm(rsub(tg, Pw[i])))))), RQ[i]);
        W[i] = q; Pw[fa] = mid; Pw[hd] = tg; continue;
      } else if (/^(Left|Right)ForeArm$/.test(nm)) {
        const sd = nm.startsWith('Left') ? 1 : -1, hd = idx[(sd > 0 ? 'Left' : 'Right') + 'Hand'];
        const tg = hand(sd), pole = [sd * 0.3, -0.6, -0.7];
        q = qmul(align(rsub(RP[hd], RP[i]), [0, 0, -1], rsub(tg, Pw[i]), pole), RQ[i]);
      } else if (/^(Left|Right)Hand$/.test(nm)) {
        const sd = nm.startsWith('Left') ? 1 : -1;
        const fing = idx[(sd > 0 ? 'Left' : 'Right') + 'HandMiddle1'];
        q = qmul(align(rsub(RP[fing], RP[i]), [0, -1, 0], [sd * -0.12, -0.25, 1], [sd * -0.55, -0.83, 0.1]), RQ[i]);   // fingers forward, palm in/down
      } else if (/^(Left|Right)UpLeg$/.test(nm)) {
        const sd = nm.startsWith('Left') ? 1 : -1, lg = idx[(sd > 0 ? 'Left' : 'Right') + 'Leg'], ft = idx[(sd > 0 ? 'Left' : 'Right') + 'Foot'];
        const c = Math.cos(crank), s = Math.sin(crank);
        const ped = sd > 0 ? [BIKE.PEDAL_X, BIKE.BB[1] + s * BIKE.CRANK, BIKE.BB[2] - c * BIKE.CRANK] : [-BIKE.PEDAL_X, BIKE.BB[1] - s * BIKE.CRANK, BIKE.BB[2] + c * BIKE.CRANK];
        const A = ankleTarget(ped, crank, sd);
        const { mid, t: tg } = ik2(Pw[i], A.ankle, thigh * S, shin * S, [sd * 0.12, 0.15, 1]);
        q = qmul(align(rsub(RP[lg], RP[i]), [0, 0, 1], rsub(mid, Pw[i]), rsub(mid, add(Pw[i], rnrm(rsub(tg, Pw[i])), rdot(rsub(mid, Pw[i]), rnrm(rsub(tg, Pw[i])))))), RQ[i]);
        W[i] = q; Pw[lg] = mid; Pw[ft] = tg; bones[i]._ball = A.ball; continue;
      } else if (/^(Left|Right)Leg$/.test(nm)) {
        const sd = nm.startsWith('Left') ? 1 : -1, ft = idx[(sd > 0 ? 'Left' : 'Right') + 'Foot'];
        const ankle = Pw[ft] || add(Pw[i], qrot(q, local[ft].t), S);
        q = qmul(align(rsub(RP[ft], RP[i]), [0, 0, 1], rsub(ankle, Pw[i]), [0, 0.2, 1]), RQ[i]);
      } else if (/^(Left|Right)Foot$/.test(nm)) {
        const sd = nm.startsWith('Left') ? 1 : -1, toe = idx[(sd > 0 ? 'Left' : 'Right') + 'ToeBase'], ul = idx[(sd > 0 ? 'Left' : 'Right') + 'UpLeg'];
        const ball = bones[ul]._ball;
        q = qmul(align(rsub(RP[toe], RP[i]), [0, 1, 0], rsub(ball, Pw[i]), [0, 1, 0]), RQ[i]);
      }
      if (leftHandBones.includes(i)) {                                               // wrap the fingers round the hood
        const thumb = /Thumb/.test(nm), k = +nm.slice(-1);
        const sd = nm.startsWith('Left') ? 1 : -1, handW = W[idx[(sd > 0 ? 'Left' : 'Right') + 'Hand']];
        const axis = crs([sd * -0.12, -0.25, 1], [sd * -0.55, -0.83, 0.1]);             // curl toward the palm
        q = qmul(qaxis(axis, thumb ? 0.25 : (k === 1 ? 0.55 : 0.75)), q);
      }
      W[i] = q;
    }
    const quats = bones.map((b, i) => (b.parent < 0 ? W[i] : qmul(qinv(W[b.parent]), W[i])));
    return { hips: [hipsPos[0] / S, hipsPos[1] / S, hipsPos[2] / S], quats, world: { W, P: Pw } };
  }
  return { scale: S, spineBend, pose, restWorld: { RQ, RP }, idx };
}
