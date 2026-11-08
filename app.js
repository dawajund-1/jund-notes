/* Jund Notes — the app. Plain JS, no build step. */
(() => {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const arD = n => String(n).replace(/\d/g, d => AR_DIGITS[d]);  // Arabic digits, for Arabic note pages
const ar = n => String(n);                                        // the app itself shows plain digits
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
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
      try { await job(); } catch { setStatus('⚠ Not saved to your storage yet; it will retry when the app is open with internet.'); store.set('ghDirty', true); }
    }
    busy = false;
  }
  async function putLesson(l) {
    const path = `/contents/lessons/${l.id}.json`;
    let sha = shas()[l.id];
    const body = () => JSON.stringify({ message: `Save: ${l.subject?.name || ''} — ${l.unit || l.id}`, content: b64(JSON.stringify(l)), ...(sha ? { sha } : {}) });
    let r = await api(path, { method: 'PUT', body: body() });
    if (r.status === 409 || r.status === 422) { // our copy of the version was old: fetch the current one and retry once
      const g = await api(path); if (g.ok) { sha = (await g.json()).sha; r = await api(path, { method: 'PUT', body: body() }); }
    }
    if (!r.ok) throw new Error(r.status);
    setSha(l.id, (await r.json()).content.sha);
    setStatus('☁ Saved in your private GitHub storage.');
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
        await api(path, { method: 'DELETE', body: JSON.stringify({ message: 'Delete lesson', sha }) });
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
      setStatus('☁ In sync with your private GitHub storage.');
      return added;
    },
    async test() {
      const r = await api('');
      if (r.status === 401) throw new Error('The key is not correct.');
      if (r.status === 404) throw new Error('I could not find the jund-notes-data storage, or the key has no access to it.');
      if (!r.ok) throw new Error('Error ' + r.status);
      return true;
    },
    status: () => status,
    // small app data files (calendar, saved texts) kept next to the lessons
    async putData(name, obj) {
      if (!token()) return;
      const path = `/contents/data/${name}.json`, key = 'data:' + name;
      let sha = shas()[key];
      const body = () => JSON.stringify({ message: 'Save ' + name, content: b64(JSON.stringify(obj)), ...(sha ? { sha } : {}) });
      let r = await api(path, { method: 'PUT', body: body() });
      if (r.status === 409 || r.status === 422) { const g = await api(path); if (g.ok) { sha = (await g.json()).sha; r = await api(path, { method: 'PUT', body: body() }); } }
      if (r.ok) setSha(key, (await r.json()).content.sha);
    },
    async getData(name) {
      if (!token()) return null;
      const r = await api(`/contents/data/${name}.json`, { raw: true });
      if (!r.ok) return null;
      try { return JSON.parse(await r.text()); } catch { return null; }
    },
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

const workMode = () => (store.get('me', {}).use || 'study') === 'work';
function fillSubjects() {
  const sel = $('#subject'), work = workMode();
  const mine = store.get('mySubjects', []);
  const groups = {};
  if (!work) for (const s of window.SUBJECTS) (groups[s.place] ??= []).push(s);
  const mineHtml = mine.length ? `<optgroup label="${work ? 'My projects' : 'My subjects'}">${mine.map(n => `<option value="mine:${esc(n)}">${esc(n)}</option>`).join('')}</optgroup>` : '';
  sel.innerHTML = mineHtml + Object.entries(groups).map(([place, list]) =>
    `<optgroup label="${esc(place)}">${list.map(s => `<option value="${s.id}">${esc(s.name)}${s.book ? ' — ' + esc(s.book) : ''}</option>`).join('')}</optgroup>`
  ).join('') + `<option value="other">${work ? 'New project or area…' : 'Another subject…'}</option>`;
  sel.value = store.get('lastSubject', '');
  if (!sel.value) sel.value = sel.options[0]?.value || 'other';
  // words that fit the person: study or work
  const lab = (id, t) => { const el = $(id)?.closest('.field')?.querySelector('span'); if (el) el.textContent = t; };
  lab('#subject', work ? 'Project or area' : 'Subject');
  lab('#custom-subject', work ? 'Project name' : 'Subject name');
  lab('#unit', work ? 'Title' : 'Lesson or unit');
  $('#custom-subject').placeholder = work ? 'e.g. Sales team' : 'Type the subject';
  $('#unit').placeholder = work ? 'e.g. Weekly sales meeting' : 'e.g. Lesson 3';
  if (work && !store.get('kindChosen')) $('#kind').value = 'meeting';
  const sync = () => { $('#custom-subject-wrap').hidden = sel.value !== 'other'; store.set('lastSubject', sel.value); };
  if (!sel.dataset.wired) { sel.addEventListener('change', sync); sel.dataset.wired = '1'; $('#kind').addEventListener('change', () => store.set('kindChosen', true)); }
  sync();
}

