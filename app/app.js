// The interface — ROADMAP step 8. Chat list, chat view, pairing flow, lock screen.
//
// ⚠️ WHAT CHANGED UNDER IT, because it is more than a coat of paint on the demo.
// Step 7 left three things here deliberately and all three are load-bearing:
//
//   • IndexedDB (§4.1's storage table). Until now the Olm session state died with
//     the tab, so a reload cost a session GENERATION — which worked, because §6.3
//     was written for exactly that, and spent something every time. The pickles
//     now live in `storage/vault.js` under `local_key`, so a reload is free and a
//     conversation comes back with its history.
//   • §7.3.1a's 7-day quarantine, which turned out to have a hole in it — see
//     `flow/quarantine.js`. The undo can only ever be local to this device, and
//     this file is where that has to be said out loud to a person.
//   • §7.4's setup flow as a product rather than as a harness: six candidates, a
//     cap that survives a reload, a retype, and a paste that changes what happens
//     next without blocking anything.
//
// Every sentence this file shows a person is in `src/ui/copy.js`, and every number
// in those sentences is interpolated from the constant it describes. That is not
// tidiness: a number typed into prose is a copy of a decision, and nothing in a
// build notices when the decision moves and the prose does not.
//
// Imports are absolute (`/src/...`) because one HTML file answers at both `/` and
// `/c` — §2.1's link is `https://<host>/c#<b64u(L)>` and the fragment never
// reaches the server, so the joiner's page cannot be a different document.

import { createApi } from "/src/net/api.js";
import * as flow from "/src/flow/pair.js";
import * as ghostFlow from "/src/flow/ghost.js";
import * as messageFlow from "/src/flow/message.js";
import * as liveFlow from "/src/flow/live.js";
import * as rosterFlow from "/src/flow/roster.js";
import * as quarantineFlow from "/src/flow/quarantine.js";
import * as olm from "/src/crypto/olm.js";
// ⚠️ A NAMED IMPORT, NOT `* as crypto`. That namespace would shadow the GLOBAL
// `crypto` for this whole module, and `TAB_ID` below is `crypto.randomUUID()`.
// It would have thrown at load rather than gone quiet — but the next name to
// collide might not, and the habit is what matters: before binding a name at
// module scope, ask what else in the file reads it.
import { ensurePrimitives } from "/src/crypto/index.js";
import * as argon2 from "/src/crypto/argon2.js";
import * as passphrase from "/src/protocol/passphrase.js";
import * as rosters from "/src/protocol/roster.js";
import * as pairings from "/src/protocol/pairing.js";
import * as codes from "/src/protocol/code.js";
import * as payloads from "/src/protocol/payload.js";
import * as epochs from "/src/protocol/epoch.js";
import * as store from "/src/storage/sessions.js";
import { b64uDecode } from "/src/crypto/b64u.js";
import * as dbs from "/src/storage/db.js";
import * as vaults from "/src/storage/vault.js";
import * as tabsFlow from "/src/flow/tabs.js";
import * as endings from "/src/flow/ending.js";
import * as lockFlow from "/src/flow/lock.js";
import * as pinFlow from "/src/flow/pin.js";
import { BUILD } from "/app/build.js";
import * as copy from "/src/ui/copy.js";
import * as themes from "/src/ui/theme.js";
import * as langs from "/src/ui/lang.js";
// ⚠️ TWO MODULES, AND THE SPLIT IS THE DESIGN. `ui/lang.js` decides WHICH language
// this document is in — the address, a stored choice, the browser's list. This one
// carries the Finnish and swaps it into `ui/copy.js` in place, which is why 282 call
// sites below never mention a language. Neither knows about the other.
import { setLanguage } from "/src/ui/copy-language.js";
import * as qrs from "/src/ui/qr.js";
import { segments } from "/src/ui/emphasis.js";

const $ = (id) => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle("hidden", !on);
/**
 * ⚠️⚠️ IT CLEARS `refused`, AND THAT IS WHY THE PAIR BELOW IS SAFE (D-179).
 *
 * `#enter-note` carries BOTH a refusal (`describeIdentity`, §7.2's wrong KEY) and
 * ordinary prompts on the same screen (`copy.unlock.ask`, `lockSaid`) — so the paint
 * has to come off again, and putting the removal in the ORDINARY setter means a
 * neutral sentence cannot inherit the previous refusal's alarm by anybody forgetting
 * to take it off at a call site. That is D-104's collision in its state-machine form:
 * two correct writes to one element, and the second one silently wearing the first
 * one's meaning.
 */
const text = (id, s) => {
  const el = $(id);
  el.classList.remove("refused");
  return (el.textContent = s);
};

/**
 * ⛔⛔ A REFUSAL MAY NOT WEAR THE DE-EMPHASIS CLASS, AND FOR ITS WHOLE LIFE IT DID.
 *
 * `.note` is `--muted` at 0.875rem — the class this stylesheet uses for footnotes and
 * asides — and until 2026-08-30 it painted the one sentence telling a person that the
 * eight words standing between them and every message they have do not match. Hannu
 * mistyped his own KEY at §7.4's confirmation, was refused, and walked straight past
 * it: *"it is so the same font, colour etc that it does not look like an error
 * message. If the user is in a hurry the user needs a clear stand out red notice or
 * won't react. That happened to me."*
 *
 * ⚠️ §7.4's OWN REASONING IS WHAT MAKES IT SERIOUS. The whole point of retyping all
 * eight words rather than spot-checking two is that this is THE moment a transcription
 * error is caught; a refusal the person can walk past converts the strongest check in
 * the setup flow into a formality.
 *
 * ⚠️ THE STRENGTH IS D-104's "important", NOT ITS "one action". A soft fill with a
 * coloured border, in the alarm hue. The filled treatment is reserved for the single
 * ACTION on a screen and a refusal is not an action — the action is the button
 * underneath, which must stay the loudest thing here.
 */
const refused = (id, s) => {
  text(id, s);
  $(id).classList.add("refused");
};

// ⚠️ `emphasised()` STOOD HERE AND IS GONE, ABSORBED INTO `prose()` BELOW. It
// rendered `**marked**` runs as `<strong>` nodes and had exactly one caller, which
// now needs term buttons as well. Leaving it would have left **two renderers for
// one markup language**, of which one was correct and one was silently a subset —
// and a second source of truth for the same rule is precisely how the first one
// rotted (`README.md`'s claim that Caddy applied §6's headers, D-103's note above
// the `haamu.app` site block). Round 4's measurement is unchanged and lives on in
// `prose`: NOT `innerHTML`, because it is a Trusted Types sink and this site
// enforces the policy.

/**
 * ⭐⭐ D-110's SECOND LAYER, AND THE WHOLE OF IT IS THIS FUNCTION.
 *
 * The tester round split exactly in half — too much to read, against keep every
 * word — and those are two audiences rather than a disagreement. `prose` renders a
 * surface sentence and hangs the technical answer off the word it belongs to, so
 * each audience reads the page it asked for and neither one is served an average.
 *
 * ⚠️⚠️ IT IS A BUTTON AND A PANEL, NEVER A HOVER TOOLTIP, AND THAT IS MECHANICAL.
 * This is a messenger; the majority device has no pointer at all, so a panel
 * revealed by hovering is a panel most users can never open. The disclosure expands
 * **in the flow, directly under the paragraph it came from**, which also means no
 * positioning arithmetic, no overlay to dismiss, and no lost place on a small screen.
 *
 * ⚠️ EVERY NODE IS BUILT WITH `createElement`. D-103 measured what the obvious
 * alternative does here: `innerHTML` under this site's Trusted Types does not
 * degrade, it throws, and the block that renders the gate dies with it — no gate at
 * all, on the first screen. That applies to the empty string too, which is how the
 * deployed site broke on 2026-08-12, so clearing is `replaceChildren()`.
 *
 * ⚠️ THE HOST IS EMPTIED FIRST because several of these screens are rendered more
 * than once in a session — the SAS panel is reached twice by design (§3.6.2). A
 * panel appended beside its previous copy is how a screen slowly fills with
 * duplicates that only a long session ever sees.
 *
 * @param {string} hostId  an element that may contain block children — never a <p>
 * @param {string|string[]} sentences
 */
let termPanelSeq = 0;
function prose(hostId, sentences) {
  const host = $(hostId);
  host.replaceChildren();

  for (const sentence of [].concat(sentences)) {
    const p = document.createElement("p");
    const panels = [];

    for (const run of segments(sentence)) {
      if (!run.term) {
        if (run.strong) {
          const strong = document.createElement("strong");
          strong.textContent = run.text;
          p.append(strong);
        } else {
          p.append(document.createTextNode(run.text));
        }
        continue;
      }

      const entry = copy.terms[run.term];
      // ⚠️ A marked term with no entry is a copy defect, and `test/copy.mjs` fails
      // on it. At runtime the word still has to reach the reader: showing the text
      // without its button loses an explanation, and showing nothing loses a word
      // out of the middle of a sentence.
      if (!entry) {
        p.append(document.createTextNode(run.text));
        continue;
      }

      const panelId = `term-panel-${++termPanelSeq}`;

      const button = document.createElement("button");
      button.type = "button";
      button.className = run.strong ? "term strong" : "term";
      button.textContent = run.text;
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-controls", panelId);

      const panel = document.createElement("div");
      panel.className = "term-panel hidden";
      panel.id = panelId;

      const heading = document.createElement("h4");
      heading.textContent = entry.title;
      panel.append(heading);
      for (const line of entry.body) {
        const bp = document.createElement("p");
        bp.textContent = line;
        panel.append(bp);
      }

      button.addEventListener("click", () => {
        const opening = panel.classList.contains("hidden");
        panel.classList.toggle("hidden", !opening);
        button.setAttribute("aria-expanded", opening ? "true" : "false");
      });

      p.append(button);
      panels.push(panel);
    }

    host.append(p, ...panels);
  }
}

const SCREENS = [
  "gate", "setup", "write", "confirm", "pasted", "enter", "working",
  "home", "progress", "verify", "chat", "failure", "panic",
  "ghost", "duplicate", "covered", "paste",
  "dormant", // ARCHITECTURE §4.2.2 — this identity is already open in another tab
  "pin-set", // ARCHITECTURE §4.3 — the cover PIN, chosen once per KEY per browser
];
/**
 * The screen on show, so that a re-render of the SAME one leaves the page alone.
 *
 * ⚠️ Named `shownScreen` rather than `screen` because `screen` is a global this module
 * would then shadow, and a reader would have to know that to be sure which was meant.
 */
let shownScreen = null;

/**
 * Show one panel, hide the rest, and put the page where the new screen starts.
 *
 * ⚠️ A PANEL SWAP IS A NAVIGATION, AND A SCROLL POSITION IS NOT INHERITED ACROSS ONE.
 * Every screen here lives in one document, so without this the conversation list
 * opens wherever the previous screen was left — and on a phone that is far enough
 * down that the list is above the top of the window. A person arriving at that
 * screen sees the notes under it and none of the thing they came for.
 *
 * ⭐ THE CHAT IS THE EXCEPTION, AND NOT AS A SPECIAL CASE FOR ITS OWN SAKE: the
 * newest message is at the BOTTOM, so the bottom IS that screen's beginning. Two
 * scrolls are involved and they are different — `line()` scrolls the log box, this
 * scrolls the page the box sits in — and both have to be at the end for the newest
 * message and the thing you type into to be on screen together.
 *
 * ⚠️ ONLY ON A CHANGE. `only()` runs again on every re-render — a message arriving,
 * a rename, a peer leaving — and yanking the page to the top each time one lands
 * would be a worse fault than the one this fixes.
 */
/**
 * ⚠️⚠️ A NOTICE OUTLIVES THE SCREEN IT WAS RAISED ON, AND FEEDBACK 16 IS WHAT THAT
 * LOOKS LIKE FROM THE OUTSIDE. `notice()` appends a panel outside `SCREENS`, so
 * switching screens does not touch it: *"The other person has been told that you
 * ended the conversation."* — raised correctly on the list after a deletion — was
 * still on screen when Hannu started a pairing, where it reads as a statement about
 * the invite link he was making. **He had not been in a conversation at all.**
 *
 * ➡️ **A NOTICE THAT REPORTS SOMETHING ALREADY FINISHED BELONGS TO THE SCREEN IT WAS
 * RAISED ON.** The others here are different in kind and must NOT be cleared: the
 * roster warnings are re-raised on every render, `resume`/`inflight` are offers being
 * made, and `dbblocked`/`ghostbusy`/`linkbusy` describe a condition that is still
 * true. Only reports of a completed act go stale by being carried.
 *
 * ⚠️ This list is deliberately short rather than clever. Widening it is a change to
 * live behaviour on panels nobody has re-tested, and `purged` is the obvious next
 * candidate — left out on purpose until somebody looks at it.
 */
const REPORT_NOTICES = ["closing"];

/**
 * D-139 — which of the app bar's two blocks is on show.
 *
 * ⚠️ THE CONVERSATION IS THE ONLY SCREEN THAT TAKES THE BAR, and that is a claim
 * about this product rather than a shortcut. WhatsApp gives a chat its own bar
 * because a chat has a subject — the person you are talking to — that the app's own
 * name would displace. Every other screen here is the app talking about itself: the
 * gate, the wizards, the list. So the bar carries the wordmark, and the wordmark is
 * static markup so that it survives a module that failed to load (D-083).
 *
 * ⚠️ THE MENU IS CLOSED ON EVERY SCREEN CHANGE, and that is the same finding as
 * D-138's, one layer out. A notice that reports a finished act belongs to the screen
 * it was raised on; an OPEN MENU belongs to the screen it was opened on even more
 * plainly, because it is anchored to a bar whose contents just changed underneath it.
 */
/**
 * ⛔⛔ SCREENS THAT STAND IN FRONT OF SOMETHING, SO NOTHING IN THE BAR MAY WALK AROUND
 * THEM.
 *
 * ⚠️⚠️ THIS WAS A REAL HOLE AND IT WAS FOUND BY LOOKING AT THE SCREEN RATHER THAN BY
 * ANY TEST. `#menu-create` is shown on every screen that is not the conversation, and it
 * runs `runInitiate()` — so on the cover, one tap on the menu started a pairing and put
 * the app back on screen without the PIN. The same tap on `#pin-set` skipped a step the
 * product now requires of everybody.
 *
 * ⭐ THE CLASS IS NOT "THE MENU IS DANGEROUS". It is that `barMode` decided what to show
 * from ONE question — *is this the conversation?* — which was an exhaustive question
 * while every other screen was somewhere a person could freely leave. A screen whose
 * whole job is to stand in the way is the first one that is not.
 */
const GATED = new Set(["covered", "pin-set"]);

const barMode = (id) => {
  const chat = id === "chat";
  const gated = GATED.has(id);
  show("bar-chat", chat);
  // ⚠️ THE ARROW OBEYS THE SAME RULE AS `#back-home`, AND IT HAS TO BE THE SAME
  // RULE RATHER THAN THE SAME VALUE. §7.6's Ghost mode has no conversation list, so
  // there is nowhere for "back" to go; `openHome()` in that mode lands on an offer
  // to start one, which is not what an arrow beside a name promises. `session` may
  // be null here — `only()` runs during boot — and `isGhost()` answers false then,
  // which is right: a document with no session is not in Ghost mode.
  show("bar-back", chat && !isGhost());
  show("bar-brand", !chat);
  // ⚠️ THE CONVERSATION'S CONTROLS ARE IN THE MENU AND BELONG TO THE CONVERSATION.
  // Leaving them on show elsewhere would offer "Delete this conversation" from the
  // conversation list, where there is no conversation open for it to mean.
  show("menu-chat", chat);
  // ⚠️ AND ITS OPPOSITE. "Start a new conversation" means nothing while a conversation
  // is open, and the ＋ button it doubles is not on that screen either.
  // ⛔ AND IT IS WITHHELD ON THE GATED SCREENS, where it would not be meaningless but
  // effective — it navigates, and both of those screens exist to stop navigation.
  show("menu-home", !chat && !gated);
  // ⚠️ See the comment on `#diagfoot` in `index.html`: it is the last child of the
  // scroller, so on the conversation — the one screen that is a full-height pane —
  // it wedges sixty-one pixels between the composer and the floor of the window.
  show("diagfoot", !chat);
  closeMenu();
};

/**
 * Is this a machine somebody types on, rather than one they tap?
 *
 * ⚠️⚠️ IT DECIDES TWO SEPARATE THINGS AND BOTH ARE WHATSAPP'S OWN ANSWER: whether
 * opening a conversation puts the cursor in the composer, and whether Enter sends or
 * makes a new line. On a desktop both are a convenience; on a phone both are a
 * nuisance — an autofocus throws the keyboard over the conversation you just opened,
 * and an Enter that sends makes a paragraph impossible, because a phone keyboard has
 * no Shift+Enter to escape to.
 *
 * ⚠️ IT IS A PROXY AND IT IS THE STANDARD ONE. A touchscreen laptop matches, and that
 * is the right answer for it — it has a keyboard. What it cannot detect is a phone with
 * a keyboard attached, which is a residual this product can live with.
 */
const TYPED_ON = globalThis.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches ?? false;

const only = (id) => {
  SCREENS.forEach((s) => show(s, s === id));
  if (id === shownScreen) return;
  if (id !== "home") REPORT_NOTICES.forEach(clearNotice);
  shownScreen = id;
  barMode(id);
  // ⚠️ D-159 — THE LANGUAGE CONTROL IS OFFERED WHERE THIS SCREEN CAN BE REDRAWN IN THE
  // OTHER LANGUAGE, AND NOWHERE ELSE. `RERENDER` says which, one entry per screen, with
  // the reason beside every `null`. Hiding it is the honest answer on a screen holding
  // a pairing, a typed field or a captured error: a control that changed half the words
  // would look like it had worked.
  show("menu-lang", Boolean(RERENDER[id]));
  // ⚠️ THE SCROLLER IS `.screens` AND NOT THE DOCUMENT, SINCE D-139. The old layout
  // scrolled the page, and this line reset it on every navigation because a panel
  // swap is a navigation and a scroll position is not inherited across one. The app
  // is now exactly the height of the window and the page itself never scrolls, so
  // the position to reset belongs to the box that does.
  //
  // ⭐ AND THE CHAT NO LONGER NEEDS AN EXCEPTION HERE. It used to be scrolled to the
  // BOTTOM, because the newest message and the composer had to be on screen together
  // and the composer was part of the document. The composer is now pinned outside
  // the scroller, so the conversation's own log — scrolled by `line()` — is the only
  // thing that has to be at the end, and it already is.
  $("screens").scrollTop = 0;
  // ⚠️⚠️ D-186 — A SCREEN THAT REPLACES ANOTHER HAS TO TAKE THE CURSOR WITH IT.
  // Measured rather than assumed: on five of the nine screens a person walks
  // through, the swap left `document.activeElement` on `<body>`, because the control
  // that had focus was the one just hidden. A browser whose focused element goes
  // away focuses nothing — and "nothing" is a screen reader saying nothing, and a
  // Tab that starts again at the top of the document. The same measurement found
  // every control in the product already has an accessible name, so a name was never
  // what was missing here; a signal that the screen had changed at all was.
  //
  // ⭐ THE PANEL, NOT ITS FIRST FIELD. Focusing the first input would be right on the
  // four screens that have one and wrong on the conversation, where D-139
  // deliberately leaves the composer alone on a phone so the keyboard does not throw
  // itself over the messages a person just opened. Focusing the panel says "you are
  // here" without claiming anybody wants to type. The four handlers that do move the
  // cursor into their own field run after this and still win — including the line
  // below, which is why it stays below.
  //
  // ⚠️ `preventScroll`, because the line above has just put the scroller at the top
  // and a focus that scrolls would undo it.
  const panel = $(id);
  panel.tabIndex = -1;
  panel.focus({ preventScroll: true });
  // ⚠️ ROUND 19: *"when I choose a conversation the cursor does not automatically go
  // into where I should type."* Only where a keyboard is — see `TYPED_ON`. A disabled
  // field ignores this, which is exactly right on a closed conversation.
  if (id === "chat" && TYPED_ON) $("text").focus();
};

// ------------------------------------------------- D-139, the bar's overflow menu

/**
 * ⚠️ A FUNCTION DECLARATION AND NOT A `const`, BECAUSE `barMode()` ABOVE CALLS IT.
 * A `const` arrow here would be in the temporal dead zone for every call made before
 * this line is reached, and the first `only()` runs during boot.
 */
function closeMenu() {
  show("menu", false);
  $("bar-menu").setAttribute("aria-expanded", "false");
}

function toggleMenu() {
  const open = $("menu").classList.contains("hidden");
  show("menu", open);
  $("bar-menu").setAttribute("aria-expanded", String(open));
  if (open) markTheme();
}

/**
 * The tick, on whichever of the three is in force.
 *
 * ⚠️ `aria-checked` IS THE ONLY PLACE THE STATE IS WRITTEN, and `app.css` draws the
 * tick from it with an attribute selector. A class as well would be the store and
 * the screen each holding their own copy of one decision — D-138's finding, and the
 * one it cost a field round to learn.
 *
 * ⚠️ IT READS THE CHOICE BACK FROM `theme.js` RATHER THAN REMEMBERING WHAT WAS
 * PRESSED. In Ghost mode a choice is deliberately not written, and after §7.8's
 * ending it is deliberately erased; a variable in this file would go on claiming
 * the last press in both cases.
 */
function markTheme() {
  const now = themes.current();
  for (const [id, choice] of [
    ["theme-system", themes.SYSTEM],
    ["theme-light", themes.LIGHT],
    ["theme-dark", themes.DARK],
  ]) {
    $(id).setAttribute("aria-checked", String(now === choice));
  }
}

$("bar-menu").addEventListener("click", (e) => {
  e.stopPropagation();
  toggleMenu();
});
$("bar-back").addEventListener("click", () => openHome());

for (const [id, choice] of [
  ["theme-system", themes.SYSTEM],
  ["theme-light", themes.LIGHT],
  ["theme-dark", themes.DARK],
]) {
  $(id).addEventListener("click", () => {
    // ⚠️ `isGhost()` IS ASKED AT THE MOMENT OF THE PRESS, not captured at boot. A
    // browser can enter Ghost mode without reloading, and a handler that closed over
    // the answer would keep writing to disk for the whole session after it did.
    themes.choose(choice, { ghost: isGhost() });
    markTheme();
  });
}

// --------------------------------------------------------- D-159, the language

/**
 * ⭐⭐⭐ HOW EACH SCREEN REDRAWS ITSELF IN THE OTHER LANGUAGE — or that it cannot, in
 * which case the control is not offered while it is showing.
 *
 * ⚠️⚠️ THE TABLE IS THE POINT, NOT THE CONVENIENCE. `paintCopy()` owns a hundred and
 * twenty sentences, which is most of this product — but SEVENTY-THREE element ids are
 * written somewhere else, at the moment a screen is entered or an event lands. A
 * switch that ran `paintCopy()` alone would leave those seventy-three in the language
 * the reader just said they could not read, and it would leave them looking finished.
 *
 * ➡️ **A SCREEN WITH NO ENTRY HERE WOULD HAVE NO HOME TO BE REVIEWED IN** — D-156's
 * finding, one layer out. So this is exhaustive over `SCREENS`, `test/lang.mjs` fails
 * if the two ever disagree, and adding a screen forces somebody to answer for it.
 *
 * ⚠️ `null` IS AN ANSWER AND NOT A GAP. It means *the language cannot be changed from
 * here*, and `only()` hides the control rather than offering one that would half-work.
 * Every one of them is a screen with something in flight; the reason is beside it.
 */
const PAINTED = () => {};

const RERENDER = {
  // `showGate()` re-decides three labels from whether a link is being carried.
  gate: () => showGate(),
  // `#sets` — how many more sets of words may be drawn. Everything else is static.
  setup: () => renderCandidates(),
  // `#chosen-phrase` is the eight words themselves, which are not a sentence in any
  // language. Nothing else on this screen is written outside `paintCopy()`.
  write: PAINTED,
  // ⚠️ `#retype-note` HELD THE PREVIOUS ATTEMPT'S ANSWER, and D-151's rule is that the
  // previous answer belongs to the previous press. Translating it would be carrying a
  // stale sentence across; clearing it says the same thing the empty field says.
  confirm: () => text("retype-note", ""),
  pasted: PAINTED,
  enter: () => text("enter-note", ""),
  // ⚠️ NOT OFFERED — an unlock is running. `#working-note` is a live progress line that
  // §7.2's key derivation writes as it goes, and it lasts seconds.
  working: null,
  home: () => openHome(),
  // ⚠️⚠️ NOT OFFERED, AND THIS ONE IS A REAL FAULT RATHER THAN CAUTION. `steps` holds
  // the RENDERED STRINGS and `markStep` finds the current one with `steps.indexOf`, so
  // the moment `copy.pairing.step` changes language the active step matches nothing and
  // every step goes dark, mid-pairing, with no error. Offering the control here would
  // ship that. Fixing it means keying the steps by name rather than by text, which is a
  // change to §3's flow and belongs to whoever next touches §3 — not to the language.
  progress: null,
  // ⚠️ NOT OFFERED — §3.6.2's six digits are on screen and the other person is waiting
  // on an answer about them. Nothing that redraws this screen may run while that is true.
  verify: null,
  // ⚠️ THE LOG IS NOT REDRAWN AND MUST NOT BE. `renderLog` re-reads what was STORED, and
  // what was stored is what the other person actually said. The system lines among them
  // were true sentences at the time they were written, and a record is not a rendering.
  chat: async () => {
    if (!openEntry) return;
    paintConversation(openEntry);
    await showConversationState(openEntry);
    showLiveState();
  },
  // ⚠️ NOT OFFERED — `failWith(err)` writes a captured error that is held nowhere, so
  // there is nothing to render it from a second time.
  failure: null,
  // ⚠️ NOT OFFERED — §7.3.1a's wipe is being confirmed with the KEY typed into a field.
  // A menu press must not touch a screen that is one button away from deleting everything.
  panic: null,
  ghost: () => showGhostStart(),
  duplicate: () => showDuplicate(),
  // ⚠️⚠️ NOT OFFERED, AND THE REASON IS NOW A SECURITY ONE RATHER THAN A PRACTICAL ONE.
  // It used to be that `coverNow` needed the reason it was raised with and nothing kept
  // it. Since §4.3 grew a second tier, repainting this screen would clear the PIN field
  // AND reset the count of wrong entries — so a menu press would be an escape from the
  // one gate that drops the keys after five of them.
  covered: null,
  // ⚠️ NOT OFFERED — there is a link half-typed in the field and `openPasteLink()` clears
  // it. Losing what somebody pasted in order to change the language of the label above it
  // is a worse trade than reading that label in English.
  paste: null,
  dormant: () => showDormant(),
  // ⚠️ NOT OFFERED — there are two half-typed PIN fields on this screen and repainting
  // it would empty them. Same trade as `paste` above: losing what somebody has typed in
  // order to change the language of the label over it is the worse of the two.
  "pin-set": null,
};

/**
 * The tick, on whichever language is actually in force.
 *
 * ⚠️⚠️ IT ASKS `resolve()` AND NOT `current()`, WHICH IS THE OPPOSITE OF `markTheme()`,
 * and the difference is not an inconsistency. `theme.js` has a stored value for every
 * state including "follow the phone", so `current()` always names one of the three. A
 * language has no such third choice: before anybody presses anything `current()` is
 * `null`, and the page is nonetheless in a language — the address put it there, or the
 * browser's own list did. A tick driven by `current()` would show NEITHER option
 * selected on the one visit where the person most needs to see which one they are on.
 *
 * ➡️ It says *which language you are reading*, not *which button you pressed*.
 */
function markLanguage() {
  const now = langs.resolve();
  for (const [id, choice] of [
    ["lang-en", langs.EN],
    ["lang-fi", langs.FI],
  ]) {
    $(id).setAttribute("aria-checked", String(now === choice));
  }
}

/**
 * Put the whole document into the other language, without reloading it.
 *
 * ⚠️⚠️ **NEVER A RELOAD, AND THIS IS THE HARD CONSTRAINT OF THE WHOLE FEATURE.**
 * `K_master` lives in memory and nowhere else — §7.2 is explicit that it is never
 * written down — so `location.reload()` would end the session and ask a signed-in
 * person for their eight words because they pressed a menu item. Everything here is
 * synchronous in-memory work plus, at most, one screen re-reading its own store.
 *
 * ⚠️ THE ORDER IS THE SAME ORDER AS AT BOOT and for the same reason: `setLanguage`
 * rewrites what `copy.js` says, and every line below it renders whatever it says now.
 */
async function switchTo(choice) {
  // ⚠️ `isGhost()` AT THE MOMENT OF THE PRESS, not captured — `markTheme`'s note.
  langs.choose(choice, { ghost: isGhost() });
  setLanguage(choice);
  paintCopy();
  // D-169: `#notices` is above the screens, so `RERENDER` below never reaches it.
  repaintNotices();
  await RERENDER[shownScreen]?.();
}

for (const [id, choice] of [
  ["lang-en", langs.EN],
  ["lang-fi", langs.FI],
]) {
  $(id).addEventListener("click", () => void switchTo(choice));
}

// ⚠️ AND IT CLOSES WHEN ONE OF THE CONVERSATION'S OWN ITEMS IS PRESSED. Those three
// do not all navigate: "Conversations" reaches `only("home")`, which closes it as a
// side effect of the screen changing — but "Give name" stays on the conversation, so
// `only()` returns early at its `id === shownScreen` guard, `barMode()` never runs,
// and the menu would still be hanging open over the answer. Relying on the
// navigation to close it works for two items out of three, which is the worst number.
// ⚠️⚠️ BOUND TO `#menu` AND FILTERED ON `.menu-group button`, NOT BOUND TO THE GROUP.
// Round 19 added a second group and this listener was on `#menu-chat` alone, so the new
// group's item would have left the menu hanging open — the `.rows` trap for the fourth
// time: a rule that lives on the first caller rather than on what the rule is ABOUT.
// The rule is "an item that DOES something closes the menu", and the three theme
// buttons are deliberately outside every group so the tick can be seen to move.
$("menu").addEventListener("click", (e) => {
  if (e.target.closest(".menu-group button")) closeMenu();
});

// A menu closes when somebody presses somewhere else, and when Escape is pressed.
// ⚠️ On `document`, so it fires for the whole app rather than for the bar alone —
// the thing a person presses to dismiss a menu is by definition not in the menu.
document.addEventListener("click", (e) => {
  if (!$("menu").classList.contains("hidden") && !$("menu").contains(e.target)) closeMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenu();
});

const api = createApi();

// ------------------------------------------------------------------ the session

/**
 * Everything an unlocked identity holds. It is one object so that ending a
 * session is one assignment plus one `close()` — §7.8 is a list of things that
 * must ALL go, and state scattered across module variables is how one of them
 * stays behind.
 *
 * ⚠️ TWO MODES LIVE IN THIS ONE FIELD AND ONLY FOUR OF ITS KEYS ARE COMMON TO
 * BOTH: `mode`, `tabs`, `backend`, `pickleKey` and `messages`. §7.6's Ghost mode
 * has no keys to derive, no IndexedDB, no roster and no quarantine — so a Kept
 * session carries `{ keys, db, vault, roster, quarantine }` and a Ghost one carries
 * `{ ghost }`, and every read of the first set is guarded by the mode.
 *
 * ⭐ The point of the common four is that `flow/message.js`, `flow/live.js` and the
 * chat view never learn which mode they are in: one is handed IndexedDB sealed
 * under `local_key` and the other `sessionStorage` sealed under nothing, and the
 * interface `storage/sessions.js` defined is the same either way.
 */
let session = null; // { mode, tabs, backend, pickleKey, messages, ... }

/**
 * §7.6 has one identity per tab and no `roster_id` to name it with, so its records
 * are named for the mode. ⚠️ THAT IS A TRUE EXEMPTION AND NOT A CONVENIENT ONE, and
 * D-171 exists because the last one was written the other way round: Ghost's store is
 * `sessionStorage`, which is per-tab, so no second identity can reach these names —
 * whereas a channel root, which §4.1.1 exempted for being "one identity's by
 * construction", is held by BOTH ENDS of the channel by construction.
 */
const GHOST_RECORD_SCOPE = "ghost";

/**
 * Whose records these are — the value every stored name carries (ARCHITECTURE §4.1.1).
 *
 * ⚠️ NOT USABLE BEFORE `session` IS SET. The unlock path assigns `session` only after
 * `run()` has returned, and `onDisappeared` can fire inside it — so the paths that run
 * during construction are handed the scope explicitly instead of reaching for this.
 */
const scopeOfRecords = () => session?.recordScope ?? GHOST_RECORD_SCOPE;
let openEntry = null; // the conversation on screen

