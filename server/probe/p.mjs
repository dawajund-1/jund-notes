const W = 'https://jund-notes-ai.dawajund.workers.dev', O = { origin: 'https://mustatar-app.github.io', 'content-type': 'application/json' };
let r = await fetch(W + '/ical', { method: 'POST', headers: O, body: JSON.stringify({ url: 'https://calendar.google.com/calendar/ical/en.saudia%23holiday%40group.v.calendar.google.com/public/basic.ics' }) });
let j = await r.json(); console.log('ICAL', r.status, j.name, (j.events || []).length, JSON.stringify((j.events || [])[0] || j).slice(0, 200));
const id = 'abcdef0123456789abcdef0123456789';
r = await fetch(W + '/widget/sync', { method: 'POST', headers: O, body: JSON.stringify({ id, place: { name: 'Makkah', lat: 21.42, lon: 39.82 }, upcoming: [], style: 'clear', feed: [{ t: 'Exam: Ayat al-Ahkam', d: '2026-11-09', tm: '08:00', r: 30, w: false, id: 'E1' }, { t: 'Fiqh class', d: '2026-11-08', tm: '16:30', r: 10, w: true, id: 'E2' }] }) });
console.log('SYNC', r.status);
r = await fetch(W + '/ics/' + id + '.ics'); console.log('FEED', r.status, r.headers.get('content-type')); console.log((await r.text()).slice(0, 700));
r = await fetch(W + '/widget?id=' + id); console.log('WIDGET', r.status, (await r.text()).slice(0, 200));