function renderPaletteSettings() {
  const box = $('#palette-list');
  const fams = window.FAMILIES;
  box.innerHTML = window.SUBJECTS.map(s => {
    const pal = window.paletteFor(familyOf(s));
    return `<div class="pal-row">
      <span class="pal-chip" style="background:${pal['--sub-head']}"></span>
      <span style="flex:1;min-width:0">${esc(s.name)} <small class="muted">(${esc(s.place)})</small></span>
      <select data-sub="${s.id}" aria-label="Colour of ${esc(s.name)}">${Object.entries(fams).map(([k, f]) => `<option value="${k}" ${k === familyOf(s) ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>
    </div>`;
  }).join('') + `<div id="pal-warn" class="muted"></div>`;
  $$('select[data-sub]', box).forEach(sel => sel.addEventListener('change', () => {
    const o = store.get('families', {}); o[sel.dataset.sub] = sel.value; store.set('families', o);
    renderPaletteSettings();
  }));
  // warn about repeats inside one place
  const seen = {}; const dup = [];
  for (const s of window.SUBJECTS) { const k = s.place + familyOf(s); if (seen[k]) dup.push(`${seen[k]} and ${s.name}`); else seen[k] = s.name; }
  $('#pal-warn').textContent = dup.length ? '⚠ Same colour twice in one place: ' + dup.join(', ') : '';
}

/* ---------- navigation ---------- */
const SCREENS = ['new', 'result', 'library', 'calendar', 'studio', 'settings', 'assistant'];
function show(name) {
  for (const s of SCREENS) { const el = $('#screen-' + s); if (el) el.hidden = s !== name; }
  const tab = name === 'result' || name === 'new' ? 'library' : name;
  $$('.tabbar [data-nav]').forEach(b => b.classList.toggle('on', b.dataset.nav === tab));
  if (name === 'library') { renderLibrary(); window.JundRecorder?.list(); }
  if (name === 'calendar') window.JundCal?.render();
  if (name === 'studio') window.JundStudio?.open();
  if (name === 'assistant') window.JundAssistant?.open();
  if (name === 'settings') { renderPaletteSettings(); renderSpend(); window.__syncEngine?.(); }
  if (name === 'new') $('#key-missing').hidden = engineKind() !== 'claude' || !!store.get('key');
  if (name === 'result') requestAnimationFrame(fitPages);
  window.scrollTo(0, 0);
}
$('#go-home').onclick = () => show('assistant');
$('#go-today').onclick = () => { window.JundCal?.goToday(); show('calendar'); };
$$('.tabbar [data-nav]').forEach(b => b.onclick = () => show(b.dataset.nav));
document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) show(g.dataset.go); });

/* ---------- settings ---------- */
function initSettings() {
  $('#api-key').value = store.get('key', '');
  $('#model').value = store.get('model', 'claude-opus-5-5');
  $('#model').onchange = () => store.set('model', $('#model').value);
  $('#toggle-key').onclick = () => {
    const i = $('#api-key'); i.type = i.type === 'password' ? 'text' : 'password';
    $('#toggle-key').textContent = i.type === 'password' ? 'Show' : 'Hide';
  };
  $('#save-key').onclick = () => {
    store.set('key', $('#api-key').value.trim());
    $('#key-status').textContent = store.get('key') ? '✓ Key saved on this phone.' : 'Key removed.';
  };
  // which AI
  const syncEngine = async () => {
    const phone = engineKind() === 'phone';
    $('#engine').value = engineKind(); $('#phone-size').value = phoneSize();
    $('#phone-box').hidden = !phone; $('#claude-box').hidden = engineKind() !== 'claude';
    if (phone) {
      const sup = await window.LocalAI.support();
      if (!sup.ok) { $('#phone-status').textContent = '✗ ' + sup.why; return; }
      const have = await window.LocalAI.isDownloaded(phoneSize());
      $('#phone-compat').checked = window.LocalAI.isCompat();
      $('#phone-status').textContent = have ? '✓ The AI is on your phone and works without internet.' : `Not downloaded yet (${window.LocalAI.MODELS[phoneSize()].size}). Best on Wi-Fi.`;
      $('#phone-download').hidden = have; $('#phone-remove').hidden = !have;
    }
  };
  $('#engine').onchange = () => { store.set('engine2', $('#engine').value); syncEngine(); };
  $('#phone-compat').onchange = () => { window.LocalAI.setCompat($('#phone-compat').checked); window.LocalAI.reset(); syncEngine(); };
  $('#phone-size').onchange = () => { store.set('phoneSize', $('#phone-size').value); syncEngine(); };
  $('#phone-download').onclick = async () => {
    const st = $('#phone-status'); $('#phone-download').disabled = true;
    try {
      $('#phone-bar-wrap').hidden = false;
      await window.LocalAI.load(phoneSize(), p => { st.textContent = progressText(p); setBar('#phone-bar-wrap', '#phone-bar', p.progress); });
      $('#phone-bar-wrap').hidden = true;
      st.textContent = '✓ Downloaded. The AI now works on your phone without internet.';
    } catch (e) { st.textContent = '✗ ' + errText(e); $('#phone-bar-wrap').hidden = true; }
    $('#phone-download').disabled = false; syncEngine();
  };
  $('#phone-remove').onclick = async () => {
    const b = $('#phone-remove');
    if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Tap again to remove it'; return; }
    delete b.dataset.sure; b.textContent = 'Remove the AI from the phone';
    try { await window.LocalAI.remove(phoneSize()); } catch {}
    syncEngine();
  };
  $('#phone-test').onclick = async () => {
    const out = $('#phone-test-out'); const b = $('#phone-test'); b.disabled = true;
    try {
      const sup = await window.LocalAI.support();
      out.textContent = sup.ok ? `✓ This phone can run the AI${sup.f16 ? '' : ' (a little slower mode)'}.\nStarting…` : '✗ ' + sup.why;
      if (!sup.ok) return;
      $('#phone-bar-wrap').hidden = false;
      const t0 = Date.now(); let t1 = 0;
      const r = await window.LocalAI.generate({
        size: phoneSize(), maxTokens: 200,
        system: 'أجب بكائن JSON فقط.',
        user: 'اكتب {"تعريف":"..."} فيه تعريف الحديث الصحيح في سطر واحد.',
        onProgress: p => { out.textContent = progressText(p); setBar('#phone-bar-wrap', '#phone-bar', p.progress); },
        onText: t => { t1 ||= Date.now(); out.textContent = 'Writing: ' + t; },
      });
      const secs = ((Date.now() - (t1 || t0)) / 1000).toFixed(1);
      const words = r.text.split(/\s+/).length;
      out.textContent = `✓ The AI works on your phone.\nAnswer: ${r.text}\nSpeed: about ${ar(Math.round(words / Math.max(0.5, secs) * 60))} words a minute.`;
    } catch (e) { out.textContent = '✗ ' + errText(e); }
    finally { b.disabled = false; $('#phone-bar-wrap').hidden = true; syncEngine(); }
  };
  window.__syncEngine = syncEngine;
  // appearance and defaults
  $('#ui-lang').value = window.ZadLang || 'en';
  $('#ui-lang').onchange = () => { store.set('uiLang', $('#ui-lang').value); location.reload(); };
  $('#theme').value = store.get('theme', 'navy');
  $('#theme').onchange = () => { store.set('theme', $('#theme').value); applyTheme(); };
  $('#lang-default').value = store.get('langDefault', 'auto');
  $('#lang-default').onchange = () => { store.set('langDefault', $('#lang-default').value); $('#lang').value = $('#lang-default').value; };
  $('#lang').value = store.get('langDefault', 'auto');
  $('#find-tasks').checked = store.get('findTasks', true);
  $('#find-tasks').onchange = () => store.set('findTasks', $('#find-tasks').checked);
  $('#server-check').onclick = checkServer;
  $('#gh-key').value = store.get('ghKey', '');
  $('#save-gh').onclick = async () => {
    store.set('ghKey', $('#gh-key').value.trim());
    const st = $('#gh-status');
    if (!store.get('ghKey')) { st.textContent = 'Saving to your storage is off.'; return; }
    st.textContent = 'Testing…';
    try {
      await cloud.test();
      st.textContent = '✓ Connected. Uploading your lessons and fetching what is stored…';
      const n = await cloud.pull();
      const all = await idb.all(); const k = store.get('ghShas', {});
      all.filter(l => !k[l.id]).forEach(l => cloud.push(l));
      st.textContent = `✓ Connected to your private storage.${n ? ' Fetched ' + ar(n) + ' lessons.' : ''}`;
    } catch (e) { st.textContent = '✗ ' + e.message; }
  };
  $('#test-key').onclick = async () => {
    store.set('key', $('#api-key').value.trim());
    $('#key-status').textContent = 'Testing…';
    try {
      const r = await callClaude({ system: 'أجب بكلمة واحدة.', messages: [{ role: 'user', content: 'قل: يعمل' }], maxTokens: 20, model: 'claude-sonnet-5-5' });
      $('#key-status').textContent = '✓ The key works. (' + r.text.trim() + ')';
    } catch (e) { $('#key-status').textContent = '✗ ' + e.message; }
  };
}
function renderSpend() {
  const s = store.get('spend', { usd: 0, runs: 0 });
  $('#spend').textContent = s.runs
    ? `About ${ar((s.usd * SAR).toFixed(2))} SAR over ${ar(s.runs)} runs.`
    : 'Nothing yet.';
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
  if (!key) throw new Error('No key yet. Add it in Settings first.');
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
    throw new Error('Could not connect. Check the internet and try again.');
  }
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json())?.error?.message || ''; } catch {}
    if (res.status === 401) throw new Error('The key is not correct. Copy it again from console.anthropic.com and paste it in Settings.');
    if (res.status === 400 && /credit|balance|billing/i.test(msg)) throw new Error('Your credit ran out. Add credit at console.anthropic.com → Billing.');
    if (res.status === 429) throw new Error('Too many requests at once. Wait a minute and try again.');
    if (res.status === 529 || res.status >= 500) throw new Error('The service is busy. Try again in a few minutes.');
    throw new Error('Error (' + res.status + '): ' + msg);
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
      else if (ev.type === 'error') throw new Error('The answer was cut off: ' + (ev.error?.message || ''));
    }
  }
  const usd = addSpend(model, usage);
  return { text, usage, usd, stop, model };
}

function parseJSON(text) {
  let t = String(text || '').replace(/```(?:json)?/gi, '').replace(/<think>[\s\S]*?<\/think>/g, '');
  const a = t.indexOf('{');
  if (a < 0) throw new Error('no json');
  t = t.slice(a);
  try { return JSON.parse(t.slice(0, t.lastIndexOf('}') + 1)); } catch {}
  return JSON.parse(repairJSON(t));
}
// close what a cut-off or slightly broken answer left open
function repairJSON(t) {
  let out = '', stack = [], inStr = false, esc = false;
  for (const ch of t) {
    if (inStr) {
      if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false;
      else if (ch === '\n') { out += '\\n'; continue; }
      out += ch; continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') { if (stack.at(-1) === ch) stack.pop(); else continue; }
    out += ch;
  }
  if (inStr) out += '"';
  out = out.replace(/[,:\s]+$/, '').replace(/,\s*([}\]])/g, '$1');
  out = out.replace(/"[^"]*"\s*$/, m => /[{,]\s*"[^"]*"\s*$/.test(out) ? '' : m).replace(/[,\s]+$/, '');
  return out + stack.reverse().join('');
}
/* ---------- the app's own free server ---------- */
let serverUrl = null;
async function getServer() {
  if (serverUrl) return serverUrl;
  try { const j = await (await fetch('server.json', { cache: 'no-cache' })).json(); serverUrl = j.url.replace(/\/$/, ''); store.set('serverUrl', serverUrl); }
  catch { serverUrl = store.get('serverUrl', null); }
  if (!serverUrl) throw Object.assign(new Error('The app server is not set up yet. Finish the server steps I sent you, then try again.'), { code: 'noserver' });
  return serverUrl;
}
// one call to the app's server; the answer streams back as it is written
async function serverFetch(path, init = {}) {
  const base = await getServer();
  const uk = store.get('userKey', '');  // a person's own free AI key: their own daily limit
  if (uk) init = { ...init, headers: { ...(init.headers || {}), 'x-user-key': uk } };
  let res;
  try { res = await fetch(base + path, init); }
  catch (e) {
    if (e.name === 'AbortError') throw e;
    throw Object.assign(new Error('No internet connection right now.'), { code: 'offline' });
  }
  if (!res.ok) {
    let j = {}; try { j = await res.json(); } catch {}
    if (j.code === 'quota') throw Object.assign(new Error(store.get('userKey') ? 'Your own free daily AI limit is used up. It resets every day at about 10–11 am Saudi time.' : 'The shared free daily AI limit is used up. It resets every day at about 10–11 am Saudi time. Tip: add your own free AI key in Settings → AI key, to get your own limit.'), { code: 'quota' });
    if (j.code === 'toolong') throw Object.assign(new Error('Too big for one go. Choose fewer pages or a shorter file.'), { code: 'toolong' });
    if ((j.code === 'key' || j.code === 'nokey') && store.get('userKey')) throw Object.assign(new Error('Your own AI key is not working. Check it in Settings → AI key, or remove it.'), { code: 'key' });
    if (j.code === 'key' || j.code === 'nokey') throw Object.assign(new Error('The server key is wrong or not added yet. Finish the server setup steps.'), { code: 'key' });
    if (j.code === 'owner') throw Object.assign(new Error('wrong code'), { code: 'owner', status: 403 });
    if (j.code === 'bad') throw Object.assign(new Error('The AI refused this request.'), { code: 'bad', status: 400, detail: j.error || '' });
    throw Object.assign(new Error('The server could not write right now (' + (res.status) + '). Try again in a few minutes.'), { code: 'server', status: res.status });
  }
  return res;
}
async function callServer({ system, user, maxTokens = 30000, onText, signal, json = true }) {
  const res = await serverFetch('/write', { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ system, user, maxTokens, json }) });
  return readStream(res, onText);
}
async function readStream(res, onText) {
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '', text = '', stop = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
      const c = ev.candidates?.[0];
      const t = (c?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
      if (t) { text += t; onText?.(text); }
      if (c?.finishReason) stop = c.finishReason;
    }
  }
  return { text, usd: 0, stop: stop === 'MAX_TOKENS' ? 'max_tokens' : stop };
}
// the strong AI: the free server, or Claude with the owner's own key
async function callBig({ system, messages, onText, signal, maxTokens }) {
  if (engineKind() === 'claude') return callClaude({ system, messages, onText, signal, maxTokens });
  return callServer({ system, user: messages.map(m => m.content).join('\n\n'), onText, signal, maxTokens });
}

async function getJSON(text, signal) {
  try { return parseJSON(text); }
  catch (e) {
    if (engineKind() !== 'claude') throw e;
    // one repair attempt with the cheaper model
    const r = await callClaude({
      system: 'أنت مصلح JSON. أعد النص نفسه كائن JSON صالحًا فقط، دون تغيير أي محتوى، وأغلق ما لم يُغلق.',
      messages: [{ role: 'user', content: text }], model: 'claude-sonnet-5-5', signal,
    });
    return parseJSON(r.text);
  }
}