// §4.3's second tier. All four are per-document and none of them is written anywhere:
// the cover is a screen, and everything it counts dies with the page that raised it.
let coveredFrom = null; // the screen to go back to when the right PIN arrives
let pinWrong = 0; // wrong entries since the cover went up
let pinSlowUntil = 0; // Ghost mode only — the instant another try is allowed
let pinAfter = null; // what to run once a PIN has been chosen
let channel = null; // its message flow — this tab's, for SENDING
let seen = new Map(); // channelHash → msg ids already in the log
let pendingJoin = null; // a link this tab arrived with, held until there is a roster

// ------------------------------------------------------- ROADMAP step 9, the tabs

/**
 * Who is delivering, and for which conversations.
 *
 * ⚠️⚠️ ONLY THE LEADER RUNS A `startLive`, AND THAT IS §4.2's RULE RATHER THAN AN
 * ECONOMY. Two tabs streaming one channel is two connections against a per-mailbox
 * budget (§9.2) and two drains against one shared session record — which
 * `storage/db.js` now makes safe and which is still work done twice.
 *
 * ⭐ A FOLLOWER IS NOT A DEGRADED CLIENT. The leader drains into the SAME
 * IndexedDB, so a follower's messages arrive on disk whether or not anything tells
 * it; what the notice supplies is only the moment to re-read. The store is the
 * record and the notice is the hint — the same arrangement §5.3.3 has between the
 * mailbox and the stream, one layer up, and it fails the same safe way: a dropped
 * notice costs a stale screen until the next re-read, never a message.
 */
const streams = new Map(); // channelHash → { live, channel } — leader only
const elsewhere = new Map(); // tab id → channelHash another tab is displaying
let watching = null; // the channelHash THIS tab is displaying

/** This document's name on the notice channel. Never stored, never sent anywhere. */
const TAB_ID = crypto.randomUUID();

/** How often a follower re-reads, in case a notice was dropped. */
const RESYNC_MS = 30_000;

/** How often the leader re-asks who is watching what, so a crashed tab is dropped. */
const ROLL_CALL_MS = 15_000;

/** §4.3's watcher, live only while a session is open. */
let lockWatch = null;

// ------------------------------------------------------------- §7.4 the phrase

/**
 * §7.4's regeneration cap. It MUST survive a reload of the setup flow or it is
 * decorative and §7.2's entropy floor is unbound again — and there is a second
 * reason beyond the arithmetic: regenerating until the words look agreeable is a
 * softer form of the trimming instinct that the un-editable field exists to
 * prevent, and it is not neutral selection pressure.
 *
 * ⚠️ `localStorage`, NOT the vault: this count exists before there is an identity
 * to derive a key from, which is the whole moment it has to survive.
 */
const SETS_KEY = "lpm.candidate-sets";
const setsUsed = () => Number(localStorage.getItem(SETS_KEY) ?? 0);
const useASet = () => localStorage.setItem(SETS_KEY, String(setsUsed() + 1));

let words = passphrase.PHRASE_WORDS;
let candidates = [];
let chosenPhrase = null;
let confirmPasted = false;

/**
 * §7.2: chunking for display is presentation ONLY and MUST NOT reach
 * `canonical()`. The phrase that goes to the key derivation is always the string
 * generated — words joined by single spaces and nothing else.
 */
const forDisplay = (phrase) => phrase.split(" ").join("  ");

/*
 * ⚠️⚠️ `replaceChildren()`, NOT `innerHTML = ""`, EVERYWHERE IN THIS FILE — AND IT
 * IS NOT A STYLE PREFERENCE. IT IS THE ONLY ONE OF THE TWO THAT RUNS.
 *
 * `ARCHITECTURE.md` §6's CSP carries `require-trusted-types-for 'script'`, and
 * `innerHTML` is a Trusted Types sink. Assigning to it — **including assigning the
 * empty string** — throws:
 *
 *     TypeError: Failed to set the 'innerHTML' property on 'Element':
 *     This document requires 'TrustedHTML' assignment.
 *
 * ⭐⭐⭐ **THE OPPOSITE WAS ASSERTED IN WRITING, FROM READING THE SPECIFICATION** —
 * that the empty string is carved out and these eight lines were therefore safe. A
 * real browser disagreed on the first click, on the deployed site.
 * `feedback_verify_before_claiming` names exactly this: **when the claim is about
 * how a RUNTIME behaves, no amount of reading settles it.**
 *
 * ⚠️ **Why nothing caught it is the part worth keeping.** It is D-078's consequence
 * still unfolding — §6's headers had never been applied, so the interface had never
 * once run under them — and each existing check misses this *by construction*:
 * the static CSP run loads `/` and `/ended`, where these lines never execute;
 * `TestShippedHTMLSatisfiesItsOwnCSP` scans HTML for inline style and script, and
 * this is a JavaScript sink in a `.js` file; and the e2e suites are protocol-level
 * Node tests that never touch a DOM.
 *
 * ➡️ **A CSP IS NOT VERIFIED BY LOADING A PAGE. IT IS VERIFIED BY USING ONE.**
 */
function renderCandidates() {
  $("candidates").replaceChildren();
  candidates.forEach((phrase, i) => {
    const label = document.createElement("label");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "candidate";
    radio.value = String(i);
    if (i === 0) radio.checked = true;
    label.append(radio, document.createTextNode(forDisplay(phrase)));
    $("candidates").append(label);
  });
  const left = passphrase.MAX_CANDIDATE_SETS - setsUsed();
  $("regen").disabled = left <= 0;
  text("sets", left > 0 ? ` · ${copy.phrase.setsLeft(left)}` : ` · ${copy.phrase.capReached}`);
}

function newCandidateSet() {
  if (setsUsed() >= passphrase.MAX_CANDIDATE_SETS) return;
  useASet();
  candidates = passphrase.generateCandidates(words);
  renderCandidates();
}

$("go-setup").addEventListener("click", () => {
  words = passphrase.PHRASE_WORDS;
  if (candidates.length === 0) newCandidateSet();
  else renderCandidates();
  only("setup");
});

$("go-enter").addEventListener("click", () => {
  text("enter-note", "");
  only("enter");
  $("phrase-in").focus();
});

/**
 * The gate, in whichever of its two shapes this visit is (feedback 3).
 *
 * ⚠️⚠️ THE THREE CONTROLS ARE THE SAME THREE AND ALL THREE ALWAYS WORKED. A person
 * arriving with somebody's link who pressed any of them ended up in the same
 * conversation: `withIdentity` and `continueGhost` both follow `pendingJoin` the
 * moment there is somewhere to put a channel. What was missing was the SENTENCE —
 * the labels answered *"do you want an identity here"*, which is not the question
 * this person has, and the Ghost one described a way to START a conversation, so it
 * did not read as a way to open the one they were holding.
 *
 * ⭐ Hannu wrote all three out himself, which is the useful part: the third choice
 * was invisible to somebody looking straight at it.
 */
function showGate() {
  const arrived = Boolean(pendingJoin);
  // ⚠️⚠️ IT MUST NAME THE THING THE PERSON WAS ACTUALLY SENT. This sentence said
  // *"Somebody sent you an invite link"* to somebody who had just typed in a spoken
  // code — found by driving two browsers through the whole flow, and invisible to
  // every other check because the string itself is correct. D-018's rule cuts both
  // ways: naming one thing consistently only helps if it is the right thing.
  text("gate-arrived", pendingJoin && codes.looksLikeCode(pendingJoin) ? copy.pairing.arrivedCode : copy.pairing.arrived);
  show("gate-arrived", arrived);
  text("go-setup", arrived ? copy.nav.arrived.setUp : copy.nav.setUp);
  text("go-enter", arrived ? copy.nav.arrived.haveOne : copy.nav.haveOne);
  text("go-ghost", arrived ? copy.nav.arrived.ghost : copy.ghost.offer);
  only("gate");
}

$("back-gate").addEventListener("click", () => showGate());
$("regen").addEventListener("click", newCandidateSet);

/**
 * ⚠️⚠️ BOTH ROUTES BACK CLEAR THE FIELD, AND THAT IS THE WHOLE OF D-084's FIX.
 * The retype is only evidence of anything while the phrase is off the screen, so
 * looking at it again has to cost the test again. Anything else — keeping what was
 * typed, or showing the phrase beside the field "just while they check" — puts the
 * answer back next to the question, which is what the layout was already doing.
 */
const backToWriteItDown = () => {
  $("retype").value = "";
  text("retype-note", "");
  confirmPasted = false;
  only("write");
};

$("show-phrase").addEventListener("click", backToWriteItDown);
$("back-setup").addEventListener("click", () => only("setup"));
$("write-back").addEventListener("click", () => only("setup"));
$("written").addEventListener("click", () => {
  only("confirm");
  $("retype").focus();
});

// §7.4: the escape hatch from the cap is a STRONGER phrase, not a weaker one. One
// plain secondary link, no dialogue, no entropy explanation, no default change —
// the register §7.6 uses for Ghost mode: present it, do not explain it.
$("longer").addEventListener("click", () => {
  words = passphrase.PHRASE_WORDS_LONG;
  newCandidateSet();
});

$("chosen").addEventListener("click", () => {
  const picked = [...document.querySelectorAll('input[name="candidate"]')].find((r) => r.checked);
  chosenPhrase = candidates[Number(picked?.value ?? 0)];
  confirmPasted = false;
  $("retype").value = "";
  text("retype-note", "");
  text("chosen-phrase", forDisplay(chosenPhrase));
  // §7.4 in two screens rather than one (D-084): write it down here, type it back
  // next door, with the phrase off the screen.
  only("write");
});

// §7.4: pasting is allowed and MUST be detected. It changes what happens next; it
// does not block anything, and it must not be presented as a security risk — the
// dialogue asks the user to confirm something the software cannot check.
$("retype").addEventListener("paste", () => {
  confirmPasted = true;
});

$("pasted-ok").addEventListener("click", () => finishSetup());

$("confirmed").addEventListener("click", () => {
  if (!passphrase.phraseMatches(chosenPhrase, $("retype").value)) {
    // §7.4: on a wrong answer, show the phrase again and ask for it to be written
    // down properly. A wallet-style spot check of two words out of eight catches a
    // single transcription error only a quarter of the time; this is the whole
    // phrase, and Phase 0.5 measured 24.4 s to type it at 90% accuracy.
    refused("retype-note", copy.phrase.wrong);
    // ⚠️ IT DOES NOT SEND THEM BACK TO THE PHRASE. §7.4 says to show it again on a
    // wrong answer, and until D-084 that happened by the phrase never having left
    // the screen. The offer is a button they choose, so that the second attempt is
    // still a test rather than a transcription.
    return;
  }
  if (confirmPasted) {
    only("pasted");
    return;
  }
  finishSetup();
});

async function finishSetup() {
  const phrase = chosenPhrase;
  await withIdentity(phrase, async (s) => {
    await s.roster.create();
  });
}

$("unlock").addEventListener("click", async () => {
  const typed = $("phrase-in").value;
  if (!typed.trim()) return;
  await withIdentity(typed, async (s) => {
    // The cache first, the network only if there is nothing here (§7.3.3): a
    // launch that fetched would make `roster_id` a daily signal.
    if (!(await s.roster.load())) await s.roster.load({ network: true, reason: rosterFlow.SETUP });
  });
});

// ------------------------------------------------------------- opening a session

/**
 * Derive the identity, open the stores, and hand the caller a session.
 *
 * ⚠️ THE 404 BRANCH IS THE ONE THAT MATTERS (§7.2). A mistyped phrase and a
 * genuinely new identity are the same response, so this path says "try again" and
 * never quietly creates anything. The other direction is handled by the server: a
 * create against an existing identifier is refused rather than overwriting it.
 */
async function withIdentity(phrase, run) {
  only("working");
  text("working-note", copy.unlock.working);
  // §4.2.2: whether this document is a client is decided fresh for each session. A
  // flag left `true` from a previous one would make `heard()` ignore every notice
  // for the life of the tab, silently.
  dormant = false;
  await new Promise((r) => setTimeout(r, 20)); // let the panel paint before Argon2id

  let opened = null;
  try {
    const keys = await rosterFlow.identity(phrase);
    const db = await dbs.openDatabase({
      // ⚠️ BOTH OF THESE ARE MULTI-TAB, AND NEITHER MAY BE SWALLOWED. `blocked`
      // means another tab is holding an older version open and this one will never
      // start; `versionchange` means another tab is trying to upgrade and cannot
      // until this one lets go. Unhandled, the first is a blank screen and the
      // second makes the release uninstallable for anyone with two tabs open.
      onBlocked: () => notice("dbblocked", () => ({ body: copy.tabs.blocked, alarm: true })),
      onVersionChange: () => void haltWith(copy.tabs.upgraded),
      // ⚠️ ARCHITECTURE §4.2.3. Not an error and not an event — a level, raised while
      // the shared store is not answering and lowered when it does.
      onSlow: (slow) => void storeStalled(slow),
    });
    const vault = vaults.openVault({ db, localKey: keys.localKey });
    // ⚠️⚠️ WHICH IDENTITY'S RECORDS THESE ARE, SAID IN THE NAME AND NOT ONLY IN THE
    // KEY THEY ARE SEALED UNDER (D-170). One browser is one database; `vault` makes
    // a record unreadable to another identity and does nothing to stop one
    // addressing it. Two records were named for the browser rather than the
    // identity, and both faults were the same fault: the quarantine list threw on
    // the unlock path, and the in-flight pairing record was overwritten.
    const recordScope = await vaults.identityDigest(keys.rosterId);
    const quarantine = quarantineFlow.openQuarantine({ storage: vault.conversation, scope: recordScope });
    const roster = rosterFlow.openRoster({
      api,
      keys,
      storage: vault.conversation,
      durable: vault.durable,
      onDisappeared: (change) => absorb(change, quarantine, vault, recordScope),
    });
    // ⚠️⚠️ ASKED BEFORE `openTabs` AND NOT AFTER — ARCHITECTURE §4.2.2. Since §4.2.1 a
    // visible tab steals leadership as it is constructed, so asking afterwards would
    // always find the writer lock held by this very document. This is the last instant at
    // which the question "is somebody else already running this identity?" has an answer.
    const scope = await tabsFlow.scopeFor(keys.rosterId);
    const alreadyLive = await tabsFlow.anotherClientIsLive(scope);
    const tabs = tabsFlow.openTabs({
      scope,
      dormant: alreadyLive,
      onLeader: (is) => void (is ? becameLeader() : stoodDown()),
      onNotice: (message) => void heard(message),
      // §7.8 step 3, receiving end: another tab ended, so this one does too — the
      // whole ordering, minus the broadcast and the wait it must not repeat.
      onEnd: () => void endBecauseAnotherTabDid(),
    });
    opened = {
      mode: "kept",
      keys, db, vault, roster, quarantine, tabs, recordScope,
      backend: vault.conversation,
      pickleKey: keys.pickleKey,
      messages: vault.messages,
    };
    await run(opened);
    session = opened;
    // §4.3's second tier, read before the watcher below is armed. `attempt` is used
    // rather than `get` so that another identity's record in this browser is not read as
    // "no PIN yet" and quietly overwritten.
    session.pinRecord = await readPinRecord();
    if (leaderDeferred) {
      leaderDeferred = false;
      await becameLeader();
    }
    // §4.3, started only now: a watcher armed before the session exists would fire
    // into `lockNow` with nothing to lock.
    //
    // ⚠️⚠️ BOTH TIERS, AND THE LONG ONE IS PASSED EVERY TIME. `watchIdleness` treats an
    // absent `onLock` as a deliberate statement that this mode has nothing to lock to —
    // true of Ghost and false here — so a change that dropped it would silently remove
    // the only gate that takes the derived keys out of memory.
    lockWatch = lockFlow.watchIdleness({
      onCover: coverDue,
      onLock: (reason) => void lockNow(reason),
    });

    // ⚠️⚠️ ARCHITECTURE §4.2.2, AND IT COMES BEFORE THE JOIN DELIBERATELY. Another
    // client of this identity was already delivering when this document opened, so this
    // one declines to be a second rather than race it.
    //
    // ⚠️⚠️ IT ALSO COMES BEFORE THE TWO SWEEPS BELOW, WHICH IT DID NOT UNTIL §4.2.3.
    // Rule 1 says a dormant document "writes nothing to the store", and these two lines
    // were a whole expiry pass over `messages` and another over the quarantine, run by
    // the one document in the browser that has just been told it is not the client. On a
    // phone that document is about to be backgrounded and frozen, and §4.2.3's measured
    // hazard is precisely a store operation caught in flight when that happens —
    // **which nothing, afterwards, can release**. The live tab sweeps; this one has no
    // business doing it twice, and every transaction it does not start is one it cannot
    // be frozen holding.
    if (alreadyLive && !pendingJoin) {
      await showDormant();
      return;
    }

    // ⚠️⚠️ D-170's TWO MIGRATIONS, AND THEY ARE BELOW THE DORMANT RETURN ON PURPOSE.
    // §4.2.2 rule 1 says a dormant document "writes nothing to the store", and these
    // write — so they belong here, with the other once-per-open housekeeping, and not
    // beside the construction they are about. Each moves ONE record from a name every
    // identity in this browser shared onto this identity's own, and each leaves a
    // record it cannot open exactly where it is, because that record is another
    // identity's and not this one's to remove.
    await quarantineFlow.adoptLegacy(vault.conversation, recordScope);
    await flow.adoptLegacyInFlight(vault.conversation, recordScope);
    // D-171's third: the session record and the closed marker were named for the
    // CHANNEL, and §3 gives both ends of a channel the same root. Unlike the two
    // above there is no fixed name to look for, so it lists.
    await store.adoptLegacyChannelRecords(db, vault.conversation, recordScope);

    // §6.6 and §7.3.1a, both on the same occasion and for the same reason: these
    // are the only two timers in the client, they both need `local_key`, and the
    // app being opened is the only moment there is one. Nothing expires while the
    // app is closed, which is why the copy says "the next time you open this".
    await vault.messages.sweep(epochs.nowSeconds());
    await forgetExpiredQuarantine();

    // ⚠️⚠️ AN INVITATION TAKES THIS TAB OVER; IT IS NEVER HANDED ACROSS (§4.2.2 rule 3,
    // rewritten — D-128). The rule said the opposite until it was tested on a phone: the
    // arriving tab passed the link to the running one AND kept a copy for the case where
    // the running one was frozen and never heard. When it was NOT frozen it heard, and
    // consumed §2.1's single-use link — so "Move it to this tab" then followed an
    // invitation that had already been spent, and refused.
    //
    // ⭐ THE REPAIR IS NOT AN ACKNOWLEDGEMENT, IT IS HAVING NOTHING TO ACKNOWLEDGE.
    // A link that is only ever in one document cannot be spent twice, and no protocol
    // between the tabs has to be right for that to hold. It is also what the person
    // means: pointing a camera at a code is an instruction addressed to the tab that
    // opened, which is the tab they are looking at.
    //
    // The one-live-client invariant is kept, not broken — the other tab is displaced,
    // not joined. `wake()` is the same call the button makes, so the invited path and
    // the pressed path are one path.
    if (alreadyLive) {
      tabs.announce("takeover");
      tabs.wake();
    }

    // ⚠️ A JOINER NEEDS AN IDENTITY TOO AND THE LINK CANNOT WAIT LONG: §3's
    // session lives a day, and a channel root with nowhere to be written is
    // a conversation that disappears when the tab closes. So the link is held
    // until there is a roster, and followed the moment there is one.
    if (pendingJoin) {
      const link = pendingJoin;
      pendingJoin = null;
      await runJoin(link);
      return;
    }
    // §3.4.1b rule 7, and this line is the earliest it can go. `local_key` exists
    // now for the first time, so the sealed pairing record is readable for the first
    // time — before this point there is nothing to offer because nothing can be read.
    //
    // ⚠️ AFTER `pendingJoin` AND NOT BEFORE. A link the person has just followed is
    // an instruction; a record found on disk is a question. The instruction wins, and
    // `join` reuses the record itself when the two are the same pairing.
    await offerToResume();
    await openHome();
  } catch (err) {
    // ⚠️ READ BEFORE THE CLOSE, USED AFTER IT. `recordScope` is a prefix of a hash of
    // `roster_id` and no part of `K_master`, so holding it across a failed unlock
    // discloses nothing — and it is the only thing the way out below needs, because
    // deleting a record by name needs no key. That is the whole reason there can be
    // a way out at all: the person is locked out precisely because `local_key` will
    // not open these rows.
    const scope = opened?.recordScope ?? null;
    opened?.tabs?.close();
    opened?.db?.close();
    only("enter");
    refused("enter-note", describeIdentity(err));
    if (err?.reason === "record_unreadable" && scope) offerToForgetLocalHistory(scope);
  }
}

/**
 * §7.3.2's mark will not open, so this device cannot perform the rollback check and
 * refuses to go on. The refusal is right; being unable to do anything about it is not.
 *
 * ⛔⛔ THE BUTTON DELETES A SECURITY PROTECTION AND THE PANEL SAYS SO IN THE WORDS
 * `ending.thoroughConfirm` USES FOR THE SAME LOSS (D-170). It is offered rather than
 * done, and the alternative to offering it is a person permanently unable to open
 * their own KEY in this browser with no way to find out why — which is what Hannu
 * met, and the only way out he had was a diagnostic page nobody else has.
 *
 * ⚠️ IT REACHES FOR THE DATABASE DIRECTLY, AND HAS TO. There is no session: the
 * unlock threw, `K_master` is gone with it, and no vault can be opened. `db.delete`
 * needs neither — only the name, which contains this identity's digest and so is
 * this identity's row and nobody else's.
 *
 * ⚠️ A PANEL AND NOT A LINE OF TEXT, so that D-169's rule holds: it is built by a
 * function, so `repaintNotices()` can say it again in the other language.
 */
function offerToForgetLocalHistory(scope) {
  notice("damaged", () => ({
    body: copy.unlock.damaged.body,
    alarm: true,
    actions: [
      {
        note: copy.unlock.damaged.note,
        buttons: [
          {
            label: copy.unlock.damaged.control,
            onClick: async () => {
              let db = null;
              try {
                db = await dbs.openDatabase();
                await rosterFlow.forgetLocalHistory(db, scope);
                clearNotice("damaged");
                text("enter-note", copy.unlock.ask);
              } catch (err) {
                noteProblem(err);
                refused("enter-note", describeIdentity(err));
              } finally {
                db?.close();
              }
            },
          },
        ],
      },
    ],
  }));
}

// ------------------------------------------------------------- §7.6 Ghost mode

/**
 * Open — or resume — a Ghost session in this document.
 *
 * ⚠️⚠️ IT NEVER OPENS INDEXEDDB, AND THAT IS THE ONE LINE OF THIS FUNCTION THAT
 * §7.6 ACTUALLY REQUIRES. "No IndexedDB, no `localStorage`, no Cache Storage, no
 * cookie" is a rule about what may EXIST, not only about what may be written: an
 * empty database created and left behind is an origin-scoped artefact that outlives
 * the tab, in the mode whose entire claim is that nothing does. So the Kept path's
 * `openDatabase` is not called here rather than called and left unused.
 *
 * ⚠️ THE ORDER IS: ADOPT THE ID, THEN ASK WHO ELSE IS RUNNING. `openGhost` mints
 * only what is missing, so a duplicated tab — which was handed a copy of this
 * storage — adopts the existing id and writes nothing, which is what makes the
 * census below able to see it at all.
 */
async function enterGhost() {
  const ghost = await ghostFlow.openGhost({});
  const tabs = tabsFlow.openTabs({
    scope: ghost.scope,
    onLeader: (is) => void (is ? becameLeader() : stoodDown()),
    onNotice: (message) => void heard(message),
    onEnd: () => void endBecauseAnotherTabDid(),
  });

  session = {
    mode: "ghost",
    ghost, tabs,
    recordScope: GHOST_RECORD_SCOPE,
    backend: ghost.store,
    pickleKey: ghost.pickleKey,
    messages: ghost.messages,
    root: null, // the channel root's bytes, once there is one — §7.8 step 2 wipes it
    pinRecord: null, // §4.3's second tier — filled in immediately below
  };
  session.pinRecord = await readPinRecord();

  // ⚠️⚠️ §7.6's DUPLICATED TAB, AND THE CENSUS IS WHAT SEES IT. `sessionStorage` is
  // per-tab, so two Ghost tabs never contend — but "Duplicate tab" hands the new
  // document a COPY, and a copy is not a conflict: both hold the same Olm session,
  // advance it independently, and store into two areas that never meet. The
  // conditional write that closes this for Kept mode has no shared record to compare
  // against and cannot see it. What CAN see it is that the two documents are
  // same-origin and now share this session's lock name.
  //
  // ⭐ The census is being used at the OPPOSITE END of the session from the one it
  // was built for: §7.8 step 4 asks "is anyone still here?" while this asks "was
  // anyone already here?" — the same question, and the same answer, from the other
  // side. `null` still means the browser cannot answer, and still may not be read
  // as the comfortable value.
  const live = await tabs.census();
  if (live !== null && live > 1) {
    await showDuplicate();
    return;
  }
  await continueGhost();
}

/**
 * The Ghost session may run: resume its conversation, follow a link, or offer one.
 *
 * ⚠️ IT IS SEPARATE FROM `enterGhost` BECAUSE IT IS REACHED TWICE. The second time
 * is from `becameLeader`, when the document this one was copied from has gone away
 * — at which point this tab is no longer a copy of anything running, and it holds
 * the only remaining copy of the conversation.
 */
async function continueGhost() {
  const { ghost } = session;
  ghostInert = false;

  // ⚠️⚠️ §4.3's SECOND TIER IS MANDATORY AND THIS IS WHERE GHOST MODE MEETS IT — before
  // a conversation exists, rather than after. ⭐ The placement is the same argument
  // `openConversation` makes about arming the watcher: *"the screen it would cover is the
  // one holding a single-use link the person is trying to send."* A PIN demanded at that
  // moment would stand between somebody and the one act this mode exists for; demanded
  // here it costs a calm minute before anything is at stake.
  if (!session.pinRecord) {
    await showPinSet(continueGhost);
    return;
  }

  await ghost.messages.sweep(epochs.nowSeconds()); // §6.6, on the only occasion there is

  const entry = await ghost.channel();
  if (entry) {
    if (pendingJoin) {
      // One conversation per Ghost session (§7.6 describes one root and one role),
      // so a link arriving in a tab that already has one has nowhere to go. Saying
      // so beats silently ignoring it or silently replacing what is here.
      pendingJoin = null;
      notice("ghostbusy", () => copy.ghost.linkElsewhere);
    }
    await openConversation({ ...entry, rootBytes: b64uDecode(entry.root, "channel root") });
    return;
  }
  if (pendingJoin) {
    const link = pendingJoin;
    pendingJoin = null;
    await runJoin(link);
    return;
  }
  await showGhostStart();
}

async function showGhostStart() {
  text("ghost-what", copy.ghost.what);
  text("ghost-cost", copy.ghost.cost);
  text("ghost-not-erased", copy.ghost.notErased);
  text("ghost-start", copy.ghost.start);
  // Where there is no census this check cannot be made at all — §7.6 records that
  // as a residual rather than solving it, so the app says which of the two it is
  // instead of showing nothing and implying the stronger one.
  if (!session.tabs.capabilities.census) notice("nocensus", () => copy.ghost.noCensus);
  only("ghost");
}

/**
 * This document is a copy of one that already has the conversation. It is INERT.
 *
 * ⚠️⚠️ INERT, NOT A FOLLOWER, AND THE DIFFERENCE IS THE WHOLE OF §7.6's RESIDUAL.
 * A Kept-mode tab without the leader lock is a perfectly good client: the leader
 * drains into the same IndexedDB, so its messages arrive on disk whether or not
 * anything tells it — "the store is the record and the notice is the hint" (§4.2).
 * A duplicated Ghost tab shares NO store with the tab it was copied from. There is
 * no record for it to re-read and nothing it could write that the other document
 * would ever see, so the only correct amount of work for it to do is none.
 */
async function showDuplicate() {
  ghostInert = true;
  text("dup-body", copy.ghost.duplicated);
  text("dup-end", copy.ghost.duplicatedEnd);
  text("dup-end-note", copy.ghost.duplicatedEndNote);
  only("duplicate");
}

/** This document stood down as a duplicate and has not been promoted (§7.6). */
let ghostInert = false;

// ------------------------------------------- ARCHITECTURE §4.2.2, one live client

/**
 * This document declined to be a client, because another one was already delivering.
 *
 * ⚠️⚠️ IT IS NOT THE GHOST DUPLICATE ABOVE, AND THE DIFFERENCE IS WHAT EACH ONE CAN
 * RECOVER FROM. A duplicated Ghost tab shares no store with the document it was copied
 * from, so there is nothing it could ever be promoted to and its only honest control is
 * "remove this copy". A dormant Kept tab shares everything — the same database, the same
 * conversations, the same identity — so it is one button away from being the live one,
 * and that button is the difference between a rule and a trap.
 */
let dormant = false;

/**
 * Say that the conversation is open elsewhere, and offer to move it here.
 *
 * ⚠️ THE SECOND SENTENCE IS THE IMPORTANT ONE. "It is open in another tab" is a true
 * statement that leaves a person hunting through ten tabs on a phone; the control is what
 * makes it an answer rather than an observation.
 *
 * ⚠️ THIS SCREEN IS NEVER REACHED CARRYING AN INVITATION (D-128). A document opened by
 * an invitation takes the identity over instead — see `withIdentity` — so there is no
 * second wording here, and no link stashed anywhere waiting to be spent twice.
 */
async function showDormant() {
  dormant = true;
  // ⚠️⚠️ D-168 — A DORMANT DOCUMENT STOPS BEING A WITNESS, and this is the one funnel every
  // path into dormancy goes through. Rule 1 says it writes nothing and touches `roster_id`
  // not at all, so its copy of the roster version stops being current the moment it gets
  // here; the difference it would find on waking is the OTHER TAB, which the panel below
  // has just named and offered a control for. `probe-elsewhere-tabs.mjs` measured it firing.
  if (session?.roster) session.roster.forgetBaseline();
  text("dormant-title", copy.tabs.dormantTitle);
  prose("dormant-body", copy.tabs.dormantBody);
  text("dormant-why", copy.tabs.dormantWhy);
  text("use-here", copy.tabs.useHere);
  only("dormant");
}

/**
 * The other tab asked to take over — §4.2.2 rule 2, receiving end.
 *
 * ⚠️ `standAside()` releases leadership, which reports through `onLeader(false)` and so
 * stops this tab's streams by the same path a steal does. Nothing is cleared and nothing
 * is ended: this document is stepping back, not leaving.
 */
async function becomeDormant() {
  if (!session || dormant) return;
  session.tabs.standAside();
  clearPairingSurface();
  await showDormant();
}

/**
 * "Use this tab instead" — §4.2.2 rule 2, sending end.
 *
 * ⚠️ THE OTHER TAB IS TOLD FIRST AND THE LOCK IS STOLEN SECOND, and the order is a
 * courtesy rather than a requirement: a tab that hears the notice stands down cleanly,
 * and a tab that is frozen and hears nothing is displaced by the steal anyway. Relying on
 * the notice alone is what would fail, because the commonest reason to press this button
 * is that the other tab has stopped running.
 */
async function useThisTab() {
  if (!session || !dormant) return;
  session.tabs.announce("takeover");
  session.tabs.wake();
  dormant = false;
  await openHome();
}

const isGhost = () => session?.mode === "ghost";

/**
 * §3.4.1c: where this identity remembers its own invite links.
 *
 * ⚠️⚠️ IT IS THE ROSTER AND NOT THIS BROWSER, WHICH IS THE WHOLE OF D-174. §3.4.1b's
 * in-flight record answers *"is this my own link?"* per BROWSER, and the question is
 * asked per PERSON — so the maker's own second device found no record, concluded it
 * was a joiner, claimed its owner's own offer, and left the friend the link had been
 * sent to tripping a real §3.5 alarm naming its own owner.
 *
 * ⚠️ `null` IN GHOST MODE, AND RULE 8 SAYS SO EXPLICITLY: §7.6 has no roster, so a
 * ghost client can perform none of §3.4.1c and must not report having recognised
 * anything. That mode keeps §3.5 exactly as written.
 */
const linksFor = () => (isGhost() ? null : (session?.roster ?? null));

/**
 * §3.4.1b rule 2: where a pairing in progress is kept, and it is the ONE thing in
 * this product that behaves differently in the two modes.
 *
 *   Kept   `vault.conversation` — IndexedDB, sealed under `local_key` (§7.2). The
 *          pairing survives the browser closing and resumes at the next unlock.
 *   Ghost  `undefined`, which `flow/pair.js` reads as `sessionStorage`. §7.6 writes
 *          nothing durable, so a Ghost pairing stays bound to its tab and does NOT
 *          resume — and rule 2 says the interface MUST NOT offer resumption there,
 *          because an offer that silently does nothing is worse than no feature.
 *
 * ⚠️ THE `conversation` STORE AND NOT `durable`. A pairing in progress is
 * conversation state: §7.8's ordinary ending MUST take it, and `durable` is the one
 * store an ending spares. A live link secret surviving on a device whose owner has
 * just asked for everything to be gone is the exact thing that store must not hold.
 *
 * ⚠️ `undefined` BEFORE UNLOCK IS DELIBERATE AND IS NOT A GAP. There is no
 * `local_key` until a phrase has been typed, so nothing can be sealed — and nothing
 * needs sealing, because no pairing can be started from the gate.
 */
