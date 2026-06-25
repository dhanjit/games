# Saptaloka

**▶ Play: [games.dhanjit.me](https://games.dhanjit.me)** — works on phone or
desktop; on iOS, Share → *Add to Home Screen* to install it as an app.

A mythology rogue-like for the phone. Swipe through the seven lokas, survive
encounters with gods and asuras, ascend toward mokṣa.

Inspired in concept by Hades (rogue-like + meta-progression), with thumb-only
controls inspired by Reigns. Built as a pure mobile-web app — no install
required, but it can be added to the iPhone Home Screen as a PWA.

## How to play

1. Open [games.dhanjit.me](https://games.dhanjit.me) (or any served copy — see
   *Local development*) and tap **Begin Ascent**.
2. Each card is an encounter. **Swipe left** for the left choice, **right** for
   the right choice. On desktop, click-and-drag the card.
3. You have four virtues: **Prāṇa** (life), **Tejas** (radiance), **Karma**
   (deeds), **Bhakti** (devotion). Keep all four between 0 and 100.
4. Each realm has a final **boss** card — a major asura or trial. Defeat it to
   advance to the next loka.
5. When you die, you keep the **Puṇya** you earned. Spend it in the **Mirror of
   Maya** for permanent upgrades that carry into future runs.

## Realms (in ascent order)

1. **Bhūloka** — the earthly plane
2. **Bhuvarloka** — the atmospheres
3. **Svarloka** — Indra's heaven
4. **Maharloka** — realm of the great
5. **Janaloka** — realm of the creators
6. **Tapoloka** — realm of austerity
7. **Satyaloka** — realm of truth

## Local development

No build step. Files:

- `index.html` — shell + HUD, title/death/mirror/victory overlays
- `style.css` — mobile-first dark UI, iOS safe-area aware
- `game.js` — engine: swipe gesture, deck, realm flow, meta-progression
- `cards.js` — encounter content (data only)
- `manifest.webmanifest` — PWA install metadata

To run:

```
cd /home/user/games
python3 -m http.server 8080
```

Then visit `http://localhost:8080` on your phone (over the same wifi as your
machine, using your machine's LAN IP). On iOS Safari, tap the share icon →
**Add to Home Screen** for a fullscreen install.

## Hosting

Served from **Cloudflare Pages**, connected to this repo's `main` branch —
every push auto-deploys. It's a pure static site, so the Pages build config is:

- **Framework preset:** None
- **Build command:** *(none)*
- **Build output directory:** `/`

The custom domain `games.dhanjit.me` is attached via the Pages **Custom
domains** tab (the `dhanjit.me` zone is on Cloudflare, so the CNAME and TLS are
provisioned automatically).

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
