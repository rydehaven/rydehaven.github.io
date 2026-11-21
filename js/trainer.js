// trainer.js — smart trainer, power meter and heart-rate strap over Bluetooth (Web Bluetooth: Chrome / Edge only).
//  • Smart trainers (Wahoo KICKR, Tacx, Elite, Saris, Zwift Hub…) via FTMS (Fitness Machine Service):
//    power + cadence in, and control out: SIM mode (road gradient) or ERG mode (target watts).
//  • Power meters / older trainers via the Cycling Power Service: power + cadence, no control.
//  • Heart-rate straps via the Heart Rate Service.
const FTMS = 0x1826, BIKE_DATA = 0x2ad2, FTMS_CP = 0x2ad9, CPS = 0x1818, CP_MEAS = 0x2a63, HRS = 0x180d, HR_MEAS = 0x2a37;

export const BT_SUPPORT = typeof navigator !== 'undefined' && !!navigator.bluetooth;
export function btHelp() {
  if (BT_SUPPORT) return '';
  const safari = /Safari\//.test(navigator.userAgent) && !/Chrome|Chromium|Edg\//.test(navigator.userAgent);
  return safari ? 'Safari can’t connect to Bluetooth devices. Open this app in Chrome or Edge to pair your trainer.'
    : 'This browser can’t connect to Bluetooth devices. Use Chrome or Edge on a Mac, Windows PC or Android.';
}

