# Plan: every menu heading gets its own page

**Status:** built 2026-11-12 (steps 1 to 5 and 7). Step 6, the Google side, is Glenn's to do.
Written 2026-11-09. Not published on the website (the `docs/` folder is excluded in `_config.yml`).

## Why

Google ranks a page for the topic it is about. When About, Contact, the newsletters
and everything else share one long home page, Google sees one page about everything,
and visitors who search "Magnum CPA contact" land at the top of the home page instead
of on the part they wanted. One page per topic, each with its own clean address
(`magnumcpa.com/about`), title and description, fixes both.

## Where things stand

| Menu item | Page / address | Status |
|---|---|---|
| Home | `/` | Done: hero, Why Choose Us, Explore cards (one per page), reviews, video |
| About Us (with Mission and Reviews) | `/about` | Done (2026-11-12). Why Choose Us stayed on Home |
| Services | `/services` | Done (2026-11-09) |
| The four service pages | `/tax-preparation-planning`, `/bookkeeping-payroll`, `/business-consulting`, `/future-security` | Exist; still blank until the service text arrives |
| Resources: Client Newsletter | `/client-newsletter` | Done (2026-11-12) |
| Resources: Tax Planning Newsletter | `/tax-planning-newsletter` | Done (2026-11-12) |
| Resources: Tax Videos | `/tax-videos` | Done (2026-11-09) |
| Resources: Financial Calculators | `/financial-calculators` | Exists |
| Resources: Video Library, Client Portal | External sites | No page needed |
| Request Consultation | `/request-consultation` | Exists |
| Contact Us (with the Google Business Profile box) | `/contact` | Done (2026-11-12) |

## Steps

1. **One menu and footer for every page (do this first).** Add `tools/sync_shared.py`,
   which copies the menu and footer from `index.html` into every hand-edited page, and a
   small script that highlights the current page's menu item from the address. With about
   ten pages, copying the menu by hand becomes the main source of mistakes.
   *About half a day.*
2. **Move About, the two newsletters and Contact** to their own pages, one page per
   commit, built from the same page shell as `services.html`. Each gets its own title,
   description, `h1` heading, `CLEAN ADDRESS` block and a line in `sitemap.xml`.
   *About an hour per page.*
3. **Keep old links working.** Add `#about`, `#contact`, `#client-newsletter` and
   `#tax-planning-newsletter` to the `moved` list in `index.html` (`===== #request REDIRECT`),
   so `magnumcpa.com/#about` opens `/about`. Hovering a menu link then shows a clean address too.
4. **Decide what stays on Home.** With everything moved out, Home is the hero, Why Choose
   Us and the "Why Get Tax Help" video. A very thin home page ranks weaker, so consider
   short teaser cards that link to each page. Glenn's call.
5. **Local search markup.** Business details for Google (`AccountingService`: name,
   address, phone, hours, social links) on Home and Contact; breadcrumb markup on
   sub-pages; share-preview tags (Open Graph) on every page. *About an hour.*
6. **Google side.** Verify the site in Google Search Console, submit `sitemap.xml`,
   request indexing of each new page, and check that the Google Business Profile's
   website field is `https://www.magnumcpa.com/`. *About an hour.*
7. **Check and save as you go.** Before each page move, double-click
   `versions\save-version.bat`. After it, test the menu, footer, search, the curtain
   wipe to the form and the old `#` links, then publish.

## What was built (2026-11-12)

- `tools/sync_shared.py`: `index.html` holds the master menu, footer and search list; the tool copies them
  to every page, highlights each page's own item at build time (works without JavaScript), and writes the
  share preview (Open Graph) and Google markup: business details (`AccountingService`) on Home and Contact,
  breadcrumbs on every other page.
- `/about`, `/contact`, `/client-newsletter`, `/tax-planning-newsletter`, each with its own title, description,
  one `h1`, canonical address and sitemap line. Old `#about`-style links open the new pages.
- Home: Explore cards link to every page; the reviews show on Home and About (`update-reviews.bat` updates both).

## Already done (2026-11-09)

- Clean addresses everywhere: no `.html` and no `#home` in links; `sitemap.xml` and `robots.txt`.
- `/services` and `/tax-videos` are their own pages and are no longer on the home page.
- Fake reviews removed; reviews now come from `reviews.xlsx` (Show = Yes/No).
- The Contact map is now the Google Business Profile box.
