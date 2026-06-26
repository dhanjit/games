# Saptaloka

**▶ Play: [games.dhanjit.me/saptaloka](https://games.dhanjit.me/saptaloka/)** —
works on phone or desktop; on iOS, Share → *Add to Home Screen* to install it as
an app. (The hub at [games.dhanjit.me](https://games.dhanjit.me) lists all games.)

A mythology rogue-like for the phone. Swipe through the seven lokas, survive
encounters with gods and asuras, ascend toward mokṣa.

Inspired in concept by Hades (rogue-like + meta-progression), with thumb-only
controls inspired by Reigns. Built as a pure mobile-web app — no install
required, but it can be added to the iPhone Home Screen as a PWA.

## How to play

1. Open [games.dhanjit.me/saptaloka](https://games.dhanjit.me/saptaloka/) (or any
   served copy — see *Local development*) and tap **Begin Ascent**.
2. Each card is an encounter. **Swipe left** for the left choice, **right** for
   the right choice. On desktop, click-and-drag the card.
3. You have four virtues: **Prāṇa** (life), **Tejas** (radiance), **Karma**
   (deeds), **Bhakti** (devotion). Keep all four between 0 and 100.
4. Each realm has a final **boss** card — a major asura or trial. Defeat it to
   advance to the next loka.
5. When a run ends, you keep the **Puṇya** you earned. Spend it in the **Mirror of
   Maya** for permanent upgrades that carry into future runs.

**The only true win is ascending all seven lokas to Satyaloka — that is mokṣa.**
Beware the *false summits*: maxing **Karma** lifts you to *Svarga* and maxing
**Bhakti** crowns you a *Deva*, but both are heavens still turning inside saṃsāra
— the run ends, yet it isn't liberation. Each way a run can end (five deaths, two
false summits, one mokṣa) has its own ending. The Mirror's **Equanimity** upgrade
is the key to surviving the long climb.

## Realms (in ascent order)

1. **Bhūloka** — the earthly plane
2. **Bhuvarloka** — the atmospheres
3. **Svarloka** — Indra's heaven
4. **Maharloka** — realm of the great
5. **Janaloka** — realm of the creators
6. **Tapoloka** — realm of austerity
7. **Satyaloka** — realm of truth

## Repo layout

This repo hosts multiple games under one domain. Each game lives in its own
folder; the root `index.html` is a hub that links to them.

```
index.html            → hub / landing page (games.dhanjit.me)
saptaloka/            → the Saptaloka game (games.dhanjit.me/saptaloka)
├── index.html          shell + HUD, title / unified end / mirror overlays
├── style.css           mobile-first dark UI, iOS safe-area aware
├── game.js             engine: swipe gesture, deck, realm flow, meta-progression
├── cards.js            encounter content (data only)
└── manifest.webmanifest  PWA install metadata
runner/               → Runner 626, a stick-figure survival race (games.dhanjit.me/runner)
├── index.html          canvas + menu/over/pause overlays + portrait rotate prompt
├── style.css           landscape, web-first, responsive shell
├── game.js             engine: fixed-timestep race sim, rivals/AI, weaving lanes,
│                         the Omicron ray, boosts/hazards/items, procedural neon art
└── manifest.webmanifest  PWA install metadata (landscape)
```

**Runner 626** is a landscape side-scroller: you (yellow) race rival creatures
across 3 weaving lanes while Omicron's disintegration ray devours whoever falls
to the back. Tap = jump (hold higher) / punch a crystal; swipe ↕ = switch lane to
grab boost pads and dodge energy rays. Hit boosts and items (turbo, shield,
shockwave, mines) to grow your lead; stumbles let the ray gain. Inspired by
MayhemStudio's 2007 J2ME game of the same name. Best played on desktop or a phone
held sideways.

To add a game later, drop it in a new top-level folder and add a card to the
hub's `index.html`.

## Local development

No build step. To run:

```
cd /home/user/games
python3 -m http.server 8080
```

Then visit `http://localhost:8080` for the hub, or `http://localhost:8080/saptaloka/`
for the game directly — on your phone use the same wifi and your machine's LAN
IP. On iOS Safari, tap the share icon → **Add to Home Screen** for a fullscreen
install.

## Hosting

Served from a Cloudflare **Worker** (static assets) named `games`, on the custom
domain `games.dhanjit.me`. The repo root is served as-is — the hub at `/` and
each game under its own path (e.g. `/saptaloka/`). Deploy config is in
[`wrangler.jsonc`](wrangler.jsonc); dev/doc files are kept out of the served
bundle by [`.assetsignore`](.assetsignore).

Deploy manually with:

```
wrangler deploy
```

**Auto-deploy on push to `main`:** connect this repo to the `games` Worker once,
in the Cloudflare dashboard → *Workers & Pages → games → Settings → Build →
Connect to Git* (branch `main`). Cloudflare's **Workers Builds** then runs
`wrangler deploy` on every push — no API token or GitHub Action needed
(Cloudflare's GitHub app handles auth). Note: this is a Worker, **not** Pages,
and it does **not** auto-deploy until that one-time connection is made.

## Adding content

Edit `cards.js`. Each card is:

```js
c('my_card_id', {
  realmMin: 1, realmMax: 4,        // optional realm gating (1-7)
  weight: 1,                       // optional draw weight (default 1)
  tag: 'god',                      // optional: 'god', 'boss'
  art: '🔥',                        // an emoji or short glyph
  speaker: 'Agni',
  text: '"Cast something into me."',
  left:  { label: 'A memory', fx: { tejas: +12, bhakti: -6 } },
  right: { label: 'A sin',    fx: { karma: +12, tejas: +4 } },
}),
```

Boss cards use `tag: 'boss'` and `realm: <n>` to bind to a specific realm.
Effects (`fx`) are stat deltas; can also be a function returning an object for
random outcomes. See `randomNagaEffect` for an example.
