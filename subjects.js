// Subjects, where they are studied, and each subject's own colour family.
// hue/sat describe one dark colour family; every colour in that subject's file is a shade of it.
// Families never repeat inside the same place (الدار / الكلية).

window.FAMILIES = {
  navy:     { name: 'كحلي',      h: 216, s: 52 },
  teal:     { name: 'فيروزي داكن', h: 183, s: 52 },
  forest:   { name: 'أخضر غامق',  h: 140, s: 38 },
  olive:    { name: 'زيتوني',     h: 68,  s: 38 },
  plum:     { name: 'برقوقي',     h: 292, s: 30 },
  burgundy: { name: 'عنّابي',     h: 346, s: 48 },
  umber:    { name: 'بنّي',       h: 28,  s: 42 },
  slate:    { name: 'رمادي أردوازي', h: 208, s: 16 },
  copper:   { name: 'نحاسي',      h: 18,  s: 58 },
};

window.SUBJECTS = [
  // الدار
  { id: 'dar-mustalah', place: 'الدار', name: 'مصطلح الحديث', family: 'navy' },
  { id: 'dar-tawhid', place: 'الدار', name: 'التوحيد', book: 'العقيدة الطحاوية', family: 'teal' },
  { id: 'dar-muslim', place: 'الدار', name: 'صحيح مسلم', family: 'forest' },
  { id: 'dar-ibnmajah', place: 'الدار', name: 'سنن ابن ماجه', family: 'olive' },
  { id: 'dar-nahw', place: 'الدار', name: 'النحو', book: 'شرح ابن عقيل على الألفية', family: 'plum' },
  { id: 'dar-tafsir', place: 'الدار', name: 'التفسير', book: 'فتح القدير', family: 'burgundy' },
  { id: 'dar-usul', place: 'الدار', name: 'أصول الفقه', book: 'البلبل', family: 'umber' },
  { id: 'dar-madkhal', place: 'الدار', name: 'المدخل إلى أصول الفقه', family: 'slate' },
  { id: 'dar-takhrij', place: 'الدار', name: 'تخريج الأحاديث', family: 'copper' },
  // الكلية
  { id: 'kul-fiqh', place: 'الكلية', name: 'الفقه', book: 'الروض المربع', family: 'umber' },
  { id: 'kul-arabiyya', place: 'الكلية', name: 'اللغة العربية', book: 'أوضح المسالك', family: 'plum' },
  { id: 'kul-bahth', place: 'الكلية', name: 'قاعدة البحث في الفقه', family: 'slate' },
  { id: 'kul-muqaran', place: 'الكلية', name: 'الفقه المقارن', family: 'olive' },
  { id: 'kul-qawaid', place: 'الكلية', name: 'القواعد الأصولية', family: 'navy' },
  { id: 'kul-mawarith', place: 'الكلية', name: 'المواريث', family: 'teal' },
  { id: 'kul-ahadith', place: 'الكلية', name: 'أحاديث الأحكام', family: 'forest' },
  { id: 'kul-ayat', place: 'الكلية', name: 'آيات الأحكام', family: 'burgundy' },
  { id: 'kul-isnad', place: 'الكلية', name: 'التخريج ودراسة الأسانيد', family: 'copper' },
];

// Shades of one family for each role in the file.
window.paletteFor = function (familyKey) {
  const f = window.FAMILIES[familyKey] || window.FAMILIES.slate;
  const c = (dh, s, l, a) => a == null
    ? `hsl(${f.h + dh} ${s}% ${l}%)`
    : `hsl(${f.h + dh} ${s}% ${l}% / ${a})`;
  return {
    '--sub-head': c(0, f.s, 22),
    '--sub-def': c(0, f.s + 6, 27),
    '--sub-exp': c(0, Math.max(f.s - 10, 10), 33),
    '--sub-ex': c(-14, f.s, 28),
    '--sub-rule': c(14, f.s, 30),
    '--sub-warn': c(0, f.s + 12, 20),
    '--sub-line': c(0, f.s, 28, 0.55),
    '--tint-def': c(0, f.s, 40, 0.11),
    '--tint-exp': c(0, f.s, 40, 0.05),
    '--tint-ex': c(-14, f.s, 40, 0.07),
    '--tint-rule': c(14, f.s, 42, 0.09),
    '--tint-warn': c(0, f.s, 30, 0.13),
    '--tint-head': c(0, f.s, 40, 0.10),
  };
};

// every known subject, kept even when the list below is hidden, so a file can still be recognised by its content
window.ALL_SUBJECTS = window.SUBJECTS.slice();
const SUBJECT_WORDS = [
  ['dar-tawhid', /الطحاوي|العقيدة|عقيدة|التوحيد|توحيد|الأسماء والصفات|الصفات|القدر|الإيمان|tawhid|aqeed|aqid/i],
  ['dar-mustalah', /مصطلح|الحديث الصحيح|الحسن لغيره|الشاذ|المعلل|نخبة الفكر|الإسناد|mustalah/i],
  ['dar-nahw', /النحو|إعراب|الفاعل|المبتدأ|ابن عقيل|الألفية|nahw/i],
  ['dar-tafsir', /تفسير|فتح القدير|tafsir/i],
  ['kul-mawarith', /المواريث|الفرائض|التركة|العصبة|mawarith/i],
  ['kul-ayat', /آيات الأحكام/],
  ['kul-ahadith', /أحاديث الأحكام|بلوغ المرام|عمدة الأحكام/],
  ['dar-usul', /أصول الفقه|البلبل|usul/i],
  ['kul-fiqh', /الفقه|الروض المربع|الطهارة|الصلاة|الزكاة|fiqh/i],
  ['dar-takhrij', /التخريج|takhrij/i],
  ['dar-muslim', /صحيح مسلم/],
  ['dar-ibnmajah', /ابن ماجه/],
];
// the subject a text is about, or null
window.guessSubject = text => {
  const t = String(text || '');
  let best = null, n = 0;
  for (const [id, re] of SUBJECT_WORDS) { const c = (t.match(new RegExp(re.source, 'g' + (re.flags.includes('i') ? 'i' : ''))) || []).length; if (c > n) { n = c; best = id; } }
  return n >= 2 ? window.ALL_SUBJECTS.find(s => s.id === best) || null : null;
};
// This preset list belongs to students of Dar al-Hadith and Kulliyat al-Haram only. Everyone else starts with an empty
// list, and the app builds their own subjects or projects from what they actually use (each one gets its own colour).
(() => {
  const get = k => { try { return JSON.parse(localStorage.getItem('jn_' + k)); } catch { return null; } };
  const me = get('me') || {}, last = String(get('lastSubject') || '');
  const theirs = /dar|hadith|kulliy|haram|الدار|الحديث|الكلية|الحرم/i.test(String(me.study || '')) || /^(dar|kul)-/.test(last) || get('presetSubjects') === true;
  if (theirs) { try { localStorage.setItem('jn_presetSubjects', 'true'); } catch {} return; }
  window.SUBJECTS = [];
})();
// a colour family for a subject the person created, picked so neighbours differ
window.familyForName = name => { const g = window.guessSubject?.(name + ' ' + name); if (g) return g.family; const keys = Object.keys(window.FAMILIES); let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return keys[h % keys.length]; };
