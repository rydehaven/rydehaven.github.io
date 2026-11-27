// pausemenu.js — the in-ride menu: Resume, Garage, Devices, Settings, Chat and Leave ride.
// In a free ride the ride stops while it's open. In a race it never stops the race: you just stop pedalling.
// Chat also pops up small messages on the ride screen while the menu is closed.
import { BIKE_OPTIONS } from './bikegen.js?v=75';
import { KITS, PAINTS, isUnlocked, getKit, setKit } from './kits.js?v=75';
import { getBikeChoice, setBikeChoice, getProfile, flag } from './settings.js?v=75';
import { openChat, chatEnabled, chatMute, chatInPreview, CHAT_MAX } from './chat.js?v=75';

const pmEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pmHex = (n) => '#' + n.toString(16).padStart(6, '0');
const pmTime = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

// hooks from the ride: { race, raceName, room, setPaused(bool), cams, getCam(), setCam(i), applyBike(choice), applyKit(kit),
//   quality: { get(), set(name) }, sound: { get(), set(partial) }, openDevices(), leave() }
export function makePauseMenu(H) {
  const root = document.createElement('div');
  root.id = 'pm'; root.hidden = true; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Ride menu');
  root.innerHTML = `<div class="pm-box">
    <nav class="pm-nav" aria-label="Menu">
      <div class="pm-title"><small>${H.race ? 'Race menu' : 'Paused'}</small><b>${pmEsc(H.raceName || 'Ride')}</b>${H.race ? '<span class="pm-live">The race keeps going</span>' : ''}</div>
      <button class="pm-resume startBtn" data-act="resume">${H.race ? 'Back to the race' : 'Resume'}</button>
      <button data-tab="garage">Garage</button><button data-tab="devices">Devices</button>
      <button data-tab="settings">Settings</button><button data-tab="chat">Chat<i class="pm-dot" hidden></i></button>
      <button class="pm-leave" data-act="leave">${H.race ? 'Leave race' : 'End ride'}</button>
    </nav>
    <section class="pm-body"></section></div>`;
  document.body.appendChild(root);
  const toasts = document.createElement('div'); toasts.id = 'chatToasts'; toasts.setAttribute('aria-live', 'polite'); document.body.appendChild(toasts);

  const body = root.querySelector('.pm-body');
  let tab = 'garage', open = false, unread = 0, list = [], chatState = chatEnabled() ? 'connecting' : 'off', chatNote = '', confirmLeave = false;

  // ----- chat connection (stays open for the whole ride) -----
  const p = getProfile(), seen = new Set();
  let first = true;
  const chat = openChat(H.room, { name: p.name || 'Rider', country: p.country, on: (ev, a, b) => {
    if (ev === 'status') { chatState = a; chatNote = b || ''; if (open && tab === 'chat') drawChatList(); return; }
    list = a;
    const fresh = list.filter((m) => !seen.has(m.id)); fresh.forEach((m) => seen.add(m.id));
    if (!first) for (const m of fresh) if (!m.mine) { if (!(open && tab === 'chat')) { unread++; toast(m); } }
    first = false; updateDot();
    if (open && tab === 'chat') drawChatList();
  } });
  function updateDot() { root.querySelector('.pm-dot').hidden = !unread; const b = document.getElementById('chatBtn'); if (b) b.dataset.unread = unread ? String(Math.min(unread, 9)) : ''; }
  function toast(m) {
    if (open) return;
    const t = document.createElement('div'); t.className = 'ct';
    t.innerHTML = `<b>${m.c ? flag(m.c) + ' ' : ''}${pmEsc(m.n)}</b> ${pmEsc(m.x)}`;
    toasts.appendChild(t); while (toasts.children.length > 3) toasts.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, 7000);
  }

  // ----- tabs -----
  function show(name) {
    tab = name; confirmLeave = false;
    root.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.tab === name)));
    if (name === 'garage') drawGarage(); else if (name === 'devices') drawDevices(); else if (name === 'settings') drawSettings(); else drawChat();
  }
  function drawGarage() {
    const c = getBikeChoice(), kit = getKit(), lock = H.race;
    const opt = (group, k, o) => `<button class="pm-opt" data-${group}="${k}" aria-pressed="${c[group] === k}" ${lock ? 'disabled' : ''}><b>${pmEsc(o.label)}</b><span>${pmEsc(o.blurb)}</span></button>`;
    body.innerHTML = `<h2>Garage</h2>
      <h3>Frame</h3><div class="pm-opts">${Object.entries(BIKE_OPTIONS.frame).map(([k, o]) => opt('frame', k, o)).join('')}</div>
      <h3>Wheels</h3><div class="pm-opts">${Object.entries(BIKE_OPTIONS.wheels).map(([k, o]) => opt('wheels', k, o)).join('')}</div>
      ${lock ? '<p class="pm-note">Frame and wheels are locked during a race, so everyone races the bike they started on. Paint and kit are fine to change.</p>' : ''}
      <h3>Paint</h3><div class="pm-sw">${PAINTS.map((q) => `<button class="pm-paint" data-paint="${q.id}" aria-pressed="${c.color === q.id}" title="${pmEsc(q.name)}" style="--c:${pmHex(q.color)}"><span class="sr">${pmEsc(q.name)}</span></button>`).join('')}</div>
      <h3>Kit</h3><div class="pm-kits">${KITS.map((k) => { const ok = isUnlocked(k); return `<button class="pm-kit" data-kit="${k.id}" aria-pressed="${kit.id === k.id}" ${ok ? '' : 'disabled'} style="--j:${pmHex(k.jersey)};--a:${pmHex(k.p2 ?? k.accent)}"><i></i><b>${pmEsc(k.name)}</b>${ok ? '' : `<span>${k.miles} mi</span>`}</button>`; }).join('')}</div>`;
    body.querySelectorAll('[data-frame],[data-wheels]').forEach((b) => (b.onclick = () => {
      const n = { ...getBikeChoice(), ...(b.dataset.frame ? { frame: b.dataset.frame } : { wheels: b.dataset.wheels }) }; setBikeChoice(n); H.applyBike(n); drawGarage();
    }));
    body.querySelectorAll('[data-paint]').forEach((b) => (b.onclick = () => { const n = { ...getBikeChoice(), color: b.dataset.paint }; setBikeChoice(n); H.applyBike(n, true); drawGarage(); }));
    body.querySelectorAll('[data-kit]').forEach((b) => (b.onclick = () => { const k = KITS.find((x) => x.id === b.dataset.kit); if (!k || !isUnlocked(k)) return; setKit(k.id); H.applyKit(k); drawGarage(); }));
  }
  function drawDevices() {
    body.innerHTML = `<h2>Devices</h2><p class="pm-note">Pair or reconnect your smart trainer and heart-rate strap.</p>
      <button class="startBtn sm" data-devices>Open pairing</button>`;
  }
  function drawSettings() {
    const s = H.sound.get(), q = H.quality.get();
    body.innerHTML = `<h2>Settings</h2>
      <h3>Camera</h3><div class="pm-chips">${H.cams.map((n, i) => `<button class="pm-chip" data-cam="${i}" aria-pressed="${H.getCam() === i}">${pmEsc(n)}</button>`).join('')}</div>
      <h3>Sound</h3>
      <label class="pm-row"><span>Sound</span><input type="checkbox" id="pmSnd" ${s.muted ? '' : 'checked'}></label>
      <label class="pm-row"><span>Effects volume</span><input type="range" id="pmSfx" min="0" max="100" value="${Math.round(s.sfx * 100)}"></label>
      <h3>Graphics</h3><div class="pm-chips">${['auto', 'low', 'medium', 'high'].map((n) => `<button class="pm-chip" data-q="${n}" aria-pressed="${q === n}">${n[0].toUpperCase() + n.slice(1)}</button>`).join('')}</div>
      <p class="pm-note">Lower graphics if the ride stutters.</p>`;
    body.querySelectorAll('[data-cam]').forEach((b) => (b.onclick = () => { H.setCam(+b.dataset.cam); drawSettings(); }));
    body.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { H.quality.set(b.dataset.q); drawSettings(); }));
    body.querySelector('#pmSnd').onchange = (e) => H.sound.set({ muted: !e.target.checked });
    body.querySelector('#pmSfx').oninput = (e) => H.sound.set({ sfx: e.target.value / 100 });
  }
  function drawChat() {
    unread = 0; updateDot();
    body.innerHTML = `<h2>Chat <small>${H.race ? 'this race' : 'riders on this route'}</small></h2>
      <div class="pm-chat" id="pmChat"></div>
      <form class="pm-say" id="pmSay" autocomplete="off"><input id="pmText" maxlength="${CHAT_MAX}" placeholder="Say something nice" aria-label="Message"><button class="startBtn sm">Send</button></form>
      <p class="pm-note" id="pmChatNote">Be kind, and don’t share personal details. Tap a name to mute that rider.</p>`;
    drawChatList();
    const f = body.querySelector('#pmSay'), inp = body.querySelector('#pmText');
    f.onsubmit = async (e) => {
      e.preventDefault(); const v = inp.value; if (!v.trim()) return;
      const r = await chat.send(v);
      if (r === true) inp.value = '';
      else body.querySelector('#pmChatNote').textContent = r === 'slow' ? 'Slow down a little: one message every 2 seconds.' : r === 'refused' ? 'That message wasn’t accepted (chat rules).'
        : String(r).startsWith('offline') ? (chatInPreview() ? 'Chat doesn’t work in this preview window. Open Rydehaven itself to chat.' : `Couldn’t send [${String(r).slice(8)} · room ${chatState}]`) : `Chat had a problem (${String(r).replace('error:', 'code ')}).`;
    };
    inp.addEventListener('keydown', (e) => e.stopPropagation());       // typing never triggers ride shortcuts
    if (chatState !== 'off') setTimeout(() => inp.focus(), 50);
  }
  function drawChatList() {
    const box = body.querySelector('#pmChat'); if (!box) return;
    const say = body.querySelector('#pmSay'); if (say) say.hidden = chatState === 'off';
    if (chatState === 'off') { box.innerHTML = '<p class="pm-empty">Chat isn’t switched on yet.</p>'; return; }
    if (!list.length) { box.innerHTML = `<p class="pm-empty">${chatState === 'error' ? pmEsc(chatNote) : chatState === 'live' ? 'No messages yet. Say hello!' : 'Connecting…'}</p>`; return; }
    const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    box.innerHTML = list.map((m) => `<div class="cm${m.mine ? ' me' : ''}"><button class="cm-n" data-uid="${pmEsc(m.u)}" ${m.mine ? 'disabled' : ''} title="${m.mine ? '' : 'Mute this rider'}">${m.c ? flag(m.c) + ' ' : ''}${pmEsc(m.n)}</button><span class="cm-t">${typeof m.t === 'number' ? pmTime.format(m.t) : ''}</span><p>${pmEsc(m.x)}</p></div>`).join('')
      + (chatState === 'error' ? `<p class="pm-empty">${pmEsc(chatNote)}</p>` : '');
    box.querySelectorAll('[data-uid]').forEach((b) => (b.onclick = () => {
      if (b.dataset.armed) { chatMute(b.dataset.uid); list = list.filter((m) => m.u !== b.dataset.uid); drawChatList(); }
      else { b.dataset.armed = '1'; b.textContent = 'Mute? Tap again'; setTimeout(() => drawChatList(), 3000); }
    }));
    if (atEnd || !box.dataset.done) { box.scrollTop = box.scrollHeight; box.dataset.done = '1'; }
  }

  // ----- open / close -----
  function setOpen(v, startTab) {
    open = v; root.hidden = !v; document.body.classList.toggle('pm-open', v);
    if (!H.race) H.setPaused(v);
    if (v) { toasts.innerHTML = ''; show(startTab || tab); root.querySelector('.pm-resume').focus({ preventScroll: true }); }
  }
  root.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) { if (e.target === root) setOpen(false); return; }
    if (t.dataset.tab) show(t.dataset.tab);
    if (t.dataset.act === 'resume') setOpen(false);
    if (t.dataset.act === 'leave') {
      if (!confirmLeave) { confirmLeave = true; t.textContent = H.race ? 'Tap again to leave' : 'Tap again to end'; setTimeout(() => { confirmLeave = false; t.textContent = H.race ? 'Leave race' : 'End ride'; }, 3000); }
      else H.leave();
    }
  });
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } });
  return {
    get open() { return open; },
    toggle(startTab) { setOpen(!open || (startTab && tab !== startTab), startTab); },
    close() { setOpen(false); },
    refreshSettings() { if (open && tab === 'settings') drawSettings(); },
  };
}
