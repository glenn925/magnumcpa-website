# Code map — where to find and fix things

Every code file has plain-English comments above each block. Big files are
split into named parts with **banners** like `===== HERO =====`. To jump to a
part, open the file in VS Code, press **Ctrl+F**, and type the banner name
(e.g. `===== HERO`). The same name is used for that part's styles (CSS),
content (HTML) and behaviour (JavaScript), so searching finds all three.

Line numbers change with every edit, so this map uses banner names.

> Before any risky change, double-click `versions\save-version.bat`.
> If something breaks, use `versions\restore-version.bat` (see `versions\README.md`).

---

## 1. "I want to change…" (quick index)

| I want to change… | File | Search for |
|---|---|---|
| Brand colors, fonts, base text size | `index.html` (and same block in the other pages) | `===== SITE-WIDE SETUP` / `COLORS` |
| "First consultation is free" strip | `index.html` | `===== ANNOUNCEMENT BANNER` |
| Phone, email, office hours (top bar) | every page | `===== TOP BAR` |
| Menu items / dropdowns | every page (change all of them: `index.html`, `services.html`, `tax-videos.html`, `request-consultation.html`, `financial-calculators.html` + re-run the generator) | `===== HEADER / NAV` (`MAIN MENU` on the other pages) |
| Home headline, hero photo, main button | `index.html` | `===== HERO` |
| Award badge cards | `index.html` | `===== WHY CHOOSE US` |
| About text, Max's photo | `index.html` | `===== ABOUT US` |
| Client reviews (which Google reviews show) | `reviews.xlsx`, then double-click `update-reviews.bat` | Reviews sheet: one row per review, **Show = Yes/No** picks what appears. Never type review cards into `index.html` |
| "Leave Us a Google Review" / "See All Our Reviews on Google" buttons | `reviews.xlsx` → Settings sheet | B2 and B3 (blank = button hidden) |
| YouTube "Why get tax help" video | `index.html` | `===== WHY GET TAX HELP` |
| The four service cards (Services page) | `services.html` | `===== SERVICES` (styles: `===== SERVICES PAGE`) |
| Newsletter / article cards | `index.html` | `===== CLIENT NEWSLETTER`, `===== TAX PLANNING NEWSLETTER` |
| Tax videos (add/remove a video) | `tax-videos.html` | `===== TAX VIDEOS SCRIPT` (the VIDEOS list) |
| Contact photo, address | `index.html` | `===== CONTACT` |
| Google Business Profile box (map with stars and reviews) | `index.html` | `===== GOOGLE BUSINESS PROFILE` |
| Old links like `magnumcpa.com/#services` opening the new page | `index.html` | `===== #request REDIRECT` (the `moved` list) |
| Footer links, social icons | every page | `===== FOOTER` |
| Floating "Book a Consultation" button | every page | `===== FLOATING BOOK BUTTON` |
| Booking pop-up (when it appears, its text) | `index.html` | `===== BOOKING POPUP` |
| Site search results list | every page | `===== SEARCH` (the `INDEX` list) |
| Phone/tablet layout fixes | every page | `===== RESPONSIVE` |
| Blue "curtain" page transition | `index.html`, `request-consultation.html` | `===== PAGE TRANSITIONS`, `===== CURTAIN WIPE` |
| Consultation form fields / wording | `request-consultation.html` | `===== FORM FIELDS` |
| Where the form sends data | `request-consultation.html` | `LEAD_API_URL` (in `===== FORM SETTINGS`) |
| Booking calendar link (Acuity) | `request-consultation.html` | `ACUITY_BASE` |
| Anti-spam box (Turnstile) | `request-consultation.html` | `===== TURNSTILE` |
| Calculator list | `financial-calculators.html` | `===== CALCULATOR LIST` |
| A service page's text, photo, heading | `tools/gen_services.py` | `===== SERVICES DATA` (then re-run the generator — see §3) |
| Shared header/footer of service pages | `financial-calculators.html` | then re-run the generator |
| A page's official address for Google | every page | `===== CLEAN ADDRESS` (the `canonical` line) |
| Why `#about` doesn't show in the address bar | `index.html` | `===== CLEAN ADDRESS: no #section` (script) |
| The list of pages Google should find | `sitemap.xml` | add a `<url>` line per new page |

