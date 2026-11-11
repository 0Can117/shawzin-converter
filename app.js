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
const NOTE_CHARS = 'BCEJKMRSUhik';
const CHORDS = [['Z', [0, 2, 4]], ['a', [1, 3, 5]], ['c', [2, 4, 6]], ['x', [3, 5, 7]], ['y', [4, 6, 8]], ['0', [5, 7, 9]], ['p', [0, 1, 3]], ['q', [1, 2, 4]], ['s', [2, 3, 5]], ['5', [3, 4, 6]], ['6', [4, 5, 7]], ['8', [5, 6, 8]]];
const MULTI = { defghijkl: '/', deghjk: '7', efhikl: '+', dfgijl: '9', dgj: '5', ehk: '6', fil: '8', ghijkl: '3', hikl: '2', ghjk: 'z', gijl: '1', il: '0', hk: 'y', gj: 'x', defjkl: 'v', dejk: 'r', dfjl: 't', efkl: 'u', dj: 'p', ek: 'q', fl: 's', defghi: 'f', efhi: 'e', dfgi: 'd', degh: 'b', dg: 'Z', eh: 'a', fi: 'c', jkl: 'n', jk: 'j', kl: 'm', jl: 'l', ghi: 'X', hi: 'W', gh: 'T', gi: 'V', def: 'P', ef: 'O', de: 'L', df: 'N', abc: 'H', ab: 'D', bc: 'G', ac: 'F' }; // A..L harflerinin koddaki karşılığı
const FAM = ['Piyano', 'Kromatik perküsyon', 'Org', 'Gitar', 'Bas', 'Yaylılar', 'Topluluk', 'Bakır nefesliler', 'Kamışlı nefesliler', 'Flüt grubu', 'Sentezleyici lead', 'Sentezleyici pad', 'Sentezleyici efekt', 'Etnik', 'Perküsyon', 'Ses efekti'];
const NN = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const nm = p => NN[p % 12] + (Math.floor(p / 12) - 1);

let chScore = {}, chRows = [];
let midi = null, sec = null, out = [], last = null, ac = null, oscs = [];

SCALES.forEach(([n], i) => $('scale').add(new Option(n, i)));
const KEYS = ['scale', 'speed', 'mode', 'cap', 'maxdur', 'trim', 'mono', 'snap', 'from', 'to', 'shifts', 'rep', 'clean', 'startOct', 'harm', 'tidy', 'stype'];
const val = k => ($(k).type === 'checkbox' ? $(k).checked : $(k).value);
function save() { try { localStorage.setItem('szv', JSON.stringify(Object.fromEntries(KEYS.map(k => [k, val(k)])))); } catch (e) {} }
try { const s = JSON.parse(localStorage.getItem('szv') || '{}'); KEYS.forEach(k => { if (k in s) { if ($(k).type === 'checkbox') $(k).checked = s[k]; else $(k).value = s[k]; } }); } catch (e) {}

if ($('cap').selectedIndex < 0) $('cap').value = '1.5';

// ---------- MIDI okuma ----------
function parseMidi(buf) {
  const v = new DataView(buf); let p = 0;
  const str = n => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(v.getUint8(p++)); return s; };
  if (str(4) !== 'MThd') throw new Error('Bu bir MIDI dosyası değil.');
  p += 4; p += 2;
  const nt = v.getUint16(p); p += 2;
  const ppq = v.getUint16(p); p += 2;
  if (ppq & 0x8000) throw new Error('SMPTE zamanlı MIDI dosyaları desteklenmiyor.');
  const notes = [], tempos = [], progs = {};
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
        if (h === 12 && !(ch in progs)) progs[ch] = a;
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
  return { ppq, notes, tempos, progs };
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
  rows.forEach(r => (chScore[r.c] = r.score)); chRows = rows;
  $('chans').innerHTML = rows.map(r =>
    `<div style="display:flex;gap:8px;align-items:center"><label class="row"><input type="checkbox" class="c" value="${r.c}" ${r === top ? 'checked' : ''}>
     ${midi.names ? midi.names[r.c] : 'Kanal ' + (r.c + 1) + (r.c === 9 ? ' (davul)' : midi.progs && r.c in midi.progs ? ' (' + FAM[midi.progs[r.c] >> 3] + ')' : '')}: ${r.n} nota, ${nm(r.lo)}-${nm(r.hi)}, çok seslilik %${Math.round(r.poly * 100)}</label><button type="button" class="alt" data-pv="${r.c}">Dinle</button></div>`).join('');
}

