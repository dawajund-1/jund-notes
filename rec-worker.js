// Turns 16 kHz speech into a small MP3 (32 kbps: about 14 MB an hour), off the main thread.
importScripts('vendor/lame.min.js');
self.onmessage = ({ data }) => {
  const { pcm, id } = data;                 // Float32Array, 16 kHz mono
  const enc = new lamejs.Mp3Encoder(1, 16000, 32), out = [], STEP = 1152 * 20;
  const i16 = new Int16Array(STEP);
  for (let i = 0; i < pcm.length; i += STEP) {
    const n = Math.min(STEP, pcm.length - i);
    for (let k = 0; k < n; k++) { const v = pcm[i + k]; i16[k] = v < -1 ? -32768 : v > 1 ? 32767 : v * 32767; }
    const b = enc.encodeBuffer(n === STEP ? i16 : i16.subarray(0, n));
    if (b.length) out.push(new Uint8Array(b));
    if ((i / STEP) % 50 === 0) self.postMessage({ id, progress: i / pcm.length });
  }
  const end = enc.flush(); if (end.length) out.push(new Uint8Array(end));
  self.postMessage({ id, done: new Blob(out, { type: 'audio/mpeg' }) });
};
