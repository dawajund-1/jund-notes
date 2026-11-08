const W = 'https://jund-notes-ai.dawajund.workers.dev', O = { origin: 'https://dawajund-1.github.io', 'content-type': 'application/json' };
let r = await fetch(W + '/report', { method: 'POST', headers: O, body: JSON.stringify({ kind: 'event', anon: 'probe', msg: 'server check', app: '5.0' }) });
console.log('REPORT', r.status, await r.text());
r = await fetch(W + '/owner/reports', { method: 'POST', headers: O, body: JSON.stringify({ code: 'WRONG' }) });
console.log('OWNER-WRONG', r.status);