/* ---------- hearing: audio, video and YouTube → transcript ---------- */
const cleanHeard = t => String(t || '').replace(/\[\[(NOSPEECH|END)\]\]/g, '').trim();
async function hearPiece(piece, signal, onText) {
  const res = await serverFetch('/transcribe?mime=' + encodeURIComponent(piece.mime), {
    method: 'POST', signal, headers: { 'content-type': piece.mime }, body: piece.blob,
  });
  return readStream(res, onText);
}
// a whole audio or video file, piece by piece
async function hearFile(item, signal, onStatus) {
  if (item.images) {
    const out = [];
    for (let i = 0; i < item.images.length; i++) {
      const f = item.images[i];
      onStatus(item.images.length > 1 ? `Reading page ${i + 1} of ${item.images.length}…` : 'Reading the photo…');
      const blob = await shrinkImage(f);
      const r = await hearPiece({ blob, mime: blob.type || 'image/jpeg' }, signal, () => {});
      out.push(cleanHeard(r.text));
    }
    return out.filter(Boolean).join('\n\n');
  }
  onStatus('Taking out the sound…');
  const prep = await window.JundMedia.prepare(item.file, f => onStatus('Taking out the sound… ' + ar(Math.round(f * 100)) + '%'), signal);
  item.audio = prep.audio || null;
  const out = [];
  for (let i = 0; i < prep.pieces.length; i++) {
    const pre = prep.pieces.length > 1 ? `Transcribing part ${ar(i + 1)} of ${ar(prep.pieces.length)}` : 'Transcribing';
    onStatus(pre + '… (uploading the sound)');
    let r, tries = 0;
    for (;;) {
      try {
        r = await hearPiece(prep.pieces[i], signal, t => onStatus(`${pre}… ${ar(t.split(/\s+/).filter(Boolean).length)} words`));
        break;
      } catch (e) {
        if (signal?.aborted || e.code === 'offline' || e.code === 'key' || e.code === 'quota' || ++tries >= 2) throw e;
        onStatus(pre + '… failed, trying again');
      }
    }
    out.push(cleanHeard(r.text));
  }
  return out.filter(Boolean).join('\n\n');
}
// big phone photos are made smaller first (faster upload, same text)
async function shrinkImage(f) {
  try {
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
    if (k === 1 && f.size < 3e6 && /jpe?g|png|webp/.test(f.type)) return f;
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
  } catch { return f; }
}
// a YouTube video, 15 minutes at a time, until the video ends (up to 4 hours)
async function hearYouTube(item, signal, onStatus) {
  const STEP = 900, out = [];
  for (let w = 0; w < 16; w++) {
    const start = w * STEP, end = start + STEP;
    const pre = `Transcribing minutes ${ar(start / 60)}–${ar(end / 60)}`;
    onStatus(pre + '…');
    let r;
    try {
      const res = await serverFetch('/youtube', { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: item.yt, start, end }) });
      r = await readStream(res, t => onStatus(`${pre}… ${ar(t.split(/\s+/).filter(Boolean).length)} words`));
    } catch (e) {
      if (w > 0 && e.code === 'bad') break;  // asked past the end of the video
      if (e.code === 'bad') throw Object.assign(new Error('The AI could not open this video. It may be private, unlisted or blocked. Download it with Idarat al-Malafat, then share it to the app.'), { code: 'yt' });
      throw e;
    }
    const ended = /\[\[END\]\]/.test(r.text);
    const t = cleanHeard(r.text);
    if (t) out.push(t);
    if (ended || (!t && w > 0)) break;
  }
  return out.join('\n\n');
}
async function ytList(lines) {
  const items = [];
  for (const raw of lines) {
    let u; try { u = new URL(raw.trim()); } catch { continue; }
    const list = u.searchParams.get('list'), v = u.searchParams.get('v') || (/youtu\.be$/.test(u.hostname) ? u.pathname.slice(1) : '');
    if (list && !v) {
      const r = await serverFetch('/playlist?list=' + encodeURIComponent(list), { method: 'GET' });
      const j = await r.json();
      j.items.forEach((it, i) => items.push({ yt: 'https://www.youtube.com/watch?v=' + it.id, unit: it.title || `${j.title} ${ar(i + 1)}` }));
      if (j.items.length >= 15) items.push({ note: 'YouTube gives only the latest 15 videos of a playlist; paste the links of the others.' });
      continue;
    }
    let title = '';
    try { title = (await (await serverFetch('/ytmeta?url=' + encodeURIComponent(u.href), { method: 'GET' })).json()).title; } catch {}
    items.push({ yt: u.href, unit: title || 'YouTube video' });
  }
  return items;
}

/* ---------- note language: Arabic or English ---------- */
const langOf = text => {
  const a = (String(text).match(/[؀-ۿ]/g) || []).length, l = (String(text).match(/[A-Za-z]/g) || []).length;
  return l > a ? 'en' : 'ar';
};
const pickLang = text => { const v = $('#lang')?.value || 'auto'; return v === 'auto' ? langOf(text) : v; };

/* ---------- progress bar and readable errors ---------- */
function setBar(wrapSel, barSel, frac) {
  const w = $(wrapSel), b = $(barSel); if (!w || !b) return;
  if (frac == null || !isFinite(frac)) { w.classList.add('busy'); return; }
  w.classList.remove('busy'); b.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
}
function errText(e) {
  if (!e) return 'Something went wrong.';
  if (e.name === 'AbortError' && !/GPU|mapAsync|Buffer/i.test(e.message || '')) return 'Stopped.';
  let raw = (e.message || (typeof e === 'string' ? e : '') || e.name || '').toString();
  if (!raw) { try { raw = JSON.stringify(e); } catch { raw = String(e); } if (raw === '{}' || raw === '[object Object]') raw = ''; }
  if (e.message === 'no json' || e instanceof SyntaxError) return 'The answer came back incomplete or messy. Try again.';
  if (e.code) return e.message;
  if (/out of memory|OOM|allocate|device (was )?lost|DXGI|GPUDevice|GPU|mapAsync|Buffer was/i.test(raw)) return 'The phone AI stopped: either memory ran out, or the screen turned off or you left the app while it was writing.\nClose other apps, keep the screen on and the app in front, choose fewer pages, and try again.\n(' + raw.slice(0, 120) + ')';
  if (/quota|storage|space/i.test(raw)) return 'Not enough space on the phone for the download. Free some space and try again.\n(' + raw.slice(0, 160) + ')';
  if (/fetch|network|Failed to fetch|NetworkError|load failed/i.test(raw)) return 'The internet dropped during the download. Connect to Wi-Fi and try again; it continues where it stopped.\n(' + raw.slice(0, 160) + ')';
  return raw ? 'Error: ' + raw.slice(0, 300) : 'Something went wrong. Send me a screenshot of this message.';
}

/* ---------- which AI writes the notes ---------- */
const engineKind = () => store.get('engine2', 'server');       // 'server' (free app server), 'phone' (on this phone, trial) or 'claude' (own key)
const phoneSize = () => store.get('phoneSize', 'fast');
function progressText(p) {
  if (p.text === 'restart') return 'Restarting the AI in compatibility mode (downloads a compatible copy once)…';
  const pct = Math.round((p.progress || 0) * 100);
  return /fetch|download|param|cache/i.test(p.text || '') && pct < 100
    ? `Downloading the AI to your phone (only once)… ${ar(pct)}%`
    : `Getting the AI ready… ${ar(pct)}%`;
}

// cut a long text into parts the phone AI can read at once, on sentence ends
function splitText(text, maxWords = (window.LocalAI?.isLite?.() ? 450 : 650)) {
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
    const pre = parts.length > 1 ? `Part ${ar(i + 1)} of ${ar(parts.length)}: ` : '';
    const expect = Math.max(250, parts[i].split(/\s+/).length * 0.55);
    const eta = () => {
      if (i === 0) return '';
      const per = (t0 - firstPartStart) / i, left = Math.round(per * (parts.length - i) / 60000);
      return left >= 1 ? `About ${ar(left)} min left` : 'Almost done';
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
          onStatus(`${pre}Writing on your phone… ${ar(w)} words — ${ar(Math.floor(s / 60))}:${ar(String(s % 60).padStart(2, '0'))}`,
            (i + Math.min(0.95, w / expect)) / parts.length, 'write', eta());
        },
      });
    } catch (e) {
      if (controller.signal.aborted || !results.length) throw e;
      partial = `⚠ Stopped at part ${ar(i + 1)} of ${ar(parts.length)} (${errText(e).split('\n')[0]}). What was finished is saved; make the remaining pages on their own.`;
      break;
    }
    if (r.stop === 'max_tokens') cut = true;
    try { results.push(parseJSON(r.text)); }
    catch { results.push({ report: { maybe_wrong: [`Part ${ar(i + 1)} could not be read; make it again if something is missing.`] } }); }
  }
  return { notes: mergeParts(results), cut, partial };
}

/* ---------- making notes ---------- */
let current = null;   // the open lesson
let controller = null;

function subjectInfo() {
  const v = $('#subject').value;
  if (v.startsWith('mine:')) { const name = v.slice(5); return { id: 'other:' + name, name, place: '', family: 'slate' }; }
  if (v === 'other') {
    const name = $('#custom-subject').value.trim() || (workMode() ? 'General' : 'Other subject');
    // remember it, so next time it is in the list
    const mine = store.get('mySubjects', []);
    if (!mine.includes(name)) { mine.push(name); store.set('mySubjects', mine); store.set('lastSubject', 'mine:' + name); setTimeout(fillSubjects, 0); }
    return { id: 'other:' + name, name, place: '', family: 'slate' };
  }
  const s = subjectById(v);
  return { ...s, family: familyOf(s) };
}