// ⚠️⚠️ SCOPED, BECAUSE IN KEPT MODE THIS IS INDEXEDDB AND THE RECORD'S NAME WAS THE
// SAME FOR EVERY IDENTITY IN THE BROWSER (D-170) — see `flow/pair.js`'s `scopedStore`.
// Ghost is `undefined` here on purpose and always was: `flow/pair.js` then uses
// `sessionStorage`, which is per tab and so already one identity's.
const pairingStore = () =>
  session?.mode === "kept" ? flow.scopedStore(session.vault?.conversation, session.recordScope) : undefined;

// ---------------------------------------------------- ROADMAP step 9, between tabs

/**
 * Recompute which conversations this tab is delivering, and start or stop.
 *
 * The wanted set is this tab's own open conversation plus — if it leads — whatever
 * the other tabs have said they are displaying. A follower wants nothing: the
 * leader is filling the same store on its behalf.
 */
async function syncStreams() {
  if (!session) return;
  const wanted = new Map();
  if (session.tabs.isLeader) {
    if (watching && openEntry) wanted.set(watching, openEntry);
    for (const [, hash] of elsewhere) {
      if (!wanted.has(hash)) {
        const entry = entryForHash(hash);
        if (entry) wanted.set(hash, entry);
      }
    }
  }

  /*
    ⚠️ THE RULE FOR AWAITING A `stop()` — and this is the one site that does not have
    to. `live.stop()` became awaitable on 2026-08-24 because an in-flight drain writes
    the advanced ratchet and the decrypted message to storage AFTER the abort. That
    matters wherever the NEXT thing destroys what the drain would write to: §7.8's
    ending clears the store, and removing a conversation deletes its record — both
    await. Here nothing is destroyed. This tab has merely stopped displaying a
    conversation whose record stays exactly where it is, so a drain that lands a
    moment later lands correctly, and blocking the interface on it would be a pause
    the person can feel for no benefit.
  */
  for (const [hash, running] of streams) {
    if (wanted.has(hash)) continue;
    void running.live.stop();
    streams.delete(hash);
  }
  for (const [hash, entry] of wanted) {
    if (streams.has(hash)) continue;
    streams.set(hash, startDelivery(hash, entry));
  }
  showLiveState();
}

/** A channel object and its stream, for a conversation this tab is delivering. */
function startDelivery(hash, entry) {
  const flowChannel = openChannelFor(entry);
  const running = {
    channel: flowChannel,
    live: liveFlow.startLive(flowChannel, {
      onMessages: async (messages) => {
        const stored = await storeIncoming(hash, entry, messages);
        // ⚠️ D-168 — AND THE OTHER ONE. §7.3.1 rule 3 merges the generation by taking the
        // maximum, so a generation ACCEPTED from the peer is a roster write too — a device
        // that only reads still meets the other one here. Before the early return: a drain
        // that stored nothing may still have written the roster.
        renderWarnings();
        if (stored === 0) return;
        // The other tabs share this store and have just been given something to
        // read. They are not told WHAT — only which conversation moved.
        session.tabs.announce("messages", { channel: hash });
        if (hash === watching) {
          await renderLog(hash);
          // §6.7.1: one of those may have been the peer leaving, which changes
          // what this screen offers rather than what it lists.
          await showConversationState(entry);
        }
      },
      // ⚠️ §5.4.2's refusals, reported on the FIRST drain rather than the third. These
      // messages are not stored and not acknowledged, so the line is DRAWN and not
      // written: `renderLog` rebuilds from the store, which replaces this with the real
      // entry the moment there is one, and a reload shows nothing until a drain says so
      // again. That is the honest lifetime for a provisional statement.
      //
      // ⚠️⚠️ D-146 NARROWED WHAT REACHES HERE, AND THE PROVISIONAL LIFETIME IS WHY.
      // A stale-generation refusal is now staged on the first drain instead of being
      // counted to three, so it arrives through the STORE and `renderLog` keeps it.
      // It used to come through here — drawn, then wiped by the next `renderLog`
      // (which calls `replaceChildren` and clears `refusedShown`), and finally
      // written for real two drains later, by which time the person had sent a
      // message and the line landed underneath it. What is left here is
      // `UNDECRYPTABLE` inside its three-strike window, which is the one class that
      // genuinely may still resolve and so must not be written yet.
      onRefused: (list) => {
        if (hash !== watching) return;
        for (const r of list) {
          if (refusedShown.has(r.msgId)) continue;
          refusedShown.add(r.msgId);
          line(unreadable(r), "bad");
        }
      },
      onState: ({ state, failure }) => {
        if (hash === watching) showLiveState(state);
        // ⚠️⚠️ D-152 — THIS PRINTED `failure.message` AND THAT WAS A SECOND SENTENCE.
        // The same failure on the unlock and list screens went through
        // `describeIdentity` and came back capitalised, with the advice; here it was
        // the raw text, lowercase, and it never told the person what to do. Both
        // screens now say the one sentence, which is what Hannu ruled (D-152).
        if (failure?.reason === "clock_skew" && hash === watching) {
          line(copy.roster.failure.clock_skew(failure.skew), "bad");
        }
      },
    }),
  };
  return running;
}

/** What another tab said, or what this tab needs to say back. */
async function heard(message) {
  if (!session) return;
  if (message.id === TAB_ID) return;

  // ⚠️ A DUPLICATED GHOST TAB LISTENS AND ACTS ON NOTHING BUT THE ENDING. It shares
  // no store with the document that is talking, so every notice below — "re-read
  // what moved", "the roster changed" — names a record it cannot see. `onEnd` is
  // handled elsewhere, and it is the one message that means something here.
  if (ghostInert) return;

  // ⚠️ A DORMANT DOCUMENT ACTS ON NOTHING — ARCHITECTURE §4.2.2. Every notice below asks
  // this tab to re-read a conversation, adjust what it is delivering, or follow an
  // invitation, and a document that has declined to be a client must do none of those.
  // It is here rather than inside each branch so that a notice added later cannot quietly
  // wake it. (A `takeover` is never seen here: it is sent BY a dormant tab, and
  // `BroadcastChannel` does not deliver to its own sender.)
  if (dormant) return;

  if (message.kind === "takeover") {
    // §4.2.2 rule 2: another tab of this identity is taking over. Step back.
    await becomeDormant();
    return;
  }
  // ⛔ THERE IS NO "invite" NOTICE AND THERE MUST NOT BE ONE AGAIN (D-128). §4.2.2
  // rule 3 used to hand an arriving invitation to this document while the tab that
  // received it kept a copy against the chance that this one was frozen. Both then
  // held a link that works exactly once. Whichever consumed it first, the other's
  // attempt failed — and the failure landed on the tab the person was looking at.
  // An invitation now takes over the tab it arrived in and is never passed anywhere.

  if (message.kind === "watch") {
    if (message.channel) elsewhere.set(message.id, message.channel);
    else elsewhere.delete(message.id);
    if (session.tabs.isLeader) await syncStreams();
    return;
  }
  if (message.kind === "roll-call") {
    session.tabs.announce("watch", { id: TAB_ID, channel: watching });
    return;
  }
  if (message.kind === "messages") {
    // ⚠️ RE-READ, DO NOT TRUST THE NOTICE. It carries no message and no count —
    // only the name of a conversation that moved. What is on screen comes from the
    // store, which is the only thing either tab has actually agreed on.
    if (message.channel === watching) {
      await renderLog(watching);
      if (openEntry) await showConversationState(openEntry);
    }
    return;
  }
  if (message.kind === "gone") {
    // ⚠️ A DELETION HAS TO REACH THE DELIVERY BEFORE IT REACHES THE LIST. A stream
    // still running against a channel whose record was just deleted drains, finds
    // no session, and writes a fresh one — putting back the conversation another
    // tab has just told the user is gone.
    // ⚠️ AWAITED, and the paragraph above is the reason. A `stop()` that only asked
    // the drain to stop left exactly the race it describes — the drain was already
    // past its abort checks and wrote the record back.
    await streams.get(message.channel)?.live.stop();
    streams.delete(message.channel);
    seen.delete(message.channel);
    for (const [id, hash] of elsewhere) if (hash === message.channel) elsewhere.delete(id);
    if (watching === message.channel) {
      await session.roster.load();
      await openHome();
    }
    return;
  }
  if (message.kind === "roster") {
    // Another tab added, renamed or deleted a conversation. The roster this tab
    // holds is now a copy of something older, so it is re-read from the cache the
    // other tab wrote — §7.3.3 permits the local read; nothing touches the server.
    await session.roster.load();
    if (!$("home").classList.contains("hidden")) await openHome();
  }
}

/**
 * This tab won the election — take over the connections.
 *
 * ⚠️ THE GRANT CAN ARRIVE BEFORE THERE IS A SESSION TO LEAD. `openTabs` requests
 * the lock inside `withIdentity`, and on the first tab of a browser it is granted
 * immediately — a microtask before `session` is assigned. Returning quietly there
 * would leave a leader that never asked anybody what to watch, so it is deferred
 * rather than dropped.
 */
let leaderDeferred = false;
async function becameLeader() {
  if (!session) {
    leaderDeferred = true;
    return;
  }
  // ⭐ §7.6, AND THIS IS WHERE A DUPLICATED GHOST TAB STOPS BEING ONE. It stood
  // down because another document held the writer lock; holding that lock now means
  // the other document is gone, so this tab is no longer a copy of anything running
  // — it is the only copy left, and staying inert would throw away the conversation
  // it stood aside to protect. This is also what makes reloading the ORIGINAL tab
  // safe: the reload releases the lock, the duplicate takes it, and exactly one
  // document is writing at every instant in between.
  if (isGhost() && ghostInert) {
    await continueGhost();
    return;
  }
  // Whatever `elsewhere` holds came from the previous leader's lifetime and may
  // name tabs that are gone. Asking again is cheaper than expiring entries, and it
  // is correct when a tab crashed rather than closed.
  elsewhere.clear();
  session.tabs.announce("roll-call", { id: TAB_ID });
  await syncStreams();
}

/**
 * Another tab took leadership — ARCHITECTURE §4.2.1, D-126.
 *
 * ⚠️⚠️ THIS HANDLER IS NEW, AND ITS ABSENCE WAS NOT A GAP BEFORE. Leadership used to be
 * one-way: a tab either never got it or held it until its document died, so `onLeader` was
 * only ever called with `true` and the app never had to stop. Now a visible tab steals it,
 * so a document that WAS delivering has to let go — and `syncStreams` already does exactly
 * the right thing, because a follower's wanted set is empty by construction.
 *
 * ⚠️ It may run long after the steal. The tab this fires in is typically the one a phone
 * froze, so "when it next runs" is when the person switches back to it — by which time the
 * tab that took leadership has been delivering into the same store for a while. Nothing
 * here needs to hurry, and nothing here may assume the steal was recent.
 */
async function stoodDown() {
  if (!session) return;
  await syncStreams();
  showLiveState();
}

/** Tell the others what this tab is displaying, and re-point the streams. */
async function watch(hash) {
  watching = hash;
  session?.tabs.announce("watch", { id: TAB_ID, channel: hash });
  await syncStreams();
}

/**
 * Stop everything this document is doing with this identity, and forget it.
 *
 * ⚠️⚠️ IT IS §7.8's STEP 1 — "stop the things that write" — AND IT HAS TO BE
 * AWAITABLE, because step 3 clears the database these streams write into. See
 * `flow/ending.js` for why that ordering is not the one §7.8 printed.
 *
 * Returns the session it took down, so a caller that needs the keys (to overwrite
 * them) or the vault (to clear it) still has them after this point.
 */
async function stopEverything() {
  lockWatch?.stop();
  lockWatch = null;

  /*
    ⚠️⚠️ THE `await` IS THE FUNCTION, AND ITS ABSENCE WAS A DEFECT THIS COMMENT
    ALREADY DESCRIBED. The header above has said "it has to be awaitable, because
    step 3 clears the database these streams write into" since it was written — and
    the loop below called `stop()` without awaiting it, against a `stop()` that only
    called `abort()` and returned. So the function was `async`, awaited everywhere it
    was called, and awaited nothing: an in-flight drain went on decrypting and
    writing while §7.8 step 3 emptied the store underneath it, and the conversation
    the person had just ended came back at the next unlock. Found by the 2026-08-24
    outside review; `flow/live.js`'s `stop()` is the other half of the fix.

    ⭐ ALL OF THEM AT ONCE, NOT ONE AFTER ANOTHER. Each `stop()` aborts first and
    waits second, so the waits overlap; ending a person with eight open conversations
    should take as long as the slowest drain, not the sum of eight.
  */
  await Promise.all([...streams.values()].map((running) => running.live.stop()));
  streams.clear();
  elsewhere.clear();
  watching = null;
  openEntry = null;
  channel = null;
  seen.clear();

  /**
   * ⚠️⚠️ §7.8 STEP 2 IS *"DROP EVERY REFERENCE"*, AND THIS WAS A LIST OF SIX WITH A
   * SEVENTH MISSING (D-165, outside review slice C #3). `hashed` holds one roster entry
   * per conversation and every one of them carries its channel root — so a LOCK, which
   * keeps this document alive, overwrote the derived key set and left `R` for every
   * channel sitting in the heap behind the enter screen. `paired` is worse in kind: it
   * holds `rootBytes`, the raw bytes, for a channel whose digits were never answered.
   *
   * ⭐ THE ENDING WAS NEVER THE PATH THAT MATTERED. It calls `location.replace`, and a
   * new document takes the whole heap with it. The lock is the one that stays — and
   * D-163 has just given it a button, so it went from a thirty-minute timer to
   * something a person reaches on purpose.
   *
   * ⚠️ Nothing here can be overwritten the way `endings.overwriteKeys` overwrites a
   * key: `entry.root` is a base64 STRING and strings are immutable in JavaScript.
   * Dropping the reference is the whole of what is available, which is why §7.8 step 2
   * asks for exactly that and not for a wipe.
   */
  hashed.clear();
  paired = null;
  revisiting = null;

  const stopped = session;
  session = null;
  $("log").replaceChildren();
  $("channels").replaceChildren();
  $("notices").replaceChildren();
  // ⚠️ D-169: the panels are gone from the screen, so they must be gone from the map
  // too — a builder left behind here would be re-run by the next language switch and
  // put a panel from an ended session back on a screen that has no session.
  liveNotices.clear();
  return stopped;
}

/**
 * §7.8, all six steps, for the tab the person pressed the control in.
 *
 * ⚠️ THE WORDING IS CHOSEN FROM WHAT THE CENSUS RETURNED, never from the fact that
 * the button was pressed (D-067). `flow/ending.js` returns the outcome and the
 * fragment carries it to the ending page — which is the only place it can go, since
 * step 3 has just cleared every store that could have held it.
 */
async function endHere({ thorough = false } = {}) {
  const going = session;
  if (!going) return;
  const outcome = await endings.endSession({
    client: going.tabs,
    keys: keysOf(going),
    thorough,
    mode: going.mode,
    stopDelivery: async () => {
      await stopEverything();
    },
    prepareStorage: () => planFor(going, { thorough }),
    clearStorage: (prepared) => clearFor(going, { thorough, prepared }),
    // §7.8.1's wording follows the census, and `flow/ending.js` puts the answer in
    // the fragment for the ending page to read. Nothing to compute here.
    navigate: (to) => location.replace(to),
  });
  return outcome;
}

/**
 * The same ending, asked for by another tab (§7.8 step 3, receiving end).
 *
 * ⚠️ NO BROADCAST AND NO WAIT. Re-broadcasting would be an echo every tab answers;
 * waiting would be this tab counting itself. What the asking tab needs from this
 * one is not a message but its ABSENCE, which `tabs.close()` and the navigation
 * produce.
 *
 * ⭐ IN GHOST MODE THE BROADCAST IS NOT A COURTESY, IT IS THE ONLY ROUTE THERE IS.
 * A Kept-mode ending clears one IndexedDB and every other tab of that identity is
 * looking at the same one, so the other tabs are told mainly to stop WRITING. A
 * duplicated Ghost tab holds an independent copy of `sessionStorage` that no other
 * document can reach — so this handler is the single thing that can remove it, and
 * where `BroadcastChannel` is missing there is nothing that can. §7.8.1's
 * unconfirmed wording covers the case; what differs is the consequence, and the
 * copy says it.
 */
async function endBecauseAnotherTabDid() {
  const going = session;
  if (!going) return;
  await endings.endSession({
    client: null,
    keys: keysOf(going),
    mode: going.mode,
    stopDelivery: async () => {
      await stopEverything();
    },
    prepareStorage: () => planFor(going, { thorough: false }),
    clearStorage: (prepared) => clearFor(going, { thorough: false, prepared }),
    navigate: (to) => location.replace(to),
  });
}

/**
 * §7.8 step 3, for whichever mode this session is.
 *
 * ⚠️ GHOST MODE'S CLEAR IS ALREADY DONE BY THE TIME THIS RUNS, and that is not a
 * shortcut — `flow/ending.js` clears `sessionStorage` first "(§7.6 — Ghost mode has
 * nothing else)" as step 3's own first act. What is left here is releasing the
 * census lock, which is what tells an ending tab that this document is gone, and
 * NOT opening or closing a database that was deliberately never opened.
 */
/**
 * §7.8 step 2a's half of the ending: the deletion plan, built while `local_key` is
 * still live (D-162).
 *
 * ⚠️ Ghost mode has no `local_key` and nothing sealed to select, and the THOROUGH
 * ending empties whole object stores rather than choosing rows — so both correctly
 * plan nothing. Only the ordinary Kept ending needs the key, and it is the only one
 * that was silently deleting nothing without this.
 */
async function planFor(going, { thorough }) {
  if (going.mode === "ghost" || thorough) return null;
  return going.vault.planEnding();
}

async function clearFor(going, { thorough, prepared = null }) {
  if (going.mode === "ghost") {
    going.tabs.close();
    return;
  }
  // §7.8 step 3's two forms. The ordinary ending leaves §7.3.2's high-water mark;
  // the thorough one takes it, and its control said so.
  //
  // ⚠️ D-139's theme preference goes with the THOROUGH one and not with the ordinary
  // one, and the two endings are what decide it rather than any property of the
  // preference itself. The ordinary ending is a sign-out: it deliberately leaves the
  // high-water mark behind, so leaving an interface preference beside it is the same
  // promise, and taking it would mean somebody who signs out and back in on their own
  // machine finds the colours changed. The thorough ending's own control says it is
  // taking the whole origin — this is part of the origin.
  if (thorough) {
    await going.vault.clearEverything();
    themes.forget();
    // D-154's language preference goes with the theme, for the same reason and
    // with the same two-endings split. ⚠️ It is a durable mark saying *this browser
    // has used haamu* rather than a secret, and the thorough ending's own control
    // promises to take the whole origin.
    langs.forget();
  } else await going.vault.endSession(prepared);
  going.tabs.close(); // releases the census lock — this document is done
  going.db.close();
}

/**
 * The buffers §7.8 step 2 can reach in this mode.
 *
 * ⚠️ GHOST MODE HAS FEWER OF THEM AND IT IS WORTH BEING EXACT ABOUT WHICH. There is
 * no `K_master` and none of §7.2's five derived values; what exists is the pickle
 * key `flow/ghost.js` generated and the channel root, both `Uint8Array`s that
 * `fill(0)` really writes to. The Olm session objects live in the WASM heap and no
 * page can zero those, in either mode — §7.7 forbids claiming otherwise.
 */
const keysOf = (s) => (s.mode === "ghost" ? s.ghost.keys(s.root) : s.keys);

/**
 * §4.3's idle lock.
 *
 * ⚠️⚠️ WHAT IS DROPPED IS THE DERIVED SET, NOT `K_master` (D-070). §4.3 says
 * dropping `K_master` is what makes a locked session unresumable, and it is not:
 * §7.2 makes `K_master` a derivation INPUT, and `flow/roster.js` overwrites it with
 * zeros the moment the five values below exist — at unlock, long before any lock.
 * Those five open the roster, every channel root, every session pickle and the
 * whole local history, and none of them needs `K_master` again.
 */
async function lockNow(reason) {
  // ⚠️⚠️ §4.3 HAS NO UNLOCK INPUT IN GHOST MODE, AND OBEYING IT THERE WOULD BE A
  // SILENT ENDING ON A TIMER (0.8.14, D-073). The section says a lock drops the
  // keys and that unlocking "requires the PRF touch, or the passphrase where PRF is
  // unavailable" — §7.6's first sentence removes both. Dropping the keys here would
  // destroy a conversation that has no phrase, no list and no server copy to come
  // back from, ten idle minutes after the person last touched it: D-016's failure
  // arriving by a fourth route, this time caused by the client itself.
  if (isGhost()) return coverNow(reason);

  const locked = await stopEverything();
  if (!locked) return;
  coveredFrom = null; // §4.3's cover is gone with the session it was over
  endings.overwriteKeys(locked.keys);
  locked.tabs.close(); // a locked tab must not hold the connections for the others
  locked.db.close();
  $("phrase-in").value = "";
  text("enter-note", lockSaid(reason));
  only("enter");
}

/**
 * Which sentence the lock screen carries, by the reason it locked.
 *
 * ⚠️⚠️ IT WAS A TERNARY, AND A TERNARY OVER TWO VALUES IS AN EXHAUSTIVE MATCH THAT STOPS
 * BEING ONE WITHOUT CHANGING. `reason === BLURRED ? blurred : idle` was correct for as
 * long as there were exactly two reasons; D-163's third would have inherited the `else`
 * and told somebody who pressed a button one second earlier that they had been idle for
 * 30 minutes. ➡️ **A default is a promise about a set that nobody re-reads when the set
 * grows.** `test/ending.mjs` now asserts every exported reason has its own sentence.
 *
 * ⚠️ BUILT AT CALL TIME, NOT AT MODULE LOAD. `setLanguage` overwrites the strings inside
 * `copy.js` in place (D-154), so a lookup captured at import would be frozen in English
 * for the whole life of the document.
 */
function lockSaid(reason) {
  return {
    [lockFlow.IDLE]: copy.lock.idle,
    [lockFlow.BLURRED]: copy.lock.blurred,
    [lockFlow.MANUAL]: copy.lock.manual,
    [lockFlow.WRONG_PIN]: copy.lock.wrongPin,
  }[reason];
}

/**
 * §4.3's intent in the mode that cannot have its mechanism: a COVER, not a lock.
 *
 * ⚠️ IT DROPS NOTHING AND THE COPY SAYS SO. A Kept lock is worth something because
 * lifting it costs an Argon2id derivation from a phrase the person alone has; this
 * costs a click, so it defends against a glance at a screen and not against
 * somebody holding the device — which is a materially weaker property than §4.3's,
 * and calling both of them "locked" is exactly the kind of sentence §7.6 says has
 * to be exact. The control the user actually wants when the device is out of their
 * hands sits next to it, and it is the ending.
 */
function coverNow(reason) {
  pinWrong = 0;
  pinSlowUntil = 0;
  // ⚠️ WHERE TO GO BACK TO, CAPTURED BEFORE THE COVER REPLACES IT. A cover tears nothing
  // down, so the screen underneath is still built and `only()` alone restores it — but
  // only if this remembers which one it was. Guarded against covering a cover, which
  // would otherwise make the way back the way here.
  if (shownScreen !== "covered") coveredFrom = shownScreen;
  const ghost = isGhost();
  text("covered-why", coverSaid(reason));
  text("covered-ask", copy.pin.coverAsk);
  text("covered-note", "");
  prose("covered-what", ghost ? copy.lock.coveredWhat : copy.lock.coveredWhatKept);
  text("uncover", copy.lock.show);
  text("covered-key", copy.lock.useKey);
  text("covered-end", copy.ghost.end);
  // ⚠️⚠️ EXACTLY ONE WAY OUT OF A FORGOTTEN PIN IS SHOWN, AND WHICH ONE IS THE WHOLE
  // DIFFERENCE BETWEEN THE MODES. Kept mode falls back to the KEY, which costs a
  // derivation and loses nothing. Ghost mode has no KEY — §7.6's first sentence — so the
  // only honest offer there is §7.8's ending, and offering the KEY would be a button
  // that cannot work.
  show("covered-key", !ghost);
  show("covered-end", ghost);
  paintPinBoxes("covered-boxes", session?.pinRecord?.len ?? pinFlow.PIN_MIN);
  only("covered");
}

/**
 * Which sentence the cover screen carries, by the reason it was raised.
 *
 * ⚠️ IT IS A MAP RATHER THAN A TERNARY, AND THIS IS THE SECOND TIME. D-163 records what
 * a ternary over two values costs when a third arrives: `reason === BLURRED ? blurred :
 * idle` was an exhaustive match right up to the moment it silently stopped being one.
 * `coverNow` carried exactly that ternary until this tier was built.
 *
 * ⚠️ A REASON WITH NO SENTENCE PAINTS NOTHING RATHER THAN THE WRONG THING, which is the
 * failure this shape is chosen for: an empty heading is visible and a confident wrong
 * sentence is not.
 */
function coverSaid(reason) {
  return (
    {
      [lockFlow.IDLE]: copy.lock.coveredIdle,
      [lockFlow.BLURRED]: copy.lock.coveredBlurred,
    }[reason] ?? ""
  );
}

// -------------------------------------------- §4.3's second tier — the cover PIN

/**
 * Where the record lives in Kept mode.
 *
 * ⚠️ NAMED FOR THE IDENTITY AND NOT FOR THE BROWSER (D-170). One browser is one
 * database and two KEYs can share it; a record named for the browser is a record two
 * identities write over each other. `recordScope` is already the digest every other
 * per-identity record here is named with.
 *
 * ⚠️ IT GOES IN `DURABLE`, WHICH §7.8's ORDINARY ENDING DOES NOT REACH. That is
 * deliberate and it is the same reasoning as the high-water mark next to it: the
 * ordinary ending removes the conversations and leaves the person using this browser,
 * and a PIN is a fact about the person rather than about the conversations. The THOROUGH
 * ending takes the whole origin, and takes this with it.
 */
const pinRecordName = (scope) => `lpm.pin.${scope}`;

async function readPinRecord() {
  if (!session) return null;
  if (isGhost()) return (await session.ghost.store.get(ghostFlow.PIN_KEY)) ?? null;
  // ⚠️ `attempt` RATHER THAN `get`, AND THE THIRD ANSWER IS WHY (D-170). A record that
  // will not open is another identity's or is damaged, and reading either as "no PIN
  // yet" would silently offer to overwrite it. Only `ours` counts as a PIN.
  const got = await session.vault.durable.attempt(pinRecordName(session.recordScope));
  return got.ours ? got.value : null;
}

async function writePinRecord(rec) {
  if (isGhost()) await session.ghost.store.set(ghostFlow.PIN_KEY, rec);
  else await session.vault.durable.set(pinRecordName(session.recordScope), rec);
  session.pinRecord = rec;
}

/**
 * §4.3's PIN field — the "B2" shape Hannu measured against four password managers on
 * 2026-07-09 for seku/privis, and asked for here by name.
 *
 * ⚠️⚠️ `type="password"` IS THE MEASUREMENT AND NOT A PREFERENCE. The CSS-only variant
 * tested alongside it showed plaintext in Firefox; this one masks natively everywhere.
 * ⚠️ No `<form>`, no `name`, `autocomplete="off"` — the three things a manager looks for
 * before offering to remember something. `#phrase-in` has had all three by accident for
 * the life of the product, which is why the eight words have never been offered to one.
 *
 * ⚠️ THE PASTE IS ITS OWN HANDLER AND HAS TO BE. `maxLength = 1` truncates a pasted
 * string to its first character before any `input` event sees it, so a paste-to-
 * distribute written on top of `input` silently keeps one digit.
 */
function paintPinBoxes(id, count) {
  const row = $(id);
  row.replaceChildren();
  row.setAttribute("aria-label", copy.pin.boxes);
  for (let i = 0; i < count; i++) {
    const box = document.createElement("input");
    box.className = "pinbox";
    box.type = "password";
    box.inputMode = "numeric";
    box.autocomplete = "off";
    box.maxLength = 1;
    box.setAttribute("aria-label", copy.pin.digit(i + 1, count));
    box.addEventListener("input", () => {
      const kept = pinFlow.digitsOnly(box.value).slice(-1);
      box.value = kept;
      if (kept) focusPinBox(row, i + 1);
    });
    box.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && box.value === "") focusPinBox(row, i - 1);
      else if (event.key === "ArrowLeft") focusPinBox(row, i - 1);
      else if (event.key === "ArrowRight") focusPinBox(row, i + 1);
      else return;
      if (event.key !== "Backspace") event.preventDefault();
    });
    box.addEventListener("paste", (event) => {
      const digits = pinFlow.digitsOnly(event.clipboardData?.getData("text") ?? "");
      if (!digits) return;
      event.preventDefault();
      const boxes = [...row.children];
      for (let j = 0; j < digits.length && i + j < boxes.length; j++) boxes[i + j].value = digits[j];
      focusPinBox(row, Math.min(i + digits.length, boxes.length - 1));
    });
    row.appendChild(box);
  }
}

function focusPinBox(row, i) {
  const boxes = [...row.children];
  if (i < 0 || i >= boxes.length) return;
  boxes[i].focus();
  boxes[i].select?.();
}

const readPinBoxes = (id) => [...$(id).children].map((box) => box.value).join("");

function clearPinBoxes(id) {
  for (const box of $(id).children) box.value = "";
}

/**
 * Choose a PIN, or change one.
 *
 * ⚠️⚠️ THERE IS NO WAY PAST IT THE FIRST TIME, AND THAT IS HANNU'S DECISION RATHER THAN
 * a default: *"Everybody must set one."* Two gentler shapes were offered — off until
 * turned on, and offered once with a skip — and he chose the one that guarantees the
 * defence exists. ⚠️ The cancel control therefore appears only when there is already a
 * PIN to fall back to, which is what makes it a CHANGE rather than an escape.
 */
async function showPinSet(after = null) {
  pinAfter = after;
  text("pin-set-title", copy.pin.title);
  text("pin-set-lead", copy.pin.lead);
  text("pin-set-ask", copy.pin.ask);
  text("pin-set-confirm-ask", copy.pin.confirmAsk);
  text("pin-set-note", "");
  text("pin-set-go", copy.pin.save);
  text("pin-set-cancel", copy.nav.cancel);
  text("pin-set-what", copy.pin.what);
  text("pin-set-warn", copy.pin.warn);
  paintPinBoxes("pin-set-boxes", pinFlow.PIN_MAX);
  paintPinBoxes("pin-set-confirm", pinFlow.PIN_MAX);
  show("pin-set-cancel", Boolean(session?.pinRecord));
  only("pin-set");
}

/**
 * ⚠️ THE LENGTH IS STORED BESIDE THE HASH, AND IT IS FOR DRAWING RATHER THAN FOR
 * CHECKING. `matches` compares hashes and never consults it. What it buys is a cover
 * screen with the right number of boxes on it, so a person is not left counting empty
 * ones — and what it costs is that somebody holding the device learns the length, which
 * against five attempts is worth nothing.
 */
async function savePin() {
  const chosen = readPinBoxes("pin-set-boxes");
  const again = readPinBoxes("pin-set-confirm");
  const why = pinFlow.validate(chosen);
  if (why) {
    refused("pin-set-note", copy.pin.refused[why]);
    return;
  }
  if (chosen !== again) {
    refused("pin-set-note", copy.pin.refused.mismatch);
    clearPinBoxes("pin-set-confirm");
    return;
  }
  const record = await pinFlow.record(chosen);
  record.len = chosen.length;
  await writePinRecord(record);
  clearPinBoxes("pin-set-boxes");
  clearPinBoxes("pin-set-confirm");
  const next = pinAfter;
  pinAfter = null;
  // ⚠️ `backToStart` RATHER THAN `openHome` AS THE FALLBACK, because this screen is
  // reached in both modes and Ghost mode has no list to go back to.
  if (next) await next();
  else await backToStart();
}

/**
 * The PIN typed at the cover.
 *
 * ⚠️⚠️ THE TWO MODES END DIFFERENTLY AND ONE OF THEM MUST NOT ESCALATE. Kept mode's
 * fifth wrong entry drops the derived keys — strictly stronger, and the owner types the
 * eight words. Ghost mode has nothing to escalate to: no phrase, no roster, no server
 * copy, so an escalation there would destroy a conversation on five guesses by whoever
 * picked the phone up. It slows down and never gives up, and §7.8's ending stays on the
 * screen as the deliberate way out.
 */
