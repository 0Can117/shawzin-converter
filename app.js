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
const FAM = ['Piyano', 'Kromatik perküsyon', 'Org', 'Gitar', 'Bas', 'Yaylılar', 'Topluluk', 'Bakır nefesliler', 'Kamışlı nefesliler', 'Flüt grubu', 'Sentezleyici lead', 'Sentezleyici pad', 'Sentezleyici efekt', 'Etnik', 'Perküsyon', 'Ses efekti'];
const MULTI = { defghijkl: '/', deghjk: '7', efhikl: '+', dfgijl: '9', dgj: '5', ehk: '6', fil: '8', ghijkl: '3', hikl: '2', ghjk: 'z', gijl: '1', il: '0', hk: 'y', gj: 'x', defjkl: 'v', dejk: 'r', dfjl: 't', efkl: 'u', dj: 'p', ek: 'q', fl: 's', defghi: 'f', efhi: 'e', dfgi: 'd', degh: 'b', dg: 'Z', eh: 'a', fi: 'c', jkl: 'n', jk: 'j', kl: 'm', jl: 'l', ghi: 'X', hi: 'W', gh: 'T', gi: 'V', def: 'P', ef: 'O', de: 'L', df: 'N', abc: 'H', ab: 'D', bc: 'G', ac: 'F' };
const chordChar = (i, j) => MULTI[['abcdefghijkl'[i], 'abcdefghijkl'[j]].sort().join('')];
const NN = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const nm = p => NN[p % 12] + (Math.floor(p / 12) - 1);

let midi = null, sec = null, out = [], last = null, ac = null, oscs = [];

SCALES.forEach(([n], i) => $('scale').add(new Option(n, i)));
const KEYS = ['scale', 'speed', 'mode', 'cap', 'maxdur', 'trim', 'mono', 'snap', 'pick', 'chord', 'autosplit', 'snap8', 'snapdrop', 'snaptempo', 'minshort', 'from', 'to', 'shifts', 'rep', 'clean', 'startOct'];
const val = k => ($(k).type === 'checkbox' ? $(k).checked : $(k).value);
function save() { try { localStorage.setItem('szv3', JSON.stringify(Object.fromEntries(KEYS.map(k => [k, val(k)])))); } catch (e) {} }
try { const s = JSON.parse(localStorage.getItem('szv3') || '{}'); KEYS.forEach(k => { if (k in s) { if ($(k).type === 'checkbox') $(k).checked = s[k]; else $(k).value = s[k]; } }); } catch (e) {}

if ($('cap').selectedIndex < 0) $('cap').value = '2';

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
          if (q && q.length) { const st = q.shift(); notes.push({ t: st, d: tick - st, p: a, c: ch, k: t }); }
        }
      }
    }
    p = end;
  }
  tempos.sort((x, y) => x[0] - y[0]);
  if (!tempos.length || tempos[0][0] > 0) tempos.unshift([0, 500000]);
  const multi = new Set(notes.map(n => n.k)).size > 1;
  if (multi) notes.forEach(n => (n.c = n.k * 16 + n.c));
  notes.sort((x, y) => x.t - y.t || x.p - y.p);
  return { ppq, notes, tempos, progs, multi };
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
    const score = a.length * Math.pow(1 - poly, 3) * (med >= 52 && (+c & 15) !== 9 ? 1 : 0.2);
    return { c: +c, n: a.length, lo: ps[0], hi: ps[ps.length - 1], poly, score };
  });
  const top = rows.reduce((x, y) => (y.score > x.score ? y : x), rows[0]);
  $('chans').innerHTML = rows.map(r =>
    `<div style="display:flex;gap:8px;align-items:center"><label class="row"><input type="checkbox" class="c" value="${r.c}" ${r === top ? 'checked' : ''}>
     ${midi.names ? midi.names[r.c] : (midi.multi ? 'Parça ' + ((r.c >> 4) + 1) + ', kanal ' : 'Kanal ') + ((r.c & 15) + 1) + ((r.c & 15) === 9 ? ' (davul)' : midi.progs && (r.c & 15) in midi.progs ? ' (' + FAM[midi.progs[r.c & 15] >> 3] + ')' : '')}: ${r.n} nota, ${nm(r.lo)}-${nm(r.hi)}, çok seslilik %${Math.round(r.poly * 100)}</label><button type="button" class="alt" data-pv="${r.c}">Dinle</button></div>`).join('');
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
      const f = 960 / div, M = { fwd: false, back: false, ends: null, times: 2, notes: [], len: 0, tempos: [] };
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
        if (t === 'direction' || t === 'sound') { const sn = t === 'sound' ? n : n.querySelector('sound[tempo]'), tv = sn && +sn.getAttribute('tempo'); if (tv > 0) M.tempos.push([Math.round(cur * f), tv]); }
        else if (t === 'backup') cur -= du;
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
  const order = playOrder(parts[0]), notes = [], tev = [];
  parts.forEach((ms, pi) => {
    let base = 0;
    for (const i of order) { const M = ms[i]; if (M) { M.notes.forEach(n => notes.push({ c: n.c, t: base + n.t, d: n.d, p: n.p })); if (pi === 0) M.tempos.forEach(([o, bp]) => tev.push([base + o, Math.round(6e7 / bp)])); } base += parts[0][i].len; }
  });
  if (!notes.length) throw new Error('Dosyada nota bulunamadı.');
  notes.sort((a, b) => a.t - b.t || a.p - b.p);
  tev.sort((x, y) => x[0] - y[0]);
  const tempos = tev.filter((e, k) => !(k + 1 < tev.length && tev[k + 1][0] === e[0]));
  if (!tempos.length || tempos[0][0] > 0) tempos.unshift([0, Math.round(6e7 / bpm)]);
  return { ppq: 960, notes, tempos, names };
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
    const ni = NOTE_CHARS.indexOf(s[k]), a = B64.indexOf(s[k + 1]), b = B64.indexOf(s[k + 2]);
    if (ni < 0 || a < 0 || b < 0) { bad.push(s.substr(k, 3)); continue; }
    o.push({ s: (a * 64 + b) * step, p: g + iv[ni] });
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

