/* Mustatar — 📎 attach a file in the message boxes.
   Home: send the file with a question (the assistant reads it — e.g. "add the dates in this timetable to my calendar"),
         or tap "Make notes" to turn it into notes.
   Notes chat: the file is read and its content is used for the change you ask for (e.g. "add what is in this photo of the board"). */
(() => {
'use strict';
const J = window.JN; if (!J) return;
const AR = window.ZadLang === 'ar';
const L = (en, ar) => AR ? ar : en;
const $ = s => document.querySelector(s);
const MAX = 15 * 1024 * 1024;
const ACCEPT = 'image/*,application/pdf,.pdf,audio/*,video/*,.txt,text/plain,.m4a,.mp3,.aac,.wav,.ogg,.opus,.mp4,.mov,.webm';
const CLIP = '<svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true"><path d="M20.5 11.5 12 20a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.7a1.7 1.7 0 0 1-2.4-2.4L15 7.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const b64 = buf => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const mimeOf = f => f.type || (/\.pdf$/i.test(f.name) ? 'application/pdf' : /\.txt$/i.test(f.name) ? 'text/plain' : /\.(m4a|aac)$/i.test(f.name) ? 'audio/mp4' : /\.mp3$/i.test(f.name) ? 'audio/mpeg' : /\.(wav)$/i.test(f.name) ? 'audio/wav' : /\.(ogg|opus)$/i.test(f.name) ? 'audio/ogg' : 'application/octet-stream');
const icon = m => m.startsWith('image/') ? '🖼' : m === 'application/pdf' ? '📄' : m.startsWith('audio/') ? '🎧' : m.startsWith('video/') ? '🎬' : '📃';

// one call: the file + instructions → the answer (streamed)
async function askFile(file, { system, user, json = false, maxTokens = 8000, onText, signal }) {
  let f = file; const mime = mimeOf(file);
  if (mime.startsWith('image/') && file.size > 1.5e6 && window.JN.shrinkImage) { try { f = await window.JN.shrinkImage(file); } catch {} }
  if (f.size > MAX) throw Object.assign(new Error(L('This file is too big to ask about (over 15 MB). Use “Make notes” instead — it handles big files.', 'الملف كبير جدًا للسؤال عنه (أكثر من ١٥ م.ب). استخدم «اصنع ملاحظات» — فهو يتعامل مع الملفات الكبيرة.')), { code: 'toolong' });
  const res = await J.serverFetch('/ask-file', { method: 'POST', signal, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file: b64(await f.arrayBuffer()), mime: f.type || mime, name: file.name, system, user, json, maxTokens }) });
  return J.readStream(res, onText);
}

/* where the file comes from: the phone's gallery, Files / Google Drive, or the camera.
   (One mixed "accept" list makes Android show only Camera / Camcorder / Files, so each choice asks for its own kind.) */
const OK = /^(image|audio|video)\/|^application\/pdf$|^text\/plain$/;
const okFile = f => OK.test(mimeOf(f)) || /\.(pdf|txt|m4a|mp3|aac|wav|ogg|opus|flac|mp4|mov|3gp|webm|heic|heif)$/i.test(f.name);
function chooseFrom(onFiles, multiple) {
  document.querySelector('.pick-sheet')?.remove();
  const sh = document.createElement('div'); sh.className = 'pick-sheet'; sh.setAttribute('data-noi18n', '');
  sh.innerHTML = `<div class="pick-panel" role="dialog" aria-label="${L('Add a file', 'أضف ملفًا')}">
      <div class="pick-h">${L('Add from', 'أضف من')}</div>
      <button type="button" data-src="gallery"><span>🖼</span><b>${L('Gallery', 'المعرض')}</b><small>${L('Photos and videos', 'الصور والفيديو')}</small></button>
      <button type="button" data-src="files"><span>📁</span><b>${L('Files & Google Drive', 'الملفات و Google Drive')}</b><small>${L('Recordings, PDFs, Drive, downloads', 'التسجيلات وPDF وDrive والتنزيلات')}</small></button>
      <button type="button" data-src="camera"><span>📷</span><b>${L('Camera', 'الكاميرا')}</b><small>${L('Take a photo of a page or the board', 'صوّر صفحة أو السبورة')}</small></button>
      <button type="button" class="pick-x">${L('Cancel', 'إلغاء')}</button></div>`;
  document.body.appendChild(sh);
  const close = () => sh.remove();
  sh.onclick = e => { if (e.target === sh) close(); };
  sh.querySelector('.pick-x').onclick = close;
  sh.querySelectorAll('[data-src]').forEach(b => b.onclick = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.hidden = true; inp.multiple = !!multiple;
    if (b.dataset.src === 'gallery') inp.accept = 'image/*,video/*';
    else if (b.dataset.src === 'camera') { inp.accept = 'image/*'; inp.setAttribute('capture', 'environment'); }
    // Files & Drive: no filter, so Android opens its full file picker (Drive, Downloads, recordings…)
    document.body.appendChild(inp);
    inp.onchange = () => {
      const all = Array.from(inp.files || []); inp.remove();
      const good = all.filter(okFile);
      if (all.length && !good.length) { window.JundCal?.toast(L('This kind of file can’t be read. Choose audio, video, a photo, a PDF or a text file.', 'لا يمكن قراءة هذا النوع. اختر صوتًا أو فيديو أو صورة أو PDF أو ملفًا نصيًا.')); return; }
      if (good.length) onFiles(good);
    };
    close(); inp.click();
  });
}
window.JundPick = chooseFrom;
function picker(onPick) { chooseFrom(fs => onPick(fs[0]), false); }
// the big "Choose files" button on New notes uses the same choice
const big = document.querySelector('.big-pick');
if (big) big.addEventListener('click', e => { e.preventDefault(); chooseFrom(fs => J.addFiles(fs), true); }, true);
function chip(where, file, extra) {
  where.innerHTML = `<div class="att-prev"></div><span class="att-chip" dir="auto">${icon(mimeOf(file))} ${J.esc(file.name)} <small>${(file.size / 1048576).toFixed(1)} MB</small><button type="button" class="att-x" aria-label="${L('Remove', 'إزالة')}">✕</button></span>${extra || ''}`;
  where.hidden = false;
  window.JundThumbs?.strip(where.querySelector('.att-prev'), file, 4);
}

