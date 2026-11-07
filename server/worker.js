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

export default {
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
    if (req.method === 'GET' && path === '/') return json({ ok: true, app: 'jund-notes', version: 2, key: !!env.GEMINI_API_KEY }, 200, h);
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
      if (!/^(audio|video)\/[\w.+-]+$/.test(mime)) return json({ error: 'not audio', code: 'type' }, 415, h);
      const up = await uploadToGoogle(env, req, len, mime);
      if (up.error) return json({ error: up.error.text, code: errCode(up.error.status), status: up.error.status }, up.error.status === 429 ? 429 : 502, h);
      const part = { fileData: { mimeType: up.file.mimeType || mime, fileUri: up.file.uri } };
      return generate(env, h, { models: HEAR_MODELS, system: HEAR, maxTokens: 60000, wantJson: false,
        variants: [{ parts: [part, { text: 'Transcribe this recording.' }], temperature: 0 }] });
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