async function liftCover() {
  if (pinSlowUntil && Date.now() < pinSlowUntil) {
    refused("covered-note", copy.pin.slow);
    return;
  }
  const typed = readPinBoxes("covered-boxes");
  if (await pinFlow.matches(session?.pinRecord ?? null, typed)) {
    clearPinBoxes("covered-boxes");
    text("covered-note", "");
    pinWrong = 0;
    lockWatch?.uncovered();
    // ⭐ BACK TO THE SCREEN THAT WAS COVERED, NOT TO THE START. Nothing was torn down, so
    // a conversation that was open is still built, still connected and still correct —
    // and landing somebody on the list after they typed their PIN would make the cover
    // feel like a lock, which is the one impression this tier may not give.
    if (coveredFrom === "chat" && openEntry) only("chat");
    else await backToStart();
    coveredFrom = null;
    return;
  }

  pinWrong += 1;
  clearPinBoxes("covered-boxes");
  focusPinBox($("covered-boxes"), 0);

  if (isGhost()) {
    if (pinWrong >= pinFlow.WRONG_BEFORE_LOCK) {
      pinSlowUntil = Date.now() + pinFlow.SLOW_MS;
      refused("covered-note", copy.pin.slow);
      return;
    }
    refused("covered-note", copy.pin.wrong);
    return;
  }

  const left = pinFlow.WRONG_BEFORE_LOCK - pinWrong;
  if (left <= 0) {
    await lockNow(lockFlow.WRONG_PIN);
    return;
  }
  refused("covered-note", copy.pin.wrongLeft(left));
}

/**
 * The short window came due.
 *
 * ⚠️⚠️ A COVER WITH NO PIN BEHIND IT WOULD BE A LOCKOUT WITH NO WAY OUT, so a session
 * that has somehow reached this without a record takes the stronger answer instead of a
 * gate it cannot open. It should be unreachable — the PIN is chosen before either
 * watcher is armed — and it is written down because "should be unreachable" is not a
 * property this file can prove about a screen.
 */
function coverDue(reason) {
  if (session?.pinRecord) {
    coverNow(reason);
    return;
  }
  if (!isGhost()) void lockNow(reason);
}

/** Stop, drop the keys, and say why. Not an ending — nothing is cleared. */
async function haltWith(message) {
  const halted = await stopEverything();
  if (halted) {
    endings.overwriteKeys(halted.keys);
    halted.tabs.close();
  }
  only("failure");
  text("failmsg", message);
  text("failcode", "");
  text("fail-back", copy.nav.toStart);
}

// -------------------------------------------------- §7.3.1a the panic action

/**
 * Delete every conversation on every device.
 *
 * ⚠️⚠️ IT DERIVES FROM THE TYPED PHRASE AND USES NOTHING ELSE, which is what makes
 * one code path serve both places §7.3.1a needs it: a device in the middle of a
 * session, where the retype is the confirmation the section demands, and a browser
 * that has never been used, where typing it is the only way in. **The scenario the
 * action exists for is a device that is gone**, so the second is the one that
 * matters, and a version of this that read an open session would not have it.
 *
 * ⚠️ IT FETCHES OVER THE NETWORK RATHER THAN USING A CACHE. §7.3.3 case 1 permits
 * it, and it is required rather than convenient: the wipe writes a tombstone for
 * every channel it can SEE, so writing from a stale local copy would leave behind
 * exactly the conversations this device did not know about.
 */
async function runPanicWipe(phrase) {
  const keys = await rosterFlow.identity(phrase);
  const roster = rosterFlow.openRoster({
    api,
    keys,
    // A throwaway pair of stores. This flow must work on a browser with nothing in
    // it, and must not write a cached roster to one it is about to tell to forget.
    storage: memoryStore(),
    durable: memoryStore(),
  });
  await roster.load({ network: true, reason: rosterFlow.SETUP });
  // ⚠️ READ BEFORE THE PURGE EMPTIES IT. `purgeEverything` replaces `channels`
  // with tombstones, and a tombstone is a hash of a root, not a root — after it
  // there is nothing left to send anything on.
  const doomed = roster.channels();
  await roster.purgeEverything();
  const told = await tellThemAll(doomed);
  endings.overwriteKeys(keys);
  return { told, of: doomed.length };
}

/**
 * §6.7.1's closing notice, for every conversation §7.3.1a has just deleted.
 *
 * ⚠️⚠️ THE ORDER IS THE OPPOSITE OF THE SINGLE DELETION'S, AND DELIBERATELY. There,
 * §6.7.1 rule 1 sends first because the ending destroys the ratchet the notice
 * needs. Here the ratchet is not the constraint — the roots came from the roster —
 * and the constraint is that **the wipe is a race with whoever has the lost
 * device**. Sending first would put dozens of round trips in front of the one write
 * that matters. So: purge, then tell. Nothing here can undo the purge.
 *
 * ⚠️ EVERY SEND IS INDEPENDENT AND NONE OF THEM MAY THROW. Losing the notice for
 * one conversation must not cost the notice for the next, and a network that has
 * gone away must not turn a completed wipe into a failure on screen.
 *
 * ⭐ IT WORKS ON A BROWSER THAT HAS NEVER HELD THESE CONVERSATIONS, which is the
 * scenario §7.3.1a exists for, and two lines make it work: the backend is a
 * throwaway Map, and `generation` comes from the ROSTER ENTRY.
 *
 * ⚠️⚠️ THE SECOND OF THOSE WAS MEASURED, AND THE FIRST ATTEMPT TO MEASURE IT SAID IT
 * DID NOT MATTER. Hardcoding `generation: 0` here left every assertion passing,
 * because §6.3's "(highest ever accepted) + 1" from an empty record is 1 — and an
 * identity that has never migrated is already at 1, so the floor changed nothing.
 * **The claim was true and untested, which is a guess.** It bites from the second
 * device onwards: with the identity opened on two browsers the peer sits at 2, a
 * panic browser starting from zero sends at 1, and §6.3 rule 1 refuses it as
 * `stale_generation` — while the wipe still reports the notice as sent, because it
 * was. Built, encrypted, accepted by the server, and discarded by the only person
 * it was for. `browser-feedback17.mjs` now migrates the identity before it wipes,
 * precisely so that sabotaging this line has something to break.
 */
async function tellThemAll(entries) {
  if (entries.length === 0) return 0;
  const backend = store.memoryBackend();
  const pickleKey = store.randomPickleKey();
  let told = 0;
  for (const entry of entries) {
    try {
      await messageFlow.sendClosing(
        messageFlow.openChannel({
          api,
          backend,
          // A throwaway `memoryBackend()` that dies with this call, so nothing is
          // addressed by this name — but `openChannel` refuses an absent scope on
          // purpose, and answering it honestly costs one line.
          scope: scopeOfRecords(),
          pickleKey,
          channelRoot: rootBytesOf(entry),
          role: entry.role,
          generation: entry.generation ?? 0,
          // The roster this would have been written back to no longer has this
          // channel, and nothing will ever send on it again.
          onGeneration: async () => {},
        })
      );
      told++;
    } catch {
      // Best effort, by design. The conversation is deleted either way, and the
      // count is what the copy reports — never "delivered".
    }
  }
  return told;
}

/** A store that satisfies the interface and keeps nothing. */
function memoryStore() {
  const m = new Map();
  return {
    async get(k) {
      return m.has(k) ? m.get(k) : null;
    },
    async set(k, v) {
      m.set(k, v);
    },
    async delete(k) {
      m.delete(k);
    },
  };
}

const entryForHash = (hash) => hashed.get(hash) ?? null;
const hashed = new Map(); // channelHash → the roster entry, filled by openHome()

/**
 * The leader re-asks who is watching what.
 *
 * ⚠️ ASKING BEATS REMEMBERING, because the case that matters is a tab that CRASHED
 * rather than closed — it sent no farewell, and an entry kept on its behalf is a
 * connection held open for a document that no longer exists. A tab that is still
 * there answers; one that is not, does not, and drops out of the set by itself.
 */
setInterval(() => {
  if (!session?.tabs.isLeader) return;
  elsewhere.clear();
  session.tabs.announce("roll-call", { id: TAB_ID });
  // ⚠️ The replies come back as `watch` notices, each of which re-syncs — but a
  // tab that is GONE sends nothing, so its stream would linger until some other
  // tab happened to speak. This is the collection window: same-process
  // `postMessage`, so it is generous rather than tuned.
  setTimeout(() => void syncStreams(), 250);
}, ROLL_CALL_MS);

/**
 * A follower re-reads what it is displaying, in case a notice was dropped.
 *
 * ⚠️ IT IS A CHEAP TICK AND NOT A POLL — it touches this device's own store and
 * never the server. The leader's drain is what fetches; §9.2's budget is untouched
 * by a second tab. What this closes is the only thing a lost `BroadcastChannel`
 * message can cost: a screen that is behind the disk it is drawn from.
 */
setInterval(() => {
  if (!session || !watching || streams.has(watching)) return;
  void renderLog(watching);
}, RESYNC_MS);

/**
 * Anything `flow/roster.js` raised, as a sentence somebody can read.
 *
 * ⚠️⚠️ THIS WAS A SWITCH WITH SIX CASES AND A FALLBACK, AND `flow/roster.js` RAISES
 * NINE REASONS. The three that fell through — plus `roster_full`, `storage_full`
 * and `unauthorized` — landed on `err.message`, which is written for whoever reads
 * the source: pressing "check" twice within an hour printed **"§7.3.3 allows one
 * check for changes per hour"** on the home screen. That is D-088 exactly, one day
 * later, in the module I did not look at when I fixed D-088. **Closing a class in
 * one module is not closing the class**, and the table is now a lookup in
 * `ui/copy.js` that `test/copy.mjs` checks against the reasons `flow/roster.js`
 * actually constructs.
 *
 * ⚠️ THE TWO EXCEPTIONS ARE NOT IN THE TABLE AND SHOULD NOT BE. `clock_skew` needs
 * the message because §5.2's sentence names the offset, and `memory` comes from
 * Argon2 rather than from the roster at all.
 */
function describeIdentity(err) {
  noteProblem(err);
  return sentenceFor(err);
}

/**
 * The same sentence, without recording the problem a second time.
 *
 * ⚠️ IT IS SEPARATE BECAUSE A NOTICE IS BUILT MORE THAN ONCE (D-169). `notice()`
 * keeps the builder and re-runs it on every language change, so a builder that
 * called `describeIdentity` would add a row to the diagnostics panel every time
 * somebody pressed Suomi. The caller records once; this says the words.
 */
function sentenceFor(err) {
  // ⚠️ NOT A ROSTER FAILURE AT ALL — `crypto/argon2.js` raises it, and §7.2's 128
  // MiB is the only thing this client asks of a device that a device can refuse.
  if (err?.reason === "memory") return copy.unlock.memory;
  const written = copy.roster.failure[err?.reason];
  // §5.2 is the one whose sentence carries a measurement, so the table holds a
  // function for it rather than `app.js` holding a special case.
  // ⚠️ D-152 — it takes the measured OFFSET IN SECONDS now, not a half-built English
  // sentence. `flow/roster.js` no longer writes prose for anybody to pass along.
  if (typeof written === "function") return written(err.skew);
  if (typeof written === "string") return written;
  // ⚠️ NO `err.message` HERE, EVER. A reason with no sentence is a gap in the copy
  // and the person reading the screen is not the one who can close it; the generic
  // sentence is worse for me and better for them. `test/copy.mjs` is what makes
  // this branch unreachable for anything `flow/roster.js` can raise.
  return copy.unlock.unknown;
}

// -------------------------------------------------------- §7.3.1a what vanished

/**
 * A roster arrived with fewer conversations than this device had. §7.3.1a gives
 * three answers and they are not variations of one — see `flow/quarantine.js`.
 *
 * ⚠️ This is awaited by `flow/roster.js` BEFORE the new roster is cached, so a
 * crash here leaves the device holding the old list rather than a deletion it
 * never recorded. Same rule as §5.4.3's "persist before you acknowledge".
 */
async function absorb(change, quarantine, vault, scope) {
  if (change.kind === "purged") {
    // The panic action, and the case it exists for is a device that is gone: it
    // must beat an attacker who reaches the lost one later. Immediate,
    // irreversible, no quarantine, and a plain notice.
    for (const entry of change.removed) await forgetLocally(entry, vault, scope);
    await quarantine.purge();
    notice("purged", () => ({ body: copy.deletion.purged, alarm: true }));
    return;
  }
  if (change.kind === "deletion") {
    // Ordinary use. §7.3.1a: permanent, with no undo — the cost of a mistake is
    // re-pairing one channel, and pretending otherwise would be the undeletable
    // contact list Rule 1 exists to prevent.
    for (const entry of change.removed) await forgetLocally(entry, vault, scope);
    return;
  }
  if (change.kind === "suspect") {
    // More than one at once without a raised `purged_at`: almost certainly a bug
    // rather than an intention. Hide them immediately, exactly as for a permanent
    // deletion, and keep the entries for seven days.
    await quarantine.hold(change.removed);
  }
}

/** Local data for a channel that is not coming back. */
async function forgetLocally(entry, vault, scope) {
  const root = rootBytesOf(entry);
  await store.forgetChannel(vault.conversation, scope, root);
  await vault.messages.forget(await rosters.rootHash(root));
}

async function forgetExpiredQuarantine() {
  const dropped = await session.quarantine.sweep();
  for (const entry of dropped) await forgetLocally(entry, session.vault, scopeOfRecords());
  return dropped.length;
}

const rootBytesOf = (entry) => entry.rootBytes ?? b64uDecode(entry.root, "channel root");

// ---------------------------------------------------------------- the notices

/** A notice is a thing that happened to this device, not a step in a flow. */
/**
 * §3.4.1b: this device could not write the in-flight pairing record.
 *
 * ⚠️⚠️ THE INTERFACE HAS TO AGREE WITH THE RECORD, AND WITHOUT THIS IT SAID THE
 * OPPOSITE. `keepOpen.kept` tells the person in as many words that closing the
 * browser is safe and that they can carry on next time they type their KEY — which
 * is true exactly when the record exists. On a device with a full or refused store
 * it did not, the friend was left waiting on a session that could never be
 * completed, and nothing anywhere said so.
 *
 * ⚠️ NOT AN `alarm`. Nothing is broken and nothing was attacked: one capability is
 * missing and there is one thing to do about it. The alarm styling belongs to §3.5.
 *
 * ⚠️ SUPPRESSED IN GHOST, where `keepOpen.ghost` already says this and says it
 * better — §3.4.1b rule 2 means a Ghost pairing never survives the tab by design,
 * so the screen is already telling the truth and a second copy of it is noise.
 */
function warnNotDurable() {
  if (isGhost()) return;
  notice("not-durable", () => copy.pairing.notDurable);
}

/**
 * Every panel that is on screen right now, in the order they were put there.
 *
 * ⚠️⚠️ D-169 — `#notices` IS NOT A SCREEN, AND THAT IS WHY IT WAS THE HOLE IN THE
 * LANGUAGE SWITCH. `only()` shows the control only where `RERENDER` can redraw the
 * screen — *"a control that changed half the words would look like it had worked"* —
 * and that guarantee is per SCREEN. A notice sits ABOVE the screens (`index.html`),
 * so it fell outside the promise on screens where the promise was made: Hannu found
 * a red §7.3.1 panel still in English under a list that had just become Finnish.
 *
 * ➡️ **A GUARANTEE MADE PER CONTAINER DOES NOT COVER WHAT LIVES OUTSIDE THE
 * CONTAINER.** The fix is not a second `RERENDER` table anybody could forget to add
 * a row to — it is that `notice()` now takes the WORDS AS A FUNCTION, so a panel
 * that cannot be re-said in the other language is not a panel this file can make.
 */
const liveNotices = new Map();

/**
 * Put a panel on screen — `build()` is re-run whenever the language changes.
 *
 * It returns either the sentence, or `{ body, alarm, actions }` when there is more
 * than a sentence. It MUST read `copy` at call time rather than close over a string:
 * that is the whole property, and `test/app-document.mjs` is what keeps it true.
 */
function notice(id, build) {
  liveNotices.set(id, build);
  paintNotice(id, build);
}

function paintNotice(id, build) {
  const made = build();
  const { body, alarm = false, actions = [] } = typeof made === "string" ? { body: made } : made;
  document.querySelector(`[data-notice="${id}"]`)?.remove();
  const el = document.createElement("section");
  el.className = `panel${alarm ? " alarm" : ""}`;
  el.dataset.notice = id;
  // ⭐⭐ D-179's OWED QUESTION, ANSWERED FOR THE PANELS. A panel is appended to a
  // container that sits above every screen, WITHOUT anybody pressing anything — which
  // is precisely the change a screen reader is silent about unless the element says it
  // is a message. `role="alert"` announces at once and `role="status"` waits for a
  // pause; the split is the same one that decides the styling, so the two cannot drift.
  el.setAttribute("role", alarm ? "alert" : "status");
  const p = document.createElement("p");
  p.textContent = body;
  el.append(p);
  for (const a of actions) {
    const extra = document.createElement("p");
    extra.className = "note";
    extra.textContent = a.note ?? "";
    if (a.note) el.append(extra);
    // ⚠️ A NOTE WITH NO BUTTONS IS A PANEL SHAPE (D-173). `for (const b of a.buttons)`
    // threw on it, so the only way to put a second paragraph on a panel was to give
    // the person something to press — which is the wrong way round for a panel whose
    // whole content is "this did not happen, and here is what the server said".
    if (!a.buttons?.length) continue;
    const row = document.createElement("div");
    row.className = "row";
    for (const b of a.buttons) {
      const button = document.createElement("button");
      button.className = b.className ?? "secondary";
      button.textContent = b.label;
      button.addEventListener("click", b.onClick);
      row.append(button);
    }
    el.append(row);
  }
  // ⭐⭐⭐ D-185 — WHICH PANELS A PERSON MAY CLOSE IS DERIVED FROM THE PANEL, NOT LISTED.
  //
  // 15 of 19 `notice()` call sites passed no buttons, so a panel that appeared stayed
  // until some other code removed it, and 10 of those had nothing to do with an alarm.
  // The rule Hannu chose is *the informational ones may be closed and the alarms may
  // not*, and the shape already says which is which: an `alarm` is §3.5's register and
  // must stand until its cause is gone, and a panel that carries `actions` already has
  // a way out that says something more useful than "close".
  //
  // ⚠️⚠️ A SET OF IDS WOULD HAVE BEEN THE OBVIOUS IMPLEMENTATION AND IT IS THE WRONG
  // ONE. `RERENDER` is the standing example in this file of a table somebody must
  // remember to add a row to; D-169 removed one for exactly this reason. Derived from
  // the shape, a panel written next year obeys the rule without knowing it exists —
  // and `test/app-document.mjs` pins today's partition so the set cannot move in
  // silence.
  //
  // ⚠️ `clearNotice` AND NOT `el.remove()`. The builder must leave `liveNotices` too,
  // or the next language change (D-169) paints the closed panel straight back.
  if (!alarm && actions.length === 0) {
    const row = document.createElement("div");
    row.className = "row";
    const close = document.createElement("button");
    close.className = "secondary";
    close.textContent = copy.notices.close;
    close.addEventListener("click", () => clearNotice(id));
    row.append(close);
    el.append(row);
  }
  $("notices").append(el);
}

const clearNotice = (id) => {
  liveNotices.delete(id);
  document.querySelector(`[data-notice="${id}"]`)?.remove();
};

/**
 * A control could not do what it said, and nothing was changed — D-173.
 *
 * ⚠️⚠️ THREE CONTROLS AWAITED A ROSTER WRITE AND CAUGHT NOTHING: `#delete`,
 * `#sas-wrong` and `#rename`. A roster write is an HTTP PUT and can be refused for
 * four ordinary reasons, and every one of them arrived as an unhandled rejection in
 * a console nobody has open. This is what they say instead.
 *
 * ⚠️ TWO SENTENCES, FROM TWO PLACES, AND THEY ARE NOT INTERCHANGEABLE. `what()` is
 * this product saying which act did not happen and what is therefore unchanged;
 * `sentenceFor(err)` is the reason, from the table `flow/roster.js` fills and
 * `test/copy.mjs` keeps complete. A panel with only the reason would leave the
 * person to work out what it was the reason FOR.
 *
 * ⚠️ `what` IS A FUNCTION because `notice()` re-runs its builder on every language
 * change (D-169), and a panel that could not be re-said in Finnish is a panel this
 * file may not make.
 */
function sayNothingChanged(err, id, what) {
  noteProblem(err);
  notice(id, () => ({ body: what(), alarm: true, actions: [{ note: sentenceFor(err) }] }));
}

/**
 * Say every panel again, in the language just chosen.
 *
 * ⚠️ IN INSERTION ORDER, because each re-said panel is appended at the end — walking
 * the map in the order it was filled leaves the column exactly as it was. A panel
 * that arrived while the person was reading is not moved by translating it.
 */
function repaintNotices() {
  for (const [id, build] of liveNotices) paintNotice(id, build);
}

/** §7.3.1a's notice, one panel per held conversation so the choice is per-entry. */
async function renderQuarantine() {
  const pending = await session.quarantine.pending();
  clearNotice("quarantine");
  if (pending.length === 0) return;
  notice("quarantine", () => ({
    body: copy.deletion.suspect(pending.length),
    actions: [
      {
        note: `${copy.deletion.undoIsLocal} ${copy.deletion.quarantineWindow}`,
        buttons: pending.flatMap((entry) => [
          {
            label: `${copy.deletion.keep}: ${entry.name || "unnamed"}`,
            onClick: async () => {
              await session.quarantine.restore(entry.root);
              await renderQuarantine();
              await openHome();
            },
          },
          {
            label: `${copy.deletion.agree}: ${entry.name || "unnamed"}`,
            className: "secondary",
            onClick: async () => {
              await forgetLocally(entry, session.vault, scopeOfRecords());
              await session.quarantine.forget(entry.root);
              await renderQuarantine();
              await openHome();
            },
          },
        ]),
      },
    ],
  }));
}

/** §7.3.2 rule 3 and §7.3.1 rule 4 — things the roster flow noticed. */
function renderWarnings() {
  // ⚠️⚠️ D-168 — GHOST MODE HAS NO ROSTER AT ALL, and this became reachable from Ghost the
  // moment the drain moved off the conversation list. §7.6 keeps no identity and writes
  // nothing durable, so there is no roster to have been written from anywhere else, and
  // `session.roster` is genuinely absent rather than empty. Both new call sites — the send
  // and the drain — run in both modes.
  if (!session?.roster) return;
  for (const w of session.roster.takeWarnings()) {
    if (w.kind === "version_mismatch") notice("mismatch", () => ({ body: copy.list.versionMismatch, alarm: true }));
    else if (w.kind === "name_unresolved") notice("rename", () => copy.list.nameUnresolved(w.kept));
    else if (w.kind === "unexplained_removal")
      notice("unexplained", () => ({ body: copy.list.unexplained(w.count), alarm: true }));
    else if (w.kind === "role_conflict") notice("role", () => copy.list.roleConflict);
    else if (w.kind === "memo_conflict") notice("memo", () => copy.list.memoConflict);
    // ⚠️⚠️ D-168 — AN ALARM, AND THE ONLY ONE HERE THAT IS NOT ABOUT THE SERVER. The other
    // three report something wrong with what arrived; this reports something ordinary that
    // this product cannot support (§7.3.1 rule 1, D-045) and has never mentioned. Hannu
    // measured the cost of the silence on 2026-08-26: two browsers, one KEY, and the peer's
    // replies reaching only one of them with no error at either end.
    // ⭐⭐⭐ AND WHICH OF THE TWO, because the same evidence over two spans is two claims.
    // `watched` means this document read across the whole span and the other place wrote
    // while the person was here; `away` means the baseline came from §7.3.2's mark, which
    // has no clock, so the change may be days old. Both stay alarms — see `flow/roster.js`.
    else if (w.kind === "elsewhere")
      notice("elsewhere", () => ({
        body: w.span === "away" ? copy.list.elsewhereAway : copy.list.elsewhere,
        alarm: true,
      }));
  }
}

// ------------------------------------------------------------- §7.3 the chat list

/**
 * ⚠️ IT BUILDS THE LIST BEFORE IT SHOWS THE SCREEN, and that is not only about a
 * flash of empty panel. The entries come from `await`ed storage, so a screen shown
 * first is a screen that says "No conversations yet" to somebody who has some —
 * for one frame in development and for as long as a slow disk takes on the device
 * this product is aimed at. D-016's failure is a user believing their
 * conversations are gone; it does not need to be true for long to do its damage.
 */
async function openHome() {
  // ⚠️⚠️ §4.3's SECOND TIER IS MANDATORY, AND THIS IS THE DOOR IT STANDS IN. Every Kept
  // path that reaches a conversation list comes through here — the ordinary unlock, a
  // resumed pairing, a joiner who has just finished one — so one check covers all of
  // them, and `savePin` comes straight back to this function afterwards.
  if (session && !isGhost() && !session.pinRecord) {
    // ⚠️ RE-READ BEFORE DEMANDING, AND ONLY THEN. One browser can hold two tabs of the
    // same identity (§4.2), and the tab that did not choose the PIN would otherwise
    // demand a second one and write over the first. The read costs nothing on the
    // ordinary path because the ordinary path never reaches this branch twice.
    session.pinRecord = await readPinRecord();
  }
  if (session && !isGhost() && !session.pinRecord) {
    await showPinSet(openHome);
    return;
  }
  await watch(null); // this tab is displaying nothing; the leader can stop for it
  text("home-title", copy.list.title);
  // D-139: `#create` is the floating button, so its name is an attribute.
  // ⚠️⚠️ D-191: AND NOW ALSO ITS TEXT. The note here used to end "a circle cannot hold a
  // sentence", which was true and was the wrong thing to conclude — the circle was the
  // part that could be changed. Both are written from ONE constant: the accessible name
  // and the visible name of a control must be the same words, or a person reading the
  // screen and a person hearing it are being told about two different buttons.
  // ⚠️ The `aria-label` STAYS even though the text alone would now name it. It is what
  // `probe-accessible-names` reads, and dropping it would make the name depend on
  // whether `openHome()` has run yet — which on the boot path it has not.
  $("create").setAttribute("aria-label", copy.list.start);
  text("create-label", copy.list.start);
  // ⚠️ ROUND 19'S SECOND DOOR, AND IT SAYS THE SAME SENTENCE ON PURPOSE. The ＋ and this
  // item are one act; two names for it would be two things to learn. See `index.html`.
  text("menu-create", copy.list.start);
  text("check", copy.nav.checkForChanges);
  // D-151: the previous answer belonged to the previous press.
  text("check-note", "");

  const quarantined = await session.quarantine.list();
  const entries = await quarantineFlow.withRestored(session.roster.channels(), quarantined);

  // The leader resolves another tab's announced channel hash to a roster entry
  // through this, so it is rebuilt whenever the list is.
  hashed.clear();
  for (const entry of entries) hashed.set(await rosters.rootHash(rootBytesOf(entry)), entry);
  if (session.tabs.isLeader) await syncStreams();

  const list = $("channels");
  list.replaceChildren();
  if (entries.length === 0) {
    const p = document.createElement("p");
    p.className = "note";
    p.textContent = copy.list.empty;
    list.append(p);
  }
  for (const entry of entries) {
    const b = document.createElement("button");

    // D-139 — WhatsApp's row: a round mark, the name, and a second line under it.
    //
    // ⚠️⚠️ THE MARK IS A MONOGRAM AND THERE IS NO PHOTOGRAPH BEHIND IT. That is a
    // property of this product rather than something not built yet: haamu has no
    // profile pictures, nothing about a person travels to the server, and a face on
    // this screen would be the first thing that did. WhatsApp shows a monogram
    // before a photograph is set, so the shape is faithful and the gap is honest.
    //
    // ⚠️ AND THE SECOND LINE IS THE ROLE, NOT A MESSAGE PREVIEW. WhatsApp puts the
    // last message there. Doing that here would paint plaintext from a conversation
    // onto the screen that is showing whenever the app is open and unlocked — which
    // is a decision about §7 and shoulder-surfing, not about layout, and it is not
    // one to make in a design pass. The role is what this list already knew.
    // ⚠️ TWO FORMATTERS AND ONE `Date`. `toLocaleTimeString()` on its own prints seconds,
    // which is noise in a list; the row wants the minute the conversation began and nothing
    // finer. `test/app-document.mjs` reads this line and requires BOTH calls, because a
    // sample argument is a claim about a call site and D-164 is what happens when it drifts.
    //
    // ⚠️⚠️ `hour: "numeric"` AND NOT `"2-digit"`, AND THAT IS A FINNISH DECISION. Both were
    // rendered before choosing: `2-digit` gives *klo 09.05*, and a Finnish clock is written
    // *klo 9.05* — the leading zero is not wrong, it is not what anybody writes. Nothing here
    // is a column, so there is no alignment to trade for it. English is unharmed either way.
    const began = new Date((entry.created ?? 0) * 1000);
    const name =
      entry.name ||
      copy.list.unnamedOn(
        began.toLocaleDateString(),
        began.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
      );

    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.setAttribute("aria-hidden", "true");
    // ⚠️ `[...name][0]` AND NOT `name[0]`. A JavaScript string is indexed by UTF-16
    // code unit, so `name[0]` on a name beginning with an emoji or any character
    // outside the basic plane yields half a surrogate pair and renders as `�`. The
    // spread iterates code points. A conversation may be called anything at all.
    avatar.textContent = [...name.trim()][0] ?? "";
    b.append(avatar);

    const meta = document.createElement("span");
    meta.className = "chatmeta";

    const title = document.createElement("span");
    title.className = "name";
    title.textContent = name;
    meta.append(title);
    if (entry.local) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = copy.list.localOnly;
      title.append(tag);
    }

    const who = document.createElement("span");
    who.className = "who";
    who.textContent = entry.role === "I" ? copy.list.roleI : copy.list.roleJ;
    meta.append(who);

    b.append(meta);
    b.addEventListener("click", () => openConversation(entry));
    list.append(b);
  }

  // §7.3.2: a device unlocking with no local history has no high-water mark, and
  // that is exactly where the rollback aims. It cannot be closed — there is nothing
  // to compare against on a genuinely new device — so the client shows what the
  // blob asserts about ITSELF, and §7.3.2 requires that this be recorded as weak.
  const state = session.roster.freshness;
  if (state?.state === "unknown") {
    const r = session.roster.roster;
    const when = new Date((r.written_at ?? 0) * 1000).toLocaleDateString();
    text("home-note", copy.list.noHistory(when, r.channels.length));
  } else {
    text("home-note", "");
  }

  // D-130, on the screen somebody who has just unlocked in a new browser lands on.
  // ⚠️ It is counted rather than listed: the entries needing it are already on this
  // screen, and a second list of the same names beside them would be noise.
  const waiting = (await Promise.all(entries.map((e) => neverHeldHere(e)))).filter(Boolean).length;
  text("home-reconnect", waiting > 0 ? copy.chat.reconnect.some(waiting) : "");
  show("home-reconnect", waiting > 0);

  renderWarnings();
  await renderQuarantine();
  only("home");
}

/**
 * Where "back" goes, which is not the same place in the two modes.
 *
 * Kept mode has a list and everything returns to it. §7.6's mode has no list —
 * there is the one conversation if there is one, and the offer to start one if
 * there is not.
 */
async function backToStart() {
  if (!isGhost()) return openHome();
  const entry = await session.ghost.channel();
  if (!entry) return showGhostStart();
  return openConversation({ ...entry, rootBytes: b64uDecode(entry.root, "channel root") });
}

/**
 * What this device is showing, as one string, so that §7.3.3 case 5 can say whether
 * anything actually arrived (D-151).
 *
 * ⚠️ `generation` IS DELIBERATELY NOT IN IT. It moves every time a message is sent and
 * never because another device wrote the roster, so a check that found nothing would
 * report a change whenever the person had been talking. What CAN arrive from another
 * device is a channel added, renamed, verified or deleted, and §7.3.1a's wipe — which
 * empties `channels` and shows up as a change for that reason.
 */
async function listSignature() {
  const held = await session.quarantine.list();
  return JSON.stringify([
    session.roster.channels().map((c) => [c.root, c.name, c.role, c.verified]),
    held.length,
  ]);
}

// §7.3.3 case 5, and the interface must say plainly that it is a moment the server
// sees this user. That honesty is the section's own requirement.
//
// ⭐⭐ D-151 — IT SAID NOTHING WHEN IT WORKED. *"I have never noticed anything happening
// from pressing that?"* — because in the ordinary case nothing does: the roster comes
// back identical and `openHome()` redraws the same list. The only reply this control had
// was `access_rule` on a second press, so the person pressing it learned that it either
// does nothing or complains. Now all three replies go to one slot beneath it.
$("check").addEventListener("click", async () => {
  try {
    const before = await listSignature();
    await session.roster.check();
    await openHome();
    text("check-note", (await listSignature()) === before ? copy.nav.checked : copy.nav.checkedChanged);
  } catch (err) {
    text("check-note", describeIdentity(err));
  }
});