/* ---------- Home message box ---------- */
let homeFile = null;
function homeSetup() {
  const box = $('.as-input'); if (!box || $('#as-att')) return;
  const b = document.createElement('button'); b.type = 'button'; b.className = 'tool-btn'; b.id = 'as-att'; b.innerHTML = CLIP; b.setAttribute('aria-label', L('Attach a file', 'أرفق ملفًا'));
  const tools = box.querySelector('.as-tools'); tools ? tools.prepend(b) : box.insertBefore(b, $('#as-text'));
  const bar = document.createElement('div'); bar.className = 'att-bar'; bar.id = 'as-attbar'; bar.hidden = true; bar.setAttribute('data-noi18n', '');
  box.before(bar);
  b.onclick = () => picker(f => {
    homeFile = f;
    chip(bar, f, `<button type="button" class="ghost small" id="as-att-notes">📝 ${L('Make notes from it', 'اصنع منه ملاحظات')}</button><div class="muted att-tip">${L('Or write a question about it and tap Send.', 'أو اكتب سؤالًا عنه واضغط إرسال.')}</div>`);
    bar.querySelector('.att-x').onclick = clearHome;
    $('#as-att-notes').onclick = () => { const file = homeFile; clearHome(); J.addFiles([file]); };
    $('#as-text').placeholder = L('Ask about this file…', 'اسأل عن هذا الملف…');
    $('#as-text').focus();
  });
}
function clearHome() { homeFile = null; const bar = $('#as-attbar'); if (bar) { bar.hidden = true; bar.innerHTML = ''; } const t = $('#as-text'); if (t) t.placeholder = L('Message Mustatar…', 'اكتب إلى مستطر…'); }

/* ---------- notes chat ---------- */
let chatFile = null;
function chatSetup() {
  const box = $('.chat-input'); if (!box || $('#chat-att')) return;
  const b = document.createElement('button'); b.type = 'button'; b.className = 'icon-btn'; b.id = 'chat-att'; b.innerHTML = CLIP; b.setAttribute('aria-label', L('Attach a file', 'أرفق ملفًا'));
  box.insertBefore(b, $('#chat-text'));
  const bar = document.createElement('div'); bar.className = 'att-bar'; bar.id = 'chat-attbar'; bar.hidden = true; bar.setAttribute('data-noi18n', '');
  box.before(bar);
  b.onclick = () => picker(f => {
    chatFile = f;
    chip(bar, f, `<div class="muted att-tip">${L('Say what to do with it, e.g. “add what is in this photo to the notes”.', 'قل ماذا أفعل به، مثل: «أضف ما في هذه الصورة إلى الملاحظات».')}</div>`);
    bar.querySelector('.att-x').onclick = clearChat;
    $('#chat-text').focus();
  });
}
function clearChat() { chatFile = null; const bar = $('#chat-attbar'); if (bar) { bar.hidden = true; bar.innerHTML = ''; } }
// read the attached file into text, so the normal "change the notes" step can use it
async function chatExtract(onStatus) {
  if (!chatFile) return '';
  const f = chatFile; clearChat();
  onStatus?.(L('Reading the file…', 'جارٍ قراءة الملف…'));
  const r = await askFile(f, { system: 'You read files for a note-taking app. Output ONLY the full content of the file as plain text, faithfully, in its original language: transcribe speech word for word, read all text in images and PDFs (keep Arabic exactly, with its diacritics), and describe diagrams, tables and drawings briefly in the same language. No comments.', user: 'Give me the full content of this file.', maxTokens: 30000,
    onText: t => onStatus?.(L('Reading the file… ', 'جارٍ قراءة الملف… ') + t.split(/\s+/).length) });
  return `\n\n<<<ملف مرفق (${f.name})\n${r.text.trim()}\nملف مرفق>>>`;
}

window.JundAttach = { askFile, homeFile: () => homeFile, clearHome, chatExtract, chatFileName: () => chatFile?.name || '', homeSetup, chatSetup };
chatSetup();
setTimeout(homeSetup, 0);
})();
