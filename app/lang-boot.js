/* D-154. Decide the interface language BEFORE the first paint.
 *
 * ⚠️⚠️ THIS FILE EXISTS FOR THE SAME REASON `app/theme-boot.js` DOES, and the same
 * three constraints force it into the same shape: `ARCHITECTURE.md` §6 sets
 * `script-src 'self'`, `TestShippedHTMLSatisfiesItsOwnCSP` in
 * `server/internal/api/client_test.go` fails the build on any `<script>` without a
 * `src`, and `type="module"` is deferred by definition — so it is an external
 * CLASSIC script, and it must not import.
 *
 * ⭐ BUT THE FLASH IT PREVENTS IS A DIFFERENT ONE, AND SMALLER THAN THE THEME'S,
 * so it is worth saying exactly what it is rather than assuming this file earns
 * its render-blocking cost by analogy. D-083's copy gate means `app/index.html`
 * contains **eleven words of English in total** — everything else a person reads
 * is written in by `app/app.js` at runtime, and a deferred script can fill an
 * empty page with no flash at all. One of those eleven words is the masthead
 * gloss, **haamu is Finnish for ghost**, which Hannu ruled out of the Finnish
 * version entirely: it exists to explain the name to somebody who does not speak
 * the language. `app.css` drops it on `html[lang="fi"]`. Without this file the
 * gloss paints in English and then vanishes — a flash of precisely the sentence
 * that was ruled not to appear.
 *
 * ⚠️ The second reason is not visual at all. `<html lang>` is what a screen reader
 * picks its voice from and what a browser reads before deciding whether to offer
 * to translate the page, and both of those are consulted early.
 *
 * ⚠️⚠️ IT MUST STAY TINY. It is render-blocking: every millisecond here is a
 * millisecond of white screen for everybody, including the people who only ever
 * read English. Everything else about the language — the switch, the writing,
 * §7.8's forgetting — is in `src/ui/lang.js`, which is a module and loads
 * normally.
 *
 * ⚠️⚠️ AND WHAT IS DUPLICATED HERE IS BIGGER THAN THE THEME'S DUPLICATION. That
 * one is a single string, and `test/theme.mjs` compares two literals. This one is
 * a DECISION with four inputs in a deliberate order, and two implementations of a
 * decision can agree on every literal and still disagree on an answer. So
 * `test/lang.mjs` does not compare text: it runs this file and `src/ui/lang.js`
 * against the same 576 situations and fails if they ever conclude differently.
 */
(function () {
  var LANG_KEY = "haamu.lang";
  var FI = "fi";
  var lang = null;

  // 1. The address. `/fi` is the plain thing Hannu can paste into a message so
  //    that a Finn holding a phone set to English still lands in Finnish — the
  //    case sniffing the browser cannot serve, because there the browser is the
  //    thing that is wrong about the reader. Both spellings: `server/internal/
  //    api/client.go` answers `/fi` and `/fi/` with this same page.
  var path = location.pathname;
  if (path === "/" + FI || path === "/" + FI + "/") lang = FI;

  // 2. A choice the person made and had remembered.
  if (!lang) {
    try {
      var stored = localStorage.getItem(LANG_KEY);
      if (stored === "en" || stored === FI) lang = stored;
    } catch (e) {
      // Storage can be unavailable outright — a browser with cookies and site
      // data blocked throws on `getItem` rather than returning null. Fall through
      // to the browser's own list, which is where somebody who has never chosen
      // ends up anyway.
    }
  }

  // 3. The browser's own list, any position in it. A Finn whose phone is set to
  //    English but who kept Finnish second is exactly the reader this is for.
  //
  //    ⚠️⚠️ `fi` EXACTLY, OR A TAG BEGINNING `fi-`. NOT a prefix test, which is
  //    the obvious line to write and is wrong: **`fil` is Filipino**, some 45
  //    million speakers, no relation. BCP 47 delimits subtags with `-`, so the
  //    delimiter is what has to be tested for.
  if (!lang) {
    var tags = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
    for (var i = 0; i < tags.length; i++) {
      var t = String(tags[i] || "").toLowerCase();
      if (t === FI || t.indexOf(FI + "-") === 0) {
        lang = FI;
        break;
      }
    }
  }

  // 4. English, which is the language the product is written in.
  document.documentElement.setAttribute("lang", lang || "en");
})();
