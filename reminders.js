/* Daftar — the daily reminder: a verse of the Quran (exact Mushaf text from the app's own copy, with the
   Saheeh International meaning from quranenc.com) and words of Ibn al-Qayyim and Ibn Rajab, each with its book. */
(() => {
'use strict';
const J = window.JN; if (!J) return;
const { store, esc } = J;
const $ = (s, r = document) => r.querySelector(s);

// verses: [sura, aya]; the Arabic is read from data/quran.json, never typed by hand
const VERSES = [[2,286],[2,152],[2,153],[2,186],[3,139],[3,200],[8,2],[9,51],[12,87],[13,28],[14,7],[16,97],[18,46],[20,114],[29,69],[33,41],
  [39,10],[39,53],[40,60],[47,7],[49,13],[51,56],[57,16],[59,18],[64,11],[65,3],[67,2],[93,5],[94,5],[94,6],[94,7],[2,45],[3,173],[17,80],
  [25,74],[28,24],[29,45],[41,30],[50,16],[55,13],[66,8],[87,14],[103,3],[2,201],[21,87],[4,110],[3,8],[7,23],[42,30],[64,16],[2,214],[3,31],[10,57],[3,159]];

// words of the scholars, copied from the printed books (via turath.io); "meaning" is our short English rendering
const SAYINGS = [
  { by: 'ابن القيم', ar: 'فَفِي الْقَلْبِ شَعَثٌ لَا يَلُمُّهُ إِلَّا الْإِقْبَالُ عَلَى اللَّهِ، وَفِيهِ وَحْشَةٌ لَا يُزِيلُهَا إِلَّا الْأُنْسُ بِهِ فِي خَلْوَتِهِ، وَفِيهِ حُزْنٌ لَا يُذْهِبُهُ إِلَّا السُّرُورُ بِمَعْرِفَتِهِ وَصِدْقِ مُعَامَلَتِهِ',
    en: 'In the heart there is a scattering that nothing gathers except turning to Allah; a loneliness that nothing removes except closeness to Him in private; and a sadness that nothing lifts except the joy of knowing Him and dealing with Him truthfully.',
    src: 'مدارج السالكين ٣/١٥٦ (ط. دار الكتاب العربي)' },
  { by: 'ابن القيم', ar: 'إضاعة الوقت أشدُّ من الموت؛ لأنَّ إضاعة الوقت تقطعك عن الله والدار الآخرة، والموتُ يقطعك عن الدنيا وأهلها',
    en: 'Wasting time is worse than death: wasting time cuts you off from Allah and the Hereafter, while death only cuts you off from this world and its people.',
    src: 'الفوائد ص٤٤ (ط. عطاءات العلم)' },
  { by: 'ابن القيم', ar: 'للعبد ربٌّ هو ملاقيه، وبيتٌ هو ساكنُه، فينبغي له أن يسترضيَ ربَّه قبل لقائه، ويعمُرَ بيته قبل انتقاله إليه',
    en: 'The servant has a Lord he will meet and a home he will live in; so let him seek his Lord’s pleasure before meeting Him, and build his home before moving into it.',
    src: 'الفوائد ص٤٤ (ط. عطاءات العلم)' },
  { by: 'ابن القيم', ar: 'أعظم الربح في الدنيا أن تشغل نفسك كل وقت بما هو أولى بها وأنفع لها في معادها',
    en: 'The greatest profit in this world is to keep yourself busy, every moment, with what is most fitting for you and most useful for your return to Allah.',
    src: 'الفوائد ص٣١ (ط. دار الكتب العلمية)' },
  { by: 'ابن القيم', ar: 'المخلوق إذا خفته استوحشت منه وهربت منه، والرب تعالى إذا خفته أنست به وقربت إليه',
    en: 'When you fear a created being, you feel estranged and run from him; when you fear the Lord, you find closeness to Him and draw near.',
    src: 'الفوائد ص٣١ (ط. دار الكتب العلمية)' },
  { by: 'ابن القيم', ar: 'لو نفع العلم بلا عمل لما ذمَّ الله سبحانه أحبار أهل الكتاب، ولو نفع العمل بلا إخلاص لما ذمَّ المنافقين',
    en: 'If knowledge without action were of benefit, Allah would not have blamed the rabbis of the People of the Book; and if action without sincerity were of benefit, He would not have blamed the hypocrites.',
    src: 'الفوائد ص٣١ (ط. دار الكتب العلمية)' },
  { by: 'ابن القيم', ar: 'الدنيا من أولها إلى آخرها لا تساوي غمَّ ساعة، فكيف بغمِّ العمر',
    en: 'This whole world, from its beginning to its end, is not worth one hour of grief; so how about a lifetime of it?',
    src: 'الفوائد ص٤٤ (ط. عطاءات العلم)' },
  { by: 'ابن القيم', ar: 'دافِعِ الخطرة، فإن لم تفعل صارت فكرة، فدافع الفكرة، فإن لم تفعل صارت شهوة، فحاربها، فإن لم تفعل صارت عزيمة وهمَّة، فإن لم تدافعها صارت فعلًا، فإن لم تتداركه بضدِّه صار عادة',
    en: 'Push away the passing thought, or it becomes a thought you hold; push that away, or it becomes a desire; fight it, or it becomes resolve; resist it, or it becomes an act; and if you do not undo it with its opposite, it becomes a habit.',
    src: 'الفوائد ص٣١ (ط. دار الكتب العلمية)' },
  { by: 'ابن القيم', ar: 'فلا شيءَ أضرُّ على العارف بالله من إضاعة وقته مع الله',
    en: 'Nothing harms the one who knows Allah more than wasting his time with Allah.',
    src: 'مدارج السالكين ١/٤١٦ (ط. عطاءات العلم)' },
  { by: 'ابن القيم', ar: 'وأيّ حياة أطيب من حياة مَن اجتمعت همومه كلّها وصارت همًّا واحدًا في مرضاة الله',
    en: 'What life is sweeter than the life of one whose concerns have all gathered into a single concern: pleasing Allah?',
    src: 'الداء والدواء ص٤٣٠ (ط. عطاءات العلم)' },
  { by: 'ابن رجب', ar: 'مَن عمِل طاعةً من الطاعات وفرغَ منها، فعلامةُ قَبولها أن يصلَها بطاعةٍ أخرى، وعلامةُ رَدِّها أن يعقِبَ تلك الطاعة بمعصيةٍ',
    en: 'Whoever does an act of obedience and finishes it: a sign it was accepted is that he follows it with another; a sign it was rejected is that he follows it with a sin.',
    src: 'لطائف المعارف ص٣٩٩ (ت. السواس)' },
  { by: 'ابن رجب', ar: 'ما أحسَنَ الحسنةَ بعدَ السيئة تمحوها، وأحسَنُ منها الحسنةُ بعدَ الحسنة تتلوها',
    en: 'How beautiful is a good deed after a bad one, wiping it out; and more beautiful still is a good deed following a good deed.',
    src: 'لطائف المعارف ص٣٩٩ (ت. السواس)' },
  { by: 'ابن رجب', ar: 'كلّ وقت يخليه العبد من طاعة مولاه فقد خسره',
    en: 'Every moment the servant leaves empty of obeying his Master is a moment he has lost.',
    src: 'لطائف المعارف ص٣٩٣ (ت. عوض الله)' },
  { by: 'ابن رجب', ar: 'سلوا الله الثباتَ على الطاعات إلى الممات، وتعوَّذوا به من تقلُّب القلوب',
    en: 'Ask Allah for steadfastness in obedience until death, and seek His refuge from the turning of hearts.',
    src: 'لطائف المعارف ص٣٩٩ (ت. السواس)' },
  { by: 'ابن رجب', ar: 'وأنَّ خاتمة السُّوءِ تكونُ بسبب دسيسةٍ باطنة للعبد لا يطلع عليها النَّاس',
    en: 'A bad ending comes from a hidden flaw within the servant that people do not see.',
    src: 'جامع العلوم والحكم ١/١٧٢ (ت. الأرنؤوط)' },
];

let quran = null;
async function loadQuran() { if (!quran) quran = await (await fetch('data/quran.json')).json(); return quran; }
const dayNo = () => Math.floor((Date.now() + 3 * 3600e3) / 864e5);
let offset = 0;
async function meaning(s, a) {
  const k = `qen:${s}:${a}`, have = store.get(k);
  if (have) return have;
  try {
    const j = await (await fetch(`https://quranenc.com/api/v1/translation/aya/english_saheeh/${s}/${a}?without_footnotes_symbols=1`)).json();
    const t = (j.result?.translation || '').replace(/\s*\[\d+\]/g, '').trim();
    if (t) store.set(k, t);
    return t;
  } catch { return ''; }
}
const AR = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
async function render() {
  const box = $('#hm-remind'); if (!box) return;
  if (store.get('showReminder', true) === false) { box.hidden = true; return; }
  box.hidden = false;
  const q = await loadQuran().catch(() => null); if (!q) { box.hidden = true; return; }
  const n = dayNo() + offset, [s, a] = VERSES[((n % VERSES.length) + VERSES.length) % VERSES.length];
  const say = SAYINGS[((n % SAYINGS.length) + SAYINGS.length) % SAYINGS.length];
  const verse = q[s - 1][1][a - 1], sura = q[s - 1][0];
  box.innerHTML = `<div class="row-between"><div class="card-h" style="margin:0">Daily reminder</div>
      <span class="row-gap" style="margin:0"><button type="button" class="ghost small" id="rm-next">Another</button><button type="button" class="ghost small" id="rm-studio">Use in Studio</button></span></div>
    <div class="rm-verse" dir="rtl" lang="ar">﴿${esc(verse)}﴾</div>
    <div class="rm-ref">[${esc(sura)}: ${AR(a)}] · ${s}:${a}</div>
    <div class="rm-en" id="rm-en"></div>
    <div class="rm-say" dir="rtl" lang="ar">${esc(say.ar)}</div>
    <div class="rm-en">${esc(say.en)}</div>
    <div class="rm-ref" dir="rtl">— ${esc(say.by)}، ${esc(say.src)}</div>`;
  meaning(s, a).then(t => { const el = $('#rm-en'); if (el && t) el.innerHTML = `“${esc(t)}” <small>(Saheeh International)</small>`; });
  $('#rm-next').onclick = () => { offset++; render(); };
  $('#rm-studio').onclick = () => {
    J.show('studio');
    setTimeout(() => window.JundStudio?.addText?.(`﴿${verse}﴾\n[${sura}: ${AR(a)}]`), 300);
  };
}
// Settings switch
const sw = $('#show-reminder');
if (sw) { sw.checked = store.get('showReminder', true) !== false; sw.onchange = () => { store.set('showReminder', sw.checked); render(); }; }
window.JundReminder = { render };
})();
