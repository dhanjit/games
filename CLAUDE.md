# games — Claude notes (repo root / hub)

This repo hosts **multiple independent games** under one domain
(`games.dhanjit.me`). The root is game-agnostic: a hub plus shared, domain-level
config. **Each game is self-contained in its own top-level folder and carries its
own `CLAUDE.md`** with the game-specific notes.

## Layout

```
index.html              → hub / landing page (games.dhanjit.me); links to each game
saptaloka/              → Saptaloka game (see saptaloka/CLAUDE.md)
runner/                 → Runner game (see runner/CLAUDE.md), if present
.well-known/            → shared domain-level files (see below)
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
  `200` + `application/json`, no redirect (Cloudflare Pages does this fine).

## Hosting

Served from **Cloudflare Pages**, connected to this repo's `main` branch — every
push auto-deploys. Pure static site:

- Framework preset: **None**; Build command: *(none)*; Output directory: `/`.
- Repo root served as-is: hub at `/`, each game under its path (e.g. `/saptaloka/`).
- Custom domain `games.dhanjit.me` via the Pages Custom domains tab.

## Running locally

Relative paths + PWA manifests need an HTTP origin (`file://` is unreliable):

```
cd /c/Users/dhanj/Code/games
python -m http.server 8080
```

Hub at `http://localhost:8080`, a game at `http://localhost:8080/<game>/`.

## Conventions for all games here

- **No build step, no bundler, no `package.json`** — pure static, "open and play".
  Modern-browser ES is fine. Don't introduce a build step unless asked.
- Each game ships its own PWA manifest + icons (PNG, not data-URI SVG, if it
  targets app stores) and its own service worker scoped to its folder.
- Adding a game: drop it in a new top-level folder, give it a `CLAUDE.md`, and add
  a card to the hub `index.html`.
