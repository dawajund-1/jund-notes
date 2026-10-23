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

/* ---------- cloud copy in the private GitHub storage ---------- */
const cloud = (() => {
  const repo = () => store.get('ghRepo', 'dawajund-1/jund-notes-data');
  const token = () => store.get('ghKey', '');
  const shas = () => store.get('ghShas', {});
  const setSha = (id, sha) => { const m = shas(); if (sha) m[id] = sha; else delete m[id]; store.set('ghShas', m); };
  const b64 = s => { const b = new TextEncoder().encode(s); let x = ''; for (let i = 0; i < b.length; i += 0x8000) x += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(x); };
  const api = async (path, opts = {}) => {
    const r = await fetch(`https://api.github.com/repos/${repo()}${path}`, {
      ...opts,
      headers: { 'Authorization': 'Bearer ' + token(), 'Accept': opts.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    return r;
  };
  let status = '';
  const setStatus = t => { status = t; const el = $('#cloud-status'); if (el) el.textContent = t; };
  const queue = []; let busy = false;
  async function run() {
    if (busy) return; busy = true;
    while (queue.length) {
      const job = queue.shift();
      try { await job(); } catch { setStatus('⚠ لم يُحفظ في السحابة الآن؛ سيُعاد عند فتح التطبيق مع الإنترنت.'); store.set('ghDirty', true); }
    }
    busy = false;
  }
  async function putLesson(l) {
    const path = `/contents/lessons/${l.id}.json`;
    let sha = shas()[l.id];
    const body = () => JSON.stringify({ message: `حفظ: ${l.subject?.name || ''} — ${l.unit || l.id}`, content: b64(JSON.stringify(l)), ...(sha ? { sha } : {}) });
    let r = await api(path, { method: 'PUT', body: body() });
    if (r.status === 409 || r.status === 422) { // our copy of the version was old: fetch the current one and retry once
      const g = await api(path); if (g.ok) { sha = (await g.json()).sha; r = await api(path, { method: 'PUT', body: body() }); }
    }
    if (!r.ok) throw new Error(r.status);
    setSha(l.id, (await r.json()).content.sha);
    setStatus('☁ محفوظ في مخزنك الخاص على GitHub.');
  }
  return {
    on: () => !!token(),
    push(l) { if (!token()) return; queue.push(() => putLesson(l)); run(); },
    remove(id) {
      if (!token()) return;
      queue.push(async () => {
        const path = `/contents/lessons/${id}.json`;
        let sha = shas()[id];
        if (!sha) { const g = await api(path); if (!g.ok) return; sha = (await g.json()).sha; }
        await api(path, { method: 'DELETE', body: JSON.stringify({ message: 'حذف درس', sha }) });
        setSha(id, null);
      }); run();
    },
    // bring down lessons that are in the cloud but not on this phone (or changed elsewhere)
    async pull() {
      if (!token()) return 0;
      const r = await api('/contents/lessons');
      if (r.status === 404) return 0;
      if (!r.ok) throw new Error(r.status);
      const files = (await r.json()).filter(f => f.name.endsWith('.json'));
      const known = shas(); let added = 0;
      for (const f of files) {
        const id = f.name.replace(/\.json$/, '');
        if (known[id] === f.sha) continue;
        const local = await idb.get(id).catch(() => null);
        if (local && !known[id]) { setSha(id, f.sha); continue; }
        const g = await api('/contents/lessons/' + f.name, { raw: true });
        if (!g.ok) continue;
        await idb.put(JSON.parse(await g.text()));
        setSha(id, f.sha); added++;
      }
      // anything saved while offline goes up now
      if (store.get('ghDirty')) {
        store.set('ghDirty', false);
        const all = await idb.all();
        const k = shas();
        all.filter(l => !k[l.id]).forEach(l => cloud.push(l));
      }
      setStatus('☁ متزامن مع مخزنك الخاص على GitHub.');
      return added;
    },
    async test() {
      const r = await api('');
      if (r.status === 401) throw new Error('المفتاح غير صحيح.');
      if (r.status === 404) throw new Error('لم أجد المخزن jund-notes-data، أو المفتاح لا يملك صلاحية عليه.');
      if (!r.ok) throw new Error('خطأ ' + r.status);
      return true;
    },
    status: () => status,
  };
})();
async function saveLesson(l) { await idb.put(l); cloud.push(l); }
async function removeLesson(id) { await idb.del(id); cloud.remove(id); }

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
  if (name === 'settings') { renderPaletteSettings(); renderSpend(); window.__syncEngine?.(); }
  if (name === 'new') $('#key-missing').hidden = engineKind() === 'phone' || !!store.get('key');
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
  // which AI
  const syncEngine = async () => {
    const phone = engineKind() === 'phone';
    $('#engine').value = engineKind(); $('#phone-size').value = phoneSize();
    $('#phone-box').hidden = !phone; $('#claude-box').hidden = phone;
    if (phone) {
      const sup = await window.LocalAI.support();
      if (!sup.ok) { $('#phone-status').textContent = '✗ ' + sup.why; return; }
      const have = await window.LocalAI.isDownloaded(phoneSize());
      $('#phone-status').textContent = have ? '✓ الذكاء مُنزّل على جوالك ويعمل بلا إنترنت.' : `لم يُنزّل بعد (${window.LocalAI.MODELS[phoneSize()].size}). يُفضّل التنزيل على الواي فاي.`;
      $('#phone-download').hidden = have; $('#phone-remove').hidden = !have;
    }
  };
  $('#engine').onchange = () => { store.set('engine', $('#engine').value); syncEngine(); };
  $('#phone-size').onchange = () => { store.set('phoneSize', $('#phone-size').value); syncEngine(); };
  $('#phone-download').onclick = async () => {
    const st = $('#phone-status'); $('#phone-download').disabled = true;
    try {
      $('#phone-bar-wrap').hidden = false;
      await window.LocalAI.load(phoneSize(), p => { st.textContent = progressText(p); setBar('#phone-bar-wrap', '#phone-bar', p.progress); });
      $('#phone-bar-wrap').hidden = true;
      st.textContent = '✓ نُزّل الذكاء. صار يعمل على جوالك بلا إنترنت.';
    } catch (e) { st.textContent = '✗ ' + errText(e); $('#phone-bar-wrap').hidden = true; }
    $('#phone-download').disabled = false; syncEngine();
  };
  $('#phone-remove').onclick = async () => {
    const b = $('#phone-remove');
    if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'اضغط مرة ثانية لحذفه من الجوال'; return; }
    delete b.dataset.sure; b.textContent = 'احذف الذكاء من الجوال';
    try { await window.LocalAI.remove(phoneSize()); } catch {}
    syncEngine();
  };
  $('#phone-test').onclick = async () => {
    const out = $('#phone-test-out'); const b = $('#phone-test'); b.disabled = true;
    try {
      const sup = await window.LocalAI.support();
      out.textContent = sup.ok ? `✓ الجوال يدعم تشغيل الذكاء${sup.f16 ? '' : ' (وضع أبطأ قليلًا)'}.\nجارٍ التشغيل…` : '✗ ' + sup.why;
      if (!sup.ok) return;
      $('#phone-bar-wrap').hidden = false;
      const t0 = Date.now(); let t1 = 0;
      const r = await window.LocalAI.generate({
        size: phoneSize(), maxTokens: 200,
        system: 'أجب بكائن JSON فقط.',
        user: 'اكتب {"تعريف":"..."} فيه تعريف الحديث الصحيح في سطر واحد.',
        onProgress: p => { out.textContent = progressText(p); setBar('#phone-bar-wrap', '#phone-bar', p.progress); },
        onText: t => { t1 ||= Date.now(); out.textContent = 'يكتب: ' + t; },
      });
      const secs = ((Date.now() - (t1 || t0)) / 1000).toFixed(1);
      const words = r.text.split(/\s+/).length;
      out.textContent = `✓ الذكاء يعمل على جوالك.\nالرد: ${r.text}\nالسرعة: نحو ${ar(Math.round(words / Math.max(0.5, secs) * 60))} كلمة في الدقيقة.`;
    } catch (e) { out.textContent = '✗ ' + errText(e); }
    finally { b.disabled = false; $('#phone-bar-wrap').hidden = true; syncEngine(); }
  };
  window.__syncEngine = syncEngine;
  $('#gh-key').value = store.get('ghKey', '');
  $('#save-gh').onclick = async () => {
    store.set('ghKey', $('#gh-key').value.trim());
    const st = $('#gh-status');
    if (!store.get('ghKey')) { st.textContent = 'أُوقف الحفظ في السحابة.'; return; }
    st.textContent = 'جارٍ التجربة…';
    try {
      await cloud.test();
      st.textContent = '✓ متصل. جارٍ رفع دروسك وجلب ما في السحابة…';
      const n = await cloud.pull();
      const all = await idb.all(); const k = store.get('ghShas', {});
      all.filter(l => !k[l.id]).forEach(l => cloud.push(l));
      st.textContent = `✓ متصل بمخزنك الخاص.${n ? ' جُلب ' + ar(n) + ' درس.' : ''}`;
    } catch (e) { st.textContent = '✗ ' + e.message; }
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

/* ---------- progress bar and readable errors ---------- */
function setBar(wrapSel, barSel, frac) {
  const w = $(wrapSel), b = $(barSel); if (!w || !b) return;
  if (frac == null || !isFinite(frac)) { w.classList.add('busy'); return; }
  w.classList.remove('busy'); b.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
}
function errText(e) {
  if (!e) return 'حدث خطأ غير معروف.';
  if (e.name === 'AbortError') return 'أُوقف.';
  let raw = (e.message || (typeof e === 'string' ? e : '') || e.name || '').toString();
  if (!raw) { try { raw = JSON.stringify(e); } catch { raw = String(e); } if (raw === '{}' || raw === '[object Object]') raw = ''; }
  if (e.message === 'no json' || e instanceof SyntaxError) return 'وصل الرد ناقصًا أو غير مرتب. حاول مرة ثانية.';
  if (/out of memory|OOM|allocate|device (was )?lost|DXGI|GPUDevice/i.test(raw)) return 'ذاكرة الجوال لم تكفِ للذكاء الآن. أغلق التطبيقات الأخرى، أو اختر الحجم «سريع»، ثم حاول.\n(' + raw.slice(0, 160) + ')';
  if (/quota|storage|space/i.test(raw)) return 'لا توجد مساحة كافية على الجوال لتنزيل الذكاء. فرّغ مساحة ثم حاول.\n(' + raw.slice(0, 160) + ')';
  if (/fetch|network|Failed to fetch|NetworkError|load failed/i.test(raw)) return 'انقطع الإنترنت أثناء تنزيل الذكاء. اتصل بالواي فاي ثم حاول؛ يكمل من حيث توقف.\n(' + raw.slice(0, 160) + ')';
  return raw ? 'حدث خطأ: ' + raw.slice(0, 300) : 'حدث خطأ غير معروف. أرسل لي صورة من هذه الرسالة.';
}

/* ---------- which AI writes the notes ---------- */
const engineKind = () => store.get('engine', 'phone');          // 'phone' (free, on this phone) or 'claude' (own key)
const phoneSize = () => store.get('phoneSize', 'fast');
function progressText(p) {
  const pct = Math.round((p.progress || 0) * 100);
  return /fetch|download|param|cache/i.test(p.text || '') && pct < 100
    ? `يُنزّل الذكاء إلى جوالك (مرة واحدة فقط)… ${ar(pct)}٪`
    : `يجهّز الذكاء… ${ar(pct)}٪`;
}

// cut a long text into parts the phone AI can read at once, on sentence ends
function splitText(text, maxWords = 1100) {
  const units = text.split(/(?<=[.؟!؛\n])\s+/);
  const parts = []; let cur = [], n = 0;
  for (const u of units) {
    const w = u.split(/\s+/).filter(Boolean).length;
    if (n + w > maxWords && cur.length) { parts.push(cur.join(' ')); cur = []; n = 0; }
    if (w > maxWords) { // one very long run-on piece: cut by words
      const ws = u.split(/\s+/);
      for (let i = 0; i < ws.length; i += maxWords) parts.push(ws.slice(i, i + maxWords).join(' '));
      continue;
    }
    cur.push(u); n += w;
  }
  if (cur.length) parts.push(cur.join(' '));
  return parts;
}

function mergeParts(list) {
  const out = { title: '', subtitle: '', opening_dua: '', sections: [], mindmap: [], mnemonics: [],
    appendix: { rules: [], poems: [], vocab: [], questions: [], admin: '' }, closing_duas: [], mawaiz: [],
    report: { inferred: [], left_out: [], maybe_wrong: [], added: [] } };
  const nk = x => norm(x).replace(/^ال/, '');
  for (const r of list) {
    out.title ||= r.title || ''; out.subtitle ||= r.subtitle || ''; out.opening_dua ||= r.opening_dua || '';
    for (const sec of r.sections || []) {
      const same = out.sections.find(x => nk(x.heading) === nk(sec.heading));
      if (same) same.blocks.push(...(sec.blocks || [])); else out.sections.push({ heading: sec.heading || '', blocks: sec.blocks || [] });
    }
    for (const m of r.mindmap || []) {
      const same = out.mindmap.find(x => nk(x.center) === nk(m.center));
      if (same) same.branches.push(...(m.branches || [])); else out.mindmap.push({ center: m.center || '', branches: m.branches || [] });
    }
    out.mnemonics.push(...(r.mnemonics || []));
    const a = r.appendix || {};
    for (const k of ['rules', 'poems', 'vocab', 'questions']) out.appendix[k].push(...(a[k] || []).filter(x => x && (typeof x === 'string' ? x : (x.term || x.text))));
    if (a.admin) out.appendix.admin = [out.appendix.admin, a.admin].filter(Boolean).join(' · ');
    out.closing_duas.push(...(r.closing_duas || []));
    out.mawaiz.push(...(r.mawaiz || []));
    for (const k of Object.keys(out.report)) out.report[k].push(...(r.report?.[k] || []));
  }
  // a map with too many branches is split into several aspects of 4
  out.mindmap = out.mindmap.flatMap(m => {
    const br = m.branches.filter(b => b && b.label);
    if (br.length <= 6) return [{ ...m, branches: br }];
    const parts = []; for (let i = 0; i < br.length; i += 4) parts.push({ center: m.center, branches: br.slice(i, i + 4) });
    return parts;
  });
  return out;
}

async function writeOnPhone({ text, unit, sub, src }, onStatus) {
  const parts = splitText(text);
  const results = []; let cut = false, partial = '';
  const started = Date.now(); let firstPartStart = 0;
  for (let i = 0; i < parts.length; i++) {
    const t0 = Date.now(); if (i === 0) firstPartStart = t0;
    const pre = parts.length > 1 ? `الجزء ${ar(i + 1)} من ${ar(parts.length)}: ` : '';
    const expect = Math.max(250, parts[i].split(/\s+/).length * 0.55);
    const eta = () => {
      if (i === 0) return '';
      const per = (t0 - firstPartStart) / i, left = Math.round(per * (parts.length - i) / 60000);
      return left >= 1 ? `بقي نحو ${ar(left)} دقيقة` : 'قارب الانتهاء';
    };
    const before = results.flatMap(r => (r.sections || []).map(s => s.heading)).filter(Boolean);
    const user = `المادة: ${sub.name}${sub.book ? ' (الكتاب: ' + sub.book + ')' : ''}
الدرس: ${unit}
نوع النص: ${src.name}${parts.length > 1 ? `\nهذا الجزء ${i + 1} من ${parts.length} من الدرس نفسه.` : ''}${before.length ? '\nأقسام كُتبت من الأجزاء السابقة (لا تكررها، وإن أكملت أحدها فاستعمل العنوان نفسه): ' + before.join('، ') : ''}

${src.ask}

<<<النص
${parts[i]}
النص>>>`;
    let r;
    try {
      r = await window.LocalAI.generate({
        size: phoneSize(), system: window.JUND_METHOD_SMALL, user, signal: controller.signal,
        onProgress: p => onStatus(pre + progressText(p), p.progress ?? null, 'download'),
        onText: t => {
          const w = t.split(/\s+/).length, s = Math.floor((Date.now() - t0) / 1000);
          onStatus(`${pre}يكتب على جوالك… ${ar(w)} كلمة — ${ar(Math.floor(s / 60))}:${ar(String(s % 60).padStart(2, '0'))}`,
            (i + Math.min(0.95, w / expect)) / parts.length, 'write', eta());
        },
      });
    } catch (e) {
      if (e.name === 'AbortError' || !results.length) throw e;
      partial = `⚠ توقف عند الجزء ${ar(i + 1)} من ${ar(parts.length)} (${errText(e).split('\n')[0]}). حُفظ ما اكتمل؛ اصنع الصفحات الباقية وحدها.`;
      break;
    }
    if (r.stop === 'max_tokens') cut = true;
    try { results.push(parseJSON(r.text)); }
    catch { results.push({ report: { maybe_wrong: [`تعذّرت قراءة الجزء ${ar(i + 1)}؛ أعد صنعه إن كان ناقصًا.`] } }); }
  }
  return { notes: mergeParts(results), cut, partial };
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

// several files at once: each becomes its own lesson
let pending = [];
const pdfSlice = p => p.pages.slice(p.from - 1, p.to).join('\n\n').trim();
function renderPending() {
  const box = $('#pending');
  box.hidden = !pending.length;
  $('#transcript').disabled = pending.length > 0;
  $('#unit-wrap').hidden = pending.length > 1;
  const one = pending.length === 1 ? pending[0] : null;
  box.innerHTML = pending.length ? `<b>${pending.length > 1 ? 'سيُصنع ' + ar(pending.length) + ' دروس، كل ملف في ملف وحده:' : 'الملف المختار:'}</b>
    <ol>${pending.map(p => `<li>${esc(p.unit)} <small class="muted">(${p.pages ? ar(p.pages.length) + ' صفحة، ' : ''}${ar(p.text.split(/\s+/).filter(Boolean).length)} كلمة)</small>${p.status ? ' — ' + p.status : ''}</li>`).join('')}</ol>
    ${one?.pages && !one.bad ? `<div class="row-gap" style="align-items:center">
      <span>الصفحات: من</span><input id="pg-from" type="number" min="1" max="${one.pages.length}" value="${one.from}" style="width:5.5em">
      <span>إلى</span><input id="pg-to" type="number" min="1" max="${one.pages.length}" value="${one.to}" style="width:5.5em">
    </div><small class="muted" id="pg-warn" ${one.to - one.from + 1 > 20 ? '' : 'hidden'}>⚠ صفحات كثيرة تأخذ وقتًا طويلًا على الجوال؛ الأفضل ١٠–٢٠ صفحة في المرة.</small>` : ''}
    <button type="button" class="ghost" id="clear-pending">إلغاء الملفات</button>` : '';
  const c = $('#clear-pending'); if (c) c.onclick = () => { pending = []; renderPending(); };
  const f = $('#pg-from'), t = $('#pg-to');
  if (f && t) {
    const upd = () => {
      const n = one.pages.length;
      one.from = Math.min(Math.max(1, parseInt(f.value) || 1), n);
      one.to = Math.min(Math.max(one.from, parseInt(t.value) || n), n);
      one.text = pdfSlice(one);
      one.unit = one.baseUnit + (one.from === 1 && one.to === n ? '' : ` (ص ${ar(one.from)}–${ar(one.to)})`);
      const li = $('#pending li'); // update the line only, so typing is not interrupted
      if (li) li.innerHTML = `${esc(one.unit)} <small class="muted">(${ar(one.to - one.from + 1)} من ${ar(n)} صفحة، ${ar(one.text.split(/\s+/).filter(Boolean).length)} كلمة)</small>`;
      const w = $('#pg-warn'); if (w) w.hidden = one.to - one.from + 1 <= 20;
    };
    f.oninput = upd; t.oninput = upd; f.onchange = upd; t.onchange = upd;
  }
}

/* reading PDFs (text PDFs; scanned books with no text layer are detected and explained) */
let pdfLib = null;
async function readPdf(file) {
  pdfLib ??= await import('./vendor/pdfjs/pdf.min.mjs');
  pdfLib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', location.href).href;
  const doc = await pdfLib.getDocument({ data: await file.arrayBuffer(), cMapUrl: new URL('vendor/pdfjs/cmaps/', location.href).href, cMapPacked: true }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const W = page.getViewport({ scale: 1 }).width;
    const tc = await page.getTextContent();
    // 1. pieces → lines (same height)
    const lines = [];
    for (const it of tc.items) {
      if (!it.str) continue;
      const y = it.transform[5], x = it.transform[4], w = it.width || 0, h = it.height || Math.abs(it.transform[3]) || 10;
      let line = lines.find(l => Math.abs(l.y - y) < Math.max(2, h * 0.45));
      if (!line) lines.push(line = { y, h, parts: [] });
      line.parts.push({ x0: x, x1: x + w, s: it.str });
    }
    // 2. each line → segments split at wide gaps (columns), words joined by real gaps only
    const segs = [];
    for (const l of lines) {
      const all = l.parts.map(p => p.s).join('');
      const rtl = (all.match(/[؀-ۿ]/g) || []).length >= (all.match(/[A-Za-z]/g) || []).length;
      l.parts.sort((a, b) => a.x0 - b.x0);
      let cur = null;
      for (const p of l.parts) {
        if (cur && p.x0 - cur.x1 > W * 0.035) { segs.push(cur); cur = null; }
        if (!cur) cur = { y: l.y, x0: p.x0, x1: p.x1, items: [] };
        cur.items.push(p); cur.x1 = Math.max(cur.x1, p.x1);
      }
      if (cur) segs.push(cur);
      for (const sg of segs.filter(z => !z.done)) {
        sg.done = true;
        const items = rtl ? [...sg.items].sort((a, b) => b.x0 - a.x0) : sg.items;
        let txt = '';
        for (let k = 0; k < items.length; k++) {
          const p = items[k], q = items[k - 1];
          if (q) { const gap = rtl ? q.x0 - p.x1 : p.x0 - q.x1; if (gap > l.h * 0.18 && !/\s$/.test(txt) && !/^\s/.test(p.s)) txt += ' '; }
          txt += p.s;
        }
        txt = txt.replace(/\s+/g, ' ').replace(/\s+([\u064B-\u0652\u0670])/g, '$1').trim();
        sg.rtl = rtl;
        sg.text = txt;
      }
    }
    // brackets often come out mirrored from Arabic PDFs: decide once per page, then fix every Arabic line
    const joined = segs.filter(z => z.rtl).map(z => z.text).join(' ');
    const firstOf = (t, a, b) => { const i = t.indexOf(a), j = t.indexOf(b); return i >= 0 && (j < 0 || i < j); };
    const mirrored = firstOf(joined, '»', '«') || (!/[«»]/.test(joined) && firstOf(joined, ')', '('));
    if (mirrored) for (const z of segs) if (z.rtl) z.text = z.text.replace(/[«»()]/g, c => ({ '«': '»', '»': '«', '(': ')', ')': '(' }[c]));
    for (const z of segs) z.text = (z.text || '').replace(/ملسو هيلع هللا ىلص/g, 'ﷺ');
    // 3. two columns? read the right column fully, then the left (Arabic order)
    const mid = W / 2;
    const left = segs.filter(z => z.x1 < mid + W * 0.02), right = segs.filter(z => z.x0 > mid - W * 0.02);
    const twoCol = left.length > 3 && right.length > 3 && left.length + right.length >= segs.length * 0.8;
    const order = (list) => list.sort((a, b) => b.y - a.y || b.x0 - a.x0).map(z => z.text).filter(Boolean).join('\n');
    let text;
    if (twoCol) {
      const spans = segs.filter(z => !left.includes(z) && !right.includes(z));
      text = [order(spans.filter(z => z.y > Math.max(...right.map(r => r.y), ...left.map(r => r.y)))), order(right), order(left),
        order(spans.filter(z => z.y <= Math.max(...right.map(r => r.y), ...left.map(r => r.y))))].filter(Boolean).join('\n');
    } else text = order(segs);
    pages.push(text.normalize('NFKC'));
  }
  return pages;
}

async function addFiles(files) {
  pending = [];
  const box = $('#pending'); box.hidden = false; box.textContent = 'جارٍ قراءة الملفات…';
  let sawPdf = false;
  for (const f of files.sort((a, b) => a.name.localeCompare(b.name, 'ar', { numeric: true }))) {
    const unit = f.name.replace(/\.[^.]+$/, '');
    const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    if (!isPdf) { pending.push({ text: (await f.text()).trim(), unit }); continue; }
    sawPdf = true;
    try {
      const pages = await readPdf(f);
      const chars = pages.join('').replace(/\s/g, '').length;
      const item = { pages, from: 1, to: pages.length, baseUnit: unit, unit };
      item.text = pdfSlice(item);
      if (chars < pages.length * 40) {
        item.bad = true; item.text = '';
        item.status = '✗ هذا ملف مصوّر (صور بلا نص مكتوب)، فلا أستطيع قراءته بعد. أرسل ملف PDF نصيًا أو انسخ النص والصقه.';
      }
      pending.push(item);
    } catch {
      pending.push({ text: '', unit, bad: true, status: '✗ تعذّر فتح هذا الملف. قد يكون محميًا بكلمة مرور أو تالفًا.' });
    }
  }
  if (pending.length === 1 && $('#unit').value) pending[0].unit = pending[0].baseUnit = $('#unit').value;
  if (sawPdf && $('#kind').value === 'transcript') $('#kind').value = 'book';
  renderPending();
}
$('#file').addEventListener('change', async e => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (files.length) await addFiles(files);
});

async function keepAwake() {
  try { return await navigator.wakeLock?.request('screen'); } catch { return null; }
}
$('#cancel').onclick = () => controller?.abort();

const SOURCE_TEXT = {
  transcript: { name: 'التفريغ', ask: 'هذا تفريغ آلي لتسجيل الدرس. اكتب منه الملف الدراسي والخريطة الذهنية وتقرير التحقق لهذا الدرس وحده:' },
  notes: { name: 'الملاحظات', ask: 'هذه ملاحظات كتبها الطالب بنفسه (ليست تفريغًا صوتيًا، فلا تفترض فيها أخطاء سماع). أعد كتابتها بطريقته: الملف الدراسي والخريطة الذهنية وتقرير التحقق. التزم بما فيها ولا تضف:' },
  book: { name: 'النص', ask: 'هذا مقطع من كتاب أو موضوع مكتوب. حوّله إلى ملاحظات بطريقة الطالب: الملف الدراسي والخريطة الذهنية وتقرير التحقق. التزم بنص المقطع وحده، واحفظ عبارات المؤلف المهمة بين «» ونسبتها إليه، واذكر أرقام الصفحات إن وُجدت:' },
};

async function makeOne({ text, unit, sub, kind }, onStatus) {
  const src = SOURCE_TEXT[kind] || SOURCE_TEXT.transcript;
  let notes, note;
  if (engineKind() === 'phone') {
    const r = await writeOnPhone({ text, unit, sub, src }, onStatus);
    notes = r.notes;
    note = 'جاهز. كُتب على جوالك مجانًا.' + (r.cut ? '\n⚠ جزء طال أكثر من اللازم فقد يكون آخره ناقصًا.' : '') + (r.partial ? '\n' + r.partial : '');
  } else {
    const t0 = Date.now();
    const user = `المادة: ${sub.name}${sub.book ? ' (الكتاب: ' + sub.book + ')' : ''}${sub.place ? ' — ' + sub.place : ''}
الدرس / الوحدة: ${unit}
نوع المدخل: ${src.name}

${src.ask}

<<<${src.name}
${text}
${src.name}>>>`;
    const r = await callClaude({
      system: window.JUND_METHOD,
      messages: [{ role: 'user', content: user }],
      signal: controller.signal,
      onText: t => {
        const mins = Math.floor((Date.now() - t0) / 60000);
        onStatus(`يكتب الآن… ${ar(t.split(/\s+/).length)} كلمة${mins ? ' — ' + ar(mins) + ' د' : ''}`, null, 'write');
      },
    });
    onStatus('يرتّب الصفحات…');
    notes = await getJSON(r.text, controller.signal);
    note = `جاهز. كلّف نحو ${ar((r.usd * SAR).toFixed(2))} ريال.` + (r.stop === 'max_tokens' ? '\n⚠ النص طويل جدًا فتوقف قبل النهاية؛ قد يكون آخره ناقصًا. قسّمه إلى جزأين.' : '');
  }
  onStatus('يطابق الآيات على المصحف…', 1, 'write');
  try { await window.Mushaf.check(notes); } catch {}
  const lesson = {
    id: 'L' + Date.now() + Math.random().toString(36).slice(2, 6),
    subject: { id: sub.id, name: sub.name, place: sub.place || '', book: sub.book || '' },
    unit, kind, engine: engineKind(), date: new Date().toISOString(), transcript: text, notes,
    chat: [{ who: 'ai', text: note }],
  };
  await saveLesson(lesson);
  return lesson;
}

$('#make').onclick = async () => {
  const err = $('#new-error'); err.hidden = true;
  if (engineKind() === 'claude' && !store.get('key')) { show('settings'); $('#key-status').textContent = 'ضع مفتاحك هنا أولًا ثم اضغط حفظ.'; return; }
  if (engineKind() === 'phone') {
    const sup = await window.LocalAI.support();
    if (!sup.ok) { err.textContent = sup.why; err.hidden = false; return; }
  }
  const sub = subjectInfo();
  const kind = $('#kind').value;
  const jobs = pending.length ? pending : [{ text: $('#transcript').value.trim(), unit: $('#unit').value.trim() }];
  if (jobs.length === 1 && pending.length === 1 && $('#unit').value.trim()) jobs[0].unit = $('#unit').value.trim();
  for (const j of jobs) j.unit ||= 'درس بتاريخ ' + new Date().toLocaleDateString('ar-SA');
  if (jobs.some(j => j.bad)) { err.textContent = 'في الملفات ملف لا يُقرأ (انظر ✗ فوق). احذفه بزر «إلغاء الملفات» أو اختر غيره.'; err.hidden = false; return; }
  if (jobs.some(j => j.text.length < 200)) { err.textContent = 'النص قصير جدًا. الصق النص كاملًا أو اختر صفحات أكثر.'; err.hidden = false; return; }
  // long jobs on the phone: show the expected time and ask for a second tap
  if (engineKind() === 'phone') {
    const words = jobs.reduce((n, j) => n + j.text.split(/\s+/).filter(Boolean).length, 0);
    const partsN = jobs.reduce((n, j) => n + splitText(j.text).length, 0);
    const mins = Math.round(partsN * (phoneSize() === 'strong' ? 5 : 2.5));
    const box = $('#confirm-long');
    if (mins >= 15 && box.dataset.ok !== String(words)) {
      box.innerHTML = `<b>⚠ هذا نص طويل:</b> ${ar(words)} كلمة في ${ar(partsN)} ${partsN >= 3 && partsN <= 10 ? 'أجزاء' : 'جزءًا'}. سيأخذ على جوالك نحو <b>${ar(mins)} دقيقة</b>، والتطبيق مفتوح والشاشة مضاءة طوال الوقت (والأفضل أن يكون الجوال على الشاحن).<br>للتجربة الأولى اختر ٣–٥ صفحات فقط. للمتابعة على كل حال اضغط «اصنع الملاحظات» مرة ثانية.`;
      box.hidden = false; box.dataset.ok = String(words);
      box.scrollIntoView({ block: 'center' });
      return;
    }
    box.hidden = true; delete box.dataset.ok;
  }
  $('#make').disabled = true; $('#progress').hidden = false;
  setBar('#progress-bar-wrap', '#progress-bar', 0); $('#progress-pct').textContent = '';
  $('#progress-eta').textContent = 'أبقِ التطبيق مفتوحًا والشاشة مضاءة حتى ينتهي.';
  controller = new AbortController();
  const lock = await keepAwake();
  let last = null, failed = 0;
  try {
    for (let i = 0; i < jobs.length; i++) {
      const pre = jobs.length > 1 ? `(${ar(i + 1)} من ${ar(jobs.length)}) ${jobs[i].unit}: ` : '';
      const status = (s, frac, phase, eta) => {
        $('#progress-text').textContent = pre + s;
        if (phase === 'download') {
          setBar('#progress-bar-wrap', '#progress-bar', frac);
          $('#progress-pct').textContent = frac != null ? ar(Math.round(frac * 100)) + '٪' : '';
          $('#progress-eta').textContent = 'التنزيل مرة واحدة فقط. أبقِ الواي فاي متصلًا.';
          return;
        }
        const all = frac == null ? null : (i + frac) / jobs.length;
        setBar('#progress-bar-wrap', '#progress-bar', all);
        $('#progress-pct').textContent = all != null ? ar(Math.round(all * 100)) + '٪' : '';
        $('#progress-eta').textContent = (eta ? eta + ' — ' : '') + 'أبقِ التطبيق مفتوحًا والشاشة مضاءة.';
      };
      status('جارٍ القراءة والكتابة…');
      try {
        last = await makeOne({ ...jobs[i], sub, kind }, status);
        jobs[i].status = '✓ جاهز';
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        failed++; jobs[i].status = '✗ ' + errText(e);
        if (jobs.length === 1) throw e;
      }
      if (pending.length) renderPending();
    }
    if (failed) { err.textContent = `انتهى، وتعذّر ${ar(failed)} منها. الملفات الجاهزة في المكتبة؛ أعد المحاولة للباقي.`; err.hidden = false; pending = pending.filter(p => !p.status?.startsWith('✓')); pending.forEach(p => delete p.status); renderPending(); }
    else { pending = []; renderPending(); $('#transcript').value = ''; $('#unit').value = ''; countWords(); }
    if (jobs.length > 1 && !failed) show('library');
    else if (last && !failed) await openLesson(last);
  } catch (e) {
    err.textContent = e?.name === 'AbortError' ? 'أُوقف. الدروس التي اكتملت محفوظة في المكتبة.' : errText(e);
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
    <div class="pg-foot"><span>${esc(meta.subject)}${meta.place ? ' — ' + esc(meta.place) : ''}</span><span>${esc(meta.unit)}${meta.footLabel ?? (kind === 'map' ? ' — الخريطة الذهنية' : '')}</span></div>`;
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

function paginateNotes(lesson, meta, finish = true) {
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
  if (finish) finishPages(pages);
  return pages;
}

function finishPages(pages) {
  const total = pages.length;
  pages.forEach((p, i) => { const n = $('.n', p); if (n) n.textContent = `صفحة ${ar(i + 1)} / ${ar(total)}`; });
  // cross references → page numbers (only inside the same lesson)
  const secPage = [];
  pages.forEach((p, i) => $$('.b-h', p).forEach(h => secPage.push([norm(h.dataset.sec), i + 1, p.dataset.ch || ''])));
  pages.forEach(p => $$('.xref', p).forEach(x => {
    const want = norm(x.dataset.ref);
    const hit = secPage.find(([s, , ch]) => ch === (p.dataset.ch || '') && s && (s.includes(want) || want.includes(s)));
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
function paginateMap(lesson, meta, finish = true) {
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
  if (finish) finishPages(pages);
  return pages;
}

/* ---------- open a lesson ---------- */
async function fontsReady() {
  try {
    await Promise.all(['16px Amiri', 'bold 16px Amiri', '16px "Amiri Quran"', '16px "Scheherazade New"', 'bold 16px "Scheherazade New"'].map(f => document.fonts.load(f)));
    await document.fonts.ready;
  } catch {}
}
function metaFor(lesson) {
  const sub = subjectById(lesson.subject.id);
  return {
    title: lesson.notes.title || lesson.unit, subtitle: lesson.notes.subtitle || '',
    subject: lesson.subject.name, place: lesson.subject.place, unit: lesson.unit,
    palette: window.paletteFor(sub ? familyOf(sub) : 'slate'),
  };
}
async function openLesson(lesson) {
  current = lesson;
  setBookMode(false);
  const n = lesson.notes;
  const meta = metaFor(lesson);
  $('#result-title').textContent = meta.title;
  $('#result-meta').textContent = `${lesson.subject.name}${lesson.subject.place ? ' — ' + lesson.subject.place : ''} · ${lesson.unit}`;
  show('result');
  await fontsReady();
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
  document.title = current ? `${current.subject.name} - ${current.unit}${currentTab === 'map' ? ' - خريطة ذهنية' : ''}` : bookTitle;
  setTimeout(() => { window.print(); setTimeout(() => { document.title = old; }, 1000); }, 50);
};

/* ---------- chat: edits and questions ---------- */
// On the phone the AI sees only the sections it needs, so even long lessons fit.
async function editOnPhone(ask) {
  const secs = current.notes.sections || [];
  const words = norm(ask).split(' ').filter(w => w.length > 2);
  let pick = secs.map((s, i) => i).filter(i => words.some(w => norm(secs[i].heading).includes(w)));
  const sizeOf = list => JSON.stringify(list.map(i => secs[i])).length;
  if (!pick.length) pick = secs.map((s, i) => i);
  while (pick.length > 1 && sizeOf(pick) > 9000) pick.pop();
  const user = `المادة: ${current.subject.name} — ${current.unit}
كل عناوين الأقسام: ${secs.map((s, i) => i + '. ' + s.heading).join(' | ')}

الأقسام المرسلة للتعديل:
${JSON.stringify(pick.map(i => ({ i, heading: secs[i].heading, blocks: secs[i].blocks })))}

طلب الطالب: ${ask}`;
  const r = await window.LocalAI.generate({
    size: phoneSize(), system: window.JUND_EDIT_SMALL + '\n\nأنواع الكتل كما في هذا الدليل:\n' + window.JUND_METHOD_SMALL.split('أنواع الكتل في blocks:')[1].split('أعد هذا الشكل فقط:')[0],
    user, maxTokens: 3000,
    onProgress: p => { $('#chat-progress-text').textContent = progressText(p); },
    onText: t => { $('#chat-progress-text').textContent = `يعدّل على جوالك… ${ar(t.split(/\s+/).length)} كلمة`; },
  });
  let out; try { out = parseJSON(r.text); } catch { throw new Error('وصل الرد غير مرتب. أعد الطلب بكلمات أوضح.'); }
  if (!out.no_change && Array.isArray(out.changed)) {
    for (const c of out.changed) {
      if (c.i >= 0 && c.i < secs.length) {
        if (Array.isArray(c.blocks) && !c.blocks.length) secs[c.i] = null;
        else secs[c.i] = { heading: c.heading || secs[c.i].heading, blocks: c.blocks || secs[c.i].blocks };
      } else if (c.blocks?.length) secs.push({ heading: c.heading || '', blocks: c.blocks });
    }
    current.notes.sections = secs.filter(Boolean);
    try { await window.Mushaf.check(current.notes); } catch {}
  }
  current.chat.push({ who: 'ai', text: out.reply || (out.no_change ? 'تم.' : 'عدّلته.') });
  await saveLesson(current);
  await openLesson(current);
  $('.chat').scrollIntoView({ block: 'end' });
}

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
  if (engineKind() === 'phone') {
    try { await editOnPhone(ask); }
    catch (e) { current.chat.push({ who: 'ai', text: '✗ ' + e.message }); renderChat(); }
    finally { lock?.release?.(); $('#chat-send').disabled = false; $('#chat-progress').hidden = true; }
    return;
  }
  try {
    const history = current.chat.slice(-9, -1).map(m => (m.who === 'me' ? 'الطالب: ' : 'أنت: ') + m.text).join('\n');
    const user = `المادة: ${current.subject.name} — ${current.unit}

<<<النص الأصلي
${current.transcript}
النص الأصلي>>>

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
    await saveLesson(current);
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
async function allLessons() { try { return await idb.all(); } catch { return []; } }

let lastPull = 0;
async function renderLibrary() {
  const list = $('#library-list');
  if (cloud.on() && Date.now() - lastPull > 60000) {
    lastPull = Date.now();
    cloud.pull().then(n => { if (n) renderLibrary(); }).catch(() => { const el = $('#cloud-status'); if (el) el.textContent = '⚠ تعذّر الاتصال بمخزنك على GitHub الآن.'; });
  }
  const all = await allLessons();
  $('#book-mawaiz').hidden = !all.some(l => l.notes?.mawaiz?.length);
  if (!all.length) { list.innerHTML = '<p class="muted">لا توجد دروس محفوظة بعد. أول درس تصنعه سيظهر هنا.</p>'; return; }
  all.sort((a, b) => b.date.localeCompare(a.date));
  const groups = {};
  for (const l of all) (groups[l.subject.id] ??= []).push(l);
  list.innerHTML = Object.entries(groups).map(([sid, ls]) => `
    <div class="lib-group"><h2>${esc(ls[0].subject.name)}${ls[0].subject.place ? ' <small class="muted">' + esc(ls[0].subject.place) + '</small>' : ''}</h2>
    ${ls.length > 1 ? `<button type="button" class="ghost book-btn" data-book="${esc(sid)}">اصنع كتاب المادة (${ar(ls.length)} دروس)</button>` : ''}
    ${ls.map(l => `<div class="lib-item">
      <button type="button" class="open" data-open="${l.id}">${esc(l.notes?.title || l.unit)}<small>${esc(l.unit)} · ${new Date(l.date).toLocaleDateString('ar-SA')}</small></button>
      <button type="button" class="ghost danger" data-del="${l.id}">حذف</button>
    </div>`).join('')}</div>`).join('');
  $$('[data-open]', list).forEach(b => b.onclick = async () => openLesson(await idb.get(b.dataset.open)));
  $$('[data-book]', list).forEach(b => b.onclick = () => makeBook(b.dataset.book));
  $$('[data-del]', list).forEach(b => b.onclick = async () => {
    if (b.dataset.sure) { await removeLesson(b.dataset.del); if (current?.id === b.dataset.del) current = null; renderLibrary(); }
    else { b.dataset.sure = '1'; b.textContent = 'اضغط مرة ثانية للتأكيد'; }
  });
}

/* ---------- year-end books (put together by the app, no AI cost) ---------- */
let bookTitle = '';
function setBookMode(on) {
  $('.tabs').hidden = on; $('.chat').hidden = on;
  if (on) { $('#frame-map').hidden = true; $('#frame-report').hidden = true; $('#frame-notes').hidden = false; currentTab = 'notes'; }
}
function coverPage(meta, lines) {
  const p = document.createElement('div');
  p.className = 'page cover';
  Object.entries(meta.palette).forEach(([k, v]) => p.style.setProperty(k, v));
  p.innerHTML = lines;
  return p;
}
function tocPages(meta, rows) {
  const per = 26, pages = [];
  for (let i = 0; i < Math.max(rows.length, 1); i += per) {
    const p = makePage({ ...meta, title: 'المحتويات', subtitle: meta.subject, footLabel: '' }, 'map');
    $('.pg-single', p).innerHTML = (i ? '' : '<div class="toc-h">المحتويات</div>') +
      rows.slice(i, i + per).map(r => `<div class="toc-row"><span>${inline(r.title)}${r.sub ? ' <small style="color:#5b5040">— ' + esc(r.sub) + '</small>' : ''}</span><span class="dots"></span><span class="pg"></span></div>`).join('');
    pages.push(p);
  }
  return pages;
}
async function showBook(title, metaLine, pages, rows, tocStart) {
  // page numbers in the contents, then the whole book's numbering
  let k = 0;
  pages.forEach(p => $$('.toc-row .pg', p).forEach(el => { const r = rows[k++]; if (r) el.textContent = ar(r.page); }));
  finishPages(pages);
  current = null; bookTitle = title;
  setBookMode(true);
  $('#result-title').textContent = title;
  $('#result-meta').textContent = metaLine;
  $('#pages-notes').replaceChildren(...pages);
  $('#measure').innerHTML = '';
  show('result');
  fitPages();
}
async function makeBook(subjectId) {
  const ls = (await allLessons()).filter(l => l.subject.id === subjectId).sort((a, b) => a.date.localeCompare(b.date));
  if (!ls.length) return;
  $('#book-progress').hidden = false; $('#book-progress-text').textContent = 'جارٍ تجهيز الكتاب…';
  await fontsReady();
  const meta = { ...metaFor(ls[0]), title: ls[0].subject.name, subtitle: '', unit: '' };
  const year = new Date().toLocaleDateString('ar-SA', { year: 'numeric' });
  const cover = coverPage(meta, `<div class="c-sub">${esc(ls[0].subject.name)}</div>
    ${ls[0].subject.book ? `<div class="c-book">${esc(ls[0].subject.book)}</div>` : ''}<div class="c-rule"></div>
    <div class="c-place">${esc(ls[0].subject.place || '')}${ls[0].subject.place ? ' — ' : ''}${esc(year)}</div>
    <div class="c-place">جُنيد محمد بن عبدالسلام</div>`);
  const rows = [];
  const chapters = [];
  ls.forEach((l, i) => {
    $('#book-progress-text').textContent = `يرتّب الدرس ${ar(i + 1)} من ${ar(ls.length)}…`;
    const m = metaFor(l);
    const np = paginateNotes(l, m, false);
    const mp = paginateMap(l, m, false);
    [...np, ...mp].forEach(p => { p.dataset.ch = l.id; });
    chapters.push({ l, pages: [...np, ...mp] });
  });
  const toc = tocPages(meta, ls.map(l => ({ title: l.notes.title || l.unit, sub: l.unit })));
  let pageNo = 1 + toc.length;
  for (const c of chapters) { rows.push({ title: c.l.notes.title || c.l.unit, sub: c.l.unit, page: pageNo + 1 }); pageNo += c.pages.length; }
  const pages = [cover, ...toc, ...chapters.flatMap(c => c.pages)];
  $('#book-progress').hidden = true;
  await showBook(`كتاب ${ls[0].subject.name}`, `${ar(ls.length)} دروس · ${ar(pages.length)} صفحة`, pages, rows, 1);
}
$('#book-mawaiz').onclick = async () => {
  const all = (await allLessons()).filter(l => l.notes?.mawaiz?.length).sort((a, b) => a.date.localeCompare(b.date));
  if (!all.length) return;
  await fontsReady();
  const bySub = {};
  for (const l of all) (bySub[l.subject.id] ??= []).push(l);
  const meta = { title: 'المواعظ', subtitle: '', subject: 'المواعظ', place: '', unit: '', palette: window.paletteFor('umber') };
  const notes = {
    sections: Object.values(bySub).map(ls => ({
      heading: ls[0].subject.name + (ls[0].subject.place ? ' — ' + ls[0].subject.place : ''),
      blocks: ls.flatMap(l => [{ t: 'appx-h', text: l.notes.title || l.unit }, { t: 'list', ordered: false, items: l.notes.mawaiz }]),
    })),
  };
  const pages = paginateNotes({ notes }, meta, false);
  const cover = coverPage(meta, `<div class="c-sub">المواعظ</div><div class="c-rule"></div><div class="c-book">من دروس العام في كل المواد</div><div class="c-place">جُنيد محمد بن عبدالسلام</div>`);
  await showBook('المواعظ', `${ar(Object.keys(bySub).length)} مواد`, [cover, ...pages], [], 1);
};

/* ---------- backup to Google Drive (or anywhere) ---------- */
$('#backup').onclick = async () => {
  const st = $('#backup-status');
  const lessons = await allLessons();
  const data = { app: 'jund-notes', version: 1, saved: new Date().toISOString(), families: store.get('families', {}), lessons };
  const name = `نسخة ملاحظات جنيد ${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      st.textContent = `✓ اختر Google Drive من القائمة لحفظها هناك. (${ar(lessons.length)} درس)`;
      return;
    }
  } catch (e) { if (e.name === 'AbortError') { st.textContent = 'أُلغي.'; return; } }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  st.textContent = `✓ نُزّلت النسخة (${ar(lessons.length)} درس). ارفعها إلى Google Drive من ملفات الجوال.`;
};
$('#restore').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const st = $('#backup-status');
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'jund-notes' || !Array.isArray(data.lessons)) throw new Error();
    for (const l of data.lessons) await saveLesson(l);
    if (data.families) store.set('families', { ...data.families, ...store.get('families', {}) });
    st.textContent = `✓ استُرجع ${ar(data.lessons.length)} درس.`;
  } catch { st.textContent = '✗ هذا ليس ملف نسخة احتياطية من التطبيق.'; }
  e.target.value = '';
};

/* ---------- font ---------- */
function applyFont() { document.documentElement.dataset.font = store.get('font', 'sch'); }
$('#font').value = store.get('font', 'sch');
$('#font').onchange = () => { store.set('font', $('#font').value); applyFont(); };
applyFont();

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
      const fr = await c.match('shared-file');
      if (fr) {
        const name = decodeURIComponent(fr.headers.get('x-name') || 'ملف.pdf');
        const blob = await fr.blob(); await c.delete('shared-file');
        await addFiles([new File([blob], name, { type: blob.type || 'application/pdf' })]);
      }
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
window.__jn = { openLesson, paginateNotes, idb, makeBook, pending: () => pending };
})();
