// The app's own small server. It holds the AI key, so no user ever needs one.
//   POST /write       text → notes (streams the answer back)
//   POST /transcribe  an audio piece → its transcript (streams)
//   POST /youtube     a YouTube link + time range → transcript of that range (streams)
//   GET  /playlist    a YouTube playlist → its videos (from YouTube's public feed)
//   GET  /ytmeta      a YouTube link → its title
//   POST /report      a problem, a piece of feedback or a daily usage count from the app (no note contents)
//   POST /owner/reports, /owner/delete   the app owner's view of those reports (needs the owner code)
//   POST /ask-file    a question about one attached file (photo, PDF, audio, video, text)
//   POST /ask-voice   a short spoken question (+ the file being discussed) → what was heard and the answer

const ALLOWED = ['https://mustatar-app.github.io', 'https://dawajund-1.github.io'];
let G = 'https://generativelanguage.googleapis.com';  // GEMINI_BASE replaces it only in local tests
const WRITE_MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-2.5-flash'];
const HEAR_MODELS = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-flash-lite-latest'];
const FILE_MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const VOICE_MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-flash-latest'];
const OWNER_HASH = 'acbe7ee98a566ab6ed2537fc1d67662eddda3739d19aedde6ee8f89f223fe602';   // sha-256 of the owner code (the code itself is not stored here)
const MAX_BODY = 900_000;            // characters of text: about 150 pages
const MAX_AUDIO = 95 * 1024 * 1024;  // bytes per audio piece

const HEAR = `Transcribe this recording word for word, in the language that is spoken.
- Arabic stays Arabic and English stays English. Keep words from another language exactly as they are said. Never translate.
- Do not summarize, explain, correct the speaker, or add anything.
- No timestamps. Start a new paragraph when the topic changes.
- When the speaker changes, start a new line with "- ".
- Write Quran verses, hadith and poetry exactly as recited when you recognise them.
- If there is no speech at all, reply only: [[NOSPEECH]]
Return only the transcript.`;

const READ = `Read all the text in this photo exactly as it is written, in its own language.
- Arabic stays Arabic (keep the diacritics that are shown); English stays English. Never translate.
- Keep the order: headings, paragraphs, lists. Write a table as rows with " | " between cells.
- Handwriting: read it as well as you can; put [?] after a word you are not sure of.
- Leave out page furniture such as running headers and page numbers.
- If there is no text, describe what the picture shows in one line.
Return only the text.`;

