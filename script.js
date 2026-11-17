/* ================= Game logic (pure, no DOM) ================= */
const minMoves = k => 2 ** k - 1;
const canMove = (pegs, f, t) => {
  if (f === t || !pegs[f].length) return false;
  const d = pegs[f][pegs[f].length - 1], top = pegs[t][pegs[t].length - 1];
  return top === undefined || top > d;
};

/* ================= Sound (Web Audio) ================= */
const Sound = {
  ctx: null, on: true, last: {}, noiseBuf: null,
  init() {
    if (!this.ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      this.ctx = new C();
      this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.1, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  ready(kind, gap) {                              // avoid stacked/overlapping sounds
    if (!this.on || !this.ctx) return false;
    const now = performance.now();
    if (now - (this.last[kind] || 0) < gap) return false;
    this.last[kind] = now; return true;
  },
  tone(f, dur, type, vol, to, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
  },
  thud(vol) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf; f.type = 'bandpass'; f.frequency.value = 900;
    g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.08);
    s.connect(f).connect(g).connect(c.destination); s.start();
  },
  pick() { if (!this.ready('pick', 50)) return; this.tone(950, 0.06, 'triangle', 0.22, 600); this.tone(1900, 0.03, 'sine', 0.06, 1500); },
  drop() { if (!this.ready('drop', 50)) return; this.tone(170, 0.14, 'sine', 0.45, 70); this.thud(0.25); },
  win() { if (!this.on || !this.ctx) return; [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.25, null, i * 0.12)); }
};

/* ================= Game state & animation ================= */
const $ = id => document.getElementById(id);
const board = $('board'), zones = [...board.querySelectorAll('.zone')];
const COLORS = ['#f06292', '#ff9fb2', '#ffc09f', '#ffdf8a', '#b5e0c3', '#9ccfe8', '#b9a7e8', '#e6a3d8'];
const SPEEDS = { slow: ['Slow', 2], normal: ['Normal', 1], fast: ['Fast', 0.5], vfast: ['Very Fast', 0.2] };
let n = 5, pegs = [[], [], []], rings = {}, pegEls = [], geo = {};
let epoch = 0, solving = false, paused = false, busy = false, moves = 0, selected = null;
let speedKey = 'normal', status = 'Ready', gateResolve = null;
const clock = { acc: 0, start: 0, running: false };

/* Prolog (hanoi.pl) runs in the browser through Tau Prolog and owns the rules:
   solving, move validation, move counting and completion. JavaScript only animates. */
const plList = t => { const out = []; while (t.indicator === './2') { out.push(t.args[0]); t = t.args[1]; } return out; };
const Prolog = {
  session: null, ready: null, state: [[], [], []], n: 5, moves: 0,
  load() {
    this.ready = fetch('hanoi.pl').then(r => { if (!r.ok) throw new Error('hanoi.pl not found'); return r.text(); })
      .then(code => new Promise((ok, bad) => { this.session = pl.create(100000); this.session.consult(code, { success: ok, error: bad }); }));
    this.ready.catch(() => setMsg(location.protocol === 'file:' ? 'Open the website link (or run a local server). Opening the file directly cannot load hanoi.pl.' : 'Could not load hanoi.pl or Tau Prolog.'));
    return this.ready;
  },
  ask(goal) {                                    // first answer, or null when the goal fails
    return this.ready.then(() => new Promise((ok, bad) => this.session.query(goal, {
      success: () => this.session.answer({ success: ok, fail: () => ok(null), error: bad, limit: () => ok(null) }), error: bad })));
  },
  async run(path, q) {
    if (path === '/api/reset') {
      const a = await this.ask(`min_moves(${q.n},M).`);
      this.n = q.n; this.moves = 0; this.state = [Array.from({ length: q.n }, (_, i) => i + 1), [], []];
      return { n: q.n, min: a.links.M.value };
    }
    if (path === '/api/solve') {
      const a = await this.ask(`hanoi(${q.n},0,2,1,M).`);
      return { moves: plList(a.links.M).map(m => plList(m).map(x => x.value)) };
    }
    if (path === '/api/move') {
      const a = await this.ask(`legal(${JSON.stringify(this.state)},${q.from},${q.to}).`);
      if (!a) return { ok: false };
      this.state[q.to].unshift(this.state[q.from].shift()); this.moves++;
      return { ok: true, moves: this.moves, solved: this.state[2].length === this.n };
    }
    return { ok: false };
  }
};
const api = async p => { const u = new URL(p, location.href), q = {}; u.searchParams.forEach((v, k) => q[k] = +v); return Prolog.run(u.pathname, q); };
let resetP = Promise.resolve(), serverMin = null;