let bestCache = { k: '', v: null };
// Ölçek ve kök seçimi: önce nota uyumuna göre aday listesi, sonra uyumu birbirine yakın adaylar arasında melodi çizgisini en az bozan seçilir
function best(ns, only) {
  let ck = only + '|' + ns.length + '|';
  { let hs = 0; for (const n of ns) hs = (hs * 31 + n.p + Math.round(n.s * 10)) | 0; ck += hs; }
  if (bestCache.k === ck) return bestCache.v;
  const h = {}, per = {}, cands = []; ns.forEach(n => (h[n.p] = (h[n.p] || 0) + 1 + 2 * Math.min(n.d || 0, 1)));
  const ks = Object.keys(h).map(Number), lo = Math.min(...ks), hi = Math.max(...ks);
  let b = { sc: -1 };
  SCALES.forEach(([, iv], si) => {
    if (only >= 0 && only !== si) return;
    for (let r = lo - 19; r <= hi; r++) {
      const set = iv.map(x => x + r); let sc = 0;
      for (const k of ks) { const f = fit(k, set)[1]; sc += h[k] * (f === 0 ? 1 : f === 1 ? 0.5 : 0); }
      if (!(per[si] >= sc)) per[si] = sc;
      cands.push({ si, r, sc });
      if (sc > b.sc) b = { si, r, sc };
    }
  });
  const sl = cands.filter(c => c.sc >= b.sc * 0.97).sort((x, y) => y.sc - x.sc).slice(0, 40);
  if (sl.length > 1 && ns.length >= 2 && ns.length <= 6000) {
    let bc = Infinity;
    for (const c of sl) {
      const set = SCALES[c.si][1].map(x => x + c.r), mp = mapSeq(ns, set);
      let cost = 0, pq = null, pp = null;
      mp.forEach(([j, k], i) => {
        const q = set[j];
        if (k === 2) cost += 6;
        if (pq !== null) { const dq = q - pq, dp = ns[i].p - pp; cost += Math.abs(dq - dp) + (dp && dq && Math.sign(dp) !== Math.sign(dq) ? 3 : 0); }
        pq = q; pp = ns[i].p;
      });
      cost -= (c.sc / b.sc) * 0.001;
      if (cost < bc) { bc = cost; b = { si: c.si, r: c.r, sc: c.sc }; }
    }
  }
  b.per = per; b.tot = Object.values(h).reduce((x, y) => x + y, 0);
  bestCache = { k: ck, v: b };
  return b;
}

