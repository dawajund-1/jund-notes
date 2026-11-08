/* Mustatar — the daily reminder: a verse of the Quran (exact Mushaf text from the app's own copy, with the
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

// on thankfulness and the blessings people stop seeing (exact text from the app's Mushaf; [sura, aya, fromWord, toWord] shows only that part up front)
const SHUKR = [[14,7],[14,34],[16,18],[34,13,11,18],[7,10,8,10],[100,6],[16,53],[31,20,12,16],[27,40,19,26],[27,19,5,13],[102,8],[39,66],[4,147],[76,3],[16,114],[2,152],[55,13],[93,11],[16,78,8,14],[67,23]];
// hadith and words of the salaf, each with where it is found
const HADITH = [
  { ar: 'انْظُرُوا إِلَى مَنْ أَسْفَلَ مِنْكُمْ، وَلَا تَنْظُرُوا إِلَى مَنْ هُوَ فَوْقَكُمْ، فَهُوَ أَجْدَرُ أَنْ لَا تَزْدَرُوا نِعْمَةَ اللهِ',
    en: 'Look at those below you, not at those above you; that is more likely to keep you from belittling Allah’s blessings on you.', by: 'النبي ﷺ', src: 'صحيح مسلم ٢٩٦٣' },
  { ar: 'نِعْمَتَانِ مَغْبُونٌ فِيهِمَا كَثِيرٌ مِنَ النَّاسِ: الصِّحَّةُ وَالفَرَاغُ',
    en: 'Two blessings many people lose out on: health and free time.', by: 'النبي ﷺ', src: 'صحيح البخاري ٦٤١٢' },
  { ar: 'عَجَبًا لِأَمْرِ الْمُؤْمِنِ، إِنَّ أَمْرَهُ كُلَّهُ خَيْرٌ، وَلَيْسَ ذَاكَ لِأَحَدٍ إِلَّا لِلْمُؤْمِنِ، إِنْ أَصَابَتْهُ سَرَّاءُ شَكَرَ، فَكَانَ خَيْرًا لَهُ، وَإِنْ أَصَابَتْهُ ضَرَّاءُ صَبَرَ، فَكَانَ خَيْرًا لَهُ',
    en: 'How wonderful the believer’s affair is — all of it is good: if good comes to him he is thankful, and if harm comes to him he is patient, and both are good for him.', by: 'النبي ﷺ', src: 'صحيح مسلم ٢٩٩٩' },
  { ar: 'مَنْ أَصْبَحَ مِنْكُمْ آمِنًا فِي سِرْبِهِ، مُعَافًى فِي جَسَدِهِ، عِنْدَهُ قُوتُ يَوْمِهِ، فَكَأَنَّمَا حِيزَتْ لَهُ الدُّنْيَا',
    en: 'Whoever wakes up safe among his people, healthy in his body, with food for the day, it is as if the whole world were given to him.', by: 'النبي ﷺ', src: 'سنن الترمذي ٢٣٤٦' },
  { ar: 'أَفَلَا أَكُونُ عَبْدًا شَكُورًا',
    en: 'Should I not be a thankful servant? — said when asked why he prayed until his feet swelled.', by: 'النبي ﷺ', src: 'صحيح البخاري ٤٨٣٧، صحيح مسلم ٢٨٢٠' },
  { ar: 'اللَّهُمَّ أَعِنِّي عَلَى ذِكْرِكَ، وَشُكْرِكَ، وَحُسْنِ عِبَادَتِكَ',
    en: 'O Allah, help me to remember You, thank You, and worship You well — he told Muʿādh not to leave it after any prayer.', by: 'النبي ﷺ', src: 'سنن أبي داود ١٥٢٢' },
  { ar: 'إِنَّ اللهَ لَيَرْضَى عَنِ الْعَبْدِ أَنْ يَأْكُلَ الْأَكْلَةَ فَيَحْمَدَهُ عَلَيْهَا، أَوْ يَشْرَبَ الشَّرْبَةَ فَيَحْمَدَهُ عَلَيْهَا',
    en: 'Allah is pleased with a servant who eats a meal and praises Him for it, or drinks a drink and praises Him for it.', by: 'النبي ﷺ', src: 'صحيح مسلم ٢٧٣٤' },
  { ar: 'لَا يَشْكُرُ اللَّهَ مَنْ لَا يَشْكُرُ النَّاسَ',
    en: 'Whoever does not thank people does not thank Allah.', by: 'النبي ﷺ', src: 'سنن أبي داود ٤٨١١' },
  { ar: 'إِذَا أَخْلَصَ الْعَبْدُ انْقَطَعَ عَنْهُ كَثْرَةُ الْوَسْوَاسِ وَالرِّيَاءِ',
    en: 'When the servant becomes sincere, the many whisperings and the showing-off leave him.', by: 'أبو سليمان الداراني', src: 'البداية والنهاية ١٤/١٥٠ (ت. التركي)' },
  { ar: 'احْفَظِ اللَّهَ يَحْفَظْكَ، احْفَظِ اللَّهَ تَجِدْهُ تُجَاهَكَ',
    en: 'Be mindful of Allah and He will protect you; be mindful of Allah and you will find Him before you.', by: 'النبي ﷺ', src: 'سنن الترمذي ٢٥١٦' },
  { ar: 'أَحَبُّ الْأَعْمَالِ إِلَى اللهِ تَعَالَى أَدْوَمُهَا، وَإِنْ قَلَّ',
    en: 'The deeds most loved by Allah are the most constant, even if small.', by: 'النبي ﷺ', src: 'صحيح مسلم ٧٨٣' },
  { ar: 'يَقُولُ اللَّهُ تَعَالَى: أَنَا عِنْدَ ظَنِّ عَبْدِي بِي، وَأَنَا مَعَهُ إِذَا ذَكَرَنِي',
    en: 'Allah says: I am as My servant thinks of Me, and I am with him when he remembers Me.', by: 'النبي ﷺ', src: 'صحيح البخاري ٧٤٠٥' },
  { ar: 'اتَّقِ اللَّهِ حَيْثُمَا كُنْتَ، وَأَتْبِعِ السَّيِّئَةَ الحَسَنَةَ تَمْحُهَا، وَخَالِقِ النَّاسَ بِخُلُقٍ حَسَنٍ',
    en: 'Fear Allah wherever you are, follow a bad deed with a good one to wipe it out, and treat people with good character.', by: 'النبي ﷺ', src: 'سنن الترمذي ١٩٨٧' },
  { ar: 'مَثَلُ الَّذِي يَذْكُرُ رَبَّهُ وَالَّذِي لَا يَذْكُرُ رَبَّهُ، مَثَلُ الحَيِّ وَالمَيِّتِ',
    en: 'The one who remembers his Lord and the one who does not are like the living and the dead.', by: 'النبي ﷺ', src: 'صحيح البخاري ٦٤٠٧' },
  { ar: 'كُنْ فِي الدُّنْيَا كَأَنَّكَ غَرِيبٌ أَوْ عَابِرُ سَبِيلٍ',
    en: 'Be in this world as if you were a stranger or a traveller passing through.', by: 'النبي ﷺ', src: 'صحيح البخاري ٦٤١٦' },
  { ar: 'إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ',
    en: 'Actions are only by intentions.', by: 'النبي ﷺ', src: 'صحيح البخاري ١' },
];

let quran = null;
async function loadQuran() { if (!quran) quran = await (await fetch('data/quran.json')).json(); return quran; }
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
const mine = () => store.get('myWisdom', []);
// one item: { short, full, en?, by, src, verse? }
function verseItem(q, [s, a, w0, w1]) {
  const full = q[s - 1][1][a - 1], words = full.split(' ');
  const part = w0 != null ? words.slice(w0, w1 + 1).join(' ') : full;
  return { short: (w0 > 0 ? '… ' : '') + part + (w1 != null && w1 < words.length - 1 ? ' …' : ''), full, by: '', src: `${q[s - 1][0]} ${AR(a)}`, verse: [s, a] };
}
// the order: your own, thankfulness, hadith, a verse, a word of the scholars — then round again
function pick(q, k) {
  const groups = [mine().map(m => ({ short: m.text, full: m.text, en: m.en || '', by: '', src: m.src || '', own: m.id })),
    SHUKR.map(v => verseItem(q, v)),
    HADITH.map(h => ({ short: h.ar, full: h.ar, en: h.en, by: h.by, src: h.src })),
    VERSES.map(v => verseItem(q, v)),
    SAYINGS.map(x => ({ short: x.ar, full: x.ar, en: x.en, by: x.by, src: x.src }))].filter(g => g.length);
  const g = groups[k % groups.length], round = Math.floor(k / groups.length);
  return g[round % g.length];
}
// a new one every time the app opens
let pos = store.get('wisIdx', 0) + 1; store.set('wisIdx', pos);
const box = () => $('#hm-remind');
async function render() {
  const el = box(); if (!el) return;
  if (store.get('showReminder', true) === false) { el.hidden = true; return; }
  const q = await loadQuran().catch(() => null); if (!q) { el.hidden = true; return; }
  el.hidden = false;
  const it = pick(q, pos), open = el.dataset.open === '1';
  const quote = t => it.verse ? `﴿${esc(t)}﴾` : esc(t);
  el.innerHTML = `<button type="button" class="rm-tap" id="rm-tap" aria-expanded="${open}">
      <div class="rm-verse" dir="rtl" lang="ar">${quote(open ? it.full : it.short)}</div>
      <div class="rm-ref" dir="rtl">${esc(it.by ? it.by + ' · ' : '')}${esc(it.src)}</div></button>
    <div class="rm-more" ${open ? '' : 'hidden'}>
      ${it.verse ? '<div class="rm-en" id="rm-en"></div>' : it.en ? `<div class="rm-en">${esc(it.en)}</div>` : ''}
      <div class="row-gap rm-acts"><button type="button" class="ghost small" id="rm-next">Another</button><button type="button" class="ghost small" id="rm-add">＋ Add your own</button><button type="button" class="ghost small" id="rm-share">Share</button><button type="button" class="ghost small" id="rm-studio">Use in Studio</button>${it.own ? '<button type="button" class="link small" id="rm-del">Remove</button>' : ''}</div>
      <div class="row-gap rm-acts" id="rm-sh" hidden><button type="button" class="ghost small" data-sh="1">With harakat</button><button type="button" class="ghost small" data-sh="0">Without harakat</button></div>
      <form class="rm-form" id="rm-form" hidden>
        <textarea id="rm-text" dir="auto" rows="3" placeholder="A verse, hadith or wise word you want to see…"></textarea>
        <textarea id="rm-en-in" dir="ltr" rows="2" placeholder="English translation — optional"></textarea>
        <button type="button" class="link small" id="rm-tr" style="justify-self:start">🌐 Translate it for me</button>
        <input id="rm-src" dir="auto" placeholder="Where it is from (book, page) — optional">
        <div class="row-gap"><button type="submit" class="primary small">Save</button><button type="button" class="ghost small" id="rm-cancel">Cancel</button></div>
      </form>
    </div>`;
  $('#rm-tap').onclick = () => { el.dataset.open = open ? '' : '1'; render(); };
  if (it.verse) meaning(...it.verse).then(t => { const m = $('#rm-en'); if (m && t) m.innerHTML = `“${esc(t)}” <small>(Saheeh International)</small>`; });
  $('#rm-next').onclick = () => { pos++; store.set('wisIdx', pos); render(); };
  $('#rm-share').onclick = () => { $('#rm-sh').hidden = !$('#rm-sh').hidden; };
  el.querySelectorAll('[data-sh]').forEach(b => b.onclick = async () => {
    const strip = window.noHarakat || (t => t), keep = b.dataset.sh === '1';
    const ar = it.verse ? `﴿${keep ? it.full : strip(it.full)}﴾` : (keep ? it.full : strip(it.full));
    const text = [ar, (it.by ? it.by + ' · ' : '') + it.src, it.en || $('#rm-en')?.textContent || ''].filter(Boolean).join('\n\n');
    try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); b.textContent = '✓ Copied'; } }
    catch { try { await navigator.clipboard.writeText(text); b.textContent = '✓ Copied'; } catch {} }
  });
  $('#rm-add').onclick = () => { $('#rm-form').hidden = false; $('#rm-text').focus(); };
  $('#rm-tr').onclick = async () => {
    const text = $('#rm-text').value.trim(), b = $('#rm-tr'); if (!text) { $('#rm-text').focus(); return; }
    b.disabled = true; b.textContent = '⏳ Translating…';
    try {
      const r = await J.callServer({ json: false, maxTokens: 800, system: 'Translate this Islamic text (Quran, hadith or words of the scholars) into clear English. Give the meaning faithfully and add nothing. Return only the translation.', user: text });
      $('#rm-en-in').value = r.text.trim();
    } catch (e) { $('#rm-en-in').placeholder = '✗ ' + J.errText(e); }
    b.disabled = false; b.textContent = '🌐 Translate it for me';
  };
  $('#rm-cancel').onclick = () => { $('#rm-form').hidden = true; };
  $('#rm-form').onsubmit = e => {
    e.preventDefault(); const text = $('#rm-text').value.trim(); if (!text) return;
    const list = mine(); list.push({ id: Date.now().toString(36), text, en: $('#rm-en-in').value.trim(), src: $('#rm-src').value.trim() }); store.set('myWisdom', list);
    pos = Math.ceil(pos / 5) * 5; store.set('wisIdx', pos); // show it straight away
    window.JundCal?.widgetSync?.(); render();
  };
  if ($('#rm-del')) $('#rm-del').onclick = () => { store.set('myWisdom', mine().filter(m => m.id !== it.own)); window.JundCal?.widgetSync?.(); render(); };
  $('#rm-studio').onclick = () => {
    J.show('studio');
    setTimeout(() => window.JundStudio?.addText?.(it.verse ? `﴿${it.full}﴾\n[${it.src}]` : `${it.full}\n${it.src}`), 300);
  };
}
// a short list for the home-screen widget, which changes it by itself every few hours
async function forWidget() {
  const q = await loadQuran(); const out = [];
  for (let k = pos; k < pos + 60; k++) { const it = pick(q, k); if (!out.some(o => o.t === it.short)) out.push({ t: (it.verse ? `﴿${it.short}﴾` : it.short).slice(0, 260), s: (it.by ? it.by + ' · ' : '') + it.src }); }
  return out;
}
// Settings switch
const sw = $('#show-reminder');
if (sw) { sw.checked = store.get('showReminder', true) !== false; sw.onchange = () => { store.set('showReminder', sw.checked); render(); }; }
window.JundReminder = { render, forWidget };
})();
