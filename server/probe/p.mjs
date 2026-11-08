const W = 'https://jund-notes-ai.dawajund.workers.dev', O = { origin: 'https://mustatar-app.github.io', 'content-type': 'application/json' };
for (const url of ['https://calendar.google.com/calendar/ical/en.saudia%23holiday%40group.v.calendar.google.com/public/basic.ics', 'https://www.officeholidays.com/ics/saudi-arabia']) {
  const r = await fetch(W + '/ical', { method: 'POST', headers: O, body: JSON.stringify({ url }) });
  const j = await r.json(); console.log('ICAL', r.status, j.name, (j.events || []).length, JSON.stringify((j.events || [])[0] || j).slice(0, 160));
  const d = await fetch(url).then(x => x.status).catch(e => e.message); console.log('DIRECT', d);
}
