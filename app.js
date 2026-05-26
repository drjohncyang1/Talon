'use strict';

const APP_VERSION = '0.13';

const COLORS = [
  '#14B8A6', // teal
  '#22C55E', // green
  '#0EA5E9', // sky
  '#6366F1', // indigo
  '#F59E0B', // amber
  '#F43F5E', // rose
];

// ── Storage ──────────────────────────────────────────────────
function load(key, def) {
  try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; }
}
function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

// ── Haptics ───────────────────────────────────────────────────
function hapticTap() {
  // Best-effort web haptics. Works where the Vibration API is exposed;
  // safely no-ops on iOS Safari/PWA, which does not expose native haptics.
  try {
    if (navigator.vibrate) navigator.vibrate(12);
  } catch {}
}

function bindHaptics() {
  document.querySelectorAll('button, .swatch').forEach(el => {
    if (el.dataset.hapticBound === '1') return;
    el.dataset.hapticBound = '1';
    el.addEventListener('pointerdown', () => {
      hapticTap();
      el.classList.add('tap-feedback');
      setTimeout(() => el.classList.remove('tap-feedback'), 140);
    }, { passive: true });
  });
}

// ── Audio feedback ────────────────────────────────────────────
let audioCtx = null;
let audioNeedsReset = false;

function resetAudioContext() {
  audioNeedsReset = true;
  if (audioCtx && audioCtx.state !== 'closed') {
    audioCtx.close().catch(() => {});
  }
  audioCtx = null;
}

async function ensureAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;

  // iOS can return from sleep with an AudioContext that still reports
  // "running" but no longer produces output. After page sleep/background,
  // discard it and build a fresh context on the next user-driven tap.
  if (audioNeedsReset || !audioCtx || audioCtx.state === 'closed') {
    audioCtx = new Ctx();
    audioNeedsReset = false;
  }

  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  return audioCtx.state === 'running' ? audioCtx : null;
}

async function playAudioTick(label) {
  if (config.audioTick !== true) return;
  try {
    const ctx = await ensureAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(label === '+1' ? 1100 : 520, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.035, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.05);
  } catch {}
}

window.addEventListener('pagehide', resetAudioContext);
window.addEventListener('pageshow', () => { audioNeedsReset = true; });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') resetAudioContext();
  if (document.visibilityState === 'visible') audioNeedsReset = true;
});

// ── Date ─────────────────────────────────────────────────────
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function isoToDisplay(iso) {
  const [y, m, d] = iso.split('-');
  return `${parseInt(m)}/${parseInt(d)}/${y}`;
}

// ── State ─────────────────────────────────────────────────────
let counters = load('counters', []);
let session  = load('session',  { date: todayISO(), counts: {}, timerAcc: 0, timerStart: null });
let history  = load('history',  {});
let config   = load('config',   { sheetsUrl: '', tabName: 'Counters', lastSync: null, audioTick: true });
if (typeof config.audioTick !== 'boolean') config.audioTick = true;

let view       = 'main'; // main | history | config
let editingId  = null;   // counter id, 'new', or null
let pickedColor = COLORS[0];

// ── Timer ─────────────────────────────────────────────────────
let tickId = null;

function timerSecs() {
  let s = session.timerAcc || 0;
  if (session.timerStart) s += (Date.now() - session.timerStart) / 1000;
  return Math.floor(s);
}

function fmtTimer(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
}