function getNotes() {
  const r = getNotes0(), f = +$('from').value, t = +$('to').value;
  const sh = [...$('shifts').value.matchAll(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*:\s*(-?\d+)/g)];
  r.notes = r.notes.map(n => { const b = r.ppq && n.tk !== undefined ? n.tk / r.ppq : n.s / r.beat; let o = 0; for (const m of sh) if (b >= +m[1] && b < +m[2]) o += 12 * +m[3]; return { s: n.s, p: n.p + o, b, q: n.q, d: n.d, x: (n.x || []).map(q => q + o) }; })
    .filter(n => n.b >= f && (!t || n.b < t));
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
  const tempoAt = tk => { let i = midi.tempos.length - 1; while (i > 0 && midi.tempos[i][0] > tk) i--; return midi.tempos[i][1] / 1e6; };
  let a = midi.notes.filter(n => on.includes(n.c) && (!md || n.d <= md) && (!$('minshort').checked || n.d >= midi.ppq / 16)).map(n => ({ s: sec(n.t), p: n.p, d: sec(n.t + n.d) - sec(n.t), tk: n.t, q: tempoAt(n.t) }));
  if ($('mono').checked) {
    const pk = $('pick').value, ch = $('chord').checked, r = [];
    for (let i = 0; i < a.length;) {
      let j = i + 1; while (j < a.length && a[j].s - a[i].s < 0.02) j++;
      const g = a.slice(i, j), pv = r.length ? r[r.length - 1].p : null; i = j;
      let m = g[0];
      for (const n of g) {
        const dn = pv === null ? 0 : Math.abs(n.p - pv), dm = pv === null ? 0 : Math.abs(m.p - pv);
        if (pk === 'low' ? n.p < m.p : pk === 'near' && pv !== null ? (dn < dm || (dn === dm && n.p > m.p)) : n.p > m.p) m = n;
      }
      r.push({ s: m.s, p: m.p, d: m.d, tk: m.tk, q: m.q, x: ch ? g.filter(n => n !== m).map(n => n.p) : [] });
    }
    a = r;
  }
  return { notes: a, beat: midi.tempos[0][1] / 1e6, ppq: midi.ppq };
}

let parts = [];
function build(notes, beat, force, o = {}) {
  const b = force ? { si: force.si, r: force.r } : best(notes, +$('scale').value);
  const [name, iv, gameRoot] = SCALES[b.si], set = iv.map(x => x + b.r);
  const speed = Math.max(0.1, +$('speed').value / 100), step = +$('mode').value, capB = +$('cap').value;
  const st = { exact: 0, fold: 0, near: 0, push: 0, drop: 0, chord: 0 };
  const trim = o.trim !== undefined ? o.trim : $('trim').checked, chordOn = $('chord').checked;
  const snap = $('snap').checked, gu = $('snap8').checked ? 0.5 : 0.25;
  const unit = q => { const id = q * gu / speed / step; return $('snaptempo').checked ? Math.max(0.5, id) : Math.max(1, Math.round(id)); };
  const mp = mapSeq(notes, set); let ix = 0;
  let cur = 0, curB = 0, prev = null, prevB = 0, P = 0, kPrev = 0, lastPos = 0, res = [];
  for (const n of notes) {
    let qi = n.q || beat;
    if (prev === null) { cur = trim ? 0 : n.s; curB = trim ? 0 : n.b; }
    else { const d = n.s - prev, db = n.b - prevB, cp = capB > 0 && db > capB; if (db > 1e-9) qi = d / db; cur += cp ? d * capB / db : d; curB += cp ? capB : db; }
    prev = n.s; prevB = n.b;
    const [i, k] = mp[ix++]; st[['exact', 'fold', 'near'][k]]++;
    let j = -1;
    if (chordOn && n.x && n.x.length) {
      let bd = 1e9;
      for (const q of n.x) for (let jj = 0; jj < 12; jj++) {
        if (jj === i || (((set[jj] - q) % 12) + 12) % 12 !== 0 || !chordChar(i, jj)) continue;
        const d = Math.abs(set[jj] - q); if (d < bd) { bd = d; j = jj; }
      }
    }
    let pos;
    if (snap) { const kk = Math.round(curB / gu); P += (kk - kPrev) * unit(qi); kPrev = kk; pos = Math.round(P) + 1; }
    else pos = Math.round(cur / speed / step) + 1;
    if (pos <= lastPos) {
      if (snap && $('snapdrop').checked && res.length) { const l = res[res.length - 1]; if ((n.d || 0) > l[2]) { l[1] = i; l[2] = n.d || 0; l[3] = j; } st.drop++; continue; }
      pos = lastPos + 1; st.push++;
    }
    lastPos = pos; res.push([pos, i, n.d || 0, j]);
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
  const rep = Math.min(10, Math.max(1, Math.floor(+$('rep').value) || 1));
  let useRep = rep;
  if (rep > 1 && !o.noRep) {
    const first = res[0][0], span = lastPos - first + Math.max(2, Math.round(beat / speed / step)), one = res.slice();
    useRep = Math.min(rep, Math.max(1, 1 + Math.floor((4096 - lastPos) / span)));
    for (let k = 1; k < useRep; k++) for (const e of one) res.push([e[0] + k * span, ...e.slice(1)]);
  }
  const outA = res.filter(x => x[0] <= 4096);
  st.chord = outA.filter(x => x[3] >= 0).length;
  const enc = a => String(b.si + 1) + a.map(([p, i, , j]) => (j >= 0 ? chordChar(i, j) : NOTE_CHARS[i]) + B64[(p - 1) >> 6] + B64[(p - 1) & 63]).join('');
  const lst = a => a.map(([p, i, , j]) => p + String.fromCharCode(65 + i) + (j >= 0 ? '+' + String.fromCharCode(65 + j) : '')).join(',');
  const tr = gameRoot - b.r, secs = Math.round(outA[outA.length - 1][0] * step);
  const trTxt = tr ? `Oyunda ${Math.abs(tr)} yarım ses ${tr < 0 ? 'aşağıda' : 'yukarıda'} çalar.` : 'Oyunda orijinal perdede çalar.';
  const stats = `${outA.length} nota, yaklaşık ${secs} sn, ölçek: ${name}. ` +
    `${st.exact} nota birebir, ${st.fold} nota oktav kaydırıldı, ${st.near} nota en yakın notaya yuvarlandı. ` +
    (st.chord ? `${st.chord} konumda akor kullanıldı. ` : '') +
    `Çeyrek nota yaklaşık ${(snap ? unit(notes[0].q || beat) / gu : (notes[0].q || beat) / speed / step).toFixed(1)} konum. ` + trTxt +
    (b.per ? ' Ölçek benzerliği: ' + Object.entries(b.per).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([si, sc]) => SCALES[si][0] + ' %' + Math.round(100 * sc / b.tot)).join(', ') + '.' : '');
  const brief = `Ölçek: ${name}, ${outA.length} nota, yaklaşık ${secs} sn, ${st.near} nota yuvarlandı. ${trTxt}`;
  const w = [];
  if (useRep < rep) w.push(`Tek kod 4096 konumla sınırlı olduğu için şarkı ${rep} kat yerine ${useRep} kat tekrarlandı.`);
  if (res.length > outA.length) w.push(`Şarkı 4096 konuma sığmadı, son ${res.length - outA.length} nota kesildi. Yavaş modu seç (oyunda da aç), hızı yükselt ya da boşluk sınırını düşür.`);
  if (st.thin) w.push(`${st.thin} birbirine çok yakın nota, sesi temiz tutmak için elendi.`);
  if (st.drop) w.push(`${st.drop} nota aynı ızgara noktasına denk geldiği için elendi.`);
  if (st.push) w.push(`${st.push} nota aynı konuma denk geldiği için bir adım kaydırıldı.`);
  return { code: enc(outA), list: lst(outA), out: outA, last: { iv, gameRoot, step }, stats, brief, warn: w.join(' '), st };
}