function countWords() {
  const n = $('#transcript').value.trim().split(/\s+/).filter(Boolean).length;
  $('#word-count').textContent = n ? ar(n) + ' words' : '';
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
  const tools = (p, i) => p.media && p.text && !p.busy ? `<div class="row-gap media-tools">
      <button type="button" class="ghost small" data-act="script" data-i="${i}">Clean script</button>
      <button type="button" class="ghost small" data-act="minutes" data-i="${i}">Meeting minutes</button>
      <button type="button" class="ghost small" data-act="savetxt" data-i="${i}">Save transcript</button>
      ${p.audio ? `<button type="button" class="ghost small" data-act="audio" data-i="${i}">Export audio</button>` : ''}
    </div>` : '';
  box.innerHTML = pending.length ? `<b>${pending.length > 1 ? ar(pending.length) + ' lessons will be made, one per file:' : 'Chosen file:'}</b>
    <ol>${pending.map((p, i) => `<li>${esc(p.unit)} <small class="muted">(${p.pages ? ar(p.pages.length) + ' pages, ' : ''}${p.media && !p.text ? (p.yt ? 'YouTube' : 'audio or video') : ar(p.text.split(/\s+/).filter(Boolean).length) + ' words'})</small>${p.status ? ' — <span class="st">' + p.status + '</span>' : ''}${tools(p, i)}</li>`).join('')}</ol>
    ${hearNote ? `<small class="muted">${hearNote}</small>` : ''}
    ${one?.pages && !one.bad ? `<div class="row-gap" style="align-items:center">
      <span>Pages: from</span><input id="pg-from" type="number" min="1" max="${one.pages.length}" value="${one.from}" style="width:5.5em">
      <span>to</span><input id="pg-to" type="number" min="1" max="${one.pages.length}" value="${one.to}" style="width:5.5em">
    </div><small class="muted" id="pg-warn" ${one.to - one.from + 1 > 20 ? '' : 'hidden'}>⚠ Many pages take a long time on the phone; 10–20 pages at a time is best.</small>` : ''}
    <button type="button" class="ghost" id="clear-pending">Clear files</button>` : '';
  const c = $('#clear-pending'); if (c) c.onclick = () => { hearCtl?.abort(); pending = []; hearNote = ''; renderPending(); };
  $$('[data-act]', box).forEach(b => b.onclick = () => mediaAction(b.dataset.act, pending[+b.dataset.i]));
  const f = $('#pg-from'), t = $('#pg-to');
  if (f && t) {
    const upd = () => {
      const n = one.pages.length;
      one.from = Math.min(Math.max(1, parseInt(f.value) || 1), n);
      one.to = Math.min(Math.max(one.from, parseInt(t.value) || n), n);
      one.text = pdfSlice(one);
      one.unit = one.baseUnit + (one.from === 1 && one.to === n ? '' : ` (pp. ${ar(one.from)}–${ar(one.to)})`);
      const li = $('#pending li'); // update the line only, so typing is not interrupted
      if (li) li.innerHTML = `${esc(one.unit)} <small class="muted">(${ar(one.to - one.from + 1)} of ${ar(n)} pages, ${ar(one.text.split(/\s+/).filter(Boolean).length)} words)</small>`;
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

/* audio, video and YouTube items: transcribed one after another, then they are ordinary lessons */
let hearCtl = null, hearNote = '';
const hearing = () => pending.some(p => p.busy || (p.media && !p.text && !p.bad));
async function hearAll() {
  if (hearCtl) return;               // already running; it picks up new items itself
  hearCtl = new AbortController();
  const lock = await keepAwake();
  try {
    let p;
    while ((p = pending.find(x => x.media && !x.text && !x.bad && !x.busy))) {
      const offline = !navigator.onLine || (store.get('hearOn', 'auto') === 'phone' && !p.yt && !p.images);
      if (offline && p.images) { p.bad = true; p.status = '✗ Reading photos needs the internet. Connect, then add them again.'; renderPending(); continue; }
      if (offline && p.yt) { p.bad = true; p.status = '✗ YouTube needs the internet. Connect, then add it again.'; renderPending(); continue; }
      if (offline && !(await window.JundOffline?.ready())) { p.bad = true; p.status = '✗ No internet, and offline transcription is not downloaded yet (Settings → Offline transcription).'; renderPending(); continue; }
      p.busy = true;
      const st = s => { p.status = '⏳ ' + s; const li = $$('#pending li')[pending.indexOf(p)]; const el = li && $('.st', li); if (el) el.textContent = p.status; else renderPending(); };
      try {
        const text = p.yt ? await hearYouTube(p, hearCtl.signal, st)
          : offline ? await window.JundOffline.transcribe(p, hearCtl.signal, st)
          : await hearFile(p, hearCtl.signal, st);
        if (!text) { p.bad = true; p.status = '✗ No speech was heard in this file.'; }
        else { p.text = text; p.status = '✓ Transcribed'; }
      } catch (e) {
        if (hearCtl.signal.aborted) break;
        p.bad = true; p.status = '✗ ' + errText(e);
      } finally { p.busy = false; }
      renderPending();
    }
  } finally {
    lock?.release?.(); hearCtl = null;
    if (pending.length) renderPending();
  }
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
const safeName = s => String(s || 'file').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80);
async function mediaAction(act, p) {
  if (!p) return;
  if (act === 'savetxt') return download(new Blob([p.text], { type: 'text/plain;charset=utf-8' }), safeName(p.unit) + '.txt');
  if (act === 'audio' && p.audio) return download(p.audio, safeName(p.unit) + (p.audio.type === 'audio/aac' ? '.aac' : (p.file?.name.match(/\.[^.]+$/)?.[0] || '.m4a')));
  if (act === 'script') return makeScript(p);
  if (act === 'minutes') return makeScript(p, true);
}

/* transcript → a clean script (same language, nothing added) */
const SCRIPT_RULES = {
  ar: `أنت تحوّل تفريغًا صوتيًا آليًا إلى نص مكتوب مرتب، بلغة التفريغ نفسها.
- احفظ كلام المتكلم ومعناه كما هو. أصلح أخطاء السماع الواضحة فقط.
- احذف التكرار وكلمات الحشو والجمل المقطوعة.
- قسّم النص إلى فقرات قصيرة، وضع عناوين للأقسام في أسطر تبدأ بـ "## ".
- إن كان هناك أكثر من متكلم فاكتب اسم أو صفة المتكلم في أول كلامه (مثل: الشيخ: / طالب:).
- الآيات والأحاديث والأبيات بنصها الصحيح.
- لا تلخّص، ولا تضف شيئًا، ولا تترجم.
أعد النص المرتب فقط.`,
  en: `You turn an automatic speech transcript into a clean written script, in the same language as the transcript.
- Keep the speaker's words and meaning. Fix only obvious mishearings.
- Remove repetitions, filler words and broken-off sentences.
- Split into short paragraphs, with section headings on lines starting with "## ".
- If there are several speakers, start each turn with the speaker's name or role (e.g. "Teacher:").
- Keep quotes, verses and poetry exact.
- Do not summarize, add anything, or translate.
Return only the clean script.`,
};
const MINUTES_RULES = {
  ar: `أنت تكتب محضر اجتماع من تفريغ صوتي آلي، بلغة التفريغ نفسها. نص عادي بلا JSON.
اكتب بهذا الترتيب، كل عنوان في سطر يبدأ بـ "## ":
## الخلاصة (ثلاثة أسطر)
## ما نوقش (نقاط تبدأ بـ "- ")
## القرارات
## المهام (كل سطر: المهمة — المسؤول — الموعد)
## الموعد القادم (إن ذُكر)
لا تضف شيئًا لم يُقل. إن لم يُعرف المسؤول أو الموعد فاكتب "غير محدد".`,
  en: `You write meeting minutes from an automatic transcript, in the same language. Plain text, no JSON.
Use this order, each heading on a line starting with "## ":
## Summary (three lines)
## What was discussed (points starting with "- ")
## Decisions
## Action items (each line: task — who — when)
## Next meeting (if mentioned)
Add nothing that was not said. If who or when is unknown, write "not set".`,
};
async function makeScript(p, minutes = false) {
  const box = $('#script-box'), out = $('#script-text');
  box.hidden = false; $('#script-title').textContent = (minutes ? 'Meeting minutes: ' : 'Clean script: ') + p.unit;
  out.value = ''; $('#script-status').textContent = 'Working…';
  box.scrollIntoView({ block: 'start' });
  const lang = langOf(p.text);
  out.dir = lang === 'en' ? 'ltr' : 'rtl';
  try {
    const parts = minutes ? [p.text] : splitText(p.text, 2500), done = [];
    for (let i = 0; i < parts.length; i++) {
      const r = await callServer({ system: (minutes ? MINUTES_RULES : SCRIPT_RULES)[lang], user: parts[i], json: false, maxTokens: 30000,
        onText: t => { out.value = [...done, t].join('\n\n'); $('#script-status').textContent = parts.length > 1 ? `Part ${ar(i + 1)} of ${ar(parts.length)}…` : 'Writing…'; } });
      done.push(r.text.trim());
    }
    out.value = done.join('\n\n');
    p.script = out.value;
    $('#script-status').textContent = '✓ Ready.';
  } catch (e) { $('#script-status').textContent = errText(e); }
}
$('#script-copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('#script-text').value); $('#script-status').textContent = '✓ Copied.'; }
  catch { $('#script-text').select(); $('#script-status').textContent = 'Text selected; copy it from the menu.'; }
};
$('#script-save').onclick = () => download(new Blob([$('#script-text').value], { type: 'text/plain;charset=utf-8' }), safeName($('#script-title').textContent.replace(/:.*/, '') + ' - ' + $('#script-title').textContent.replace(/^[^:]*:\s*/, '')) + '.txt');
$('#script-close').onclick = () => { $('#script-box').hidden = true; };

$('#yt-go').onclick = async () => {
  const err = $('#new-error'); err.hidden = true;
  const lines = $('#yt').value.split(/\s+/).filter(s => /youtu/.test(s));
  if (!lines.length) { err.textContent = 'Paste a YouTube link first.'; err.hidden = false; return; }
  $('#yt-go').disabled = true; $('#yt-go').textContent = 'Reading…';
  try {
    const items = await ytList(lines);
    const notes = items.filter(x => x.note).map(x => x.note);
    const vids = items.filter(x => x.yt);
    if (!vids.length) throw new Error('I found no video in these links.');
    pending = pending.filter(p => p.media || p.text).concat(vids.map(v => ({ media: true, yt: v.yt, unit: v.unit, text: '', status: '⏳ Waiting' })));
    hearNote = notes[0] || '';
    $('#yt').value = '';
    $('#kind').value = 'transcript';
    renderPending();
    hearAll();
  } catch (e) { err.textContent = errText(e); err.hidden = false; }
  finally { $('#yt-go').disabled = false; $('#yt-go').textContent = 'Add'; }
};

async function addFiles(files) {
  hearCtl?.abort();
  pending = []; hearNote = '';
  const box = $('#pending'); box.hidden = false; box.textContent = 'Reading the files…';
  let sawPdf = false, sawMedia = false;
  // photos of pages (book, whiteboard, handwriting): read together, as one lesson
  const imgs = files.filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
  if (imgs.length) { sawMedia = true; files = files.filter(f => !imgs.includes(f)); pending.push({ media: true, images: imgs, unit: imgs.length > 1 ? 'Photos of ' + imgs.length + ' pages' : imgs[0].name.replace(/\.[^.]+$/, ''), text: '', status: '⏳ Waiting' }); }
  for (const f of files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
    const unit = f.name.replace(/\.[^.]+$/, '');
    if (window.JundMedia?.isMedia(f)) { sawMedia = true; pending.push({ media: true, file: f, unit, text: '', status: '⏳ Waiting' }); continue; }
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
        item.status = '✗ This is a scanned file (pictures with no text), so I cannot read it yet. Use a text PDF, or copy the text and paste it.';
      }
      pending.push(item);
    } catch {
      pending.push({ text: '', unit, bad: true, status: '✗ This file could not be opened. It may be password-protected or damaged.' });
    }
  }
  if (pending.length === 1 && $('#unit').value) pending[0].unit = pending[0].baseUnit = $('#unit').value;
  if (sawPdf && $('#kind').value === 'transcript') $('#kind').value = 'book';
  if (sawMedia) $('#kind').value = 'transcript';
  renderPending();
  if (sawMedia) hearAll();
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
  meeting: { name: 'تفريغ الاجتماع', ask: 'هذا تفريغ آلي لاجتماع. اكتب منه محضر الاجتماع بالشكل نفسه (sections وblocks): قسم «الخلاصة»، ثم «ما نوقش» نقطة نقطة، ثم «القرارات»، ثم «المهام» في جدول (المهمة | المسؤول | الموعد)، ثم «الموعد القادم» إن ذُكر. اذكر المتكلمين بأسمائهم إن عُرفت. وضع كل مهمة أيضًا في tasks. لا تضف شيئًا لم يُقل:' },
  book: { name: 'النص', ask: 'هذا مقطع من كتاب أو موضوع مكتوب. حوّله إلى ملاحظات بطريقة الطالب: الملف الدراسي والخريطة الذهنية وتقرير التحقق. التزم بنص المقطع وحده، واحفظ عبارات المؤلف المهمة بين «» ونسبتها إليه، واذكر أرقام الصفحات إن وُجدت:' },
};

const SOURCE_TEXT_EN = {
  transcript: { name: 'TRANSCRIPT', ask: 'This is an automatic transcript of a recorded lesson. Write the study file, the mind map and the check report for this lesson only:' },
  notes: { name: 'NOTES', ask: 'These are notes the student wrote himself (not a speech transcript, so do not assume mishearings). Rewrite them in his way: the study file, the mind map and the check report. Stay with what is in them and add nothing:' },
  meeting: { name: 'MEETING TRANSCRIPT', ask: 'This is an automatic transcript of a meeting. Write the meeting minutes in the same shape (sections and blocks): a "Summary" section, then "What was discussed" point by point, then "Decisions", then "Action items" as a table (Task | Who | When), then "Next meeting" if mentioned. Name the speakers if known. Put every action item in tasks as well. Add nothing that was not said:' },
  book: { name: 'TEXT', ask: 'This is a passage from a book or a written topic. Turn it into notes in the student\'s way: the study file, the mind map and the check report. Stay with the passage only, keep the author\'s key sentences in quotes and attribute them, and mention page numbers if present:' },
};

async function makeOne({ text, unit, sub, kind, lang, id }, onStatus) {
  lang ||= langOf(text);
  const en = lang === 'en';
  const src = (en ? SOURCE_TEXT_EN : SOURCE_TEXT)[kind] || (en ? SOURCE_TEXT_EN : SOURCE_TEXT).transcript;
  let notes, note;
  if (engineKind() === 'phone') {
    const r = await writeOnPhone({ text, unit, sub, src }, onStatus);
    notes = r.notes;
    note = 'Ready. Written on your phone for free.' + (r.cut ? '\n⚠ One part ran long, so its end may be missing.' : '') + (r.partial ? '\n' + r.partial : '');
  } else {
    const t0 = Date.now();
    const user = en ? `Subject: ${sub.name}${sub.book ? ' (book: ' + sub.book + ')' : ''}
Lesson / unit: ${unit}
Input type: ${src.name}
${workMode() ? 'User' : 'Student'}: ${me().name || 'the user'}${me().study ? (workMode() ? ' — works as: ' : ' — studies at: ') + me().study : ''}
Today's date: ${todayISO()} (${new Date().toLocaleDateString('en-GB', { weekday: 'long' })})

${src.ask}

<<<${src.name}
${text}
${src.name}>>>` : `المادة: ${sub.name}${sub.book ? ' (الكتاب: ' + sub.book + ')' : ''}${sub.place ? ' — ' + sub.place : ''}
الدرس / الوحدة: ${unit}
نوع المدخل: ${src.name}
الطالب: ${me().nameAr || me().name || 'الطالب'}${me().study ? ' — يدرس في: ' + me().study : ''}
تاريخ اليوم: ${todayISO()} (${['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'][new Date().getDay()]})

${src.ask}

<<<${src.name}
${text}
${src.name}>>>`;
    const expect = Math.max(400, text.split(/\s+/).length * 0.6);
    const r = await callBig({
      system: en ? window.JUND_METHOD_EN : window.JUND_METHOD,
      messages: [{ role: 'user', content: user }],
      signal: controller.signal,
      onText: t => {
        const w = t.split(/\s+/).length, mins = Math.floor((Date.now() - t0) / 60000);
        onStatus(`Writing… ${ar(w)} words${mins ? ' — ' + ar(mins) + ' min' : ''}`, Math.min(0.95, w / expect), 'write');
      },
    });
    onStatus('Laying out the pages…', 0.97, 'write');
    notes = await getJSON(r.text, controller.signal);
    note = (engineKind() === 'claude' ? `Ready. Cost about ${ar((r.usd * SAR).toFixed(2))} SAR.` : 'Ready. Written for free on the app server.') + (r.stop === 'max_tokens' ? '\n⚠ The text is very long, so it stopped before the end; the end may be missing. Split it in two.' : '');
  }
  if (!en) { onStatus('Checking verses against the Mushaf…', 1, 'write'); try { await window.Mushaf.check(notes); } catch {} }
  const lesson = {
    id: id || 'L' + Date.now() + Math.random().toString(36).slice(2, 6),
    subject: { id: sub.id, name: sub.name, place: sub.place || '', book: sub.book || '' },
    unit, kind, lang, engine: engineKind(), date: new Date().toISOString(), transcript: text, notes,
    chat: [{ who: 'ai', text: note }],
  };
  await saveLesson(lesson);
  return lesson;
}

/* ---------- offline queue: lessons pasted without internet are written when it returns ---------- */
const queue = { get: () => store.get('queue', []), set: q => store.set('queue', q) };
// without internet: a quick draft lesson now (plain paragraphs, no AI), rewritten in full later under the same id
async function saveDraft(j, sub, kind) {
  const paras = j.text.split(/\n\s*\n|(?<=[.؟!])\s+(?=\S)/).map(x => x.trim()).filter(Boolean);
  const groups = []; for (let i = 0; i < paras.length; i += 6) groups.push(paras.slice(i, i + 6).join(' '));
  const en = j.lang === 'en';
  const lesson = {
    id: 'L' + Date.now() + Math.random().toString(36).slice(2, 6), draft: true,
    subject: { id: sub.id, name: sub.name, place: sub.place || '', book: sub.book || '' },
    unit: j.unit, kind, lang: j.lang, engine: 'draft', date: new Date().toISOString(), transcript: j.text,
    notes: { title: j.unit, subtitle: en ? 'Quick draft — full notes come when you are online' : 'مسودة سريعة — تُكتب الملاحظات كاملة عند عودة الإنترنت',
      sections: groups.map((g, i) => ({ heading: (en ? 'Part ' : 'الجزء ') + (en ? i + 1 : arD(i + 1)), blocks: [{ t: 'text', text: g }] })), mindmap: [], report: {} },
    chat: [{ who: 'ai', text: 'Quick draft saved without internet. The full notes replace it automatically when you are back online.' }],
  };
  await saveLesson(lesson);
  return lesson.id;
}
function enqueue(jobs, sub, kind, ids = []) {
  const q = queue.get();
  jobs.forEach((j, k) => q.push({ text: j.text, unit: j.unit, lang: j.lang, kind, id: ids[k], sub: { id: sub.id, name: sub.name, place: sub.place || '', book: sub.book || '' } }));
  queue.set(q);
  if (queue.get().length < q.length) throw new Error('No space to keep the text on the phone. Choose fewer pages.');
  renderQueue();
}
function renderQueue(status) {
  const q = queue.get(), b = $('#queue-banner');
  b.hidden = !q.length;
  if (q.length) b.innerHTML = status || `<b>☁ ${ar(q.length)} ${q.length === 1 ? 'lesson is' : 'lessons are'} waiting for the internet.</b> A quick draft is in the Library; the full notes are written automatically when you are back online with the app open.`;
}
let queueBusy = false;
async function processQueue() {
  if (queueBusy || controller || !navigator.onLine || engineKind() === 'phone') return;
  let q = queue.get(); if (!q.length) return;
  queueBusy = true; controller = new AbortController();
  const lock = await keepAwake();
  let done = 0;
  try {
    while ((q = queue.get()).length) {
      const j = q[0];
      renderQueue(`<b>☁ Writing saved lessons (${ar(done + 1)} of ${ar(done + q.length)}):</b> ${esc(j.unit)}…`);
      try { await makeOne({ text: j.text, unit: j.unit, sub: j.sub, kind: j.kind, lang: j.lang, id: j.id }, () => {}); }
      catch (e) { if (e.code === 'offline' || controller.signal.aborted) break; j.tries = (j.tries || 0) + 1; if (j.tries < 3) { queue.set([...q.slice(1), j]); continue; } }
      queue.set(queue.get().slice(1)); done++;
    }
  } finally {
    lock?.release?.(); controller = null; queueBusy = false;
    renderQueue();
    if (done) { const b = $('#queue-banner'); b.hidden = false; b.innerHTML = `✓ ${ar(done)} saved ${done === 1 ? 'lesson was' : 'lessons were'} written in full. Open the <button type="button" class="link" data-go="library">Library</button>.`; }
  }
}
addEventListener('online', () => setTimeout(processQueue, 1500));

$('#make').onclick = async () => {
  const err = $('#new-error'); err.hidden = true;
  if (engineKind() === 'claude' && !store.get('key')) { show('settings'); $('#key-status').textContent = 'Paste your key here first, then tap Save.'; return; }
  if (engineKind() === 'phone') {
    const sup = await window.LocalAI.support();
    if (!sup.ok) { err.textContent = sup.why; err.hidden = false; return; }
  }
  if (hearing()) { err.textContent = 'Wait until the transcription finishes (see ⏳ above), then tap again.'; err.hidden = false; return; }
  const sub = subjectInfo();
  const kind = $('#kind').value;
  const jobs = pending.length ? pending : [{ text: $('#transcript').value.trim(), unit: $('#unit').value.trim() }];
  for (const j of jobs) j.lang = pickLang(j.text || '');
  if (engineKind() === 'phone' && jobs.some(j => j.lang === 'en')) { err.textContent = 'English notes are written on the app server only. Change “Who writes the notes?” in Settings.'; err.hidden = false; return; }
  if (jobs.length === 1 && pending.length === 1 && $('#unit').value.trim()) jobs[0].unit = $('#unit').value.trim();
  for (const j of jobs) j.unit ||= 'Lesson of ' + new Date().toLocaleDateString('en-GB');
  if (jobs.some(j => j.bad)) { err.textContent = 'One of the files cannot be read (see ✗ above). Remove it with “Clear files” or choose another.'; err.hidden = false; return; }
  if (jobs.some(j => j.text.length < 200)) { err.textContent = 'The text is too short. Paste all of it or choose more pages.'; err.hidden = false; return; }
  // long jobs on the phone: show the expected time and ask for a second tap
  if (engineKind() === 'phone') {
    const words = jobs.reduce((n, j) => n + j.text.split(/\s+/).filter(Boolean).length, 0);
    const partsN = jobs.reduce((n, j) => n + splitText(j.text).length, 0);
    const mins = Math.round(partsN * (phoneSize() === 'strong' ? 5 : 2.5));
    const box = $('#confirm-long');
    if (mins >= 15 && box.dataset.ok !== String(words)) {
      box.innerHTML = `<b>⚠ This is a long text:</b> ${ar(words)} words in ${ar(partsN)} parts. On your phone it takes about <b>${ar(mins)} minutes</b>, with the app open and the screen on the whole time (best with the phone charging).<br>For a first try choose only 3–5 pages. To go ahead anyway, tap “Make notes” again.`;
      box.hidden = false; box.dataset.ok = String(words);
      box.scrollIntoView({ block: 'center' });
      return;
    }
    box.hidden = true; delete box.dataset.ok;
  }
  if (engineKind() !== 'phone' && navigator.onLine === false) {
    try { const ids = []; for (const j of jobs) ids.push(await saveDraft(j, sub, kind)); enqueue(jobs, sub, kind, ids); } catch (e) { err.textContent = e.message; err.hidden = false; return; }
    pending = []; renderPending(); $('#transcript').value = ''; $('#unit').value = ''; countWords();
    err.textContent = 'No internet right now. A quick draft is saved in the Library, and the full notes are written automatically when you are back online.'; err.hidden = false;
    return;
  }
  $('#make').disabled = true; $('#progress').hidden = false;
  setBar('#progress-bar-wrap', '#progress-bar', 0); $('#progress-pct').textContent = '';
  $('#progress-eta').textContent = 'Keep the app open and the screen on until it finishes.';
  controller = new AbortController();
  const lock = await keepAwake();
  let last = null, failed = 0;
  try {
    for (let i = 0; i < jobs.length; i++) {
      const pre = jobs.length > 1 ? `(${ar(i + 1)} of ${ar(jobs.length)}) ${jobs[i].unit}: ` : '';
      const status = (s, frac, phase, eta) => {
        $('#progress-text').textContent = pre + s;
        if (phase === 'download') {
          setBar('#progress-bar-wrap', '#progress-bar', frac);
          $('#progress-pct').textContent = frac != null ? ar(Math.round(frac * 100)) + '%' : '';
          $('#progress-eta').textContent = 'This download happens only once. Keep Wi-Fi on.';
          return;
        }
        const all = frac == null ? null : (i + frac) / jobs.length;
        setBar('#progress-bar-wrap', '#progress-bar', all);
        $('#progress-pct').textContent = all != null ? ar(Math.round(all * 100)) + '%' : '';
        $('#progress-eta').textContent = (eta ? eta + ' — ' : '') + 'Keep the app open and the screen on.';
      };
      status('Reading and writing…');
      try {
        last = await makeOne({ ...jobs[i], sub, kind }, status);
        jobs[i].status = '✓ Ready';
      } catch (e) {
        if (controller?.signal.aborted) throw e;
        if (e.code === 'offline') {
          { const rest = jobs.slice(i), ids = []; for (const j of rest) ids.push(await saveDraft(j, sub, kind)); enqueue(rest, sub, kind, ids); }
          for (const jj of jobs.slice(i)) jj.status = '☁ Waiting for internet';
          throw Object.assign(new Error('The internet dropped. The rest is saved and will be written automatically when you are back online.'), { queued: true });
        }
        failed++; jobs[i].status = '✗ ' + errText(e);
        if (jobs.length === 1) throw e;
      }
      if (pending.length) renderPending();
    }
    if (failed) { err.textContent = `Finished, but ${ar(failed)} could not be made. The ready ones are in the Library; try the rest again.`; err.hidden = false; pending = pending.filter(p => !p.status?.startsWith('✓')); pending.forEach(p => delete p.status); renderPending(); }
    else { pending = []; renderPending(); $('#transcript').value = ''; $('#unit').value = ''; countWords(); }
    if (jobs.length > 1 && !failed) show('library');
    else if (last && !failed) await openLesson(last);
  } catch (e) {
    err.textContent = controller?.signal.aborted ? 'Stopped. Finished lessons are saved in the Library.' : e.queued ? e.message : errText(e);
    if (e.queued) { pending = pending.filter(p => !p.status?.startsWith('☁')); renderPending(); }
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
  h = h.replace(/\[See:?\s*([^\]]+)\]/g, (m, t) => `<span class="xref" data-ref="${esc(t.trim())}">[See: ${t.trim()}]</span>`);
  h = h.replace(/✓/g, '<span class="mark-ok">✓</span>').replace(/✗/g, '<span class="mark-no">✗</span>');
  return h.replace(/\n/g, '<br>');
}
const LABELS = { def: 'تعريف', explain: 'شرح', example: 'مثال', rule: 'فائدة', warn: '⚠ تنبيه' };
const LABELS_EN = { def: 'Definition', explain: 'Explanation', example: 'Example', rule: 'Key point', warn: '⚠ Note' };
// the language of the pages being drawn right now (each lesson keeps its own)
let curLang = 'ar';
const EN = () => curLang === 'en';
const tr = (a, e) => EN() ? e : a;
const num = n => EN() ? String(n) : arD(n);

function blockEl(b, cont = false) {
  const el = document.createElement('div');
  const tail = cont ? ` <small>${tr('(تابع)', '(cont.)')}</small>` : '';
  const t = b.t;
  if (t === 'heading') { el.className = 'b-h'; el.innerHTML = inline(b.text) + tail; el.dataset.sec = b.text; return el; }
  if (t === 'dua') { el.className = 'b-dua'; el.innerHTML = inline(b.text); return el; }
  if (t === 'appx-h') { el.className = 'b-appx-h'; el.innerHTML = inline(b.text); return el; }
  if (['def', 'explain', 'example', 'rule', 'warn'].includes(t)) {
    el.className = 'box b-' + t;
    let lbl = b.title || (EN() ? LABELS_EN : LABELS)[t];
    if (t === 'example') {
      if (b.verdict === 'correct') lbl = '✓ ' + lbl; else if (b.verdict === 'wrong') lbl = '✗ ' + lbl;
      if (b.illustrative) lbl += tr(' (توضيحي)', ' (illustrative)');
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
      '<ul>' + (b.items || []).map((it, i) => `<li><span class="m">${b.ordered !== false ? (marks[start + i] || num(start + i + 1) + '.') : '•'}</span><span>${inline(it)}</span></li>`).join('') + '</ul>';
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
  if (t === 'quote') { el.className = 'b-quote'; el.innerHTML = tr('«', '“') + inline(String(b.text).replace(/^[«“"]|[»”"]$/g, '')) + tr('»', '”') + (b.by ? ` <span class="by">— ${inline(b.by)}</span>` : ''); return el; }
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
  p.lang = curLang; p.dir = EN() ? 'ltr' : 'rtl';
  Object.entries(meta.palette).forEach(([k, v]) => p.style.setProperty(k, v));
  p.innerHTML = `
    <div class="pg-head">
      <div><div class="t">${inline(meta.title)}</div>${meta.subtitle ? `<div class="s">${inline(meta.subtitle)}</div>` : ''}</div>
      <div class="n"></div>
    </div>
    ${kind === 'map' ? '<div class="pg-single"></div>' : '<div class="pg-body"><div class="col"></div><div class="col"></div></div>'}
    <div class="pg-foot"><span>${esc(meta.subject)}${meta.place ? ' — ' + esc(meta.place) : ''}</span><span>${esc(meta.unit)}${meta.footLabel ?? (kind === 'map' ? tr(' — الخريطة الذهنية', ' — Mind map') : '')}</span></div>`;
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
    items.push({ t: 'heading', text: tr('طرق للحفظ', 'Ways to remember') });
    items.push({ t: 'list', ordered: false, items: n.mnemonics });
  }
  const a = n.appendix || {};
  const hasAppx = a.rules?.length || a.poems?.length || a.vocab?.length || a.questions?.length || a.admin;
  if (hasAppx) {
    items.push({ t: 'heading', text: tr('الملحق', 'Appendix'), _newPage: true });
    if (a.rules?.length) { items.push({ t: 'appx-h', text: tr('القواعد', 'Rules') }); items.push({ t: 'list', ordered: true, items: a.rules }); }
    if (a.poems?.length) { items.push({ t: 'appx-h', text: tr('الأبيات والمنظومات', 'Poems and verses') }); a.poems.forEach(p => items.push({ t: 'poem', text: p.text || p, source: p.source })); }
    if (a.vocab?.length) { items.push({ t: 'appx-h', text: tr('المفردات', 'Vocabulary') }); items.push({ t: 'table', headers: [tr('الكلمة', 'Term'), tr('معناها', 'Meaning')], rows: a.vocab.map(v => [v.term, v.meaning]) }); }
    if (a.questions?.length) { items.push({ t: 'appx-h', text: tr('أسئلة', 'Questions') }); items.push({ t: 'list', ordered: true, items: a.questions }); }
    if (a.admin) items.push({ t: 'text', text: '◇ ' + a.admin });
  }
  if (n.closing_duas?.length) n.closing_duas.forEach(d => items.push({ t: 'dua', text: d }));
  return items;
}

function paginateNotes(lesson, meta, finish = true) {
  curLang = lesson.lang || 'ar';
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
  pages.forEach((p, i) => { const n = $('.n', p); if (n) n.textContent = p.lang === 'en' ? `Page ${i + 1} / ${total}` : `صفحة ${arD(i + 1)} / ${arD(total)}`; });
  // cross references → page numbers (only inside the same lesson)
  const secPage = [];
  pages.forEach((p, i) => $$('.b-h', p).forEach(h => secPage.push([norm(h.dataset.sec), i + 1, p.dataset.ch || ''])));
  pages.forEach(p => $$('.xref', p).forEach(x => {
    const want = norm(x.dataset.ref);
    const hit = secPage.find(([s, , ch]) => ch === (p.dataset.ch || '') && s && (s.includes(want) || want.includes(s)));
    if (hit) x.textContent = p.lang === 'en' ? `[See p. ${hit[1]}]` : `[انظر ص ${arD(hit[1])}]`;
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
    <div class="mm-center">${inline(m.center)}${cont ? `<br><small>${tr('(تابع)', '(cont.)')}</small>` : ''}</div>
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
  const cx = c.left + c.width / 2;
  svg.innerHTML = $$('.mm-cloud', mm).map(cl => {
    const r = cl.getBoundingClientRect(), y = r.top + r.height / 2 - box.top;
    return r.left + r.width / 2 > cx ? path(c.right - box.left, r.left - box.left, y) : path(c.left - box.left, r.right - box.left, y);
  }).join('');
}
function paginateMap(lesson, meta, finish = true) {
  curLang = lesson.lang || 'ar';
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
  window.JundCal?.onLesson(lesson);
  window.JundFeatures?.onLesson(lesson);
  window.JundStudy?.onLesson(lesson);
  window.JundVoice?.onLesson(lesson);
}

function renderReport(r) {
  curLang = current?.lang || 'ar';
  const sec = (t, arr) => arr?.length ? `<h3>${t}</h3><ul>${arr.map(x => `<li>${inline(x)}</li>`).join('')}</ul>` : '';
  const box = $('#frame-report');
  box.dir = EN() ? 'ltr' : 'rtl';
  box.innerHTML =
    sec(tr('استنتجته من نص غير واضح', 'Worked out from unclear speech'), r.inferred) +
    sec(tr('قد يكون خطأ — راجعه', 'May be wrong — check it'), r.maybe_wrong) +
    sec(tr('أضفته من عندي (أمثلة توضيحية وطرق حفظ)', 'Added by me (illustrative examples and memory aids)'), r.added) +
    sec(tr('تركته عمدًا', 'Left out on purpose'), r.left_out) +
    (current?.notes?.mawaiz?.length ? sec(tr('مواعظ محفوظة لملف آخر السنة', 'Reminders kept for the year-end file'), current.notes.mawaiz) : '') || `<p>${tr('لا ملاحظات.', 'Nothing to report.')}</p>`;
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
  document.title = current ? `${current.subject.name} - ${current.unit}${currentTab === 'map' ? ' - mind map' : ''}` : bookTitle;
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
    onText: t => { $('#chat-progress-text').textContent = `Editing on your phone… ${ar(t.split(/\s+/).length)} words`; },
  });
  let out; try { out = parseJSON(r.text); } catch { throw new Error('The answer came back messy. Ask again in clearer words.'); }
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
  current.chat.push({ who: 'ai', text: out.reply || (out.no_change ? 'Done.' : 'Changed.') });
  await saveLesson(current);
  await openLesson(current);
  $('.chat').scrollIntoView({ block: 'end' });
}

function renderChat() {
  $('#chat-log').innerHTML = (current.chat || []).map(m => `<div class="msg ${m.who}">${esc(m.text)}</div>`).join('');
}
$('#chat-send').onclick = async () => {
  const attName = window.JundAttach?.chatFileName() || '';
  const ask = $('#chat-text').value.trim() || (attName ? 'أضف محتوى الملف المرفق إلى الملاحظات في مكانه المناسب.' : '');
  if (!ask || !current) return;
  current.chat.push({ who: 'me', text: (attName ? '📎 ' + attName + '\n' : '') + ask }); renderChat();
  $('#chat-text').value = '';
  $('#chat-send').disabled = true; $('#chat-progress').hidden = false;
  $('#chat-progress-text').textContent = 'Working…';
  const lock = await keepAwake();
  let extra = '';
  if (attName) {
    try { extra = await window.JundAttach.chatExtract(t => { $('#chat-progress-text').textContent = t; }); }
    catch (e) { current.chat.push({ who: 'ai', text: '✗ ' + errText(e) }); renderChat(); lock?.release?.(); $('#chat-send').disabled = false; $('#chat-progress').hidden = true; return; }
  }
  if (engineKind() === 'phone') {
    try { await editOnPhone(ask + extra); }
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

${history ? 'ما سبق في المحادثة:\n' + history + '\n\n' : ''}طلب الطالب الآن: ${ask}${extra}`;
    const r = await callBig({
      system: current.lang === 'en'
        ? window.JUND_METHOD_EN + '\n\n' + window.JUND_EDIT_RULES_EN
        : window.JUND_METHOD + '\n\n' + window.JUND_EDIT_RULES,
      messages: [{ role: 'user', content: user }],
      onText: t => { $('#chat-progress-text').textContent = `Working… ${ar(t.split(/\s+/).length)} words`; },
    });
    const out = await getJSON(r.text);
    const cost = engineKind() === 'claude' ? ` (${ar((r.usd * SAR).toFixed(2))} SAR)` : '';
    if (out.no_change || !out.sections) {
      current.chat.push({ who: 'ai', text: (out.reply || 'Done.') + cost });
    } else {
      const { reply, ...notes } = out;
      current.notes = notes;
      current.chat.push({ who: 'ai', text: (reply || 'Changed.') + cost });
    }
    await saveLesson(current);
    await openLesson(current);
    $('.chat').scrollIntoView({ block: 'end' });
  } catch (e) {
    current.chat.push({ who: 'ai', text: '✗ ' + errText(e) });
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
    cloud.pull().then(n => { if (n) renderLibrary(); }).catch(() => { const el = $('#cloud-status'); if (el) el.textContent = '⚠ Could not reach your GitHub storage right now.'; });
  }
  const q = norm($('#lib-search')?.value || '').toLowerCase();
  const all = (await allLessons()).filter(l => !q || norm([l.subject.name, l.unit, l.notes?.title, l.notes?.subtitle].join(' ')).toLowerCase().includes(q));
  $('#book-year').hidden = !all.length;
  $('#book-mawaiz').hidden = !all.some(l => l.notes?.mawaiz?.length);
  if (!all.length) { list.innerHTML = '<div class="empty"><b>No lessons yet.</b><br>The first notes you make will appear here.</div>'; return; }
  all.sort((a, b) => b.date.localeCompare(a.date));
  const groups = {};
  for (const l of all) (groups[l.subject.id] ??= []).push(l);
  list.innerHTML = Object.entries(groups).map(([sid, ls]) => `
    <div class="lib-group"><h2>${esc(ls[0].subject.name)}${ls[0].subject.place ? ' <small class="muted">' + esc(ls[0].subject.place) + '</small>' : ''}</h2>
    ${ls.length > 1 ? `<button type="button" class="ghost small book-btn" data-book="${esc(sid)}">Make the subject book (${ar(ls.length)} lessons)</button>` : ''}
    ${ls.map(l => `<div class="lib-item">
      <button type="button" class="open" data-open="${l.id}" dir="auto">${l.draft ? '<span class="tag">Draft</span> ' : ''}${esc(l.notes?.title || l.unit)}<small>${esc(l.unit)} · ${new Date(l.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</small></button>
      <button type="button" class="ghost danger small" data-del="${l.id}">Delete</button>
    </div>`).join('')}</div>`).join('');
  $$('[data-open]', list).forEach(b => b.onclick = async () => openLesson(await idb.get(b.dataset.open)));
  $$('[data-book]', list).forEach(b => b.onclick = () => makeBook(b.dataset.book));
  $$('[data-del]', list).forEach(b => b.onclick = async () => {
    if (b.dataset.sure) { await removeLesson(b.dataset.del); if (current?.id === b.dataset.del) current = null; renderLibrary(); }
    else { b.dataset.sure = '1'; b.textContent = 'Tap again to delete'; }
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
  pages.forEach(p => $$('.toc-row .pg', p).forEach(el => { const r = rows[k++]; if (r) el.textContent = p.lang === 'en' ? String(r.page) : arD(r.page); }));
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
async function makeYearBook() {
  const y = new Date().getFullYear();
  const ls = (await allLessons()).filter(l => !l.draft && new Date(l.date).getFullYear() === y)
    .sort((a, b) => a.subject.name.localeCompare(b.subject.name) || a.date.localeCompare(b.date));
  if (!ls.length) return;
  $('#book-progress').hidden = false; $('#book-progress-text').textContent = 'Preparing your year book…';
  await fontsReady();
  const meta = { title: String(y), subtitle: '', subject: 'Mustatar ' + y, place: '', unit: '', palette: window.paletteFor('slate') };
  const cover = coverPage(meta, `<div class="c-sub">${y}</div><div class="c-rule"></div>
    <div class="c-book">ملاحظات العام · Notes of the year</div><div class="c-place">${arD(ls.length)} درسًا · ${new Set(ls.map(l => l.subject.id)).size} subjects</div>
    <div class="c-place">${esc(me().nameAr || me().name || '')}</div>`);
  const chapters = [];
  for (let i = 0; i < ls.length; i++) {
    $('#book-progress-text').textContent = `Laying out lesson ${i + 1} of ${ls.length}…`;
    await new Promise(r => setTimeout(r, 0));
    const l = ls[i], m = metaFor(l);
    const pg = [...paginateNotes(l, m, false), ...paginateMap(l, m, false)];
    pg.forEach(p => { p.dataset.ch = l.id; });
    chapters.push({ l, pages: pg });
  }
  const rowsIn = ls.map(l => ({ title: l.notes.title || l.unit, sub: l.subject.name + ' — ' + l.unit }));
  const toc = tocPages(meta, rowsIn);
  const rows = []; let pageNo = 1 + toc.length;
  for (const c of chapters) { rows.push({ title: c.l.notes.title || c.l.unit, page: pageNo + 1 }); pageNo += c.pages.length; }
  const pages = [cover, ...toc, ...chapters.flatMap(c => c.pages)];
  $('#book-progress').hidden = true;
  await showBook(`Year book ${y}`, `${ls.length} lessons · ${pages.length} pages`, pages, rows, 1);
}
$('#book-year').onclick = makeYearBook;
async function makeBook(subjectId) {
  const ls = (await allLessons()).filter(l => l.subject.id === subjectId && !l.draft).sort((a, b) => a.date.localeCompare(b.date));
  if (!ls.length) return;
  $('#book-progress').hidden = false; $('#book-progress-text').textContent = 'Preparing the book…';
  await fontsReady();
  const meta = { ...metaFor(ls[0]), title: ls[0].subject.name, subtitle: '', unit: '' };
  const year = new Date().toLocaleDateString('ar-SA', { year: 'numeric' });
  const cover = coverPage(meta, `<div class="c-sub">${esc(ls[0].subject.name)}</div>
    ${ls[0].subject.book ? `<div class="c-book">${esc(ls[0].subject.book)}</div>` : ''}<div class="c-rule"></div>
    <div class="c-place">${esc(ls[0].subject.place || '')}${ls[0].subject.place ? ' — ' : ''}${esc(year)}</div>
    <div class="c-place">${esc(me().nameAr || me().name || '')}</div>`);
  const rows = [];
  const chapters = [];
  ls.forEach((l, i) => {
    $('#book-progress-text').textContent = `Laying out lesson ${ar(i + 1)} of ${ar(ls.length)}…`;
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
  await showBook(`Book: ${ls[0].subject.name}`, `${ar(ls.length)} lessons · ${ar(pages.length)} pages`, pages, rows, 1);
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
  await showBook('Reminders book', `${ar(Object.keys(bySub).length)} subjects`, [cover, ...pages], [], 1);
};

/* ---------- backup to Google Drive (or anywhere) ---------- */
$('#backup').onclick = async () => {
  const st = $('#backup-status');
  const lessons = await allLessons();
  const data = { app: 'jund-notes', version: 2, saved: new Date().toISOString(), families: store.get('families', {}), lessons,
    events: store.get('events', []), studio: store.get('studioSaved', []) };
  const name = `Mustatar backup ${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      st.textContent = `✓ Choose Google Drive in the list to keep it there. (${ar(lessons.length)} lessons)`;
      return;
    }
  } catch (e) { if (e.name === 'AbortError') { st.textContent = 'Cancelled.'; return; } }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  st.textContent = `✓ Backup downloaded (${ar(lessons.length)} lessons). Upload it to Google Drive from your phone's files.`;
};
$('#restore').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const st = $('#backup-status');
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'jund-notes' || !Array.isArray(data.lessons)) throw new Error();
    for (const l of data.lessons) await saveLesson(l);
    if (data.families) store.set('families', { ...data.families, ...store.get('families', {}) });
    if (Array.isArray(data.events)) window.JundCal?.merge(data.events);
    if (Array.isArray(data.studio)) { const have = store.get('studioSaved', []); store.set('studioSaved', [...have, ...data.studio.filter(x => !have.some(h => h.id === x.id))]); }
    st.textContent = `✓ Restored ${ar(data.lessons.length)} lessons.`;
  } catch { st.textContent = '✗ This is not a backup file from the app.'; }
  e.target.value = '';
};

