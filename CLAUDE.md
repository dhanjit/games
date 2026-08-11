# games — Claude notes (repo root / hub)

This repo hosts **multiple independent games** under one domain
(`games.dhanjit.me`). The root is game-agnostic: a hub plus shared, domain-level
config. **Each game is self-contained in its own top-level folder and carries its
own `CLAUDE.md`** with the game-specific notes.

**Read [`DECISIONS.md`](DECISIONS.md) before proposing a stack, a tool, or a
launch plan.** This file covers *how* to work here; that one covers *why* it
works this way and what was deliberately rejected — including why there's no
build step and why a finished game isn't done until it's been put in front of
players. It supersedes generic best-practice advice.

## Layout

```
index.html              → hub / landing page (games.dhanjit.me); links to each game
saptaloka/              → Saptaloka game (see saptaloka/CLAUDE.md)
runner/                 → Runner game (see runner/CLAUDE.md), if present
.well-known/            → shared domain-level files (see below)
DECISIONS.md            → dated, durable decisions + distribution reference
README.md               → player-facing docs
```

Keep everything for a game **inside that game's folder** — code, assets, icons,
PWA manifest/service-worker, and its store/listing artifacts. The root stays
clean: only the hub page, shared domain files, and this doc.

## The one shared exception: `.well-known/`

Browser/OS spec files must be served from the **domain root**, so they can't live
inside a game folder:

- **`.well-known/assetlinks.json`** — Digital Asset Links for Android TWA apps.
  It's a single JSON **array** with **one entry per game-app** (e.g. Saptaloka's
  `me.dhanjit.saptaloka`); future games append their own entry here. Each entry's
  fingerprint must be that app's **Play app-signing** key SHA-256. Must serve
  `200` + `application/json`, no redirect (the static-assets Worker does this fine).

## Hosting

Served from a **Cloudflare static-assets Worker** named `games` (config in
`wrangler.jsonc`). Pure static site, no build step — `assets.directory: "."`
serves the repo root as-is: hub at `/`, each game under its path (e.g.
`/saptaloka/`). `.assetsignore` keeps repo cruft (`.git`, `.github`, `.claude`,
`*.md`, …) out of the upload.

- **Manual deploy** (repo root): `wrangler deploy` — wrangler is OAuth-authed on
  this machine. Use this to push immediately.
- **Auto-deploy on push** requires **Workers Builds** connected in the dashboard:
  Workers & Pages → `games` → Settings → Build → Connect to Git (repo
  `dhanjit/games`, branch `main`, deploy command `wrangler deploy`). Until that's
  connected, pushing to `main` does **not** redeploy — deploy manually.
- Custom domain `games.dhanjit.me` via the Worker's **Domains & Routes** tab (a
  domain attaches to one product only — if an old Pages project still claims it,
  detach there first).
- History: this was originally a Cloudflare **Pages** project; migrated to a
  static-assets Worker (commit `6d59dc8`). Don't reintroduce Pages config
  (`pages_build_output_dir`, a Pages Git integration) — a Worker-style
  `wrangler.jsonc` and a Pages project fighting over the same repo is what broke
  auto-deploy before.

## Running locally

Relative paths + PWA manifests need an HTTP origin (`file://` is unreliable):

```
cd ~/Code/games        # or wherever you cloned it
python -m http.server 8080
```

Hub at `http://localhost:8080`, a game at `http://localhost:8080/<game>/`.

## Conventions for all games here

- **Games are independent — including thematically.** This is a *catalogue* of
  unrelated games (e.g. `runner/` is a neon-cyberpunk race; `saptaloka/` is a
  Vedic-mythology rogue-like). They share no lore, palette, characters, or
  mechanics. When building a new game you may reuse another game's **code
  patterns** (the `<canvas>` + fixed-timestep loop, the PWA/service-worker
  scaffold, the localStorage-meta shape) but **never** its theme — don't carry a
  motif, name, or art style across games. A "Saptaloka X" belongs to the
  Saptaloka universe; an unrelated game gets its own identity.
- **No build step, no bundler, no `package.json`** — pure static, "open and play".
  Modern-browser ES is fine. Don't introduce a build step unless asked.
- Each game ships its own PWA manifest + icons (PNG, not data-URI SVG, if it
  targets app stores) and its own service worker scoped to its folder.
- Adding a game: drop it in a new top-level folder, give it a `CLAUDE.md`, and add
  a card to the hub `index.html`.
