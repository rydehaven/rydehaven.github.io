// races.js — the race calendar. Races aren't picked freely: they run on a fixed schedule (every 30 minutes,
// rotating through the events below), and you can join one in the 10 minutes before it starts.
export const RACE_EVERY_MIN = 30, JOIN_BEFORE_MIN = 10;

const EVENTS = [
  { name: 'Grand Prix des Crêtes', course: 'race', laps: 5, type: 'Road race' },
  { name: 'Col des Pins Hill Climb', course: 'alpine', laps: 1, type: 'Hill climb' },
  { name: 'Collines Crit', course: 'countryside', laps: 4, type: 'Criterium' },
  { name: 'Crêtes Short Race', course: 'race', laps: 2, type: 'Road race' },
  { name: 'Tour des Pins', course: 'alpine', laps: 2, type: 'Mountain race' },
  { name: 'Collines Kermesse', course: 'countryside', laps: 6, type: 'Kermesse' },
];

// upcoming races from `now` (ms), soonest first: { id, start (ms), name, course, laps, type }
export function raceSchedule(now = Date.now(), count = 10) {
  const slotMs = RACE_EVERY_MIN * 60000, first = Math.ceil(now / slotMs);
  return Array.from({ length: count }, (_, k) => {
    const slot = first + k, e = EVENTS[((slot % EVENTS.length) + EVENTS.length) % EVENTS.length];
    return { id: `${e.course}-${slot}`, start: slot * slotMs, ...e };
  });
}
export const canJoin = (race, now = Date.now()) => race.start - now <= JOIN_BEFORE_MIN * 60000 && race.start > now;
