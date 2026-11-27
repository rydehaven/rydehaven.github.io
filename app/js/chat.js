// chat.js — ride chat on Firebase Realtime Database, through its plain web API (no extra libraries).
// Each rider signs in anonymously (no account, no email), then reads and writes one chat room:
// a race has its own room, and a free ride shares a room with everyone on the same route.
// The database's security rules (see FIREBASE-SETUP.md) check every message: 140 characters max, your own
// rider id, the server's clock, and no more than one message every 2 seconds per rider.

// ----- switch chat on: paste the two values from your Firebase project here -----
export const CHAT_CONFIG = {
  apiKey: 'AIzaSyBdpIAuVzpHb1SN2CBfpG2tY5GasSSuUjk',          // Project settings › General › Web API key
  databaseURL: 'https://rydehaven-43e72-default-rtdb.firebaseio.com',     // Realtime Database › Data, the address at the top, e.g. https://rydehaven-default-rtdb.firebaseio.com
};
// (sign-in addresses; tests point these at a stand-in server)
export const CHAT_ENDPOINTS = {
  signUp: 'https://identitytoolkit.googleapis.com/v1/accounts:signUp',
  refresh: 'https://securetoken.googleapis.com/v1/token',
};

export const CHAT_MAX = 140, CHAT_GAP_MS = 2000, CHAT_KEEP = 50;
export const chatEnabled = () => !!(CHAT_CONFIG.apiKey && CHAT_CONFIG.databaseURL);

const CHAT_TOKEN_KEY = 'rydehaven.chat.auth', CHAT_MUTE_KEY = 'rydehaven.chat.muted';
// inside a preview window (like Claude's) outside connections are blocked
export const chatInPreview = () => { try { return location.protocol === 'about:' || location.protocol === 'blob:' || /claude\.ai|claudeusercontent/.test(location.hostname) || window.self !== window.top; } catch (e) { return true; } };
const chatDb = () => CHAT_CONFIG.databaseURL.replace(/\/+$/, '');

// a short list of words that never get through (the rest of moderation is mute, below)
const CHAT_BLOCK = ['fuck', 'shit', 'cunt', 'nigg', 'fag', 'retard', 'whore', 'slut', 'bitch', 'dick', 'pussy', 'rape'];
export function chatClean(s) {
  let t = String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
  for (const w of CHAT_BLOCK) t = t.replace(new RegExp(w + '\\w*', 'gi'), (m) => '*'.repeat(m.length));
  return t;
}

