/* Mushaf check: finds every quoted verse in the real Mushaf text and puts the exact wording back.
   Text: Uthmani script from The Noble Qur'an Encyclopedia (quranenc.com), CC BY-SA 4.0. */
(() => {
'use strict';
const AR = '٠١٢٣٤٥٦٧٨٩';
const ar = n => String(n).replace(/\d/g, d => AR[d]);

// Compare letters only: no vowels or marks, no alef/waw/yaa/hamza seats (Uthmani and normal spelling
// differ mostly there), taa marbuta = haa, no spaces.
const DROP = new Set('اأإآٱءؤئوىيۥۦ'.split(''));
function skeleton(s, keepMap) {
  const out = []; const map = [];
  const chars = Array.from(s);
  for (let i = 0; i < chars.length; i++) {
    let c = chars[i];
    const code = c.codePointAt(0);
    if (code >= 0x064B && code <= 0x065F) continue;          // harakat
    if (code === 0x0670) continue;                             // dagger alef
    if (code >= 0x06D6 && code <= 0x06ED) continue;           // Quranic small marks
    if (code === 0x0640) continue;                             // tatweel
    if (c === 'ة') c = 'ه';
    if (DROP.has(c)) continue;
    if (code < 0x0621 || code > 0x064A) continue;              // not an Arabic letter
    out.push(c); if (keepMap) map.push(i);
  }
  return keepMap ? { s: out.join(''), map, chars } : out.join('');
}

let index = null;
async function load() {
  if (index) return index;
  const data = await (await fetch('data/quran.json')).json();
  index = data.map(([name, verses], si) => {
    let s = ''; const starts = []; const parts = [];
    let text = ''; const ayahAt = [];
    verses.forEach((v, vi) => {
      const sk = skeleton(v, true);
      starts.push(s.length);
      parts.push({ sk, text: v });
      s += sk.s;
    });
    return { name, num: si + 1, s, starts, parts };
  });
  return index;
}

const SURAH_HINT = /سورة|قوله تعالى|قال تعالى|قال الله|﴿|آية|الآية/;

function locate(skel) {
  if (skel.length < 10) return null;
  for (const su of index) {
    const at = su.s.indexOf(skel);
    if (at < 0) continue;
    // which verses does it span
    let a = 0; while (a + 1 < su.starts.length && su.starts[a + 1] <= at) a++;
    const endPos = at + skel.length - 1;
    let b = a; while (b + 1 < su.starts.length && su.starts[b + 1] <= endPos) b++;
    return { su, a, b, at, len: skel.length };
  }
  return null;
}

// Cut the exact Mushaf wording that matches, on whole words.
function exactText(hit) {
  const { su, a, b, at, len } = hit;
  const pieces = [];
  for (let k = a; k <= b; k++) {
    const p = su.parts[k];
    const from = Math.max(at, su.starts[k]) - su.starts[k];
    const to = Math.min(at + len, su.starts[k] + p.sk.s.length) - su.starts[k];
    let i0 = p.sk.map[from] ?? 0;
    let i1 = to - 1 < p.sk.map.length ? p.sk.map[to - 1] : p.sk.chars.length - 1;
    const ch = p.sk.chars;
    while (i0 > 0 && ch[i0 - 1] !== ' ') i0--;
    while (i1 < ch.length - 1 && ch[i1 + 1] !== ' ') i1++;
    const whole = from === 0 && to >= p.sk.s.length;
    pieces.push((whole ? p.text : ch.slice(i0, i1 + 1).join('')) + ` ﴿${ar(k + 1)}﴾`);
  }
  return pieces.join(' ');
}

function refOf(hit) {
  const { su, a, b } = hit;
  return `${su.name}: ${ar(a + 1)}${b > a ? '–' + ar(b + 1) : ''}`;
}

// the surah a reference names, as a whole word ("البقرة: ٢٥٥", "سورة ق")
function namedSurah(ref) {
  if (!ref) return null;
  const words = String(ref).replace(/[:،,.()\[\]]/g, ' ').split(/\s+/).filter(Boolean);
  for (let n = 3; n >= 1; n--) for (let i = 0; i + n <= words.length; i++) {
    const w = words.slice(i, i + n).join(' ');
    const hit = index.find(s => s.name === w);
    if (hit && (hit.name.length > 2 || /سورة/.test(ref))) return hit.name;
  }
  return null;
}

// Check one lesson's notes; returns lines for the check report.
async function check(notes) {
  await load();
  const fixed = [], missing = [];
  const visit = b => {
    if (!b || b.t !== 'verse' || !b.text) return;
    const clean = String(b.text).replace(/^\s*(قال الله تعالى|قال تعالى|قوله تعالى|قال الله|يقول الله تعالى|يقول تعالى)\s*[:：]?/, '').replace(/[«»"()\[\]﴿﴾{}.…،؛:!؟]/g, ' ').replace(/\d+|[٠-٩]+/g, ' ');
    const sk = skeleton(clean);
    let hit = locate(sk);
    let partial = false;
    if (!hit && sk.length >= 16) { // allow a slightly wrong ending or beginning
      const k = Math.max(11, Math.floor(sk.length * 0.65));
      hit = locate(sk.slice(0, k)) || locate(sk.slice(sk.length - k));
      partial = !!hit;
    }
    if (hit) {
      const exact = exactText(hit), ref = refOf(hit);
      if (partial) fixed.push(`صُحّح نص آية من المصحف (${ref}). راجع أن الموضع هو المقصود.`);
      else if (namedSurah(b.ref) && namedSurah(b.ref) !== hit.su.name) fixed.push(`صُحّح موضع آية إلى (${ref}).`);
      b.text = exact; b.ref = ref; b.quran = true;
      if (partial) b.quranPartial = true;
    } else if (SURAH_HINT.test((b.ref || '') + ' ' + b.text) || namedSurah(b.ref)) {
      missing.push(`لم أجد هذا النص في المصحف بلفظه: «${String(b.text).slice(0, 60)}…» — راجعه.`);
    }
  };
  for (const s of notes.sections || []) for (const b of s.blocks || []) visit(b);
  notes.report ??= {};
  if (fixed.length) notes.report.inferred = [...(notes.report.inferred || []), ...fixed];
  if (missing.length) notes.report.maybe_wrong = [...(notes.report.maybe_wrong || []), ...missing];
  const n = (notes.sections || []).flatMap(s => s.blocks || []).filter(b => b.quran).length;
  if (n) notes.report.inferred = [...(notes.report.inferred || []), `✓ عدد الآيات المطابقة لنص المصحف: ${ar(n)}.`];
  return notes;
}

window.Mushaf = { check, load, _skeleton: skeleton };
})();
