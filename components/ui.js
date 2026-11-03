/* ui.js — classic script. Load in <head> WITHOUT defer so the theme is set before first paint.
   - Theme: follows system on first visit, toggled by [data-theme-toggle], persisted in localStorage.
   - Modal: [data-modal-open="dialogId"] / [data-modal-close]
   Works on file:// — no server needed. */
(function () {
  var KEY = "proto.theme";
  var root = document.documentElement;
  function read() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function write(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  var system = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  root.dataset.theme = read() || system;

  window.UI = {
    toggleTheme: function () {
      var next = root.dataset.theme === "dark" ? "light" : "dark";
      root.dataset.theme = next; write(next);
    }
  };

  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-theme-toggle], [data-modal-open], [data-modal-close]");
    if (!t) return;
    if (t.hasAttribute("data-theme-toggle")) UI.toggleTheme();
    else if (t.hasAttribute("data-modal-open")) document.getElementById(t.getAttribute("data-modal-open")).showModal();
    else t.closest("dialog").close();
  });
})();
