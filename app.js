'use strict';
const $ = id => document.getElementById(id);

// Ölçekler: [ad, 12 notanın yarım ses aralıkları, oyundaki en alçak nota (MIDI)]
const SCALES = [
  ['Pentatonic Minor', [0,3,5,7,10,12,15,17,19,22,24,27], 60],
  ['Pentatonic Major', [0,2,4,7,9,12,14,16,19,21,24,26], 60],
  ['Chromatic', [0,1,2,3,4,5,6,7,8,9,10,11], 60],
  ['Hexatonic', [0,3,5,6,7,10,12,15,17,18,19,22], 60],
  ['Major', [0,2,4,5,7,9,11,12,14,16,17,19], 60],
  ['Minor', [0,2,3,5,7,8,10,12,14,15,17,19], 60],
  ['Hirajoshi', [0,1,5,6,10,12,13,17,18,21,24,25], 60],
  ['Phrygian', [0,1,4,5,7,8,10,12,13,16,17,19], 60],
  ['Yo', [0,2,5,7,9,12,14,17,19,21,24,26], 61]
];
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const NOTE_CHARS = 'BCEJKMRSUhik'; // A..L harflerinin koddaki karşılığı
const NN = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const nm = p => NN[p % 12] + (Math.floor(p / 12) - 1);

let midi = null, sec = null, out = [], last = null, ac = null, oscs = [];

SCALES.forEach(([n], i) => $('scale').add(new Option(n, i)));

// ---------- MIDI okuma ----------
function parseMidi(buf) {
  const v = new DataView(buf); let p = 0;
  const str = n => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(v.getUint8(p++)); return s; };
  if (str(4) !== 'MThd') throw new Error('Bu bir MIDI dosyası değil.');
  p += 4; p += 2;
  const nt = v.getUint16(p); p += 2;
  const ppq = v.getUint16(p); p += 2;
  if (ppq & 0x8000) throw new Error('SMPTE zamanlı MIDI dosyaları desteklenmiyor.');
  const notes = [], tempos = [];
  for (let t = 0; t < nt; t++) {
    if (str(4) !== 'MTrk') break;
    const len = v.getUint32(p); p += 4;
    const end = p + len;
    let tick = 0, run = 0; const on = {};
    const vl = () => { let x = 0, b; do { b = v.getUint8(p++); x = (x << 7) | (b & 127); } while (b & 128); return x; };
    while (p < end) {
      tick += vl();
      let s = v.getUint8(p);
      if (s < 128) s = run; else { p++; if (s < 0xF0) run = s; }
      if (s === 0xFF) {
        const ty = v.getUint8(p++), l = vl();
        if (ty === 0x51) tempos.push([tick, (v.getUint8(p) << 16) | (v.getUint8(p + 1) << 8) | v.getUint8(p + 2)]);
        p += l;
      } else if (s === 0xF0 || s === 0xF7) { p += vl(); }
      else {
        const h = s >> 4, ch = s & 15, a = v.getUint8(p++);
        const b = (h === 12 || h === 13) ? 0 : v.getUint8(p++);
        const k = ch * 128 + a;
        if (h === 9 && b > 0) (on[k] = on[k] || []).push(tick);
        else if (h === 8 || h === 9) {
          const q = on[k];
          if (q && q.length) { const st = q.shift(); notes.push({ t: st, d: tick - st, p: a, c: ch }); }
        }
      }
    }
    p = end;
  }
  tempos.sort((x, y) => x[0] - y[0]);
  if (!tempos.length || tempos[0][0] > 0) tempos.unshift([0, 500000]);
  notes.sort((x, y) => x.t - y.t || x.p - y.p);
  return { ppq, notes, tempos };
}

function makeSec(m) {
  const T = m.tempos, c = [0];
  for (let i = 1; i < T.length; i++) c[i] = c[i - 1] + (T[i][0] - T[i - 1][0]) * T[i - 1][1] / 1e6 / m.ppq;
  return k => { let i = T.length - 1; while (T[i][0] > k) i--; return c[i] + (k - T[i][0]) * T[i][1] / 1e6 / m.ppq; };
}

