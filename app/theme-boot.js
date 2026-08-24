/* D-139. Apply the stored theme choice BEFORE the first paint.
 *
 * ⚠️⚠️ THIS FILE EXISTS BECAUSE OF A CONSTRAINT, NOT A PREFERENCE, and the shape it
 * is in is the only shape the constraint leaves.
 *
 * The choice lives in `localStorage`, so something has to read it and stamp
 * `data-theme` on the root element. If that happens in `app/app.js` — a module at
 * the end of `<body>`, therefore deferred — the browser has already painted the
 * page in the theme the PHONE asked for, and somebody who chose dark on a light
 * phone watches a white page flash before it goes dark. On every single load.
 *
 * The usual fix is a tiny inline `<script>` in `<head>`. ⚠️ THAT IS FORBIDDEN HERE
 * TWICE OVER: `ARCHITECTURE.md` §6 sets `script-src 'self'`, and
 * `TestShippedHTMLSatisfiesItsOwnCSP` in `server/internal/api/client_test.go` fails
 * the build on any `<script>` without a `src`. So it is an external file — which
 * `script-src 'self'` permits — and a CLASSIC script rather than a module, because
 * `type="module"` is deferred by definition and deferring is the whole problem.
 *
 * ⚠️ IT MUST STAY TINY AND IT MUST NOT IMPORT. It is render-blocking: every
 * millisecond here is a millisecond of white screen for everybody, including the
 * people who never touch the switch. Everything else about the theme — the menu,
 * the writing, §7.8's forgetting — is in `src/ui/theme.js`, which is a module and
 * loads normally.
 *
 * ⚠️⚠️ `THEME_KEY` IS DUPLICATED FROM `src/ui/theme.js` AND CANNOT BE IMPORTED HERE.
 * That is a real cost and it is paid, not ignored: `test/theme.mjs` reads both files
 * and fails if the two literals ever differ. A key that drifts would not throw — it
 * would silently stop finding the preference, which is the failure mode nobody
 * notices because it looks exactly like "I never set one".
 */
(function () {
  var THEME_KEY = "haamu.theme";
  try {
    var choice = localStorage.getItem(THEME_KEY);
    // ⚠️ ANYTHING THAT IS NOT ONE OF THE TWO EXPLICIT CHOICES MEANS "follow the
    // phone", and that includes `null`, `"system"`, and any value a future version
    // wrote that this one does not know. Stamping an unrecognised string onto the
    // root element would match no rule in `app.css` and leave the page unpainted.
    if (choice === "light" || choice === "dark") {
      document.documentElement.setAttribute("data-theme", choice);
    }
  } catch (e) {
    // Storage can be unavailable outright — a browser with cookies and site data
    // blocked throws on `getItem` rather than returning null. The theme then
    // follows the phone, which is exactly what it did before this feature existed.
  }
})();