// ---------- MusicXML ----------
function playOrder(ms) {
  const o = []; let i = 0, start = 0, pass = 1;
  while (i < ms.length && o.length < 5000) {
    const m = ms[i];
    if (m.fwd && !(i === start && pass > 1)) { start = i; pass = 1; }
    if (m.ends && !m.ends.includes(pass)) { i++; continue; }
    o.push(i);
    const nx = ms[i + 1];
    if (m.back && pass < m.times) { pass++; i = start; continue; }
    if (m.back || (m.ends && !(nx && nx.ends))) pass = 1;
    i++;
  }
  return o;
}
function parseXml(txt) {
  const d = new DOMParser().parseFromString(txt, 'application/xml');
  if (d.querySelector('parsererror')) throw new Error('MusicXML okunamadı.');
  const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const tx = (el, t) => { const x = el.getElementsByTagName(t)[0]; return x ? x.textContent : null; };
  const sd = d.querySelector('sound[tempo]'), pm = d.querySelector('metronome per-minute');
  const bpm = (sd ? +sd.getAttribute('tempo') : pm ? +pm.textContent : 120) || 120;
  const pn = {}; d.querySelectorAll('score-part').forEach(sp => (pn[sp.getAttribute('id')] = tx(sp, 'part-name') || 'Parça'));
  const keys = {}, names = {};
  const chOf = (pid, st) => { const k = pid + ':' + st; if (!(k in keys)) { keys[k] = Object.keys(keys).length; names[keys[k]] = (pn[pid] || 'Parça') + (st > 1 ? ' (' + st + '. porte)' : ''); } return keys[k]; };
  const parts = [];
  d.querySelectorAll('part').forEach(part => {
    const pid = part.getAttribute('id'), ms = []; let div = 1, endsCur = null;
    for (const m of part.children) {
      if (m.tagName !== 'measure') continue;
      const dv = tx(m, 'divisions'); if (dv) div = +dv;
      const f = 960 / div, M = { fwd: false, back: false, ends: null, times: 2, notes: [], len: 0 };
      for (const r of m.getElementsByTagName('repeat')) {
        if (r.getAttribute('direction') === 'forward') M.fwd = true; else { M.back = true; M.times = +r.getAttribute('times') || 2; }
      }
      let stopEnd = false;
      for (const e of m.getElementsByTagName('ending')) {
        if (e.getAttribute('type') === 'start') endsCur = (e.getAttribute('number') || '').split(/[,\s]+/).map(Number).filter(Boolean);
        else stopEnd = true;
      }
      M.ends = endsCur; if (stopEnd) endsCur = null;
      let cur = 0, last = 0, mx = 0;
      for (const n of m.children) {
        const t = n.tagName, du = +tx(n, 'duration') || 0;
        if (t === 'backup') cur -= du;
        else if (t === 'forward') cur += du;
        else if (t === 'note') {
          if (n.getElementsByTagName('grace')[0]) continue;
          const chord = n.getElementsByTagName('chord')[0];
          const on = chord ? last : cur; if (!chord) { last = cur; cur += du; }
          const pt = n.getElementsByTagName('pitch')[0];
          const tieStop = [...n.getElementsByTagName('tie')].some(x => x.getAttribute('type') === 'stop');
          if (pt && !tieStop) M.notes.push({ c: chOf(pid, +tx(n, 'staff') || 1), t: Math.round(on * f), d: Math.round(du * f),
            p: 12 * (+tx(pt, 'octave') + 1) + STEP[tx(pt, 'step')] + (+tx(pt, 'alter') || 0) });
        }
        mx = Math.max(mx, cur);
      }
      M.len = Math.round(mx * f); ms.push(M);
    }
    parts.push(ms);
  });
  if (!parts.length) throw new Error('MusicXML içinde parça bulunamadı.');
  const order = playOrder(parts[0]), notes = [];
  parts.forEach(ms => {
    let base = 0;
    for (const i of order) { const M = ms[i]; if (M) M.notes.forEach(n => notes.push({ c: n.c, t: base + n.t, d: n.d, p: n.p })); base += parts[0][i].len; }
  });
  if (!notes.length) throw new Error('Dosyada nota bulunamadı.');
  notes.sort((a, b) => a.t - b.t || a.p - b.p);
  return { ppq: 960, notes, tempos: [[0, Math.round(6e7 / bpm)]], names };
}
async function unzipXml(buf) {
  const v = new DataView(buf), u = new Uint8Array(buf);
  let e = buf.byteLength - 22; while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Geçersiz .mxl dosyası.');
  let p = v.getUint32(e + 16, true); const n = v.getUint16(e + 10, true);
  for (let i = 0; i < n; i++) {
    const method = v.getUint16(p + 10, true), cs = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + el + cl;
    if (name.startsWith('META-INF') || !/\.(xml|musicxml)$/i.test(name)) continue;
    const lo = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true), data = u.subarray(lo, lo + cs);
    if (method === 0) return new TextDecoder().decode(data);
    return await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  }
  throw new Error('.mxl içinde nota dosyası bulunamadı.');
}
async function readFile(f) {
  const buf = await f.arrayBuffer(), n = f.name.toLowerCase();
  if (n.endsWith('.mxl')) return parseXml(await unzipXml(buf));
  if (n.endsWith('.xml') || n.endsWith('.musicxml')) return parseXml(new TextDecoder().decode(buf));
  return parseMidi(buf);
}