function listChannels() {
  const g = {};
  midi.notes.forEach(n => (g[n.c] = g[n.c] || []).push(n));
  const rows = Object.entries(g).map(([c, a]) => {
    let ov = 0, end = 0;
    a.forEach(n => { if (n.t < end - 1) ov++; end = Math.max(end, n.t + n.d); });
    const ps = a.map(n => n.p).sort((x, y) => x - y);
    const poly = ov / a.length, med = ps[ps.length >> 1];
    const score = a.length * Math.pow(1 - poly, 3) * (med >= 52 && +c !== 9 ? 1 : 0.2);
    return { c: +c, n: a.length, lo: ps[0], hi: ps[ps.length - 1], poly, score };
  });
  const top = rows.reduce((x, y) => (y.score > x.score ? y : x), rows[0]);
  $('chans').innerHTML = rows.map(r =>
    `<label class="row"><input type="checkbox" class="c" value="${r.c}" ${r === top ? 'checked' : ''}>
     Kanal ${r.c + 1}${r.c === 9 ? ' (davul)' : ''}: ${r.n} nota, ${nm(r.lo)}-${nm(r.hi)}, çok seslilik %${Math.round(r.poly * 100)}</label>`).join('');
}

// ---------- Metin notası ----------
let bad = [];
function parseText(s) {
  const B = { do: 0, re: 2, mi: 4, fa: 5, sol: 7, la: 9, si: 11, c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  let t = 0; const o = []; bad = [];
  for (const k of s.split(/[\s|]+/).filter(Boolean)) {
    const [x, d = '1'] = k.split(':');
    const m = /^(do|re|mi|fa|sol|la|si|[a-g])([#b]?)(\d)$/i.exec(x);
    if (m) o.push({ s: t, p: 12 * (+m[3] + 1) + B[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) });
    else if (x !== 'r' && x !== '~') bad.push(k);
    t += (+d || 1) / 4;
  }
  return o;
}

// ---------- Dönüştürme ----------
function fit(p, set) {
  const i = set.indexOf(p);
  if (i >= 0) return [i, 0];
  let bi = -1, bd = 99;
  set.forEach((q, j) => { if ((q - p) % 12 === 0 && Math.abs(q - p) < bd) { bd = Math.abs(q - p); bi = j; } });
  if (bi >= 0) return [bi, 1];
  set.forEach((q, j) => { const d = Math.abs(q - p); if (d < bd) { bd = d; bi = j; } });
  return [bi, 2];
}

function best(ps, only) {
  const h = {}; ps.forEach(p => (h[p] = (h[p] || 0) + 1));
  const ks = Object.keys(h).map(Number), lo = Math.min(...ks), hi = Math.max(...ks);
  let b = { sc: -1 };
  SCALES.forEach(([, iv], si) => {
    if (only >= 0 && only !== si) return;
    for (let r = lo - 19; r <= hi; r++) {
      const set = iv.map(x => x + r); let sc = 0;
      for (const k of ks) { const f = fit(k, set)[1]; sc += h[k] * (f === 0 ? 1 : f === 1 ? 0.5 : 0); }
      if (sc > b.sc) b = { si, r, sc };
    }
  });
  return b;
}

function getNotes() {
  if (document.querySelector('input[name=src]:checked').value === 'text') return { notes: parseText($('txt').value), beat: 1 };
  if (!midi) return { notes: [], beat: 1 };
  const on = [...document.querySelectorAll('#chans input:checked')].map(i => +i.value);
  const md = +$('maxdur').value * midi.ppq;
  let a = midi.notes.filter(n => on.includes(n.c) && (!md || n.d <= md)).map(n => ({ s: sec(n.t), p: n.p }));
  if ($('mono').checked) {
    const r = [];
    for (const n of a) { const l = r[r.length - 1]; if (l && n.s - l.s < 0.02) { if (n.p > l.p) r[r.length - 1] = n; } else r.push(n); }
    a = r;
  }
  return { notes: a, beat: midi.tempos[0][1] / 1e6 };
}

function run() {
  const { notes, beat } = getNotes();
  $('warn').textContent = bad.length ? 'Okunamayan öğeler: ' + bad.join(' ') : '';
  if (!notes.length) { $('code').value = ''; $('list').value = ''; $('stats').textContent = 'Henüz nota yok. Bir MIDI dosyası yükle ya da nota yaz.'; out = []; return; }
  const b = best(notes.map(n => n.p), +$('scale').value);
  const [name, iv, gameRoot] = SCALES[b.si], set = iv.map(x => x + b.r);
  const speed = Math.max(0.1, +$('speed').value / 100), step = +$('mode').value, cap = +$('cap').value * beat;
  const st = { exact: 0, fold: 0, near: 0, push: 0 };
  let cur = 0, prev = null, lastPos = 0, res = [];
  for (const n of notes) {
    if (prev === null) cur = $('trim').checked ? 0 : n.s; else { const d = n.s - prev; cur += cap > 0 ? Math.min(d, cap) : d; }
    prev = n.s;
    const [i, k] = fit(n.p, set); st[['exact', 'fold', 'near'][k]]++;
    let pos = Math.round(cur / speed / step) + 1;
    if (pos <= lastPos) { pos = lastPos + 1; st.push++; }
    lastPos = pos; res.push([pos, i]);
  }
  const cut = res.length;
  out = res.filter(x => x[0] <= 4096);
  const code = String(b.si + 1) + out.map(([p, i]) => NOTE_CHARS[i] + B64[(p - 1) >> 6] + B64[(p - 1) & 63]).join('');
  $('code').value = code;
  $('list').value = out.map(([p, i]) => p + String.fromCharCode(65 + i)).join(',');
  last = { iv, gameRoot, step };
  const tr = gameRoot - b.r;
  $('stats').textContent = `${out.length} nota, yaklaşık ${Math.round(out[out.length - 1][0] * step)} sn, ölçek: ${name}. ` +
    `${st.exact} nota birebir, ${st.fold} nota oktav kaydırıldı, ${st.near} nota en yakın notaya yuvarlandı. ` +
    `Çeyrek nota yaklaşık ${(beat / speed / step).toFixed(1)} konum. ` +
    (tr ? `Oyunda ${Math.abs(tr)} yarım ses ${tr < 0 ? 'aşağıda' : 'yukarıda'} çalar.` : 'Oyunda orijinal perdede çalar.');
  const w = [];
  if (cut > out.length) w.push(`${cut - out.length} nota 4096 konum sınırını aştığı için kesildi. Hızı artır ya da boşluk sınırını düşür.`);
  if (st.push) w.push(`${st.push} nota aynı konuma denk geldiği için bir adım kaydırıldı.`);
  $('warn').textContent = (bad.length ? 'Okunamayan öğeler: ' + bad.join(' ') + '. ' : '') + w.join(' ');
}

// ---------- Dinleme ----------
function stop() { oscs.forEach(o => { try { o.stop(); } catch (e) {} }); oscs = []; }
function play() {
  stop(); if (!out.length) return;
  ac = ac || new AudioContext();
  const t0 = ac.currentTime + 0.1;
  out.forEach(([pos, i]) => {
    const o = ac.createOscillator(), g = ac.createGain(), t = t0 + (pos - 1) * last.step;
    o.type = 'triangle'; o.frequency.value = 440 * Math.pow(2, (last.gameRoot + last.iv[i] - 69) / 12);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 1); oscs.push(o);
  });
}

// ---------- Olaylar ----------
$('file').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try { midi = parseMidi(await f.arrayBuffer()); sec = makeSec(midi); listChannels(); run(); }
  catch (err) { $('stats').textContent = err.message; }
});
document.querySelectorAll('input[name=src]').forEach(r => r.addEventListener('change', () => {
  const t = document.querySelector('input[name=src]:checked').value === 'text';
  $('midiBox').hidden = t; $('textBox').hidden = !t; run();
}));
document.body.addEventListener('input', e => { if (e.target.classList.contains('c')) run(); });
$('copy').onclick = () => { navigator.clipboard.writeText($('code').value); $('copy').textContent = 'Kopyalandı'; setTimeout(() => ($('copy').textContent = 'Kopyala'), 1500); };
$('play').onclick = play;
$('stop').onclick = stop;
run();
