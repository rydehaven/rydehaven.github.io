// races.js — the race calendar. A race starts every 2 hours, on the even hour (UTC, so it's the same moment worldwide),
// rotating through the 25 races below. 25 doesn't divide into a week's 84 slots, so each race lands at a different
// time of day from one week to the next: no race is always in the middle of someone's night.
// Joining opens 15 minutes before the start; the race starts on the clock.
// Names never mention a day or time of day: it's a different time wherever you are.
export const RACE_EVERY_MIN = 120, JOIN_BEFORE_MIN = 15, FIELD_SIZE = 12;
// Where "Host a race" emails go. Put the address between the quotes (e.g. 'races@rydehaven.com'); empty hides the button.
export const HOST_EMAIL = 'rydehaven.contact@gmail.com';

// Course laps: Harvest Hills 6.2 mi / 526 ft · Highcrest Circuit 8.4 mi / 736 ft · Ironpeak 11.5 mi / 2,073 ft (one climb + descent)
// Every race is a good ride: about 20–90 minutes, never more than one trip up the mountain.
export const EVENTS = [
  { name: 'Harvest Hills Sprint', course: 'countryside', laps: 1, type: 'Sprint race', tag: 'Short', blurb: 'One fast lap of the farm roads. Save something for Church Hill.' },
  { name: 'Highcrest Classic', course: 'race', laps: 2, type: 'Road race', tag: 'Classic', blurb: 'Two laps: the Farmhouse Climb, The Wall and Double Trouble, twice.' },
  { name: 'Ironpeak Challenge', course: 'alpine', laps: 1, type: 'Mountain race', tag: 'Climbers', blurb: 'Up the hairpins to Ironpeak Summit, then a long descent to the line.' },
  { name: 'Church Hill Crit', course: 'countryside', laps: 2, type: 'Criterium', tag: 'Fast', blurb: 'Two laps, about 40 minutes. Church Hill twice, then a sprint.' },
  { name: 'The Wall Race', course: 'race', laps: 1, type: 'Road race', tag: 'Punchy', blurb: 'One lap of Highcrest, and it all comes down to The Wall.' },
  { name: 'Pine Woods Circuit', course: 'countryside', laps: 3, type: 'Circuit race', tag: 'Endurance', blurb: 'Three laps through farmland and pine woods, about an hour.' },
  { name: 'Highcrest Grand Prix', course: 'race', laps: 3, type: 'Road race', tag: 'Flagship', blurb: 'The big one: three laps, nine climbs and a flat finish. About 90 minutes.' },
  { name: 'Farmland Flyer', course: 'countryside', laps: 1, type: 'Sprint race', tag: 'Short', blurb: 'Twenty flat-out minutes on rolling roads.' },
  { name: 'Switchback Showdown', course: 'alpine', laps: 1, type: 'Mountain race', tag: 'Climbers', blurb: 'The hairpins decide it. Pace the climb, then hold on down the descent.' },
  { name: 'Valley Road Race', course: 'race', laps: 2, type: 'Road race', tag: 'Classic', blurb: 'Two laps of the valley circuit. The second time up The Wall is where it splits.' },
  { name: 'Harvest Hills Crit', course: 'countryside', laps: 2, type: 'Criterium', tag: 'Fast', blurb: 'Punchy rollers, constant attacks and a bunch sprint.' },
  { name: 'Double Trouble Dash', course: 'race', laps: 1, type: 'Road race', tag: 'Punchy', blurb: 'One lap, three short climbs, about half an hour.' },
  { name: 'Rolling Hills Circuit', course: 'countryside', laps: 3, type: 'Circuit race', tag: 'Endurance', blurb: 'Three laps of rollers. Tactics matter.' },
  { name: 'Summit Seekers', course: 'alpine', laps: 1, type: 'Mountain race', tag: 'Climbers', blurb: 'One ascent of the col, then the descent home.' },
  { name: 'Farmhouse Classic', course: 'race', laps: 2, type: 'Road race', tag: 'Classic', blurb: 'Two laps of Highcrest, about an hour.' },
  { name: 'Golden Fields Sprint', course: 'countryside', laps: 1, type: 'Sprint race', tag: 'Short', blurb: 'One lap, all out.' },
  { name: 'Tour of Highcrest', course: 'race', laps: 3, type: 'Road race', tag: 'Endurance', blurb: 'Three laps of the valley circuit for riders who like it long.' },
  { name: 'Orchard Crit', course: 'countryside', laps: 2, type: 'Criterium', tag: 'Fast', blurb: 'Two quick laps. Stay near the front on Church Hill.' },
  { name: 'Ironpeak Mountain Classic', course: 'alpine', laps: 1, type: 'Mountain race', tag: 'Epic', blurb: 'The mountain classic: the hairpins, the summit and the descent.' },
  { name: 'Valley Sprint', course: 'race', laps: 1, type: 'Road race', tag: 'Short', blurb: 'One lap of Highcrest, fast from the gun.' },
  { name: 'Harvest Hills Circuit Race', course: 'countryside', laps: 3, type: 'Circuit race', tag: 'Endurance', blurb: 'Three laps of farmland and pine woods.' },
  { name: 'Highcrest Road Race', course: 'race', laps: 2, type: 'Road race', tag: 'Classic', blurb: 'Two laps, six climbs, one winner.' },
  { name: 'Countryside Crit', course: 'countryside', laps: 2, type: 'Criterium', tag: 'Fast', blurb: 'Two laps of gentle rollers, fast and friendly.' },
  { name: 'Hairpin Challenge', course: 'alpine', laps: 1, type: 'Mountain race', tag: 'Climbers', blurb: 'Climb the switchbacks to the top, then race down to the finish.' },
  { name: 'Crestline Classic', course: 'race', laps: 2, type: 'Road race', tag: 'Classic', blurb: 'Two laps of the valley circuit and a flat run to the line.' },
];

// upcoming races from `now` (ms), soonest first. A race that started less than a minute ago is still listed (and joinable).
export function raceSchedule(now = Date.now(), count = 6) {
  const slotMs = RACE_EVERY_MIN * 60000, first = Math.ceil((now - 60000) / slotMs);
  return Array.from({ length: count }, (_, k) => {
    const slot = first + k, e = EVENTS[((slot % EVENTS.length) + EVENTS.length) % EVENTS.length];
    return { id: `${e.course}-${slot}`, start: slot * slotMs, ...e };
  });
}
// the join window: 15 minutes before the start until a minute after the gun (late joiners start at the back)
export const canJoin = (race, now = Date.now()) => race.start - now <= JOIN_BEFORE_MIN * 60000 && now - race.start < 60000;
