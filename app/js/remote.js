// remote.js — links a phone running Rydehaven Remote (rydehaven.github.io/remote) to this ride, through Firebase.
// The game shows a 6-letter code. The phone enters it and says "hi" every few seconds; while a phone is linked
// the game shares live stats (once a second) and the phone can change the camera and send emotes.
// Nothing is shared until a phone links, and the code stays the same on this computer so the phone remembers it.
import { chatEnabled, chatInPreview, fbAuth, fbUrl } from './chat.js?v=76';

const RM_KEY = 'rydehaven.remote.code', RM_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rmNewCode = () => Array.from({ length: 6 }, () => RM_ABC[Math.floor(Math.random() * RM_ABC.length)]).join('');
const rmPost = (url, body, method) => fetch(url + (method ? `&x-http-method-override=${method}` : ''), { method: 'POST', body: body === undefined ? '' : JSON.stringify(body) });   // simple requests: no pre-flight

// route: { name, length, pts:[[x,z]...] (metres), elev:[m...], climbs:[{n,a,b}] (fractions of a lap) }
// hooks: getState() -> live numbers · onCmd({a, i, k}) · onChange() when the link status changes
export function makeRemote({ route, getState, onCmd, onChange = () => {} }) {
  let code = null; try { code = localStorage.getItem(RM_KEY); } catch (e) {}
  if (!code || !/^[A-Z0-9]{6}$/.test(code)) { code = rmNewCode(); try { localStorage.setItem(RM_KEY, code); } catch (e) {} }
  const S = { code, state: chatEnabled() ? 'starting' : 'off', linked: false, lastHi: 0, closed: false };
  if (!chatEnabled()) return { get code() { return code; }, get state() { return 'off'; }, get linked() { return false }, newCode() {}, close() {} };
  let es = null, pubTimer = 0, auth = null, since = Date.now(), busy = false, routeSent = false;
  const set = (k, v) => { if (S[k] !== v) { S[k] = v; onChange(); } };

  // the route, squeezed small: positions on a 0–1000 grid (keeping its shape), elevation in whole metres
  function packRoute() {
    const xs = route.pts.map((p) => p[0]), zs = route.pts.map((p) => p[1]);
    const x0 = Math.min(...xs), z0 = Math.min(...zs), span = Math.max(Math.max(...xs) - x0, Math.max(...zs) - z0) || 1;
    return { n: route.name, L: Math.round(route.length), x: xs.map((v) => Math.round(((v - x0) / span) * 1000)), z: zs.map((v) => Math.round(((v - z0) / span) * 1000)),
      e: route.elev.map((v) => Math.round(v)), c: route.climbs.map((c) => ({ n: c.n, a: +c.a.toFixed(4), b: +c.b.toFixed(4) })) };
  }
  async function start(retry = true) {
    if (S.closed) return;
    try {
      auth = await fbAuth();
      const r = await rmPost(fbUrl(`live/${code}`, auth), { o: auth.uid, t: { '.sv': 'timestamp' }, r: packRoute() }, 'PUT');
      if (r.status === 401 || r.status === 403) {                                   // that code belongs to someone else: pick a new one
        if (!retry) throw new Error('refused');
        code = rmNewCode(); S.code = code; try { localStorage.setItem(RM_KEY, code); } catch (e) {} onChange(); return start(false);
      }
      if (!r.ok) throw new Error('status ' + r.status);
      routeSent = true; listen(); set('state', 'ready');
    } catch (e) { set('state', chatInPreview() ? 'preview' : 'error'); if (!S.closed) setTimeout(() => start(true), 20000); }
  }
  function listen() {
    if (es) es.close();
    es = new EventSource(fbUrl(`cmd/${code}`, auth));
    const handle = (path, data) => {
      if (path === '/') { if (data && typeof data === 'object') for (const [k, v] of Object.entries(data)) one(k, v); }
      else { const k = path.split('/')[1]; if (k && data && path.split('/').length === 2) one(k, data); }
    };
    es.addEventListener('put', (e) => { try { const d = JSON.parse(e.data); handle(d.path, d.data); } catch (er) {} });
    es.addEventListener('patch', (e) => { try { const d = JSON.parse(e.data); if (d.path === '/') handle('/', d.data); } catch (er) {} });
    es.addEventListener('auth_revoked', () => { es.close(); fbAuth().then((a) => { auth = a; listen(); }); });
    es.onerror = () => { es.close(); if (!S.closed) setTimeout(listen, 5000); };
  }
  function one(id, c) {
    rmPost(fbUrl(`cmd/${code}/${id}`, auth), undefined, 'DELETE').catch(() => {});  // each command runs once
    if (!c || typeof c.t !== 'number' || c.t < since - 5000) return;                // ignore anything left over from before this ride
    S.lastHi = Date.now();
    if (!S.linked) { set('linked', true); publishSoon(); }
    if (c.a !== 'hi') { try { onCmd(c); } catch (e) {} }
  }
  function publishSoon() { clearTimeout(pubTimer); pubTimer = setTimeout(publish, 50); }
  async function publish() {
    if (S.closed) return;
    if (Date.now() - S.lastHi > 45000) { set('linked', false); return; }           // the phone went away: stop sharing
    if (!busy && routeSent) {
      busy = true;
      try { if (auth.exp - Date.now() < 120000) auth = await fbAuth(); await rmPost(fbUrl(`live/${code}/s`, auth), { ...getState(), t: { '.sv': 'timestamp' } }, 'PUT'); } catch (e) {}
      busy = false;
    }
    pubTimer = setTimeout(publish, 1000);
  }
  start();
  return {
    get code() { return code; }, get state() { return S.state; }, get linked() { return S.linked; },
    newCode() { code = rmNewCode(); S.code = code; try { localStorage.setItem(RM_KEY, code); } catch (e) {} set('linked', false); routeSent = false; if (es) es.close(); since = Date.now(); start(true); onChange(); },
    close() { S.closed = true; clearTimeout(pubTimer); if (es) es.close(); },
  };
}
