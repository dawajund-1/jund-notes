// The app's own small server. It holds the AI key, so no user ever needs one.
//   POST /write       text → notes (streams the answer back)
//   POST /transcribe  an audio piece → its transcript (streams)
//   POST /youtube     a YouTube link + time range → transcript of that range (streams)
//   GET  /playlist    a YouTube playlist → its videos (from YouTube's public feed)
//   GET  /ytmeta      a YouTube link → its title

const ALLOWED = ['https://dawajund-1.github.io'];
let G = 'https://generativelanguage.googleapis.com';  // GEMINI_BASE replaces it only in local tests
const WRITE_MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-2.5-flash'];
const HEAR_MODELS = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-flash-lite-latest'];
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
async function generate(env, h, { models, system, variants, maxTokens, wantJson }) {
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
      const r = await fetch(`${G}/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...keyHeaders(env) }, body: payload,
      });
      if (r.ok) return new Response(r.body, { headers: { ...h, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-model': model } });
      last = { status: r.status, text: (await r.text()).slice(0, 500) };
      const modelProblem = r.status !== 400 || /model|not found|not supported/i.test(last.text);
      if (modelProblem) break;               // try the next model
      if (vi === variants.length - 1) {      // the request itself was refused: stop
        return json({ error: last.text, code: 'bad', status: 400 }, 400, h);
      }
    }
    if (![404, 429, 400, 403, 500, 503].includes(last.status)) break;
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
  const unsigned = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://dawajund-1.github.io/jund-notes/' });
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
    rec.reminders.push({ at: Date.now(), title: 'Test reminder', body: 'Reminders work even when Daftar is closed.', tag: 'test-' + Date.now(), sent: false });
    await env.PUSH.put('s:' + b.id, JSON.stringify(rec));
    const r = await sendPush(env, rec.sub);
    return json({ ok: r.ok, status: r.status }, 200, h);
  }
  return json({ error: 'not found' }, 404, h);
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
    if (/^AIza[\w-]{30,60}$/.test(own)) env = { ...env, GEMINI_API_KEY: own };
    const origin = req.headers.get('origin') || '';
    const h = cors(origin);
    const url = new URL(req.url);
    const path = url.pathname;
    if (req.method === 'OPTIONS') return new Response(null, { headers: h });
    if (req.method === 'GET' && path === '/') return json({ ok: true, app: 'jund-notes', version: 3, key: !!env.GEMINI_API_KEY, push: !!env.PUSH }, 200, h);
    if (path.startsWith('/push/')) return pushRoutes(req, env, h, path, url);
    if (origin && !h['Access-Control-Allow-Origin'].startsWith(origin)) return json({ error: 'forbidden' }, 403, h);

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
