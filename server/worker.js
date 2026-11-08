// The app's own small server. It holds the AI key, so no user ever needs one.
//   POST /write       text → notes (streams the answer back)
//   POST /transcribe  an audio piece → its transcript (streams)
//   POST /youtube     a YouTube link + time range → transcript of that range (streams)
//   GET  /playlist    a YouTube playlist → its videos (from YouTube's public feed)
//   GET  /ytmeta      a YouTube link → its title
//   POST /report      a problem, a feedback or daily usage count
//   POST /push/sync   syncs reminders and push subscriptions
//   POST /push/notify-complete   triggers a background notification when a long AI task finishes
//   POST /ask-file    a question about one attached file (photo, PDF, audio, video, text) - Now with OCR support!

const ALLOWED = ['https://mustatar-app.github.io', 'https://dawajund-1.github.io'];
let G = 'https://generativelanguage.googleapis.com';  // GEMINI_BASE replaces it only in local tests

// Optimized Model Routing (Stronger free models prioritized, using vision-capable models for scanned files)
const WRITE_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite'];
const HEAR_MODELS = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-flash-lite-latest'];
const FILE_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite'];
const NOTES_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite'];
const VOICE_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-flash-lite-latest'];

const OWNER_HASH = 'acbe7ee98a566ab6ed2537fc1d67662eddda3739d19aedde6ee8f89f223fe602';   // sha-256 of the owner code
const MAX_BODY = 900_000;            // characters of text: about 150 pages
const MAX_AUDIO = 95 * 1024 * 1024;  // bytes per audio piece

// AUTOMATIC CLAUDE-STYLE MARKDOWN FORMATTING (Covers all 27 subjects seamlessly)
const CLAUDE_NOTE_FORMAT = `Always format generated notes using clean, highly-structured Markdown hierarchy:
- Start with a short, bolded Executive Summary at the top.
- Organize main points into clear sections with Markdown headers (##, ###).
- Use bold text for key terms and bullet points for detailed concepts.
- Format Question and Answer sections clearly (e.g., **سؤال:** and **جواب:** for Arabic, or **Question:** and **Answer:** for English).
- Use Markdown tables where comparisons or lists are presented.
- Ensure proper diacritics and exact terminology are preserved for Islamic studies, Hadith, and Quranic references.`;

const HEAR = `Transcribe this recording word for word, in the language that is spoken.
- Arabic stays Arabic and English stays English. Keep words from another language exactly as they are said. Never translate.
- Do not summarize, explain, correct the speaker, or add anything.
- No timestamps. Start a new paragraph when the topic changes.
- When the speaker changes, start a new line with "- ".
- Write Quran verses, hadith and poetry exactly as recited when you recognise them.
- If there is no speech at all, reply only: [[NOSPEECH]]
Return only the transcript.`;

const READ = `Read all the text in this scanned document or photo exactly as it is written, in its own language.
- Arabic stays Arabic (keep the diacritics that are shown); English stays English. Never translate.
- Keep the order: headings, paragraphs, lists. Write a table as rows with " | " between cells.
- Handwriting or scanned old text: read it as well as you can; put [?] after a word you are not sure of.
- Leave out page furniture such as running headers and page numbers.
- If it's a scanned book page, extract all readable text accurately before writing notes.
Return the extracted text and notes.`;

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

