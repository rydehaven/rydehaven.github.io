// settings.js — everything the home screen lets you choose, remembered in this browser (localStorage).
import { BIKE_OPTIONS } from './bikegen.js';

export const APP_NAME = 'Rydehaven';                                   // the app's name, shown in the logo and window title
export const BASE_CDA = 0.335;                                        // rider on the hoods, before bike/wheel savings

const read = (k, d) => { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || '{}') }; } catch (e) { return { ...d }; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

// ---------- rider profile: name, country, height, weight. FTP is worked out by the app, not typed in ----------
// New riders start at 2.5 W/kg; after that FTP only moves when a ride shows a better 20-minute effort (95% of it).
const guessCountry = () => { try { const r = new Intl.Locale(navigator.language).maximize().region; return r && /^[A-Z]{2}$/.test(r) ? r : 'US'; } catch (e) { return 'US'; } };
export function getProfile() {
  const p = read('rydehaven.profile', { name: '', country: '', cm: 178, kg: 72, ftp: 0, ftpFrom: 'default' });
  p.kg = Math.min(150, Math.max(35, +p.kg || 72)); p.cm = Math.min(215, Math.max(130, +p.cm || 178));
  if (!/^[A-Z]{2}$/.test(p.country)) p.country = guessCountry();
  if (p.ftpFrom !== 'detected' || !(+p.ftp > 0)) { p.ftp = Math.round(p.kg * 2.5); p.ftpFrom = 'default'; }
  p.ftp = Math.min(600, Math.max(60, +p.ftp));
  return p;
}
export const setProfile = (p) => write('rydehaven.profile', p);
export function noteFtp(watts) { // called by the ride when a 20-minute effort beats the current estimate
  const p = getProfile(); p.ftp = Math.round(watts); p.ftpFrom = 'detected'; p.ftpDate = Date.now(); setProfile(p); return p.ftp;
}
// drag grows with body surface area (DuBois), relative to a 178 cm / 72 kg rider
export const bodyDrag = (p) => Math.pow(p.cm / 178, 0.725) * Math.pow(p.kg / 72, 0.425);
export const flag = (cc) => String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0)));
export const COUNTRY_CODES = ('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ ' +
  'DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ ' +
  'OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' ');
export function countryName(cc) { try { return new Intl.DisplayNames([navigator.language, 'en'], { type: 'region' }).of(cc) || cc; } catch (e) { return cc; } }

// ---------- bike + wheels ----------
export function getBikeChoice() {
  const c = read('rydehaven.bike', {});
  return { frame: BIKE_OPTIONS.frame[c.frame] ? c.frame : 'aero', wheels: BIKE_OPTIONS.wheels[c.wheels] ? c.wheels : 'deep' };
}
export const setBikeChoice = (c) => write('rydehaven.bike', c);
export function bikeStats(c) {
  const f = BIKE_OPTIONS.frame[c.frame], w = BIKE_OPTIONS.wheels[c.wheels];
  return { kg: f.kg + w.kg, CdA: BASE_CDA + f.dCdA + w.dCdA };
}

// ---------- ride options: free ride / race / workout ----------
export function getRideOptions() {
  const o = read('rydehaven.ride', { mode: 'free', laps: 0, workout: 'sweetspot', course: '' });
  if (!['free', 'race', 'workout'].includes(o.mode)) o.mode = 'free';
  if (!WORKOUTS[o.workout]) o.workout = 'sweetspot';
  return o;
}
export const setRideOptions = (o) => write('rydehaven.ride', o);

// Workouts: steps of { min, p } (share of FTP) or ramps { min, p0, p1 }; 'rep' repeats a block.
const rep = (n, ...steps) => Array.from({ length: n }, () => steps).flat();
export const WORKOUTS = {
  endurance: { name: 'Endurance 40', blurb: 'Steady zone 2 riding', steps: [{ min: 5, p0: 0.45, p1: 0.62 }, { min: 30, p: 0.66 }, { min: 5, p0: 0.6, p1: 0.45 }] },
  sweetspot: { name: 'Sweet Spot 3×8', blurb: 'Three 8-minute blocks just under threshold', steps: [{ min: 8, p0: 0.45, p1: 0.75 }, ...rep(3, { min: 8, p: 0.9 }, { min: 4, p: 0.55 }), { min: 6, p0: 0.6, p1: 0.45 }] },
  vo2: { name: 'VO2 Max 5×3', blurb: 'Hard 3-minute efforts with equal rest', steps: [{ min: 10, p0: 0.45, p1: 0.8 }, ...rep(5, { min: 3, p: 1.15 }, { min: 3, p: 0.5 }), { min: 8, p0: 0.6, p1: 0.45 }] },
  overunder: { name: 'Over-Unders', blurb: 'Surge above threshold, settle just below', steps: [{ min: 10, p0: 0.45, p1: 0.8 }, ...rep(3, ...rep(3, { min: 2, p: 0.94 }, { min: 1, p: 1.08 }), { min: 4, p: 0.5 }), { min: 6, p0: 0.6, p1: 0.45 }] },
  climbs: { name: 'Race Simulation', blurb: 'Short punchy efforts like the race course', steps: [{ min: 10, p0: 0.45, p1: 0.75 }, ...rep(6, { min: 1.5, p: 1.25 }, { min: 3.5, p: 0.7 }), { min: 6, p0: 0.6, p1: 0.45 }] },
};
// expand a workout into timed intervals: [{ t0, t1, p0, p1 }] in seconds
export function workoutPlan(id) {
  let t = 0;
  return WORKOUTS[id].steps.map((s) => { const d = s.min * 60, iv = { t0: t, t1: t + d, p0: s.p ?? s.p0, p1: s.p ?? s.p1 }; t += d; return iv; });
}
export const workoutMinutes = (id) => WORKOUTS[id].steps.reduce((a, s) => a + s.min, 0);
// training-zone colours by share of FTP (grey, blue, green, yellow, orange, red)
export const zoneColor = (p) => (p < 0.6 ? '#8a9099' : p < 0.76 ? '#3d8bfd' : p < 0.9 ? '#38c172' : p < 1.05 ? '#f6c343' : p < 1.2 ? '#ff8a3d' : '#ef4444');