/* ---------- about you ---------- */
function me() { return store.get('me', {}); }
function initMe() {
  const m = me();
  $('#me-name').value = m.name || ''; $('#me-name-ar').value = m.nameAr || ''; $('#me-study').value = m.study || '';
  $('#me-use').value = m.use || 'study';
  const lbl = () => { const w = $('#me-use').value === 'work'; $('#me-study-label').textContent = w ? 'Your work (job, company, team)' : 'Where and what you study'; $('#me-study').placeholder = w ? 'e.g. Operations manager at a logistics company, team of 12' : 'e.g. Dar al-Hadith al-Khayriyyah and Kulliyat al-Masjid al-Haram, Makkah'; };
  $('#me-use').onchange = lbl; lbl();
  $('#me-save').onclick = () => {
    store.set('me', { name: $('#me-name').value.trim(), nameAr: $('#me-name-ar').value.trim(), study: $('#me-study').value.trim(), use: $('#me-use').value });
    $('#me-status').textContent = '✓ Saved'; fillSubjects(); window.JundAssistant?.home();
  };
  // a person's own free AI key
  $('#user-key').value = store.get('userKey', '');
  $('#user-key-save').onclick = () => {
    const k = $('#user-key').value.trim();
    if (k && !/^(AIza[\w-]{30,60}|AQ\.[\w.-]{20,300}|[\w.-]{30,300})$/.test(k)) { $('#user-key-status').textContent = '✗ That does not look like a Gemini key (it starts with AIza or AQ.).'; return; }
    store.set('userKey', k); $('#user-key-status').textContent = k ? '✓ Saved. You now have your own daily limit.' : 'Removed. The shared key is used.';
  };
}

