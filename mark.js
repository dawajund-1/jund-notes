/* Mustatar — the living mark: three lines being written, a small dot and a big dot ("every small and big thing, written").
   Calm when idle; while the app is working (thinking, writing notes, reading a file) the lines write themselves again and again. */
(() => {
'use strict';
let n = 0;
function mark(size = 32, busy = false) {
  const id = 'mk' + (++n);
  return `<svg class="mk${busy ? ' busy' : ''}" width="${size}" height="${size}" viewBox="0 0 512 512" aria-hidden="true">
    <defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="100" y1="0" x2="420" y2="0"><stop offset="0" stop-color="var(--mk-a)"/><stop offset="1" stop-color="var(--mk-b)"/></linearGradient></defs>
    <g fill="none" stroke="url(#${id})" stroke-linecap="round" stroke-width="40">
      <path class="mk-l mk-1" d="M380 170H150"/><path class="mk-l mk-2" d="M380 256H210"/><path class="mk-l mk-3" d="M380 342H270"/></g>
    <circle class="mk-d mk-s" cx="150" cy="256" r="18"/><circle class="mk-d mk-b" cx="196" cy="342" r="30"/></svg>`;
}
window.MustatarMark = mark;
})();