function cors(origin) {
  const ok = ALLOWED.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED[0],
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-user-key',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
const json = (obj, status, headers) => new Response(JSON.stringify(obj), { status, headers: { ...headers, 'content-type': 'application/json; charset=utf-8' } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const keyHeaders = env => ({ 'x-goog-api-key': env.GEMINI_API_KEY });
const errCode = s => s === 429 ? 'quota' : s === 403 ? 'key' : 'ai';

// Ask the AI, trying each model in turn (a model that is missing or out of free quota today is skipped).
// `variants` lets a request be retried once in a simpler form if the AI refuses an optional setting.
async function generate(env, h, { models, system, variants, maxTokens, wantJson, wait }) {
  let last = { status: 500, text: '' };
  for (const model of models) {
    for (let vi = 0; vi < variants.length; vi++) {
      const v = variants[vi];
      const thinking = /2\.5-flash/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {};
      const payload = JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents: [{ role: 'user', parts: v.parts }],
        generationConfig: {
          temperature: v.temperature ?? 0.3,
          maxOutputTokens: Math.min(Number(maxTokens) || 30000, 60000),
          ...(wantJson ? { responseMimeType: 'application/json' } : {}),
          ...(v.config || {}),
          ...thinking,
        },
      });
      let r;
      try {
        r = await fetch(`${G}/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
          method: 'POST', headers: { 'content-type': 'application/json', ...keyHeaders(env) }, body: payload,
          ...(wait ? { signal: AbortSignal.timeout(wait) } : {}),
        });
      } catch { last = { status: 504, text: 'the AI took too long' }; break; }   // too slow right now: try the next model
      if (r.ok) return new Response(r.body, { headers: { ...h, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-model': model } });
      last = { status: r.status, text: (await r.text()).slice(0, 500) };
      const modelProblem = r.status !== 400 || /model|not found|not supported/i.test(last.text);
      if (modelProblem) break;               // try the next model
      if (vi === variants.length - 1) {      // the request itself was refused: stop
        return json({ error: last.text, code: 'bad', status: 400 }, 400, h);
      }
    }
    if (![404, 429, 400, 403, 500, 503, 504].includes(last.status)) break;
  }
  return json({ error: last.text || 'AI error', code: errCode(last.status), status: last.status }, last.status === 429 ? 429 : 502, h);
}

// Put an audio piece in Google's temporary file store (kept 48 hours), streaming it straight through.
async function uploadToGoogle(env, req, len, mime) {
  const start = await fetch(`${G}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      ...keyHeaders(env), 'content-type': 'application/json',
      'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(len), 'X-Goog-Upload-Header-Content-Type': mime,
    },
    body: JSON.stringify({ file: { display_name: 'jund-' + Date.now() } }),
  });
  if (!start.ok) return { error: { status: start.status, text: (await start.text()).slice(0, 300) } };
  const target = start.headers.get('x-goog-upload-url');
  if (!target) return { error: { status: 502, text: 'no upload address' } };
  const { readable, writable } = new FixedLengthStream(len);
  const piping = req.body.pipeTo(writable).catch(() => {});
  const up = await fetch(target, {
    method: 'POST',
    headers: { 'Content-Length': String(len), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: readable,
  });
  await piping;
  if (!up.ok) return { error: { status: up.status, text: (await up.text()).slice(0, 300) } };
  let file = (await up.json()).file;
  for (let i = 0; i < 30 && file?.state === 'PROCESSING'; i++) {
    await sleep(2000);
    file = await (await fetch(`${G}/v1beta/${file.name}`, { headers: keyHeaders(env) })).json();
  }
  if (!file?.uri || file.state === 'FAILED') return { error: { status: 502, text: 'the file could not be read' } };
  return { file };
}

const ytId = u => {
  try {
    const x = new URL(u);
    if (/(^|\.)youtu\.be$/.test(x.hostname)) return x.pathname.slice(1, 12);
    if (!/(^|\.)youtube\.com$/.test(x.hostname)) return null;
    return x.searchParams.get('v') || (x.pathname.match(/\/(shorts|live|embed)\/([\w-]{11})/) || [])[2] || null;
  } catch { return null; }
};
const unxml = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/* ---------- reminders when the app is closed (Web Push, no message body) ---------- */
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
async function vapid(env) {
  let k = await env.PUSH.get('vapid', 'json');
  if (!k) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    k = { priv: await crypto.subtle.exportKey('jwk', pair.privateKey), pub: b64u(await crypto.subtle.exportKey('raw', pair.publicKey)) };
    await env.PUSH.put('vapid', JSON.stringify(k));
  }
  return k;
}
async function sendPush(env, sub) {
  const k = await vapid(env), aud = new URL(sub.endpoint).origin;
  const enc = o => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://mustatar-app.github.io/' });
  const key = await crypto.subtle.importKey('jwk', k.priv, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
  return fetch(sub.endpoint, { method: 'POST', headers: { TTL: '3600', Urgency: 'high', Authorization: `vapid t=${unsigned}.${b64u(sig)}, k=${k.pub}`, 'Content-Length': '0' } });
}
async function pushRoutes(req, env, h, path, url) {
  if (!env.PUSH) return json({ error: 'push not set up', code: 'nopush' }, 501, h);
  if (path === '/push/key') return json({ key: (await vapid(env)).pub }, 200, h);
  if (path === '/push/sync' && req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    if (!/^[a-f0-9]{16,64}$/.test(b.id || '') || !b.sub?.endpoint) return json({ error: 'bad' }, 400, h);
    const old = await env.PUSH.get('s:' + b.id, 'json');
    const sent = new Set((old?.reminders || []).filter(r => r.sent).map(r => r.tag));
    const reminders = (b.reminders || []).slice(0, 200).map(r => ({ at: +r.at, title: String(r.title).slice(0, 120), body: String(r.body || '').slice(0, 200), tag: String(r.tag).slice(0, 80), sent: sent.has(String(r.tag)) }))
      .filter(r => r.at > Date.now() - 6 * 3600e3);
    await env.PUSH.put('s:' + b.id, JSON.stringify({ sub: b.sub, reminders }));
    const idx = new Set(await env.PUSH.get('index', 'json') || []);
    if (!idx.has(b.id)) { idx.add(b.id); await env.PUSH.put('index', JSON.stringify([...idx])); }
    return json({ ok: true, count: reminders.length }, 200, h);
  }
  if (path === '/push/due') {
    const id = url.searchParams.get('id') || '';
    const rec = /^[a-f0-9]{16,64}$/.test(id) ? await env.PUSH.get('s:' + id, 'json') : null;
    const now = Date.now();
    return json({ due: (rec?.reminders || []).filter(r => r.at <= now + 60e3 && r.at > now - 30 * 60e3) }, 200, h);
  }
  if (path === '/push/test' && req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const rec = await env.PUSH.get('s:' + b.id, 'json');
    if (!rec) return json({ error: 'not found' }, 404, h);
    rec.reminders.push({ at: Date.now(), title: 'Test reminder', body: 'Reminders work even when Mustatar is closed.', tag: 'test-' + Date.now(), sent: false });
    await env.PUSH.put('s:' + b.id, JSON.stringify(rec));
    const r = await sendPush(env, rec.sub);
    return json({ ok: r.ok, status: r.status }, 200, h);
  }
  return json({ error: 'not found' }, 404, h);
}
/* ---------- home-screen widget: next prayer and upcoming items ---------- */
async function widgetRoutes(req, env, h, path, url) {
  if (!env.PUSH) return json({ error: 'not set up' }, 501, h);
  if (path === '/widget/sync' && req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    if (!/^[a-f0-9]{16,64}$/.test(b.id || '')) return json({ error: 'bad' }, 400, h);
    const p = b.place || {};
    const rec = { place: { name: String(p.name || '').slice(0, 60), lat: +p.lat || 21.4225, lon: +p.lon || 39.8262 },
      upcoming: (b.upcoming || []).slice(0, 12).map(x => ({ title: String(x.title || '').slice(0, 80), at: +x.at, end: +x.end || +x.at, timed: !!x.timed })),
      style: ['clear', 'dark', 'black', 'white'].includes(b.style) ? b.style : 'dark',
      wisdom: (Array.isArray(b.wisdom) ? b.wisdom : []).slice(0, 60).map(x => ({ t: String(x.t || '').slice(0, 300), s: String(x.s || '').slice(0, 100) })) };
    await env.PUSH.put('w:' + b.id, JSON.stringify(rec));
    if (Array.isArray(b.feed)) await env.PUSH.put('f:' + b.id, JSON.stringify(b.feed.slice(0, 400).map(x => ({ t: String(x.t || '').slice(0, 120), d: String(x.d || ''), tm: String(x.tm || ''), r: +x.r, w: !!x.w, id: String(x.id || '').slice(0, 40), ty: String(x.ty || '') }))));
    return json({ ok: true }, 200, h);
  }
  if (path === '/widget') {
    const id = url.searchParams.get('id') || '';
    const rec = /^[a-f0-9]{16,64}$/.test(id) ? await env.PUSH.get('w:' + id, 'json') : null;
    if (!rec) return json({ error: 'not found' }, 404, h);
    const m = (url.searchParams.get('date') || '').match(/^(\d\d)-(\d\d)-(\d{4})$/);
    const d = m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : new Date();
    const fmt = x => `${String(x.getUTCDate()).padStart(2, '0')}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${x.getUTCFullYear()}`;
    const { lat, lon } = rec.place, saudi = lat > 16 && lat < 32.5 && lon > 34.5 && lon < 55.7;
    const times = async x => {
      try {
        const r = await fetch(`https://api.aladhan.com/v1/timings/${fmt(x)}?latitude=${lat}&longitude=${lon}${saudi ? '&method=4' : ''}`, { cf: { cacheTtl: 21600, cacheEverything: true } });
        const t = (await r.json()).data?.timings || {};
        return Object.fromEntries(['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].map(n => [n, String(t[n] || '').slice(0, 5)]));
      } catch { return null; }
    };
    const [today, tomorrow] = await Promise.all([times(d), times(new Date(+d + 864e5))]);
    return json({ place: rec.place.name, today, tomorrow, upcoming: rec.upcoming, style: rec.style || 'dark', wisdom: rec.wisdom || [] }, 200, h);
  }
  return json({ error: 'not found' }, 404, h);
}

// the person's Mustatar calendar as an iCal feed, so the phone's own calendar (Google, Samsung, iPhone) shows it with alerts
async function icsFeed(env, id) {
  const list = await env.PUSH.get('f:' + id, 'json') || [];
  const esc = t => String(t).replace(/[\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mustatar//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Mustatar', 'X-WR-TIMEZONE:Asia/Riyadh', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  for (const e of list) {
    if (!/^\d{4}-\d\d-\d\d$/.test(e.d)) continue;
    const d = e.d.replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:${e.id || d}@mustatar`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, `SUMMARY:${esc(e.t)}`);
    if (/^\d\d:\d\d$/.test(e.tm)) {
      const [hh, mm] = e.tm.split(':').map(Number), endH = String(Math.min(23, hh + 1)).padStart(2, '0');
      lines.push(`DTSTART;TZID=Asia/Riyadh:${d}T${e.tm.replace(':', '')}00`, `DTEND;TZID=Asia/Riyadh:${d}T${endH}${String(mm).padStart(2, '0')}00`);
    } else {
      const next = new Date(e.d + 'T12:00:00Z'); next.setUTCDate(next.getUTCDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, '')}`);
    }
    if (e.w) lines.push(`RRULE:FREQ=WEEKLY;BYDAY=${DAYS[new Date(e.d + 'T12:00:00Z').getUTCDay()]}`);
    if (e.r >= 0) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.t)}`, `TRIGGER:-PT${Math.round(e.r)}M`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return new Response(lines.join('\r\n'), { headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'max-age=900', 'access-control-allow-origin': '*' } });
}

// every minute: wake the phones that have a reminder due now
async function cron(env) {
  if (!env.PUSH) return;
  const ids = await env.PUSH.get('index', 'json') || [], keep = [], now = Date.now();
  for (const id of ids) {
    const rec = await env.PUSH.get('s:' + id, 'json');
    if (!rec) continue;
    keep.push(id);
    const due = rec.reminders.filter(r => !r.sent && r.at <= now + 30e3 && r.at > now - 30 * 60e3);
    if (!due.length) continue;
    const r = await sendPush(env, rec.sub).catch(() => null);
    if (r && (r.status === 404 || r.status === 410)) { keep.pop(); await env.PUSH.delete('s:' + id); continue; }  // the phone unsubscribed
    due.forEach(d => { d.sent = true; });
    await env.PUSH.put('s:' + id, JSON.stringify(rec));
  }
  if (keep.length !== ids.length) await env.PUSH.put('index', JSON.stringify(keep));
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(cron(env)); },
  async fetch(req, env) {
    if (env.GEMINI_BASE) G = env.GEMINI_BASE;
    // someone using their own free AI key gets their own daily limit
    const own = req.headers.get('x-user-key') || '';
    if (/^(AIza[\w-]{30,60}|AQ\.[\w.-]{20,300}|[\w.-]{30,300})$/.test(own)) env = { ...env, GEMINI_API_KEY: own };
    const origin = req.headers.get('origin') || '';
    const h = cors(origin);
    const url = new URL(req.url);
    const path = url.pathname;
    if (req.method === 'OPTIONS') return new Response(null, { headers: h });
    if (req.method === 'GET' && path === '/') return json({ ok: true, app: 'jund-notes', version: 3, key: !!env.GEMINI_API_KEY, push: !!env.PUSH }, 200, h);
    if (path.startsWith('/push/')) return pushRoutes(req, env, h, path, url);
    if (path === '/widget' || path.startsWith('/widget/')) return widgetRoutes(req, env, h, path, url);
    if (req.method === 'GET' && /^\/ics\/[a-f0-9]{16,64}\.ics$/.test(path)) return icsFeed(env, path.slice(5, -4));
    if (origin && !h['Access-Control-Allow-Origin'].startsWith(origin)) return json({ error: 'forbidden' }, 403, h);

    /* ----- read another calendar (Google, Outlook, iCloud…) from its private iCal link ----- */
    if (path === '/ical' && req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      let u = String(b.url || '').trim().replace(/^webcal:/i, 'https:');
      if (!/^https:\/\/[^\s]{8,900}$/i.test(u)) return json({ error: 'bad link', code: 'bad' }, 400, h);
      let r = await fetch(u, { headers: { accept: 'text/calendar,*/*' }, redirect: 'follow' }).catch(() => null);
      if (r && !r.ok && u.includes('%')) r = await fetch(decodeURI(u), { headers: { accept: 'text/calendar,*/*' }, redirect: 'follow' }).catch(() => r);
      if (!r || !r.ok) return json({ error: 'could not open that calendar link', code: 'bad', status: r?.status || 0 }, 400, h);
      const text = (await r.text()).slice(0, 3_000_000);
      if (!/BEGIN:VCALENDAR/.test(text)) return json({ error: 'that link is not a calendar (iCal) link', code: 'bad' }, 400, h);
      const name = (text.match(/X-WR-CALNAME:(.*)/) || [])[1]?.trim() || '';
      const unfold = text.replace(/\r?\n[ \t]/g, '');
      const evs = [];
      for (const blk of unfold.split('BEGIN:VEVENT').slice(1)) {
        const body = blk.split('END:VEVENT')[0];
        const get = k => { const m = body.match(new RegExp('^' + k + '(;[^:\\n]*)?:(.*)$', 'm')); return m ? { p: m[1] || '', v: m[2].trim() } : null; };
        const st = get('DTSTART'); if (!st) continue;
        const en = get('DTEND'), sum = get('SUMMARY'), rr = get('RRULE'), uid = get('UID'), ex = [...body.matchAll(/^EXDATE[^:]*:(.*)$/gm)].map(m => m[1].trim());
        evs.push({ uid: uid?.v || '', title: (sum?.v || '').replace(/\\([,;nN])/g, (_, c) => c === 'n' || c === 'N' ? ' ' : c).slice(0, 120), start: st.v, startTz: (st.p.match(/TZID=([^;]+)/) || [])[1] || '', end: en?.v || '', allDay: /VALUE=DATE/.test(st.p) || /^\d{8}$/.test(st.v), rrule: rr?.v || '', exdates: ex.slice(0, 50) });
        if (evs.length >= 2000) break;
      }
      return json({ name, events: evs }, 200, h);
    }

    /* ----- YouTube playlist and title (no AI needed) ----- */
    if (req.method === 'GET' && path === '/playlist') {
      const list = url.searchParams.get('list') || '';
      if (!/^[\w-]{10,64}$/.test(list)) return json({ error: 'bad list' }, 400, h);
      const r = await fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${list}`);
      if (!r.ok) return json({ error: 'playlist not found', code: 'noplaylist' }, 404, h);
      const xml = await r.text();
      const items = [...xml.matchAll(/<entry>[\s\S]*?<yt:videoId>([\w-]{11})<\/yt:videoId>[\s\S]*?<title>([^<]*)<\/title>/g)].map(m => ({ id: m[1], title: unxml(m[2]) }));
      const title = unxml((xml.match(/<title>([^<]*)<\/title>/) || [])[1] || '');
      return json({ title, items }, 200, h);
    }
    if (req.method === 'GET' && path === '/ytmeta') {
      const id = ytId(url.searchParams.get('url') || '');
      if (!id) return json({ error: 'bad link' }, 400, h);
      const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`);
      if (!r.ok) return json({ id, title: '', code: r.status === 401 || r.status === 403 ? 'private' : 'missing' }, 200, h);
      const j = await r.json();
      return json({ id, title: j.title || '', author: j.author_name || '' }, 200, h);
    }

    if (req.method !== 'POST') return json({ error: 'not found' }, 404, h);
    if (!env.GEMINI_API_KEY) return json({ error: 'server has no key', code: 'nokey' }, 500, h);

    /* ----- reports from the app: problems, feedback, usage counts ----- */
    if (path === '/report') {
      const raw = await req.text();
      if (raw.length > 12000) return json({ error: 'too long' }, 413, h);
      let b; try { b = JSON.parse(raw); } catch { return json({ error: 'bad request' }, 400, h); }
      const kind = ['error', 'feedback', 'usage', 'event'].includes(b.kind) ? b.kind : 'event';
      const cut = (v, n) => String(v ?? '').slice(0, n);
      const meta = { k: kind, t: Date.now(), n: cut(b.name, 40), a: cut(b.anon, 16), m: cut(b.msg || b.text, 300), p: cut(b.page, 40), v: cut(b.app, 12), l: cut(b.lang, 4), r: cut(b.roles, 60), u: cut(b.ua, 60) };
      if (kind === 'usage') meta.c = JSON.stringify(b.counts || {}).slice(0, 500);
      const key = `r:${kind}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
      await env.PUSH.put(key, raw.slice(0, 12000), { metadata: meta, expirationTtl: (kind === 'feedback' ? 365 : 120) * 86400 });
      return json({ ok: true }, 200, h);
    }
    if (path === '/owner/reports' || path === '/owner/delete') {
      let b; try { b = await req.json(); } catch { return json({ error: 'bad request' }, 400, h); }
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(b.code || '').trim().toUpperCase())))].map(x => x.toString(16).padStart(2, '0')).join('');
      if (hash !== OWNER_HASH) return json({ error: 'wrong code', code: 'owner' }, 403, h);
      if (path === '/owner/delete') { for (const k of (b.keys || []).slice(0, 200)) if (String(k).startsWith('r:')) await env.PUSH.delete(k); return json({ ok: true }, 200, h); }
      const items = []; let cursor;
      for (let i = 0; i < 5; i++) {
        const l = await env.PUSH.list({ prefix: 'r:', cursor, limit: 1000 });
        for (const k of l.keys) items.push({ key: k.name, ...(k.metadata || {}) });
        if (l.list_complete) break; cursor = l.cursor;
      }
      // full text for feedback and the newest problems
      const want = items.filter(x => x.k === 'feedback' || x.k === 'error').sort((a, z) => z.t - a.t).slice(0, 60);
      await Promise.all(want.map(async x => { try { x.full = JSON.parse(await env.PUSH.get(x.key)); } catch {} }));
      return json({ items }, 200, h);
    }

    /* ----- a question about one attached file ----- */
    if (path === '/ask-file') {
      const raw = await req.text();
      if (raw.length > 22_000_000) return json({ error: 'too long', code: 'toolong' }, 413, h);
      let b; try { b = JSON.parse(raw); } catch { return json({ error: 'bad request' }, 400, h); }
      const mime = String(b.mime || '').split(';')[0].toLowerCase();
      if (!b.file || !/^(image\/[\w.+-]+|application\/pdf|audio\/[\w.+-]+|video\/[\w.+-]+|text\/[\w.+-]+)$/.test(mime)) return json({ error: 'this kind of file is not supported', code: 'bad' }, 400, h);
      const filePart = mime.startsWith('text/')
        ? { text: 'ATTACHED FILE (' + String(b.name || '').slice(0, 80) + '):\n' + new TextDecoder().decode(Uint8Array.from(atob(b.file), c => c.charCodeAt(0))).slice(0, 400000) }
        : { inlineData: { mimeType: mime, data: b.file } };
      return generate(env, h, { models: FILE_MODELS, system: String(b.system || ''), maxTokens: Math.min(Number(b.maxTokens) || 8000, 30000), wantJson: !!b.json, wait: 60000,
        variants: [{ parts: [filePart, { text: String(b.user || '').slice(0, 300000) }], temperature: 0.3 }] });
    }

    /* ----- a short spoken question → what was heard + the answer (basic voice) ----- */
    if (path === '/ask-voice') {
      const raw = await req.text();
      if (raw.length > 4_000_000) return json({ error: 'too long', code: 'toolong' }, 413, h);
      let body; try { body = JSON.parse(raw); } catch { return json({ error: 'bad request' }, 400, h); }
      const { audio = '', mime = 'audio/webm', system = '', user = '' } = body;
      if (!audio || !/^(audio|video)\/[\w.+-]+$/.test(String(mime).split(';')[0])) return json({ error: 'empty', code: 'empty' }, 400, h);
      return generate(env, h, { models: VOICE_MODELS, system, maxTokens: 900, wantJson: false, wait: 15000,
        variants: [{ parts: [{ text: user }, { inlineData: { mimeType: String(mime).split(';')[0], data: audio } }, { text: 'Answer what the person says in this audio.' }], temperature: 0.4 }] });
    }

    /* ----- text → notes ----- */
    if (path === '/write') {
      const raw = await req.text();
      if (raw.length > MAX_BODY) return json({ error: 'text too long', code: 'toolong' }, 413, h);
      let body; try { body = JSON.parse(raw); } catch { return json({ error: 'bad request' }, 400, h); }
      const { system = '', user = '', maxTokens = 30000, json: wantJson = true } = body;
      if (!user) return json({ error: 'empty' }, 400, h);
      const models = (env.MODELS ? String(env.MODELS).split(',') : WRITE_MODELS).map(s => s.trim()).filter(Boolean);
      return generate(env, h, { models, system, maxTokens, wantJson, variants: [{ parts: [{ text: user }] }] });
    }

    /* ----- audio piece → transcript ----- */
    if (path === '/transcribe') {
      const len = Number(req.headers.get('content-length') || 0);
      const mime = (url.searchParams.get('mime') || req.headers.get('content-type') || '').split(';')[0].trim();
      if (!len || !req.body) return json({ error: 'empty', code: 'empty' }, 411, h);
      if (len > MAX_AUDIO) return json({ error: 'piece too big', code: 'toolong' }, 413, h);
      if (!/^(audio|video|image)\/[\w.+-]+$/.test(mime)) return json({ error: 'not audio', code: 'type' }, 415, h);
      const isImg = mime.startsWith('image/');
      const up = await uploadToGoogle(env, req, len, mime);
      if (up.error) return json({ error: up.error.text, code: errCode(up.error.status), status: up.error.status }, up.error.status === 429 ? 429 : 502, h);
      const part = { fileData: { mimeType: up.file.mimeType || mime, fileUri: up.file.uri } };
      return generate(env, h, { models: HEAR_MODELS, system: isImg ? READ : HEAR, maxTokens: 60000, wantJson: false,
        variants: [{ parts: [part, { text: isImg ? 'Read this page.' : 'Transcribe this recording.' }], temperature: 0 }] });
    }

    /* ----- YouTube link → transcript of one time range ----- */
    if (path === '/youtube') {
      let body; try { body = await req.json(); } catch { return json({ error: 'bad request' }, 400, h); }
      const id = ytId(body.url || '');
      if (!id) return json({ error: 'bad link', code: 'badlink' }, 400, h);
      const start = Math.max(0, Math.floor(Number(body.start) || 0)), end = Math.max(start + 60, Math.floor(Number(body.end) || start + 900));
      const file = { fileData: { fileUri: 'https://www.youtube.com/watch?v=' + id } };
      const ask = { text: `Transcribe the speech in this part of the video (from second ${start} to second ${end}).
If the video ends inside this part, write [[END]] on its own line at the very end.
If this part is after the end of the video, reply only: [[END]]` };
      return generate(env, h, { models: HEAR_MODELS, system: HEAR, maxTokens: 60000, wantJson: false, variants: [
        { parts: [{ ...file, videoMetadata: { startOffset: start + 's', endOffset: end + 's', fps: 0.2 } }, ask], temperature: 0, config: { mediaResolution: 'MEDIA_RESOLUTION_LOW' } },
        { parts: [{ ...file, videoMetadata: { startOffset: start + 's', endOffset: end + 's' } }, ask], temperature: 0 },
      ] });
    }

    return json({ error: 'not found' }, 404, h);
  },
};
