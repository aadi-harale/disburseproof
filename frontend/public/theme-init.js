// Applies the saved (or system) theme before first paint to avoid a light/dark flash.
// A separate file, not an inline <script>, so the Content-Security-Policy can forbid
// inline scripts entirely (script-src 'self').
(function () {
  try {
    var saved = localStorage.getItem("dp-theme");
    var dark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {
    /* storage unavailable: keep the default theme */
  }
})();
