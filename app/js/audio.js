import { FREEWHEEL_SR, FREEWHEEL_LOOPS, FREEWHEEL_PCM } from './freewheel.js?v=75';
import { PEDAL_SR, PEDAL_PCM } from './pedal.js?v=75';
// audio.js — sound for Rydehaven, made live with the Web Audio API. The freewheel uses real recorded clicks (see Credits); everything else is synthesised.
//   Home screen: "Morning Chords", an original track (piano chords and a soft beat), played from audio/home.mp3.
//   In a ride: a slight recorded pedalling sound, the recorded freewheel when you coast, and chimes for KOMs,
//   laps, the race countdown and the finish. No wind, tyre or crowd sounds.
// Browsers only allow sound after the first click or key press, so everything waits for that.

const SOUND_KEY = 'rydehaven.sound';
const SOUND_DEFAULT = { music: 0.6, sfx: 0.8, muted: false };
export function getSound() { try { return { ...SOUND_DEFAULT, ...JSON.parse(localStorage.getItem(SOUND_KEY) || '{}') }; } catch (e) { return { ...SOUND_DEFAULT }; } }
export function setSound(o) { const v = { ...getSound(), ...o }; try { localStorage.setItem(SOUND_KEY, JSON.stringify(v)); } catch (e) {} sndApply(); return v; }

let AC = null, sndMaster = null, sndMusicBus = null, sndSfxBus = null, sndNoise = null, sndImpulse = null, sndUnlocked = false;
const sndWaiters = [];
function sndCtx() {
  if (AC) return AC;
  const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
  try { AC = new C(); } catch (e) { return null; }
  const comp = AC.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.2;
  sndMaster = AC.createGain(); sndMaster.connect(comp); comp.connect(AC.destination);
  sndMusicBus = AC.createGain(); sndMusicBus.connect(sndMaster);
  sndSfxBus = AC.createGain(); sndSfxBus.connect(sndMaster);
  const sr = AC.sampleRate, n = sr * 2;
  sndNoise = AC.createBuffer(1, n, sr); { const d = sndNoise.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; }
  const L = Math.floor(sr * 2.4); sndImpulse = AC.createBuffer(2, L, sr);                 // reverb: decaying stereo noise
  for (let ch = 0; ch < 2; ch++) { const d = sndImpulse.getChannelData(ch); for (let i = 0; i < L; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / L, 3.2); }
  sndApply();
  return AC;
}
function sndApply() {
  if (!AC) return;
  const s = getSound(), t = AC.currentTime;
  sndMaster.gain.setTargetAtTime(s.muted ? 0 : 1, t, 0.05);
  sndMusicBus.gain.setTargetAtTime(s.music * 0.9, t, 0.05);
  sndSfxBus.gain.setTargetAtTime(s.sfx, t, 0.05);
}
function sndReverb(out, wet) { const c = AC.createConvolver(); c.buffer = sndImpulse; const g = AC.createGain(); g.gain.value = wet; c.connect(g); g.connect(out); return c; }
function onAudioReady(fn) { if (sndUnlocked && AC) fn(); else sndWaiters.push(fn); }
function sndUnlock() {
  const a = sndCtx(); if (!a) return;
  const go = () => { if (sndUnlocked) return; sndUnlocked = true; for (const f of sndWaiters.splice(0)) { try { f(); } catch (e) { console.warn('audio', e); } } };
  if (a.state === 'running') go(); else a.resume().then(go).catch(() => {});
}
for (const ev of ['pointerdown', 'keydown', 'touchend']) addEventListener(ev, sndUnlock, true);
export const toggleMute = () => setSound({ muted: !getSound().muted }).muted;

// ---------- small building blocks ----------
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
function sndEnv(g, t, peak, a, d, sustain = 0) {
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + d);
}
function sndOsc(type, f, t, dur, out, peak, a = 0.005, d = null, detune = 0) {
  const o = AC.createOscillator(), g = AC.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
  sndEnv(g, t, peak, a, d === null ? dur : d); o.connect(g); g.connect(out); o.start(t); o.stop(t + a + (d === null ? dur : d) + 0.05); return o;
}
function sndNoiseHit(t, out, peak, dur, type, f, q = 1) {
  const s = AC.createBufferSource(); s.buffer = sndNoise; s.playbackRate.value = 0.8 + Math.random() * 0.4;
  const fl = AC.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
  const g = AC.createGain(); sndEnv(g, t, peak, 0.002, dur); s.connect(fl); fl.connect(g); g.connect(out);
  s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
}

