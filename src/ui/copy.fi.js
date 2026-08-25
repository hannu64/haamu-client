/* haamu in Finnish — every sentence `copy.js` says, said again.
 *
 * ⚠️⚠️ THIS IS A PRODUCT FILE, NOT A TRANSLATION ARTEFACT. The Finnish took twenty-seven
 * rounds: two Finnish readers, then Hannu reading what their round shipped, over sheets
 * generated out of `copy.js` and merged by a script. Those sheets and layers are the
 * PROCESS and they stop here. From this file's first commit **the Finnish has one home,
 * exactly as the English has one**, and a change to a sentence is made in it — never in a
 * sheet that is then rebuilt over the top, which is how D-149's repair was lost once
 * already.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⭐⭐ WHY IT IS FLAT, AND KEYED BY PATH.
 *
 * `copy.js` is a tree that 282 call sites reach into — `copy.pairing.code.keep.kept`, and
 * so on. Mirroring that tree here would mean the two files could disagree about their
 * SHAPE as well as about their words, and a Finnish branch that no English branch matches
 * is a sentence nothing would ever render. Keyed by path, a missing sentence and a
 * sentence for a path that is gone are both one comparison, and `test/copy-fi.mjs` makes
 * both of them build failures. ⭐ It is also the key the review sheets used for 27 rounds,
 * so the history reads against this file unchanged.
 *
 * ⚠️⚠️ THE NUMBERS ARE TYPED HERE, AND THAT IS DELIBERATE — READ THIS BEFORE "FIXING" IT.
 * Every number in `copy.js` is interpolated from the constant it describes, because prose
 * that describes a constant is checked by nothing. This file does the opposite: *"7
 * päivää"*, *"16 merkkiä"*, *"30 minuutin"* are written out. The reason is that the same
 * guarantee is available here more cheaply and in a form a Finn can read. **The gate
 * requires that every number in a Finnish sentence agrees with the number in the English
 * sentence at the same path** — normalising time units first, because Finnish says *24 h*
 * where English says *1 day* and both are the same constant. So:
 *
 *   · the Finnish still cannot drift from the constant, because the English cannot;
 *   · a Finn reviewing this file reads sentences, not `${plural(days(QUARANTINE_DAYS))}`;
 *   · and if a constant moves, the build FAILS rather than quietly shipping a Finnish
 *     sentence with the old number in it. That is the fail-closed direction: a number in
 *     a warning must not be silently wrong in one of the two languages.
 *
 * ⚠️ The only interpolation below is of a function's own ARGUMENTS, which cannot be
 * written out by definition.
 *
 * ⚠️⚠️ AND `AVAIN` IS THE FINNISH `KEY` (D-109), IN CAPITALS, ALWAYS. The lowercase noun
 * is swept out of Finnish copy for the same reason it is swept out of English: this is a
 * cryptographic product, and a person who reads *"palvelimella on yksi julkinen avain"*
 * beside *"palvelin ei koskaan saa avaintasi"* can only conclude that it holds theirs.
 * ⚠️ Finnish *avain* and *avata* ("to open") share a stem, so the check matches the noun's
 * endings — `avain`, `avaimen`, `avaimesi`, `avaimella` — and never a bare prefix.
 * ────────────────────────────────────────────────────────────────────────────*/

/**
 * Every Finnish sentence that is a sentence, by the path `copy.js` keeps it under.
 *
 * ⚠️ Order follows `copy.js`, grouped by top-level export, so the two files can be read
 * side by side. The comment banners are the group names and nothing else.
 */
