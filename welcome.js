/* Mustatar — the first-open welcome: language, name, what you do, and the AI (shared, or your own free Google key in one minute). */
(() => {
'use strict';
const J = window.JN; if (!J) return;
const { store, esc } = J;
const AR = window.ZadLang === 'ar';
const L = (en, ar) => AR ? ar : en;
const ROLES = [
  ['student', '🎓', 'Student', 'طالب', 'study'], ['seeker', '📖', 'Student of knowledge', 'طالب علم', 'study'],
  ['teacher', '🧑‍🏫', 'Teacher', 'معلّم', 'work'], ['employee', '💼', 'Employee', 'موظف', 'work'],
  ['developer', '💻', 'Developer', 'مبرمج', 'work'], ['business', '🏪', 'Business owner', 'صاحب عمل', 'work'],
  ['creator', '🎬', 'Content creator', 'صانع محتوى', 'work'], ['other', '✨', 'Something else', 'غير ذلك', 'work'],
];
const KEY_URL = 'https://aistudio.google.com/apikey';
let box;

function start(force) {
  if (!force && store.get('welcomed')) return;
  box = document.createElement('div');
  box.className = 'wl'; box.setAttribute('data-noi18n', ''); box.dir = AR ? 'rtl' : 'ltr';
  document.body.appendChild(box); document.body.classList.add('vx-open');
  step(store.get('welcomeStep', 1));
}
function finish() {
  store.set('welcomed', true); store.set('welcomeStep', 1);
  box?.remove(); document.body.classList.remove('vx-open');
  try { window.JundAssistant?.home(); } catch {}
  window.JundReport?.event('welcome-done');
}
function frame(n, html) {
  box.innerHTML = `<div class="wl-card">
    <div class="wl-top"><img src="icon-192.png" alt="" width="44" height="44"><div class="wl-dots">${[1, 2, 3].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div>
      <button type="button" class="ghost small wl-skip">${L('Skip', 'تخطَّ')}</button></div>${html}</div>`;
  box.querySelector('.wl-skip').onclick = finish;
}
function step(n) {
  store.set('welcomeStep', n);
  if (n === 1) {
    frame(1, `<h1 class="wl-h">${L('Welcome to Mustatar', 'أهلًا بك في مستطر')}</h1>
      <p class="wl-verse" dir="rtl">﴿وَكُلُّ صَغِيرٖ وَكَبِيرٖ مُّسۡتَطَرٌ﴾ <small>[القمر: 53]</small></p>
      <p class="muted">${L('Your notes, lessons, tasks, calendar and a voice assistant — everything small and big, written down.', 'ملاحظاتك ودروسك ومهامك وتقويمك ومساعد صوتي — كل صغير وكبير مكتوب.')}</p>
      <p class="wl-q">${L('Choose the app language', 'اختر لغة التطبيق')}</p>
      <div class="wl-two"><button type="button" class="wl-opt" data-l="en">English</button><button type="button" class="wl-opt" data-l="ar">العربية</button></div>`);
    box.querySelectorAll('[data-l]').forEach(b => b.onclick = () => {
      const want = b.dataset.l; store.set('welcomeStep', 2);
      if ((want === 'ar') !== AR) { store.set('uiLang', want); location.reload(); } else step(2);
    });
  }
  if (n === 2) {
    const me = J.me() || {};
    frame(2, `<h1 class="wl-h">${L('About you', 'عرّفنا بك')}</h1>
      <label class="field"><span>${L('Your first name', 'اسمك الأول')}</span><input id="wl-name" dir="auto" autocomplete="given-name" value="${esc(me.name || '')}"></label>
      <p class="wl-q">${L('What do you do? (choose one or more)', 'ماذا تعمل؟ (اختر واحدًا أو أكثر)')}</p>
      <div class="wl-roles">${ROLES.map(r => `<button type="button" class="wl-role${(me.roles || []).includes(r[0]) ? ' on' : ''}" data-r="${r[0]}"><span>${r[1]}</span>${L(r[2], r[3])}</button>`).join('')}</div>
      <label class="field"><span>${L('Where? (school, company — optional)', 'أين؟ (المدرسة أو الجهة — اختياري)')}</span><input id="wl-where" dir="auto" value="${esc(me.study || '')}"></label>
      <button type="button" class="primary wl-next">${L('Next', 'التالي')}</button>`);
    box.querySelectorAll('.wl-role').forEach(b => b.onclick = () => b.classList.toggle('on'));
    box.querySelector('.wl-next').onclick = () => {
      const roles = [...box.querySelectorAll('.wl-role.on')].map(b => b.dataset.r);
      const use = roles.some(r => ROLES.find(x => x[0] === r)[4] === 'study') && !roles.some(r => ROLES.find(x => x[0] === r)[4] === 'work') ? 'study' : roles.length ? 'work' : (me.use || 'study');
      store.set('me', { ...me, name: box.querySelector('#wl-name').value.trim(), study: box.querySelector('#wl-where').value.trim(), use, roles });
      window.JundReport?.event('roles:' + (roles.join('+') || 'none'));
      step(3);
    };
  }
  if (n === 3) {
    const has = store.get('userKey', '');
    frame(3, `<h1 class="wl-h">${L('The AI', 'الذكاء الاصطناعي')}</h1>
      <p class="muted">${L('Mustatar uses Google’s free AI (Gemini) to write notes, transcribe and answer you.', 'يستخدم مستطر ذكاء Google المجاني (Gemini) لكتابة الملاحظات والتفريغ والإجابة.')}</p>
      <div class="wl-ai">
        <div class="wl-box wl-best"><b>${L('★ Your own free key — recommended (1 minute)', '★ مفتاحك المجاني — الأفضل (دقيقة واحدة)')}</b>
          <p class="muted">${L('Your own daily limit, never shared with anyone. Free; no card needed.', 'حد يومي خاص بك وحدك. مجاني ولا يحتاج بطاقة.')}</p>
          <ol class="wl-steps">
            <li>${L('Tap the button — Google opens. Sign in with your Google account if asked.', 'اضغط الزر — تفتح صفحة Google. سجّل الدخول بحساب Google إن طُلب.')}</li>
            <li>${L('Tap <b>Create API key</b>, then the copy button next to the key.', 'اضغط <b>Create API key</b> ثم زر النسخ بجانب المفتاح.')}</li>
            <li>${L('Come back here and tap <b>Paste my key</b>.', 'ارجع هنا واضغط <b>الصق مفتاحي</b>.')}</li></ol>
          <a class="primary wl-go" href="${KEY_URL}" target="_blank" rel="noopener">${L('1 · Get my free key from Google', '١ · احصل على مفتاحي المجاني من Google')}</a>
          <button type="button" class="ghost wl-paste">${L('2 · Paste my key', '٢ · الصق مفتاحي')}</button>
          <input id="wl-key" type="password" dir="ltr" autocomplete="off" spellcheck="false" placeholder="AIza…" value="${esc(has)}">
          <div class="wl-msg muted" aria-live="polite"></div>
        </div>
        <button type="button" class="wl-box wl-shared"><b>${L('Start now with the shared AI', 'ابدأ الآن بالذكاء المشترك')}</b>
          <span class="muted">${L('Works straight away; the daily limit is shared by everyone. You can add your key later in Settings.', 'يعمل فورًا، والحد اليومي مشترك بين الجميع. يمكنك إضافة مفتاحك لاحقًا من الإعدادات.')}</span></button>
      </div>`);
    const msg = box.querySelector('.wl-msg'), inp = box.querySelector('#wl-key');
    const check = async k => {
      k = (k || '').trim().replace(/^["']|["']$/g, '');
      if (!/^AIza[\w-]{30,60}$/.test(k)) { msg.textContent = L('That does not look like a Google AI key (it starts with AIza). Copy it again.', 'هذا لا يبدو مفتاح Google (يبدأ بـ AIza). انسخه مرة أخرى.'); return; }
      inp.value = k; msg.textContent = L('Checking the key…', 'جارٍ فحص المفتاح…');
      let ok = null;
      try { const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(k)}`); ok = r.ok; } catch { ok = null; }
      if (ok === false) { msg.textContent = L('Google says this key is not valid. Copy it again, or create a new one.', 'تقول Google إن هذا المفتاح غير صالح. انسخه مرة أخرى أو أنشئ مفتاحًا جديدًا.'); return; }
      store.set('userKey', k);
      window.JundReport?.event('own-key');
      msg.textContent = L('✓ Your key works. You have your own daily limit.', '✓ مفتاحك يعمل. لديك حدك اليومي الخاص.');
      setTimeout(done, 900);
    };
    box.querySelector('.wl-paste').onclick = async () => {
      let t = '';
      try { t = await navigator.clipboard.readText(); } catch {}
      if (t) check(t); else { inp.focus(); msg.textContent = L('Long-press the box above and choose Paste.', 'اضغط مطولًا على الخانة أعلاه واختر لصق.'); }
    };
    inp.onchange = () => inp.value && check(inp.value);
    inp.onpaste = () => setTimeout(() => check(inp.value), 0);
    box.querySelector('.wl-shared').onclick = () => { window.JundReport?.event('shared-ai'); done(); };
  }
}
function done() {
  frame(3, `<h1 class="wl-h">${L('Ready ✓', 'جاهز ✓')}</h1>
    <p class="muted">${L('Three things to try first:', 'ثلاثة أشياء جرّبها أولًا:')}</p>
    <ul class="wl-try"><li>🎙 ${L('Tap <b>Record</b> in a class or meeting — you get clean notes.', 'اضغط <b>تسجيل</b> في درس أو اجتماع — تحصل على ملاحظات مرتبة.')}</li>
      <li>🗣 ${L('Tap the microphone on Home and just talk, in Arabic or English.', 'اضغط المايك في الرئيسية وتكلّم بالعربية أو الإنجليزية.')}</li>
      <li>✅ ${L('Add a task or event — you get a reminder on time.', 'أضف مهمة أو موعدًا — يصلك تنبيه في وقته.')}</li></ul>
    <p class="muted fine">${L('Something not working, or an idea? Settings → Send feedback.', 'شيء لا يعمل، أو لديك فكرة؟ الإعدادات ← أرسل ملاحظة.')}</p>
    <button type="button" class="primary wl-next">${L('Start', 'ابدأ')}</button>`);
  box.querySelector('.wl-next').onclick = finish;
}
window.JundWelcome = { start };
setTimeout(() => start(false), 300);
})();
