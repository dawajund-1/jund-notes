// The app's own small server. It holds the AI key, so no user ever needs one.
// It forwards the request to Google's free AI and streams the answer back.

const ALLOWED = ['https://dawajund-1.github.io'];
const DEFAULT_MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-2.5-flash'];
const MAX_BODY = 900_000; // characters: about 150 pages of text

function cors(origin) {
  const ok = ALLOWED.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED[0],
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Vary': 'Origin',
  };
}
const json = (obj, status, headers) => new Response(JSON.stringify(obj), { status, headers: { ...headers, 'content-type': 'application/json; charset=utf-8' } });

export default {
  async fetch(req, env) {
    const origin = req.headers.get('origin') || '';
    const h = cors(origin);
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: h });
    if (req.method === 'GET' && url.pathname === '/') return json({ ok: true, app: 'jund-notes', key: !!env.GEMINI_API_KEY }, 200, h);
    if (req.method !== 'POST' || url.pathname !== '/write') return json({ error: 'not found' }, 404, h);
    if (origin && !h['Access-Control-Allow-Origin'].startsWith(origin)) return json({ error: 'forbidden' }, 403, h);
    if (!env.GEMINI_API_KEY) return json({ error: 'server has no key', code: 'nokey' }, 500, h);

    const raw = await req.text();
    if (raw.length > MAX_BODY) return json({ error: 'text too long', code: 'toolong' }, 413, h);
    let body; try { body = JSON.parse(raw); } catch { return json({ error: 'bad request' }, 400, h); }
    const { system = '', user = '', maxTokens = 30000, json: wantJson = true } = body;
    if (!user) return json({ error: 'empty' }, 400, h);

    const models = (env.MODELS ? String(env.MODELS).split(',') : DEFAULT_MODELS).map(s => s.trim()).filter(Boolean);
    const payload = JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: Math.min(Number(maxTokens) || 30000, 60000),
        ...(wantJson ? { responseMimeType: 'application/json' } : {}),
      },
    });

    // try each model in turn: a model that is missing or out of free quota today is skipped
    let last = { status: 500, text: '' };
    for (const model of models) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: payload,
      });
      if (r.ok) {
        return new Response(r.body, { headers: { ...h, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-model': model } });
      }
      last = { status: r.status, text: (await r.text()).slice(0, 500) };
      if (![404, 429, 400, 403, 500, 503].includes(r.status)) break;
      if (r.status === 400 && !/model|not found|not supported/i.test(last.text)) break;
    }
    const code = last.status === 429 ? 'quota' : last.status === 403 ? 'key' : 'ai';
    return json({ error: last.text || 'AI error', code, status: last.status }, last.status === 429 ? 429 : 502, h);
  },
};