export const FI = {
  // ── chat
  "chat.ttl": "Viestit katoavat tästä laitteesta 24 tunnin kuluttua siitä, kun olet vastaanottanut ne — seuraavan kerran kun avaat tämän. Sinun kopiosi ja ystäväsi kopio kulkevat kumpikin omaa aikaansa.",
  "chat.placeholder": "Viesti",
  "chat.send": "Lähetä",
  "chat.thisOne": "Tämä keskustelu",
  "chat.unsupported": "Saapui viesti, joka on lähetetty tätä uudemmasta sovelluksen versiosta.",
  "chat.undecryptable": "Saapui viesti, jota tämä laite ei osaa lukea. Se lähetettiin ennen kuin tämä laite palautettiin.",
  "chat.tampered": "Saapui viesti, jonka osoitetiedot oli muutettu matkalla. Sisältö pysyi salattuna eikä kukaan muu päässyt lukemaan sitä — mutta tämä laite ei toimi sellaisen viestin perusteella, jota palvelin on muuttanut. Pyydä ystävääsi lähettämään se uudestaan.",
  "chat.staleSession": "Yksi viesti on kadonnut. Se saapui ennen kuin tämä keskustelu muodostettiin uudelleen — pyydä ystävääsi lähettämään se uudestaan.",
  "chat.reconnect.what": "Lähetä viesti, niin tämä keskustelu kytkeytyy uudelleen.",
  "chat.reconnect.cost": "Ennen kuin lähetät uuden viestin, et voi vastaanottaa viestejä ystävältäsi.",
  "chat.reconnect.sent": "Kytketään vanhaa keskustelua uudelleen.",
  "chat.reconnect.why": "AVAIN tuo keskustelut takaisin jokaiseen selaimeen, johon sen kirjoitat, mutta se ei avaa viestejä. Vanhat viestit aukeavat vain siinä selaimessa, jossa ne ensin saapuivat.",
  "chat.live": "live",
  "chat.connecting": "yhdistetään…",
  "chat.polling": "tarkistetaan",
  "chat.localOnly": "Tämä keskustelu on vain tällä laitteella. Se ei ole listassasi, joten se ei ilmesty muille laitteillesi eikä säily, jos tämän selaimen tiedot tyhjennetään.",
  "chat.otherTab": "toinen välilehti",
  "chat.storeHeld": "odotetaan toista välilehteä",
  "chat.storeBusy": "tallennustila on varattu",
  "chat.busyElsewhere": "Ei lähetetty: tämän selaimen toinen välilehti käyttää tätä keskustelua. Yritä uudelleen.",
  // ⚠️ "Lähetys ei onnistunut" — the SENDING did not succeed, which is what the
  // English says. Not "ei lähetetty" ("was not sent"), which would claim the thing
  // the English deliberately does not.
  "chat.notSent": "Lähetys ei onnistunut. Yritä uudelleen.",

  // ── closing
  "closing.willTell": "Yritämme kerran lähettää toiselle henkilölle ilmoituksen, että tämä keskustelu on loppunut.",
  "closing.sent": "Lopetusilmoitus lähetettiin, ja siinä kerrotaan, että lopetit keskustelun.",
  "closing.notSent": "Keskustelu on poistettu täältä, mutta toiselle henkilölle ei saatu kerrottua — mikään ei mennyt perille. Hänen kopionsa on yhä auki hänen laitteellaan.",
  "closing.theyLeft": "Tämä keskustelu on loppunut.",
  "closing.theyLeftWhat": "Toinen henkilö lopetti sen, ja hänen kopionsa siitä on poissa. Tänne ei voi enää lähettää mitään.",
  "closing.startAnother": "Aloita uusi keskustelu, jos haluat jatkaa.",
  "closing.yoursIsYours": "Se mitä sinulla on täällä säilyy. Poista kun haluat.",

  // ── deletion
  "deletion.trace": "Poistetun keskustelun päivämäärä tallennetaan AVAIMESI taakse. Sitä ei näytetä millään ruudulla.",
  "deletion.undoIsLocal": "Yhden säilyttäminen palauttaa sen vain tälle laitteelle. Se ei palaa muille laitteillesi, ja se katoaa, jos tämän selaimen tiedot tyhjennetään.",
  "deletion.quarantineWindow": "Säilytetään 7 päivää, sitten poistetaan.",
  "deletion.keep": "Säilytä tällä laitteella",
  "deletion.agree": "Kyllä, poista",
  "deletion.purged": "Kaikki poistettiin toiselta laitteelta. Tämä laite on tyhjennetty.",

  // ── diagnostics
  "diagnostics.label": "Ajat tällä laitteella",
  "diagnostics.note": "Mitään tästä ei lähetetä minnekään. Se on ruudulla, jotta voit lukea sen ääneen.",
  "diagnostics.show": "Näytä ajat",
  "diagnostics.hide": "Piilota ajat",
  "diagnostics.notDerived": "ei vielä johdettu",

  // ── ending
  "ending.control": "Poista viestini tästä selaimesta ja unohda AVAIMENI",
  "ending.openAgain": "Avaa haamu uudelleen",
  // ⚠️⚠️ D-163. The English stopped saying *keskustelut* where it means *viestit*, and the
  // Finnish has to make the same split or the repair does not reach the reader who found it.
  // ⚠️ *"jokainen keskustelu siinä on tyhjä"* — the conversation is EMPTY, not gone. That is
  // the sentence Hannu's device test produced and the one the old Finnish never said.
  "ending.confirm": "Tämä poistaa viestisi tästä selaimesta nyt ja unohtaa AVAIMESI täältä.\n\nAVAIMESI ei tuo niitä viestejä takaisin tänne, eivätkä muut laitteesi voi lähettää niitä. Muille osapuolille jäävät heidän omat kopionsa.\n\nYhtään keskustelua ei lopeteta eikä kenellekään kerrota mitään. Ne pysyvät auki toisille osapuolille ja muilla laitteillasi. Kun kirjoitat AVAIMESI tänne uudelleen, keskustelulistasi palaa, mutta jokainen keskustelu siinä on tyhjä.\n\nSelaimesi on kirjoittanut jälkiä laitteellesi. Tämä ei ylety niihin — saat ne pois tyhjentämällä tämän sivuston tiedot selaimen asetuksista.",
  "ending.needsPhrase": "Tarvitset 8 sanaasi avataksesi ne uudelleen.",
  "ending.thoroughControl": "Unohda AVAIMENI ja tyhjennä tämän sivuston tiedot",
  "ending.thoroughConfirm": "Tämä tyhjentää kaiken, mitä tämä sivusto on tallentanut tähän selaimeen — ei pelkästään tätä keskustelua.\n\nSe nollaa myös tarkistuksen, joka huomaisi vanhentuneen keskustelulistan. Itse listasi on turvassa AVAIMESI takana ja palaa, kun kirjoitat sen.",

  // ── ghost
  "ghost.title": "Haamu-tila",
  "ghost.duplicatedTitle": "Tämä välilehti on kopio",
  "ghost.offer": "Haamu-tila — ei AVAINTA, ja jos tämä välilehti menee, keskustelu menee yleensä sen mukana",
  "ghost.offerWhat": "Haamu-keskustelua ei koskaan lisätä yhteystietoihisi, eikä se koskaan päädy muille laitteillesi. Välilehden sulkeminen hävittää sen lähes aina — mutta sitä ei pyyhitä pois, joten lopeta se tarkoituksella.",
  "ghost.what": "Tämä keskustelu pysyy tässä selaimen välilehdessä. Sitä ei koskaan lisätä keskustelulistaan, joten palvelimella ei ole siitä merkintää muiden keskustelujesi rinnalla, eikä sitä voi avata toisella laitteella. Sen minkä palvelin näkee mistä tahansa keskustelusta, se näkee myös tästä.",
  "ghost.cost": "Jos tämä välilehti sulkeutuu, varaudu siihen, että keskustelu on poissa: AVAINTA ei ole eikä kopiota ole millään muulla laitteella. Selain, joka avaa välilehtesi uudelleen, voi joskus tuoda sen takaisin tälle laitteelle, joten ainoa varma tapa on lopettaa se tarkoituksella.",
  "ghost.notErased": "Kun tämä välilehti on auki, selain kirjoittaa laitteellesi. Sitä ei voi estää. Keskustelua ei kaavita pois laitteeltasi, kun välilehti menee, ja selain, joka avaa välilehtesi uudelleen, voi joskus avata sen täällä uudestaan. Jos haluat sen pois: lopeta se tarkoituksella ja tyhjennä sitten tämän sivuston tiedot selaimesi asetuksista.",
  "ghost.start": "Luo kutsulinkki",
  "ghost.noStore": "Tämä selain ei anna tämän sivun säilyttää mitään, ei edes yhden välilehden ajan, joten keskustelulla ei ole paikkaa missä olla. AVAIMEN käyttöönotto toimii sen sijaan.",
  "ghost.linkElsewhere": "Haamu-keskusteluja voi olla vain yksi jokaista välilehteä kohti. Avaa kutsulinkki uudessa välilehdessä tai lopeta tämä ensin.",
  "ghost.end": "Lopeta ja poista tämä keskustelu",
  "ghost.endConfirm": "Lopeta ja poista tämä keskustelu — poistaa sen tästä selaimesta nyt.\n\nAVAINTA ei ole eikä kopiota ole missään muualla, joten mikään ei voi avata sitä uudelleen. Toiselle henkilölle jää oma kopionsa siitä, mitä lähetit.",
  "ghost.endedNothingToReopen": "Tälle ei ollut AVAINTA, joten ei ole mitään millä sen avaisi.",
  "ghost.duplicated": "Tämä välilehti on kopio toisesta välilehdestä, jossa tämä keskustelu on auki. Vain yksi välilehti voi toimia kunnolla — paina “Poista tämä kopio” ja käytä toimivaa välilehteä.",
  "ghost.duplicatedEnd": "Poista tämä kopio",
  "ghost.duplicatedEndNote": "Tämä tyhjentää kopion tältä välilehdeltä. Toiseen välilehteen se ei vaikuta.",
  "ghost.noCensus": "Tämä selain ei osaa kertoa, onko sama keskustelu auki toisella välilehdellä. Jos olet monistanut tämän välilehden, sulje kopio.",

  // ── list
  "list.title": "Keskustelut",
  "list.empty": "Ei vielä keskusteluja.",
  "list.start": "Aloita uusi keskustelu",
  "list.unnamed": "Ei vielä nimeä",
  "list.roleI": "sinä aloitit sen",
  "list.roleJ": "sinä liityit",
  "list.roleConflict": "2 laitetta oli eri mieltä siitä, kumpi puoli keskustelua tämä on.",
  "list.versionMismatch": "Palvelimen versio keskustelulistastasi ei täsmää itse listan kanssa. Lista on aito. Suhtaudu epäillen kaikkeen, mitä palvelin siitä sanoo.",
  "list.localOnly": "vain tällä laitteella",

  // ── lock
  // ⚠️ D-163's control. "kysy AVAINTANI" is what a Finnish program does — *ohjelma kysyy
  // salasanaa* — rather than *pyydä*, which is a person asking a person.
  "lock.control": "Lukitse ja kysy AVAINTANI uudelleen",
  "lock.controlNote": "Mitään ei poisteta. Viestisi säilyvät tässä selaimessa ja aukeavat uudelleen, kun kirjoitat AVAIMESI.",
  "lock.idle": "Lukittu 30 minuutin käyttämättömyyden jälkeen. Kirjoita AVAIMESI jatkaaksesi.",
  "lock.blurred": "Lukittu, koska tämä oli taustalla yli 5 minuuttia. Kirjoita AVAIMESI jatkaaksesi.",
  "lock.cost": "Uudelleen avaaminen vie hetken.",
  "lock.manual": "Lukittu. Kirjoita AVAIMESI jatkaaksesi.",
  "lock.coveredIdle": "Peitetty 30 minuutin käyttämättömyyden jälkeen.",
  "lock.coveredBlurred": "Peitetty, koska tämä oli taustalla yli 5 minuuttia.",
  "lock.coveredWhat": "Tämä vain piilottaa sen. Kuka tahansa tätä laitetta käyttävä voi näyttää sen uudelleen — tässä tilassa ei ole AVAINTA suojaamassa keskustelua.",
  "lock.show": "Näytä keskustelu",

  // ── menu
  "menu.back": "Keskustelut",
  "menu.more": "Lisää",
  "menu.appearance": "Ulkoasu",
  "menu.system": "Järjestelmän oletus",
  "menu.light": "Vaalea",
  "menu.dark": "Tumma",

  // ⚠️ `menu.english` ja `menu.finnish` EIVÄT OLE TÄSSÄ, ja se on tarkoituksellista:
  // kumpikin kieli on nimetty omalla kielellään, joten ne ovat samat molemmissa.
  // Perustelu on `copy.js`:ssä `menu.english`-kohdan yllä.
  "menu.language": "Kieli",
  // ⚠️⚠️ NÄMÄ KAKSI OVAT TAHALLAAN SAMAT KUIN ENGLANNISSA. Kumpikin kieli on nimetty
  // omalla kielellään, koska tätä valintaa etsii nimenomaan ihminen, joka ei osaa
  // lukea ruudulla olevaa kieltä. Perustelu on `copy.js`:ssä; `test/copy-fi.mjs`
  // vapauttaa juuri nämä polut nimeltä, joten kolmas samanlainen on perusteltava.
  "menu.english": "English",
  "menu.finnish": "Suomi",

  // ── nav
  "nav.setUp": "Ota käyttöön uusi AVAIN",
  "nav.haveOne": "Minulla on jo AVAIN",
  "nav.arrived.setUp": "Avaa se ja luo uusi AVAIN, jonka taakse se jää",
  "nav.arrived.haveOne": "Avaa se ja säilytä se AVAIMEN takana, joka minulla on",
  "nav.arrived.ghost": "Avaa se Haamu-tilassa — mitään ei säilytetä",
  "nav.open": "Avaa",
  "nav.cancel": "Peruuta",
  "nav.toStart": "Takaisin alkuun",
  "nav.toConversations": "Keskustelut",
  "nav.giveName": "Anna nimi",
  "nav.rename": "Muuta nimeä",
  "nav.namePrompt": "Nimeä keskustelu!",
  "nav.delete": "Poista tämä keskustelu",
  "nav.checkForChanges": "Tarkista muutokset muilta laitteiltani",
  "nav.checked": "Ei muutoksia muilla laitteillasi.",
  "nav.checkedChanged": "Keskustelulistasi on päivitetty.",

  // ── openLink
  "openLink.control": "Avaa kutsulinkki tai koodi, jonka joku lähetti sinulle",
  "openLink.title": "Avaa kutsulinkki tai koodi",
  "openLink.what": "Liitä koko kutsulinkki, myös #-merkin jälkeinen osa. Se avautuu täsmälleen samoin kuin klikkaamalla. Tähän liittäminen pitää sen poissa tämän selaimen osoitehistoriasta.",
  "openLink.orCode": "Tai kirjoita 16 merkin koodi, jonka ystäväsi luki sinulle. Viivoilla, väleillä tai isoilla kirjaimilla ei ole väliä.",
  "openLink.placeholder": "Kutsulinkki tai koodi",
  "openLink.open": "Avaa se",
  "openLink.busy": "Tällä välilehdellä ollaan jo aloittamassa keskustelua. Vie se ensin loppuun tai peruuta se.",
  "openLink.notALink": "Tuo ei näytä kutsulinkiltä. Liitä koko linkki, https-alusta lähtien.",
  "openLink.wrongSite": "Tuo kutsulinkki on toiselle sivustolle, joten sitä ei voi avata täällä.",
  "openLink.noSecret": "Tuosta kutsulinkistä puuttuu #-merkin jälkeinen osa, joka on sen salaisuus. Jokin matkan varrella katkaisi sen — pyydä uusi.",

  // ── pairing
  "pairing.linkIsOnce": "Tämä kutsulinkki toimii kerran, yhdelle henkilölle, 24 h ajan. Lähetä se niin kuin tavallisestikin puhut sen henkilön kanssa.",
  "pairing.keepOpen.kept": "Kutsulinkki toimii 24 h. Jos muutat mielesi tai se meni jonnekin minne et tarkoittanut, peruuta se. Jos suljet tämän selaimen ennen kuin ystäväsi avaa sen, kutsulinkki toimii yhä loppuajan — seuraavan kerran kun kirjoitat AVAIMESI, voit jatkaa sen kanssa tai peruuttaa sen silloin.",
  "pairing.keepOpen.ghost": "Pidä tämä välilehti auki, kunnes ystäväsi on avannut sen. Haamu-tilassa tämä välilehti pitää hallussaan sinun puoltasi pariliitoksesta — jos suljet sen, kutsulinkkiä ei voi viedä loppuun ja tarvitsette kumpikin uuden.",
  "pairing.notDurable": "Tämä selain ei antanut tämän sivun tallentaa sinun puoltasi pariliitoksesta. Pidä tämä välilehti auki, kunnes pariliitos on valmis — jos se sulkeutuu, teidän molempien on aloitettava alusta.",
  "pairing.waiting": "Odotetaan, että ystäväsi avaa sen…",
  "pairing.step.preparing": "Valmistellaan kutsulinkkiä…",
  "pairing.step.finishing": "Viimeistellään",
  "pairing.step.checking": "Tarkistetaan kutsulinkkiä",
  "pairing.step.claiming": "Avataan sitä",
  "pairing.step.waitingOther": "Odotetaan toista henkilöä",
  "pairing.step.done": "Valmis",
  "pairing.inflight.made": "Kutsulinkkiä, jonka teit tällä välilehdellä, ei koskaan avannut kukaan. Se toimii kunnes sen aika loppuu, ja lakkaa sitten itsestään.",
  "pairing.inflight.opened": "Avasit jonkun kutsulinkin tällä välilehdellä, eikä pariliitos koskaan valmistunut. Mitään ei otettu käyttöön, eikä sitä linkkiä voi käyttää uudelleen.",
  "pairing.inflight.cancel": "Peruuta tuo kutsulinkki",
  "pairing.inflight.forget": "Tyhjennä tämä",
  "pairing.resume.made": "Tekemäsi kutsulinkki odottaa yhä, että joku avaisi sen, ja tämä selain sulkeutui ennen kuin niin kävi. Voit jatkaa siitä mihin jäätiin.",
  "pairing.resume.opened": "Avasit jonkun kutsulinkin, ja tämä selain sulkeutui ennen kuin pariliitos valmistui. Voit jatkaa siitä mihin jäätiin.",
  "pairing.resume.interruptedMade": "Tekemäsi kutsulinkki on yhä hyvä, ja tällä selaimella on yhä se mitä loppuun viemiseen tarvitaan. Voit jatkaa siitä mihin jäätiin.",
  "pairing.resume.interruptedOpened": "Avaamasi kutsulinkki on yhä hyvä, ja tällä selaimella on yhä se mitä loppuun viemiseen tarvitaan. Voit jatkaa siitä mihin jäätiin.",
  "pairing.resume.go": "Jatka",
  "pairing.arrived": "Joku lähetti sinulle kutsulinkin keskusteluun. Valitse miten avaat sen — kumpikin tapa toimii.",
  "pairing.arrivedCode": "Joku lähetti sinulle koodin keskusteluun. Valitse miten avaat sen — kumpikin tapa toimii.",
  "pairing.sas": "Lue nämä kuusi numeroa ystävällesi.",
  "pairing.sasWhat": "Tämän keskustelun toisessa päässä olevalla henkilöllä on nämä samat [kuusi numeroa](six-digits). Varmista AIVAN VARMASTI, että se henkilö on ystäväsi eikä joku, joka varasti kutsun matkalta!",
  "pairing.copy": "Kopioi kutsulinkki",
  "pairing.copied": "Kopioitu",
  "pairing.copyManually": "Valitse se ja kopioi",
  "pairing.toQr": "Ystäväni on tässä vieressäni",
  "pairing.qr.hide": "Piilota ruutukoodi",
  "pairing.qr.what": "Suuntaa ystäväsi kamera tähän. Tämä on sama kutsulinkki, joten se avautuu hänen puhelimessaan, ja se toimii yhä vain kerran.",
  "pairing.qr.room": "Se on ruudullasi, joten näytä ruutu ystävällesi ja piilota se heti kun hänen puhelimensa on avannut sen. Kutsulinkki toimii kerran: jos joku muu avaa sen ensin, ystäväsi ei enää pysty.",
  "pairing.toCode": "Ystäväni ei pysty avaamaan kutsulinkkiä, näytä koodi jonka voin lukea tai lähettää.",
  "pairing.code.isOnce": "Tämä koodi toimii kerran, yhdelle henkilölle, 24 h ajan. Lue se ystävällesi ääneen tai lähetä tekstiviestillä.",
  "pairing.code.spelling": "Koodin alla on jokaiselle merkille sana. Sano sanat kirjainten sijaan — B ja P kuulostavat puhelimessa samalta, sanat eivät.",
  "pairing.code.keep.kept": "Koodi toimii 24 h. Jos muutat mielesi tai luit sen väärälle henkilölle, peruuta se. Jos suljet tämän selaimen ennen kuin ystäväsi kirjoittaa sen, koodi toimii yhä loppuajan — seuraavan kerran kun kirjoitat AVAIMESI, voit jatkaa sen kanssa tai peruuttaa sen silloin.",
  "pairing.code.keep.ghost": "Pidä tämä välilehti auki, kunnes ystäväsi on kirjoittanut koodin. Haamu-tilassa tämä välilehti pitää hallussaan sinun puoltasi pariliitoksesta — jos suljet sen, koodia ei voi viedä loppuun ja tarvitsette kumpikin uuden.",
  "pairing.code.copy": "Kopioi koodi",
  "pairing.code.replacedLink": "Kutsulinkki on peruutettu. Tämä koodi avaa keskustelun nyt.",
  "pairing.code.step": "Valmistellaan koodia…",
  "pairing.fragmentNote": "Salaisuus on #-merkin jälkeinen osa. Selaimet eivät koskaan lähetä sitä osaa palvelimelle.",
  "pairing.cancel": "Peruuta",
  "pairing.answer.verified": "Aivan varmasti — se on ystäväni.",
  "pairing.answer.later": "En vielä — kysyn ystävältäni myöhemmin",
  "pairing.answer.wrong": "Tämä ei ole se henkilö, jonka halusin tavoittaa",
  "pairing.wrongConfirm": "Poistetaanko tämä keskustelu?\n\nTämä poistaa sen täältä. Kutsu on joka tapauksessa käytetty — jos haluat yhä tavoittaa ystäväsi, aloita alusta ja lähetä uusi kutsu toista tietä.",
  "pairing.tripwireTitle": "Joku muu avasi tämän kutsulinkin",
  "pairing.failureTitle": "Pariliitos ei valmistunut",
  "pairing.pausedTitle": "Odotetaan yhä ystävääsi",
  "pairing.interruptedTitle": "Pariliitos keskeytyi",
  "pairing.failureUnknown": "Jokin meni vikaan ennen kuin pariliitos valmistui.",
  "pairing.interruptedUnknown": "Pariliitos pysähtyi ennen kuin se valmistui. Kutsulinkki on yhä hyvä ja tällä selaimella on yhä se mitä tarvitaan, joten voit jatkaa.",
  "pairing.tripwire": "Joku muu yritti avata tämän kutsulinkin. Keskustelu meni sille, joka vastasi ensin, eikä mikään täällä kerro, oliko se ystäväsi. Vertaile kuusi numeroa ennen kuin luotat tähän keskusteluun, ja poista se, jos ne eivät täsmää.",
  "pairing.failure.link_malformed": "Tämä kutsulinkki on vaillinainen — #-merkin jälkeinen osa puuttuu. Pyydä uusi.",
  "pairing.failure.code_malformed": "Koodissa on 16 merkkiä. Vertaa siihen, mitä ystäväsi luki — koodissa ei koskaan ole kirjaimia I tai L eikä numeroa 1, joten jokin sellainen on jotain muuta. Nolla siinä missä kuulit Oscarin on aivan oikein.",
  "pairing.failure.offer_unverified": "Se mitä palvelin tarjoaa, ei täsmää tämän kutsulinkin kanssa. Älä jatka: tämä on joko vioittunut kutsulinkki tai palvelin, joka työntää väliin jotain omaansa.",
  "pairing.failure.commitment_mismatch": "Palvelin lähetti jotain, mitä tämä kutsulinkki ei luvannut. Jokin sekaantuu tähän kutsuun. Älä yritä uudelleen — pyydä uusi linkki toista kanavaa pitkin.",
  "pairing.failure.already_claimed": "Joku muu avasi tämän kutsulinkin ennen sinua, ja hänellä on sen sisältämä salaisuus. Pidä kutsulinkkiä paljastuneena ja aloita alusta.",
  "pairing.failure.claim_forged": "Tämän kutsulinkin otti jokin, joka ei pystynyt todistamaan tulleensa linkistä. Mitään ei siepattu, mutta linkki on käytetty — luo uusi.",
  "pairing.failure.expired": "Kutsulinkin aika loppui ennen kuin pariliitos valmistui.",
  "pairing.failure.not_found": "Tällä kutsulinkillä ei ole enää pariliitosistuntoa.",
  "pairing.failure.still_waiting": "Kukaan ei ole vielä avannut tätä kutsulinkkiä, joten tämä sivu lakkasi odottamasta. Itse kutsulinkki on yhä hyvä, ja voit jatkaa milloin tahansa ystäväsi ollessa valmis.",
  "pairing.failure.offline": "Yhteys katkesi ennen kuin pariliitos valmistui. Mitään ei menetetty — kutsulinkki on yhä hyvä ja tällä selaimella on yhä se mitä tarvitaan, joten voit jatkaa kun olet taas verkossa.",
  "pairing.failure.rate_limited": "Liian monta yritystä tästä verkosta viime tunnin aikana. Tämä on roskapostiraja, ei vika — odota hetki ja yritä uudelleen.",
  "pairing.failure.server_state": "Palvelin ei ottanut tätä pariliitoksen vaihetta vastaan. Mitään ei otettu käyttöön — aloita alusta uudella kutsulinkillä.",

  // ── panic
  "panic.control": "Poista jokainen keskustelu kaikkialta",
  "panic.placeholder": "AVAIMESI",
  "panic.ask": "Kirjoita AVAIMESI vahvistukseksi. Tätä ei voi perua.",
  "panic.reach": "Tämä poistaa itse keskustelulistasi, joten jokainen laitteesi, joka sen jälkeen kysyy sitä palvelimelta, pudottaa ne. Laite joka on sammutettu, poissa verkosta tai vain jatkaa jo hallussaan olevia keskusteluja, ei ehkä koskaan kysy — ja siihen asti se näyttää yhä sen mitä sillä oli.",
  "panic.keeps": "Poistettujen keskustelujen päivämäärät tallennetaan AVAIMESI taakse. Niitä ei näytetä millään ruudulla.",
  "panic.otherSide": "Lopetusilmoitus lähetetään jokaiselle, jonka kanssa puhuit. Tämä ei poista mitään heidän laitteiltaan eikä pysäytä mitään, mikä on jo matkalla heille.",
  "panic.survives": "AVAIMESI toimii tämän jälkeenkin ja avaa tyhjän listan. Tämä poistaa keskustelut, ei AVAINTASI.",
  "panic.done": "Keskustelusi on poistettu listalta. Tämä laite on tyhjennetty.",
  "panic.toldNone": "Keskustelut poistettiin. Lopetusilmoitusta ei saatu lähetettyä, ja heidän kopionsa ovat yhä auki heidän laitteillaan.",
  "panic.fromGate": "Minun täytyy poistaa jokainen keskustelu",

  // ── phrase
  "phrase.writeItDown": "Kirjoita se ylös ja säilytä turvallisessa paikassa. Salasanojen hallintaohjelma on paras paikka.",
  "phrase.choose": "Valitse se, joka sinun on helpoin kirjoittaa ylös.",
  "phrase.use": "Käytä tätä",
  "phrase.more": "Näytä 6 lisää",
  "phrase.longer": "Haluan pidemmän AVAIMEN",
  "phrase.capReached": "Valitse jokin näistä 10 sarjasta, joissa on 6 vaihtoehtoa — ne ovat kaikki hyviä.",
  "phrase.written": "Olen kirjoittanut sen ylös",
  "phrase.confirm": "Kirjoita se nyt tähän takaisin, jotta voidaan olla varmoja että se on [turvallisessa paikassa](retype).",
  "phrase.placeholder": "Kirjoita AVAIN",
  "phrase.showPhraseAgain": "Näytä AVAIN uudelleen",
  "phrase.showChoicesAgain": "Näytä vaihtoehdot uudelleen",
  "phrase.thisIsIt": "Tämä on AVAIMENI",
  "phrase.wrong": "Tuo ei ole sama AVAIN. Tarkista mitä kirjoitit ylös ja yritä uudelleen.",
  "phrase.pasted.title": "Liitit AVAIMEN.",
  "phrase.pasted.body": "Varmista siis oikein huolellisesti, että se on kunnolla tallessa siellä mistä liitit sen. Jos hukkaat tämän AVAIMEN, kukaan — emme mekään — ei voi enää avata keskustelujasi.",
  "phrase.pasted.ok": "Selvä",
  "phrase.longPhraseNote": "10 sanaa. Kaikin muin tavoin sama.",

  // ── primitives
  "primitives.missing": "Tämä selain ei osaa yhtä niistä salauksen lajeista, joiden varaan tämä sovellus on rakennettu, eikä sen korvaajaa saatu ladattua.",
  "primitives.what": "Selaimen päivittäminen tai sivun avaaminen toisessa selaimessa yleensä riittää. Mitään ei ole lähetetty, eikä mitään tällä laitteella jo olevaa ole muutettu.",

  // ── product
  "product.name": "haamu",
  "product.gloss": "",
  "product.endedTitle": "haamu — loppunut",
  "product.what.0": "haamu on **turvallinen viestisovellus**. Siinä ei ole **tilejä, käyttäjätunnuksia eikä salasanoja**. Se ei koskaan kysy puhelinnumeroasi tai sähköpostiosoitettasi.",
  "product.what.1": "Sen sijaan saat **8 sanaa**, jotka ovat keskustelujesi salainen [AVAIN](key). AVAIN on identiteettisi, eikä se koskaan lähde tältä laitteelta. Kirjoita se ylös turvalliseen paikkaan, sillä se on ainoa tie takaisin keskusteluihisi ja yhteystietoihisi. Meillä sitä ei ole, emmekä voi auttaa sinua jos hukkaat sen.",
  "product.what.2": "Uuden keskustelun aloitat lähettämällä [kutsulinkin](invite-link), jonka voi **avata vain kerran**. Vanhat keskustelut säilyvät AVAIMESI takana. Viestit poistuvat itsestään 24 h kuluttua.",
  "product.what.3": "Kun keskustelu on alkanut, vain sinä ja ystäväsi voitte lukea sen. [Palvelin](server) **ei pysty lukemaan sitä**.",

  // ── roster
  "roster.failure.access_rule": "Olet jo tarkistanut viime tunnin aikana. Voit tarkistaa kerran tunnissa. Toisella laitteella tehty muutos saapuu myös itsestään seuraavan kerran, kun lisäät, nimeät uudelleen tai poistat keskustelun täällä.",
  "roster.failure.not_found": "Tuota AVAINTA ei löydy. Tarkista mitä kirjoitit ylös ja yritä uudelleen — tämä ei luo uutta.",
  "roster.failure.identity_exists": "Tuo AVAIN on jo olemassa. Avaa se sen sijaan, että ottaisit käyttöön uuden.",
  "roster.failure.rate_limited": "Liian monta yritystä tästä verkosta. Odota tunti ja yritä uudelleen.",
  "roster.failure.stale": "Palvelin tarjosi vanhempaa keskustelulistaa kuin tämä laite on jo nähnyt. Näin ei pitäisi käydä. Täällä ei ole muutettu mitään; yritä myöhemmin uudelleen äläkä muodosta mitään pariliitosta uudelleen kanavaa pitkin, josta et ole varma.",
  "roster.failure.conflict": "Toinen laitteesi muutti listaa samaan aikaan. Täällä ei muutettu mitään — odota hetki ja yritä uudelleen.",
  "roster.failure.roster_full": "Keskustelulistasi on täynnä. Poista keskustelu jota et enää tarvitse, niin uudelle tulee tilaa — listan koko on kiinteä, ja jokaisesta poistosta jää merkintä AVAIMESI taakse.",
  "roster.failure.storage_full": "Palvelin on täynnä eikä ota juuri nyt vastaan mitään uutta. Mitään ei menetetty — yritä myöhemmin uudelleen.",
  "roster.failure.unauthorized": "Palvelin ei hyväksynyt tämän laitteen allekirjoitusta, eikä kello selitä sitä. Mitään ei muutettu.",
  "roster.failure.server_state": "Palvelin ei ottanut tätä vastaan. Mitään ei muutettu — yritä hetken kuluttua uudelleen.",

  // ── server
  "server.cannotRead": "Viestit menevät palvelimelle salattuina. Palvelimella on 3 asiaa: [postilaatikko](mailbox) eli luotu tunnusnumero, yksi julkinen arvo ja salattu viesti. Mikään, millä sen voisi avata, ei koskaan päädy palvelimelle, joten se ei pysty lukemaan keskusteluasi.",
  "server.whenItGoes": "Viesti poistetaan palvelimelta sillä hetkellä, kun vastaanottajan laite on hakenut sen. Kaikkea hakematta jäänyttä säilytetään vähintään 7 päivää, ja se poistetaan, kun postilaatikko kierrätetään — 14 päivää sen jälkeen, kun postilaatikko luotiin.",
  "server.list": "Keskustelulistasi säilytetään myös palvelimella, salattuna AVAIMESI alle ja arkistoituna numeron alle. Ei puhelinta, ei nimeä, ei sähköpostiosoitetta — eikä palvelin pysty lukemaan sitäkään.",
  "server.metadata": "Palvelin näkee, että jokin postilaatikko — luotu tunnusnumero — vastaanotti jonkin kokoisen salatun viestin jollain hetkellä. Se on [metatietoa](metadata): ei luettavaa tekstiä, ei nimeä, ei sähköpostiosoitetta. Jokaisen viestejä välittävän palvelimen on tiedettävä ainakin tuon verran.",
  "server.ghostAdds": "Tässä tilassa tuohon listaan ei kirjoiteta mitään, joten palvelimella ei ole mitään, mikä yhdistäisi tämän keskustelun mihinkään henkilöllisyyteesi.",

  // ── tabs
  "tabs.blocked": "Tämän sovelluksen toinen välilehti on auki ja pitää hallussaan vanhempaa versiota paikallisesta tallennustilastasi. Sulje muut välilehdet ja lataa tämä uudelleen.",
  "tabs.upgraded": "Tästä sovelluksesta avattiin uudempi versio toisella välilehdellä, ja se tarvitsee tämän päästämään irti paikallisesta tallennustilastasi. Lataa sivu uudelleen jatkaaksesi.",
  "tabs.endedElsewhere": "Tämän selaimen toinen välilehti poisti viestisi ja unohti AVAIMEN, joten tämäkin unohti.",
  "tabs.endConfirmed": "Valmis. Viestisi on poistettu tämän selaimen jokaiselta välilehdeltä.",
  "tabs.endUnconfirmed": "Lopetettu tällä välilehdellä. Tämä selain ei pystynyt varmistamaan, että jokainen muu tämän sovelluksen välilehti olisi tehnyt saman — jos niitä on auki, sulje ne.",
  "tabs.dormantTitle": "Tämä on jo auki",
  "tabs.dormantBody.0": "Tämä on jo auki tämän selaimen toisella välilehdellä. Kaikki viestit saapuvat sinne.",
  "tabs.dormantBody.1": "Vain yksi paikka voi pyörittää sitä kerrallaan. Jos löydät sen toisen välilehden, jatka siellä — muuten siirrä se tänne.",
  "tabs.useHere": "Siirrä keskustelu tälle välilehdelle",
  "tabs.dormantWhy": "Kummassakaan tapauksessa ei mene mitään hukkaan. Tämän selaimen jokainen välilehti lukee samaa tallennettua kopiota.",

  // ── terms
  "terms.key.label": "AVAIN",
  "terms.key.title": "Sinun AVAIMESI",
  "terms.key.body.0": "Se on 8 lyhyttä sanaa, jotka arvotaan tällä laitteella sillä hetkellä kun otat sen käyttöön. Ne lukitsevat keskustelusi ja yhteystietosi.",
  "terms.key.body.1": "Itse sanat eivät koskaan lähde tältä laitteelta. Yksi niistä laskettu numero kyllä matkustaa: sen alle palvelin arkistoi keskustelulistasi, jotta muut laitteesi löytävät sen. Sitä numeroa ei voi muuttaa takaisin sanoiksesi.",
  "terms.key.body.2": "AVAIN isoin kirjaimin tarkoittaa aina näitä sinun sanojasi.",
  "terms.key.body.3": "Sen takana ei ole tiliä, ei sähköpostiosoitetta eikä mitään tapaa nollata sitä. Jos se hukkuu, kukaan ei voi avata keskustelujasi — emme mekään.",
  "terms.retype.label": "turvallisessa paikassa",
  "terms.retype.title": "Miksi se kirjoitetaan uudelleen",
  "terms.retype.body.0": "Kirjoita AVAIN tähän uudelleen, koska haluamme olla varmoja että olet kirjoittanut sen ylös. Emme voi auttaa sinua, jos hukkaat sen.",
  "terms.retype.body.1": "Voit palata katsomaan sitä ja kirjoittaa sen ylös tai kopioida sen turvalliseen paikkaan. Salasanojen hallintaohjelma on AVAIMELLE hyvä paikka.",
  "terms.invite-link.label": "kutsulinkki",
  "terms.invite-link.title": "Kutsulinkki",
  "terms.invite-link.body.0": "Se on verkko-osoite, jonka perässä on salaisuus. Salaisuus on #-merkin jälkeinen osa, eivätkä selaimet koskaan lähetä sitä osaa palvelimelle — niinpä kutsulinkki voi kulkea palvelimen kautta ilman että palvelin saa tietää mitä siinä on.",
  "terms.invite-link.body.1": "Yksi henkilö voi avata sen, kerran, 24 h kuluessa. Avaaminen on se, mikä muodostaa keskustelun. Avaamisen jälkeen se ei enää toimi.",
  "terms.invite-link.body.2": "Se joka avaa sen ensimmäisenä, on se jonka kanssa lopulta puhut. Kutsulinkki ei voi tarkistaa ihmistä puolestasi. Kysy siis ystävältäsi jotain toista tietä, mitkä kuusi numeroa hänellä on.",
  "terms.invite-link.body.3": "Lähetä se niin kuin tavallisestikin puhut sen henkilön kanssa.",
  "terms.invite-link.body.4": "Jos linkki ei tavoita ystävääsi lainkaan, on olemassa puhuttu versio — 16 merkkiä, jotka voit lukea puhelimessa tai lähettää tekstiviestillä. Painike sitä varten on siinä näkymässä, jossa kutsulinkki näytetään.",
  "terms.server.label": "palvelin",
  "terms.server.title": "Mitä palvelimella on",
  "terms.server.body.0": "Viestit salataan laitteellasi ennen kuin ne lähtevät minnekään, ja puretaan ystäväsi laitteella. Välissä palvelimella on postilaatikko — luotu tunnusnumero — yksi julkinen arvo, joka jäi keskustelun muodostamisesta, ja itse salattu viesti.",
  "terms.server.body.1": "Mikään, millä sen voisi purkaa, ei koskaan päädy palvelimelle. Jos joku varastaisi palvelimen, siellä ei yksinkertaisesti ole mitään, millä viestin lukisi.",
  "terms.server.body.2": "Viesti poistetaan sillä hetkellä, kun ystäväsi laite on hakenut sen ja ilmoittanut siitä. Kaikkea hakematta jäänyttä säilytetään vähintään 7 päivää, ja se poistetaan, kun postilaatikko kierrätetään — 14 päivää sen jälkeen, kun postilaatikko luotiin.",
  "terms.server.body.3": "Keskustelulistasi säilytetään myös palvelimella, jotta muut laitteesi löytävät sen. Se on salattu AVAIMESI alle ja arkistoitu numeron alle — ei puhelinta, ei nimeä, ei sähköpostiosoitetta — eikä palvelin pysty lukemaan sitäkään.",
  "terms.mailbox.label": "postilaatikko",
  "terms.mailbox.title": "Postilaatikko",
  "terms.mailbox.body.0": "Luotu tunnusnumero: sitä ei lasketa nimestäsi, puhelinnumerostasi, sähköpostiosoitteestasi tai mistään muustakaan sinun tiedostasi. Se on paikka johon viesti jätetään, eikä se yksinään merkitse mitään.",
  "terms.mailbox.body.1": "Jokainen keskustelu siirtyy uuteen postilaatikkoon 7 päivän välein, jottei yksi numero seuraa keskustelua sen koko eliniän ajan.",
  "terms.metadata.label": "metatieto",
  "terms.metadata.title": "Mitä metatieto tässä tarkoittaa",
  "terms.metadata.body.0": "Metatieto tarkoittaa sitä, että jotain sanottiin — ei sitä mitä sanottiin. Tässä tapauksessa: että jokin postilaatikko (tunnusnumero) vastaanotti tietyn kokoisen salatun viestin tiettynä hetkenä.",
  "terms.metadata.body.1": "Palvelimen on tiedettävä, mihin viesti laitetaan ja milloin se saapui, tai se ei pysty toimittamaan sitä. Mutta toimitusosoite on luotu numero, joka vaihtuu jatkuvasti, ja itse viesti on salattu jollain, joka on vain sinun ja ystäväsi laitteella.",
  "terms.metadata.body.2": "Mitä siinä ei ole: ei luettavaa tekstiä, ei nimeä, ei sähköpostiosoitetta, ei puhelinnumeroa. Se joka lukee kaiken mitä palvelimella on, saa tietää että numeroitu postilaatikko oli tiistaina vilkas.",
  "terms.metadata.body.3": "Kuinka kauan: merkintä viestistä poistetaan yhdessä viestin kanssa — sillä hetkellä kun ystäväsi laite hakee sen, tai 14 päivää postilaatikon tekemisen jälkeen, kumpi tulee ensin. Postilaatikon numero menee samalla.",
  "terms.six-digits.label": "kuusi numeroa",
  "terms.six-digits.title": "Miksi kuusi numeroa",
  "terms.six-digits.body.0": "Jokaisen valmiin keskustelun molemmissa päissä näkyy aina samat kuusi numeroa. Tämä on tarkistus siitä, että toista ruutua pitelevä henkilö on se ystävä, jonka halusit tavoittaa.",
  "terms.six-digits.body.1": "Kysy ystävältäsi jotain toista tietä: äänellä, kasvokkain tai missä tahansa mistä olet varma. Ei samaa reittiä, jota kutsu kulki.",
  "terms.six-digits.body.2": "Sellaisten kysymysten esittäminen täällä, joihin vain ystäväsi osaisi vastata, on jonkin arvoista, ja se on heikompaa kuin miltä tuntuu — myös ystäväsi tunteva osaa vastata niihin.",

  // ── unlock
  "unlock.ask": "Kirjoita AVAIMESI.",
  "unlock.working": "Avataan — tämä vie hetken.",
  "unlock.why": "AVAIMESI ajetaan Argon2id-laskennan läpi 128 MiB:n muistilla, jotta keskustelusi aukeavat. Vanhalla puhelimella siihen menee noin sekunti joka kerta kun kirjaudut sisään.",
  "unlock.placeholder": "AVAIMESI",
  "unlock.notFound": "Tuota AVAINTA ei löydy. Tarkista mitä kirjoitit ylös ja yritä uudelleen — tämä ei luo uutta.",
  "unlock.exists": "Tuo AVAIN on jo olemassa. Avaa se sen sijaan, että ottaisit käyttöön uuden.",
  "unlock.memory": "Tämän laitteen teho tai muisti ei riitä AVAIMESI avaamiseen.",
  "unlock.rateLimited": "Liian monta yritystä tästä verkosta. Odota tunti ja yritä uudelleen.",
  "unlock.unknown": "Jokin meni vikaan, eikä tämä laite osannut kertoa mikä.",
  "unlock.stale": "Palvelin tarjosi vanhempaa keskustelulistaa kuin tämä laite on jo nähnyt. Näin ei pitäisi käydä. Täällä ei ole muutettu mitään; yritä myöhemmin uudelleen äläkä muodosta mitään pariliitosta uudelleen kanavaa pitkin, josta et ole varma.",

  // ── verification
  "verification.unverified": "[Kuutta numeroa](six-digits) ei ole vertailtu tässä keskustelussa.",
  "verification.tripwireTitle": "Joku muu avasi tämän keskustelun kutsulinkin",
  "verification.tripwire": "Joku muu kuin ystäväsi sai tämän kutsulinkin ja yritti käyttää sitä. Keskustelu meni sille, joka vastasi ensin, eikä mikään täällä kerro, onko tämä ystäväsi.\n\nVertaile [kuusi numeroa](six-digits) ystäväsi kanssa ääneen. Jos ne täsmäävät, tämä on ystäväsi. Jos eivät täsmää, poista tämä keskustelu ja muodosta pariliitos uudelleen uudella kutsulinkillä, joka lähetetään eri tavalla.\n\nTämä ilmoitus säilyy, kunnes keskustelu poistetaan. Numeroiden vertailu ei poista sitä: se kertoo, kuka on toisessa päässä — ei sitä, ettei kukaan muu ole koskaan pitänyt kutsulinkkiä hallussaan.",
  "verification.check": "Vertaile kuusi numeroa",
  "verification.checkLater": "Nämä ovat samat kuusi numeroa kuin keskustelun alkaessa. Lue ne ystävällesi ja vertailkaa.",
  "verification.matched": "Ne ovat samat",
  "verification.notNow": "Ei nyt",
  "verification.verified": "Kuusi numeroa vertailtu.",
};