**Clean addresses — the one rule.** Links never end in `.html`: write `request-consultation`,
not `request-consultation.html`; the home page is `./`; a home-page section from another page
is `./#contact`. GitHub Pages (and Cloudflare Pages) serve `/request-consultation` from
`request-consultation.html`, and old `.html` links still open the page. A new page also needs
its own `CLEAN ADDRESS` block in the head (copy one, change the canonical address) and a line
in `sitemap.xml`. Links only work through the web server (live site or a local server), not by
double-clicking the .html file.

**Watch out for "restyle" blocks.** Some parts (HERO, WHY CHOOSE US, CTA BAND,
FOOTER) have an older style block and a later one marked *restyle* / *final
overrides*. The **later** one wins — edit that one, or your change won't show.

---

## 2. Website pages

| File | What it is |
|---|---|
| `index.html` | Home page (everything except the form, the service cards and the videos). Starts with a "HOW THIS FILE IS ORGANIZED" note. |
| `services.html` | Services page (`/services`): the four service cards and the call-to-action band. Built once from the calculators page, **edited by hand**. |
| `tax-videos.html` | Tax Videos page (`/tax-videos`): the 45-video gallery. Built once from the calculators page, **edited by hand**. |
| `request-consultation.html` | Request a Consultation page: form → anti-spam check → sends to the backend → shows the Acuity calendar. Starts with a "PAGE OVERVIEW" note listing its banners. |
| `financial-calculators.html` | Calculators page; also the **template** for the four service pages. |
| `tax-preparation-planning.html`, `bookkeeping-payroll.html`, `business-consulting.html`, `future-security.html` | Service pages — **generated, don't edit by hand** (see §3). |
| `CNAME` | Connects the site to www.magnumcpa.com. **Never delete or edit.** |
| `_config.yml` | Tells GitHub Pages which files to keep off the live site. |
| `sitemap.xml`, `robots.txt` | Tell Google which pages exist (clean addresses) and that it may read them all. |
| `reviews.xlsx`, `update-reviews.bat`, `tools/build_reviews.py` | Client reviews: the spreadsheet holds the reviews, the .bat builds the review cards into `index.html` and publishes. Not on the live site. |
| `MULTI-PAGE-PLAN.md` | The plan for giving every menu heading its own page (not built yet). |
| `images/` | All pictures. `sig-*.png` are used by Max's **email signature** — keep them. |

