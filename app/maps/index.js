// maps/index.js — the WORLDS in the app. A world is one landscape (its own map file in this folder) with one or
// more ROUTES around it, and named CLIMBS (KOM segments) on each route.
// To add a route: add it to that world's `routes` list. To add a world: write a new map file and list it here.
import { ALPINE } from './alpine.js?v=76';
import { COUNTRYSIDE } from './countryside.js?v=76';
import { RACE } from './race.js?v=76';

export const WORLDS = [
  { id: 'cretes', name: 'Highcrest Valley', blurb: 'Green valley racing country: fast roads and short, brutal climbs.', routes: [RACE] },
  { id: 'alps', name: 'Rydehaven Alps', blurb: 'High mountains: long hairpin cols, balcony roads and snowy peaks.', routes: [ALPINE] },
  { id: 'collines', name: 'Harvest Hills', blurb: 'Rolling farmland and pine woods with punchy little hills.', routes: [COUNTRYSIDE] },
];

// every route, flat, each knowing its world (the rest of the app picks routes by id: #race, #alpine, ...)
export const MAPS = WORLDS.flatMap((w) => w.routes.map((r) => Object.assign(r, { worldId: w.id, worldName: w.name })));