/**
 * "1 keskustelu" / "3 keskustelua" — a count and its noun.
 *
 * ⚠️⚠️ THIS IS WHY THE FINNISH NEEDED FUNCTIONS AT ALL, and it is the half of D-153 that
 * cost the most. English has one plural rule and it is a suffix, so *"3 conversations"*
 * and *"1 conversation"* differ by an s. **A Finnish numeral changes the CASE of the noun
 * after it**: one takes the nominative, everything else takes the partitive singular —
 * *1 keskustelu*, *3 keskustelua*, *17 keskustelua*. Spelled out, the old translation
 * could dodge this by writing the whole phrase; a digit cannot inflect, so the noun has to
 * carry it. ⭐ Getting the case wrong in Finnish is not a style slip, it is a different
 * sentence.
 *
 * ⚠️ The verb does NOT follow. *1 keskustelu puuttuu* and *3 keskustelua puuttuu* — Finnish
 * does not agree a verb with a numeral subject, where English moves *is* to *are*. So a
 * sentence that branches in English may not branch here, and one that does not may.
 */
const count = (n, yksikkö, monikko) => `${n} ${n === 1 ? yksikkö : monikko}`;

/**
 * A measured offset, in the unit a person would say it in.
 *
 * ⚠️⚠️ AND THE CASE RULE IS THE OTHER WAY ROUND FROM `count`, which is exactly the kind of
 * thing that makes machine translation of this file wrong. A counted noun takes the
 * nominative at one; an amount BEFORE a postposition takes the GENITIVE at one and the
 * partitive above it: *kello on 1 minuutin edellä*, *kello on 3 minuuttia edellä*. Two
 * rules, one language, and the digit is what forces both of them into the open.
 */
