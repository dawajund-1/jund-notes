import fs from 'fs';
const W = 'https://jund-notes-ai.dawajund.workers.dev', O = { origin: 'https://dawajund-1.github.io', 'content-type': 'application/json' };
const audio = fs.readFileSync('a.webm').toString('base64');
for (let i = 0; i < 3; i++) {
  const t0 = Date.now();
  const r = await fetch(W + '/ask-voice', { method: 'POST', headers: O, body: JSON.stringify({ audio, mime: 'audio/webm', system: 'Reply with JSON {"heard":"","reply":"","lang":""}', user: '(first question)' }) });
  const body = await r.text();
  console.log('ASK', i, r.status, r.headers.get('x-model'), (Date.now() - t0) + 'ms', body.slice(0, 400).replace(/\n/g, ' '));
}
