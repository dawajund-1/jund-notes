/* The AI that runs on the phone itself: free, offline after the first download, no keys. */
(() => {
'use strict';
const MODELS = {
  light:  { id: 'Qwen3.5-2B-q4f16_1-MLC', f32: 'Qwen3.5-2B-q4f32_1-MLC', name: 'خفيف', size: 'نحو ١٫٥ جيجا' },
  fast:   { id: 'Qwen3.5-4B-q4f16_1-MLC', f32: 'Qwen3.5-4B-q4f32_1-MLC', name: 'سريع', size: 'نحو ٢٫٥ جيجا' },
  strong: { id: 'Qwen3.5-9B-q4f16_1-MLC', f32: 'Qwen3.5-9B-q4f32_1-MLC', name: 'أقوى', size: 'نحو ٥ جيجا' },
};
// memory the AI may use: a normal setting, and a lighter one used after the phone's graphics chip gives up once
const CONTEXTS = [8192, 6144];
let lite = false;
try { lite = localStorage.getItem('jn_aiLite') === '1'; } catch {}

let lib = null, engine = null, worker = null, loadedId = null, loading = null, grammarOk = true;

async function support() {
  if (!('gpu' in navigator)) return { ok: false, why: 'هذا المتصفح لا يدعم تشغيل الذكاء على الجوال. افتح التطبيق في Chrome محدّث.' };
  try {
    const ad = await navigator.gpu.requestAdapter();
    if (!ad) return { ok: false, why: 'لم يسمح الجوال بتشغيل الذكاء عليه. حدّث Chrome ثم حاول.' };
    return { ok: true, f16: ad.features.has('shader-f16') };
  } catch { return { ok: false, why: 'تعذّر تشغيل الذكاء على هذا الجوال.' }; }
}

async function pick(size) {
  const m = MODELS[size] || MODELS.fast;
  const s = await support();
  if (!s.ok) throw new Error(s.why);
  return s.f16 ? m.id : m.f32;
}

async function isDownloaded(size) {
  try {
    lib ??= await import('./vendor/web-llm.js');
    return await lib.hasModelInCache(await pick(size));
  } catch { return false; }
}

async function load(size, onProgress) {
  const id = await pick(size);
  if (engine && loadedId === id) return engine;
  if (loading) return loading;
  loading = (async () => {
    lib ??= await import('./vendor/web-llm.js');
    try { await navigator.storage?.persist?.(); } catch {}
    await reset();
    worker = new Worker(new URL('./ai-worker.js', location.href), { type: 'module' });
    engine = await lib.CreateWebWorkerMLCEngine(worker, id, {
      initProgressCallback: p => onProgress?.(p),
    }, { context_window_size: CONTEXTS[lite ? 1 : 0] });
    loadedId = id;
    return engine;
  })();
  try { return await loading; } finally { loading = null; }
}

async function reset() {
  if (engine) { try { await engine.unload(); } catch {} }
  if (worker) { try { worker.terminate(); } catch {} }
  engine = null; worker = null; loadedId = null;
}
const gpuTrouble = e => /GPU|mapAsync|device (was )?lost|Buffer was|out of memory|OOM|DXGI|instance reference|disposed/i.test(String(e?.message || e) + ' ' + (e?.name || ''));

// Same shape as the Claude call: returns { text, stop }.
// If the phone's graphics chip drops the work (low memory, screen off), start the AI again once, lighter.
async function generate(opts) {
  try { return await generateOnce(opts); }
  catch (e) {
    if (opts.signal?.aborted || !gpuTrouble(e)) throw e;
    opts.onProgress?.({ progress: 0, text: 'restart' });
    lite = true; try { localStorage.setItem('jn_aiLite', '1'); } catch {}
    await reset();
    try { return await generateOnce(opts); }
    catch (e2) {
      if (gpuTrouble(e2)) { const x = new Error('GPU: ذاكرة الجوال لم تكفِ أو انطفأت الشاشة أثناء الكتابة.'); x.gpu = true; throw x; }
      throw e2;
    }
  }
}
async function generateOnce({ size, system, user, maxTokens = 2500, onText, onProgress, signal }) {
  const eng = await load(size, onProgress);
  const stopper = () => { try { eng.interruptGenerate(); } catch {} };
  signal?.addEventListener('abort', stopper, { once: true });
  let text = '', stop = '';
  const run = async (fmt) => {
    text = ''; stop = '';
    const chunks = await eng.chat.completions.create({
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      stream: true, temperature: 0.3, top_p: 0.9, max_tokens: maxTokens,
      ...(fmt ? { response_format: fmt } : {}),
      extra_body: { enable_thinking: false },
    });
    for await (const c of chunks) {
      const d = c.choices?.[0]?.delta?.content || '';
      if (d) { text += d; onText?.(text); }
      stop = c.choices?.[0]?.finish_reason || stop;
    }
  };
  try {
    // the JSON rule needs a schema given as text; any object is allowed
    try { await run(grammarOk ? { type: 'json_object', schema: '{"type":"object"}' } : null); }
    catch (e) {
      if (!/Grammar|xgrammar|schema|std::string/i.test(String(e?.message || e))) throw e;
      grammarOk = false; await run(null);   // this phone cannot use the JSON rule: write freely, the app repairs it
    }
  } finally { signal?.removeEventListener('abort', stopper); }
  if (signal?.aborted) { const e = new Error('أُوقف'); e.name = 'AbortError'; throw e; }
  return { text, stop: stop === 'length' ? 'max_tokens' : stop };
}

async function remove(size) {
  lib ??= await import('./vendor/web-llm.js');
  const id = await pick(size);
  if (loadedId === id && engine) { try { await engine.unload(); } catch {} engine = null; loadedId = null; }
  await lib.deleteModelAllInfoInCache(id);
}

window.LocalAI = { MODELS, support, isDownloaded, load, generate, remove, reset, isLite: () => lite };
})();
