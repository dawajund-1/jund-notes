/* Zad — revision tools: flashcards with revision days, quizzes, the exam planner, the memorisation
   tracker, and "waiting on others" (tasks given to people, with a follow-up message). */
(() => {
'use strict';
const J = window.JN; if (!J) return;
const { store, esc } = J;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const addDays = (s, n) => { const d = new Date(s + 'T12:00'); d.setDate(d.getDate() + n); return iso(d); };
const toast = (t, ms) => window.JundCal?.toast(t, ms);
const F = () => window.JundFeatures;

// one dialog for review sessions, quizzes and the exam planner
const dlg = document.createElement('dialog');
dlg.id = 'study-dialog';
dlg.innerHTML = '<div class="row-between"><h2 id="sd-title"></h2><button type="button" class="ghost small" id="sd-close">Close</button></div><div id="sd-body"></div>';
document.body.appendChild(dlg);
$('#sd-close').onclick = () => dlg.close();
const open = (title, html) => { $('#sd-title').textContent = title; $('#sd-body').innerHTML = html; if (!dlg.open) dlg.showModal(); return $('#sd-body'); };

/* ---------- flashcards and spaced revision ---------- */
const STEPS = [1, 3, 7, 16, 35, 90];
const srs = () => store.get('srs', {});
async function allCards() {
  const ls = await J.allLessons(), out = [];
  for (const l of ls) (l.cards || []).forEach((c, i) => out.push({ id: `${l.id}:${i}`, ...c, lesson: l }));
  return out;
}
async function dueCards() {
  const s = srs(), t = today();
  return (await allCards()).filter(c => !s[c.id] || s[c.id].due <= t);
}
async function makeCards(l, then) {
  const body = open('Making cards and a quiz', '<div class="progress small"><div class="spinner"></div><div id="sd-st">Reading the lesson…</div></div>');
  const text = F().lessonText(l);
  const ar = J.langOf(text) === 'ar';
  const system = `From the study notes given, make revision cards and a quiz, in the same language as the notes${ar ? ' (Arabic)' : ''}.
Return JSON only: {"cards":[{"q":"","a":""}],"quiz":[{"q":"","options":["","","",""],"answer":0,"why":""}]}
- 10 to 16 cards: definitions, rules, conditions, differences, evidences, numbers, names. Short questions; answers under 25 words.
- 8 quiz questions, 4 options each, exactly one correct ("answer" is its index), wrong options believable; "why" is one short line.
- Use only what is in the notes. Copy Quran verses and hadith exactly as they appear in the notes.`;
  try {
    const r = await J.callServer({ system, user: text, maxTokens: 6000, onText: t => { const el = $('#sd-st'); if (el) el.textContent = `Writing… ${t.split(/\s+/).length} words`; } });
    const j = J.parseJSON(r.text);
    l.cards = (j.cards || []).filter(c => c.q && c.a);
    l.quiz = (j.quiz || []).filter(q => q.q && Array.isArray(q.options) && q.options.length >= 2);
    await J.saveLesson(l);
    then ? then() : body.innerHTML = `<p>✓ ${l.cards.length} cards and ${l.quiz.length} quiz questions are ready. The cards come back for revision after 1, 3, 7, 16 and 35 days.</p>
      <div class="row-gap"><button type="button" class="primary" id="sd-rev">Review the cards now</button><button type="button" class="ghost" id="sd-quiz">Take the quiz</button></div>`;
    if (!then) { $('#sd-rev').onclick = () => review(l.id); $('#sd-quiz').onclick = () => quiz(l); }
    home();
  } catch (e) { body.innerHTML = `<div class="error">${esc(J.errText(e))}</div>`; }
}
async function review(onlyLesson) {
  let queue = (await dueCards()).filter(c => !onlyLesson || c.lesson.id === onlyLesson);
  if (onlyLesson && !queue.length) queue = (await allCards()).filter(c => c.lesson.id === onlyLesson);
  let done = 0;
  const next = () => {
    if (!queue.length) { open('Revision', `<p style="font-size:1.1rem">✓ All done${done ? ` — ${done} cards reviewed` : ''}. See you on the next revision day.</p>`); home(); return; }
    const c = queue[0];
    const b = open(`Revision · ${queue.length} left`, `<div class="flash" dir="auto"><small>${esc(c.lesson.subject?.name || '')} · ${esc(c.lesson.notes?.title || c.lesson.unit)}</small>
      <div class="fq">${esc(c.q)}</div><div class="fa" id="fa" hidden>${esc(c.a)}</div></div>
      <div class="row-gap" id="f-show"><button type="button" class="primary big" id="f-ans">Show answer</button></div>
      <div class="row-gap f-grade" id="f-grade" hidden><button type="button" class="ghost" data-g="0">Again</button><button type="button" class="primary" data-g="1">Good</button><button type="button" class="ghost" data-g="2">Easy</button></div>`);
    $('#f-ans').onclick = () => { $('#fa').hidden = false; $('#f-show').hidden = true; $('#f-grade').hidden = false; };
    $$('[data-g]', b).forEach(x => x.onclick = () => {
      const g = +x.dataset.g, s = srs(), cur = s[c.id] || { step: -1 };
      queue.shift();
      if (g === 0) { s[c.id] = { step: 0, due: today() }; queue.push(c); }
      else { const step = Math.min(STEPS.length - 1, cur.step + g); s[c.id] = { step, due: addDays(today(), STEPS[step]) }; done++; }
      store.set('srs', s); next();
    });
  };
  next();
}
function quiz(l) {
  const qs = l.quiz || []; let i = 0, score = 0;
  const show = () => {
    if (i >= qs.length) { open('Quiz', `<p style="font-size:1.2rem"><b>${score} / ${qs.length}</b> correct.</p><p class="muted">${score === qs.length ? 'Excellent.' : 'Review the cards for the ones you missed.'}</p><div class="row-gap"><button type="button" class="primary" id="qz-again">Try again</button></div>`); $('#qz-again').onclick = () => quiz(l); return; }
    const q = qs[i];
    const b = open(`Quiz · ${i + 1} of ${qs.length}`, `<div class="flash" dir="auto"><div class="fq">${esc(q.q)}</div></div>
      <div class="qopts" dir="auto">${q.options.map((o, k) => `<button type="button" class="qopt" data-k="${k}">${esc(o)}</button>`).join('')}</div><div id="qz-why" class="muted" dir="auto"></div>`);
    $$('.qopt', b).forEach(x => x.onclick = () => {
      const k = +x.dataset.k, ok = k === +q.answer;
      if (ok) score++;
      $$('.qopt', b).forEach(y => { y.disabled = true; if (+y.dataset.k === +q.answer) y.classList.add('right'); });
      if (!ok) x.classList.add('wrong');
      $('#qz-why').innerHTML = `${ok ? '✓ Correct.' : '✗ Not quite.'} ${esc(q.why || '')}<div class="row-gap" style="margin-top:10px"><button type="button" class="primary" id="qz-next">Next</button></div>`;
      $('#qz-next').onclick = () => { i++; show(); };
    });
  };
  show();
}
function onLesson(l) {
  const box = $('#result-tools'); if (!box || l.draft) return;
  box.insertAdjacentHTML('afterbegin', `<button type="button" class="ghost small" id="rt-cards">🃏 ${l.cards?.length ? 'Review cards' : 'Make flashcards'}</button>${l.quiz?.length ? '<button type="button" class="ghost small" id="rt-quiz">✎ Quiz</button>' : ''}`);
  $('#rt-cards').onclick = () => l.cards?.length ? review(l.id) : makeCards(l);
  if ($('#rt-quiz')) $('#rt-quiz').onclick = () => quiz(l);
}

/* ---------- memorisation tracker ---------- */
const HIFZ = [1, 3, 7, 14, 30, 60];
const hifz = () => store.get('hifz', []);
const saveHifz = h => { store.set('hifz', h); J.cloud.putData('hifz', { saved: Date.now(), hifz: h }).catch(() => {}); };
const hifzDue = h => (h.r || 0) < HIFZ.length && addDays(h.learned, HIFZ[h.r || 0]) <= today();
function hifzCard() {
  const list = hifz(), due = list.filter(hifzDue), strong = list.filter(h => (h.r || 0) >= HIFZ.length).length;
  return `<div class="card" id="hifz-card"><div class="row-between"><div class="card-h" style="margin:0">Memorisation</div><small class="muted">${list.length} parts · ${strong} strong</small></div>
    <div class="row-gap" style="margin:10px 0 6px"><input id="hifz-new" type="text" dir="auto" placeholder="What did you memorise today? e.g. Surah al-Mulk 1–10" style="flex:1;min-width:0"><button type="button" class="primary" id="hifz-add">Add</button></div>
    ${due.length ? `<div class="card-h" style="margin:12px 0 4px;font-size:.9rem">Revise today</div>${due.map(h => `<div class="ev"><span class="bar-c" style="background:var(--gold)"></span><div class="body" dir="auto"><div class="t">${esc(h.text)}</div><div class="m">Memorised ${esc(h.learned)} · revision ${(h.r || 0) + 1} of ${HIFZ.length}</div></div><button type="button" class="primary small" data-hz="${h.id}">Revised ✓</button></div>`).join('')}`
      : `<div class="muted" style="font-size:.88rem">${list.length ? 'Nothing to revise today.' : 'Add what you memorise; the app brings it back after 1, 3, 7, 14, 30 and 60 days.'}</div>`}</div>`;
}
function wireHifz() {
  const add = () => { const t = $('#hifz-new').value.trim(); if (!t) return; saveHifz([...hifz(), { id: 'Z' + Date.now().toString(36), text: t, learned: today(), r: 0 }]); window.JundCal?.render(); home(); };
  $('#hifz-add').onclick = add; $('#hifz-new').onkeydown = e => { if (e.key === 'Enter') add(); };
  $$('[data-hz]').forEach(b => b.onclick = () => { const l = hifz(), h = l.find(x => x.id === b.dataset.hz); h.r = (h.r || 0) + 1; h.last = today(); saveHifz(l); window.JundCal?.render(); home(); });
}

/* ---------- waiting on others (delegated tasks) ---------- */
function waitingCard() {
  const evs = (window.JundCal?.events() || []).filter(e => e.who && !e.done && e.repeat !== 'weekly');
  if (!evs.length) return '';
  const by = {}; evs.forEach(e => (by[e.who] ||= []).push(e));
  return `<div class="card" id="wait-card"><div class="card-h">Waiting on others</div>${Object.entries(by).map(([who, l]) => `<div class="who-g"><div class="row-between"><b dir="auto">👤 ${esc(who)}</b><button type="button" class="ghost small" data-fu="${esc(who)}">Follow up</button></div>
    ${l.sort((a, b) => a.date.localeCompare(b.date)).map(e => `<div class="m" dir="auto" style="${e.date < today() ? 'color:var(--danger)' : ''}">• ${esc(e.title)} — ${e.date < today() ? 'was due ' : 'due '}${esc(e.date)}</div>`).join('')}</div>`).join('')}</div>`;
}
function wireWaiting() {
  $$('[data-fu]').forEach(b => b.onclick = () => {
    const who = b.dataset.fu, l = (window.JundCal?.events() || []).filter(e => e.who === who && !e.done);
    F().write(`Follow up with ${who}`, `You write a short, polite follow-up message (WhatsApp style) from ${J.me().name || 'the user'} to ${who} about the tasks given. Friendly and clear, ask for an update or a date, no pressure words. Write in English unless the task titles are Arabic, then write in Arabic. 4–7 lines.`,
      l.map(e => `- ${e.title} (due ${e.date})${e.notes ? ': ' + e.notes.split('\n')[0] : ''}`).join('\n'));
  });
}

/* ---------- exam planner ---------- */
async function planner() {
  const ls = (await J.allLessons()).filter(l => !l.draft);
  const subs = [...new Map(ls.map(l => [l.subject.id, l.subject.name])).entries()];
  const b = open('Plan an exam', `
    <label class="field"><span>Subject</span><select id="xp-sub" dir="auto">${subs.map(([id, n]) => `<option value="${esc(id)}">${esc(n)}</option>`).join('')}<option value="">Another (no notes yet)</option></select></label>
    <label class="field"><span>Exam name</span><input id="xp-name" type="text" dir="auto" placeholder="e.g. Final exam"></label>
    <div class="grid2"><label class="field"><span>Exam date</span><input id="xp-date" type="date"></label><label class="field"><span>Exam time</span><input id="xp-time" type="time" value="08:00"></label>
    <label class="field"><span>Revise each day at</span><input id="xp-at" type="time" value="20:00"></label><label class="field"><span>Minutes each time</span><select id="xp-min"><option>30</option><option selected>45</option><option>60</option><option>90</option></select></label></div>
    <div class="field"><span>Lessons to revise</span><div id="xp-lessons" class="xp-lessons"></div></div>
    <label class="check"><input type="checkbox" id="xp-cards" checked> Also make flashcards for lessons that don't have them (uses the internet)</label>
    <button type="button" class="primary big" id="xp-go">Make my revision plan</button><div class="muted" id="xp-st"></div>`);
  $('#xp-date').value = addDays(today(), 14);
  const fill = () => {
    const id = $('#xp-sub').value, mine = ls.filter(l => l.subject.id === id).sort((a, b) => a.date.localeCompare(b.date));
    $('#xp-lessons').innerHTML = mine.length ? mine.map(l => `<label class="check"><input type="checkbox" value="${l.id}" checked> <span dir="auto">${esc(l.notes?.title || l.unit)}</span></label>`).join('') : '<span class="muted">No notes for this subject. The plan will have general revision sessions.</span>';
    if (!$('#xp-name').value || $('#xp-name').dataset.auto) { $('#xp-name').value = 'Exam: ' + ($('#xp-sub').selectedOptions[0]?.textContent || ''); $('#xp-name').dataset.auto = '1'; }
  };
  $('#xp-sub').onchange = fill; $('#xp-name').oninput = () => delete $('#xp-name').dataset.auto; fill();
  $('#xp-go').onclick = async () => {
    const date = $('#xp-date').value, first = addDays(today(), 1);
    if (!date || date <= today()) { $('#xp-st').textContent = 'Choose an exam date after today.'; return; }
    const picked = $$('#xp-lessons input:checked').map(x => ls.find(l => l.id === x.value)).filter(Boolean);
    const subName = $('#xp-sub').selectedOptions[0]?.textContent || '';
    const days = []; for (let d = first; d < date; d = addDays(d, 1)) days.push(d);
    if (!days.length) { $('#xp-st').textContent = 'The exam is tomorrow: no days left to plan. Review your cards today.'; return; }
    const study = days.length > 2 ? days.slice(0, -1) : days;    // keep the last day for a full review
    const sessions = picked.length ? picked.map(l => ({ title: `Revise: ${l.notes?.title || l.unit}`, notes: `${subName} — ${l.unit}` }))
      : study.map((_, i) => ({ title: `Revise ${subName} (${i + 1})`, notes: '' }));
    const cal = window.JundCal, min = $('#xp-min').value;
    sessions.forEach((s, i) => cal.add({ title: s.title, date: study[Math.floor(i * study.length / sessions.length)], time: $('#xp-at').value, type: 'study', remind: 10, notes: `${min} min. ${s.notes}`.trim(), project: subName }));
    if (days.length > 2) cal.add({ title: `Full review: ${subName}`, date: days.at(-1), time: $('#xp-at').value, type: 'study', remind: 10, notes: 'Go through all the cards and the mind maps.', project: subName });
    cal.add({ title: $('#xp-name').value || 'Exam', date, time: $('#xp-time').value, type: 'exam', remind: 1440, project: subName });
    cal.save();
    $('#xp-st').textContent = `✓ Added ${sessions.length} revision sessions${days.length > 2 ? ', a full review day' : ''} and the exam to your calendar.`;
    if ($('#xp-cards').checked) for (const l of picked.filter(l => !l.cards?.length)) {
      const st = $('#xp-st') || $('#xp-st2'); if (st) st.textContent = `Making flashcards for “${l.notes?.title || l.unit}”…`;
      await new Promise(res => makeCards(l, res));
      open('Plan an exam', `<p>✓ Your revision plan is in the calendar.</p><p class="muted" id="xp-st2"></p>`);
    }
    toast('✓ Revision plan added');
  };
}

/* ---------- Home and Calendar pieces ---------- */
async function home() {
  const box = $('#hm-study'); if (!box) return;
  const n = (await dueCards()).length, h = hifz().filter(hifzDue).length;
  const parts = [];
  if (n) parts.push(`<button type="button" class="chip-b" id="hs-cards">🃏 ${n} cards to revise</button>`);
  if (h) parts.push(`<button type="button" class="chip-b" id="hs-hifz">📖 ${h} memorisation ${h === 1 ? 'part' : 'parts'} to revise</button>`);
  box.innerHTML = parts.join(''); box.hidden = !parts.length;
  if ($('#hs-cards')) $('#hs-cards').onclick = () => review();
  if ($('#hs-hifz')) $('#hs-hifz').onclick = () => { window.JundCal?.goToday(); J.show('calendar'); setTimeout(() => $('#hifz-card')?.scrollIntoView({ block: 'center' }), 100); };
}
function calendar() {
  let box = $('#study-cards');
  if (!box) { box = document.createElement('div'); box.id = 'study-cards'; $('#week-review').after(box); }
  const work = J.me().use === 'work';
  box.innerHTML = waitingCard() + (!work || hifz().length ? hifzCard() : '');
  if ($('#hifz-card')) wireHifz();
  wireWaiting();
}
$('#exam-plan').onclick = planner;
window.JundStudy = { onLesson, home, calendar, review, quiz, makeCards, planner };
J.cloud.getData('hifz').then(r => { if (r?.hifz && !hifz().length) { store.set('hifz', r.hifz); home(); } }).catch(() => {});
setTimeout(home, 800);
})();