// ------------------------------------------------------------------ §6 the chat

/**
 * Open a conversation.
 *
 * ⚠️⚠️ `generation` COMES FROM THE ROSTER AND GOES BACK TO IT, and that is the
 * seam step 5 left open. §6.3 puts the session generation in the roster rather
 * than in session storage precisely because a device migration loses the session
 * store and keeps the roster: with the counter in the wrong place a restored
 * device restarts at generation 1, the peer treats the second migration as a
 * replay, and the channel is dead with no way to re-pair (§3's links are
 * single-use). `flow/message.js` awaits the callback before the message goes out.
 *
 * ⭐ A LOCAL-ONLY CHANNEL HAS NO ROSTER ENTRY TO WRITE TO (§7.3.1a's undo), so its
 * generation is carried in the quarantine record instead. It is the one case where
 * the counter is not in the roster, and it is sound for the same reason the
 * conversation itself is: nothing else will ever write to that channel again.
 */
function openChannelFor(entry) {
  const root = rootBytesOf(entry);
  return messageFlow.openChannel({
    api,
    backend: session.backend,
    scope: scopeOfRecords(),
    pickleKey: session.pickleKey,
    channelRoot: root,
    role: entry.role,
    generation: entry.generation ?? 0,
    onGeneration: async (g) => {
      // ⭐ GHOST MODE PUTS IT IN `sessionStorage` AND §7.6 NAMES IT SPECIFICALLY.
      // There is no roster, and leaving the counter in memory means an ordinary OS
      // page discard — the exact event `sessionStorage` was chosen to survive —
      // resets it below what the peer has already accepted, after which §6.3 rule 1
      // rejects everything this user sends, silently.
      if (isGhost()) {
        await session.ghost.setGeneration(g);
        return;
      }
      if (entry.local) return; // see the note above
      await session.roster.setGeneration(root, g);
      session.tabs.announce("roster", { id: TAB_ID });
    },
    // ⚠️ THE CRITICAL SECTION, ACROSS TABS (step 9). It makes a conflicting write
    // rare; what makes one SAFE is `storage/sessions.js` refusing a stale write,
    // and that holds with or without this.
    guard: (hash, fn) => session.tabs.withChannel(hash, fn),
  });
}

/**
 * Every sentence the conversation screen shows, put where it goes — the same idea as
 * `paintCopy()`, one screen down.
 *
 * ⚠️⚠️ IT IS A FUNCTION FOR D-152'S REASON RATHER THAN FOR TIDINESS. These lines have
 * to run again when the language changes, and the obvious way to do that is to copy
 * them into `RERENDER.chat` — which would be **two paths to one sentence, and two
 * paths to one sentence is two homes for one sentence.** D-157 found the last one of
 * those still standing months after the fact. One home, two callers.
 *
 * ⚠️ PAINT ONLY. `openConversation` does the rest — the channel, the log, the watch —
 * and none of it may move in here, because this is called on a conversation that is
 * already open and a second call must change nothing but what is written.
 */
function paintConversation(entry) {
  text("chat-name", entry.name || (isGhost() ? copy.chat.thisOne : copy.list.unnamed));
  text("chat-ttl", copy.chat.ttl);
  text("chat-local", entry.local ? copy.chat.localOnly : "");
  show("chat-local", Boolean(entry.local));
  $("text").placeholder = copy.chat.placeholder;
  // D-139: a circular icon button — see `.send` in `app.css` for why the shape is
  // load-bearing rather than decorative. Its name is an attribute for the same
  // reason `#create`'s is.
  $("send").setAttribute("aria-label", copy.chat.send);

  // ⚠️ THE GHOST BANNER STAYS ON THE CONVERSATION, not only on the screen that
  // offered the mode. §7.6's own warning is that the tab "returns looking exactly as
  // though the conversation should still be there, and it is gone" — a person who
  // chose this two hours ago has no other reminder of which mode they are in, and
  // the difference between the modes is what happens when they close the tab.
  text("chat-ghost", isGhost() ? copy.ghost.what : "");
  show("chat-ghost", isGhost());

  // Ghost mode has no list, so there is nowhere to go Back to, nothing a rename
  // would be written into, and deleting the one conversation IS ending the session.
  show("back-home", !isGhost());
  show("rename", !isGhost());
  text("rename", entry.name ? copy.nav.rename : copy.nav.giveName);
  show("delete", !isGhost());
  show("ghost-end", isGhost());
  text("ghost-end", copy.ghost.end);
}

async function openConversation(entry) {
  openEntry = entry;
  $("log").replaceChildren();
  await olm.initOlm();

  const hash = await rosters.rootHash(rootBytesOf(entry));

  if (isGhost()) {
    // The root's bytes, held for §7.8 step 2 — see `keysOf`. And `hashed`, because
    // `syncStreams` resolves a channel hash back to an entry through it in both
    // modes, and in this one there is exactly one row to put there.
    session.root = rootBytesOf(entry);
    hashed.clear();
    hashed.set(hash, entry);
    // §4.3's watcher, armed here rather than at the start of the session: before
    // there is a conversation there is nothing to cover, and the screen it would
    // cover is the one holding a single-use link the person is trying to send.
    //
    // ⚠️⚠️ ONE TIER, AND THE ABSENT `onLock` IS THE STATEMENT RATHER THAN AN OMISSION.
    // §7.6 has no phrase and no roster, so dropping the derived set here is not a lock
    // but a silent ending on a timer — D-073, found by building it. What this mode can
    // honestly do is cover, so it covers, and it goes on covering for as long as the tab
    // lives instead of stopping after one long window.
    lockWatch?.stop();
    lockWatch = lockFlow.watchIdleness({ onCover: coverDue });
  }

  // ⚠️ THIS TAB'S OWN CHANNEL OBJECT, AND IT EXISTS WHETHER OR NOT THIS TAB LEADS.
  // Sending is not the leader's job — the person types in whichever tab is in
  // front of them — so every tab needs one. Two objects for one channel in one
  // browser is fine and is the arrangement the guard and the conditional write are
  // written for: the stored record is the only state either of them shares.
  channel = openChannelFor(entry);

  paintConversation(entry);

  await renderLog(hash);
  await showConversationState(entry);
  only("chat");
  toNewest();
  await watch(hash);
  await reconnectAutomatically(entry, hash);
}

/** Conversations this tab is already reconnecting, so an open cannot send twice. */
const reconnecting = new Set();

/**
 * A conversation this browser holds but cannot receive on reconnects itself, by
 * sending one message — HANNU'S DESIGN, 2026-08-18.
 *
 * ⚠️⚠️ IT IS ON **OPEN**, NOT ON UNLOCK, AND THAT IS HIS WORDING DOING REAL WORK:
 * *"at the same time when it writes that notification"*. The notification is written
 * when a conversation is opened, so this sends one message per conversation the person
 * actually looks at — where reconnecting everything at unlock would send a burst of
 * traffic nobody asked for, to peers the person had no intention of contacting.
 *
 * ⭐⭐ AND IT REPAIRS A PROMISE THE ENDING ALREADY MAKES. `copy.ending.confirm` says the
 * conversations *"come back on this one when you type the KEY"* — true of the list, which
 * is server-held, and **false of being able to receive**, because §7.8 step 2 clears the
 * `conversation` store where the session state lives. Until now that sentence overstated
 * what typing the KEY restored. With this, it is true again.
 *
 * ⚠️⚠️ IT DOES NOT RECOVER ANYTHING ALREADY LOST, and no amount of care here could.
 * Messages the peer sent to the session that is gone were encrypted to it; §6.2's forward
 * secrecy is exactly the property that makes them unreadable. This stops the NEXT ones
 * being lost. The red lines for the old ones are still correct and still appear.
 *
 * ⚠️ A FAILED SEND LEAVES EVERYTHING AS IT WAS — no session, banner still up, and the
 * next open tries again. That is why nothing here is recorded as "done": the state that
 * says whether it worked is the session record itself, which is the only honest witness.
 */
async function reconnectAutomatically(entry, hash) {
  if (isGhost() || entry.local) return;
  if (reconnecting.has(hash)) return;
  // ⛔⛔ NEVER INTO A CONVERSATION THE PEER HAS CLOSED — PROTOCOL §6.3.1 rule 5 (D-172),
  // AND THE RULE WAS ALREADY WRITTEN FORTY LINES AWAY. `showConversationState` computes the banner as
  // `!closed && neverHeldHere(...)` and says why: advice to send a message cannot work
  // once the other end is gone. This function asked only the second half — so the app
  // could send, by itself, into a mailbox nobody will ever drain again, which is the
  // exact defect §6.7.1 was written to end.
  //
  // ⭐ AND THE PRODUCT ALREADY HOLDS THE PERSON TO THIS RULE: while closed the composer
  // is hidden AND disabled. The guard was on the human and not on the app.
  //
  // ⚠️⚠️ THIS LINE IS NO LONGER THE GUARANTEE, AND MUST NOT BE READ AS ONE. §6.7.1
  // rule 5 now lives in `flow/message.js`, at the single point where sending happens,
  // because D-172 was what two hand-written copies of one rule cost. What survives
  // here is an EARLY EXIT: it keeps this function from starting work — an Olm init, a
  // record load, a generation raise — that the send path would refuse at the end of.
  // Deleting it would change no outcome. Deleting the one in `sendOnce` would.
  if (await store.loadClosed(session.backend, scopeOfRecords(), rootBytesOf(entry))) return;
  if (!(await neverHeldHere(entry))) return;
  reconnecting.add(hash);
  try {
    await deliver(copy.chat.reconnect.sent);
    // The banner's condition is now false — re-ask rather than assume, because the
    // send is what changed it and a send that half-worked must not clear it.
    await showConversationState(entry);
  } catch {
    // ⚠️ SILENT ON PURPOSE, AND IT IS THE ONE PLACE IN THIS FILE THAT IS. The person
    // did not press anything; a red "not sent" line for an action they never took would
    // be a fault report about the app's own idea. The banner is still on screen, still
    // says what to do, and doing it by hand is the fallback.
  } finally {
    reconnecting.delete(hash);
  }
}

/**
 * Put the newest message on screen — AFTER the chat is the screen on show.
 *
 * ⚠️⚠️ `line()` ALREADY ASKS FOR THIS AND IT CANNOT WORK FROM `renderLog`. A
 * panel that is not on show is `display: none`, an element with no box has
 * `scrollHeight` 0, and assigning `scrollTop` to it is a no-op that does not
 * fail — measured, 40 messages: `scrollHeight 0, clientHeight 0, scrollTop 0`
 * while hidden, and `scrollHeight 3880, scrollTop 0` the moment it is shown. So
 * the whole history is drawn, every line of it asks to be scrolled to, and the
 * box arrives at the top anyway.
 *
 * ⭐⭐ AND THIS IS WHY IT WAS "NOT ALWAYS" — the part that had to be measured
 * rather than reasoned out. The box KEEPS the scroll offset it was left at
 * earlier in the same page life: traced at the instant the panel is revealed, on
 * a build with no scroll in it at all, it read 498px. So a conversation opened,
 * left and opened again looks right, because what is on screen is a LEFTOVER.
 * Reload the app and there is no leftover, and every conversation opens at its
 * oldest message — which is exactly the case Hannu reported, the OLD ones, the
 * ones he came back to.
 *
 * ⚠️ It is also why `browser-one-client.mjs` asserted this property and PASSED on
 * the broken build, and why the probe written to replace it passed on both builds
 * until it reloaded the page first. A stale offset that happens to be correct is
 * indistinguishable from a fix unless the measurement starts from a fresh page.
 */
function toNewest() {
  $("log").scrollTop = $("log").scrollHeight;
}

/**
 * §3.6.2's verification state and §6.7.1's closed marker, as this screen shows
 * them.
 *
 * ⚠️ THE UNVERIFIED BANNER IS QUIET ON PURPOSE, AND THAT IS A SECURITY DECISION.
 * The channel is end-to-end encrypted, it is not known to be intercepted, and the
 * overwhelmingly likely truth is that it is exactly who the person thinks. A
 * banner that shouted at every ordinary conversation would be trained away inside
 * a week — and then it would be worth nothing on the day it mattered. It states
 * one specific unproven thing, and offers the control that closes it.
 */
/**
 * D-130 — does this browser hold the conversation but none of the keys that read it?
 *
 * Opening the app in a different browser is §6.3's *"cleared storage, or device
 * migration"* reached by an act nobody would describe as one. The KEY recovers the
 * identity and the roster, which live on the server (§7.3); the Olm session state
 * and the message log are device-local and do not travel. The channel then works
 * in one direction only — this device can send, and everything the peer sends is
 * unreadable — until this device sends once and the peer adopts the new generation.
 *
 * ⚠️⚠️ THE GENERATION IS WHAT SEPARATES A MIGRATION FROM A NEW PAIRING, and without
 * it this would shout at every conversation the moment it was created. Both have an
 * empty session record. A channel nobody has sent on yet stands at generation 0 and
 * is simply new; a channel at 1 or more has had a session, and if this device holds
 * none of it then that session was somewhere else.
 *
 * ⭐ It clears itself: the first send writes a session into the record, so the
 * banner is gone the moment the thing it asks for has been done. Nothing has to
 * remember that it was dismissed, which is why there is no dismiss control.
 */
async function neverHeldHere(entry) {
  // Ghost mode keeps no roster and a local-only conversation is not on the server,
  // so neither can be reached by opening a second browser at all.
  if (isGhost() || entry.local) return false;
  if (!(entry.generation > 0)) return false;
  const { record } = await store.loadRecord(session.backend, scopeOfRecords(), rootBytesOf(entry));
  return Object.keys(record.sessions).length === 0;
}

async function showConversationState(entry) {
  const closed = await store.loadClosed(session.backend, scopeOfRecords(), rootBytesOf(entry));

  // ⚠️ NOT WHILE CLOSED. §6.7.1's banner says the other person has gone; inviting
  // a message to reconnect underneath it would be advice that cannot work.
  const reconnect = !closed && (await neverHeldHere(entry));
  show("chat-reconnect", reconnect);
  text("reconnect-what", copy.chat.reconnect.what);
  text("reconnect-why", copy.chat.reconnect.why);
  text("reconnect-cost", copy.chat.reconnect.cost);

  show("chat-closed", Boolean(closed));
  text("closed-what", copy.closing.theyLeft);
  text("closed-more", copy.closing.theyLeftWhat);
  text("closed-yours", copy.closing.yoursIsYours);
  text("closed-next", copy.closing.startAnother);

  // ⚠️ HIDDEN *AND* DISABLED. Hiding alone leaves a form a keypress can still
  // submit; disabling alone leaves a box that invites typing into a conversation
  // whose other end is gone.
  show("composer", !closed);
  $("send").disabled = Boolean(closed);
  $("text").disabled = Boolean(closed);

  const verified = Boolean(entry.verified);
  show("chat-unverified", !verified && !closed);
  // ⚠️⚠️ `unverified-more` IS DELETED ON THE TESTER ROUND'S EXPLICIT INSTRUCTION
  // (D-112). It read *"Nothing says anything is wrong, and it is encrypted either
  // way"* and Hannu's verdict was four words: **"Do not use this, confused
  // everyone."** Every clause was true; it opened with an abstract subject asserting
  // a negative, and a person reading "nothing says anything is wrong" on a security
  // banner does not leave reassured — they leave asking what would have to say it.
  // The obligations it carried are met by `unverified` below, which still refuses to
  // call the conversation insecure, and by `terms["six-digits"]`, which states
  // positively what the check is for.
  prose("unverified-what", copy.verification.unverified);
  text("verify-now", copy.verification.check);
  text("chat-verified", verified ? copy.verification.verified : "");

  /**
   * §3.5's warning, which lives here rather than on the pairing screen because
   * "non-dismissable" is a claim about the channel's whole life.
   *
   * ⚠️⚠️ IT IS NOT HIDDEN BY `closed`, AND IT IS THE ONLY BANNER HERE THAT IS NOT.
   * The others describe a state of the conversation; this one describes how the
   * conversation was OBTAINED, and that does not stop being true when the other
   * end leaves. A closing notice from an interceptor is exactly the moment a
   * person re-reads the screen for what happened.
   *
   * ⚠️ AND IT IS NEVER `verified`-GATED EITHER. Comparing the digits afterwards is
   * the right thing to do and it does not un-happen the second claim: it says the
   * person on the far end is the one you meant, not that nobody else ever held
   * the link. §3.6.2's answer and §3.5's evidence are different facts.
   */
  show("chat-tripwire", Boolean(entry.tripwire));
  text("tripwire-alarm-title", copy.verification.tripwireTitle);
  prose("tripwire-alarm-what", copy.verification.tripwire);
}

/**
 * Store what a drain produced. Returns how many were new.
 *
 * ⚠️ It runs in the LEADER, for conversations it may not be displaying — which is
 * why storing and rendering are two functions now. §5.4.1's retrieval and deletion
 * are separate steps, so the same message can be handed over twice after an
 * interrupted run, and after a reload the staged-but-unacknowledged ones come back
 * a third way. Deduplicate on the id, seeded from what is already on disk.
 */
async function storeIncoming(hash, entry, messages) {
  const known = seen.get(hash) ?? new Set(await knownIds(hash));
  seen.set(hash, known);
  const root = entry ? rootBytesOf(entry) : null;

  /**
   * §6.7.1 rules 5 and 8, decided from the LAST relevant message in the batch
   * rather than from whether one of each appeared.
   *
   * ⚠️ RULE 8 IS NOT A COURTESY. A client of this protocol cannot send after
   * closing — it has destroyed the ratchet — so anything arriving afterwards is a
   * hostile or broken peer, and leaving *"they have left"* over a screen that is
   * receiving messages would be this client lying about what is in front of it.
   */
  let closes = null;

  let stored = 0;
  for (const m of messages) {
    if (known.has(m.msgId)) continue;
    known.add(m.msgId);

    if (m.payload?.kind === payloads.KIND_CLOSED) {
      // ⭐ IT IS NOT A MESSAGE AND MUST NOT BECOME ONE. There is no `text` field
      // to render (§6.7.1 forbids one), the sentence a person reads belongs to
      // this client, and a row in the log would expire in 24 hours (§6.6) while
      // the fact that the peer has gone does not.
      closes = true;
      stored++;
      continue;
    }

    /**
     * ⚠️⚠️ *"A LATER MESSAGE **FROM THAT PEER**"*, AND THIS READ "A LATER ANYTHING"
     * (D-165, outside review slice C #4). Rule 8 clears the marker because content is
     * arriving and *"showing 'they have left' over a screen that is receiving messages
     * would be the client lying about what is in front of it"* — a premise that needs
     * the message to have been READ. An item with no payload is one this device refused:
     * §5.4.2's stale generation, a replay, a tampered envelope. Nothing about it is
     * evidence the peer sent anything.
     *
     * ⛔ SO THE SERVER COULD UN-CLOSE A CLOSED CONVERSATION. Requeue an old ciphertext
     * under a fresh `msg_id`, the refusal stages, the marker is cleared, the composer
     * comes back — and the person types into a mailbox nobody will ever drain again.
     * That is §6.7.1's founding defect, reinstated by the one party the section assumes
     * is hostile. The red line is still drawn below; only the marker is left alone.
     */
    if (m.payload) closes = false;

    /**
     * ⚠️⚠️ D-191: THE ONE FIELD THAT SAYS *WHICH* CASE IT WAS, KEPT. `unreadable()` draws
     * one sentence for three causes, and `noteProblem` never saw any of them — it records
     * THROWN exceptions, and a refusal is an ordinary return value. So on 2026-09-05 the
     * panel read `problem     none` on a screen that was reporting a problem, and the
     * report could not be resolved to a branch afterwards by anybody, including me.
     *
     * ⭐ `protocol/payload.js` ALREADY COMPUTES IT. `detail` carries `version: 1` or
     * `version: 3` or `kind: …`, it travels in the staged record, and it was being thrown
     * away one line below this. The fix is not new evidence; it is not discarding the
     * evidence that was already in hand.
     *
     * ⚠️ ONLY THIS ONE OF THE FOUR. The others name themselves on screen in sentences
     * nobody could confuse, and `staleSession` is EXPECTED after a device migration —
     * recording it would print a fault in the panel for the thing D-130 established is
     * not damage. `tampered` is deliberately left out too: it has the one sentence in the
     * product that accuses the server, so a person reporting it is already unambiguous.
     */
    if (m.failure === messageFlow.UNSUPPORTED) {
      const which = String(m.detail ?? "").replace(/\s+/g, "");
      noteProblem({ reason: "unsupported", which: which || null });
    }

    await session.messages.append(hash, {
      dir: "in",
      msgId: m.msgId,
      firstSeen: epochs.nowSeconds(), // §6.6: FIRST RECEIPT, never `sent_at`
      sentAt: m.payload?.sentAt ?? null,
      generation: m.generation,
      text: m.payload ? m.payload.text : unreadable(m),
      failure: m.payload ? null : m.failure,
    });
    stored++;
  }

  if (root && closes === true) await store.markClosed(session.backend, scopeOfRecords(), root, epochs.nowSeconds());
  if (root && closes === false) await store.clearClosed(session.backend, scopeOfRecords(), root);
  return stored;
}

const knownIds = async (hash) => (await session.messages.list(hash)).map((m) => m.msgId).filter(Boolean);

/**
 * Draw the whole log from the store.
 *
 * ⚠️ FROM THE STORE, ALWAYS, AND NEVER FROM WHAT A NOTICE CARRIED. A follower and
 * a leader looking at one conversation have exactly one thing in common, and it is
 * this database — so redrawing from it is what makes two tabs agree, and appending
 * whatever arrived over `BroadcastChannel` is what would make them drift.
 */
/**
 * msgIds already drawn as a PROVISIONAL refusal line (§5.4.2, first drain).
 *
 * ⚠️ CLEARED WHENEVER THE LOG IS REDRAWN, and that is not bookkeeping — these lines are
 * drawn and never stored, so a redraw erases them from the screen. A set that survived it
 * would remember having said something the person can no longer see, and the refusal
 * would go quiet again until the message was finally staged. Forgetting here is what
 * makes the next drain redraw it.
 */
const refusedShown = new Set();

async function renderLog(hash) {
  const log = await session.messages.list(hash);
  seen.set(hash, new Set(log.map((m) => m.msgId).filter(Boolean)));
  refusedShown.clear();
  $("log").replaceChildren();
  for (const m of log) line(m.text, m.dir === "out" ? "mine" : m.failure ? "bad" : "theirs", stamp(m));
}

// ------------------------------------------- ARCHITECTURE §4.2.3, a blocked store

/**
 * Is the shared store failing to answer, and is there another client to blame?
 *
 * `null` means it is answering. Otherwise `true` if the census found another client of
 * this identity and `false` if it did not — two different true sentences, and guessing
 * between them is the thing this session was told off for.
 */
let storeHeldBySibling = null;

/**
 * `storage/db.js` timed an operation past `STORE_SLOW_MS` — §4.2.3.
 *
 * ⚠️⚠️ THE CENSUS IS ASKED RATHER THAN ASSUMED. Only another connection to this origin
 * can hold a transaction for seconds — this document is running, so its own operations
 * drain — but "another connection" and "another tab of this app" are not the same claim,
 * and a single tab meeting a genuinely slow disk must not be told a second one exists.
 * The census counts clients of this identity, which is the question, and it answers
 * `null` on a browser with no lock API — resolved to "cannot say" rather than to "yes".
 */
async function storeStalled(slow) {
  if (!slow) {
    if (storeHeldBySibling === null) return;
    storeHeldBySibling = null;
    showLiveState();
    return;
  }
  if (storeHeldBySibling !== null) return;
  // ⚠️ `session` may be unset: the store is opened inside `withIdentity` before the
  // session exists, and an operation can stall in that window. No census, no claim.
  storeHeldBySibling = ((await session?.tabs.census()) ?? 0) > 1;
  showLiveState();
}

/**
 * ⚠️ "checking" IS NOT AN ERROR, and saying so would be a lie about the design:
 * §5.3's stream is a notification and §5.4.1's drain is the delivery. A FOLLOWER is
 * not an error either — it has no stream because another tab of this browser is
 * holding the one connection §4.2 allows, and its messages are arriving all the
 * same.
 *
 * ⚠️⚠️ THE STORE COMES FIRST, ABOVE BOTH, AND THAT ORDER IS THE POINT OF §4.2.3. Every
 * line below describes the CONNECTION, and a blocked store is a conversation whose
 * connection is perfect and whose messages cannot be written down. Measured on a running
 * product: forty seconds with the message already fetched, this line reading "live"
 * throughout, and nothing else on the screen different from a quiet conversation.
 */
function showLiveState(state) {
  if (!watching) return;
  if (storeHeldBySibling !== null) {
    text("live", storeHeldBySibling ? copy.chat.storeHeld : copy.chat.storeBusy);
    $("live").className = "live polling";
    return;
  }
  const resolved = state ?? (streams.has(watching) ? streams.get(watching).live.state : null);
  if (!session?.tabs.isLeader && !streams.has(watching)) {
    text("live", copy.chat.otherTab);
    $("live").className = "live polling";
    return;
  }
  text(
    "live",
    resolved === liveFlow.LIVE ? copy.chat.live : resolved === liveFlow.CONNECTING ? copy.chat.connecting : copy.chat.polling
  );
  $("live").className = `live ${resolved ?? liveFlow.CONNECTING}`;
}

/**
 * D-139 — is this bubble the first of a run?
 *
 * ⚠️ THE COMPARISON IS "WHICH SIDE", NOT "WHICH CLASS". A failed message renders as
 * `bad` and sits on the left with the incoming ones, so comparing class names would
 * put a tail on the message after a failure and break a run that never broke.
 */
const sideOf = (el) => (el.classList.contains("mine") ? "mine" : "them");

function line(body, cls, when) {
  const el = document.createElement("div");
  el.className = `msg ${cls}`;
  // WhatsApp draws the little tail on the first bubble of a run and on no other,
  // which is what makes five messages from one person read as one turn. `.tail` also
  // carries the gap between runs — see `app.css`, where putting that gap on every
  // bubble instead is called out as the thing that would erase the grouping.
  //
  // ⚠️ THE EMPTY LOG IS A SEPARATE TEST AND NOT A FALLTHROUGH. With `sideOf(null)`
  // resolving to "them", the very first message of a conversation would match itself
  // and open the conversation with a tailless incoming bubble — the one bubble on
  // screen, and the only one that has nothing above it to be grouped with.
  const previous = $("log").lastElementChild;
  if (!previous || sideOf(el) !== sideOf(previous)) el.classList.add("tail");
  el.textContent = body;
  if (when) {
    const t = document.createElement("span");
    t.className = "when";
    t.textContent = when;
    el.append(t);
  }
  $("log").append(el);
  $("log").scrollTop = $("log").scrollHeight;
}

/**
 * ⚠️ §6.7 rule 2: `sent_at` is DISPLAY ONLY. It is the peer's clock, which may be
 * wrong or hostile — it must not order the history and it is not the input to
 * §6.6's timer. The order here is arrival order, which is the message store's key.
 */
const stamp = (m) => (m.sentAt ? new Date(m.sentAt * 1000).toLocaleTimeString() : "");

/**
 * Send `body` on the open conversation, store it, and draw it.
 *
 * ⚠️ SHARED BY THE COMPOSER AND THE AUTOMATIC RECONNECT BELOW, so the two cannot
 * drift. An automatic message that took a different path to the store would be a
 * second implementation of the one operation whose ordering §5.4.3a constrains.
 */
async function deliver(body) {
  const sent = await messageFlow.send(channel, body);
  // §6.6: "The sender starts its own timer when the message is sent, so the two
  // copies do not expire simultaneously" — which is honest and is in the copy.
  const hash = await rosters.rootHash(rootBytesOf(openEntry));
  const record = { dir: "out", firstSeen: epochs.nowSeconds(), sentAt: sent.sentAt, text: body };
  await session.messages.append(hash, record);
  line(body, "mine", stamp(record));
  // Any tab may send, so any tab may be the one with something new on disk.
  session.tabs.announce("messages", { id: TAB_ID, channel: hash });
  // ⚠️ D-168 — SENDING IS A ROSTER WRITE WHENEVER §6.3's GENERATION MOVES, so this is one
  // of the two places a second device announces itself, and the person is on the chat
  // screen when it does. `#notices` sits above every screen for exactly this reason; what
  // was missing was anything draining the queue anywhere but the conversation list.
  renderWarnings();
}

/**
 * Round 19: *"if possible the enter so that I can make paragraphs and new lines."*
 *
 * ⚠️ THE FIELD HAD TO BECOME A `<textarea>` FIRST. An `<input>`'s value cannot contain
 * a newline at all, so no key binding would have helped — see the note in `index.html`.
 * `.msg` has carried `white-space: pre-wrap` since D-139, so what is typed with breaks
 * in it is already drawn with them.
 *
 * ⚠️ `isComposing` IS NOT OPTIONAL. Enter commits a candidate in an input method
 * editor; sending on it would post half a word and, worse, post it while the person is
 * still writing. It is a residual on a Finnish keyboard and a defect on a Japanese one.
 */
const fitComposer = () => {
  const t = $("text");
  // Collapse first, then measure: `scrollHeight` of a box that is already tall reports
  // the box, not the text, so growing without this shrinks nothing back.
  t.style.height = "auto";
  t.style.height = `${t.scrollHeight}px`;
};

$("text").addEventListener("input", fitComposer);
$("text").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
  // On a phone, Enter is the only way to make a paragraph and the button is the only
  // way to send. On a keyboard it is WhatsApp Desktop's split: Enter sends, Shift+Enter
  // breaks the line — and the guard above is what leaves Shift+Enter alone.
  if (!TYPED_ON) return;
  e.preventDefault();
  $("composer").requestSubmit();
});

$("composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = $("text").value.trim();
  if (!body || !channel) return;
  $("text").value = "";
  // ⚠️ AND BACK TO ONE LINE. Clearing the value does not undo the height this grew to,
  // so a sent paragraph would leave the composer standing four lines tall over an empty
  // field — and `max-height` would hold it there.
  fitComposer();
  $("send").disabled = true;
  try {
    await deliver(body);
  } catch (err) {
    // ⚠️ A CONFLICT REACHES HERE ONLY AFTER `flow/message.js` HAS GIVEN UP, which
    // means another tab has been writing to this channel without pause. Nothing was
    // sent, so pressing send again is the right answer and the right thing to say.
    // ⚠️⚠️ THE EXCEPTION DOES NOT REACH THE SCREEN, AND NEITHER DOES ENGLISH. This
    // line read `` `not sent: ${err?.reason ?? err?.message ?? err}` `` until
    // 2026-08-24: a hard-coded sentence and a raw implementation string, in a file
    // whose whole rule is that it types neither. `test/copy.mjs` passed the entire
    // time, because its pattern matched double-quoted, capitalised, twelve-character
    // strings — the shape of the four it caught when it was written.
    // ⛔⛔ THE WORDS GO BACK IN THE FIELD, AND UNTIL D-173 THEY WENT NOWHERE. `#text`
    // is cleared before the `await` above, so a send that failed left the sentence in
    // no field, no log and no record — while the line this writes says **"Try again"**
    // and the comment above says pressing send again is the right answer. It is, over
    // an empty box, and `if (!body) return` makes the press do nothing. The person's
    // only copy of what they wrote was their memory.
    //
    // ⚠️ ONLY IF THE BOX IS STILL EMPTY. A send is not instant, the composer is not
    // disabled while it runs, and somebody who has started the next sentence must not
    // have it overwritten by the one that failed.
    if ($("text").value === "") {
      $("text").value = body;
      fitComposer();
    }
    line(store.isConflict(err) ? copy.chat.busyElsewhere : copy.chat.notSent, "bad");
  } finally {
    $("send").disabled = false;
    $("text").focus();
  }
});

/** §5.4.2's distinct local states, in words rather than codes. */
function unreadable(m) {
  if (m.failure === messageFlow.UNSUPPORTED) return copy.chat.unsupported;
  if (m.failure === messageFlow.UNDECRYPTABLE) return copy.chat.undecryptable;
  if (m.failure === messageFlow.STALE_SESSION) return copy.chat.staleSession;
  if (m.failure === messageFlow.TAMPERED) return copy.chat.tampered;
  return copy.chat.unreadable(m.failure);
}

$("back-home").addEventListener("click", () => openHome());

// Feedback 14: a conversation has no name until one is given, so the control that
// gives it one may not be called "Rename" the first time.
$("rename").addEventListener("click", async () => {
  const name = prompt(copy.nav.namePrompt, openEntry.name ?? "");
  if (name === null) return;
  if (!openEntry.local) {
    try {
      await session.roster.renameChannel(rootBytesOf(openEntry), name);
    } catch (err) {
      // ⛔ D-173's third. The heading simply did not change, which reads as a control
      // that does not work rather than as a server that did not answer.
      return sayNothingChanged(err, "notrenamed", () => copy.nav.notRenamed);
    }
  }
  clearNotice("notrenamed");
  openEntry.name = name;
  text("chat-name", name || copy.list.unnamed);
  text("rename", name ? copy.nav.rename : copy.nav.giveName);
  session.tabs.announce("roster", { id: TAB_ID });
});