function fmtTimerShort(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}` : `0:${String(m).padStart(2,'0')}`;
}

function startTimer() {
  if (session.timerStart) return;
  session.timerStart = Date.now();
  save('session', session);
  startTick();
  document.getElementById('timer-toggle').textContent = 'Pause';
}

function pauseTimer() {
  if (!session.timerStart) return;
  session.timerAcc = (session.timerAcc || 0) + (Date.now() - session.timerStart) / 1000;
  session.timerStart = null;
  save('session', session);
  stopTick();
  document.getElementById('timer-toggle').textContent = 'Start';
  syncNow();
}

function resetTimer() {
  session.timerAcc = 0;
  session.timerStart = null;
  save('session', session);
  stopTick();
  const el = document.getElementById('timer-display');
  if (el) el.textContent = '00:00';
  const btn = document.getElementById('timer-toggle');
  if (btn) btn.textContent = 'Start';
}

function startTick() {
  stopTick();
  let last = -1;
  function frame() {
    const s = timerSecs();
    if (s !== last) {
      last = s;
      const el = document.getElementById('timer-display');
      if (el) el.textContent = fmtTimer(s);
    }
    tickId = requestAnimationFrame(frame);
  }
  tickId = requestAnimationFrame(frame);
}

function stopTick() {
  if (tickId) { cancelAnimationFrame(tickId); tickId = null; }
}

// ── Midnight ──────────────────────────────────────────────────
function checkMidnight() {
  const today = todayISO();
  if (session.date === today) return;
  archiveToday(session.date);
  session = { date: today, counts: {}, timerAcc: 0, timerStart: null };
  save('session', session);
  stopTick();
  render();
}

function archiveToday(date) {
  const names = {};
  counters.forEach(c => { names[c.id] = c.name; });
  history[date] = {
    counts: { ...session.counts },
    counterNames: { ...names },
    timerSeconds: timerSecs(),
  };
  save('history', history);
  scheduleSync();
}

// ── Counters ──────────────────────────────────────────────────
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,5); }

function addCounter(name, color) {
  const id = uid();
  counters.push({ id, name, color });
  if (!(id in session.counts)) session.counts[id] = 0;
  save('counters', counters);
  save('session', session);
}

function updateCounter(id, name, color) {
  const c = counters.find(c => c.id === id);
  if (c) { c.name = name; c.color = color; }
  save('counters', counters);
}

function deleteCounter(id) {
  counters = counters.filter(c => c.id !== id);
  delete session.counts[id];
  save('counters', counters);
  save('session', session);
}

function increment(id) {
  session.counts[id] = (session.counts[id] || 0) + 1;
  save('session', session);
  const el = document.getElementById('cv-' + id);
  if (el) el.textContent = session.counts[id];
  showCountFeedback(id, '+1');
}

function decrement(id) {
  const before = session.counts[id] || 0;
  session.counts[id] = Math.max(0, (session.counts[id] || 0) - 1);
  save('session', session);
  const el = document.getElementById('cv-' + id);
  if (el) el.textContent = session.counts[id];
  if (before > 0) showCountFeedback(id, '−1');
}

function showCountFeedback(id, label) {
  const value = document.getElementById('cv-' + id);
  const row = document.querySelector(`[data-row="${id}"]`);
  if (!value || !row) return;

  value.classList.remove('count-bump');
  row.classList.remove('row-counted');
  void value.offsetWidth;
  value.classList.add('count-bump');
  row.classList.add('row-counted');

  const badge = document.createElement('span');
  badge.className = label === '+1' ? 'count-float count-float-plus' : 'count-float count-float-minus';
  badge.textContent = label;
  row.appendChild(badge);
  setTimeout(() => badge.remove(), 650);
  setTimeout(() => {
    value.classList.remove('count-bump');
    row.classList.remove('row-counted');
  }, 260);
  playAudioTick(label);
}

// ── Sync ──────────────────────────────────────────────────────
let syncTimer = null;
function scheduleSync() {
  if (!config.sheetsUrl) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 4000);
}

async function syncNow() {
  if (!config.sheetsUrl) {
    alert('No Sheets URL in Config. Paste your Apps Script URL there first.');
    return;
  }
  const counts = {};
  counters.forEach(c => { counts[c.name] = session.counts[c.id] || 0; });
  const payload = {
    tabName: config.tabName || 'Counters',
    date: isoToDisplay(session.date),
    counts,
    timer: fmtTimerShort(timerSecs()),
  };
  try {
    await fetch(config.sheetsUrl, { method: 'POST', body: JSON.stringify(payload) });
    config.lastSync = Date.now();
    save('config', config);
    setSyncStatus('Synced ' + new Date().toLocaleTimeString());
  } catch (err) {
    setSyncStatus('Sync failed — check URL');
  }
}

function setSyncStatus(msg) {
  const el = document.getElementById('sync-status');
  if (el) el.textContent = msg;
}

// ── Wake lock ─────────────────────────────────────────────────
let wakeLock = null;
async function grabWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') grabWakeLock();
});

// ── Render ────────────────────────────────────────────────────
function render() {
  stopTick();
  document.getElementById('modal-overlay')?.remove();
  const app = document.getElementById('app');
  if (view === 'main')         app.innerHTML = renderMain();
  else if (view === 'history') app.innerHTML = renderHistory();
  else if (view === 'config')  app.innerHTML = renderConfig();

  if (editingId !== null) {
    document.body.insertAdjacentHTML('beforeend', renderModal());
  }

  bind();
  bindHaptics();
  if (view === 'main' && session.timerStart) startTick();
}

function renderMain() {
  const running = !!session.timerStart;
  const rows = counters.map(c => `
    <div class="counter-row" data-row="${c.id}">
      <div class="counter-dot" style="background:${c.color}"></div>
      <button class="counter-name-btn" data-edit="${c.id}">${esc(c.name)}</button>
      <div class="counter-controls">
        <button class="count-btn btn-minus" data-dec="${c.id}">−</button>
        <span class="count-value" id="cv-${c.id}" aria-live="polite">${session.counts[c.id] || 0}</span>
        <button class="count-btn btn-plus" data-inc="${c.id}">+</button>
      </div>
    </div>`).join('');

  return `
    <div class="top-bar">
      <h1>Counter</h1>
      <div class="nav-icons">
        <button class="nav-btn" data-goto="history">History</button>
        <button class="nav-btn" data-goto="config">Config</button>
      </div>
    </div>
    <div class="timer-section">
      <div class="timer-display" id="timer-display">${fmtTimer(timerSecs())}</div>
      <div class="timer-controls">
        <button class="btn btn-primary" id="timer-toggle">${running ? 'Pause' : 'Start'}</button>
        <button class="btn btn-secondary" id="timer-reset">Reset</button>
      </div>
    </div>
    <div class="divider"></div>
    <div class="counters-section">
      ${rows}
      <button class="add-counter-btn" id="add-counter">+ Add Counter</button>
    </div>`;
}

function renderHistory() {
  const entries = Object.entries(history).sort(([a],[b]) => b.localeCompare(a));
  const rows = entries.length === 0
    ? '<p class="history-empty">No history yet</p>'
    : entries.map(([date, rec]) => {
        const chips = Object.entries(rec.counts).map(([id, n]) => {
          const name = rec.counterNames?.[id] || id;
          return `<span class="history-chip">${esc(name)}: ${n}</span>`;
        }).join('');
        return `
          <div class="history-card">
            <div class="history-date">${isoToDisplay(date)}</div>
            <div class="history-chips">${chips}</div>
            <div class="history-timer-row">Timer: ${fmtTimerShort(rec.timerSeconds)}</div>
          </div>`;
      }).join('');

  return `
    <div class="top-bar">
      <button class="nav-btn back" data-goto="main">← Back</button>
      <h1>History</h1>
      <div style="width:70px"></div>
    </div>
    <div class="view">${rows}</div>`;
}

function renderConfig() {
  const lastSync = config.lastSync
    ? 'Last synced: ' + new Date(config.lastSync).toLocaleString()
    : 'Never synced';
  return `
    <div class="top-bar">
      <button class="nav-btn back" data-goto="main">← Back</button>
      <h1>Config</h1>
      <div style="width:70px"></div>
    </div>
    <div class="view">
      <div class="config-field">
        <label class="config-label">Sheets Web App URL</label>
        <input class="config-input" id="cfg-url" type="url"
          placeholder="https://script.google.com/macros/s/..."
          value="${esc(config.sheetsUrl)}">
      </div>
      <div class="config-field">
        <label class="config-label">Tab Name</label>
        <input class="config-input" id="cfg-tab" type="text"
          placeholder="Counters"
          value="${esc(config.tabName)}">
      </div>
      <label class="toggle-row">
        <span>
          <span class="toggle-title">Audio Tick</span>
          <span class="toggle-subtitle">Short click sound on +/− count changes</span>
        </span>
        <input id="cfg-audio" type="checkbox" ${config.audioTick === true ? 'checked' : ''}>
      </label>
      <button class="btn btn-primary btn-full" id="save-config">Save Settings</button>
      <button class="btn btn-secondary btn-full" id="sync-now">Sync Now</button>
      <div class="sync-status" id="sync-status">${lastSync}</div>
      <div class="version-info">Version ${APP_VERSION}</div>
    </div>`;
}

function renderModal() {
  const isNew = editingId === 'new';
  const c = isNew ? { name: '', color: pickedColor } : counters.find(x => x.id === editingId);
  if (!c) return '';
  pickedColor = c.color || COLORS[0];

  const swatches = COLORS.map(col => `
    <div class="swatch ${pickedColor === col ? 'active' : ''}"
         style="background:${col}" data-color="${col}"></div>`).join('');

  return `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal">
        <h3>${isNew ? 'New Counter' : 'Edit Counter'}</h3>
        <input class="modal-input" id="modal-name" type="text"
          placeholder="Counter name" value="${esc(c.name)}" autocomplete="off">
        <div class="color-row" id="color-row">${swatches}</div>
        <div class="modal-actions">
          ${!isNew ? `<button class="btn btn-danger btn-sm" id="modal-del">Delete</button>` : ''}
          <button class="btn btn-secondary" id="modal-cancel" style="flex:1">Cancel</button>
          <button class="btn btn-primary"   id="modal-save"   style="flex:1">Save</button>
        </div>
      </div>
    </div>`;
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Event binding ─────────────────────────────────────────────
function bind() {
  // Navigation
  document.querySelectorAll('[data-goto]').forEach(btn =>
    btn.addEventListener('click', () => { view = btn.dataset.goto; render(); }));

  if (view === 'main') {
    document.getElementById('timer-toggle')?.addEventListener('click', () => {
      if (session.timerStart) pauseTimer(); else startTimer();
    });
    document.getElementById('timer-reset')?.addEventListener('click', () => {
      if (timerSecs() === 0) return;
      if (confirm('Reset timer?')) resetTimer();
    });
    document.querySelectorAll('[data-inc]').forEach(b =>
      b.addEventListener('click', () => increment(b.dataset.inc)));
    document.querySelectorAll('[data-dec]').forEach(b =>
      b.addEventListener('click', () => decrement(b.dataset.dec)));
    document.querySelectorAll('[data-edit]').forEach(b =>
      b.addEventListener('click', () => { editingId = b.dataset.edit; render(); }));
    document.getElementById('add-counter')?.addEventListener('click', () => {
      editingId = 'new'; render();
    });
  }

  if (view === 'config') {
    document.getElementById('save-config')?.addEventListener('click', () => {
      config.sheetsUrl = document.getElementById('cfg-url').value.trim();
      config.tabName   = document.getElementById('cfg-tab').value.trim() || 'Counters';
      config.audioTick = document.getElementById('cfg-audio').checked;
      save('config', config);
      setSyncStatus('Settings saved');
    });
    document.getElementById('cfg-audio')?.addEventListener('change', e => {
      config.audioTick = e.target.checked;
      save('config', config);
      if (!e.target.checked) resetAudioContext();
      setSyncStatus(e.target.checked ? 'Audio tick on' : 'Audio tick off');
    });
    document.getElementById('sync-now')?.addEventListener('click', syncNow);
  }

  // Modal
  if (editingId !== null) {
    document.getElementById('modal-overlay')?.addEventListener('click', e => {
      if (e.target.id === 'modal-overlay') closeModal();
    });
    document.getElementById('modal-cancel')?.addEventListener('click', closeModal);

    document.getElementById('color-row')?.addEventListener('click', e => {
      const sw = e.target.closest('[data-color]');
      if (!sw) return;
      pickedColor = sw.dataset.color;
      document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
    });

    document.getElementById('modal-save')?.addEventListener('click', () => {
      const name = document.getElementById('modal-name').value.trim();
      if (!name) { alert('Enter a name'); return; }
      if (editingId === 'new') addCounter(name, pickedColor);
      else updateCounter(editingId, name, pickedColor);
      closeModal();
    });

    document.getElementById('modal-del')?.addEventListener('click', () => {
      if (confirm('Delete this counter?')) { deleteCounter(editingId); closeModal(); }
    });

    // Auto-focus name input
    setTimeout(() => document.getElementById('modal-name')?.focus(), 50);
  }
}

function closeModal() { editingId = null; render(); }

// ── Init ──────────────────────────────────────────────────────
async function init() {
  checkMidnight();
  await grabWakeLock();
  render();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  // Periodic midnight check when app stays open
  setInterval(checkMidnight, 60000);
}

init();