/* ---------- theme ---------- */
function applyTheme() {
  const t = store.get('theme', 'navy');
  document.documentElement.dataset.theme = t;
  $('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#F3F5FA' : '#0A1222');
}
applyTheme();

/* ---------- the server: is it up? ---------- */
async function checkServer() {
  const st = $('#server-status'), dot = $('#server-dot');
  if (st) st.textContent = 'Checking…';
  try {
    const base = await getServer();
    const j = await (await fetch(base + '/', { cache: 'no-store' })).json();
    dot.dataset.ok = j.key ? '1' : '0';
    if (st) st.textContent = j.key ? '✓ The server is running and has its AI key.' : '⚠ The server runs but has no AI key yet. Add GEMINI_API_KEY in the GitHub secrets.';
  } catch (e) {
    dot.dataset.ok = '0';
    if (st) st.textContent = '✗ ' + (e.code === 'noserver' ? e.message : 'The server could not be reached. Check the internet.');
  }
}

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
        const name = decodeURIComponent(fr.headers.get('x-name') || 'file.pdf');
        const type = fr.headers.get('content-type') || '';
        const blob = await fr.blob(); await c.delete('shared-file');
        if (/^image\//.test(type)) { show('studio'); window.JundStudio?.load(new File([blob], name, { type })); }
        else { show('new'); await addFiles([new File([blob], name, { type: type === 'application/octet-stream' ? '' : (type || blob.type || 'application/pdf') })]); }
      }
      const t = await c.match('shared-title');
      if (t) { if (!$('#unit').value) $('#unit').value = await t.text(); await c.delete('shared-title'); }
    } catch {}
  }
  if (text && /youtu\.?be/.test(text) && text.trim().split(/\s+/).length < 4) { startYouTube(text.trim()); text = ''; }
  if (text) {
    show('new'); $('#paste-box').open = true;
    $('#transcript').value = text; countWords();
    if (title && !$('#unit').value) $('#unit').value = title;
  }
  const view = u.searchParams.get('view');
  if (view === 'calendar' || view === 'studio' || view === 'assistant') setTimeout(() => show(view), 0);
  if (view === 'record') setTimeout(() => window.JundFeatures?.record(), 300);
  if (view === 'task') setTimeout(() => window.JundCal?.open(), 300);
  if (view === 'focus') setTimeout(() => window.JundFeatures?.openFocus(), 300);
  if (u.search) history.replaceState(null, '', location.pathname);
}

