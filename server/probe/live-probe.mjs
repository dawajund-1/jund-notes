// One-off check of Google's live-voice service (run in GitHub Actions; prints no secrets).
const K = process.env.GEMINI_API_KEY, G = 'https://generativelanguage.googleapis.com';
const log = (...a) => console.log(...a);
const ms = await (await fetch(`${G}/v1beta/models?pageSize=200&key=${K}`)).json();
const live = (ms.models || []).filter(m => (m.supportedGenerationMethods || []).includes('bidiGenerateContent')).map(m => m.name);
log('LIVE MODELS:', JSON.stringify(live));
const now = Date.now();
const bodies = {
  plain: { uses: 1, expireTime: new Date(now + 30 * 60e3).toISOString(), newSessionExpireTime: new Date(now + 2 * 60e3).toISOString() },
};
let token = null;
for (const ver of ['v1alpha', 'v1beta']) {
  for (const [n, b] of Object.entries(bodies)) {
    const r = await fetch(`${G}/${ver}/auth_tokens`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': K }, body: JSON.stringify(b) });
    const t = await r.text();
    log('TOKEN', ver, n, r.status, t.replace(/"name":\s*"[^"]{12}/, '"name": "<hidden>').slice(0, 300));
    if (r.ok && !token) { token = { ver, name: JSON.parse(t).name }; }
  }
}
const pick = live.find(m => /3\.\d-flash-live/.test(m)) || live.find(m => /native-audio/.test(m)) || live[0];
log('PICK', pick);
async function tryWs(ver, q, label) {
  return new Promise(res => {
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${ver}.GenerativeService.${q}`;
    const ws = new WebSocket(url); let audio = 0, texts = [], done = false;
    const end = why => { if (done) return; done = true; log('WS', label, why, 'audioBytes', audio, 'out:', texts.join('').slice(0, 200)); try { ws.close(); } catch {} res(); };
    ws.onopen = () => ws.send(JSON.stringify({ setup: { model: pick, generationConfig: { responseModalities: ['AUDIO'] }, systemInstruction: { parts: [{ text: 'Answer in one short sentence, in the language of the question.' }] }, outputAudioTranscription: {}, inputAudioTranscription: {} } }));
    ws.onmessage = async ev => {
      const s = typeof ev.data === 'string' ? ev.data : Buffer.from(await ev.data.arrayBuffer?.() ?? ev.data).toString();
      const m = JSON.parse(s);
      if (m.setupComplete) { log('WS', label, 'setupComplete'); ws.send(JSON.stringify({ realtimeInput: { text: 'ما هي عاصمة السعودية؟' } })); }
      const sc = m.serverContent;
      if (sc?.modelTurn?.parts) for (const p of sc.modelTurn.parts) { if (p.inlineData) { audio += p.inlineData.data.length * 0.75; if (!tryWs.mime) { tryWs.mime = p.inlineData.mimeType; log('MIME', p.inlineData.mimeType); } } if (p.text) texts.push(p.text); }
      if (sc?.outputTranscription?.text) texts.push(sc.outputTranscription.text);
      if (sc?.turnComplete) end('turnComplete');
      if (m.usageMetadata && !tryWs.u) { tryWs.u = 1; log('USAGE', JSON.stringify(m.usageMetadata).slice(0, 400)); }
    };
    ws.onerror = e => end('error ' + (e.message || ''));
    ws.onclose = e => end('close ' + e.code + ' ' + e.reason);
    setTimeout(() => end('timeout'), 25000);
  });
}
if (token) {
  await tryWs(token.ver, `BidiGenerateContentConstrained?access_token=${encodeURIComponent(token.name)}`, 'token-' + token.ver);
  if (token.ver !== 'v1alpha') {}
}
await tryWs('v1beta', `BidiGenerateContent?key=${K}`, 'key-v1beta');