### Showing real Google reviews on the home page
1. Open `reviews.xlsx`. On the **Reviews** sheet add one row per Google review: Show = **Yes**,
   Stars, Name (e.g. Jane D.), Review (pasted word for word), Review Link (that review's Share link).
   Set Show = **No** to keep a review in the sheet but off the website.
2. On the **Settings** sheet: B2 = your "Ask for reviews" link, B3 = your Google reviews page link.
3. Save, close Excel, double-click `update-reviews.bat`. It builds the cards and publishes.
   With no Show = Yes rows, the review slideshow stays hidden (only the Google buttons show).

### Adding a field to the consultation form (end to end)
1. `request-consultation.html` → `===== FORM FIELDS`: add the input.
2. Same file: add it in `collectLeadFields()` and check it in `validateLeadClientSide()`.
3. `worker/src/validate.ts` and `worker/src/routes/lead.ts`: allow and store it.
4. Deploy the backend (§4).

---

## 3. Service pages generator

`tools/gen_services.py` builds the four service pages by copying the head,
menu and footer of `financial-calculators.html` and inserting each service's
own content from `===== SERVICES DATA`.

- Change a service's words/photo/icon → edit `SERVICES` (and `H1_MAP`) in the generator.
- Change the shared header/menu/footer/styles → edit `financial-calculators.html`.
- Then, from the project folder: `python tools/gen_services.py .`
- Anything typed directly into the four service pages is lost on the next run.
- The generator finds text by exact match. If you reword the calculators page's
  title, description or menu links, check the service pages still look right.

---

## 4. Form backend (Cloudflare Worker) — `worker/`

Runs at `https://magnum-cpa-lead-worker.glenn-c44.workers.dev` in the company
Cloudflare account (glenn@magnumcpa.com). Every file starts with a header comment.

**Deploy:** terminal in `worker/` → `npx wrangler whoami` (must show
glenn@magnumcpa.com) → `npm test` → `npx wrangler deploy`.

| File | What it does / edit for |
|---|---|
| `wrangler.toml` | Deploy settings, storage IDs, 15-min schedule, `ALLOWED_ORIGINS` (sites allowed to send forms), list of secrets |
| `src/index.ts` | Router (which address goes to which handler) and the 15-minute scheduled jobs |
| `src/routes/lead.ts` | **Consultation form**: checks, spam/duplicate filter, saving, Canopy hand-off |
| `src/routes/library.ts` | Video library: sign-up gate, video list, play tracking |
| `src/routes/admin.ts` | Video library admin panel backend (login, videos, leads, analytics, settings) |
| `src/http.ts` | Builds every reply; CORS (which websites may call the backend) |
| `src/validate.ts` | Form field rules and length limits |
| `src/spam.ts` | Spam scoring (keywords, throwaway email domains, threshold) |
| `src/ratelimit.ts` | How many forms one visitor can send (`MAX_PER_WINDOW`, `WINDOW_SECONDS`) |
| `src/dedupe.ts` | Duplicate-submission time windows |
| `src/turnstile.ts` | Verifies the "I am human" check |
| `src/sanitize.ts`, `src/normalize.ts` | Clean up form input (strip tags, tidy names/emails/phones) |
| `src/canopy-client.ts`, `src/queue.ts` | Sending leads to Canopy (not connected yet) and the retry queue |
| `src/leads.ts`, `src/library-delivery.ts`, `src/csv.ts` | Video-library sign-ups: storage, delivery, CSV export |
| `src/analytics.ts`, `src/analytics-core.ts` | Video play/click counting and dashboard numbers |
| `src/token.ts` | Admin password check and login tokens (`TOKEN_TTL_SECONDS`) |
| `src/videos.ts`, `src/videourl.ts`, `src/settings.ts` | Video list storage, allowed video links, library settings |
| `src/kv.ts` | Storage helpers and a **map of every storage key** |
| `src/audit.ts` | Event log (kept 90 days) |
| `test/units.test.ts` | Tests — run `npm test` in `worker/` |

**Routes:** `POST /lead` (consultation form) · `GET /api/videos` ·
`POST /api/library/access` · `POST /api/track` · `/api/admin/*`.

**Where consultation leads are stored:** Cloudflare storage `LEADS_KV`, keys
`pending:<id>` (waiting for Canopy). List them with
`npx wrangler kv key list --binding LEADS_KV` in `worker/`.
Nobody is emailed when a form arrives yet.

---

## 5. Other files

| File | Purpose |
|---|---|
| `sync.bat` | Double-click to publish: pulls, commits, pushes to GitHub (live in 1–2 min) |
| `update-reviews.bat` | Double-click after editing `reviews.xlsx` (Excel closed): builds the review cards and publishes only those |
| `versions/` | Saved versions + save/restore scripts (see `versions/README.md`) |
| `README.md` | Hosting overview (GitHub Pages, GoDaddy DNS, Google email, Cloudflare) |
| `SETUP-CLOUDFLARE.md`, `RECENT-UPDATES.md` | Older setup notes and change history |

---

## 6. Known issues (found while commenting — not fixed yet)

**Website**
- Booking pop-up reads browser storage without a guard; where storage is
  blocked, the home page search stops working (`index.html`, `BOOKING POPUP`).
- Form subtitle says **EST**; the office is in Sacramento (Pacific).
- After a rejected submit, the anti-spam token isn't reset, so a second try can fail.
- "Subscribe to the Newsletter" only jumps to Contact (no sign-up form).
- Comment above `LEAD_API_URL` still says "Fill in once the Worker is deployed".
- Calculator cards are not links; Resources menu item links to `#`.
- Form labels aren't linked to their inputs (accessibility).
- Unused/duplicate style blocks in every page (marked in comments).

**Generator** — exact-text replaces fail silently; search entries for service
pages never update after the first run; some unused code.

**Backend** — `/api/track` has no rate limit; admin login can be locked out by
anyone; analytics roll-up can double-count after a crash; library sign-ups
expire after 400 days; network calls to Canopy/Turnstile have no timeout;
remove `https://glennnnnnn1.github.io` from `ALLOWED_ORIGINS`.
