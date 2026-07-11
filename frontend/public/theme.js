// Apply the saved (or OS-preferred) theme before React mounts, so there is
// no flash and the `dark` class is the single source of truth the app reads.
//
// Served same-origin from /theme.js and loaded as a render-blocking classic
// script in index.html's <head> — so it runs before first paint (no flash)
// and is permitted by the CSP `script-src 'self'` without any inline hash.
// Do NOT add defer/async/type="module" to its <script> tag: that would defer
// execution past paint and reintroduce the theme flash.
(function () {
  try {
    var saved = localStorage.getItem('theme');
    var dark = saved ? saved === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {}
})();
