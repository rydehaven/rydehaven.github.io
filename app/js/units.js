// units.js — everything is stored and simulated in metric; this is how it's SHOWN: US / imperial units.
export const MI = 1609.344, FT = 0.3048, LB = 0.45359237;
export const mi = (m, d = 1) => (m / MI).toFixed(d);                 // metres -> "8.4"
export const mph = (v, d = 1) => (v * 2.236936).toFixed(d);          // m/s -> "22.3"
export const ft = (m) => Math.round(m / FT);                          // metres -> 1234
export const ftStr = (m) => ft(m).toLocaleString('en-US');
export const lb = (kg, d = 0) => (kg / LB).toFixed(d);                // kg -> "159"
export const kgFromLb = (l) => l * LB;
export const wPerLb = (w, kg) => (w / (kg / LB)).toFixed(2);
// a short distance: feet under ~0.2 mi, miles above ("450 ft" / "1.3 mi")
export const shortDist = (m) => (m < 0.19 * MI ? `${Math.round(m / FT / 10) * 10} ft` : `${mi(m)} mi`);
// height: 178 cm -> 5′10″
export function heightStr(cm) { const inch = Math.round(cm / 2.54), f = Math.floor(inch / 12); return `${f}′${inch - f * 12}″`; }
export const cmFromFtIn = (f, i) => (f * 12 + i) * 2.54;
export const ftInFromCm = (cm) => { const inch = Math.round(cm / 2.54); return [Math.floor(inch / 12), inch % 12]; };
