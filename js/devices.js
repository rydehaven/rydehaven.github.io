// devices.js — the "Pair devices" window, shared by the home screen and the ride.
import { trainer, connectTrainer, connectHr, disconnectTrainer, BT_SUPPORT, btHelp } from './trainer.js';

const el = (id) => document.getElementById(id);
const DIFF_KEY = 'rydehaven.difficulty';
try { const d = +localStorage.getItem(DIFF_KEY); if (localStorage.getItem(DIFF_KEY) !== null && d >= 0 && d <= 1) trainer.difficulty = d; } catch (e) {}

let wired = false;
export function initDevices() {
  if (wired) return; wired = true;
  const dlg = el('devDlg');
  document.addEventListener('click', (e) => { if (e.target.closest('[data-devices]')) { e.preventDefault(); render(); dlg.showModal(); } });
  el('devNote').textContent = btHelp();
  el('devNote').hidden = BT_SUPPORT;
  const guard = async (btn, fn) => {
    btn.disabled = true; el('devErr').textContent = '';
    try { await fn(); } catch (e) { if (e && e.name !== 'NotFoundError') el('devErr').textContent = pairError(e); }   // NotFoundError = chooser closed
    btn.disabled = false; el('devPick').hidden = true; render();
  };
  el('devTrBtn').onclick = () => guard(el('devTrBtn'), () => (trainer.kind ? disconnectTrainer() : connectTrainer()));
  el('devHrBtn').onclick = () => guard(el('devHrBtn'), connectHr);
  el('devDiff').value = Math.round(trainer.difficulty * 100);
  el('devDiff').oninput = (e) => { trainer.difficulty = +e.target.value / 100; try { localStorage.setItem(DIFF_KEY, String(trainer.difficulty)); } catch (er) {} render(); };
  // desktop app: Electron hands us the list of nearby devices and we show the chooser ourselves
  const D = window.ridemapDesktop;
  if (D) {
    D.onBtDevices((list) => {
      el('devPick').hidden = false;
      el('devList').innerHTML = list.length ? '' : '<span class="dev-hint">No devices found yet.</span>';
      for (const d of list) { const b = document.createElement('button'); b.type = 'button'; b.textContent = d.name; b.onclick = () => { el('devPick').hidden = true; D.chooseBt(d.id); }; el('devList').appendChild(b); }
    });
    el('devCancel').onclick = () => { el('devPick').hidden = true; D.chooseBt(''); };
  }
  trainer.on(render); setInterval(render, 2000); render();
}
function pairError(e) {
  if (e && e.name === 'SecurityError' && window.top !== window) return 'Bluetooth is switched off inside this preview window, so the trainer can’t connect here. You can still ride with the power slider.';
  if (e && e.name === 'SecurityError') return location.protocol === 'file:' ? 'Chrome blocks Bluetooth for files opened straight from your computer. Open the app from its web address (https) instead, then pair again.' : 'The browser blocked Bluetooth for this page. Allow Bluetooth for this site in the browser settings, then try again.';
  if (e && e.name === 'NotAllowedError') return 'Bluetooth permission was refused. Allow Bluetooth for this site in the browser settings, then try again.';
  return 'Couldn’t connect: ' + ((e && e.message) || e) + '. Make sure the device is awake and not connected to another app (Zwift, a phone app or a bike computer).';
}
function render() {
  const t = trainer, on = t.connected || !!t.kind;
  el('devTr').textContent = on ? `${t.name} · ${t.kind === 'ftms' ? (t.controllable ? 'smart trainer (SIM + ERG)' : 'trainer, no control') : 'power only'}${t.connected ? ` · ${Math.round(t.power)} W` : ' · reconnecting…'}` : 'Not connected';
  el('devTrBtn').textContent = on ? 'Disconnect' : 'Pair';
  el('devHr').textContent = t.hrConnected ? `${t.hrName || 'From trainer'} · ${t.hr} bpm` : 'Not connected';
  el('devHrBtn').hidden = !!t.hrName;
  el('devTrBtn').disabled = el('devHrBtn').disabled = !BT_SUPPORT;
  el('devDiffV').textContent = `${Math.round(t.difficulty * 100)}%`;
  document.querySelectorAll('[data-devices]').forEach((b) => b.classList.toggle('paired', t.connected));
}
