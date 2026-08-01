// Runs before paint, before React hydrates: sets the `dark` class from
// localStorage (falling back to OS preference) so there's no flash of the
// wrong theme on load. A same-origin file rather than an inline <script> so
// the app's Content-Security-Policy can ship script-src 'self' with no
// unsafe-inline exception — see app/layout.tsx and next.config.mjs.
(function () {
  var stored = localStorage.getItem("theme");
  var dark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", dark);
})();
