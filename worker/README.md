# worker: the consultation form backend (Cloudflare Worker)

The program that receives the Request a Consultation form, checks it for spam,
stores the lead, and runs the video library sign-ups and admin panel. It runs on
Cloudflare at `https://magnum-cpa-lead-worker.glenn-c44.workers.dev`, **not** on
GitHub Pages: `sync.bat` does not deploy it, and it isn't published on the website.

| Path | What it is |
|---|---|
| `src/` | The code. `index.ts` routes each address; `routes/lead.ts` is the form; the other files are listed in `docs/CODE-MAP.md` section 4 |
| `test/units.test.ts` | Tests (`npm test`) |
| `wrangler.toml` | Cloudflare settings: storage, schedule, which websites may send forms |
| `package.json`, `package-lock.json`, `tsconfig.json` | Program settings and the list of add-ons it needs |
| `node_modules/` | Downloaded add-ons (on this computer only, not on GitHub) |

**Deploy:** open a terminal in this folder, then `npx wrangler whoami` (must show
glenn@magnumcpa.com), `npm test`, `npx wrangler deploy`.
First-time setup: `docs/SETUP-CLOUDFLARE.md`.
