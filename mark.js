/* Mustatar — the living mark: the letter mīm (م), the first letter of مستطر, drawn in one line, with a small ink dot.
   Calm when idle (it writes itself once); while the app is working, the pen keeps writing it. */
(() => {
'use strict';
function mark(size = 32, busy = false) {
  return `<svg class="mk${busy ? ' busy' : ''}" width="${size}" height="${size}" viewBox="0 0 512 512" aria-hidden="true">
    <g transform="translate(6 -38)"><path class="mk-p" pathLength="100" d="M380 300 H 330 C 290 300 268 276 268 246 C 268 214 292 192 322 192 C 352 192 374 214 374 246 C 374 276 352 300 322 300 H 150 C 128 300 118 318 120 344 L 126 392" fill="none" stroke-width="36" stroke-linecap="round" stroke-linejoin="round"/>
    <circle class="mk-d" cx="426" cy="300" r="20"/></g></svg>`;
}
window.MustatarMark = mark;
})();
