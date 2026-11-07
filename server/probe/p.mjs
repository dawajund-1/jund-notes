const W = 'https://jund-notes-ai.dawajund.workers.dev', O = { origin: 'https://dawajund-1.github.io', 'content-type': 'application/json' };
const t = await fetch(W + '/live/token', { method: 'POST', headers: O, body: '{}' }); const j = await t.json();
console.log('TOKEN', t.status, j.models, !!j.token, j.error || '');
await new Promise(res => {
  const ws = new WebSocket(`${j.ws}?access_token=${encodeURIComponent(j.token)}`); let n = 0, txt = '';
  ws.onopen = () => ws.send(JSON.stringify({ setup: { model: 'models/' + j.models[0], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } } }, systemInstruction: { parts: [{ text: 'Reply in one short sentence in the language of the user.' }] }, inputAudioTranscription: {}, outputAudioTranscription: {}, contextWindowCompression: { slidingWindow: {} } } }));
  ws.onmessage = async e => { const m = JSON.parse(typeof e.data === 'string' ? e.data : await e.data.text());
    if (m.setupComplete) { console.log('SETUP OK'); ws.send(JSON.stringify({ realtimeInput: { text: 'ما هو الاستصحاب في أصول الفقه؟' } })); }
    for (const p of m.serverContent?.modelTurn?.parts || []) if (p.inlineData) n += p.inlineData.data.length;
    if (m.serverContent?.outputTranscription) txt += m.serverContent.outputTranscription.text;
    if (m.serverContent?.turnComplete) { console.log('REPLY audio b64', n, txt); ws.close(); res(); } };
  ws.onclose = e => { console.log('CLOSE', e.code, e.reason); res(); };
  setTimeout(res, 30000);
});
