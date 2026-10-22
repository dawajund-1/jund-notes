/* ملاحظات جُنيد — the app. Plain JS, no build step. */
(() => {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const ar = n => String(n).replace(/\d/g, d => AR_DIGITS[d]);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const PRICES = { // USD per million tokens
  'claude-opus-5-5': { in: 4, out: 20 },
  'claude-sonnet-5-5': { in: 2, out: 10 },
};
const SAR = 3.75;

/* ---------- small storage helpers ---------- */
const store = {
  get(k, d = null) { try { const v = localStorage.getItem('jn_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('jn_' + k, JSON.stringify(v)); } catch {} },
};

const idb = (() => {
  let dbp;
  const open = () => dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('jund-notes', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('lessons', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('lessons', mode);
      const req = fn(t.objectStore('lessons'));
      t.oncomplete = () => res(req?.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    put: v => tx('readwrite', s => s.put(v)),
    get: id => tx('readonly', s => s.get(id)),
    all: () => tx('readonly', s => s.getAll()),
    del: id => tx('readwrite', s => s.delete(id)),
  };
})();

/* ---------- subjects ---------- */
function familyOf(sub) {
  const o = store.get('families', {});
  return o[sub.id] || sub.family;
}
function subjectById(id) { return window.SUBJECTS.find(s => s.id === id); }

function fillSubjects() {
  const sel = $('#subject');
  const groups = {};
  for (const s of window.SUBJECTS) (groups[s.place] ??= []).push(s);
  sel.innerHTML = Object.entries(groups).map(([place, list]) =>
    `<optgroup label="${esc(place)}">${list.map(s => `<option value="${s.id}">${esc(s.name)}${s.book ? ' — ' + esc(s.book) : ''}</option>`).join('')}</optgroup>`
  ).join('') + `<option value="other">مادة أخرى…</option>`;
  sel.value = store.get('lastSubject', window.SUBJECTS[0].id);
  if (!sel.value) sel.value = window.SUBJECTS[0].id;
  const sync = () => { $('#custom-subject-wrap').hidden = sel.value !== 'other'; store.set('lastSubject', sel.value); };
  sel.addEventListener('change', sync); sync();
}

function renderPaletteSettings() {
  const box = $('#palette-list');
  const fams = window.FAMILIES;
  box.innerHTML = window.SUBJECTS.map(s => {
    const pal = window.paletteFor(familyOf(s));
    return `<div class="pal-row">
      <span class="pal-chip" style="background:${pal['--sub-head']}"></span>
      <span style="flex:1;min-width:0">${esc(s.name)} <small class="muted">(${esc(s.place)})</small></span>
      <select data-sub="${s.id}" aria-label="لون ${esc(s.name)}">${Object.entries(fams).map(([k, f]) => `<option value="${k}" ${k === familyOf(s) ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>
    </div>`;
  }).join('') + `<div id="pal-warn" class="muted"></div>`;
  $$('select[data-sub]', box).forEach(sel => sel.addEventListener('change', () => {
    const o = store.get('families', {}); o[sel.dataset.sub] = sel.value; store.set('families', o);
    renderPaletteSettings();
  }));
  // warn about repeats inside one place
  const seen = {}; const dup = [];
  for (const s of window.SUBJECTS) { const k = s.place + familyOf(s); if (seen[k]) dup.push(`${seen[k]} و${s.name}`); else seen[k] = s.name; }
  $('#pal-warn').textContent = dup.length ? '⚠ لون متكرر في المكان نفسه: ' + dup.join('، ') : '';
}

/* ---------- navigation ---------- */
function show(name) {
  for (const s of ['new', 'result', 'library', 'settings']) $('#screen-' + s).hidden = s !== name;
  if (name === 'library') renderLibrary();
  if (name === 'settings') { renderPaletteSettings(); renderSpend(); }
  if (name === 'new') $('#key-missing').hidden = !!store.get('key');
  if (name === 'result') requestAnimationFrame(fitPages);
  window.scrollTo(0, 0);
}
$('#go-home').onclick = () => show(current ? 'result' : 'new');
$('#go-library').onclick = () => show('library');
$('#go-settings').onclick = () => show('settings');
document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) show(g.dataset.go); });

/* ---------- settings ---------- */
function initSettings() {
  $('#api-key').value = store.get('key', '');
  $('#model').value = store.get('model', 'claude-opus-5-5');
  $('#model').onchange = () => store.set('model', $('#model').value);
  $('#toggle-key').onclick = () => {
    const i = $('#api-key'); i.type = i.type === 'password' ? 'text' : 'password';
    $('#toggle-key').textContent = i.type === 'password' ? 'إظهار' : 'إخفاء';
  };
  $('#save-key').onclick = () => {
    store.set('key', $('#api-key').value.trim());
    $('#key-status').textContent = store.get('key') ? '✓ حُفظ المفتاح على هذا الجوال.' : 'حُذف المفتاح.';
  };
  $('#test-key').onclick = async () => {
    store.set('key', $('#api-key').value.trim());
    $('#key-status').textContent = 'جارٍ التجربة…';
    try {
      const r = await callClaude({ system: 'أجب بكلمة واحدة.', messages: [{ role: 'user', content: 'قل: يعمل' }], maxTokens: 20, model: 'claude-sonnet-5-5' });
      $('#key-status').textContent = '✓ المفتاح يعمل. (' + r.text.trim() + ')';
    } catch (e) { $('#key-status').textContent = '✗ ' + e.message; }
  };
}
function renderSpend() {
  const s = store.get('spend', { usd: 0, runs: 0 });
  $('#spend').textContent = s.runs
    ? `نحو ${ar((s.usd * SAR).toFixed(2))} ريال على ${ar(s.runs)} عملية.`
    : 'لا شيء بعد.';
}
function addSpend(model, usage) {
  const p = PRICES[model] || PRICES['claude-opus-5-5'];
  const inTok = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25 + (usage.cache_read_input_tokens || 0) * 0.1;
  const usd = (inTok * p.in + (usage.output_tokens || 0) * p.out) / 1e6;
  const s = store.get('spend', { usd: 0, runs: 0 });
  s.usd += usd; s.runs += 1; store.set('spend', s);
  return usd;
}

/* ---------- the AI call (streamed) ---------- */
async function callClaude({ system, messages, maxTokens = 32000, model, onText, signal }) {
  const key = store.get('key');
  if (!key) throw new Error('لا يوجد مفتاح. ضعه في الإعدادات أولًا.');
  model ??= store.get('model', 'claude-opus-5-5');
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model, max_tokens: maxTokens, stream: true,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages,
      }),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('تعذّر الاتصال. تأكد من الإنترنت ثم حاول مرة ثانية.');
  }
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json())?.error?.message || ''; } catch {}
    if (res.status === 401) throw new Error('المفتاح غير صحيح. انسخه مرة ثانية من console.anthropic.com وضعه في الإعدادات.');
    if (res.status === 400 && /credit|balance|billing/i.test(msg)) throw new Error('الرصيد انتهى. أضف رصيدًا من console.anthropic.com ← Billing.');
    if (res.status === 429) throw new Error('طلبات كثيرة في وقت قصير. انتظر دقيقة ثم حاول.');
    if (res.status === 529 || res.status >= 500) throw new Error('الخدمة مزدحمة الآن. حاول بعد دقائق.');
    throw new Error('حدث خطأ (' + res.status + '): ' + msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '', usage = {}, stop = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
      if (ev.type === 'message_start') Object.assign(usage, ev.message?.usage || {});
      else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') { text += ev.delta.text; onText?.(text); }
      else if (ev.type === 'message_delta') { Object.assign(usage, ev.usage || {}); stop = ev.delta?.stop_reason || stop; }
      else if (ev.type === 'error') throw new Error('انقطع الرد: ' + (ev.error?.message || ''));
    }
  }
  const usd = addSpend(model, usage);
  return { text, usage, usd, stop, model };
}

function parseJSON(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no json');
  return JSON.parse(text.slice(a, b + 1));
}
async function getJSON(text, signal) {
  try { return parseJSON(text); }
  catch {
    // one repair attempt with the cheaper model
    const r = await callClaude({
      system: 'أنت مصلح JSON. أعد النص نفسه كائن JSON صالحًا فقط، دون تغيير أي محتوى، وأغلق ما لم يُغلق.',
      messages: [{ role: 'user', content: text }], model: 'claude-sonnet-5-5', signal,
    });
    return parseJSON(r.text);
  }
}

/* ---------- making notes ---------- */
let current = null;   // the open lesson
let controller = null;

function subjectInfo() {
  const v = $('#subject').value;
  if (v === 'other') {
    const name = $('#custom-subject').value.trim() || 'مادة أخرى';
    return { id: 'other:' + name, name, place: '', family: 'slate' };
  }
  const s = subjectById(v);
  return { ...s, family: familyOf(s) };
}

function countWords() {
  const n = $('#transcript').value.trim().split(/\s+/).filter(Boolean).length;
  $('#word-count').textContent = n ? ar(n) + ' كلمة' : '';
}
$('#transcript').addEventListener('input', countWords);
$('#file').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  $('#transcript').value = await f.text(); countWords();
  if (!$('#unit').value) $('#unit').value = f.name.replace(/\.[^.]+$/, '');
});

async function keepAwake() {
  try { return await navigator.wakeLock?.request('screen'); } catch { return null; }
}

$('#cancel').onclick = () => controller?.abort();

$('#make').onclick = async () => {
  const transcript = $('#transcript').value.trim();
  const err = $('#new-error'); err.hidden = true;
  if (!store.get('key')) { show('settings'); $('#key-status').textContent = 'ضع مفتاحك هنا أولًا ثم اضغط حفظ.'; return; }
  if (transcript.length < 200) { err.textContent = 'التفريغ قصير جدًا. الصق نص الدرس كاملًا.'; err.hidden = false; return; }
  const sub = subjectInfo();
  const unit = $('#unit').value.trim() || 'درس بتاريخ ' + new Date().toLocaleDateString('ar-SA');
  $('#make').disabled = true; $('#progress').hidden = false;
  $('#progress-text').textContent = 'جارٍ القراءة والكتابة…';
  controller = new AbortController();
  const lock = await keepAwake();
  const t0 = Date.now();
  try {
    const user = `المادة: ${sub.name}${sub.book ? ' (الكتاب: ' + sub.book + ')' : ''}${sub.place ? ' — ' + sub.place : ''}
الدرس / الوحدة: ${unit}

اكتب الملف الدراسي والخريطة الذهنية وتقرير التحقق لهذا الدرس وحده، من هذا التفريغ فقط:

<<<التفريغ
${transcript}
التفريغ>>>`;
    const r = await callClaude({
      system: window.JUND_METHOD,
      messages: [{ role: 'user', content: user }],
      signal: controller.signal,
      onText: t => {
        const words = t.split(/\s+/).length;
        const mins = Math.floor((Date.now() - t0) / 60000);
        $('#progress-text').textContent = `يكتب الآن… ${ar(words)} كلمة${mins ? ' — ' + ar(mins) + ' د' : ''}`;
      },
    });
    $('#progress-text').textContent = 'يرتّب الصفحات…';
    const notes = await getJSON(r.text, controller.signal);
    const lesson = {
      id: 'L' + Date.now(),
      subject: { id: sub.id, name: sub.name, place: sub.place || '', book: sub.book || '' },
      unit, date: new Date().toISOString(), transcript, notes,
      chat: [{ who: 'ai', text: `جاهز. كلّف نحو ${ar((r.usd * SAR).toFixed(2))} ريال.` + (r.stop === 'max_tokens' ? '\n⚠ الدرس طويل جدًا فتوقف قبل النهاية؛ قد يكون آخره ناقصًا.' : '') }],
    };
    await idb.put(lesson);
    $('#transcript').value = ''; $('#unit').value = ''; countWords();
    await openLesson(lesson);
  } catch (e) {
    err.textContent = e.name === 'AbortError' ? 'أُوقف.' : (e.message === 'no json' || e instanceof SyntaxError ? 'وصل الرد ناقصًا أو غير مرتب. حاول مرة ثانية.' : e.message);
    err.hidden = false;
  } finally {
    lock?.release?.(); controller = null;
    $('#make').disabled = false; $('#progress').hidden = true;
  }
};

/* ---------- rendering helpers ---------- */
function inline(s) {
  let h = esc(s);
  h = h.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  h = h.replace(/\[انظر:?\s*([^\]]+)\]/g, (m, t) => `<span class="xref" data-ref="${esc(t.trim())}">[انظر: ${t.trim()}]</span>`);
  h = h.replace(/✓/g, '<span class="mark-ok">✓</span>').replace(/✗/g, '<span class="mark-no">✗</span>');
  return h.replace(/\n/g, '<br>');
}
const LABELS = { def: 'تعريف', explain: 'شرح', example: 'مثال', rule: 'فائدة', warn: '⚠ تنبيه' };

function blockEl(b, cont = false) {
  const el = document.createElement('div');
  const tail = cont ? ' <small>(تابع)</small>' : '';
  const t = b.t;
  if (t === 'heading') { el.className = 'b-h'; el.innerHTML = inline(b.text) + tail; el.dataset.sec = b.text; return el; }
  if (t === 'dua') { el.className = 'b-dua'; el.innerHTML = inline(b.text); return el; }
  if (t === 'appx-h') { el.className = 'b-appx-h'; el.innerHTML = inline(b.text); return el; }
  if (['def', 'explain', 'example', 'rule', 'warn'].includes(t)) {
    el.className = 'box b-' + t;
    let lbl = b.title || LABELS[t];
    if (t === 'example') {
      if (b.verdict === 'correct') lbl = '✓ ' + lbl; else if (b.verdict === 'wrong') lbl = '✗ ' + lbl;
      if (b.illustrative) lbl += ' (توضيحي)';
    }
    el.innerHTML = `<span class="lbl">${inline(lbl)}${tail}</span><p>${inline(b.text)}</p>`;
    return el;
  }
  if (t === 'exam') { el.className = 'box b-exam'; el.innerHTML = '<p>' + inline(/★/.test(b.text) ? b.text : '★★ ' + b.text) + '</p>'; return el; }
  if (t === 'list') {
    el.className = 'b-list';
    const start = b._start || 0;
    const marks = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
    el.innerHTML = (b.title ? `<span class="lbl">${inline(b.title)}${tail}</span>` : '') +
      '<ul>' + (b.items || []).map((it, i) => `<li><span class="m">${b.ordered !== false ? (marks[start + i] || ar(start + i + 1) + '.') : '•'}</span><span>${inline(it)}</span></li>`).join('') + '</ul>';
    return el;
  }
  if (t === 'table') {
    el.className = 'b-table';
    el.innerHTML = (b.title ? `<span class="lbl">${inline(b.title)}${tail}</span>` : '') +
      `<table><thead><tr>${(b.headers || []).map(h => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${(b.rows || []).map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    return el;
  }
  if (t === 'flow') {
    el.className = 'b-flow';
    const steps = b.steps || [];
    el.innerHTML = (b.title ? `<span class="lbl">${inline(b.title)}${tail}</span>` : '') +
      '<ol>' + steps.map((s, i) => `<li>${inline(s)}</li>` + (i < steps.length - 1 ? '<li class="arrow">↓</li>' : '')).join('') + '</ol>';
    return el;
  }
  if (t === 'verse' || t === 'poem') {
    el.className = 'b-verse';
    // a poem's two halves (separated by …) each get their own line
    el.innerHTML = inline(String(b.text || '').replace(/\s*(\.\.\.|…)\s*/g, '\n')) + (b.ref || b.source ? `<span class="ref">${inline(b.ref || b.source)}</span>` : '');
    return el;
  }
  if (t === 'quote') { el.className = 'b-quote'; el.innerHTML = '«' + inline(String(b.text).replace(/^«|»$/g, '')) + '»' + (b.by ? ` <span class="by">— ${inline(b.by)}</span>` : ''); return el; }
  el.className = 'b-text'; el.innerHTML = '<p>' + inline(b.text || '') + '</p>';
  return el;
}

// Ways to cut a too-long block into two pieces.
function splitParts(b) {
  if (b.t === 'list') return { parts: b.items || [], make: (p, off) => ({ ...b, items: p, _start: (b._start || 0) + off }) };
  if (b.t === 'table') return { parts: b.rows || [], make: p => ({ ...b, rows: p }) };
  if (b.t === 'flow') return { parts: b.steps || [], make: p => ({ ...b, steps: p }) };
  if (typeof b.text === 'string' && !['heading', 'dua', 'appx-h'].includes(b.t)) {
    const parts = b.text.split(/(?<=[.؟!؛:])\s+|\n+/).filter(Boolean);
    return { parts, make: p => ({ ...b, text: p.join(' ') }) };
  }
  return null;
}

/* ---------- A4 pagination ---------- */
function makePage(meta, kind) {
  const p = document.createElement('div');
  p.className = 'page';
  Object.entries(meta.palette).forEach(([k, v]) => p.style.setProperty(k, v));
  p.innerHTML = `
    <div class="pg-head">
      <div><div class="t">${inline(meta.title)}</div>${meta.subtitle ? `<div class="s">${inline(meta.subtitle)}</div>` : ''}</div>
      <div class="n"></div>
    </div>
    ${kind === 'map' ? '<div class="pg-single"></div>' : '<div class="pg-body"><div class="col"></div><div class="col"></div></div>'}
    <div class="pg-foot"><span>${esc(meta.subject)}${meta.place ? ' — ' + esc(meta.place) : ''}</span><span>${esc(meta.unit)}${kind === 'map' ? ' — الخريطة الذهنية' : ''}</span></div>`;
  return p;
}
const overflows = el => el.scrollHeight > el.clientHeight + 1;

function flattenNotes(n) {
  const items = [];
  if (n.opening_dua) items.push({ t: 'dua', text: n.opening_dua });
  for (const s of n.sections || []) {
    items.push({ t: 'heading', text: s.heading });
    for (const b of s.blocks || []) items.push(b);
  }
  if (n.mnemonics?.length) {
    items.push({ t: 'heading', text: 'طرق للحفظ' });
    items.push({ t: 'list', ordered: false, items: n.mnemonics });
  }
  const a = n.appendix || {};
  const hasAppx = a.rules?.length || a.poems?.length || a.vocab?.length || a.questions?.length || a.admin;
  if (hasAppx) {
    items.push({ t: 'heading', text: 'الملحق', _newPage: true });
    if (a.rules?.length) { items.push({ t: 'appx-h', text: 'القواعد' }); items.push({ t: 'list', ordered: true, items: a.rules }); }
    if (a.poems?.length) { items.push({ t: 'appx-h', text: 'الأبيات والمنظومات' }); a.poems.forEach(p => items.push({ t: 'poem', text: p.text || p, source: p.source })); }
    if (a.vocab?.length) { items.push({ t: 'appx-h', text: 'المفردات' }); items.push({ t: 'table', headers: ['الكلمة', 'معناها'], rows: a.vocab.map(v => [v.term, v.meaning]) }); }
    if (a.questions?.length) { items.push({ t: 'appx-h', text: 'أسئلة' }); items.push({ t: 'list', ordered: true, items: a.questions }); }
    if (a.admin) items.push({ t: 'text', text: '◇ ' + a.admin });
  }
  if (n.closing_duas?.length) n.closing_duas.forEach(d => items.push({ t: 'dua', text: d }));
  return items;
}

function paginateNotes(lesson, meta) {
  const host = $('#measure'); host.innerHTML = '';
  const pages = [];
  let page, cols, ci;
  const newPage = () => { page = makePage(meta, 'notes'); host.appendChild(page); pages.push(page); cols = $$('.col', page); ci = 0; };
  const nextCol = () => {
    const prev = cols[ci];
    if (ci === 0) ci = 1; else newPage();
    // keep a heading with what follows it
    const last = prev.lastElementChild;
    if (last && last.classList.contains('b-h') && prev.children.length > 1) cols[ci].appendChild(last);
  };
  const colEmpty = () => cols[ci].children.length === 0;

  newPage();
  const queue = flattenNotes(lesson.notes);
  for (let qi = 0; qi < queue.length; qi++) {
    let b = queue[qi], cont = false;
    if (b._newPage && !(ci === 0 && colEmpty())) newPage();
    for (let guard = 0; guard < 60; guard++) {
      const col = cols[ci];
      const el = blockEl(b, cont);
      col.appendChild(el);
      if (!overflows(col)) break;
      col.removeChild(el);
      const sp = splitParts(b);
      const roomy = col.clientHeight - col.scrollHeight;
      // try to fit the first part of a long block here
      if (sp && sp.parts.length > 1 && (colEmpty() || roomy > -1)) {
        let fit = 0;
        for (let k = sp.parts.length - 1; k >= 1; k--) {
          const trial = blockEl(sp.make(sp.parts.slice(0, k), 0), cont);
          col.appendChild(trial);
          const ok = !overflows(col);
          col.removeChild(trial);
          if (ok) { fit = k; break; }
        }
        const textLike = typeof b.text === 'string';
        const okSplit = colEmpty() || (textLike ? fit >= 1 : fit >= 2 && sp.parts.length - fit >= 2);
        if (fit >= 1 && okSplit) {
          col.appendChild(blockEl(sp.make(sp.parts.slice(0, fit), 0), cont));
          b = sp.make(sp.parts.slice(fit), fit); cont = true;
          nextCol(); continue;
        }
      }
      if (colEmpty()) { // nothing fits even alone: shrink it a little
        el.style.fontSize = '0.86em'; col.appendChild(el); break;
      }
      nextCol();
    }
  }
  // drop a trailing empty page
  if (pages.length > 1 && $$('.col', pages.at(-1)).every(c => !c.children.length)) pages.pop().remove();
  finishPages(pages);
  return pages;
}

function finishPages(pages) {
  const total = pages.length;
  pages.forEach((p, i) => { $('.n', p).textContent = `صفحة ${ar(i + 1)} / ${ar(total)}`; });
  // cross references → page numbers
  const secPage = [];
  pages.forEach((p, i) => $$('.b-h', p).forEach(h => secPage.push([norm(h.dataset.sec), i + 1])));
  pages.forEach(p => $$('.xref', p).forEach(x => {
    const want = norm(x.dataset.ref);
    const hit = secPage.find(([s]) => s && (s.includes(want) || want.includes(s)));
    if (hit) x.textContent = `[انظر ص ${ar(hit[1])}]`;
  }));
}
const norm = s => String(s || '').replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/\s+/g, ' ').trim();

/* ---------- mind map pages ---------- */
function treeHTML(children) {
  if (!children?.length) return '';
  return '<ul>' + children.map(c => `<li><span class="mm-node">${c.mark ? `<span class="m">${esc(c.mark)}</span>` : ''}${inline(c.label)}</span>${treeHTML(c.children)}</li>`).join('') + '</ul>';
}
function mapEl(m, cont) {
  const wrap = document.createElement('div');
  wrap.className = 'mm';
  const br = m.branches || [];
  // branches go on both sides of the centre: right side first, then left
  const half = Math.ceil(br.length / 2);
  const side = list => list.map(b => `
      <div class="mm-branch"><div class="mm-cloud">${inline(b.label)}</div>
      ${b.children?.length ? `<div class="mm-tree">${treeHTML(b.children)}</div>` : ''}</div>`).join('');
  wrap.innerHTML = `<svg class="links" aria-hidden="true"></svg>
    <div class="mm-side mm-right">${side(br.slice(0, half))}</div>
    <div class="mm-center">${inline(m.center)}${cont ? '<br><small>(تابع)</small>' : ''}</div>
    <div class="mm-side mm-left">${side(br.slice(half))}</div>`;
  return wrap;
}
function drawLinks(mm) {
  const svg = $('svg.links', mm), box = mm.getBoundingClientRect();
  const c = $('.mm-center', mm).getBoundingClientRect();
  const cy = c.top + c.height / 2 - box.top;
  const stroke = getComputedStyle(mm).getPropertyValue('--sub-def') || '#555';
  const path = (x1, x2, y) => {
    const mx = (x1 + x2) / 2;
    return `<path d="M${x1} ${cy} C ${mx} ${cy}, ${mx} ${y}, ${x2} ${y}" fill="none" stroke="${stroke}" stroke-width="1.3" stroke-linecap="round"/>`;
  };
  const right = $$('.mm-right .mm-cloud', mm).map(cl => { const r = cl.getBoundingClientRect(); return path(c.right - box.left, r.left - box.left, r.top + r.height / 2 - box.top); });
  const left = $$('.mm-left .mm-cloud', mm).map(cl => { const r = cl.getBoundingClientRect(); return path(c.left - box.left, r.right - box.left, r.top + r.height / 2 - box.top); });
  svg.innerHTML = right.concat(left).join('');
}
function paginateMap(lesson, meta) {
  const host = $('#measure'); host.innerHTML = '';
  const pages = [];
  const place = (m, cont) => {
    const page = makePage(meta, 'map'); host.appendChild(page);
    const area = $('.pg-single', page);
    const el = mapEl(m, cont); area.appendChild(el); drawLinks(el);
    const h = el.scrollHeight, H = area.clientHeight;
    if (h <= H) { pages.push(page); return true; }
    if (h * 0.8 <= H) { el.style.zoom = String(Math.max(0.8, (H - 4) / h)); pages.push(page); return true; }
    page.remove(); return false;
  };
  // try to stack this aspect under the previous one on the same page
  const stack = m => {
    const page = pages.at(-1); if (!page) return false;
    const area = $('.pg-single', page);
    if ($$('.mm', area).some(x => x.style.zoom)) return false;
    const el = mapEl(m, false); el.classList.add('mm-stacked');
    area.appendChild(el); drawLinks(el);
    if (!overflows(area)) return true;
    el.remove(); return false;
  };
  for (const m of lesson.notes.mindmap || []) {
    const br = m.branches || [];
    if (stack(m) || place(m, false)) continue;
    // too big: spread the branches over several pages
    let start = 0, first = true;
    while (start < br.length) {
      let n = br.length - start;
      while (n > 1 && !place({ ...m, branches: br.slice(start, start + n) }, !first)) n--;
      if (n === 1 && !place({ ...m, branches: br.slice(start, start + 1) }, !first)) {
        // a single branch still too tall: shrink harder
        const page = makePage(meta, 'map'); host.appendChild(page);
        const el = mapEl({ ...m, branches: br.slice(start, start + n) }, !first);
        $('.pg-single', page).appendChild(el); drawLinks(el);
        el.style.zoom = String(Math.max(0.55, ($('.pg-single', page).clientHeight - 4) / el.scrollHeight));
        pages.push(page);
      }
      start += n; first = false;
    }
  }
  finishPages(pages);
  return pages;
}

/* ---------- open a lesson ---------- */
async function openLesson(lesson) {
  current = lesson;
  const n = lesson.notes;
  const sub = subjectById(lesson.subject.id);
  const fam = sub ? familyOf(sub) : 'slate';
  const meta = {
    title: n.title || lesson.unit, subtitle: n.subtitle || '',
    subject: lesson.subject.name, place: lesson.subject.place, unit: lesson.unit,
    palette: window.paletteFor(fam),
  };
  $('#result-title').textContent = meta.title;
  $('#result-meta').textContent = `${lesson.subject.name}${lesson.subject.place ? ' — ' + lesson.subject.place : ''} · ${lesson.unit}`;
  show('result');
  try { await document.fonts.ready; await document.fonts.load('16px Amiri'); await document.fonts.load('16px "Amiri Quran"'); } catch {}
  const notesPages = paginateNotes(lesson, meta);
  $('#pages-notes').replaceChildren(...notesPages);
  const mapPages = paginateMap(lesson, meta);
  $('#pages-map').replaceChildren(...mapPages);
  $('#measure').innerHTML = '';
  renderReport(n.report || {});
  renderChat();
  selectTab(currentTab);
  fitPages();
}

function renderReport(r) {
  const sec = (t, arr) => arr?.length ? `<h3>${t}</h3><ul>${arr.map(x => `<li>${inline(x)}</li>`).join('')}</ul>` : '';
  $('#frame-report').innerHTML =
    sec('استنتجته من نص غير واضح', r.inferred) +
    sec('قد يكون خطأ — راجعه', r.maybe_wrong) +
    sec('أضفته من عندي (أمثلة توضيحية وطرق حفظ)', r.added) +
    sec('تركته عمدًا', r.left_out) +
    (current?.notes?.mawaiz?.length ? sec('مواعظ محفوظة لملف آخر السنة', current.notes.mawaiz) : '') || '<p>لا ملاحظات.</p>';
}

let currentTab = 'notes';
function selectTab(name) {
  currentTab = name;
  $$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  $('#frame-notes').hidden = name !== 'notes';
  $('#frame-map').hidden = name !== 'map';
  $('#frame-report').hidden = name !== 'report';
  $('#save-pdf').hidden = name === 'report';
  $('#pdf-tip').hidden = name === 'report';
  fitPages();
}
$$('.tab').forEach(t => t.onclick = () => selectTab(t.dataset.tab));

function fitPages() {
  for (const id of ['notes', 'map']) {
    const frame = $('#frame-' + id), pages = $('#pages-' + id);
    if (frame.hidden || !pages.firstElementChild) continue;
    const W = frame.clientWidth, pw = pages.firstElementChild.offsetWidth;
    const k = Math.min(1, W / pw);
    pages.style.width = pw + 'px';
    pages.style.transform = `scale(${k})`;
    frame.style.height = (pages.offsetHeight * k) + 'px';
  }
}
addEventListener('resize', () => requestAnimationFrame(fitPages));

$('#save-pdf').onclick = () => {
  $$('.pages-frame').forEach(f => f.classList.remove('print-me'));
  $('#frame-' + currentTab).classList.add('print-me');
  const old = document.title;
  document.title = `${current.subject.name} - ${current.unit}${currentTab === 'map' ? ' - خريطة ذهنية' : ''}`;
  setTimeout(() => { window.print(); setTimeout(() => { document.title = old; }, 1000); }, 50);
};

/* ---------- chat: edits and questions ---------- */
function renderChat() {
  $('#chat-log').innerHTML = (current.chat || []).map(m => `<div class="msg ${m.who}">${esc(m.text)}</div>`).join('');
}
$('#chat-send').onclick = async () => {
  const ask = $('#chat-text').value.trim();
  if (!ask || !current) return;
  current.chat.push({ who: 'me', text: ask }); renderChat();
  $('#chat-text').value = '';
  $('#chat-send').disabled = true; $('#chat-progress').hidden = false;
  $('#chat-progress-text').textContent = 'جارٍ العمل…';
  const lock = await keepAwake();
  try {
    const history = current.chat.slice(-9, -1).map(m => (m.who === 'me' ? 'الطالب: ' : 'أنت: ') + m.text).join('\n');
    const user = `المادة: ${current.subject.name} — ${current.unit}

<<<التفريغ الأصلي
${current.transcript}
التفريغ الأصلي>>>

<<<الملاحظات الحالية
${JSON.stringify(current.notes)}
الملاحظات الحالية>>>

${history ? 'ما سبق في المحادثة:\n' + history + '\n\n' : ''}طلب الطالب الآن: ${ask}`;
    const r = await callClaude({
      system: window.JUND_METHOD + '\n\n' + window.JUND_EDIT_RULES,
      messages: [{ role: 'user', content: user }],
      onText: t => { $('#chat-progress-text').textContent = `جارٍ العمل… ${ar(t.split(/\s+/).length)} كلمة`; },
    });
    const out = await getJSON(r.text);
    const cost = ` (${ar((r.usd * SAR).toFixed(2))} ريال)`;
    if (out.no_change || !out.sections) {
      current.chat.push({ who: 'ai', text: (out.reply || 'تم.') + cost });
    } else {
      const { reply, ...notes } = out;
      current.notes = notes;
      current.chat.push({ who: 'ai', text: (reply || 'عدّلته.') + cost });
    }
    await idb.put(current);
    await openLesson(current);
    $('.chat').scrollIntoView({ block: 'end' });
  } catch (e) {
    current.chat.push({ who: 'ai', text: '✗ ' + (e instanceof SyntaxError || e.message === 'no json' ? 'وصل الرد غير مرتب. أعد الطلب.' : e.message) });
    renderChat();
  } finally {
    lock?.release?.();
    $('#chat-send').disabled = false; $('#chat-progress').hidden = true;
  }
};

/* ---------- library ---------- */
async function renderLibrary() {
  const list = $('#library-list');
  let all = [];
  try { all = await idb.all(); } catch {}
  if (!all.length) { list.innerHTML = '<p class="muted">لا توجد دروس محفوظة بعد. أول درس تصنعه سيظهر هنا.</p>'; return; }
  all.sort((a, b) => b.date.localeCompare(a.date));
  const groups = {};
  for (const l of all) (groups[l.subject.name] ??= []).push(l);
  list.innerHTML = Object.entries(groups).map(([name, ls]) => `
    <div class="lib-group"><h2>${esc(name)}</h2>
    ${ls.map(l => `<div class="lib-item">
      <button type="button" class="open" data-open="${l.id}">${esc(l.notes?.title || l.unit)}<small>${esc(l.unit)} · ${new Date(l.date).toLocaleDateString('ar-SA')}</small></button>
      <button type="button" class="ghost danger" data-del="${l.id}">حذف</button>
    </div>`).join('')}</div>`).join('');
  $$('[data-open]', list).forEach(b => b.onclick = async () => openLesson(await idb.get(b.dataset.open)));
  $$('[data-del]', list).forEach(b => b.onclick = async () => {
    if (b.dataset.sure) { await idb.del(b.dataset.del); if (current?.id === b.dataset.del) current = null; renderLibrary(); }
    else { b.dataset.sure = '1'; b.textContent = 'اضغط مرة ثانية للتأكيد'; }
  });
}

/* ---------- text shared from another app (Samsung recorder → Share) ---------- */
async function receiveShared() {
  const u = new URL(location.href);
  let text = u.searchParams.get('text') || '';
  const title = u.searchParams.get('title') || '';
  if (u.searchParams.has('shared') && 'caches' in window) {
    try {
      const c = await caches.open('jn-share');
      const r = await c.match('shared-text');
      if (r) { text = await r.text(); await c.delete('shared-text'); }
      const t = await c.match('shared-title');
      if (t) { if (!$('#unit').value) $('#unit').value = await t.text(); await c.delete('shared-title'); }
    } catch {}
  }
  if (text) {
    $('#transcript').value = text; countWords();
    if (title && !$('#unit').value) $('#unit').value = title;
  }
  if (u.search) history.replaceState(null, '', location.pathname);
}

/* ---------- start ---------- */
fillSubjects();
initSettings();
receiveShared();
show('new');
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// for testing only
window.__jn = { openLesson, paginateNotes, idb };
})();
