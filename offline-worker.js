// Offline transcription: Whisper running on the phone (transformers.js). Runs in its own thread so the app stays smooth.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6';
env.allowLocalModels = false;
env.useBrowserCache = true;
let asr = null, loaded = '';
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      if (loaded !== data.model) {
        asr = await pipeline('automatic-speech-recognition', data.model, {
          dtype: 'q8', device: 'wasm',
          progress_callback: p => self.postMessage({ type: 'progress', p }),
        });
        loaded = data.model;
      }
      self.postMessage({ type: 'ready' });
    }
    if (data.type === 'run') {
      const opts = { task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 };
      if (data.language) opts.language = data.language;
      const out = await asr(data.audio, opts);
      self.postMessage({ type: 'result', id: data.id, text: (Array.isArray(out) ? out.map(o => o.text).join(' ') : out.text) || '' });
    }
  } catch (e) {
    self.postMessage({ type: 'error', id: data.id, message: String(e?.message || e) });
  }
};