function computeGeo() {
  const W = board.clientWidth, H = board.clientHeight, baseH = Math.max(24, H * 0.08);
  const rh = Math.min(34, (H - baseH - 24) / (n + 2)), sp = W / 3;
  const maxW = Math.min(sp * 0.92, 260), minW = Math.min(Math.max(rh * 2.4, 36), maxW * 0.6);
  geo = { W, H, baseH, rh, pegTop: rh + 12, maxW, minW, sp };
}
const cx = i => geo.sp * (i + 0.5);
const ringW = s => n === 1 ? geo.maxW : geo.minW + (geo.maxW - geo.minW) * (s - 1) / (n - 1);
const ringTop = lvl => geo.H - geo.baseH - (lvl + 1) * geo.rh;

function buildRings() {
  board.querySelectorAll('.ring').forEach(r => { r.getAnimations().forEach(a => a.cancel()); r.remove(); });
  pegs = [Array.from({ length: n }, (_, i) => n - i), [], []]; rings = {};
  for (let s = n; s >= 1; s--) {
    const el = document.createElement('div');
    el.className = 'ring'; el.style.setProperty('--c', COLORS[s - 1]); el.textContent = s; rings[s] = el; board.appendChild(el);
  }
}
function layout() {
  computeGeo();
  $('base').style.height = geo.baseH + 'px';
  pegEls.forEach(p => p.remove()); pegEls = [];
  for (let i = 0; i < 3; i++) {
    const p = document.createElement('div'), w = Math.max(8, geo.rh * 0.4);
    p.className = 'peg';
    Object.assign(p.style, { width: w + 'px', left: cx(i) - w / 2 + 'px', top: geo.pegTop + 'px', height: geo.H - geo.baseH - geo.pegTop + 'px' });
    board.insertBefore(p, $('base')); pegEls.push(p);
  }
  pegs.forEach((stack, p) => stack.forEach((s, lvl) => {
    const el = rings[s];
    Object.assign(el.style, { width: ringW(s) + 'px', height: geo.rh + 'px', borderRadius: geo.rh / 2 + 'px', fontSize: geo.rh * 0.5 + 'px', left: cx(p) - ringW(s) / 2 + 'px', top: ringTop(lvl) + 'px' });
  }));
}

function tween(el, prop, a, b, base, my) {
  const d = Math.max(30, base * SPEEDS[speedKey][1]);       // speed is read live for every stage
  const an = el.animate([{ [prop]: a + 'px' }, { [prop]: b + 'px' }], { duration: d, easing: 'ease-in-out', fill: 'forwards' });
  return an.finished.then(() => { if (my === epoch) el.style[prop] = b + 'px'; an.cancel(); });
}

async function doMove(f, t, my) {
  if (my !== epoch || busy || !canMove(pegs, f, t)) return false;
  busy = true;
  const size = pegs[f][pegs[f].length - 1], el = rings[size];
  try {
    await resetP;
    const r = await api(`/api/move?from=${f}&to=${t}`);      // engine validates and counts the move
    if (my !== epoch || !r.ok) return false;
    if (!paused) startClock();
    if (status === 'Ready') setStatus('Playing');
    const w = ringW(size), x0 = cx(f) - w / 2, x1 = cx(t) - w / 2;
    const y0 = ringTop(pegs[f].length - 1), y1 = ringTop(pegs[t].length), yUp = 4;
    el.classList.add('lift'); Sound.pick();
    await tween(el, 'top', y0, yUp, 220, my);                // 1. up
    await tween(el, 'left', x0, x1, 340, my);                // 2. across
    await tween(el, 'top', yUp, y1, 220, my);                // 3. down
    if (my !== epoch) return false;
    pegs[t].push(pegs[f].pop()); moves = r.moves; Sound.drop();
    el.classList.remove('lift'); updateUI();
    if (r.solved) complete(my);
    return true;
  } catch (e) { return false; }                              // animation cancelled by reset
  finally { if (my === epoch) busy = false; }
}