/**
 * §7.3.1a: deleting one conversation is permanent, with no undo, and it
 * propagates to every device. The confirmation says both of those, and it also
 * says the thing the section requires the product NOT to leave out — the roster
 * records forever that a conversation was deleted and on which day.
 */
/**
 * §6.7.1 — tell the other person this conversation has ended.
 *
 * ⚠️⚠️ IT RETURNS WHETHER IT WENT, AND EVERY CALLER USES THAT RATHER THAN
 * ASSUMING. One bounded attempt; a failure must not block or delay the removal,
 * because the person asked for something to be gone from their device and a
 * network error is not a reason to leave it there. What changes on failure is the
 * *sentence*, not the deletion: somebody who may need to warn a friend by other
 * means has to know which of the two happened.
 */
async function tellThemItEnded(entry) {
  try {
    await messageFlow.sendClosing(openChannelFor(entry));
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove one conversation from this device and, in Kept mode, from every device.
 *
 * ⚠️ THE ORDER IS §6.7.1 RULE 1's: the notice needs the ratchet, and everything
 * below this line destroys it.
 *
 * ⚠️ AND THE DELIVERY STOPS BEFORE THE STORE IS EMPTIED, in every tab and not only
 * this one. A stream still running against a channel whose record has just been
 * deleted drains, finds no session, and writes a fresh record — resurrecting the
 * conversation this control just said was gone.
 */
async function removeConversation(entry, { tell = true } = {}) {
  const hash = await rosters.rootHash(rootBytesOf(entry));

  /*
    ⛔⛔⛔ THE COMMIT POINT COMES FIRST — PROTOCOL §6.7.1 RULE 1a (D-173), AND THIS
    BLOCK USED TO BE FOUR STEPS FURTHER DOWN.

    In Kept mode a conversation is removed by writing §7.3.1a's tombstone to the
    roster, and that write is an HTTP PUT that can be refused: §9.2's limit, a stale
    `if_match`, a 5xx, or no network at all. Nothing in this function caught it and
    nothing in `#delete` caught it either, so the throw landed in the middle —
    **after** the closing notice had gone and the stream had been stopped, and before
    anything local was removed. Measured, with the network up and only the roster PUT
    refused: the other person's screen said *"This conversation has ended"*, the
    conversation was still in the list here, and the person who pressed delete was
    told nothing at all.

    ⚠️ THE ALTERNATIVE WAS RULED OUT RATHER THAN OVERLOOKED. §6.7.1 rule 2 says a
    network error is not a reason to leave it on the device — but that rule is about
    the NOTICE. Removing locally without the tombstone is undone by the very next
    merge (§7.3.1 rule 1 drops only what a tombstone covers), which is
    `flow/quarantine.js`'s hole exactly: the conversation goes, the person believes
    it is gone, and it comes back. So the write is the commit, and a refusal
    abandons the whole act with nothing touched.

    ⚠️ Ghost mode and a local-only entry cannot fail this way — `sessionStorage` and
    the quarantine are both on this device — but they stay here so that all three
    modes have one commit point rather than two.

    ⚠️⚠️ THREE MODES, THREE BRANCHES. This read `if (entry.local) … else if (!isGhost())
    …` until 2026-08-24 — two branches for three cases, so Ghost mode fell off the end
    and removed nothing. The channel entry survived, `backToStart()` read it, and the
    conversation reopened: after a SAS mismatch, the conversation with the person who
    is not who they said they were, over the same root, ready for the next send to
    build a fresh session on it. ➡️ **A CONDITION WITH TWO BRANCHES AND THREE MODES
    SILENTLY DOES NOTHING IN THE THIRD**, and `!isGhost()` reads like a guard while
    behaving like a hole. Found by the 2026-08-24 outside review.
  */
  if (entry.local) await session.quarantine.forget(entry.root);
  else if (isGhost()) await session.ghost.removeChannel();
  else await session.roster.removeChannel(rootBytesOf(entry));

  // §6.7.1 rule 1: sent BEFORE the local teardown, which destroys the ratchet it
  // needs. Rule 1a puts the roster write above it and rule 1 still holds — the write
  // destroys nothing this needs.
  const told = tell ? await tellThemItEnded(entry) : null;

  // ⚠️⚠️ AWAITED BEFORE ANYTHING IS DELETED. The two lines below this empty the
  // stores; a drain still running against this channel finds no session, writes a
  // fresh one, and puts back the conversation this control has just told the person
  // is gone. See `syncStreams` for the rule.
  await streams.get(hash)?.live.stop();
  streams.delete(hash);
  session.tabs.announce("gone", { id: TAB_ID, channel: hash });

  // The mode-agnostic pair rather than `vault.*`: Ghost mode has no vault, and
  // this path is now reached from the SAS screen in both modes.
  await store.forgetChannel(session.backend, scopeOfRecords(), rootBytesOf(entry));
  await session.messages.forget(hash);
  seen.delete(hash);
  session.tabs.announce("roster", { id: TAB_ID });
  return told;
}

$("delete").addEventListener("click", async () => {
  const name = openEntry.name || copy.list.unnamed;
  if (!confirm(`${copy.deletion.confirmOne(name)}\n\n${copy.deletion.trace}\n\n${copy.closing.willTell}`)) return;
  let told;
  try {
    told = await removeConversation(openEntry, { tell: true });
  } catch (err) {
    // ⛔⛔ D-173. This `await` had nothing around it, and a refused roster write left
    // the person on a conversation they had just confirmed deleting, with no sentence
    // anywhere and `PUT /api/roster/…: Failed to fetch` in a console nobody has open.
    // ⚠️ THE SCREEN DOES NOT MOVE. Rule 1a means nothing was removed, so going home
    // would be the app agreeing that something happened.
    return sayNothingChanged(err, "notremoved", () => copy.deletion.notRemoved);
  }
  // ⭐ THE WAY A PERSON TAKES THIS PANEL DOWN IS TO SUCCEED AT THE THING IT IS ABOUT.
  // `#notices` carries no dismiss control (D-163's question, still open), so a panel
  // that outlived its own subject would sit above every screen saying a conversation
  // was not deleted next to a list it is no longer in.
  clearNotice("notremoved");
  await openHome();
  // ⚠️ SENT, NOT SEEN. §6.7.1 makes this one bounded attempt and the copy may not
  // promise more than it does.
  notice("closing", () => ({ body: told ? copy.closing.sent : copy.closing.notSent, alarm: told === false }));
});

// ------------------------------------------------------------------ §3 pairing

let steps = [];

/**
 * D-187. What `#step-say` last said, so that a step is announced when it ARRIVES and
 * not every time this function runs.
 *
 * ⚠️ `markStep` is called on ordinary event traffic and can be called with the step
 * that is already current. A live region announces on every content change, including
 * a change to the same words, so without this a person would hear "Finishing" over
 * and over while nothing at all was happening.
 */
let saidStep = null;

function setSteps(list, active) {
  steps = list;
  $("steps").replaceChildren();
  for (const s of list) {
    const li = document.createElement("li");
    li.textContent = s;
    $("steps").append(li);
  }
  // ⚠️ THE FIRST STEP IS NOT AN ANNOUNCEMENT, IT IS PART OF THE SCREEN. The screen is
  // arriving, `only()` has just moved the cursor onto it, and the reader is about to
  // read it top to bottom — the step is in there. Saying it a second time over that
  // is noise. Arm the guard with it, and speak only what comes AFTER.
  saidStep = active;
  text("step-say", "");
  markStep(active);
}

const markStep = (active) => {
  // D-187 finding 2, measured 2026-09-01: the list advanced from "waiting for your
  // friend to open it" to "finishing" — the friend had arrived and the pairing was
  // working — and nothing announced it, because no text changed and no panel was
  // swapped. This is the text change. `#step-say` is `role="status"`, so it is read
  // at the end of the current sentence rather than over the top of it.
  //
  // ⚠️ GUARDED ON `indexOf` FINDING THE STEP. `steps` holds the RENDERED STRINGS
  // (see `RERENDER.progress`, which is `null` for exactly this reason), so a lookup
  // that misses returns -1 — and announcing on -1 would speak a step that is not in
  // the list. If it misses, nothing is said, which is what the screen already does.
  const at = steps.indexOf(active);
  if (at >= 0 && active !== saidStep) {
    saidStep = active;
    text("step-say", active);
  }
  [...$("steps").children].forEach((li, i) => {
    const on = i === at;
    li.classList.toggle("on", on);
    // ⚠️ D-186. `.on` IS A COLOUR, AND A COLOUR IS NOT IN THE ACCESSIBILITY TREE.
    // Which of the three steps is the current one was carried by the highlight and
    // by nothing else, so a person who cannot see the highlight was told the steps
    // and never told where in them they were. `aria-current` is the same fact in the
    // place a screen reader reads.
    //
    // ⚠️ SET **AND REMOVED**. A list in which every step has been current at some
    // point and none has had the attribute taken away is worse than one with no
    // attribute at all: it says three things are current, which is false.
    if (on) li.setAttribute("aria-current", "step");
    else li.removeAttribute("aria-current");
  });
};

/**
 * Pairing produced a channel root. §7.3.3 case 2: this is one of the five
 * occasions the roster may be written, and it has to happen before the
 * conversation is usable — a root that is not in the roster is a conversation this
 * device forgets the moment the tab closes.
 */
async function succeed(result) {
  // §2.1.2 rule 4, and D-124: the link and its symbol are spent the moment this runs.
  clearPairingSurface();

  // ⚠️ Only a VERIFIED tripwire is an alarm. The server sets its flag whenever a
  // second claim arrives, and it cannot do better — it has no key with which to
  // check one (§3.5). An unverified flag means somebody who watched `pairing_id`
  // go past forged a claim, which is a nuisance and not an interception.
  //
  // ⚠️⚠️ AND IT IS RECORDED, NOT MERELY SHOWN (§3.5, 0.9.22). Until this line the
  // evidence lived in `result` and died with the screen: every one of §3.6.2's
  // three answers called `show("tripwire", false)`, so the product's only
  // intrusion alarm was cleared by pressing a button the product itself offers —
  // including "not yet", which §3.6.2 expressly permits. It travels into the
  // channel write below and is merged by §7.3.1 rule 7 thereafter.
  const tripwire = Boolean(result.tripwire?.verified);

  /**
   * ⚠️ NO AUTOMATIC NAME, AND THAT IS FEEDBACK 14's REAL SUBJECT. Every channel
   * used to be created as `Paired 13/08/2026`, which is why the control beside it
   * said "Rename" — there was always a name to re-name, so the honest label could
   * never appear. **A placeholder written into the DATA is indistinguishable from
   * something the user chose**, and it also travels to their other devices through
   * the roster and takes a merge rule (§7.3.1 rule 4) with it.
   *
   * The date still appears — the list renders it beside "no name yet", from
   * `created`, which the roster already carries. It is presentation now, so
   * naming the conversation replaces it instead of competing with it.
   */
  const name = "";

  // ⭐ §7.6, AND THIS LINE IS GHOST MODE'S ACTUAL GUARANTEE. "Nothing is written to
  // the roster" is not a property of the storage layer — it is the property of not
  // executing the call below. §7.3.3 case 2 is one of the five occasions a roster
  // may be written, and this mode simply never reaches it: no `roster_id` is minted,
  // no blob is created, and the server is never told that this device holds a
  // conversation at all.
  if (isGhost()) {
    const entry = await session.ghost.setChannel({
      root: result.channelRoot,
      role: result.role,
      name,
      tripwire,
    });
    paired = { ...entry, rootBytes: result.channelRoot };
  } else {
    // §3.4.1c rule 6: `linkMemo` is written WITH the write that creates the channel and
    // never in one of its own — the same requirement, and the same reason, as §3.5's
    // `tripwire` beside it. A second write would leave a window in which the channel
    // exists and the identity cannot recognise the link that made it.
    await session.roster.addChannel({
      root: result.channelRoot,
      name,
      role: result.role,
      tripwire,
      linkMemo: result.linkMemo ?? null,
    });
    const entry = session.roster.channel(result.channelRoot);
    paired = { ...entry, rootBytes: result.channelRoot };
    session.tabs.announce("roster", { id: TAB_ID });
  }

  /**
   * ⚠️⚠️ THE SCREEN COMES LAST, AND IT USED TO COME FIRST (D-165, outside review slice
   * C #2). §3.6.2's three answers all begin `const entry = paired ?? revisiting; if
   * (!entry) return backToStart()` — and `paired` is not assigned until the write
   * above resolves. So between the digits appearing and the roster write landing, all
   * three answers were no-ops against `null`.
   *
   * ⛔ THE ONE THAT MATTERS IS *"THIS IS NOT THE PERSON"*. A user who compares the
   * digits, sees a mismatch and presses it in that window gets `backToStart()` with no
   * deletion — and the write then completes and puts the channel in the roster anyway.
   * The window is a round trip, and the scenario in which somebody presses that button
   * is by construction one where the server is not on their side and can hold the
   * response open for as long as it likes.
   *
   * ⭐ AND A FAILED WRITE NOW NEVER SHOWS THE SCREEN AT ALL. `addChannel` throwing
   * lands in the caller's `failWith`, which is the honest place for it: a decision
   * screen offered over a channel that was not stored is a decision about nothing.
   */
  showSas(result.sas);
  showPairingTripwire(tripwire);
  only("verify");
}

/**
 * §3.5's alarm on §3.6.2's screen — and it is a FUNCTION because that screen is
 * reached TWICE (D-167).
 *
 * ⛔⛔ THE SECOND ENTRANCE DID NOT HAVE IT. `succeed()` showed the panel inline after
 * pairing; `verify-now`, which is the same screen reached from inside a conversation,
 * showed the digits and no alarm — and that is the screen where somebody who answered
 * *"not yet"* finally decides. Hannu walked exactly that path on 2026-08-26, chose
 * "yes", and was never shown that a second party had held the invitation.
 *
 * ⭐ AND THE RULE WAS WRITTEN TWO LINES BELOW THE BRANCH THAT IGNORED IT: the comment
 * on `showSas` already said the screen *"is reached twice: right after pairing, and
 * again from inside a conversation whenever the person is finally able to ask."*
 * ➡️ D-165's lesson inside the code D-165 shipped, which is why the repair is a single
 * function and not a second copy of the same three lines.
 *
 * ⚠️ IT TAKES A VALUE AND ALWAYS SETS ONE. Showing without ever hiding would leave a
 * verified alarm standing over the NEXT pairing — and §3.5's own reasoning says a false
 * alarm is the worst outcome available: *"the one alarm this design has would become the
 * one thing users learn to dismiss."*
 */
function showPairingTripwire(on) {
  if (on) text("tripwire-body", copy.pairing.tripwire);
  show("tripwire", on);
}

/**
 * §3.6.2's screen, which is reached twice: right after pairing, and again from
 * inside a conversation whenever the person is finally able to ask.
 *
 * ⭐ THE SECOND ROUTE EXISTS BECAUSE THE DIGITS ARE RECOMPUTABLE. `d` derives from
 * the channel root (§3.6), which this device holds for the life of the
 * conversation — so "not yet" is a usable answer rather than a polite way of
 * saying never, and that is what makes removing the gate (D-081) honest rather
 * than a quiet weakening.
 */
function showSas(digits) {
  text("sas", digits.replace(/(\d{3})(\d{3})/, "$1 $2"));
  text("sas-ask", copy.pairing.sas);
  // ⚠️ `sas-how` and `sas-later-note` ARE GONE AND THEIR ADVICE IS NOT (D-110).
  // Three paragraphs of correct guidance sat on a screen whose whole job is to ask
  // one question and take one of three answers. Both moved into
  // `terms["six-digits"]`, which this sentence marks — so the person who wants the
  // reasoning gets all of it, and the person who just wants to answer can.
  prose("sas-what", copy.pairing.sasWhat);
}

/**
 * The conversation this SAS screen is about, and where to go afterwards.
 *
 * `paired` is set by `succeed()` — a channel that has just been created and is not
 * open yet. `revisiting` is set by the in-chat control, where the conversation is
 * already on screen behind this panel.
 */
let paired = null;
let revisiting = null;

/** §3.6.2: the comparison was made and it passed. */
$("sas-ok").addEventListener("click", async () => {
  show("tripwire", false);
  const entry = paired ?? revisiting;
  paired = null;
  revisiting = null;
  if (!entry) return backToStart();
  // ⚠️ THE WRITE IS AWAITED BEFORE THE SCREEN CHANGES. It is a §7.3.3 case 2
  // roster write and it can fail — a conversation that showed "compared" and then
  // showed "not compared" on the next device would be the worst of both.
  try {
    if (isGhost()) await session.ghost.setVerified();
    else if (!entry.local) await session.roster.setVerified(rootBytesOf(entry));
    entry.verified = true;
  } catch (err) {
    text("sas-note", describeIdentity(err));
    return;
  }
  session?.tabs.announce("roster", { id: TAB_ID });
  await openConversation(entry);
});

/** §3.6.2: not now. Nothing is asserted, nothing is stored, the chat opens. */
$("sas-later").addEventListener("click", async () => {
  show("tripwire", false);
  const entry = paired ?? revisiting;
  paired = null;
  revisiting = null;
  if (entry) await openConversation(entry);
  else await backToStart();
});

/**
 * §3.6.2's third answer, which is not a state but a deletion.
 *
 * ⚠️ IT DOES NOT SEND §6.7.1's CLOSING NOTICE. The whole premise of pressing this
 * is that the other end is not the person it was meant for, and a courtesy message
 * to somebody you have just identified as an interceptor tells them their
 * interception worked and that you noticed. The channel simply stops.
 */
$("sas-wrong").addEventListener("click", async () => {
  const entry = paired ?? revisiting;
  if (!entry) return backToStart();
  if (!confirm(copy.pairing.wrongConfirm)) return;
  try {
    await removeConversation(entry, { tell: false });
  } catch (err) {
    // ⛔⛔⛔ THE ONE OF D-173'S THREE THAT MATTERS MOST. This is the control a person
    // presses having just decided the far end is NOT their friend, and a refused
    // roster write left them believing they had destroyed a conversation with an
    // interceptor. They had not, and nothing said so.
    return sayNothingChanged(err, "notremoved", () => copy.deletion.notRemovedWrong);
  }
  // ⚠️ AFTER THE REMOVAL, NOT BEFORE. These three lines stood above the `await` and
  // that is what made the failure unrecoverable as well as silent: `paired` and
  // `revisiting` were already `null`, so the verify screen the person was left
  // standing on no longer knew which conversation its three answers were about.
  clearNotice("notremoved");
  paired = null;
  revisiting = null;
  show("tripwire", false);
  await backToStart();
});

/**
 * §3's failures, as a person reads them.
 *
 * ⚠️⚠️ IT USED TO FALL BACK TO `err.message`, AND FEEDBACK 13 IS WHAT THAT LOOKS
 * LIKE FROM THE OUTSIDE: **"429 rate_limited"**, on screen, under "Pairing did not
 * complete". §9.2's limiter had worked exactly as designed and the product reported
 * it as a crash with an HTTP status in it.
 *
 * ➡️ **A lookup table keyed by an error code fails silently on the code nobody
 * thought of, and the fallback is where that failure becomes visible.** So there is
 * no longer a fallback to the exception: the sentence a person reads is always one
 * of ours, and whatever the machine said goes in the detail line underneath — which
 * is where `reason:` already lived, and which is read by testers and nobody else.
 */
function failWith(err) {
  noteProblem(err);

  // ⭐⭐⭐ FEEDBACK 17: IF THE INVITE LINK IS ON SCREEN AND THE PAIRING IS ONLY
  // INTERRUPTED, DO NOT TAKE THE PERSON OFF IT. Hannu lost his invite link to a
  // fourteen-second network drop — the pairing survived, rule 10 kept everything
  // needed, and the interface still swept the one thing he had to send somebody.
  //
  // ⚠️⚠️ `clearPairingSurface()` BELOW IS D-124 AND ITS REASON WAS *"the link on it is
  // dead"*. That was true when every exit from §3 was an ending. Rule 10 made some
  // exits survivable this morning and nothing asked this line whether it still
  // applied — the fourth time in one day that an old behaviour went wrong because
  // something changed WHO REACHES IT.
  //
  // ⚠️ `resume()` never re-emits the link, so a wipe here is permanent: there is no
  // later screen that can put it back. Staying is not a nicety, it is the only moment
  // the link exists.
  const paused = !flow.endsThePairing(err);
  const secretShown = !$("linkbox").classList.contains("hidden") || !$("codebox").classList.contains("hidden");
  if (paused && secretShown) {
    // ⚠️ D-169 — WHAT HAPPENED, NOT THE SENTENCE ABOUT IT. This handed `offerToResume`
    // a finished string, which is a sentence in whichever language was in force when it
    // was built and can never become the other one. D-152 made exactly this move inside
    // `flow/roster.js`: the reason travels, and the words are chosen where they are said.
    void offerToResume({ interrupted: true, failure: err?.reason ?? "" });
    return;
  }

  // D-124: this is an exit from the link screen too, and the link on it is dead.
  clearPairingSurface();
  only("failure");

  // ⚠️⚠️ NOT EVERY EXIT FROM §3 IS A FAILURE, AND THIS PANEL IS SHAPED LIKE ONE.
  //
  // ⭐⭐⭐ THE TEST IS `flow.endsThePairing`, WHICH IS THE SAME FUNCTION THAT DECIDES
  // WHETHER THE RECORD SURVIVES, AND FEEDBACK 16 IS WHY IT HAS TO BE. The first
  // version of this asked `err.reason === "still_waiting"` — the one non-terminal case
  // that existed on the day it was written. A dropped network is also non-terminal:
  // §3.4.1b rule 10 keeps the record, the pairing is completely recoverable, and this
  // panel announced "Pairing did not complete" in an alarm over the top of it. Hannu
  // took the network away for sixteen seconds, was told it had failed, and recovered
  // it anyway by working out what the screen had not told him.
  //
  // ➡️ **THE RECORD AND THE SCREEN WERE CLASSIFYING THE SAME ERROR BY DIFFERENT
  // RULES.** One classifier, two consumers, and neither may have its own copy of it.
  const waiting = err?.reason === "still_waiting";

  // ⚠️⚠️ §3.4.1c RULE 3 SAYS *"rather than reporting a failure"*, AND THE PANEL IS THE
  // REPORT. `own_link` is terminal — the record classifier is right about that, this
  // device genuinely cannot finish — so without this line it would arrive under
  // "Pairing did not complete", in the alarm colours this product reserves for telling
  // somebody they are being attacked, because they opened their own invite link on
  // their own second device. That was the D-174 screen, one step milder.
  //
  // ⭐ THE THIRD BRANCH IS WHY THIS IS A FUNCTION NOW. A fourth arm on the ternary that
  // feedback 16 already had to correct once is how the next case gets bolted on
  // wrongly; the reasons are listed where a reader can see all of them at once.
  // ⚠️ BOTH OF §3.4.1c's OUTCOMES, not just the one that normally lands here.
  // `own_channel` reaches this panel only when the roster could not produce the entry to
  // open — rare, and still not a failure: the heading is true of it either way, and an
  // alarm over "you already have this conversation" is the D-133 shape.
  const ownLink = err?.reason === "own_link" || err?.reason === "own_channel";
  text("failure-title", failureTitleFor({ ownLink, paused, waiting }));
  $("failure").classList.toggle("alarm", !paused && !ownLink);

  const written = copy.pairing.failure[err?.reason];
  text("failmsg", written ?? (paused ? copy.pairing.interruptedUnknown : copy.pairing.failureUnknown));
  text("failcode", detailOf(err));
  text("fail-back", session && !isGhost() ? copy.nav.toConversations : copy.nav.toStart);

  // Rule 11 does not merely permit the offer here, it requires it: "it MUST stop
  // polling, keep the record, and present rule 2's carry-on offer". Without this the
  // person would have to LOCK and unlock again to reach the one button they want,
  // because `offerToResume` otherwise runs only at unlock.
  //
  // ⚠️ `interrupted: true` PICKS DIFFERENT SENTENCES. The unlock ones explain the
  // situation by naming its cause — "this browser closed" — which is false here and
  // was shown to Hannu on a browser that had not closed (feedback 16).
  if (paused) void offerToResume({ interrupted: true });
}

/**
 * Which heading the §3 exit panel wears.
 *
 *   ownLink   §3.4.1c rule 3 — not a failure, and the rule forbids reporting one
 *   !paused   an ending: `endsThePairing` said the record does not survive
 *   waiting   §3.4.1b rule 11 — nothing ran out, this page stopped watching
 *   else      rule 10 — the attempt broke and the pairing is still finishable
 */
function failureTitleFor({ ownLink, paused, waiting }) {
  if (ownLink) return copy.pairing.ownLinkTitle;
  if (!paused) return copy.pairing.failureTitle;
  return waiting ? copy.pairing.pausedTitle : copy.pairing.interruptedTitle;
}

/**
 * What the machine said, for the small print. Never a sentence, never a promise.
 *
 * ⚠️ THE LAST RESORT IS `name`, NOT `message`, AND THAT CHANGED ON 2026-08-13.
 * `MissingPrimitiveError`'s message is three lines citing `PROTOCOL.md §0.2` and
 * `client/curve/README.md`; `RosterFailure`'s cites §7.3.3. A detail line is small
 * print, not a licence to paste the repository at somebody — the same rule the
 * sentence above it follows.
 */
function detailOf(err) {
  const raw = err?.reason ?? (err?.status ? `${err.status} ${err.code ?? ""}`.trim() : err?.name ?? "");
  return raw ? `reason: ${raw}` : "";
}

$("fail-back").addEventListener("click", () => backToStart());

/**
 * Whether §2.1.2's symbol is currently drawn. Rule 3: it is drawn on REQUEST.
 *
 * ⚠️ It is a variable rather than a read of the panel's class, on purpose. A control
 * whose behaviour depends on reading back a class it set is one cascade collision away
 * from doing the opposite of what it says — which is D-104, where `classList.contains`
 * would have passed on a button that never rendered.
 */
let qrShown = false;

/**
 * §2.1.2 rule 4 — put away every rendering of a spent secret, in one place.
 *
 * ⚠️⚠️ THE RULE THIS IMPLEMENTS WAS HALF-PRESENT WHEN §2.1.2 WAS WRITTEN, AND WRITING
 * THE SECTION IS WHAT EXPOSED THAT (D-124). Rule 4 says the symbol goes "by the same
 * rule as the link's own text" — and the link's own text was cleared in exactly one
 * place, at the top of the next pairing. A pairing that SUCCEEDED, was cancelled or
 * failed left the spent link sitting in the DOM underneath the screen that replaced it,
 * for the life of the document.
 *
 * The secret is dead by then in every one of those paths (§3.4.1's DELETE has gone out,
 * or the handshake has completed and `L` derives nothing further), so this is hygiene
 * and not a leak — which is precisely why it had survived: nothing observable was ever
 * wrong. ⭐ A rule stated as "the same as X" is worth exactly what X is worth, and this
 * is the second time in this product that writing a specification sentence about an
 * existing rule found that the rule was narrower than the sentence.
 */
function clearPairingSurface() {
  text("link", "");
  text("code-text", "");
  $("code-spell").replaceChildren();
  hideQr();
}

/** Rule 4's other half: the pixels, and the buffer they were drawn into. */
function hideQr() {
  qrShown = false;
  show("qrbox", false);
  qrs.clear($("qr"));
  text("qr-what", "");
  text("qr-room", "");
  text("to-qr", copy.pairing.toQr);
}

let controller = null;

/**
 * The run in flight, so that switching to §2.2's code can WAIT for the pairing it
 * just aborted before painting over it.
 *
 * ⚠️ Without this the two screens race: `initiate` rejects on a microtask and paints
 * the failure panel, `runInitiate` paints the progress panel, and which one a person
 * ends up looking at depends on how long a `fetch` took to notice it was aborted.
 * `runInitiate` catches its own errors, so awaiting this always resolves.
 */
let pairingRun = null;

async function runInitiate({ as = "link" } = {}) {
  const spoken = as === "code";
  only("progress");
  // ⚠️ THE OFFER IS SUPERSEDED THE MOMENT A PAIRING STARTS BY ANY OTHER ROUTE. A
  // notice is a sibling of the panels, so `only()` does not touch it — a real-browser
  // probe caught the completed six digits sitting under a live "Carry on / Cancel
  // that invite link", where Cancel would have sent §3.4.1's DELETE for a pairing
  // that had already finished. Rule 5 replaces the record here anyway.
  clearNotice("resume");
  clearNotice("not-durable");
  show("linkbox", false);
  show("codebox", false);
  clearPairingSurface();
  // ⚠️ SET HERE AND NOT IN THE STATIC BLOCK, BECAUSE THEY DEPEND ON THE MODE. Ghost
  // cannot resume (§3.4.1b rule 2), so it keeps the old "keep this tab open" warning
  // while Kept now says the opposite. A string chosen once at load could only have
  // been right for one of them.
  text("link-keep", isGhost() ? copy.pairing.keepOpen.ghost : copy.pairing.keepOpen.kept);
  text("code-keep", isGhost() ? copy.pairing.code.keep.ghost : copy.pairing.code.keep.kept);
  text("link-once", copy.pairing.linkIsOnce);
  text("copy", copy.pairing.copy);
  text("cancel", copy.pairing.cancel);
  // ⚠️ THE FIRST STEP SAID *"Doing the work the server asks for"* — a true
  // description of §9.1's proof-of-work and nothing a person can use (feedback
  // 11). A progress step says what the wait is FOR, not what the machine is doing.
  const preparing = spoken ? copy.pairing.code.step : copy.pairing.step.preparing;
  setSteps([preparing, copy.pairing.waiting, copy.pairing.step.finishing], preparing);
  controller = new AbortController();
  busyPairing = true;
  // D-085 and feedback 2 — see `measurements.link`. The clock starts here because
  // this is when the person starts waiting.
  const startedAt = performance.now();
  try {
    const result = await flow.initiate({
      api,
      origin: location.origin,
      as,
      storage: pairingStore(),
      // §3.4.1c rule 5 — the invite memo goes down BEFORE the offer is published, and a
      // refusal abandons the creation. `flow/pair.js` owns that ordering; this passes
      // it the thing to write into.
      links: linksFor(),
      signal: controller.signal,
      onEvent: (e) => {
        // §9.1's search, on its own clock — see `measurements`. It is the only
        // part of "making the link" that can be tens of seconds, so it is the
        // only part worth a row of its own.
        if (e.type === "proof") measurements.proof = { ms: e.ms, bits: e.bits };
        if (e.type === "link") {
          measurements.link = { ms: Math.round(performance.now() - startedAt), what: "making it" };
          text("link", e.link);
          show("linkbox");
          markStep(copy.pairing.waiting);
        }
        if (e.type === "code") {
          // ⚠️ LABELLED APART FROM THE LINK'S, like the joiner's is. It is the same
          // §9.1 search and the same round trips, but a row that read "making it"
          // for both would let a code's number answer a question about a link.
          measurements.link = { ms: Math.round(performance.now() - startedAt), what: "making a code" };
          showCode(e.code);
          show("codebox");
          markStep(copy.pairing.waiting);
        }
        if (e.type === "claimed") markStep(copy.pairing.step.finishing);
        if (e.type === "not_durable") warnNotDurable();
      },
    });
    await succeed(result);
  } catch (err) {
    // ⚠️ SWITCHING TO A CODE ABORTS THIS RUN ON PURPOSE AND MUST NOT PAINT A
    // FAILURE, however briefly. `noteProblem` already refuses to record it; this is
    // the other half, and without it a person who pressed a button we offered them
    // sees "Pairing did not complete" flash past on the way to the thing they asked
    // for.
    if (err?.reason !== "switching") failWith(err);
  } finally {
    busyPairing = false;
  }
}

/**
 * §2.2's code and §2.2b's spelling, rendered.
 *
 * ⚠️ EVERY NODE IS BUILT WITH `createElement`. `require-trusted-types-for 'script'`
 * is on this page and `innerHTML` does not degrade under it — it throws and takes
 * the screen down (2026-08-12, in writing, wrongly). `textContent` on a created
 * element is not a sink and is the whole of what is needed here.
 */
function showCode(spoken) {
  text("code-text", codes.format(spoken));
  const host = $("code-spell");
  host.replaceChildren();
  for (const group of codes.spell(spoken)) {
    const line = document.createElement("div");
    line.textContent = group.join(" ");
    host.append(line);
  }
}

async function runJoin(fragment) {
  // §2.1's strip, SECOND. `takeLinkFromUrl` did it at the read, which is what the
  // section actually asks for; this line stays because it costs nothing and it is
  // the one that covers a link reaching here by some route that did not come
  // through the address bar. It must never be the only one again — see the note on
  // `takeLinkFromUrl` for what "only one" cost.
  history.replaceState(null, "", location.pathname);

  only("progress");
  // Same reason as `runInitiate` — and this is the route the probe came in on, since
  // opening your own link is now a resumption rather than a join.
  clearNotice("resume");
  const { checking, claiming, waitingOther, done } = copy.pairing.step;
  setSteps([checking, claiming, waitingOther, done], checking);
  busyPairing = true;
  const startedAt = performance.now();
  try {
    const result = await flow.join({
      api,
      link: fragment,
      storage: pairingStore(),
      // §3.4.1c rule 1: consulted before any claim and before §3.5's judgement.
      links: linksFor(),
      onEvent: (e) => {
        if (e.type === "claimed") {
          // ⚠️ LABELLED, BECAUSE IT IS NOT THE SAME QUANTITY AS THE INITIATOR'S.
          // This side does no proof-of-work, so it is milliseconds where the other
          // is seconds — and an unlabelled row would let somebody copy a joiner's
          // 21 ms in answer to a question about a four-second wait.
          measurements.link = { ms: Math.round(performance.now() - startedAt), what: "opening it" };
          markStep(waitingOther);
        }
        if (e.type === "revealed") markStep(done);
        if (e.type === "not_durable") warnNotDurable();
      },
    });
    await succeed(result);
  } catch (err) {
    // §3.4.1c rule 2: *"SHOULD open the conversation it already has"*. This is not a
    // failure and must not be painted as one — the person followed an invite link that
    // already did its work, and the honest answer is the conversation it made.
    //
    // ⚠️ THE NOTICE IS NOT OPTIONAL. Without it the screen simply changes and the
    // person is left to guess why the invite link did nothing; D-163's whole lesson is
    // that a thing which happens without a sentence reads as a thing that did not
    // happen. It goes up BEFORE the open, so it survives onto the conversation.
    //
    // ⚠️ AND IT FALLS THROUGH IF THE ENTRY IS NOT THERE. `own_channel` is raised from a
    // memo the roster holds, so the channel is there by construction — but a
    // construction is not a guarantee, and `openConversation(undefined)` is a blank
    // screen where a sentence belongs.
    const already = err?.reason === "own_channel" ? entryByRoot(err.root) : null;
    if (already) {
      notice("ownlink", () => copy.pairing.failure.own_channel);
      await openConversation(already);
      return;
    }
    failWith(err);
  } finally {
    busyPairing = false;
  }
}

/**
 * A roster entry by its encoded root, ready for `openConversation`.
 *
 * ⚠️ `channels()` ALREADY ATTACHES `rootBytes`, which every caller of
 * `openConversation` has otherwise had to decode for itself. Ghost mode has no
 * roster and no list, so it has nothing to look in — and §3.4.1c rule 8 means it
 * never asks.
 */
function entryByRoot(root) {
  if (!root || isGhost() || !session?.roster) return null;
  try {
    return session.roster.channels().find((c) => c.root === root) ?? null;
  } catch {
    // ⚠️ `channels()` REFUSES ON A ROSTER THAT IS NOT OPEN, and this runs inside a
    // `catch`. A throw from here escapes as an unhandled rejection and takes the screen
    // with it — over a lock that landed mid-join, which is a race and not a fault.
    // Answering `null` sends the caller to the panel, which is the honest second-best.
    return null;
  }
}

// ⚠️ Wrapped rather than passed directly: a listener is called with the click
// event, and `runInitiate` now takes options. `{ as }` off a PointerEvent is
// `undefined` and would default correctly today — which is exactly the kind of
// accident that stops being correct the first time an option gains a truthy default.
$("create").addEventListener("click", () => {
  pairingRun = runInitiate();
});

// The same act from the bar's menu, for the person who does not find a floating button.
// ⚠️ THE HANDLER IS DUPLICATED RATHER THAN THE CLICK FORWARDED. `$("create").click()`
// from here would work today and would silently acquire whatever `#create` gains later
// — a hidden state, a confirmation — without this path being considered.
$("menu-create").addEventListener("click", () => {
  // ⛔ HIDDEN **AND** REFUSED, over the same set. Hiding it is the honest interface;
  // refusing it is the guard, because a hidden control is one `classList` change away
  // from being a live one and this project has already learned that a rule stated at a
  // single call site is not a rule.
  if (GATED.has(shownScreen)) return;
  pairingRun = runInitiate();
});

// ------------------------------------------- §2.1, a link that arrives after boot

/**
 * ⚠️⚠️ THIS LISTENER IS FEEDBACK 7, AND THE BUG IT CLOSES IS ONE LINE FURTHER DOWN
 * THIS FILE: `if (location.hash.slice(1)) pendingJoin = location.href` **runs once,
 * at boot, and nothing ever looked again.**
 *
 * Pasting a link into the address bar of a tab that is already on `/c` changes only
 * the fragment. That is a same-document navigation: the browser fires `hashchange`,
 * does not reload, does not re-run a module — and the app sat there. Opening a NEW
 * tab worked, and pressing any link first worked, which is exactly what made it
 * present as a mystery rather than as a bug. Both of those are full loads.
 *
 * ⭐ `history.replaceState` does NOT fire `hashchange`, so §2.1's strip in `runJoin`
 * cannot re-enter this. That is a property of the platform rather than of the code
 * here, which is why it is written down: it is the kind of thing a later refactor
 * to `location.hash = ""` would break silently, and the loop it would make is one
 * that re-joins a spent link forever.
 */
window.addEventListener("hashchange", () => {
  const link = takeLinkFromUrl();
  if (!link) return;
  void followLink(link);
});

/**
 * §2.1: read the link out of the address bar and strip it IN THE SAME ACT.
 *
 * ⚠️⚠️ THE STRIP USED TO LIVE IN `runJoin`, AND THAT IS TOO LATE BY MINUTES. Reading
 * happens at boot; `runJoin` does not start until the person has unlocked — or
 * CREATED — a KEY, which is eight words to write down and an Argon2 to wait through.
 * `L` sat in the address bar, in the current history entry, and in reach of any
 * screenshot or session restore for that whole time. Found by the 2026-08-24 outside
 * review as its only I1 break, and the exposure is longest for a first-time user,
 * who is the person least able to notice it.
 *
 * ⚠️ THE TWO EARLY RETURNS IN `followLink` LEFT IT THERE TOO — busy pairing, and no
 * session yet. Stripping AT THE READ is what makes those unreachable as leaks,
 * rather than each of them having to remember.
 *
 * ⭐ `history.replaceState` does NOT fire `hashchange`, so this cannot re-enter the
 * listener above. That is a property of the platform rather than of this code, which
 * is why it is written down in both places: a later refactor to `location.hash = ""`
 * would make a loop that re-joins a spent link forever.
 */
function takeLinkFromUrl() {
  if (!location.hash.slice(1)) return null;
  const link = location.href;
  history.replaceState(null, "", location.pathname);
  return link;
}

/** A pairing is running in this document, so a second link has nowhere to go. */
let busyPairing = false;

/**
 * Open a link, from wherever it arrived — the address bar, the paste field, or the
 * document this tab was opened with.
 *
 * ⚠️ IT MUST NOT INTERRUPT A PAIRING IN PROGRESS. §3 gives one document one pairing
 * session at a time, and `flow/pair.js` keeps the in-flight record under a single
 * key — a second `join` starting on top of the first would overwrite the record for
 * a session that is still live, which is §3.4.1's abandonment with no DELETE.
 */
async function followLink(link) {
  if (busyPairing) {
    notice("linkbusy", () => copy.openLink.busy);
    return;
  }
  if (!session) {
    pendingJoin = link;
    showGate();
    return;
  }
  // §7.6 holds one conversation per tab, so a link arriving in a tab that already
  // has one is told where it can go rather than silently ignored.
  if (isGhost()) {
    if (ghostInert) return;
    if (await session.ghost.channel()) {
      notice("ghostbusy", () => copy.ghost.linkElsewhere);
      await backToStart();
      return;
    }
  }
  await runJoin(link);
}

/**
 * §2.1's link, pasted rather than navigated to — feedback 11's *"neutral page"*.
 *
 * ⭐ IT IS THE BETTER OF THE TWO ROUTES AND NOT ONLY THE MORE DISCOVERABLE ONE.
 * Typing a link into the address bar hands the secret to the browser's own history
 * and its omnibox suggestions, where §2.1's `history.replaceState` cannot reach it —
 * that strip removes the fragment from the page's entry, not from what the user
 * typed. A field on the page never enters that store at all.
 */
let pasteReturn = "gate";

function openPasteLink(from) {
  pasteReturn = from;
  $("paste-link").value = "";
  text("paste-note", "");
  only("paste");
  $("paste-link").focus();
}

$("go-paste").addEventListener("click", () => openPasteLink("gate"));
$("home-paste").addEventListener("click", () => openPasteLink("home"));
$("paste-back").addEventListener("click", () => (pasteReturn === "home" ? openHome() : showGate()));

/**
 * Why a pasted link is checked before it is used, and navigation is not.
 *
 * ⚠️⚠️ THE ORIGIN CHECK IS THE ONE THAT MATTERS AND IT IS NOT COSMETIC.
 * `pairing.parseLink` accepts anything with a fragment, so a link belonging to a
 * DIFFERENT deployment of this protocol would be turned into a `pairing_id` and
 * claimed **against this server** — which tells this server about a pairing meant
 * for another one, and burns the friend's link doing it. A browser navigating to a
 * link cannot make that mistake, because it goes to the host in the link. A field
 * on this page can, and that is the whole price of having one.
 *
 * The other two answers are ordinary: a fragment that was cut off in transit is
 * §2.1's known failure and deserves its own sentence, and anything else is not a
 * link at all.
 *
 * ⚠️ SINCE §2.2 THIS FIELD ALSO TAKES A SPOKEN CODE, and the branch is on the SHAPE
 * of the string rather than on whether it parses. A code with one character misheard
 * is not link-shaped, so routing on validity would send it down the link path and
 * answer it with a complaint about a missing `#` — to the one person in this product
 * who is holding a telephone rather than a screen. The origin check does not apply
 * to a code and cannot: a code names no host, which is the point of it.
 */
/**
 * What is wrong with what was pasted, or `null` if nothing is.
 *
 * ⚠️⚠️ IT RETURNS `keep` AS WELL AS A SENTENCE, AND THAT SECOND FIELD IS §2.1.1's MUST
 * MEETING §2.2's TELEPHONE (D-165). The rule is *"it MUST clear the field as soon as
 * the value is read"*, and its reason is stated: *"an `<input>` value is a live copy of
 * `L` that survives every screen change."* The one string in this function that is
 * provably NOT a live copy of anything is a code SHORTER than §2.2's sixteen
 * characters — it cannot be a complete secret, and it is the only case where the
 * person is still mid-typing. Losing that to a typo would mean asking a friend on a
 * telephone to read sixteen characters out again, which is the failure this route
 * exists to avoid. Everything else goes, including a code that is too LONG: a superset
 * of a secret is a secret.
 */
function linkProblem(typed) {
  const no = (note, keep = false) => ({ note, keep });
  if (!typed) return no(copy.openLink.notALink);
  if (typed.includes("/") || typed.includes(":")) {
    let url = null;
    try {
      url = new URL(typed);
    } catch {
      // A link pasted without its scheme — some chat clients strip it on copy.
      try {
        url = new URL(`https://${typed}`);
      } catch {
        url = null;
      }
    }
    if (!url) return no(copy.openLink.notALink);
    if (url.origin !== location.origin) return no(copy.openLink.wrongSite);
    if (!url.hash.slice(1)) return no(copy.openLink.noSecret);
    return null;
  }
  if (typed.startsWith("#")) return typed.slice(1) ? null : no(copy.openLink.noSecret);

  // §2.2. The count comes from `normalise`, so dashes, spaces and lower case are
  // already gone and never reach the arithmetic the person is shown.
  const chars = codes.normalise(typed).length;
  if (chars === codes.CODE_CHARS) return null;
  return chars < codes.CODE_CHARS
    ? no(copy.openLink.codeShort(chars), true)
    : no(copy.openLink.codeLong(chars));
}

$("paste-go").addEventListener("click", async () => {
  const typed = $("paste-link").value.trim();
  const problem = linkProblem(typed);
  // ⚠️⚠️ OUT OF THE FIELD BEFORE ANYTHING ELSE HAPPENS — AND FOR TWO YEARS THAT MEANT
  // "BEFORE ANYTHING ELSE ON THE PATH THAT WORKED" (D-165, outside review slice C #7).
  // §2.1.1 says the field MUST be cleared as soon as the value is READ, and the value
  // is read on the line above. The rejection returned first, so a link kept its `L` in
  // a live `<input>` for the rest of the document's life — and the rejection §2.1.1
  // spends its OTHER bullet on, a valid link belonging to a different deployment, is
  // exactly the one that left a real secret sitting there. ⭐ The comment stating the
  // rule was already here; it was one branch below the branch that broke it.
  if (!problem?.keep) $("paste-link").value = "";
  if (problem) {
    text("paste-note", problem.note);
    return;
  }
  await followLink(typed);
});

$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("link").textContent);
    text("copy", copy.pairing.copied);
  } catch {
    text("copy", copy.pairing.copyManually);
  }
});

