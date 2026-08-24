// PROTOCOL.md §7.8 step 4's landing page, and everything it does.
//
// ⚠️ THIS WAS AN INLINE `<script type="module">`, WHICH `ARCHITECTURE.md` §6's
// `script-src 'self'` blocks outright — measured, not assumed: under §6's real
// header block this page rendered two EMPTY panels, because the one script that
// fills them never ran. The page whose whole job is to say what happened would
// have said nothing, on the deployment that finally applied the headers.
//
// ⭐ Unlike the stylesheet next door, this move costs nothing to weigh: the page
// already imported `ui/copy.js`, so the script path already had a subresource
// that fails the same way, at the same time, from the same origin.
//
// Everything in the comment above the <body> still holds — this page opens no
// database, derives no key, holds no session and makes no request.

import * as copy from "/src/ui/copy.js";
import * as langs from "/src/ui/lang.js";
import { setLanguage } from "/src/ui/copy-language.js";

/**
 * D-159 — this page speaks the same language as the one the person just left.
 *
 * ⚠️⚠️ IT IS EASY TO LEAVE THIS PAGE OUT AND IMPOSSIBLE TO NOTICE, which is why it is
 * the first thing in the file. Nothing links here from anywhere a reviewer looks:
 * §7.8's ending replaces the document, so the only way to see it is to end a session
 * and mean it. A Finn who does that would have read the whole product in Finnish and
 * then been told in English what had just happened to their conversations.
 *
 * ⭐ NO BOOT SCRIPT HERE, UNLIKE `index.html`, AND THE DIFFERENCE IS REAL RATHER THAN
 * AN OMISSION. `app/lang-boot.js` is render-blocking because `app.css` hides the
 * masthead gloss on `html[lang="fi"]` and that decision has to be made before the
 * first paint. This page has no gloss and no static sentence at all — both panels are
 * EMPTY until the three lines below fill them — so there is nothing that could flash,
 * and a deferred module is early enough. `<html lang>` is set here for the screen
 * reader, which is the only thing that was still reading it.
 *
 * ⚠️ `resolve()` READS STORAGE THAT MAY HAVE JUST BEEN TAKEN AWAY. The thorough ending
 * serves this page with `Clear-Site-Data`, and `lang.js` deliberately erases the
 * language mark there too — so this falls through to the browser's own list, which is
 * the right answer: after that ending there is no record that this person was ever here.
 */
const speaking = langs.resolve();
setLanguage(speaking);
langs.apply(speaking);

// ⚠️⚠️ THE TAB'S TITLE IS COPY TOO, AND IT WAS THE HALF NOBODY CHECKED. D-159
// translated both panels on this page and left `<title>haamu — ended</title>`
// standing in the HTML, so a Finn who ended a session read the page in Finnish
// under an English tab. `copy.product.endedTitle` had existed in both languages
// the whole time — DEFINED, and read by nothing. The copy suites passed because
// being defined was all they asked. Found by the 2026-08-24 outside review.
document.title = copy.product.endedTitle;

// ⚠️ TWO THINGS ARRIVE IN THE FRAGMENT, NOT ONE. The census outcome decides the
// first sentence (§7.8.1's two endings) and the MODE decides the second — which
// until 0.8.14 was always the Kept one, *"you will need your eight words"*, on
// a page a Ghost session also lands on. There are no words there and nothing to
// reopen, so that sentence was the product's reassurance printed for the one
// ending it cannot be true of.
const [state, mode] = location.hash.slice(1).split("-");
document.getElementById("what").textContent =
  state === "confirmed" ? copy.tabs.endConfirmed : copy.tabs.endUnconfirmed;
document.getElementById("more").textContent =
  mode === "ghost" ? copy.ghost.endedNothingToReopen : copy.ending.needsPhrase;

// D-083: the link said "Open lpm again", which is the protocol token used as the
// product's name — the one thing D-001 forbids, on the page a person reads last.
document.getElementById("again").textContent = copy.ending.openAgain;

// §2.1's habit, applied here too: nothing is gained by leaving it in the
// address bar, and a reload should not re-assert a claim this page no longer
// has any way to check.
history.replaceState(null, "", location.pathname);