const offset = (seconds) => {
  const s = Math.abs(seconds);
  const [n, yksikkö, monikko] =
    s >= 3600 ? [Math.round(s / 3600), "tunnin", "tuntia"] : [Math.round(s / 60), "minuutin", "minuuttia"];
  return `${n} ${n === 1 ? yksikkö : monikko}`;
};

/**
 * The thirteen sentences the product assembles while it is running, in Finnish.
 *
 * ⚠️ SAME PATHS, SAME ARGUMENTS, SAME ORDER as `copy.js`. `test/copy-fi.mjs` renders both
 * modules over `test/samples.mjs` and compares them branch by branch, so a Finnish
 * function that takes its arguments in the other order is a build failure rather than a
 * sentence about the wrong number.
 *
 * ⚠️⚠️ THE ONLY INTERPOLATION IS OF ARGUMENTS. Constants are written out here as they are
 * in `FI` above — *16 merkistä*, not `${CODE_CHARS}` — and the gate holds them to the
 * English rendering of the same branch. See the note at the head of this file.
 */
export const FI_BUILT = {
  // ⚠️⚠️ THESE FOUR ARE FUNCTIONS AND THEREFORE BELONG HERE, NOT IN `FI` ABOVE.
  // `finnishByKey()` reads plain strings from `FI` and built sentences from this
  // object; a function left in `FI` is not read at all, so the Finnish silently does
  // not exist and the English shows through. The suite caught it — `no Finnish is
  // left for a sentence that is gone` and D-153's number check both named all four.
  //
  // ⚠️ CHECKED AGAINST THE ENGLISH, WHICH HAS ALREADY PASSED THE RULE, rather than
  // against a Finnish reading of what the build line ought to say. "kysytään
  // palvelimelta" is *is being asked from the server*; "ei saatu yhteyttä" is
  // *contact was not obtained*, which is what "could not reach" claims and no more.
  "diagnostics.proofAt": (ms, bits) => `${ms} ms, ${bits} bittiä`,
  "diagnostics.build.asking": (id) => `${id}, kysytään palvelimelta`,
  "diagnostics.build.failed": (id) => `${id}, palvelimeen ei saatu yhteyttä vertailua varten`,
  "diagnostics.build.current": (id) => `${id}, nykyinen versio`,
  "diagnostics.build.stale": (id, served) =>
    `${id} — VANHA. Palvelimella on ${served}. Lataa tämä sivu uudelleen.`,
  // ── chat
  "chat.unreadable": (reason) => `Saapui viesti, jota ei voitu lukea (${reason}).`,

  // ⭐⭐ THE SINGULAR SAYS LESS THAN THE ENGLISH DOES, BY HANNU'S RULING, and it is the one
  // change he made on his read of these thirteen: *"This does not need siinä."* The English
  // says *"until you send a message in it"* and the Finnish now stops at *lähetät viestin* —
  // because at one conversation there is nowhere else the message could go, and Finnish does
  // not need the locative to say so. ⚠️ The plural keeps *kussakin niistä*: at three, "send a
  // message" without "in each of them" is a different instruction.
  //
  // ⚠️ SO THE TWO BRANCHES ARE NOT A TRANSLATION OF THE SAME SHAPE, and that is correct
  // rather than an oversight — a sentence that mirrors the English clause for clause is a
  // sentence written in English with Finnish words.
  "chat.reconnect.some": (n) =>
    n === 1
      ? `${n} keskustelu ei voi vastaanottaa, ennen kuin lähetät viestin.`
      : `${n} keskustelua ei voi vastaanottaa, ennen kuin lähetät kussakin niistä viestin.`,

  // ── deletion
  "deletion.confirmOne": (name) =>
    `Poistetaanko “${name}” kaikkialta?\n\n` +
    "Tämä poistaa sen jokaiselta laitteeltasi, eikä sitä voi perua. Toiselle henkilölle jää hänen oma kopionsa.",

  // ⭐ §7.3.1a's quarantine notice, and the English had no singular here at all until
  // D-156 — *"1 conversations were deleted"*, on the reading `renderQuarantine` produces
  // most often. Finnish would have said *"1 keskustelua poistettiin"*, wrong the same way.
  "deletion.suspect": (n) => `${count(n, "keskustelu", "keskustelua")} poistettiin toiselta laitteelta.`,

  // ── list
  "list.unnamedOn": (when) => `Ei vielä nimeä · aloitettu laitteella ${when}`,

  "list.noHistory": (writtenAt, channels) =>
    `Tämä laite ei ole nähnyt tätä listaa aiemmin. Sen mukaan se tallennettiin viimeksi laitteella ${writtenAt}, ` +
    `ja siinä on ${count(channels, "keskustelu", "keskustelua")}.`,

  // ⚠️ The 2 is fixed in both languages — §7.3.1 rule 4 is about two devices whose clocks
  // were equal, so there is no other number it could be.
  "list.nameUnresolved": (kept) =>
    `2 laitetta nimesi keskustelun uudelleen samalla hetkellä. Tämän nimi on yhä “${kept}”.`,

  // ⚠️ *puuttuu* does not move between the branches, where English moves "is" to "are".
  "list.unexplained": (n) =>
    `${count(n, "keskustelu", "keskustelua")} puuttuu listasta, jonka palvelin lähetti, eikä mikään siinä selitä ` +
    "miksi. Älä muodosta mitään pariliitosta uudelleen, ennen kuin tiedät enemmän.",

  // ── openLink
  "openLink.codeShort": (n) =>
    `Tuossa on ${n} niistä 16 merkistä, jotka koodissa on. Pyydä ystävääsi lukemaan se uudelleen — jokin merkki ` +
    "on voinut jäädä pois tai kuulua I:nä, L:nä tai 1:nä, joita koodissa ei koskaan ole.",

  // ⚠️ The bare 16 at the end has no noun after it, as the English elides "characters".
  // The 1 in the sentence above names a GLYPH and is not a count; both files exempt it by
  // the sentence it lives in rather than by the digit.
  "openLink.codeLong": (n) =>
    `Tuossa on ${n} merkkiä, ja koodissa on 16. Tarkista, että kentässä on vain se yksi koodi.`,

  // ── panic
  // ⚠️⚠️ THE ONE PLACE THE STRUCTURE HAD TO CHANGE. Round 27 read *kerrottiin kolmessa
  // niistä* — "in three of them" — where the NUMERAL itself is inflected. A digit cannot
  // inflect, so that becomes *3:ssa niistä*, a written form nobody wants in a warning.
  // Putting the noun back after the digit gives the case somewhere to live.
  "panic.told": (n, of) =>
    `${count(of, "keskustelu", "keskustelua")} poistettu, ja lopetusilmoitus lähetettiin toiselle henkilölle ${n} keskustelussa.`,

  // ── phrase
  // ⭐ The zero branch is its own sentence and had never been on a review sheet in any of
  // the 27 rounds (D-156). Lowercase, like the English: it sits under the list.
  "phrase.setsLeft": (left) =>
    left > 0 ? `${count(left, "sarja", "sarjaa")} jäljellä` : "ei enempää sarjoja — valitse jokin näistä",

  // ── roster
  // ⚠️ *edellä* / *jäljessä* — ahead / behind. Only the first of these four corners had
  // ever been translated; the behind half, the hours unit and the singular arrived with
  // D-156.
  "roster.failure.clock_skew": (seconds) =>
    `Tämän laitteen kello on noin ${offset(seconds)} palvelinta ${seconds > 0 ? "edellä" : "jäljessä"}, mikä ` +
    "estää yhteyden. Aseta tämän laitteen kello oikeaan aikaan — verkkoajan asetus riittää — ja yritä uudelleen.",
};