$("cancel").addEventListener("click", async () => {
  // ⚠️ THE REASON IS LOAD-BEARING AND IT IS NEW (round 5). This threw a plain
  // `new Error("cancelled")`, whose `name` is the useless string "Error", and the
  // diagnostics panel then printed `problem  Error` — permanently, on a device
  // where the person had done nothing but change their mind. See `noteProblem`:
  // pressing cancel is not a fault and is no longer recorded as one.
  const cancelled = new Error("cancelled");
  cancelled.reason = "cancelled";
  controller?.abort(cancelled);
  // §3.4.1: "On abandonment, send DELETE" — otherwise a claimable link stays alive
  // for its full lifetime, which since D-136 is a DAY rather than ten minutes. That
  // is what turned this from housekeeping into the thing the feature leans on.
  await flow.abandon({ api, storage: pairingStore() });
  // §2.1.2 rule 4 / D-124, and this path is why the rule is worth having: the person
  // is looking at the link when they press cancel.
  clearPairingSurface();
  await backToStart();
});

$("copy-code").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("code-text").textContent);
    text("copy-code", copy.pairing.copied);
  } catch {
    text("copy-code", copy.pairing.copyManually);
  }
});

$("cancel-code").addEventListener("click", async () => {
  const cancelled = new Error("cancelled");
  cancelled.reason = "cancelled";
  controller?.abort(cancelled);
  await flow.abandon({ api, storage: pairingStore() });
  clearPairingSurface();
  await backToStart();
});

/**
 * §2.1.2's symbol, drawn on request (rule 3) and put away again by the same control.
 *
 * ⭐ THIS HANDLER RESTARTS NOTHING, WHICH IS THE WHOLE DIFFERENCE FROM `to-code` BELOW.
 * The symbol draws the link already on the screen, so there is no abort, no DELETE, no
 * second `pairing_id` and no new secret — §2.1.2's opening paragraph is this line of
 * code. It is also why this control sits above that one.
 *
 * ⚠️ IT READS THE LINK OUT OF THE DOM RATHER THAN KEEPING A COPY. `#link` holds it
 * already; a module variable holding the same secret would be a second thing that has
 * to be cleared, and D-124 is what happens when one of those is missed.
 *
 * ⚠️ Drawing is guarded on there being a link to draw. The control is inside `#linkbox`
 * so it cannot normally be reached before one exists — but `encode("")` would produce a
 * perfectly scannable symbol of nothing, and a person pointing a camera at that gets no
 * error, just a phone that does nothing.
 */
$("to-qr").addEventListener("click", () => {
  if (qrShown) return hideQr();
  const link = $("link").textContent;
  if (!link) return;
  qrs.draw($("qr"), qrs.encode(link));
  text("qr-what", copy.pairing.qr.what);
  text("qr-room", copy.pairing.qr.room);
  show("qrbox");
  text("to-qr", copy.pairing.qr.hide);
  qrShown = true;
});

/**
 * D-117: the second layer, for the person who has just found out that no link will
 * reach their friend.
 *
 * ⚠️⚠️ `flow.abandon` IS CALLED BEFORE THE FIRST `await` AND THAT ORDER IS THE WHOLE
 * CORRECTNESS OF THIS HANDLER. `abandon` reads the in-flight record on its first
 * synchronous line, and `initiate`'s own `finally` clears that record the moment the
 * abort propagates — which happens on the microtask after this function suspends. One
 * `await` above this line and the DELETE has nothing to send, leaving a claimable
 * pairing alive for its full lifetime — a day since D-136 — with nobody able to
 * complete it. §3.4.1.
 *
 * ⚠️ The abandoned link may already have been sent to somebody, so the notice says
 * that it stops working rather than saying nothing.
 */
$("to-code").addEventListener("click", async () => {
  const switching = new Error("switching");
  switching.reason = "switching";
  controller?.abort(switching);
  const deleted = flow.abandon({ api, storage: pairingStore() });

  await pairingRun?.catch(() => {});
  await deleted.catch(() => {});
  pairingRun = runInitiate({ as: "code" });
  await pairingRun;
});

// ⚠️ §3.4.1's abandonment DELETE CANNOT BE SENT FROM `pagehide`, and pretending
// otherwise would be worse than leaving it out: `sendBeacon` is POST-only, and a
// `fetch` from an unloading page is not delivered reliably on mobile — which is
// the case that matters, because iOS discarding the page is the whole reason
// §3.4.1 exists. What covers it is the record in `sessionStorage`: a page that
// comes back finds the in-flight session and can offer to end it.
//
// ⚠️ IT OFFERS RATHER THAN DOING IT. A link that was already sent to somebody dies
// silently otherwise, and the person who receives it gets §3.4.1's "there is no
// pairing session at this link any more" for a reload they may not remember doing.
async function offerToAbandon() {
  // D-165: §3.4.1b rule 6 follows rule 4 — an expired record owes a `DELETE` before it goes.
  const held = await flow.loadInFlight(pairingStore(), { api });
  if (!held) return;

  // ⚠️⚠️ THE SENTENCE WAS WRITTEN FOR ONE ROLE AND SHOWN TO BOTH (feedback 16). It
  // said *"a pairing link created in this tab was never finished"* — and
  // `flow/pair.js` writes this record for the JOINER too, who created nothing and
  // merely opened somebody else's link. That is a message arriving at a person it
  // is not about, which is exactly how it read to the first person who saw it.
  const initiator = held.role === pairings.ROLE_INITIATOR;
  notice("inflight", () => ({
    body: initiator ? copy.pairing.inflight.made : copy.pairing.inflight.opened,
    actions: [
      {
        buttons: [
          {
            label: initiator ? copy.pairing.inflight.cancel : copy.pairing.inflight.forget,
            onClick: async () => {
              await flow.abandon({ api, storage: pairingStore() }).catch(() => {});
              clearNotice("inflight");
            },
          },
        ],
      },
    ],
  }));
}

/**
 * §3.4.1b rule 7, offered — the other half of the notice above, and the reason that
 * one now says only what Ghost mode can honestly say.
 *
 * ⚠️⚠️ THIS CANNOT RUN AT BOOT AND THAT IS THE WHOLE DIFFERENCE. `offerToAbandon`
 * reads `sessionStorage`, which is legible to any document at any time — it runs at
 * top level for exactly that reason. The record this reads is sealed under
 * `local_key`, which derives from a memory-only `K_master` (§4.1), so it does not
 * exist until a phrase has been typed. Unlock is not a convenient moment to offer
 * resumption; it is the FIRST moment the record can be read at all (§3.4.1b rule 3).
 *
 * ⚠️ `pairingStore()` IS `undefined` IN GHOST MODE AND THE OFFER IS THEN NOT MADE.
 * Rule 2: "the interface MUST NOT offer resumption in Ghost — an offer that silently
 * does nothing is worse than the absence of the feature."
 *
 * ⚠️ THE SECOND BUTTON SENDS §3.4.1's DELETE AND THE FIRST DOES NOT. Rule 6 makes
 * that DELETE a MUST when the person declines; carrying on is not declining.
 */
async function offerToResume({ interrupted = false, failure = null } = {}) {
  const storage = pairingStore();
  if (!storage) return;
  // D-165: §3.4.1b rule 6 follows rule 4 — an expired record owes a `DELETE` before it goes.
  const held = await flow.loadInFlight(storage, { api });
  if (!held) return;

  const initiator = held.role === pairings.ROLE_INITIATOR;
  // ⚠️ THREE SITUATIONS NOW, BECAUSE THERE ARE THREE CALLERS, AND EACH KNOWS SOMETHING
  // THE OTHERS DO NOT. At unlock the browser really did close. From `failWith` it did
  // not — feedback 16. And when the invite link is still on screen (`failure`), the
  // reassurance is redundant: the person can SEE the link, so the notice needs to say
  // only what happened and offer the two buttons.
  const said = () =>
    failure !== null
      ? (copy.pairing.failure[failure] ?? copy.pairing.interruptedUnknown)
      : interrupted
        ? initiator
          ? copy.pairing.resume.interruptedMade
          : copy.pairing.resume.interruptedOpened
        : initiator
          ? copy.pairing.resume.made
          : copy.pairing.resume.opened;
  notice("resume", () => ({
    body: said(),
    actions: [
      {
        buttons: [
          {
            label: copy.pairing.resume.go,
            onClick: async () => {
              clearNotice("resume");
              await runResume();
            },
          },
          {
            label: initiator ? copy.pairing.inflight.cancel : copy.pairing.inflight.forget,
            onClick: async () => {
              await flow.abandon({ api, storage: pairingStore() }).catch(() => {});
              clearNotice("resume");
            },
          },
        ],
      },
    ],
  }));
}

/**
 * Carry the pairing on, on the same screen a fresh one uses.
 *
 * ⚠️ THE STEPS START AT THE WAIT, because that is where a resumption starts. The
 * initiator's §9.1 search and the joiner's claim are both behind it — showing
 * "Preparing the invite link…" over a link that was published yesterday would
 * be the interface describing work it is not doing.
 *
 * ⚠️ `null` IS NOT A FAILURE AND MUST NOT PAINT ONE. `flow.resume` returns it when
 * there was nothing to carry on after all — a record whose expiry passed while the
 * notice sat on screen (rule 4), or a joiner whose claim never landed. The person
 * goes back to the list, having been told nothing alarming about a link nobody
 * touched.
 */
async function runResume() {
  only("progress");
  const { waitingOther, done } = copy.pairing.step;
  setSteps([copy.pairing.waiting, waitingOther, done], copy.pairing.waiting);
  controller = new AbortController();
  busyPairing = true;
  try {
    const result = await flow.resume({
      api,
      storage: pairingStore(),
      signal: controller.signal,
      onEvent: (e) => {
        if (e.type === "claimed") markStep(waitingOther);
        if (e.type === "revealed") markStep(done);
        if (e.type === "not_durable") warnNotDurable();
      },
    });
    if (!result) return void (await backToStart());
    await succeed(result);
  } catch (err) {
    failWith(err);
  } finally {
    busyPairing = false;
  }
}

// -------------------------------------------- §7.8 and §7.3.1a, as controls

// ⚠️ TWO ENDINGS, TWO CONFIRMATIONS, AND THE SECOND SAYS MORE. §7.8 step 5 clears
// the whole origin, which takes §7.3.2's high-water mark with it — the most
// thorough ending manufactures the precondition for the roster rollback, and the
// control MUST say so.
// ⚠️⚠️ D-163 — THE GENTLE CONTROL, AND IT IS DELIBERATELY NOT BEHIND A CONFIRMATION.
// The two below ask because they destroy something. This one drops the keys and touches
// no store, so the worst it can cost is one Argon2id — and a dialog in front of it would
// make the three controls look like three degrees of the same act, which is exactly the
// reading D-163 exists to break.
//
// ⚠️ NO GHOST GUARD HERE, and it is structural rather than forgotten: this button lives
// inside `#home`, and Ghost mode has no list, so the screen it sits on never appears in
// that mode. `test/app-document.mjs` asserts that placement, because the day it moves is
// the day `lockNow` starts covering with a sentence about idleness.
$("lock-now").addEventListener("click", () => void lockNow(lockFlow.MANUAL));

$("end-here").addEventListener("click", async () => {
  if (!confirm(`${copy.ending.confirm}\n\n${copy.ending.needsPhrase}`)) return;
  await endHere({ thorough: false });
});

$("end-clear").addEventListener("click", async () => {
  if (!confirm(`${copy.ending.confirm}\n\n${copy.ending.thoroughConfirm}`)) return;
  await endHere({ thorough: true });
});

// ----------------------------------------------------------- §7.6, as controls

// ⚠️ IT CAN FAIL, AND THE ONE WAY IT FAILS DESERVES A SENTENCE. This mode's whole
// store is `sessionStorage`, and a browser that refuses it — some privacy
// configurations do — cannot run the mode at all. Unhandled, that is a dead link on
// the gate and an unhandled rejection in the console. `flow/ending.js` treats a
// refusing `sessionStorage` as survivable because by then there is nothing left to
// lose; here there is everything, so it is a refusal rather than a shrug.
$("go-ghost").addEventListener("click", async () => {
  try {
    await enterGhost();
  } catch (err) {
    session = null;
    // ⚠️⚠️ THE PANEL GETS IT AS WELL AS THE SCREEN, WHICH IT DID NOT UNTIL 2026-09-02.
    // `failcode` below is ON THE SCREEN; the copy control takes `#diag-body` and
    // nothing else, so a refusal recorded only there is a refusal that can be read and
    // cannot be sent — and this screen is a dead end, so there is no later moment at
    // which the panel could learn about it.
    noteProblem(err);
    await haltWith(copy.ghost.noStore);
    // ⚠️ `detailOf`, NOT `err.message` (D-165, outside review slice C #11). §12 keeps
    // exceptions off the screen, and every other `failcode` on this page already used
    // it — this one path put a browser's own `DOMException` prose there, in English,
    // underneath a Finnish sentence. See `failWith`: the fallback to the exception was
    // removed there for feedback 13 and this call site was never part of that sweep.
    text("failcode", detailOf(err));
  }
});

// ⚠️ "BACK" HAS TO UNDO `openGhost`, not merely navigate away from it. Reaching
// this screen minted a session id and a pickle key into `sessionStorage`, and a tab
// that visited the mode and left must not still be a Ghost tab afterwards — the
// boot path below resumes on what it finds. It is safe here and ONLY here, because
// this screen exists only before there is a conversation to lose.
$("ghost-back").addEventListener("click", async () => {
  const going = session;
  session = null;
  if (going?.mode === "ghost") {
    going.tabs.close();
    await going.ghost.discard();
  }
  showGate();
});

// Same wrapping as `create`, and for the same reason — and `pairingRun` must be set
// on every route into a pairing, or "my friend cannot open a link" has nothing to
// wait for and races the screen it is replacing.
$("ghost-start").addEventListener("click", () => {
  pairingRun = runInitiate();
});

/**
 * §7.6's one control, and §7.8's preamble about where §6.7.1's notice goes.
 *
 * ⚠️⚠️ IN THIS MODE ENDING THE SESSION *IS* REMOVING THE CONVERSATION — there is no
 * roster and no other copy — so the notice is owed, and it has to leave **before**
 * §7.8 step 1 stops the writers and step 2 destroys the key that would encrypt it.
 * In Kept mode the same control owes nothing: the conversation is still in the
 * roster and comes back with the phrase.
 */
const endGhostHere = async () => {
  if (!confirm(`${copy.ghost.endConfirm}\n\n${copy.closing.willTell}`)) return;
  const entry = await session?.ghost?.channel?.();
  if (entry) await tellThemItEnded({ ...entry, rootBytes: b64uDecode(entry.root, "channel root") });
  await endHere({ thorough: false });
};

$("ghost-end").addEventListener("click", endGhostHere);
$("covered-end").addEventListener("click", endGhostHere);

// §4.3's cover, lifted — with the PIN since the second tier was built. It drops
// nothing, so there is nothing to restore; the watcher never stopped, and `uncovered()`
// is what tells it the person is present again.
$("uncover").addEventListener("click", () => void liftCover());

// ⚠️ THE WAY OUT OF A FORGOTTEN PIN, IN THE MODE THAT HAS ONE. It is the same lock the
// list screen's control runs and it carries the same sentence, because it is the same
// act: the person asked for the KEY. ⛔ NOT `WRONG_PIN` — nothing was mistyped, and that
// sentence tells somebody their device was in another pair of hands.
$("covered-key").addEventListener("click", () => void lockNow(lockFlow.MANUAL));

// §4.3's second tier, chosen. `savePin` returns to whatever asked for it.
$("pin-set-go").addEventListener("click", () => void savePin());

// ⚠️ ONLY REACHABLE WHEN THERE IS ALREADY A PIN — `showPinSet` hides this control
// otherwise, which is what keeps "mandatory" true on the first pass.
$("pin-set-cancel").addEventListener("click", () => {
  pinAfter = null;
  void backToStart();
});

// The list screen's control. It changes a PIN and deletes nothing, which is why it sits
// with the lock rather than with the two endings under it.
$("change-pin").addEventListener("click", () => void showPinSet(openHome));

// ARCHITECTURE §4.2.2 rule 2. Nothing is ended and nothing is cleared: the two tabs
// swap which of them is the client, and every conversation is in the store they share.
$("use-here").addEventListener("click", () => void useThisTab());

/**
 * §7.8 for a duplicated tab, and for that tab ALONE.
 *
 * ⚠️⚠️ NO BROADCAST, AND THE OMISSION IS THE POINT. This document holds a stray copy
 * of `sessionStorage` that no other client can reach, so removing it is strictly
 * good — but `announceEnd` would also end the tab the person is actually using, on
 * a screen that has just told them that other tab is the one that works. §7.8's
 * requirement to reach every client belongs to the ending control in the live
 * session; this is a copy taking itself out of the count.
 */
$("dup-end").addEventListener("click", async () => {
  const going = session;
  if (!going) return;
  await endings.endSession({
    client: null,
    keys: keysOf(going),
    mode: going.mode,
    stopDelivery: async () => {
      await stopEverything();
    },
    prepareStorage: () => planFor(going, { thorough: false }),
    clearStorage: (prepared) => clearFor(going, { thorough: false, prepared }),
    navigate: (to) => location.replace(to),
  });
});

const openPanic = () => {
  $("panic-phrase").value = "";
  text("panic-note", "");
  only("panic");
  $("panic-phrase").focus();
};

$("go-panic").addEventListener("click", openPanic);
$("go-panic-home").addEventListener("click", openPanic);
$("panic-back").addEventListener("click", () => (session?.mode === "kept" ? only("home") : showGate()));

$("panic-go").addEventListener("click", async () => {
  const typed = $("panic-phrase").value;
  if (!typed.trim()) return;
  $("panic-go").disabled = true;
  text("panic-note", copy.unlock.working);
  let result;
  try {
    result = await runPanicWipe(typed);
  } catch (err) {
    text("panic-note", describeIdentity(err));
    return;
  } finally {
    $("panic-go").disabled = false;
  }
  // ⚠️ AND THEN THIS DEVICE ENDS TOO. A wipe that left the conversations on screen
  // here would be the one device it certainly reached still showing them.
  //
  // ⚠️ WHICH IS ALSO WHY THE COUNT IS SHOWN ON ONE PATH AND NOT THE OTHER, and the
  // asymmetry is deliberate rather than forgotten. Ending navigates to §7.8.1's
  // page, whose wording is fixed by the census and carries nothing else — so a
  // session that wipes reads the count nowhere. §7.3.1a's own scenario is the
  // browser with no session, which stays here and has a screen to read it on. The
  // fact both paths need is on the CONFIRMATION, before anything happens, where it
  // is a promise rather than a report.
  if (session) await endHere({ thorough: false });
  else {
    only("failure");
    text("failmsg", `${copy.panic.done} ${describeTelling(result)} ${copy.panic.reach}`);
    text("failcode", "");
  }
});

/** §6.7.1's count, or the sentence for when not one of them went. */
function describeTelling({ told, of }) {
  if (of === 0) return "";
  return told === 0 ? copy.panic.toldNone : copy.panic.told(told, of);
}

// -------------------------------------------------------- §3.6.2, from the chat

/**
 * The six digits again, on demand, from inside the conversation.
 *
 * ⭐ THIS CONTROL IS WHAT MAKES "NOT YET" AN HONEST ANSWER (D-081). The SAS is
 * `HKDF(R, "lpm-sas-v1", 4)` and `R` is the channel root, which this device holds
 * for the life of the conversation — so the check is not a moment that passes, it
 * is a thing that can be done whenever the two people are finally able to talk.
 * Without this, removing the gate would have been a quiet weakening rather than a
 * decision.
 */
