# tools: small programs that build parts of the website

Run them from the project folder (one level up). Not published on the website.

| File | What it does | How to run |
|---|---|---|
| `sync_shared.py` | Copies the menu, footer, search list and floating call button from `index.html` (the MASTER copy) to every page and highlights each page's own menu item. Also writes each page's share preview and Google markup (business details on Home and Contact, breadcrumbs elsewhere) and re-runs `gen_services.py` | `python tools/sync_shared.py .` (prints `ok`) after changing the menu, footer, search list, a page title or the calculators page |
| `gen_services.py` | Builds the four service pages (`tax-preparation-planning.html`, `bookkeeping-payroll.html`, `business-consulting.html`, `future-security.html`) from the `financial-calculators.html` page plus each service's text in `===== SERVICES DATA` | Run `sync_shared.py` instead: it runs this and then fixes the service pages' menus |
| `build_reviews.py` | Turns `reviews.xlsx` into the review cards and Google buttons on the home page and the About page (`REVIEWS` and `REVIEW-BUTTON` markers in `index.html` and `about.html`) | Double-click `update-reviews.bat` (it runs this and publishes) |
| `build-site.sh` | Copies the published files into `dist/` for Cloudflare Pages (being set up in another session; not on GitHub yet) | Used by Cloudflare's build |

Details: `docs/CODE-MAP.md`, sections 2 and 3.