async function autoSolve() {
  if (solving || busy) return;
  if (moves > 0 || pegs[0].length !== n) resetGame();
  const my = epoch; solving = true; selected = null; updateUI();
  let list;
  try { await resetP; list = (await api('/api/solve?n=' + n)).moves; } catch (e) { solving = false; updateUI(); return; }
  if (my !== epoch) return;
  setMsg(`Solving with ${list.length} moves…`); updateUI();
  for (const [f, t] of list) {
    if (paused) await new Promise(r => (gateResolve = r));   // pause gate between moves
    if (my !== epoch) return;
    const ok = await doMove(f, t, my);
    if (my !== epoch) return;
    if (!ok) { solving = false; updateUI(); return; }
  }
}
function pause() { if (!solving || paused) return; paused = true; stopClock(); setStatus('Paused'); setMsg('Paused. The current move finishes, then solving waits.'); updateUI(); }
function resume() { if (!solving || !paused) return; paused = false; startClock(); setStatus('Playing'); setMsg(''); updateUI(); if (gateResolve) { gateResolve(); gateResolve = null; } }

function resetGame() {
  epoch++; busy = solving = paused = false; moves = 0; selected = null;
  if (gateResolve) { gateResolve(); gateResolve = null; }
  clock.acc = 0; clock.running = false;
  $('overlay').classList.remove('show');
  buildRings(); layout(); setStatus('Ready');
  serverMin = null; resetP = api('/api/reset?n=' + n).then(r => { if (r.n === n) { serverMin = r.min; updateUI(); } });
  setMsg('Click a tower, then another tower to move a disk, or press AUTO SOLVE.'); updateUI();
}
function complete(my) {
  solving = false; stopClock(); setStatus('Completed'); Sound.win(); updateUI();
  setTimeout(() => {
    if (my !== epoch) return;
    $('oMoves').textContent = moves; $('oMin').textContent = serverMin ?? minMoves(n); $('oTime').textContent = fmt(elapsed());
    $('overlay').classList.add('show'); $('againBtn').focus();
  }, 500);
}

/* ================= Clock, UI ================= */
const elapsed = () => clock.acc + (clock.running ? performance.now() - clock.start : 0);
const startClock = () => { if (!clock.running) { clock.running = true; clock.start = performance.now(); } };
const stopClock = () => { if (clock.running) { clock.acc += performance.now() - clock.start; clock.running = false; } };
const fmt = ms => { const s = ms / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
function setStatus(s) { status = s; $('status').textContent = s; }
function setMsg(m) { $('msg').textContent = m; }
function updateUI() {
  $('moves').textContent = moves; $('min').textContent = serverMin ?? minMoves(n);
  $('prog').textContent = `${pegs[2].length} / ${n}`; $('bar').style.width = pegs[2].length / n * 100 + '%';
  $('solveBtn').disabled = solving;
  $('pauseBtn').disabled = !solving || paused; $('resumeBtn').disabled = !solving || !paused;
  zones.forEach((z, i) => z.classList.toggle('sel', selected === i));
}
setInterval(() => { $('time').textContent = fmt(elapsed()); }, 100);

/* ================= Events ================= */
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => Sound.init()));
zones.forEach((z, i) => z.addEventListener('click', async () => {
  if (solving || busy || status === 'Completed') return;
  if (selected === null) { if (pegs[i].length) selected = i; else setMsg('That tower is empty. Pick a tower with a disk.'); updateUI(); return; }
  const f = selected; selected = null; updateUI();
  if (f === i) return;
  if (!canMove(pegs, f, i)) { z.classList.add('bad'); setTimeout(() => z.classList.remove('bad'), 300); setMsg("A larger disk can't go on a smaller one."); return; }
  setMsg(''); await doMove(f, i, epoch);
}));
$('solveBtn').onclick = autoSolve; $('pauseBtn').onclick = pause; $('resumeBtn').onclick = resume;
$('resetBtn').onclick = resetGame; $('againBtn').onclick = resetGame;
$('soundBtn').onclick = e => {
  Sound.init(); Sound.on = !Sound.on;
  e.target.textContent = 'SOUND: ' + (Sound.on ? 'ON' : 'OFF'); e.target.setAttribute('aria-pressed', Sound.on);
};
$('speedGroup').onclick = e => {
  const k = e.target.dataset.s; if (!k) return;
  speedKey = k; $('speedLbl').textContent = SPEEDS[k][0];
  $('speedGroup').querySelectorAll('.btn').forEach(b => b.setAttribute('aria-pressed', b.dataset.s === k));
};
for (let k = 3; k <= 8; k++) $('diskSel').add(new Option(`${k} disks`, k, false, k === n));
$('diskSel').onchange = e => { n = +e.target.value; resetGame(); };
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (!busy) layout(); }, 80); });

Prolog.load();
resetGame();