/* ---------- start ---------- */
fillSubjects();
initSettings();
initMe();
// Settings: each section folds, so the page stays short
setTimeout(() => document.querySelectorAll('#screen-settings > .card').forEach((c, i) => {
  const h = c.querySelector(':scope > .card-h'); if (!h) return;
  const d = document.createElement('details'); d.className = 'set-sec';
  const s = document.createElement('summary'); s.textContent = h.textContent; d.appendChild(s);
  c.replaceWith(d); d.appendChild(c);
}), 0);
document.querySelectorAll('#screen-settings > details.card').forEach(d => { d.classList.add('set-sec'); d.classList.remove('card'); });
show('assistant');
receiveShared();
const APP_VERSION = '6.4';
renderQueue(); setTimeout(processQueue, 2500);
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => { r.update(); document.addEventListener('visibilitychange', () => { if (!document.hidden) r.update().catch(() => {}); }); }).catch(() => {});
  // when a new version takes over, reload once so every file is the new one
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    const busy = controller || window.JundRecorder?.active?.() || document.querySelector('.vx:not([hidden]), .wl');
    if (!busy) { reloaded = true; location.reload(); return; }
    // busy (recording, making notes, talking): offer the update instead of interrupting
    const b = document.createElement('button'); b.type = 'button'; b.className = 'update-bar'; b.textContent = window.ZadLang === 'ar' ? 'نسخة جديدة جاهزة — اضغط للتحديث' : 'A new version is ready — tap to update';
    b.onclick = () => { reloaded = true; location.reload(); }; document.body.appendChild(b);
  });
}
$('#app-version').textContent = 'version ' + APP_VERSION;
setTimeout(checkServer, 1200);
$('#lib-search').addEventListener('input', () => renderLibrary());

// start transcribing a YouTube link from anywhere (the Assistant, a share)
function startYouTube(url) { show('new'); $('#yt').value = url; $('#yt-go').click(); }
// shared with calendar.js, studio.js and offline.js
window.JN = { store, cloud, esc, ar, show, callServer, serverFetch, readStream, shrinkImage, callBig, parseJSON, getJSON, langOf, errText, allLessons, openLesson,
  saveLesson, download, safeName, addFiles, startYouTube, me, keepAwake, engineKind, splitText, cleanHeard, current: () => current };
// for testing only
window.__jn = { openLesson, paginateNotes, idb, makeBook, makeYearBook, pending: () => pending };
})();