// ---------- Basit nota ----------
function simple2text(s, o0) {
  const B = { do: 0, re: 2, mi: 4, fa: 5, sol: 7, la: 9, si: 11, c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const out = []; let prev = null;
  for (const k of s.split(/\s+/).filter(x => x && x !== '|')) {
    if (k === '_') { if (out.length) out[out.length - 1] = out[out.length - 1].replace(/:1$/, ':2'); continue; }
    if (k.toLowerCase() === 'r') { out.push('r:1'); continue; }
    const m = /^(do|re|mi|fa|sol|la|si|[a-g])([#b]?)(\d?)(_?)$/i.exec(k);
    if (!m) { out.push('?' + k); continue; }
    const base = B[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    const p = m[3] ? 12 * (+m[3] + 1) + base : prev === null ? 12 * (o0 + 1) + base : base + 12 * Math.round((prev - base) / 12);
    prev = p;
    out.push(NN[((p % 12) + 12) % 12] + (Math.floor(p / 12) - 1) + (m[4] ? ':2' : ':1'));
  }
  return out.join(' ');
}

// ---------- Metin notası ----------
let bad = [];
function expand(tk) {
  const o = []; let i = 0, start = 0, pass = 1;
  while (i < tk.length) {
    const k = tk[i++];
    if (k === '|:') { start = i; pass = 1; continue; }
    if (k === ':|') { if (pass === 1) { pass = 2; i = start; } else pass = 1; continue; }
    if (k === '[1' && pass === 2) { while (i < tk.length && tk[i++] !== ':|'); pass = 1; continue; }
    if (k === '[1' || k === '[2') continue;
    o.push(k);
  }
  return o;
}
function parseCode(s) {
  s = s.trim(); const si = +s[0] - 1; bad = [];
  if (!(si >= 0 && si < 9)) return { notes: [] };
  const [, iv, g] = SCALES[si], step = +$('mode').value, o = [];
  for (let k = 1; k + 2 < s.length; k += 3) {
    let ni = NOTE_CHARS.indexOf(s[k]), ch, cidx;
    const a = B64.indexOf(s[k + 1]), b = B64.indexOf(s[k + 2]);
    if (ni < 0) {
      const key = Object.keys(MULTI).find(x => MULTI[x] === s[k]);
      if (key) { ch = s[k]; cidx = [...key].map(x => x.charCodeAt(0) - 97); ni = Math.max(...cidx); }
    }
    if (ni < 0 || a < 0 || b < 0) { bad.push(s.substr(k, 3)); continue; }
    o.push({ s: (a * 64 + b) * step, p: g + iv[ni], ch, cidx });
  }
  return { notes: o, force: { si, r: g } };
}
function parseText(s) {
  const B = { do: 0, re: 2, mi: 4, fa: 5, sol: 7, la: 9, si: 11, c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  let t = 0; const o = []; bad = [];
  for (const k of expand(s.split(/\s+/).filter(x => x && x !== '|'))) {
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

function mapSeq(notes, set) {
  let pq = null, pp = null;
  return notes.map(n => {
    let bi = -1, bc = 1e9;
    set.forEach((q, j) => {
      const e = ((q - n.p) % 12 + 12) % 12, pe = Math.min(e, 12 - e);
      const c = pe * 16 + (pq === null ? Math.abs(q - n.p) * 0.1 : Math.abs((q - pq) - (n.p - pp)));
      if (c < bc) { bc = c; bi = j; }
    });
    const q = set[bi], k = q === n.p ? 0 : (q - n.p) % 12 === 0 ? 1 : 2;
    pq = q; pp = n.p;
    return [bi, k];
  });
}

function best(ns, only) {
  const h = {}, per = {}; ns.forEach(n => (h[n.p] = (h[n.p] || 0) + 1 + 2 * Math.min(n.d || 0, 1)));
  const ks = Object.keys(h).map(Number), lo = Math.min(...ks), hi = Math.max(...ks);
  let b = { sc: -1 };
  SCALES.forEach(([, iv], si) => {
    if (only >= 0 && only !== si) return;
    for (let r = lo - 19; r <= hi; r++) {
      const set = iv.map(x => x + r); let sc = 0;
      for (const k of ks) { const f = fit(k, set)[1]; sc += h[k] * (f === 0 ? 1 : f === 1 ? 0.5 : 0); }
      if (!(per[si] >= sc)) per[si] = sc;
      if (sc > b.sc) b = { si, r, sc };
    }
  });
  b.per = per; b.tot = Object.values(h).reduce((x, y) => x + y, 0);
  return b;
}

function getNotes() {
  const r = getNotes0(), f = +$('from').value, t = +$('to').value;
  const sh = [...$('shifts').value.matchAll(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*:\s*(-?\d+)/g)];
  r.notes = r.notes.map(n => { const b = n.s / r.beat; let p = n.p; for (const m of sh) if (b >= +m[1] && b < +m[2]) p += 12 * +m[3]; return { s: n.s, p, b, d: n.d, ch: n.ch, cidx: n.cidx }; })
    .filter(n => n.b >= f && (!t || n.b < t));
  if ($('tidy').checked && !r.force) {
    const P = r.notes.map(n => n.p);
    r.notes = r.notes.map((n, i) => {
      const w = P.slice(Math.max(0, i - 4), i + 5).sort((x, y) => x - y), m = w[w.length >> 1]; let p = n.p;
      while (p - m > 12) p -= 12;
      while (m - p > 12) p += 12;
      return { ...n, p };
    });
  }
  return r;
}
function getNotes0() {
  const v = document.querySelector('input[name=src]:checked').value;
  if (v === 'text') return { notes: parseText($('txt').value), beat: 1 };
  if (v === 'simple') return { notes: parseText(simple2text($('simpleIn').value, +$('startOct').value || 4)), beat: 1 };
  if (v === 'code') { const r = parseCode($('codeIn').value); return { notes: r.notes, beat: 8 * +$('mode').value, force: r.force }; }
  if (!midi) return { notes: [], beat: 1 };
  const on = [...document.querySelectorAll('#chans input:checked')].map(i => +i.value);
  const md = +$('maxdur').value * midi.ppq;
  let a = midi.notes.filter(n => on.includes(n.c) && (!md || n.d <= md)).map(n => ({ s: sec(n.t), p: n.p, c: n.c, d: sec(n.t + n.d) - sec(n.t) }));
  if (on.length > 1) {
    const pri = on.reduce((x, y) => (chScore[y] > chScore[x] ? y : x)), P = a.filter(n => n.c === pri);
    let j = 0;
    a = a.filter(n => {
      if (n.c === pri) return true;
      while (j < P.length && P[j].s + P[j].d < n.s - 0.03) j++;
      return !(j < P.length && P[j].s <= n.s + 0.03);
    });
  }
  if ($('mono').checked) {
    const r = [];
    for (const n of a) { const l = r[r.length - 1]; if (l && n.s - l.s < 0.02) { if (n.p > l.p) r[r.length - 1] = n; } else r.push(n); }
    a = r;
  }
  return { notes: a, beat: midi.tempos[0][1] / 1e6 };
}

function run() {
  const { notes, beat, force } = getNotes();
  $('warn').textContent = bad.length ? 'Okunamayan öğeler: ' + bad.join(' ') : '';
  if (!notes.length) { $('code').value = ''; $('list').value = ''; $('stats').textContent = 'Henüz nota yok. Bir MIDI dosyası yükle ya da nota yaz.'; out = []; return; }
  const b = force ? { si: force.si, r: force.r } : best(notes, +$('scale').value);
  const [name, iv, gameRoot] = SCALES[b.si], set = iv.map(x => x + b.r);
  const speed = Math.max(0.1, +$('speed').value / 100), step = +$('mode').value, cap = +$('cap').value * beat;
  const st = { exact: 0, fold: 0, near: 0, push: 0 };
  const snap = $('snap').checked, u = Math.max(1, Math.round(beat / 4 / speed / step));
  const mp = mapSeq(notes, set); let ix = 0;
  let cur = 0, prev = null, lastPos = 0, res = [];
  for (const n of notes) {
    if (prev === null) cur = $('trim').checked ? 0 : n.s; else { const d = n.s - prev; cur += cap > 0 ? Math.min(d, cap) : d; }
    prev = n.s;
    const [i, k] = mp[ix++]; st[['exact', 'fold', 'near'][k]]++;
    let pos = snap ? Math.round(cur / (beat / 4)) * u + 1 : Math.round(cur / speed / step) + 1;
    if (pos <= lastPos) { pos = lastPos + 1; st.push++; }
    lastPos = pos; res.push([pos, i, n.d || 0, n.ch, n.cidx]);
  }
  const mg = Math.ceil(+$('clean').value / step - 1e-9), before = res.length;
  if (mg >= 2) {
    const kept = [];
    for (const r of res) {
      const l = kept[kept.length - 1];
      if (l && r[0] - l[0] < mg) { if (r[2] > l[2]) kept[kept.length - 1] = r; } else kept.push(r);
    }
    res = kept; lastPos = res[res.length - 1][0];
  }
  st.thin = before - res.length;
  const hs = +$('harm').value; let hwarn = '';
  if (hs > 0) {
    if (['tia', 'cor'].includes($('stype').value)) hwarn = 'Bu Shawzin türünde akorlar farklı olduğu için armoni uygulanmadı.';
    else if (![0, 1, 4, 5, 8].includes(b.si)) hwarn = 'Bu ölçekte akorlar farklı olduğu için armoni uygulanmadı.';
    else {
      const hp = Math.ceil(hs / step - 1e-9);
      res.forEach((r, k) => {
        if (r[3] || (res[k + 1] ? res[k + 1][0] : r[0] + 99) - r[0] < hp) return;
        const c = CHORDS.find((x, j) => (j < 6 || hs <= 0.01) && x[1][2] === r[1]);
        if (c) { r[3] = c[0]; r[4] = c[1]; }
      });
      st.harm = res.filter(r => r[3]).length;
      if (st.harm && $('stype').value === 'ari') hwarn = 'Bu türde birkaç akor farklı çalabilir.';
    }
  }
  const rep = Math.min(10, Math.max(1, Math.floor(+$('rep').value) || 1));
  let useRep = rep;
  if (rep > 1) {
    const first = res[0][0], span = lastPos - first + Math.max(2, Math.round(beat / speed / step)), one = res.slice();
    useRep = Math.min(rep, Math.max(1, 1 + Math.floor((4096 - lastPos) / span)));
    for (let k = 1; k < useRep; k++) for (const r of one) res.push([r[0] + k * span, r[1], r[2], r[3], r[4]]);
  }
  out = res.filter(x => x[0] <= 4096).slice(0, 1666);
  const enc = a => String(b.si + 1) + a.map(r => (r[3] || NOTE_CHARS[r[1]]) + B64[(r[0] - 1) >> 6] + B64[(r[0] - 1) & 63]).join('');
  const lst = a => a.map(r => r[0] + (r[3] ? Object.keys(MULTI).find(k => MULTI[k] === r[3]).toUpperCase().split('').join('+') : String.fromCharCode(65 + r[1]))).join(',');
  $('code').value = enc(out);
  $('list').value = lst(out);
  last = { iv, gameRoot, step };
  const tr = gameRoot - b.r;
  $('stats').textContent = `${out.length} nota, yaklaşık ${Math.round(out[out.length - 1][0] * step)} sn, ölçek: ${name}. ` +
    `${st.exact} nota birebir, ${st.fold} nota oktav kaydırıldı, ${st.near} nota en yakın notaya yuvarlandı. ` +
    `Çeyrek nota yaklaşık ${(snap ? u * 4 : beat / speed / step).toFixed(1)} konum. ` +
    (tr ? `Oyunda ${Math.abs(tr)} yarım ses ${tr < 0 ? 'aşağıda' : 'yukarıda'} çalar.` : 'Oyunda orijinal perdede çalar.') +
    (b.per ? ' Ölçek benzerliği: ' + Object.entries(b.per).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([si, sc]) => SCALES[si][0] + ' %' + Math.round(100 * sc / b.tot)).join(', ') + '.' : '');
  const w = [];
  if (useRep < rep) w.push(`Tek kod 4096 konumla sınırlı olduğu için şarkı ${rep} kat yerine ${useRep} kat tekrarlandı.`);
  if (res.length > out.length) w.push(`Oyun en fazla 1666 nota ve 4096 konumu içe aktarıyor, son ${res.length - out.length} nota kesildi. Hızı yükselt, boşlukları azalt ya da Temiz sesi artır.`);
  else if (out.length > 1000) w.push('Bu şarkı 1000 notadan uzun. Oyunda yalnızca içe aktararak çalınır, sohbette paylaşılamaz.');
  if (hwarn) w.push(hwarn);
  if (st.harm) w.push(`${st.harm} nota akorla çalınacak. Melodi notası akorun en üst notası olarak kalır.`);
  if (st.thin) w.push(`${st.thin} birbirine çok yakın nota, sesi temiz tutmak için elendi.`);
  if (st.push) w.push(`${st.push} nota aynı konuma denk geldiği için bir adım kaydırıldı.`);
  $('warn').textContent = (bad.length ? 'Okunamayan öğeler: ' + bad.join(' ') + '. ' : '') + w.join(' ');
}

// ---------- Dinleme ----------
function stop() { oscs.forEach(o => { try { o.stop(); } catch (e) {} }); oscs = []; }
function play() {
  stop(); if (!out.length) return;
  ac = ac || new AudioContext();
  const t0 = ac.currentTime + 0.1;
  out.forEach(r => (r[4] || [r[1]]).forEach(x => tone(440 * Math.pow(2, (last.gameRoot + last.iv[x] - 69) / 12), t0 + (r[0] - 1) * last.step, 0.9)));
}
function tone(f, t, len) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'triangle'; o.frequency.value = f;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + len + 0.05); oscs.push(o);
}
function preview(c) {
  stop(); ac = ac || new AudioContext();
  const a = midi.notes.filter(n => n.c === c), t0 = ac.currentTime + 0.1, s0 = sec(a[0].t);
  for (const n of a) {
    const s = sec(n.t) - s0; if (s > 12) break;
    tone(440 * Math.pow(2, (n.p - 69) / 12), t0 + s, Math.min(sec(n.t + n.d) - sec(n.t), 1) + 0.1);
  }
}

// ---------- Olaylar ----------
$('file').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try { midi = await readFile(f); sec = makeSec(midi); listChannels(); run(); }
  catch (err) { $('stats').textContent = err.message; }
});
document.querySelectorAll('input[name=src]').forEach(r => r.addEventListener('change', () => {
  const v = document.querySelector('input[name=src]:checked').value;
  $('midiBox').hidden = v !== 'midi'; $('textBox').hidden = v !== 'text'; $('simpleBox').hidden = v !== 'simple'; $('codeBox').hidden = v !== 'code'; run();
}));
document.body.addEventListener('input', e => { if (e.target.classList.contains('c')) { save(); run(); } });
$('chans').addEventListener('click', e => { if (e.target.dataset.pv) preview(+e.target.dataset.pv); });
$('copy').onclick = () => { navigator.clipboard.writeText($('code').value); $('copy').textContent = 'Kopyalandı'; setTimeout(() => ($('copy').textContent = 'Kopyala'), 1500); };
function autoCh() {
  const bk = n => Math.floor(sec(n.t) * 4), by = {};
  midi.notes.forEach(n => (by[n.c] = by[n.c] || []).push(n));
  const cand = chRows.filter(r => r.c !== 9 && r.poly < 0.35 && r.n >= 20).sort((x, y) => y.score - x.score);
  if (!cand.length) return;
  const cov = new Set(), pick = [];
  for (const r of cand) {
    const bs = by[r.c].map(bk), fresh = bs.filter(b => !cov.has(b)).length / bs.length;
    if (!pick.length || (fresh > 0.5 && pick.length < 3)) { pick.push(r.c); bs.forEach(b => cov.add(b)); }
  }
  document.querySelectorAll('#chans input').forEach(i => (i.checked = pick.includes(+i.value)));
  run();
}
$('auto').onclick = () => midi && autoCh();
const DEF = { scale: '-1', speed: '60', mode: '0.125', cap: '1.5', maxdur: '0', clean: '0.2', rep: '1', from: '0', to: '0', shifts: '', startOct: '4', trim: true, mono: true, snap: false, harm: '0.5', tidy: true, stype: 'std' };
$('reset').onclick = () => {
  for (const k in DEF) { if ($(k).type === 'checkbox') $(k).checked = DEF[k]; else $(k).value = DEF[k]; }
  save(); run();
};
$('play').onclick = play;
$('stop').onclick = stop;
run();
