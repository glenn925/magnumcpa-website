# tools: small programs that build parts of the website

Run them from the project folder (one level up). Not published on the website.

| File | What it does | How to run |
|---|---|---|
| `gen_services.py` | Builds the four service pages (`tax-preparation-planning.html`, `bookkeeping-payroll.html`, `business-consulting.html`, `future-security.html`) from the `financial-calculators.html` page plus each service's text in `===== SERVICES DATA` | `python tools/gen_services.py .` (prints `ok`) |
| `build_reviews.py` | Turns `reviews.xlsx` into the review cards and Google buttons on the home page (`REVIEWS` and `REVIEW-BUTTON` markers in `index.html`) | Double-click `update-reviews.bat` (it runs this and publishes) |
| `build-site.sh` | Copies the published files into `dist/` for Cloudflare Pages (being set up in another session; not on GitHub yet) | Used by Cloudflare's build |

Details: `docs/CODE-MAP.md`, sections 2 and 3.