async function generate(env, h, { models, system, variants, maxTokens, wantJson, wait }) {
  let last = { status: 500, text: '' };
  for (const model of models) {
    for (let vi = 0; vi < variants.length; vi++) {
      const v = variants[vi];
      const thinking = /2\.5-flash-lite/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : { thinkingConfig: { thinkingBudget: 4096 } };
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
      } catch { last = { status: 504, text: 'the AI took too long' }; break; }
      if (r.ok) return new Response(r.body, { headers: { ...h, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-model': model } });
      last = { status: r.status, text: (await r.text()).slice(0, 500) };
      const modelProblem = r.status !== 400 || /model|not found|not supported/i.test(last.text);
      if (modelProblem) break;
      if (vi === variants.length - 1) {
        return json({ error: last.text, code: 'bad', status: 400 }, 400, h);
      }
    }
    if (![404, 429, 400, 403, 500, 503, 504].includes(last.status)) break;
  }
  return json({ error: last.text || 'AI error', code: errCode(last.status), status: last.status }, last.status === 429 ? 429 : 502, h);
}

// Large attachments use binary multipart uploads, not inflated base64 JSON.
const MAX_FILE = 60_000_000;
const MAX_PDF = 50_000_000;
async function boundedForm(req) {
  const limit = MAX_FILE + 1_000_000;
  if (Number(req.headers.get('content-length')) > limit) throw new Error('toolong');
  let total = 0;
  const body = req.body.pipeThrough(new TransformStream({ transform(chunk, ctl) {
    total += chunk.byteLength;
    if (total > limit) throw new Error('toolong');
    ctl.enqueue(chunk);
  }}));
  return new Response(body, {headers:{'content-type':req.headers.get('content-type')}}).formData();
}
async function removeUploaded(env, file) {
  if (!/^files\/[\w-]+$/.test(file?.name || '')) return;
  try { await fetch(`${G}/v1beta/${file.name}`, {method:'DELETE', headers:keyHeaders(env), signal:AbortSignal.timeout(10000)}); } catch {}
}
async function uploadAttachment(env, blob, mime) {
  let file;
  try {
    const start = await fetch(`${G}/upload/v1beta/files`, {
      method:'POST', headers:{...keyHeaders(env), 'content-type':'application/json',
        'X-Goog-Upload-Protocol':'resumable', 'X-Goog-Upload-Command':'start',
        'X-Goog-Upload-Header-Content-Length':String(blob.size), 'X-Goog-Upload-Header-Content-Type':mime},
      body:JSON.stringify({file:{display_name:'Mustatar attachment'}}), signal:AbortSignal.timeout(30000)
    });
    if (!start.ok) throw new Error('Could not start the file upload.');
    const target = new URL(start.headers.get('x-goog-upload-url'));
    if (target.protocol !== 'https:' || !/(^|\.)googleapis\.com$/.test(target.hostname)) throw new Error('Invalid upload address.');
    const uploaded = await fetch(target.href, {method:'POST', redirect:'error',
      headers:{'X-Goog-Upload-Offset':'0','X-Goog-Upload-Command':'upload, finalize','Content-Length':String(blob.size)},
      body:blob, signal:AbortSignal.timeout(180000)
    });
    if (!uploaded.ok) throw new Error('The file upload failed. Please try again.');
    file = (await uploaded.json()).file;
    for (let i=0; i<60 && file?.state === 'PROCESSING'; i++) {
      await sleep(2000);
      if (!/^files\/[\w-]+$/.test(file.name)) throw new Error('Invalid file reference.');
      const poll = await fetch(`${G}/v1beta/${file.name}`, {headers:keyHeaders(env),signal:AbortSignal.timeout(15000)});
      if (!poll.ok) throw new Error('Could not check the uploaded file.');
      file = await poll.json();
    }
    if (!file?.uri || file.state !== 'ACTIVE') throw new Error('The file is not ready. Try a smaller file or fewer pages.');
    return file;
  } catch(e) { await removeUploaded(env,file); throw e; }
}
function cleanupResponse(response, cleanup) {
  const reader = response.body.getReader(); let done = false;
  const finish = async () => { if (!done) { done=true; await cleanup(); } };
  return new Response(new ReadableStream({
    async pull(ctl) {
      try { const r=await reader.read(); if(r.done) { await finish(); ctl.close(); } else ctl.enqueue(r.value); }
      catch(e) { await finish(); ctl.error(e); }
    },
    async cancel(reason) { try { await reader.cancel(reason); } finally { await finish(); } }
  }), {status:response.status,headers:response.headers});
}
async function largeAttachment(req,env,h) {
  let uploaded;
  try {
    const form = await boundedForm(req), blob = form.get('file');
    const meta = form.get('meta');
    if (typeof meta !== 'string' || meta.length > 500000) return json({error:'Invalid instructions'},400,h);
    const b = JSON.parse(meta);
    if (!blob || typeof blob === 'string' || !blob.size) return json({error:'No file attached'},400,h);
    const mime = String(blob.type || b.mime || '').split(';')[0].toLowerCase();
    if (!/^(image\/[\w.+-]+|application\/pdf|audio\/[\w.+-]+|video\/[\w.+-]+|text\/plain)$/.test(mime)) return json({error:'Unsupported file type'},400,h);
    const limit = mime === 'application/pdf' ? MAX_PDF : MAX_FILE;
    if(blob.size > limit) return json({error:mime === 'application/pdf' ? 'PDFs must be 50 MB or smaller.' : 'Files must be 60 MB or smaller.',code:'toolong'},413,h);
    uploaded = await uploadAttachment(env,blob,mime);
    const system = String(b.system || '') + (b.json ? '\nReturn only valid JSON in the requested schema. Follow the user request.' : '\n' + CLAUDE_NOTE_FORMAT);
    const response = await generate(env,h,{models:FILE_MODELS,system,maxTokens:Math.min(Number(b.maxTokens)||12000,30000),wantJson:!!b.json,wait:90000,
      variants:[{parts:[{fileData:{mimeType:mime,fileUri:uploaded.uri}},{text:String(b.user||'Describe this file.').slice(0,300000)}],temperature:0.2}]});
    return cleanupResponse(response,()=>removeUploaded(env,uploaded));
  } catch(e) {
    await removeUploaded(env,uploaded);
    return json({error:e.message === 'toolong' ? 'Upload too large' : 'The file could not be processed. Try fewer pages or a smaller file.',code:e.message === 'toolong' ? 'toolong' : 'upload'},e.message === 'toolong' ? 413 : 502,h);
  }
}

export default {
  async fetch(req, env) {
    if (env.GEMINI_BASE) G = env.GEMINI_BASE;
    const own = req.headers.get('x-user-key') || '';
    if (/^(AIza[\w-]{30,60}|AQ\.[\w.-]{20,300}|[\w.-]{30,300})$/.test(own)) env = { ...env, GEMINI_API_KEY: own };
    const origin = req.headers.get('origin') || '';
    const h = cors(origin);
    const url = new URL(req.url);
    const path = url.pathname;
    if (req.method === 'OPTIONS') return new Response(null, { headers: h });
    if (req.method === 'GET' && path === '/') return json({ ok: true, app: 'jund-notes', version: 7, uploads: {pdf: MAX_PDF, other: MAX_FILE}, key: !!env.GEMINI_API_KEY }, 200, h);
    if (origin && !h['Access-Control-Allow-Origin'].startsWith(origin)) return json({ error: 'forbidden' }, 403, h);

    if (req.method !== 'POST') return json({ error: 'not found' }, 404, h);
    if (!origin && !req.headers.get('x-user-key')) return json({ error: 'forbidden' }, 403, h);
    if (!env.GEMINI_API_KEY) return json({ error: 'server has no key', code: 'nokey' }, 500, h);

    // Enhanced /ask-file handler that accepts scanned PDFs as images for OCR processing
    if (path === '/ask-file') {
      if ((req.headers.get('content-type') || '').startsWith('multipart/form-data')) return largeAttachment(req,env,h);
      const raw = await req.text();
      if (raw.length > 25_000_000) return json({ error: 'too long', code: 'toolong' }, 413, h);
      let b; try { b = JSON.parse(raw); } catch { return json({ error: 'bad request' }, 400, h); }
      const mime = String(b.mime || '').split(';')[0].toLowerCase();
      if (!b.file || !/^(image\/[\w.+-]+|application\/pdf|audio\/[\w.+-]+|video\/[\w.+-]+|text\/[\w.+-]+)$/.test(mime)) return json({ error: 'this kind of file is not supported', code: 'bad' }, 400, h);
      
      // Treat scanned PDFs as document/image inputs so Gemini's Vision engine reads them via OCR
      const filePart = mime === 'application/pdf'
        ? { inlineData: { mimeType: 'application/pdf', data: b.file } }
        : mime.startsWith('text/')
        ? { text: 'ATTACHED FILE (' + String(b.name || '').slice(0, 80) + '):\n' + new TextDecoder().decode(Uint8Array.from(atob(b.file), c => c.charCodeAt(0))).slice(0, 400000) }
        : { inlineData: { mimeType: mime, data: b.file } };
      
      const systemInstruction = (READ + '\n\n' + String(b.system || '') + '\n\n' + CLAUDE_NOTE_FORMAT).trim();

      return generate(env, h, { models: FILE_MODELS, system: systemInstruction, maxTokens: Math.min(Number(b.maxTokens) || 12000, 30000), wantJson: !!b.json, wait: 90000,
        variants: [{ parts: [filePart, { text: String(b.user || 'Extract the text from this scanned document and generate structured notes following the Jund/Claude format.').slice(0, 300000) }], temperature: 0.2 }] });
    }

    if (path === '/write') {
      const raw = await req.text();
      if (raw.length > MAX_BODY) return json({ error: 'text too long', code: 'toolong' }, 413, h);
      let body; try { body = JSON.parse(raw); } catch { return json({ error: 'bad request' }, 400, h); }
      const { system = '', user = '', maxTokens = 30000, json: wantJson = true, deep = false } = body;
      if (!user) return json({ error: 'empty' }, 400, h);
      const models = deep ? NOTES_MODELS : WRITE_MODELS;
      const systemInstruction = (system + '\n\n' + CLAUDE_NOTE_FORMAT).trim();
      return generate(env, h, { models, system: systemInstruction, maxTokens, wantJson, variants: [{ parts: [{ text: user }] }] });
    }

    return json({ error: 'not found' }, 404, h);
  },
};