// Ton değişimi: notaları, her bölümde en az nota dışarıda kalacak şekilde parçalara böler
function splitKeys(notes) {
  const n = notes.length; if (n < 40) return [0, n];
  const only = +$('scale').value;
  const sis = only >= 0 ? [only] : SCALES.map((_, i) => i).filter(i => SCALES[i][0] !== 'Chromatic');
  const H = [new Array(12).fill(0)];
  notes.forEach((x, i) => { const h = H[i].slice(); h[((x.p % 12) + 12) % 12]++; H.push(h); });
  const cov = [];
  for (const si of sis) {
    const pcs = [...new Set(SCALES[si][1].map(v => v % 12))];
    for (let r = 0; r < 12; r++) { const m = new Array(12).fill(0); pcs.forEach(p => (m[(p + r) % 12] = 1)); cov.push(m); }
  }
  const cost = (i, j) => { let bst = 0; for (const m of cov) { let c = 0; for (let k = 0; k < 12; k++) if (m[k]) c += H[j][k] - H[i][k]; if (c > bst) bst = c; } return (j - i) - bst; };
  let cand = [0];
  for (let i = 1; i < n; i++) if (notes[i].b - notes[i - 1].b >= 1 || Math.floor(notes[i].b / 8) !== Math.floor(notes[i - 1].b / 8)) cand.push(i);
  cand.push(n);
  if (cand.length > 400) { const s = Math.ceil(cand.length / 400); cand = cand.filter((_, k) => k % s === 0 || k === cand.length - 1); }
  const LAM = 6, MIN = 12, f = [0], from = [0];
  for (let b = 1; b < cand.length; b++) {
    f[b] = Infinity;
    for (let a2 = 0; a2 < b; a2++) {
      if (cand[b] - cand[a2] < MIN && !(a2 === 0 && b === cand.length - 1)) continue;
      const c = f[a2] + cost(cand[a2], cand[b]) + (a2 ? LAM : 0);
      if (c < f[b]) { f[b] = c; from[b] = a2; }
    }
  }
  const cuts = []; for (let b = cand.length - 1; b > 0; b = from[b]) cuts.unshift(cand[b]);
  cuts.unshift(0);
  return cuts;
}
function renderParts(notes, beat, force, R) {
  const box = $('parts'); parts = []; box.innerHTML = '';
  if (!$('autosplit').checked || force) return;
  const cuts = splitKeys(notes);
  if (cuts.length < 3) { box.innerHTML = '<p class="hint">Ton değişimi bulunamadı, tek kod yeterli.</p>'; return; }
  let tot = 0, html = '';
  for (let k = 0; k + 1 < cuts.length; k++) {
    const sub = notes.slice(cuts[k], cuts[k + 1]);
    const P = build(sub, beat, null, { trim: true, noRep: true });
    parts.push(P.code); tot += P.st.near;
    html += `<div class="part"><b>Bölüm ${k + 1}</b> <small>vuruş ${Math.round(sub[0].b)}-${Math.round(sub[sub.length - 1].b)}</small>` +
      `<textarea readonly rows="3" aria-label="Bölüm ${k + 1} kodu">${P.code}</textarea>` +
      `<div class="btns"><button type="button" class="alt" data-part="${k}">Kopyala</button></div><p class="hint">${P.brief}</p></div>`;
  }
  if (tot >= R.st.near) { parts = []; box.innerHTML = `<p class="hint">Ton değişimi var ama bölmek yuvarlanan notayı azaltmıyor (tek kod: ${R.st.near}, bölümler: ${tot}). Tek kod yeterli.</p>`; return; }
  box.innerHTML = `<p class="hint">Ton değişimi bulundu, ${parts.length} bölüm. Tek kodda ${R.st.near} nota yuvarlanıyor, bölümlerde toplam ${tot}. Bölümleri oyunda sırayla çal.</p>` + html;
}