const listeners = new Set();
export const trainer = {
  name: '', hrName: '', kind: '',            // kind: 'ftms' (controllable) | 'power' (power only) | ''
  power: 0, cadence: null, hr: null, last: 0, hrLast: 0,
  difficulty: 0.5,                           // share of the real gradient sent in SIM mode (Zwift's default is 50%)
  get connected() { return !!this.kind && performance.now() - this.last < 5000; },
  get hrConnected() { return !!this.hrName && performance.now() - this.hrLast < 5000; },
  get controllable() { return this.kind === 'ftms' && !!cp; },
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
const emit = () => listeners.forEach((f) => { try { f(trainer); } catch (e) {} });

let cp = null, device = null;
// ---------- control point: one write at a time, newest command wins ----------
let busy = false, pending = null;
async function send(bytes) {
  if (!cp) return;
  pending = bytes; if (busy) return;
  busy = true;
  while (pending) { const b = pending; pending = null; try { await cp.writeValueWithResponse(new Uint8Array(b)); } catch (e) { console.warn('trainer write failed', e); } }
  busy = false;
}
let lastCmd = '';
export function setErg(watts) {
  const w = Math.max(0, Math.min(2000, Math.round(watts))), key = 'erg' + w; if (key === lastCmd) return; lastCmd = key;
  send([0x05, w & 0xff, (w >> 8) & 0xff]);
}
export function setSim(grade) { // grade as a fraction (0.05 = 5 %)
  const g = Math.max(-0.2, Math.min(0.25, grade * trainer.difficulty)), gi = Math.round(g * 10000), key = 'sim' + Math.round(g * 200);
  if (key === lastCmd) return; lastCmd = key;
  // wind 0 m/s, grade in 0.01 %, Crr 0.004 (×0.0001), CdA-ish wind coefficient 0.51 kg/m (×0.01)
  send([0x11, 0, 0, gi & 0xff, (gi >> 8) & 0xff, 40, 51]);
}

// ---------- parsing ----------
function parseBikeData(dv) { // FTMS Indoor Bike Data
  const f = dv.getUint16(0, true); let o = 2;
  if (!(f & 1)) o += 2;                                  // instantaneous speed (present when bit 0 is 0)
  if (f & 2) o += 2;                                     // average speed
  if (f & 4) { trainer.cadence = dv.getUint16(o, true) / 2; o += 2; }
  if (f & 8) o += 2;                                     // average cadence
  if (f & 16) o += 3;                                    // total distance
  if (f & 32) o += 2;                                    // resistance level
  if (f & 64) { trainer.power = Math.max(0, dv.getInt16(o, true)); o += 2; }
  if (f & 128) o += 2;                                   // average power
  if (f & 256) o += 5;                                   // energy
  if (f & 512 && o < dv.byteLength) { const h = dv.getUint8(o); if (h) { trainer.hr = h; if (!trainer.hrName) trainer.hrLast = performance.now(); } }
  trainer.last = performance.now(); emit();
}
let crank = null;
function parsePower(dv) { // Cycling Power Measurement
  const f = dv.getUint16(0, true); let o = 4;
  trainer.power = Math.max(0, dv.getInt16(2, true));
  if (f & 1) o += 1; if (f & 4) o += 2; if (f & 16) o += 6;
  if (f & 32 && o + 4 <= dv.byteLength) {                // crank revolutions -> cadence
    const revs = dv.getUint16(o, true), t = dv.getUint16(o + 2, true);
    if (crank) { const dr = (revs - crank.revs + 65536) % 65536, dt = ((t - crank.t + 65536) % 65536) / 1024;
      if (dt > 0) trainer.cadence = (dr / dt) * 60; else if (performance.now() - crank.at > 2500) trainer.cadence = 0; }
    if (!crank || revs !== crank.revs) crank = { revs, t, at: performance.now() };
  }
  trainer.last = performance.now(); emit();
}
function parseHr(dv) { const f = dv.getUint8(0); trainer.hr = f & 1 ? dv.getUint16(1, true) : dv.getUint8(1); trainer.hrLast = performance.now(); emit(); }

// ---------- pairing ----------
export async function connectTrainer() {
  if (!BT_SUPPORT) throw new Error(btHelp());
  device = await navigator.bluetooth.requestDevice({ filters: [{ services: [FTMS] }, { services: [CPS] }], optionalServices: [FTMS, CPS, HRS] });
  device.addEventListener('gattserverdisconnected', onDrop);
  await openTrainer();
  return trainer;
}
async function openTrainer() {
  const gatt = await device.gatt.connect();
  trainer.name = device.name || 'Trainer'; cp = null; lastCmd = ''; crank = null;
  try {
    const svc = await gatt.getPrimaryService(FTMS);
    const data = await svc.getCharacteristic(BIKE_DATA);
    data.addEventListener('characteristicvaluechanged', (e) => parseBikeData(e.target.value));
    await data.startNotifications();
    try {
      cp = await svc.getCharacteristic(FTMS_CP);
      await cp.startNotifications();                     // the trainer answers each command here
      await cp.writeValueWithResponse(new Uint8Array([0x00]));   // request control
      await cp.writeValueWithResponse(new Uint8Array([0x07]));   // start / resume
    } catch (e) { console.warn('trainer control unavailable', e); cp = null; }
    trainer.kind = 'ftms';
  } catch (e) {                                          // no FTMS: plain power meter / older trainer
    const svc = await gatt.getPrimaryService(CPS), m = await svc.getCharacteristic(CP_MEAS);
    m.addEventListener('characteristicvaluechanged', (ev) => parsePower(ev.target.value));
    await m.startNotifications();
    trainer.kind = 'power';
  }
  trainer.last = performance.now(); emit();
}
async function onDrop() { // try to reconnect a few times (trainers drop briefly when you stop pedaling, etc.)
  emit();
  for (let i = 0; i < 3 && device; i++) { await new Promise((r) => setTimeout(r, 1500 * (i + 1))); try { await openTrainer(); return; } catch (e) {} }
  trainer.kind = ''; cp = null; emit();
}
export async function connectHr() {
  if (!BT_SUPPORT) throw new Error(btHelp());
  const d = await navigator.bluetooth.requestDevice({ filters: [{ services: [HRS] }] });
  const gatt = await d.gatt.connect(), m = await (await gatt.getPrimaryService(HRS)).getCharacteristic(HR_MEAS);
  m.addEventListener('characteristicvaluechanged', (e) => parseHr(e.target.value));
  await m.startNotifications();
  trainer.hrName = d.name || 'Heart rate'; trainer.hrLast = performance.now(); emit();
  d.addEventListener('gattserverdisconnected', () => { trainer.hrName = ''; emit(); });
}
export function disconnectTrainer() { const d = device; device = null; trainer.kind = ''; cp = null; if (d && d.gatt.connected) d.gatt.disconnect(); emit(); }