$("verify-now").addEventListener("click", async () => {
  if (!openEntry) return;
  revisiting = openEntry;
  showSas(await pairings.shortAuthString(rootBytesOf(openEntry)));
  text("sas-ask", copy.verification.checkLater);
  // ⚠️⚠️ D-167 — THE EVIDENCE COMES FROM THE CHANNEL HERE, not from a pairing result.
  // There is no `result` on this path: the pairing happened at some earlier moment, in
  // some earlier session, possibly on another device. §7.3.1 rule 7 is what carried the
  // flag to this entry, and reading it back off the entry is the whole point of having
  // recorded it (0.9.22) rather than shown it.
  showPairingTripwire(Boolean(openEntry.tripwire));
  only("verify");
});

// ------------------------------------------------- D-085, the timings a tester reads

/**
 * What this device cost, in numbers somebody can read out loud.
 *
 * ⚠️⚠️ IT GOES NOWHERE, AND THAT IS THE DESIGN RATHER THAN A MISSING FEATURE. A
 * product whose claim is that the server learns nothing does not acquire a
 * telemetry channel to answer a performance question. The person holding the
 * device reads the numbers and types them to us, which is slower and is the only
 * version of this that is consistent with everything else here.
 *
 * ⚠️ Nothing in it is derived from a secret: an elapsed time, a WASM heap size, a
 * boolean about which implementation of X25519 got installed, and the user agent
 * the browser already sends on every request.
 */
/**
 * ⚠️⚠️ `link` IS FEEDBACK 2, AND IT IS THE ROW THAT WAS MISSING WHEN THE NUMBERS
 * FIRST GOT USED IN ANGER. Hannu watched "Preparing the link…" sit there for four
 * or five seconds, opened this panel, and every figure in it was healthy: *"so the
 * waiting is some other lag than what can be measured in that timing."* He was
 * right, and the panel had nothing to say because it measured the two things that
 * happen at BOOT and the wait he was looking at happens on a button press.
 *
 * ⭐ MEASURED, NOT GUESSED — headless Chrome in this container, §9.1 at the
 * production twenty bits, eight runs: **322 ms, 3651, 1628, 2305, 693, 2197, 620,
 * 1155.** That is one number with an eleven-fold spread, and it is not noise: a
 * proof-of-work solve is a search for a nonce, so its cost is a **geometric random
 * variable** with an unbounded tail. Half of all attempts finish inside the mean
 * and a few per cent take four times it, forever, on every device. Hannu's machine
 * derives an Argon2id key in 380 ms where this container needs far longer, so his
 * mean is well under a second and his tail is exactly the "twice, 4-5 seconds" he
 * saw.
 *
 * ➡️ **A wait whose distribution has a long tail cannot be explained by a
 * measurement of the typical case**, which is why the row records the last one
 * rather than an average. The number a person reads out after a slow wait is the
 * slow one.
 *
 * ⚠️⚠️ ROUND 5 SPLIT THE PROOF-OF-WORK OUT OF IT, because the row as one number
 * could not answer the question it was asked. `link 30329 ms, making it` covers a
 * key generation, a commitment, `GET /api/pow`, §9.1's search and a `POST` — and
 * "which of those was the thirty seconds" is exactly what somebody reading it
 * needs and could not get. **A total is a diagnosis only when it has one
 * plausible cause**, and this one has five.
 */
const BOOTED_AT = performance.now();
const measurements = { fallback: null, boot: null, link: null, proof: null, problem: null };

/**
 * The machine name of the last thing that went wrong, for the diagnostics line.
 *
 * ⚠️⚠️ IT EXISTS BECAUSE REMOVING `err.message` FROM THE SCREEN REMOVED THE ONLY
 * WAY A TESTER COULD SAY *WHICH* FAILURE THEY HIT. "Something went wrong, and this
 * device could not say what" is the right sentence for a user and a dead end for
 * the person trying to reproduce it — and the tester round is next. D-085 already
 * decided where that belongs: on the panel the tester reads out, never in a
 * telemetry call and never in the sentence.
 *
 * ⚠️ THE MESSAGE IS NOT RECORDED, ONLY THE NAME. `MissingPrimitiveError`'s message
 * cites `PROTOCOL.md §0.2` and `client/curve/README.md`; `RosterFailure`'s cites
 * §7.3.3. Those strings are the thing this change exists to keep off the screen,
 * and the panel is a screen.
 *
 * ⚠️⚠️ IT ALSO RECORDS *WHEN*, AND ROUND 5 IS WHY. The row printed a bare name
 * that never expired and never counted, so a failure recovered from twenty
 * minutes earlier still read as `problem  Error` on a screen where everything was
 * working. Hannu sent that panel with the note *"all was working… maybe that
 * error was just carried forward from something earlier"* — he had to reason his
 * own way out of a line the product stated flatly, and the only way to clear it
 * was to reload the page.
 *
 * ➡️ **A DIAGNOSTIC WITH NO TIME ON IT IS READ AS THE PRESENT TENSE.** The row
 * now says how long ago and how many, so "old and recovered" and "happening now"
 * stop looking identical — which is the entire job of the panel.
 *
 * ⚠️ `Error` IS ALSO NOT A NAME. It is what `err.name` gives for any plain
 * `new Error(...)`, so it identified nothing; the reasons this client raises now
 * carry an explicit `reason` (`pow_cancelled`, `pow_exhausted`, …) and this
 * records `unnamed` for whatever still does not, which at least says *which*
 * kind of gap it is.
 */
function noteProblem(err) {
  let name = err?.reason ?? (err?.status ? `${err.status} ${err.code ?? ""}`.trim() : err?.name);
  // ⚠️ D-170 — WHICH RECORD, WHEN THE REASON ALONE DOES NOT SAY. Hannu's Firefox
  // panel read `OperationError ×1` and there was no route from it to a record; the
  // reason is the fix for that, and `which` is what makes the next report name the
  // row. It carries nothing of the record's CONTENTS, only which one.
  // ⚠️ It was documented here as "`hwm` or `sent`" and that stopped being true on
  // 2026-09-02, when §0.2's stop began passing the curves it is missing. The field is
  // whatever narrows the reason, and the rule that matters is the one below it: a
  // NAME, never prose, because this row is now something a person can copy and send.
  if (typeof err?.which === "string" && err.which) name = `${name}/${err.which}`;
  // ⚠️⚠️ CHANGING YOUR MIND IS NOT A PROBLEM. Cancelling a pairing and abandoning
  // a link both unwind by throwing, because that is how you stop work that is
  // already running — but an exception used as control flow is not a fault, and
  // recording it as one is how a person who pressed a button they were offered
  // ends up reading that their device has an error.
  // ⭐ `switching` joins them for the same reason one step further on: pressing
  // "my friend cannot open a link" aborts a perfectly healthy pairing on purpose.
  if (name === "cancelled" || name === "switching" || name === "pow_cancelled" || name === "AbortError") {
    return;
  }
  // "Error" is the default name of every un-subclassed exception in JavaScript.
  // Printing it tells a reader that something threw, which they knew.
  if (!name || name === "Error") name = "unnamed";
  measurements.problem = {
    name,
    at: performance.now(),
    count: (measurements.problem?.name === name ? measurements.problem.count : 0) + 1,
  };
}

/**
 * The `problem` row: what, how long ago, and how many.
 *
 * "none" has to keep meaning nothing has gone wrong at all — a tester reading
 * "none" and a tester reading "unnamed ×1, 22 min ago" are in different
 * situations and the panel must not blur them.
 */
function describeProblem() {
  const p = measurements.problem;
  if (!p) return "none";
  const ago = Math.round((performance.now() - p.at) / 1000);
  const when = ago < 90 ? `${ago} s ago` : `${Math.round(ago / 60)} min ago`;
  return `${p.name} ×${p.count}, ${when}`;
}

/**
 * ⭐⭐ WHICH BUILD IS THIS PERSON RUNNING? Nothing on this screen could answer that
 * until round 19, and the cost of not being able to was an entire evening: a pairing
 * fix was deployed, hash-verified on the server and reported as done; the tester tried
 * it, it failed, he said so, and I believed him. It had worked. His phone had restored
 * a backgrounded tab without re-fetching, so he was running the previous client against
 * the new server. Neither of us could see that, so we both reasoned about the wrong code.
 *
 * ⚠️⚠️ "VERIFIED ON THE SERVER" IS NOT "THE USER IS RUNNING IT", AND ONLY THE PAGE CAN
 * CLOSE THAT GAP. `curl` from anywhere else opens a fresh connection with no cache, no
 * service worker and no restored tab — it proves what the server holds and says nothing
 * whatever about the document someone is looking at. So the comparison is made HERE, by
 * the document itself: the stamp compiled into the running code, against the same file
 * fetched fresh. A mismatch is the page telling on itself.
 *
 * ⚠️ THE THREE ANSWERS MUST STAY THREE. "current", "stale" and "could not ask" are
 * different situations, and an unreachable server rendered as "current" would rebuild
 * the very fault this exists to remove.
 *
 * This is the only request in the client made for a reader rather than for the
 * protocol. It is same-origin, one static file, sent only when the panel is opened,
 * carries no identifier and stores nothing.
 */
let servedBuild = { state: "unasked" };

async function askServedBuild() {
  // ⚠️⚠️ A TIMEOUT, BECAUSE THE FIRST FIELD USE OF THIS PANEL HUNG ON THIS LINE.
  // Hannu read `build 9b61457b8a287bd1, asking the server` on a browser that was in
  // the middle of losing its network: `fetch` neither resolved nor rejected, so the
  // panel sat in its opening state and told him nothing. **The one moment this line
  // is worth reading is a moment when the network is sick**, which is the same moment
  // a request is most likely to hang rather than fail — so "no answer yet" has to
  // become "no answer" by itself, and quickly.
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), 4000);
  try {
    const res = await fetch("/app/build.js", { cache: "no-store", signal: stop.signal });
    const stamp = res.ok ? /"([0-9a-f]{16})"/.exec(await res.text())?.[1] : null;
    servedBuild = stamp ? { state: "known", stamp } : { state: "failed" };
  } catch {
    servedBuild = { state: "failed" };
  } finally {
    clearTimeout(timer);
  }
}

function buildLine() {
  // ⚠️ FOUR SENTENCES THAT LIVED HERE UNTIL 2026-08-24 AND SHOULD NEVER HAVE. They are
  // read by a person — Hannu read one of them off his own screen, which is why
  // `askServedBuild` above has a timeout — and they were English in both languages.
  const b = copy.diagnostics.build;
  if (servedBuild.state === "unasked") return b.asking(BUILD); // at most 4 s — see askServedBuild
  if (servedBuild.state === "failed") return b.failed(BUILD);
  if (servedBuild.stamp === BUILD) return b.current(BUILD);
  return b.stale(BUILD, servedBuild.stamp);
}

function renderDiagnostics() {
  const argon = argon2.lastRun();
  const lines = [
    // First on purpose: if this line says OLD, every number under it describes
    // code the server has already replaced.
    `build       ${buildLine()}`,
    `boot        ${measurements.boot === null ? "—" : `${measurements.boot} ms`}`,
    `key         ${argon ? `${argon.ms} ms, ${argon.heapMiB} MiB` : copy.diagnostics.notDerived}`,
    `link        ${measurements.link === null ? "—" : `${measurements.link.ms} ms, ${measurements.link.what}`}`,
    // Only the side that MAKES a link does §9.1's work, so "—" on this row is
    // the joiner's correct answer and not a missing measurement.
    `proof       ${measurements.proof === null ? "—" : copy.diagnostics.proofAt(measurements.proof.ms, measurements.proof.bits)}`,
    `problem     ${describeProblem()}`,
    `curve       ${measurements.fallback === null ? "—" : measurements.fallback ? "WASM fallback" : "WebCrypto"}`,
    `screen      ${window.innerWidth}×${window.innerHeight}`,
    `browser     ${navigator.userAgent}`,
  ];
  // ⛔⛔ THE SELECTION SURVIVES THE RE-RENDER, AND IT DID NOT UNTIL `probe-diag-copy`
  // PRESSED THE BUTTON IN A BROWSER THAT SAYS NO.
  //
  // The panel is drawn twice on every open: once immediately, and again when
  // `askServedBuild` answers — up to four seconds later, and it takes the FULL four on
  // a sick network, which is the network this panel is opened on. The refusal path
  // below selects the readout and tells the person to copy it themselves. Writing
  // `textContent` destroys every node the selection is anchored in, so the second draw
  // silently took the selection away and left that sentence standing over nothing.
  //
  // ➡️ **A screen that tells somebody to act on what they can see owes them the
  // seeing for as long as the sentence is up.** Restored only when the selection was
  // the WHOLE readout — that is the one this code made; a person who has picked out a
  // single row picked it on purpose and it is not ours to widen.
  const selection = window.getSelection();
  const ours = selection?.toString() !== "" && selection?.toString() === $("diag-body").textContent;
  text("diag-body", lines.join("\n"));
  if (ours) selectTheReadout();
}

/**
 * The nine rows, selected whole, for a browser that would not take them itself.
 *
 * ⚠️ IT IS NOT A CONVENIENCE. "Select it and copy" is two gestures on a telephone held
 * in one hand, at the end of a session that has already gone wrong, by somebody who is
 * doing us a favour. This leaves one.
 */
function selectTheReadout() {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents($("diag-body"));
  selection.removeAllRanges();
  selection.addRange(range);
}

$("diag-toggle").addEventListener("click", () => {
  const showing = $("diag").classList.contains("hidden");
  if (showing) {
    // Asked afresh on every open rather than cached: the interesting case is a page
    // that has been sitting open across a deploy, which is exactly when a remembered
    // answer would be the wrong one.
    servedBuild = { state: "unasked" };
    renderDiagnostics();
    // The control says what it does again, not what it did last time. A panel reopened
    // an hour later must not still be reading "Copied" over numbers nobody has copied.
    sayOfTheCopy(copy.diagnostics.copy);
    askServedBuild().then(() => {
      if (!$("diag").classList.contains("hidden")) renderDiagnostics();
    });
  }
  show("diag", showing);
  text("diag-toggle", showing ? copy.diagnostics.hide : copy.diagnostics.show);
});

/**
 * ⚠️ THE LABEL GOES BACK BY ITSELF, AND THE SECOND PRESS IS WHY. "Copied" that never
 * expires answers the first press and then silently swallows every one after it — a
 * person whose paste went into the wrong app presses again, reads the same word that
 * was already there, and cannot tell whether anything happened. Read at fire time so
 * the sentence comes back in whatever language `copy-language.js` has since installed.
 *
 * ⛔⛔ ONLY THE CONFIRMATION FADES, AND THE DIFFERENCE IS WHAT THE SENTENCE IS FOR.
 * "Copied" reports something that is over. `copyManually` is an INSTRUCTION, standing
 * above a selection this code has just made and is asking the person to act on — and
 * four seconds is nothing to somebody hunting for a context menu on a telephone with
 * one hand. Taking that sentence away on a timer would leave the selection lit and
 * nothing on the screen saying why. It goes when the panel is next opened, which is
 * the moment the person has moved on.
 */
let copyLabelTimer = null;
function sayOfTheCopy(label) {
  clearTimeout(copyLabelTimer);
  text("diag-copy", label);
  if (label === copy.diagnostics.copied) {
    copyLabelTimer = setTimeout(() => text("diag-copy", copy.diagnostics.copy), 4000);
  }
}

/**
 * ⭐⭐ D-085's PANEL, MADE SENDABLE BY THE PERSON AND STILL NOT BY THE PRODUCT.
 *
 * ⚠️⚠️ IT COPIES `#diag-body` AND BUILDS NOTHING OF ITS OWN. The temptation here is a
 * nicer report — a wall clock, a header naming the app, a field the panel does not
 * show — and every one of those breaks the promise in `diagnostics.note`, which says
 * this is on screen so you can read it. A clipboard holding more than the screen is a
 * person sending what they never saw. If a fact is worth sending it becomes a ROW,
 * where `renderDiagnostics` puts it in front of them first.
 *
 * ⚠️ THE REFUSAL PATH SELECTS RATHER THAN INSTRUCTS. Firefox and a locked-down
 * configuration both refuse `writeText`, and this panel's whole reason for existing is
 * an unreproduced Firefox failure — so the one browser most likely to need it is the
 * one most likely to say no. "Select it and copy" is an instruction to do a fiddly
 * thing on a telephone with one hand; selecting the nine lines for them leaves a
 * single gesture, which is the difference between a report arriving and not.
 */
$("diag-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("diag-body").textContent);
    sayOfTheCopy(copy.diagnostics.copied);
  } catch {
    selectTheReadout();
    sayOfTheCopy(copy.diagnostics.copyManually);
  }
});

// ---------------------------------------------------------------------- boot

// §7.8 step 0. Armed at BOOT and not at the ending: a handler registered during an
// ending is a handler the restored document may not have. A build measured to
// return from the back/forward cache brings the whole heap with it.
endings.armBfcacheDefence();

/**
 * ⛔⛔ AND IT RUNS BEFORE §0.2's STOP BELOW, WHICH IT DID NOT UNTIL 2026-09-02.
 *
 * The rule above says the language is settled BEFORE A SENTENCE IS WRITTEN INTO the
 * document, and one screen was written before it: the feature-detection halt painted
 * `copy.primitives.missing` while `copy.js` was still holding English, so the browser
 * that cannot run this product at all was told so in the wrong language — on the one
 * screen a person can never get past to find the language control.
 *
 * ⚠️ IT ALSO LEFT THE DIAGNOSTICS FOOTER BLANK, which is what turned a wording fault
 * into a reporting one. `paintCopy` is what puts a label on "Show timings", and until
 * it has run there is no control to press: the panel recording WHY the boot stopped
 * sat under an unlabelled button on the only screen where it was the whole report.
 *
 * ➡️ **The earliest thing that can paint has to be later than the paint.** Moving
 * these four lines up is the whole fix; nothing between here and where they used to
 * be writes to the screen at all.
 */
/**
 * D-159 — the language this document is in, settled before a sentence is written
 * into it, and settled ONCE.
 *
 * ⚠️⚠️ THE ORDER OF THESE THREE LINES IS THE WHOLE OF IT. `setLanguage` rewrites the
 * objects `ui/copy.js` exports; `paintCopy` reads them. Reversed, the page would be
 * painted in English and then hold Finnish nobody had asked it to show — which is
 * not a flash, it is a hundred and twenty sentences that never change.
 *
 * ⭐ `setLanguage("en")` IS FREE, and that matters because most visitors are English:
 * `copy-language.js` returns at its own first line when the language it is asked for
 * is the one it is already holding, so nothing is walked and nothing is copied.
 *
 * ⚠️⚠️ AND `langs.apply` IS CALLED HERE EVEN THOUGH `app/lang-boot.js` HAS ALREADY
 * STAMPED THE SAME VALUE ON THE SAME ELEMENT. It is not a second opinion, it is the
 * opposite: the sentences and the `<html lang>` attribute now come from ONE variable
 * in one statement pair, so they cannot disagree. If the two implementations of the
 * decision ever drifted apart — the thing `test/lang.mjs`'s 576 cases exist to catch
 * — the failure without this line is a page whose sentences are Finnish and whose
 * `lang` says English: a screen reader reading Finnish aloud in an English voice, and
 * a browser offering to translate a page that is already translated. With this line
 * the drift is a flash of the gloss instead, which is visible and harmless.
 */
const openedIn = langs.resolve();
setLanguage(openedIn);
langs.apply(openedIn);
paintCopy();

// ⚠️⚠️ §0.2's FEATURE DETECTION, FIRST, FOR THE REASON THE SECTION STATES ITSELF:
// "The client MUST feature-detect at startup and fall back to a WASM
// implementation. This fallback is not optional — it is the difference between
// working and not working on a meaningful share of devices."
//
// A browser with X25519 and Ed25519 in WebCrypto pays one key generation for this
// and downloads nothing. A browser without them gets `client/curve/` installed
// underneath the same two modules and never learns the difference (D-075).
//
// ⚠️ A browser that has neither is told SO, HERE — and not at the moment somebody
// presses "pair", by which point they have sent a link to a friend and are
// watching a screen that can never finish.
{
  const primitives = await ensurePrimitives();
  measurements.fallback = Boolean(primitives.fallback); // D-085
  if (!primitives.complete) {
    only("failure");
    text("failmsg", `${copy.primitives.missing} ${copy.primitives.what}`);
    // The algorithm name goes here rather than in the message: the person reading
    // it cannot act on "X25519", and the tester who can already looks at this line.
    text("failcode", primitives.reason ?? "");
    // ⚠️⚠️ AND THE PANEL, FOR THE SAME REASON THE GHOST HALT ABOVE NOW DOES — but this
    // is the one that matters to the friend round. An unusual browser on an old
    // telephone is exactly who reaches this line, and this is the earliest and most
    // final stop in the product: the person cannot get anywhere else to produce a
    // second reading, so whatever the panel holds here is the whole report.
    //
    // ⚠️ A NAME, NEVER `primitives.reason`. That string is prose and quotes the
    // browser's own exception back — `noteProblem`'s header is explicit that the panel
    // records names and not messages, and the copy control means the panel is now a
    // thing that gets SENT. The screen keeps the sentence; the row keeps the name.
    //
    // ⭐ The two shapes are worth telling apart: `fallback: false` here means
    // `client/curve/` itself would not load (WASM refused, or the network went while
    // it was being asked for), and `fallback: true` means it loaded and the browser
    // still has neither. `which` carries what is actually missing.
    const missing = new Error(`§0.2: ${primitives.reason ?? "a primitive is unavailable"}`);
    missing.reason = primitives.fallback ? "curve_missing_after_fallback" : "curve_fallback_unloadable";
    missing.which = [!primitives.x25519 && "x25519", !primitives.ed25519 && "ed25519"]
      .filter(Boolean)
      .join("+");
    noteProblem(missing);
    // Nothing below this line may run. Every path in this app leads to a key
    // agreement or a signature, so there is no reduced mode to offer.
    throw missing;
  }
}

// ⚠️ THE ARGON2 MODULE IS INSTALLED INTO §7.2's SEAM HERE AND NOWHERE ELSE.
// `protocol/passphrase.js` deliberately holds a named error rather than a stub, so
// that a build which forgot this fails loudly at the first unlock instead of
// deriving something that is not `K_master`.
await argon2.initArgon2();
passphrase.installArgon2id(argon2.argon2id);

/**
 * Every sentence this document shows, put where it goes — ONE BLOCK, and after
 * 2026-08-13 there is nothing left in `index.html` for it to compete with.
 *
 * ⚠️⚠️ EIGHTEEN SENTENCES USED TO LIVE IN THE HTML INSTEAD, and the first person
 * to use this product tripped over exactly those: every *"this reads badly / I do
 * not understand this / that is the wrong word"* complaint pointed at one of them,
 * while the strings in `ui/copy.js` drew a different and milder one — *true, but it
 * does not tell me enough.* ➡️ **A central copy file is not a filing convention,
 * it is a review gate**, and nothing failed when eighteen sentences walked past
 * it. `test/copy.mjs` now reads `index.html` and fails on any text this module did
 * not produce, so the next interface step cannot repeat it quietly.
 *
 * ⭐⭐ IT IS A FUNCTION SINCE D-159, AND THE CALL BELOW IS THE ONLY ONE AT BOOT. It
 * used to be a hundred and twenty statements at module top level, which was fine
 * while the product had one language: a sentence written once is a sentence for the
 * life of the document. `ui/copy-language.js` makes the copy objects MUTABLE, so
 * every one of these lines is now a rendering of whatever `ui/copy.js` says AT THE
 * MOMENT IT RUNS — and the language control has to be able to run them again.
 *
 * ⚠️ NOTHING WITH AN EFFECT BEYOND THE SCREEN MAY GO IN HERE. It is called once at
 * boot and once per press of the language control, and a second call must be
 * indistinguishable from the first. `markTheme()` is inside it because the tick is
 * drawn from `theme.js`'s own answer rather than from anything this function knows;
 * `offerToAbandon()` and the `location.hash` read are outside it, below, because
 * they are steps rather than paint. See `rerender()` for the screens whose text this
 * function does NOT own.
 */
function paintCopy() {
  // The gate — D-083's plain-language opening, rewritten for the tester round
  // (D-110) and now carrying the disclosures for KEY, invite link and server.
  //
  // ⚠️ `gate-no-reset` IS GONE AND ITS FACT IS NOT. It printed *"There is no account,
  // no email address and no way to reset the passphrase"* under these paragraphs, and
  // the second of them now ends *"We do not have it, and we cannot help you if you
  // lose it"* — the same warning, in words a person feels rather than parses. Hannu
  // found the duplication himself while rewriting the page around it, which is D-107's
  // class caught by a reader for the second round running.
  prose("gate-what", copy.product.what);
  text("go-setup", copy.nav.setUp);
  text("go-enter", copy.nav.haveOne);
  text("go-ghost", copy.ghost.offer);
  text("go-ghost-what", copy.ghost.offerWhat);
  text("go-panic", copy.panic.fromGate);
  text("go-panic-home", copy.panic.fromGate);

  // §2.1's link, pasted rather than navigated to — feedback 7 and 11.
  text("go-paste", copy.openLink.control);
  text("home-paste", copy.openLink.control);
  text("paste-title", copy.openLink.title);
  text("paste-what", copy.openLink.what);
  text("paste-go", copy.openLink.open);
  text("paste-back", copy.nav.cancel);
  text("paste-or-code", copy.openLink.orCode);
  $("paste-link").placeholder = copy.openLink.placeholder;

  // §2.1.2's control. The panel's own two lines are written when it is opened rather than
  // here, so that `hideQr` clearing them is the same operation as never having drawn it.
  text("to-qr", copy.pairing.toQr);

  // §2.2's code screen. Static text; the code itself and its spelling are rendered by
  // `showCode` when §3.1's offer has been accepted.
  text("to-code", copy.pairing.toCode);
  text("code-was-link", copy.pairing.code.replacedLink);
  text("code-once", copy.pairing.code.isOnce);
  text("code-spelling", copy.pairing.code.spelling);
  text("copy-code", copy.pairing.code.copy);
  text("cancel-code", copy.pairing.cancel);

  // §7.4 — choosing, writing down, and typing back (three screens since D-084).
  text("setup-choose", copy.phrase.choose);
  text("chosen", copy.phrase.use);
  text("regen", copy.phrase.more);
  text("longer", copy.phrase.longer);
  text("write-down", copy.phrase.writeItDown);
  text("written", copy.phrase.written);
  text("write-back", copy.phrase.showChoicesAgain);
  // ⚠️ `confirm-hidden` IS GONE AND ITS PARAGRAPH MOVED TO `terms.retype` (D-110).
  // This screen has one job, one field and one answer; three sentences of
  // justification above the field is the shape the testers said to stop writing.
  prose("confirm-ask", copy.phrase.confirm);
  text("confirmed", copy.phrase.thisIsIt);
  text("show-phrase", copy.phrase.showPhraseAgain);
  text("back-setup", copy.phrase.showChoicesAgain);
  $("retype").placeholder = copy.phrase.placeholder;
  text("pasted-title", copy.phrase.pasted.title);
  text("pasted-body", copy.phrase.pasted.body);
  text("pasted-ok", copy.phrase.pasted.ok);

  // Unlocking.
  text("enter-ask", copy.unlock.ask);
  text("unlock", copy.nav.open);
  text("back-gate", copy.nav.toStart);
  $("phrase-in").placeholder = copy.unlock.placeholder;
  text("working-why", copy.unlock.why);

  // D-139's app bar. ⚠️ `aria-label` RATHER THAN `text()` FOR THE THREE GLYPH
  // CONTROLS: writing a sentence into a 2.75rem circle would replace the arrow, the
  // dots and the plus with clipped words. `text()` and this are not interchangeable
  // here, and the two failures look nothing alike — one is a silent accessibility
  // hole, the other is a visibly broken button.
  $("bar-back").setAttribute("aria-label", copy.menu.back);
  $("bar-menu").setAttribute("aria-label", copy.menu.more);
  text("menu-theme-label", copy.menu.appearance);
  text("theme-system", copy.menu.system);
  text("theme-light", copy.menu.light);
  text("theme-dark", copy.menu.dark);
  markTheme();

  // D-159's language control. ⚠️ ITS OWN LABEL IS IN HERE, WHICH IS THE ONE SENTENCE
  // THAT MUST SURVIVE THE SWITCH ITSELF: a person who has just pressed the wrong one
  // needs to find this menu again in a language they cannot read, and "Kieli" under a
  // tick they can see is what makes that possible. The two options are deliberately
  // NOT translated — see `copy.menu.english`.
  text("menu-lang-label", copy.menu.language);
  text("lang-en", copy.menu.english);
  text("lang-fi", copy.menu.finnish);
  markLanguage();

  // ── D-187: the seven screens that had no heading ────────────────────────────
  // ⚠️ THESE ARE ALSO THE SCREENS' ACCESSIBLE NAMES. Each `<section>` carries
  // `aria-labelledby` pointing at its own heading, which turns it into a named
  // region — so `only()`'s focus move (D-186) finally announces WHICH screen has
  // arrived instead of landing on an unnamed container. One string, seen and heard.
  text("gate-title", copy.product.title);
  text("setup-title", copy.phrase.chooseTitle);
  text("write-title", copy.phrase.writeTitle);
  text("confirm-title", copy.phrase.confirmTitle);
  text("enter-title", copy.unlock.title);
  text("progress-title", copy.pairing.title);
  text("verify-title", copy.verification.title);

  // The list and the chat.
  text("home-title", copy.list.title);
  text("check", copy.nav.checkForChanges);
  text("back-home", copy.nav.toConversations);
  text("delete", copy.nav.delete);
  text("lock-now", copy.lock.control);
  text("lock-note", copy.lock.controlNote);
  text("change-pin", copy.pin.change);
  text("pin-note", copy.pin.changeNote);
  text("end-here", copy.ending.control);
  text("end-clear", copy.ending.thoroughControl);

  // §7.3.1a's panic action.
  text("panic-title", copy.panic.control);
  text("panic-reach", copy.panic.reach);
  text("panic-other", copy.panic.otherSide);
  text("panic-keeps", copy.panic.keeps);
  text("panic-survives", copy.panic.survives);
  text("panic-ask", copy.panic.ask);
  text("panic-go", copy.panic.control);
  text("panic-back", copy.nav.cancel);
  $("panic-phrase").placeholder = copy.panic.placeholder;

  // §7.6 — the gate, and the server sentences feedback 3/4/5/7 asked for.
  text("ghost-title", copy.ghost.title);
  text("ghost-back", copy.nav.toStart);
  prose("ghost-server-read", copy.server.cannotRead);
  text("ghost-server-gone", copy.server.whenItGoes);
  text("ghost-server-adds", copy.server.ghostAdds);
  prose("ghost-server-meta", copy.server.metadata);
  prose("server-read", copy.server.cannotRead);
  text("server-gone", copy.server.whenItGoes);
  text("server-list", copy.server.list);
  prose("server-meta", copy.server.metadata);
  text("dup-title", copy.ghost.duplicatedTitle);

  // §3 — pairing, and §3.6.2's three answers.
  text("cancel", copy.pairing.cancel);
  text("link-fragment", copy.pairing.fragmentNote);
  text("sas-ok", copy.pairing.answer.verified);
  text("sas-later", copy.pairing.answer.later);
  text("sas-wrong", copy.pairing.answer.wrong);
  text("tripwire-title", copy.pairing.tripwireTitle);
  text("failure-title", copy.pairing.failureTitle);
  text("fail-back", copy.nav.toStart);

  // D-085's timings.
  text("diag-toggle", copy.diagnostics.show);
  text("diag-note", copy.diagnostics.note);
  text("diag-copy", copy.diagnostics.copy);
}


// The link is held here and followed inside `withIdentity` — see the note there.
// ⚠️ `takeLinkFromUrl` STRIPS AS IT READS (§2.1). It is not `location.href` any more,
// and the difference is minutes of a live pairing secret in the address bar.
pendingJoin = takeLinkFromUrl();

// ⚠️ NOT AWAITED, AND IT IS AT TOP LEVEL: this is a notice, not a step. It reads
// `sessionStorage` before anything is unlocked, which is all it can reach here —
// §3.4.1b's sealed record needs `local_key` and is therefore offered after unlock.
void offerToAbandon();

// ⚠️⚠️ A GHOST SESSION RESUMES BEFORE THE GATE IS EVER SHOWN, AND §7.6 IS WHY. The
// mode's storage rule exists so that the root, the role, the generation and the Olm
// state survive an "accidental reload" — a rule that is satisfied byte for byte and
// delivers nothing if the app then greets the person with a sign-in screen for an
// identity they deliberately do not have. This document either IS a Ghost session
// or it is not, and its own `sessionStorage` is the only thing that knows.
if (await ghostFlow.resumable({})) {
  await enterGhost();
} else {
  // §3, from the joiner's side. `showGate` is where the arrival is now said out
  // loud AND where all three choices are re-labelled to be about the link this
  // person is holding — until 2026-08-13 only the notice above them changed, and
  // feedback 3 is that the third choice was invisible to somebody looking at it.
  showGate();
}

// D-085: how long everything above this line took, on the device it took it on.
measurements.boot = Math.round(performance.now() - BOOTED_AT);