function tempoInfo() {
  if (!midi || document.querySelector('input[name=src]:checked').value !== 'midi') return '';
  const bp = midi.tempos.map(t => 6e7 / t[1]), lo = Math.min(...bp), hi = Math.max(...bp);
  return hi - lo > 1 ? ` Tempo değişiyor (${Math.round(lo)}-${Math.round(hi)} BPM), süreler buna göre ayarlandı.` : '';
}
function run() {
  const { notes, beat, force } = getNotes();
  const bd = bad.length ? 'Okunamayan öğeler: ' + bad.join(' ') + '. ' : '';
  $('parts').innerHTML = ''; parts = [];
  if (!notes.length) { $('code').value = ''; $('list').value = ''; $('stats').textContent = 'Henüz nota yok. Bir MIDI dosyası yükle ya da nota yaz.'; $('warn').textContent = bd; out = []; return; }
  const R = build(notes, beat, force);
  out = R.out; last = R.last;
  $('code').value = R.code; $('list').value = R.list; $('stats').textContent = R.stats + tempoInfo(); $('warn').textContent = bd + R.warn;
  renderParts(notes, beat, force, R);
}

// ---------- Dinleme ----------
function stop() { oscs.forEach(o => { try { o.stop(); } catch (e) {} }); oscs = []; }
function play() {
  stop(); if (!out.length) return;
  ac = ac || new AudioContext();
  const t0 = ac.currentTime + 0.1;
  out.forEach(([pos, i, , j]) => { for (const x of j >= 0 ? [i, j] : [i]) tone(440 * Math.pow(2, (last.gameRoot + last.iv[x] - 69) / 12), t0 + (pos - 1) * last.step, 0.9); });
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
const DEF = { scale: '-1', speed: '100', mode: '0.0625', cap: '2', maxdur: '0', clean: '0', rep: '1', from: '0', to: '0', shifts: '', startOct: '4', trim: true, mono: true, snap: false, pick: 'high', chord: false, autosplit: false, snap8: false, snapdrop: false, snaptempo: true, minshort: false };
$('reset').onclick = () => {
  for (const k in DEF) { if ($(k).type === 'checkbox') $(k).checked = DEF[k]; else $(k).value = DEF[k]; }
  save(); run();
};
$('parts').addEventListener('click', e => { const k = e.target.dataset.part; if (k === undefined) return; navigator.clipboard.writeText(parts[+k]); e.target.textContent = 'Kopyalandı'; setTimeout(() => (e.target.textContent = 'Kopyala'), 1500); });
$('play').onclick = play;
$('stop').onclick = stop;
run();
