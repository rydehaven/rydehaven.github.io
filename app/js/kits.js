// kits.js — rider kits (jersey + shorts + accents + helmet), bike paint colours, and the odometer that unlocks kits.
// Kits are drawn by recolouring the rider's painted kit texture in the shader (see rider.js), so they cost nothing to add.
// A kit: { id, name, miles (needed to unlock, 0 = free), jersey, shorts, accent, socks, helmet, pattern, p2 (pattern colour) }
//   pattern: solid · band (chest band) · hoops · sash · split · fade · stripes
import { MI } from './units.js?v=76';

export const KITS = [
  { id: 'haven', name: 'Rydehaven Teal', miles: 0, jersey: 0x11141c, shorts: 0x0b0b0e, accent: 0x2ec4b6, socks: 0xffffff, helmet: 0xf2f3f5, pattern: 'band', p2: 0x2ec4b6 },
  { id: 'midnight', name: 'Midnight', miles: 0, jersey: 0x1b2d47, shorts: 0x0b0b0e, accent: 0xff8a3d, socks: 0xffffff, helmet: 0x1b2d47, pattern: 'band', p2: 0xff8a3d },
  { id: 'crimson', name: 'Crimson', miles: 0, jersey: 0xc8102e, shorts: 0x0b0b0e, accent: 0xffffff, socks: 0xffffff, helmet: 0xffffff, pattern: 'solid', p2: 0xffffff },
  { id: 'arctic', name: 'Arctic White', miles: 0, jersey: 0xeef1f4, shorts: 0x0b0b0e, accent: 0x2b6cb0, socks: 0xffffff, helmet: 0xeef1f4, pattern: 'band', p2: 0x2b6cb0 },
  { id: 'sunburst', name: 'Sunburst', miles: 25, jersey: 0xff8a3d, shorts: 0x14161b, accent: 0xffd23f, socks: 0xffffff, helmet: 0x14161b, pattern: 'fade', p2: 0xffd23f },
  { id: 'glacier', name: 'Glacier Hoops', miles: 50, jersey: 0x8fd3ff, shorts: 0x10233d, accent: 0xffffff, socks: 0xffffff, helmet: 0xffffff, pattern: 'hoops', p2: 0x10233d },
  { id: 'forest', name: 'Forest Sash', miles: 100, jersey: 0x1f5135, shorts: 0x0b0b0e, accent: 0xe8c547, socks: 0xffffff, helmet: 0x1f5135, pattern: 'sash', p2: 0xe8c547 },
  { id: 'volt', name: 'Neon Volt', miles: 150, jersey: 0x1a1b1f, shorts: 0x1a1b1f, accent: 0xd4ff3a, socks: 0xd4ff3a, helmet: 0xd4ff3a, pattern: 'stripes', p2: 0xd4ff3a },
  { id: 'royal', name: 'Royal Split', miles: 250, jersey: 0x2340a8, shorts: 0x0b0b0e, accent: 0xffffff, socks: 0xffffff, helmet: 0x2340a8, pattern: 'split', p2: 0xd9dde5 },
  { id: 'aurora', name: 'Aurora', miles: 500, jersey: 0x2b1d66, shorts: 0x0b0b0e, accent: 0x2ec4b6, socks: 0xffffff, helmet: 0x2b1d66, pattern: 'fade', p2: 0x2ec4b6 },
  { id: 'leader', name: 'Golden Leader', miles: 1000, jersey: 0xffd100, shorts: 0x0b0b0e, accent: 0x0b0b0e, socks: 0xffffff, helmet: 0xffd100, pattern: 'solid', p2: 0xffd100 },
  { id: 'comet', name: 'Neon Comet', miles: 2000, jersey: 0x0f1b2d, shorts: 0x0b0b0e, accent: 0x5ff6ff, socks: 0x5ff6ff, helmet: 0x0f1b2d, pattern: 'sash', p2: 0x5ff6ff },
];

// bike paint (frame + fork). Decal colour is picked to contrast.
export const PAINTS = [
  { id: 'red', name: 'Race Red', color: 0xd71e28 },
  { id: 'teal', name: 'Haven Teal', color: 0x2ec4b6 },
  { id: 'black', name: 'Stealth Black', color: 0x16171b },
  { id: 'white', name: 'Pearl White', color: 0xeceef1 },
  { id: 'blue', name: 'Cobalt', color: 0x1f4fd1 },
  { id: 'orange', name: 'Sunset Orange', color: 0xff6a1a },
  { id: 'yellow', name: 'Volt Yellow', color: 0xe6f23a },
  { id: 'green', name: 'Racing Green', color: 0x14603a },
  { id: 'purple', name: 'Ultraviolet', color: 0x6b2fd6 },
  { id: 'pink', name: 'Flamingo', color: 0xff5fa2 },
  { id: 'silver', name: 'Titanium', color: 0x9aa0a8 },
  { id: 'gold', name: 'Champagne', color: 0xc9a54a },
];
export const paintById = (id) => PAINTS.find((p) => p.id === id) || PAINTS[0];
export const decalColor = (hex) => { const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255; return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? 0x111317 : 0xffffff; };

// ---------- odometer: every metre you ride (free rides, races, workouts) ----------
const ODO = 'rydehaven.odometer';
export function totalMeters() { try { return Math.max(0, +localStorage.getItem(ODO) || 0); } catch (e) { return 0; } }
export function addMeters(m) {
  if (!(m > 0)) return [];
  const before = totalMeters(), after = before + m;
  try { localStorage.setItem(ODO, String(after)); } catch (e) {}
  return KITS.filter((k) => k.miles * MI > before && k.miles * MI <= after);   // kits unlocked by this distance
}
export const totalMiles = () => totalMeters() / MI;
export const isUnlocked = (k) => totalMiles() >= k.miles;

// ---------- current kit ----------
const KIT_KEY = 'rydehaven.kit';
export function getKit() { let id = 'haven'; try { id = localStorage.getItem(KIT_KEY) || 'haven'; } catch (e) {} const k = KITS.find((x) => x.id === id); return k && isUnlocked(k) ? k : KITS[0]; }
export function setKit(id) { try { localStorage.setItem(KIT_KEY, id); } catch (e) {} }