// ----- anonymous sign-in, kept between rides -----
let chatAuth = null;
function chatLoadAuth() { try { chatAuth = JSON.parse(localStorage.getItem(CHAT_TOKEN_KEY) || 'null'); } catch (e) { chatAuth = null; } }
function chatSaveAuth() { try { localStorage.setItem(CHAT_TOKEN_KEY, JSON.stringify(chatAuth)); } catch (e) {} }
async function chatToken(force = false) {
  if (!chatAuth) chatLoadAuth();
  if (chatAuth && !force && chatAuth.exp - Date.now() > 120000) return chatAuth;
  const key = encodeURIComponent(CHAT_CONFIG.apiKey);
  if (chatAuth && chatAuth.refresh) {
    const r = await fetch(`${CHAT_ENDPOINTS.refresh}?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(chatAuth.refresh)}` });
    if (r.ok) { const j = await r.json(); chatAuth = { id: j.id_token, refresh: j.refresh_token, uid: j.user_id, exp: Date.now() + (+j.expires_in || 3600) * 1000 }; chatSaveAuth(); return chatAuth; }
  }
  const r = await fetch(`${CHAT_ENDPOINTS.signUp}?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('sign-in ' + r.status + ' ' + (t.match(/"message":\s*"([^"]+)"/) || [, ''])[1]); }
  const j = await r.json(); chatAuth = { id: j.idToken, refresh: j.refreshToken, uid: j.localId, exp: Date.now() + (+j.expiresIn || 3600) * 1000 }; chatSaveAuth();
  return chatAuth;
}

// ----- muted riders (only hidden for you) -----
const chatMuted = () => { try { return new Set(JSON.parse(localStorage.getItem(CHAT_MUTE_KEY) || '[]')); } catch (e) { return new Set(); } };
export function chatMute(uid) { const m = chatMuted(); m.add(uid); try { localStorage.setItem(CHAT_MUTE_KEY, JSON.stringify([...m].slice(-200))); } catch (e) {} }

const chatRoomId = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40) || 'lobby';
const chatKey = (uid) => Date.now().toString(36).padStart(9, '0') + uid.slice(0, 6).replace(/[^A-Za-z0-9]/g, 'x') + Math.random().toString(36).slice(2, 6);

// Open a room. Returns { send(text), close(), me(), state }. on(event, data):
//   'messages' (full list, oldest first) · 'status' ('off' | 'connecting' | 'live' | 'error', note)
export function openChat(room, { name = 'Rider', country = '', on = () => {} } = {}) {
  room = chatRoomId(room);
  const msgs = new Map(); let es = null, closed = false, lastSend = 0, retry = 0, timer = 0;
  const emit = () => { const mute = chatMuted(); on('messages', [...msgs.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, m]) => ({ id: k, ...m, mine: chatAuth && m.u === chatAuth.uid })).filter((m) => !mute.has(m.u)).slice(-CHAT_KEEP)); };
  const status = (s, note = '') => on('status', s, note);
  const okMsg = (m) => m && typeof m.x === 'string' && typeof m.n === 'string' && typeof m.u === 'string';
  if (!chatEnabled()) { status('off'); return { send: async () => false, close() {}, me: () => null }; }

  async function connect() {
    if (closed) return;
    status('connecting');
    let a; try { a = await chatToken(); } catch (e) { status('error', chatInPreview() ? 'Chat can’t connect inside this preview window. Open Rydehaven itself (the app, or the downloaded file) to chat.' : `Couldn’t sign in to chat. [${(e && e.message) || e}]`); return again(); }
    if (closed) return;
    const url = `${chatDb()}/chat/${room}.json?auth=${encodeURIComponent(a.id)}&orderBy=${encodeURIComponent('"$key"')}&limitToLast=${CHAT_KEEP}`;
    try { es = new EventSource(url); } catch (e) { status('error', 'Chat isn’t available here.'); return; }
    const apply = (path, data, replace) => {
      if (path === '/') { if (replace) msgs.clear(); if (data && typeof data === 'object') for (const [k, m] of Object.entries(data)) if (okMsg(m)) msgs.set(k, m); }
      else { const k = path.split('/')[1]; if (k && data && okMsg(data) && path.split('/').length === 2) msgs.set(k, data); }      // removals (old messages sliding out) are ignored
      while (msgs.size > CHAT_KEEP * 2) msgs.delete([...msgs.keys()].sort()[0]);
      emit();
    };
    es.addEventListener('put', (e) => { retry = 0; status('live'); try { const d = JSON.parse(e.data); apply(d.path, d.data, true); } catch (er) {} });
    es.addEventListener('patch', (e) => { try { const d = JSON.parse(e.data); if (d.path === '/') apply('/', d.data, false); } catch (er) {} });
    es.addEventListener('auth_revoked', () => { es.close(); chatToken(true).then(connect, again); });
    es.addEventListener('cancel', (e) => { es.close(); status('error', `Chat refused to open this room (rules). [${(e && e.data) || ''}]`); });
    es.onerror = () => { if (closed) return; es.close(); status('error', `Can’t open the chat room [stream, try ${retry + 1}]`); again(); };
    clearTimeout(timer); timer = setTimeout(() => { if (!closed && es) { es.close(); connect(); } }, Math.max(60000, a.exp - Date.now() - 90000));   // fresh sign-in before it expires
  }
  function again() { if (closed) return; clearTimeout(timer); retry = Math.min(retry + 1, 6); timer = setTimeout(connect, 1000 * 2 ** retry); }
  connect();

  return {
    me: () => (chatAuth ? chatAuth.uid : null),
    close() { closed = true; clearTimeout(timer); if (es) es.close(); },
    // resolves to true when sent, or a short reason it wasn't
    async send(text) {
      const x = chatClean(text); if (!x) return 'empty';
      const wait = lastSend + CHAT_GAP_MS - Date.now(); if (wait > 0) return 'slow';
      lastSend = Date.now();
      try {
        const a = await chatToken(), id = chatKey(a.uid);
        const body = { [`chat/${room}/${id}`]: { u: a.uid, n: String(name || 'Rider').slice(0, 24), x, t: { '.sv': 'timestamp' }, ...(country ? { c: String(country).slice(0, 2) } : {}) },
          [`last/${a.uid}`]: { '.sv': 'timestamp' } };
        // a plain POST (no pre-flight check) that Firebase treats as an update: works from every browser and the desktop app
        const r = await fetch(`${chatDb()}/.json?x-http-method-override=PATCH&auth=${encodeURIComponent(a.id)}`, { method: 'POST', body: JSON.stringify(body) });
        if (!r.ok) { console.info('Chat send refused', r.status, await r.text().catch(() => '')); return r.status === 401 || r.status === 403 ? 'refused' : 'error:' + r.status; }
        return true;
      } catch (e) { console.info('Chat send failed', e); lastSend = 0; return 'offline:' + ((e && e.message) || e); }
    },
  };
}