// ---------- home screen music: "Morning Chords" ----------
// An original track made for Rydehaven: calm piano chords (Cmaj7, G/B, Am7, Fmaj7) with a soft beat, 84 bpm, 32 bars.
// The file holds the 91.4 s loop plus 3 s of its own start, so the loop points sit inside real music (never on mp3 padding).
const MUSIC_FILE = 'audio/home.mp3', MUSIC_LOOP = 32 * 4 * 60 / 84, MUSIC_IN = 1.0, MUSIC_GAIN = 0.6;
const MUSIC = { want: false, on: false, gen: 0, src: null, out: null, loading: null, el: null, elNode: null };
function b64Bytes(b64) { const bin = atob(b64.trim()), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
async function musicBytes() {
  if (MUSIC_FILE.startsWith('data:')) return b64Bytes(MUSIC_FILE.slice(MUSIC_FILE.indexOf(',') + 1));   // Safari can't fetch data: URLs reliably
  const r = await fetch(MUSIC_FILE); if (!r.ok) throw new Error('music ' + r.status);
  if (MUSIC_FILE.endsWith('.b64.txt')) return b64Bytes(await r.text());                            // hosts that only serve text
  return new Uint8Array(await r.arrayBuffer());
}
// Resolves to { buf } (decoded, loops with no gap) or, if this browser won't decode it, { url } for a plain <audio> loop.
function musicSource() {
  if (!MUSIC.loading) MUSIC.loading = (async () => {
    const bytes = await musicBytes();
    try {
      const copy = bytes.slice().buffer;                                               // decodeAudioData empties the buffer it's given
      const buf = await new Promise((res, rej) => { const p = AC.decodeAudioData(copy, res, rej); if (p && p.catch) p.catch(rej); });   // callback form for older Safari
      return { buf };
    } catch (e) {
      console.info('Home music: using the audio player instead', e);
      return { url: URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' })) };
    }
  })().catch(e => { console.info('Home music unavailable', e); MUSIC.loading = null; return null; });
  return MUSIC.loading;
}
export function startMusic() {
  MUSIC.want = true;
  onAudioReady(async () => {
    if (!MUSIC.want || MUSIC.on) return;
    MUSIC.on = true; const gen = ++MUSIC.gen;
    const m = await musicSource();
    if (gen !== MUSIC.gen || !MUSIC.on) return;                                       // stopped (or restarted) while loading
    if (!m) { MUSIC.on = false; return; }
    const t = AC.currentTime, out = AC.createGain();
    out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(MUSIC_GAIN, t + 2); out.connect(sndMusicBus);
    if (m.buf) {
      const src = AC.createBufferSource();
      src.buffer = m.buf; src.loop = true; src.loopStart = MUSIC_IN; src.loopEnd = MUSIC_IN + MUSIC_LOOP;
      src.connect(out); src.start(t); MUSIC.src = src;
    } else {
      const el = MUSIC.el || (MUSIC.el = new Audio(m.url)); el.loop = true;
      if (!MUSIC.elNode) { try { MUSIC.elNode = AC.createMediaElementSource(el); } catch (e) {} }
      if (MUSIC.elNode) { MUSIC.elNode.disconnect(); MUSIC.elNode.connect(out); } else el.volume = Math.min(1, MUSIC_GAIN * getSound().music * (getSound().muted ? 0 : 1));
      el.currentTime = 0; const p = el.play(); if (p && p.catch) p.catch(() => {});
      MUSIC.src = { stop: (at) => setTimeout(() => el.pause(), Math.max(0, (at - AC.currentTime) * 1000)) };
    }
    MUSIC.out = out;
  });
}
export function stopMusic(fade = 1.2) {
  MUSIC.want = false; MUSIC.gen++;
  if (!MUSIC.on) return;
  MUSIC.on = false;
  const o = MUSIC.out, src = MUSIC.src; MUSIC.out = MUSIC.src = null;
  if (!o) return;                                                                    // still loading: nothing playing yet
  const t = AC.currentTime;
  o.gain.cancelScheduledValues(t); o.gain.setValueAtTime(Math.max(0.0001, o.gain.value), t); o.gain.exponentialRampToValueAtTime(0.0001, t + fade);
  try { src.stop(t + fade + 0.05); } catch (e) {}
  setTimeout(() => { try { o.disconnect(); } catch (e) {} }, fade * 1000 + 400);
}

// ---------- one-shot sound effects ----------
export function playSfx(name) {
  if (!sndUnlocked || !AC) return;
  const t = AC.currentTime + 0.01, out = sndSfxBus, verb = sndReverb(out, 0.35);
  const bell = (m, at, peak = 0.12, len = 0.9) => { sndOsc('sine', mtof(m), at, len, out, peak, 0.003, len); sndOsc('sine', mtof(m) * 2.76, at, len * 0.4, out, peak * 0.25, 0.002, len * 0.4); sndOsc('sine', mtof(m), at, len, verb, peak * 0.6, 0.003, len); };
  const brass = (m, at, len, peak = 0.07) => { const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(600, at); f.frequency.linearRampToValueAtTime(2600, at + 0.08); f.connect(out); f.connect(verb);
    for (const d of [-6, 6]) { const o = AC.createOscillator(), g = AC.createGain(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = d; g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(peak, at + 0.04); g.gain.setValueAtTime(peak, at + len * 0.75); g.gain.exponentialRampToValueAtTime(0.0001, at + len + 0.2); o.connect(g); g.connect(f); o.start(at); o.stop(at + len + 0.25); } };
  switch (name) {
    case 'click': sndOsc('sine', 1400, t, 0.04, out, 0.05, 0.002, 0.04); break;
    case 'beep': sndOsc('square', 880, t, 0.12, out, 0.06, 0.003, 0.14); sndOsc('sine', 880, t, 0.2, out, 0.12, 0.003, 0.2); break;
    case 'go': sndOsc('square', 1320, t, 0.6, out, 0.06, 0.003, 0.7); sndOsc('sine', 1320, t, 0.8, verb, 0.15, 0.003, 0.8); break;
    case 'komStart': bell(76, t, 0.1, 0.6); bell(81, t + 0.13, 0.1, 0.9); break;
    case 'lap': bell(84, t, 0.11, 1.2); bell(88, t + 0.09, 0.07, 1.0); break;
    case 'komFinish': [72, 76, 79, 84].forEach((m, k) => bell(m, t + k * 0.09, 0.1, 1.1)); break;
    case 'record': [72, 76, 79, 84, 88].forEach((m, k) => bell(m, t + k * 0.08, 0.11, 1.3)); brass(60, t + 0.45, 0.25); brass(64, t + 0.45, 0.25); brass(67, t + 0.45, 0.25); brass(72, t + 0.75, 1.0); brass(64, t + 0.75, 1.0); brass(67, t + 0.75, 1.0); break;
    case 'finish': brass(60, t, 0.22); brass(67, t + 0.24, 0.22); brass(72, t + 0.48, 1.4); brass(64, t + 0.48, 1.4); brass(67, t + 0.48, 1.4); [84, 88, 91, 96].forEach((m, k) => bell(m, t + 0.5 + k * 0.07, 0.06, 1.4)); break;
  }
}

// ---------- ride sounds: tyres, pedalling, freewheel ----------
// Mechanical sounds are built from individual clicks rather than filtered static:
//   freewheel: real clicks recorded from a hub (tim.kahn, Freesound, CC BY 4.0), 36 per wheel turn
//   pedalling: a quiet, smoothed recording of a drivetrain (Rudmer_Rotteveel, Freesound, CC0), looped while you pedal
//   tyres:     off (the low roll sounded like wind)
function sndClickBank(n, partials, decayMs, noise, lenMs) {                         // a few slightly different click samples
  const sr = AC.sampleRate, L = Math.floor((sr * lenMs) / 1000), bank = [];
  for (let k = 0; k < n; k++) {
    const b = AC.createBuffer(1, L, sr), d = b.getChannelData(0), jit = partials.map(() => 0.94 + Math.random() * 0.12);
    for (let i = 0; i < L; i++) {
      const t = i / sr, env = Math.exp(-t / (decayMs / 1000));
      let v = 0; partials.forEach(([f, a], j) => { v += a * Math.sin(2 * Math.PI * f * jit[j] * t); });
      v += noise * (Math.random() * 2 - 1) * Math.exp(-t / 0.0004);                // the tiny "tick" at the start
      d[i] = v * env;
    }
    let pk = 0; for (let i = 0; i < L; i++) pk = Math.max(pk, Math.abs(d[i])); for (let i = 0; i < L; i++) d[i] /= pk || 1;
    bank.push(b);
  }
  return bank;
}
function pedalLoop() {                                                             // decode the recorded pedalling loop
  const raw = atob(PEDAL_PCM), n = raw.length >> 1, b = AC.createBuffer(1, n, PEDAL_SR), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) { const v = raw.charCodeAt(2 * i) | (raw.charCodeAt(2 * i + 1) << 8); d[i] = (v > 32767 ? v - 65536 : v) / 32768; }
  return b;
}
function freewheelLoops() {                                                         // decode the recorded loops into audio buffers
  const raw = atob(FREEWHEEL_PCM), pcm = new Int16Array(raw.length >> 1);
  for (let i = 0; i < pcm.length; i++) pcm[i] = raw.charCodeAt(2 * i) | (raw.charCodeAt(2 * i + 1) << 8);
  return FREEWHEEL_LOOPS.map(([rate, o, n, gain]) => { const b = AC.createBuffer(1, n, FREEWHEEL_SR), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = pcm[o + i] / 32768; return { rate, gain, buf: b }; });
}
// Coasting plays the recording itself: the loop whose click speed is nearest the wheel's, nudged faster or slower to match.
// The recorded wheel clicked at 15 to 61 times a second, so speed maps to 10 clicks per wheel turn to stay in that range.
const FW_PER_TURN = 10;
export function makeRideAudio() {
  const A = { n: null, stopped: false, st: { v: 0, pedaling: false, paused: true, crank: 0, cadence: 0 }, timer: 0, tFree: 0, tChain: 0, tGrit: 0 };
  onAudioReady(() => {
    if (A.stopped) return;
    const out = sndSfxBus, sr = AC.sampleRate, n = {};
    // tyres: brown noise (each sample drifts from the last) is a soft rumble, not a hiss
    const len = sr * 3, bb = AC.createBuffer(1, len, sr), bd = bb.getChannelData(0); let last = 0, pk = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last; pk = Math.max(pk, Math.abs(last)); }
    for (let i = 0; i < len; i++) bd[i] /= pk;
    const roll = AC.createBufferSource(); roll.buffer = bb; roll.loop = true;
    n.rollF = AC.createBiquadFilter(); n.rollF.type = 'lowpass'; n.rollF.frequency.value = 300; n.rollF.Q.value = 0.5;
    const hp = AC.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 45;
    n.roll = AC.createGain(); n.roll.gain.value = 0;
    roll.connect(hp); hp.connect(n.rollF); n.rollF.connect(n.roll); n.roll.connect(out); roll.start();
    // click buses (each has its own tone shaping and level)
    const bus = (type, f, q) => { const fl = AC.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = AC.createGain(); g.gain.value = 1; fl.connect(g); g.connect(out); return fl; };
    n.chainBus = bus('lowpass', 3800, 0.6);
    n.gritBus = bus('bandpass', 1400, 0.7);
    n.loops = freewheelLoops();
    n.fwOut = AC.createGain(); n.fwOut.gain.value = 0; n.fwOut.connect(out);       // overall freewheel level (0 while pedalling)
    // pedalling: a quiet, smoothed recording of a drivetrain, looped; only while you pedal
    n.pedSrc = AC.createBufferSource(); n.pedSrc.buffer = pedalLoop(); n.pedSrc.loop = true;
    n.pedOut = AC.createGain(); n.pedOut.gain.value = 0; n.pedSrc.connect(n.pedOut); n.pedOut.connect(out); n.pedSrc.start(0, Math.random() * 4);
    n.chain = sndClickBank(6, [[1650, 1], [2750, 0.5], [4100, 0.2]], 2.6, 0.35, 14);   // duller, softer
    n.grit = sndClickBank(4, [[900, 0.6], [1900, 0.4]], 0.9, 1, 5);                   // a grain of road under the tyre
    A.n = n;
    const play = (bank, dest, t, gain, rate = 1) => {
      const s = AC.createBufferSource(), g = AC.createGain(); s.buffer = bank[(Math.random() * bank.length) | 0]; s.playbackRate.value = rate;
      g.gain.value = gain; s.connect(g); g.connect(dest); s.start(t);
    };
    A.timer = setInterval(() => {                                                    // schedule clicks a little ahead of time
      if (A.stopped) return;
      const now = AC.currentTime, ahead = now + 0.12, st = A.st;
      if (document.hidden || st.paused) { A.tChain = A.tGrit = now; return; }
      const v = Math.max(0, st.v), rps = v / 2.1;                                    // wheel turns per second
      // (pedalling and road-grit clicks removed: they sounded like a freewheel; a real pedalling recording will replace them)
    }, 25);
  });
  return {
    // v m/s · pedaling · paused · crank angle (rad) and cadence (rpm)
    update(st) {
      A.st = st;
      if (!A.n || A.stopped) return;
      const t = AC.currentTime, v = Math.max(0, st.v || 0), sp = Math.min(1, v / 16);
      A.n.roll.gain.setTargetAtTime(0, t, 0.1);                                       // tyre roll off: it sounded like wind
      // freewheel: pick the recorded loop closest to the wheel's click speed, crossfade when it changes
      const want = (v / 2.1) * FW_PER_TURN, coast = !st.pedaling && !st.paused && v > 0.5, L = A.n.loops;
      let k = 0; for (let j = 1; j < L.length; j++) if (Math.abs(Math.log(L[j].rate / want)) < Math.abs(Math.log(L[k].rate / want))) k = j;
      if (A.fw && A.fw.k !== k && Math.abs(Math.log(L[A.fw.k].rate / want)) > Math.abs(Math.log(L[k].rate / want)) + 0.05) {
        const old = A.fw; old.g.gain.setTargetAtTime(0, t, 0.08); old.src.stop(t + 0.6); A.fw = null;   // a little hysteresis avoids flip-flopping
      }
      if (!A.fw) {
        const src = AC.createBufferSource(), g = AC.createGain(); src.buffer = L[k].buf; src.loop = true;
        g.gain.setValueAtTime(0, t); g.gain.setTargetAtTime(L[k].gain, t, 0.08); src.connect(g); g.connect(A.n.fwOut);
        src.start(t, Math.random() * L[k].buf.duration); A.fw = { k, src, g };
      }
      A.fw.src.playbackRate.setTargetAtTime(Math.max(0.75, Math.min(1.35, want / L[A.fw.k].rate)), t, 0.15);
      A.n.fwOut.gain.setTargetAtTime(coast ? 0.22 * Math.min(1, 0.3 + v / 6) : 0, t, coast ? 0.12 : 0.05);
      const pedal = st.pedaling && !st.paused && v > 0.3, rpm = st.cadence || 80;
      A.n.pedOut.gain.setTargetAtTime(pedal ? 0.03 * (0.6 + 0.4 * Math.min(1, rpm / 90)) : 0, t, pedal ? 0.25 : 0.08);   // slight: well under the freewheel
      A.n.pedSrc.playbackRate.setTargetAtTime(Math.max(0.85, Math.min(1.15, rpm / 80)), t, 0.3);
      A.n.rollF.frequency.setTargetAtTime(160 + v * 32, t, 0.3);
    },
    stop() { A.stopped = true; clearInterval(A.timer); if (A.n) A.n.roll.gain.setTargetAtTime(0, AC.currentTime, 0.1); },
  };
}
