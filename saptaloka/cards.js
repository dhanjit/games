// Saptaloka — encounter deck.
// Stats: prana (life), tejas (radiance), karma (deeds), bhakti (devotion).
// Each is 0..100. Run ends if any hits 0 or 100.
// Effects are deltas. Cards may set { realmMin, realmMax } to gate by realm,
// or { tag: 'boss' } to be drawn only at realm boundaries.
// Choices may chain via `next: 'cardId'` to build multi-step encounters.

const REALMS = [
  { name: 'Bhūloka',      subtitle: 'the earthly plane',     length: 5 },
  { name: 'Bhuvarloka',   subtitle: 'the atmospheres',       length: 6 },
  { name: 'Svarloka',     subtitle: "Indra's heaven",        length: 6 },
  { name: 'Maharloka',    subtitle: 'realm of the great',    length: 7 },
  { name: 'Janaloka',     subtitle: 'realm of the creators', length: 7 },
  { name: 'Tapoloka',     subtitle: 'realm of austerity',    length: 8 },
  { name: 'Satyaloka',    subtitle: 'realm of truth',        length: 8 },
];

// Realm-entry cutscene copy, parallel to REALMS by index: the Devanagari name +
// a one-line narration shown when entering each realm. For realms 2-7 the line
// looks back at the boss just defeated. Keep this file UTF-8.
const CUTSCENES = [
  { deva: 'भूलोक',    narration: 'Dust and prayer underfoot, a mortal road ahead — the long climb to truth begins here.' },
  { deva: 'भुवर्लोक',  narration: 'The buffalo-demon falls behind you; now the storm-air opens its mouth, and yakshas wheel in the in-between sky.' },
  { deva: 'स्वर्लोक',  narration: "You drowned the drought-serpent below; rivers run free, and heaven's bright gates blaze ahead." },
  { deva: 'महर्लोक',  narration: 'The dharmic king is passed; above the gods now wait the silent, burning sages.' },
  { deva: 'जनलोक',    narration: 'The deathless tyrant is undone; ascend to where mind-born beings shape the worlds.' },
  { deva: 'तपोलोक',   narration: 'Tārakāsura is broken; enter the fierce silence where the ascetics burn with tapas.' },
  { deva: 'सत्यलोक',  narration: "The ten-headed king has fallen; before you waits Brahmā's abode — the last threshold of mokṣa." },
];

// Run endings, keyed by the key checkEnd() returns. Five deaths, two non-win
// "false summits" (karma/bhakti maxed — a heaven, not liberation), one true win.
// `svg` is a self-contained inline vignette (hand-built, no external refs).
const ENDINGS = {
  death_prana: { kind: "death", title: "The Wheel Turns", deva: "संसार",
    narration: "Your last breath unwinds from the body, and the great wheel of saṃsāra draws the spark back to its hub — to be spun out into another womb. Not release: only one more turn.",
    svg: "<svg viewBox=\"0 0 240 240\" xmlns=\"http://www.w3.org/2000/svg\"><defs><radialGradient id=\"wbg\" cx=\"50%\" cy=\"50%\" r=\"65%\"><stop offset=\"0%\" stop-color=\"#160a25\"/><stop offset=\"100%\" stop-color=\"#0b0613\"/></radialGradient><radialGradient id=\"hub\" cx=\"50%\" cy=\"50%\" r=\"60%\"><stop offset=\"0%\" stop-color=\"#ff6c8a\" stop-opacity=\"0.55\"/><stop offset=\"45%\" stop-color=\"#c2384a\" stop-opacity=\"0.35\"/><stop offset=\"100%\" stop-color=\"#c08a2c\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"rim\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0%\" stop-color=\"#f5c97a\"/><stop offset=\"100%\" stop-color=\"#c08a2c\"/></linearGradient></defs><rect width=\"240\" height=\"240\" fill=\"url(#wbg)\"/><g transform=\"translate(120 120)\"><circle r=\"96\" fill=\"none\" stroke=\"#c08a2c\" stroke-width=\"1\" opacity=\"0.35\"/><circle r=\"88\" fill=\"none\" stroke=\"url(#rim)\" stroke-width=\"6\" opacity=\"0.9\"/><circle r=\"78\" fill=\"none\" stroke=\"#c08a2c\" stroke-width=\"2\" opacity=\"0.5\"/><g stroke=\"url(#rim)\" stroke-width=\"3.5\" opacity=\"0.8\"><line x1=\"0\" y1=\"-82\" x2=\"0\" y2=\"82\"/><line x1=\"-82\" y1=\"0\" x2=\"82\" y2=\"0\"/><line x1=\"-58\" y1=\"-58\" x2=\"58\" y2=\"58\"/><line x1=\"58\" y1=\"-58\" x2=\"-58\" y2=\"58\"/></g><g stroke=\"#c08a2c\" stroke-width=\"2\" opacity=\"0.5\"><line x1=\"-31\" y1=\"-76\" x2=\"31\" y2=\"76\"/><line x1=\"31\" y1=\"-76\" x2=\"-31\" y2=\"76\"/><line x1=\"-76\" y1=\"-31\" x2=\"76\" y2=\"31\"/><line x1=\"76\" y1=\"-31\" x2=\"-76\" y2=\"31\"/></g><circle r=\"60\" fill=\"url(#hub)\"/><circle r=\"22\" fill=\"#160a25\" stroke=\"url(#rim)\" stroke-width=\"3\"/><path d=\"M34 -2 C18 -7 8 -5 2 0 C8 5 18 7 34 2 C28 0 28 0 34 -2 Z\" fill=\"#ff6c8a\" opacity=\"0.85\"/><circle cx=\"3\" cy=\"0\" r=\"5\" fill=\"#ff6c8a\"/><circle cx=\"3\" cy=\"0\" r=\"10\" fill=\"#ff6c8a\" opacity=\"0.3\"/><circle cx=\"46\" cy=\"-3\" r=\"2\" fill=\"#ff6c8a\" opacity=\"0.5\"/><circle cx=\"58\" cy=\"-5\" r=\"1.5\" fill=\"#ff6c8a\" opacity=\"0.3\"/></g></svg>" },
  death_tejas_low: { kind: "death", title: "Into Shadow", deva: "तमस्",
    narration: "The inner fire gutters, sinks, and goes out. With no light left to hold your shape, you sink into tamas — scattered grain by grain into the dark that was always waiting beneath.",
    svg: "<svg viewBox=\"0 0 240 240\" xmlns=\"http://www.w3.org/2000/svg\"><defs><radialGradient id=\"dark\" cx=\"50%\" cy=\"58%\" r=\"70%\"><stop offset=\"0%\" stop-color=\"#2a103f\"/><stop offset=\"55%\" stop-color=\"#160a25\"/><stop offset=\"100%\" stop-color=\"#0b0613\"/></radialGradient><radialGradient id=\"ember\" cx=\"50%\" cy=\"50%\" r=\"50%\"><stop offset=\"0%\" stop-color=\"#ffc857\"/><stop offset=\"40%\" stop-color=\"#f5c97a\" stop-opacity=\"0.7\"/><stop offset=\"100%\" stop-color=\"#c08a2c\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"sil\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0%\" stop-color=\"#6f4cd2\" stop-opacity=\"0.55\"/><stop offset=\"100%\" stop-color=\"#160a25\" stop-opacity=\"0\"/></linearGradient></defs><rect width=\"240\" height=\"240\" fill=\"url(#dark)\"/><g opacity=\"0.9\"><path d=\"M120 232 C104 200 104 178 110 158 C113 148 110 140 116 132 C122 124 120 116 122 110 C126 120 124 130 130 140 C136 150 132 168 134 184 C135 204 132 218 120 232 Z\" fill=\"url(#sil)\"/></g><g fill=\"#6f4cd2\"><circle cx=\"96\" cy=\"118\" r=\"2.5\" opacity=\"0.55\"/><circle cx=\"86\" cy=\"100\" r=\"2\" opacity=\"0.45\"/><circle cx=\"150\" cy=\"122\" r=\"2.5\" opacity=\"0.5\"/><circle cx=\"160\" cy=\"104\" r=\"1.8\" opacity=\"0.4\"/><circle cx=\"104\" cy=\"86\" r=\"1.5\" opacity=\"0.35\"/><circle cx=\"140\" cy=\"90\" r=\"1.5\" opacity=\"0.3\"/><circle cx=\"78\" cy=\"130\" r=\"1.5\" opacity=\"0.3\"/><circle cx=\"168\" cy=\"132\" r=\"1.5\" opacity=\"0.3\"/></g><g><circle cx=\"120\" cy=\"126\" r=\"34\" fill=\"url(#ember)\" opacity=\"0.5\"/><path d=\"M120 142 C112 136 110 126 116 116 C117 124 121 124 122 118 C124 110 121 104 124 98 C130 106 132 116 130 126 C129 136 127 140 120 142 Z\" fill=\"#ffc857\" opacity=\"0.85\"/><path d=\"M120 140 C116 136 116 130 119 124 C120 129 122 129 122 125 C123 120 121 117 123 113 C127 119 128 126 126 132 C125 137 124 139 120 140 Z\" fill=\"#f6ecd2\"/><circle cx=\"120\" cy=\"130\" r=\"2.2\" fill=\"#f6ecd2\"/></g><g fill=\"#ffc857\"><circle cx=\"120\" cy=\"104\" r=\"1.6\" opacity=\"0.7\"/><circle cx=\"127\" cy=\"96\" r=\"1.2\" opacity=\"0.45\"/><circle cx=\"114\" cy=\"92\" r=\"1\" opacity=\"0.35\"/><circle cx=\"123\" cy=\"84\" r=\"0.9\" opacity=\"0.25\"/></g></svg>" },
  death_tejas_burn: { kind: "death", title: "Burnout", deva: "दाह",
    narration: "You stoked the tapas past all bearing, and the inner fire turned on its keeper. The flame raised to light the climb has made ash of the one who carried it.",
    svg: "<svg viewBox=\"0 0 240 240\" xmlns=\"http://www.w3.org/2000/svg\"><defs><radialGradient id=\"bg\" cx=\"50%\" cy=\"42%\" r=\"62%\"><stop offset=\"0%\" stop-color=\"#2a103f\"/><stop offset=\"60%\" stop-color=\"#160a25\"/><stop offset=\"100%\" stop-color=\"#0b0613\"/></radialGradient><radialGradient id=\"core\" cx=\"50%\" cy=\"55%\" r=\"55%\"><stop offset=\"0%\" stop-color=\"#ffc857\"/><stop offset=\"45%\" stop-color=\"#f5c97a\"/><stop offset=\"80%\" stop-color=\"#c2384a\"/><stop offset=\"100%\" stop-color=\"#ff5566\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"fl\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0%\" stop-color=\"#c2384a\"/><stop offset=\"50%\" stop-color=\"#ff5566\"/><stop offset=\"100%\" stop-color=\"#ffc857\"/></linearGradient></defs><rect width=\"240\" height=\"240\" fill=\"url(#bg)\"/><ellipse cx=\"120\" cy=\"150\" rx=\"86\" ry=\"92\" fill=\"url(#core)\" opacity=\"0.55\"/><path d=\"M120 36 C150 78 168 104 158 144 C152 170 134 184 120 196 C106 184 88 170 82 144 C72 104 90 78 120 36 Z\" fill=\"url(#fl)\" opacity=\"0.92\"/><path d=\"M120 70 C138 100 148 120 140 148 C135 166 128 176 120 188 C112 176 105 166 100 148 C92 120 102 100 120 70 Z\" fill=\"#ffc857\" opacity=\"0.85\"/><path d=\"M120 110 C129 128 132 142 128 158 C125 170 120 178 120 184 C120 178 115 170 112 158 C108 142 111 128 120 110 Z\" fill=\"#f6ecd2\" opacity=\"0.9\"/><path d=\"M104 150 C100 168 108 180 120 196 C108 200 96 196 90 184 C84 172 90 158 104 150 Z\" fill=\"#160a25\" opacity=\"0.7\"/><path d=\"M136 150 C140 168 132 180 120 196 C132 200 144 196 150 184 C156 172 150 158 136 150 Z\" fill=\"#160a25\" opacity=\"0.55\"/><g fill=\"#b9a98a\"><circle cx=\"72\" cy=\"82\" r=\"2.4\" opacity=\"0.8\"/><circle cx=\"168\" cy=\"96\" r=\"2\" opacity=\"0.7\"/><circle cx=\"58\" cy=\"128\" r=\"1.8\" opacity=\"0.6\"/><circle cx=\"182\" cy=\"140\" r=\"2.2\" opacity=\"0.65\"/><circle cx=\"90\" cy=\"58\" r=\"1.6\" opacity=\"0.55\"/><circle cx=\"150\" cy=\"66\" r=\"1.5\" opacity=\"0.5\"/></g><g fill=\"#ffc857\"><circle cx=\"100\" cy=\"50\" r=\"1.8\" opacity=\"0.9\"/><circle cx=\"140\" cy=\"44\" r=\"1.5\" opacity=\"0.8\"/><circle cx=\"120\" cy=\"30\" r=\"2\" opacity=\"0.85\"/><circle cx=\"160\" cy=\"118\" r=\"1.4\" opacity=\"0.7\"/></g></svg>" },
  death_karma: { kind: "death", title: "Naraka", deva: "नरक",
    narration: "The ledger of your deeds tips to black, and Yama's noose finds your throat. His buffalo bears you down past the cold tally of your sins, into the fires of Naraka.",
    svg: "<svg viewBox=\"0 0 240 240\" xmlns=\"http://www.w3.org/2000/svg\"><defs><linearGradient id=\"hb\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0%\" stop-color=\"#160a25\"/><stop offset=\"100%\" stop-color=\"#0b0613\"/></linearGradient><radialGradient id=\"pit\" cx=\"50%\" cy=\"100%\" r=\"75%\"><stop offset=\"0%\" stop-color=\"#ff5566\"/><stop offset=\"35%\" stop-color=\"#c2384a\"/><stop offset=\"75%\" stop-color=\"#2a103f\"/><stop offset=\"100%\" stop-color=\"#0b0613\"/></radialGradient></defs><rect width=\"240\" height=\"240\" fill=\"url(#hb)\"/><path d=\"M0 132 C60 110 180 110 240 132 L240 240 L0 240 Z\" fill=\"url(#pit)\" opacity=\"0.95\"/><path d=\"M40 240 C70 188 96 168 120 152 C144 168 170 188 200 240 Z\" fill=\"#0b0613\" opacity=\"0.55\"/><g fill=\"#ffc857\" opacity=\"0.85\"><path d=\"M96 240 C100 214 108 202 104 184 C116 198 116 216 112 240 Z\"/><path d=\"M132 240 C128 210 138 196 134 178 C146 196 146 218 144 240 Z\"/><path d=\"M114 240 C112 200 124 186 120 164 C130 188 128 214 130 240 Z\" fill=\"#ff5566\"/></g><path d=\"M60 38 C72 18 92 12 100 30 C104 40 100 50 92 56 C108 58 118 50 120 50 C122 50 132 58 148 56 C140 50 136 40 140 30 C148 12 168 18 180 38 C168 36 158 44 156 58 C168 64 174 78 168 90 C160 78 144 72 120 72 C96 72 80 78 72 90 C66 78 72 64 84 58 C82 44 72 36 60 38 Z\" fill=\"#2a103f\" stroke=\"#c08a2c\" stroke-width=\"1.2\" stroke-opacity=\"0.55\"/><ellipse cx=\"120\" cy=\"92\" rx=\"22\" ry=\"14\" fill=\"#160a25\"/><circle cx=\"112\" cy=\"90\" r=\"3\" fill=\"#ff5566\"/><circle cx=\"128\" cy=\"90\" r=\"3\" fill=\"#ff5566\"/><line x1=\"30\" y1=\"118\" x2=\"210\" y2=\"118\" stroke=\"#6fb5ff\" stroke-width=\"1\" opacity=\"0.7\"/><g stroke=\"#6fb5ff\" stroke-width=\"0.8\" opacity=\"0.45\"><line x1=\"56\" y1=\"118\" x2=\"56\" y2=\"126\"/><line x1=\"184\" y1=\"118\" x2=\"184\" y2=\"126\"/></g><path d=\"M120 96 C124 108 122 116 120 122\" stroke=\"#b9a98a\" stroke-width=\"1.4\" fill=\"none\" opacity=\"0.8\"/><ellipse cx=\"120\" cy=\"122\" rx=\"6.5\" ry=\"3\" fill=\"none\" stroke=\"#b9a98a\" stroke-width=\"1.4\" opacity=\"0.85\"/><path d=\"M120 124 C124 138 122 150 120 162 C118 150 116 138 120 124 Z\" fill=\"#f6ecd2\" opacity=\"0.55\"/><circle cx=\"120\" cy=\"132\" r=\"5\" fill=\"#f6ecd2\" opacity=\"0.5\"/><circle cx=\"120\" cy=\"132\" r=\"9\" fill=\"#f6ecd2\" opacity=\"0.18\"/></svg>" },
  death_bhakti: { kind: "death", title: "Forgotten", deva: "विस्मृति",
    narration: "No tongue chants your name. The lamps gutter out, the garland greys to cobweb, and the shrine forgets the one it once crowned. Unremembered, you dissolve into the dark.",
    svg: "<svg viewBox=\"0 0 240 240\" xmlns=\"http://www.w3.org/2000/svg\"><defs><radialGradient id=\"fg\" cx=\"50%\" cy=\"42%\" r=\"62%\"><stop offset=\"0%\" stop-color=\"#9b7bff\" stop-opacity=\"0.2\"/><stop offset=\"55%\" stop-color=\"#2a103f\" stop-opacity=\"0.5\"/><stop offset=\"100%\" stop-color=\"#0b0613\"/></radialGradient><linearGradient id=\"idol\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0%\" stop-color=\"#9b7bff\" stop-opacity=\"0.5\"/><stop offset=\"60%\" stop-color=\"#6f4cd2\" stop-opacity=\"0.26\"/><stop offset=\"100%\" stop-color=\"#b9a98a\" stop-opacity=\"0.1\"/></linearGradient></defs><rect width=\"240\" height=\"240\" fill=\"#0b0613\"/><rect width=\"240\" height=\"240\" fill=\"url(#fg)\"/><path d=\"M70 196 L70 96 Q70 64 120 50 Q170 64 170 96 L170 196 Z\" fill=\"#160a25\" stroke=\"#2a103f\" stroke-width=\"1.5\"/><path d=\"M70 96 Q70 64 120 50 Q170 64 170 96 Z\" fill=\"#2a103f\" opacity=\"0.6\"/><rect x=\"58\" y=\"196\" width=\"124\" height=\"10\" fill=\"#160a25\" stroke=\"#2a103f\" stroke-width=\"1\"/><path d=\"M120 84 Q104 96 104 122 Q104 156 120 178 Q136 156 136 122 Q136 96 120 84 Z\" fill=\"url(#idol)\" stroke=\"#9b7bff\" stroke-width=\"0.8\" stroke-opacity=\"0.3\"/><ellipse cx=\"120\" cy=\"116\" rx=\"11\" ry=\"13\" fill=\"#b9a98a\" opacity=\"0.14\"/><circle cx=\"120\" cy=\"114\" r=\"3\" fill=\"#9b7bff\" opacity=\"0.28\"/><path d=\"M86 92 Q120 78 154 92\" fill=\"none\" stroke=\"#6f4cd2\" stroke-width=\"2\" stroke-opacity=\"0.3\" stroke-dasharray=\"1 7\"/><circle cx=\"96\" cy=\"90\" r=\"2.5\" fill=\"#9b7bff\" opacity=\"0.2\"/><circle cx=\"112\" cy=\"84\" r=\"2.5\" fill=\"#b9a98a\" opacity=\"0.16\"/><circle cx=\"128\" cy=\"84\" r=\"2.5\" fill=\"#9b7bff\" opacity=\"0.18\"/><circle cx=\"144\" cy=\"90\" r=\"2.5\" fill=\"#b9a98a\" opacity=\"0.14\"/><g stroke=\"#b9a98a\" stroke-width=\"0.4\" stroke-opacity=\"0.2\" fill=\"none\"><path d=\"M70 96 L92 118 M70 96 L84 132 M92 118 L84 132\"/></g><path d=\"M62 160 L62 150 Q62 144 70 144 Q78 144 78 150 L78 160 Z\" fill=\"#2a103f\" stroke=\"#c08a2c\" stroke-width=\"0.6\" stroke-opacity=\"0.4\"/><path d=\"M162 160 L162 150 Q162 144 170 144 Q178 144 178 150 L178 160 Z\" fill=\"#2a103f\" stroke=\"#c08a2c\" stroke-width=\"0.6\" stroke-opacity=\"0.4\"/><rect x=\"0\" y=\"156\" width=\"240\" height=\"84\" fill=\"#0b0613\" opacity=\"0.4\"/></svg>" },
  false_karma: { kind: "falsesummit", title: "Svarga", deva: "स्वर्ग",
    narration: "Your merit ripens and the gates of Svarga open in light. But this heaven still turns inside saṃsāra — the wheel wheels behind your halo, and when the puṇya is spent you will fall once more. Not mokṣa.",
    svg: "<svg viewBox=\"0 0 240 240\" xmlns=\"http://www.w3.org/2000/svg\"><defs><radialGradient id=\"heaven\" cx=\"50%\" cy=\"34%\" r=\"72%\"><stop offset=\"0%\" stop-color=\"#f5c97a\" stop-opacity=\"0.85\"/><stop offset=\"38%\" stop-color=\"#c08a2c\" stop-opacity=\"0.38\"/><stop offset=\"72%\" stop-color=\"#6fb5ff\" stop-opacity=\"0.16\"/><stop offset=\"100%\" stop-color=\"#0b0613\"/></radialGradient><linearGradient id=\"gate\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0%\" stop-color=\"#f5c97a\"/><stop offset=\"100%\" stop-color=\"#c08a2c\"/></linearGradient></defs><rect width=\"240\" height=\"240\" fill=\"#0b0613\"/><rect width=\"240\" height=\"240\" fill=\"url(#heaven)\"/><g opacity=\"0.16\" stroke=\"#6fb5ff\" stroke-width=\"1.4\" fill=\"none\"><circle cx=\"120\" cy=\"92\" r=\"68\"/><circle cx=\"120\" cy=\"92\" r=\"50\"/><line x1=\"120\" y1=\"24\" x2=\"120\" y2=\"160\"/><line x1=\"52\" y1=\"92\" x2=\"188\" y2=\"92\"/><line x1=\"72\" y1=\"44\" x2=\"168\" y2=\"140\"/></g><g opacity=\"0.6\"><ellipse cx=\"58\" cy=\"150\" rx=\"32\" ry=\"10\" fill=\"#f5c97a\" opacity=\"0.15\"/><ellipse cx=\"184\" cy=\"150\" rx=\"32\" ry=\"10\" fill=\"#f5c97a\" opacity=\"0.15\"/></g><circle cx=\"120\" cy=\"80\" r=\"58\" fill=\"url(#heaven)\" opacity=\"0.5\"/><circle cx=\"120\" cy=\"80\" r=\"40\" fill=\"none\" stroke=\"#f5c97a\" stroke-width=\"2\" opacity=\"0.8\"/><path d=\"M92 158 L92 78 Q92 56 110 50 L110 158 Z\" fill=\"url(#gate)\" opacity=\"0.92\"/><path d=\"M148 158 L148 78 Q148 56 130 50 L130 158 Z\" fill=\"url(#gate)\" opacity=\"0.92\"/><path d=\"M92 78 Q92 56 110 50\" fill=\"none\" stroke=\"#f6ecd2\" stroke-width=\"1\" stroke-opacity=\"0.6\"/><path d=\"M148 78 Q148 56 130 50\" fill=\"none\" stroke=\"#f6ecd2\" stroke-width=\"1\" stroke-opacity=\"0.6\"/><circle cx=\"120\" cy=\"78\" r=\"9\" fill=\"#160a25\" stroke=\"#f5c97a\" stroke-width=\"1.4\"/><path d=\"M120 73 v10 M115 78 h10\" stroke=\"#f5c97a\" stroke-width=\"1.1\" opacity=\"0.8\"/><g fill=\"#f6ecd2\"><circle cx=\"120\" cy=\"36\" r=\"2.2\" opacity=\"0.9\"/></g><g stroke=\"#b9a98a\" stroke-width=\"2\" fill=\"none\" opacity=\"0.65\"><circle cx=\"120\" cy=\"216\" r=\"4\"/><circle cx=\"127\" cy=\"221\" r=\"4\"/><circle cx=\"120\" cy=\"226\" r=\"4\"/></g><path d=\"M120 158 q2 30 0 54\" stroke=\"#b9a98a\" stroke-width=\"1.5\" fill=\"none\" opacity=\"0.45\"/><rect x=\"0\" y=\"196\" width=\"240\" height=\"44\" fill=\"#0b0613\" opacity=\"0.4\"/></svg>" },
  false_bhakti: { kind: "falsesummit", title: "Deva", deva: "देव",
    narration: "Devotion crowns you a god — temples bear your face, the lamps never dim. But the worshipped idol cannot leave: the saṃsāra-wheel turns behind your halo, and their love is the chain that keeps you bound. Not mokṣa.",
    svg: "<svg viewBox=\"0 0 240 240\" xmlns=\"http://www.w3.org/2000/svg\"><defs><radialGradient id=\"db\" cx=\"50%\" cy=\"36%\" r=\"64%\"><stop offset=\"0%\" stop-color=\"#2a103f\"/><stop offset=\"100%\" stop-color=\"#0b0613\"/></radialGradient><radialGradient id=\"dh\" cx=\"50%\" cy=\"50%\" r=\"50%\"><stop offset=\"0%\" stop-color=\"#f5c97a\" stop-opacity=\"0.9\"/><stop offset=\"55%\" stop-color=\"#9b7bff\" stop-opacity=\"0.4\"/><stop offset=\"100%\" stop-color=\"#9b7bff\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"di\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0%\" stop-color=\"#9b7bff\"/><stop offset=\"100%\" stop-color=\"#6f4cd2\"/></linearGradient></defs><rect width=\"240\" height=\"240\" fill=\"url(#db)\"/><g opacity=\"0.16\" stroke=\"#b9a98a\" stroke-width=\"1.4\" fill=\"none\"><circle cx=\"120\" cy=\"92\" r=\"68\"/><circle cx=\"120\" cy=\"92\" r=\"50\"/><line x1=\"120\" y1=\"24\" x2=\"120\" y2=\"160\"/><line x1=\"52\" y1=\"92\" x2=\"188\" y2=\"92\"/><line x1=\"72\" y1=\"44\" x2=\"168\" y2=\"140\"/></g><circle cx=\"120\" cy=\"80\" r=\"62\" fill=\"url(#dh)\"/><circle cx=\"120\" cy=\"80\" r=\"40\" fill=\"none\" stroke=\"#f5c97a\" stroke-width=\"2\" opacity=\"0.85\"/><polygon points=\"120,146 148,162 148,200 92,200 92,162\" fill=\"#2a103f\" stroke=\"#c08a2c\" stroke-width=\"1.4\"/><path d=\"M120 54 C109 60 105 73 105 86 C105 105 111 118 120 126 C129 118 135 105 135 86 C135 73 131 60 120 54 Z\" fill=\"url(#di)\" stroke=\"#9b7bff\" stroke-width=\"1\"/><circle cx=\"120\" cy=\"80\" r=\"9\" fill=\"#160a25\" stroke=\"#f5c97a\" stroke-width=\"1.4\"/><path d=\"M120 75 v10 M115 80 h10\" stroke=\"#f5c97a\" stroke-width=\"1.1\" opacity=\"0.8\"/><g fill=\"#e57aa7\"><circle cx=\"100\" cy=\"170\" r=\"3.5\"/><circle cx=\"120\" cy=\"174\" r=\"3.5\" opacity=\"0.85\"/><circle cx=\"140\" cy=\"170\" r=\"3.5\"/></g><ellipse cx=\"78\" cy=\"190\" rx=\"6\" ry=\"4\" fill=\"#c08a2c\"/><path d=\"M78 186 q-3 -9 0 -14 q3 5 0 14\" fill=\"#f5c97a\"/><ellipse cx=\"162\" cy=\"190\" rx=\"6\" ry=\"4\" fill=\"#c08a2c\"/><path d=\"M162 186 q-3 -9 0 -14 q3 5 0 14\" fill=\"#f5c97a\"/><g stroke=\"#b9a98a\" stroke-width=\"2\" fill=\"none\" opacity=\"0.65\"><circle cx=\"120\" cy=\"216\" r=\"4\"/><circle cx=\"127\" cy=\"221\" r=\"4\"/><circle cx=\"120\" cy=\"232\" r=\"4\"/></g><path d=\"M120 200 q2 8 0 12\" stroke=\"#b9a98a\" stroke-width=\"1.5\" fill=\"none\" opacity=\"0.45\"/></svg>" },
  win_moksha: { kind: "win", title: "Mokṣa", deva: "मोक्ष",
    narration: "Atop Satyaloka the wheel of saṃsāra cracks and scatters into motes. The thousand-petalled lotus opens, and your spark rises free — birth and death undone, the climb complete.",
    svg: "<svg viewBox=\"0 0 240 240\" xmlns=\"http://www.w3.org/2000/svg\"><defs><radialGradient id=\"mb\" cx=\"50%\" cy=\"50%\" r=\"62%\"><stop offset=\"0%\" stop-color=\"#f6ecd2\"/><stop offset=\"28%\" stop-color=\"#f5c97a\" stop-opacity=\"0.8\"/><stop offset=\"60%\" stop-color=\"#2a103f\" stop-opacity=\"0.85\"/><stop offset=\"100%\" stop-color=\"#0b0613\"/></radialGradient><radialGradient id=\"mc\" cx=\"50%\" cy=\"50%\" r=\"50%\"><stop offset=\"0%\" stop-color=\"#f6ecd2\"/><stop offset=\"45%\" stop-color=\"#f5c97a\"/><stop offset=\"100%\" stop-color=\"#c08a2c\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"mp\" x1=\"0\" y1=\"1\" x2=\"0\" y2=\"0\"><stop offset=\"0%\" stop-color=\"#c08a2c\"/><stop offset=\"100%\" stop-color=\"#f6ecd2\"/></linearGradient></defs><rect width=\"240\" height=\"240\" fill=\"url(#mb)\"/><g stroke=\"#6fb5ff\" stroke-width=\"1.6\" fill=\"none\" opacity=\"0.3\" stroke-linecap=\"round\"><path d=\"M44 96 A82 82 0 0 1 96 42\"/><path d=\"M198 110 A82 82 0 0 1 160 188\"/></g><g opacity=\"0.4\"><circle cx=\"40\" cy=\"150\" r=\"2\" fill=\"#6fb5ff\"/><circle cx=\"206\" cy=\"64\" r=\"2.2\" fill=\"#9b7bff\"/><circle cx=\"50\" cy=\"188\" r=\"2\" fill=\"#4dbf8b\"/><circle cx=\"196\" cy=\"184\" r=\"2\" fill=\"#e57aa7\"/></g><circle cx=\"120\" cy=\"124\" r=\"66\" fill=\"url(#mc)\"/><g fill=\"url(#mp)\" stroke=\"#c08a2c\" stroke-width=\"0.6\" opacity=\"0.85\"><path d=\"M120 128 C92 150 80 138 84 116 C100 122 112 124 120 128 Z\"/><path d=\"M120 128 C148 150 160 138 156 116 C140 122 128 124 120 128 Z\"/></g><g fill=\"#f6ecd2\" stroke=\"#f5c97a\" stroke-width=\"0.8\"><path d=\"M120 128 C108 96 112 78 120 64 C128 78 132 96 120 128 Z\"/><path d=\"M120 128 C96 104 90 86 92 70 C110 80 118 100 120 128 Z\"/><path d=\"M120 128 C144 104 150 86 148 70 C130 80 122 100 120 128 Z\"/><path d=\"M120 128 C82 118 70 104 66 88 C90 92 110 108 120 128 Z\" opacity=\"0.8\"/><path d=\"M120 128 C158 118 170 104 174 88 C150 92 130 108 120 128 Z\" opacity=\"0.8\"/></g><circle cx=\"120\" cy=\"110\" r=\"9\" fill=\"#f6ecd2\"/><circle cx=\"120\" cy=\"110\" r=\"17\" fill=\"#f6ecd2\" opacity=\"0.3\"/><line x1=\"120\" y1=\"110\" x2=\"120\" y2=\"34\" stroke=\"#f6ecd2\" stroke-width=\"1.6\" opacity=\"0.9\"/><circle cx=\"120\" cy=\"36\" r=\"5\" fill=\"#f6ecd2\"/><circle cx=\"120\" cy=\"36\" r=\"12\" fill=\"#f6ecd2\" opacity=\"0.28\"/></svg>" },
};

// Helper to keep card definitions terse.
function c(id, def) { return Object.assign({ id }, def); }

const CARDS = [

  // ---------- Bhūloka (1) - mortal realm, gentle introduction ----------

  c('beggar_1', {
    realmMin: 1, realmMax: 2, weight: 2,
    art: '🪔', speaker: 'A blind beggar',
    text: 'A frail man kneels at your feet. "A coin, a kind word, anything for a soul about to ascend."',
    left:  { label: 'Walk past',     fx: { tejas: +2, karma: -8, bhakti: -4 } },
    right: { label: 'Empty your alms', fx: { tejas: -6, karma: +5, bhakti: +5 } },
  }),

  c('village_widow', {
    realmMin: 1, realmMax: 2, weight: 1,
    art: '🕯', speaker: 'A village widow',
    text: '"My husband\'s pyre still smokes. Stay one night, recite the names of the dead."',
    left:  { label: 'Press onward',   fx: { tejas: +4, karma: -5, prana: +3 } },
    right: { label: 'Sit and chant',  fx: { tejas: -4, karma: +4, bhakti: +4, prana: -3 } },
  }),

  c('merchant_caravan', {
    realmMin: 1, realmMax: 3, weight: 1,
    art: '🐪', speaker: 'A jeweled merchant',
    text: '"Bandits stalk the pass. Guard my caravan to Mathura — I pay in gold, or in mantras, your choice."',
    left:  { label: 'Take the gold',  fx: { tejas: +6, karma: -4, bhakti: -2 } },
    right: { label: 'Take the mantras', fx: { tejas: -2, karma: +2, bhakti: +6 } },
  }),

  c('river_crossing', {
    realmMin: 1, realmMax: 3, weight: 1,
    art: '🌊', speaker: 'The Ganga',
    text: 'The river-mother whispers from the foam. "Drink, and remember a former life. Or pass dry-mouthed."',
    left:  { label: 'Drink deeply',   fx: { prana: -5, bhakti: +8, tejas: +2 } },
    right: { label: 'Cross dry-shod', fx: { prana: +4, bhakti: -3 } },
  }),

  c('forest_tiger', {
    realmMin: 1, realmMax: 3, weight: 1,
    art: '🐯', speaker: 'A tiger in the path',
    text: 'Yellow eyes, no growl. The beast simply waits.',
    left:  { label: 'Bare your blade', fx: { prana: -9, tejas: +5, karma: -3 } },
    right: { label: 'Bow and pass',    fx: { prana: -2, bhakti: +5, karma: +2 } },
  }),

  c('child_pleading', {
    realmMin: 1, realmMax: 2, weight: 1,
    art: '🧒', speaker: 'A village child',
    text: '"A demon took my mother into the well. Please. Climb down with me."',
    left:  { label: 'Descend the well', fx: { prana: -9, karma: +6, bhakti: +3 } },
    right: { label: 'Tell her to flee', fx: { prana: +4, karma: -8, tejas: +1 } },
  }),

  // ---------- Bhuvarloka (2) - storms, yakshas, in-between beings ----------

  c('yaksha_riddle', {
    realmMin: 2, realmMax: 4, weight: 2,
    art: '🌀', speaker: 'A yaksha by a pond',
    text: '"What is heavier than the earth, swifter than wind, more numerous than blades of grass?"',
    left:  { label: '"A mother\'s love."', fx: { karma: +5, bhakti: +5, tejas: -2 } },
    right: { label: '"I have no time for games."', fx: { prana: -10, tejas: +4 } },
  }),

  c('gandharva_song', {
    realmMin: 2, realmMax: 4, weight: 1,
    art: '🎶', speaker: 'A gandharva of the clouds',
    text: 'Music wraps your bones. "Sing with us forever, and never feel grief again."',
    left:  { label: 'Cover your ears', fx: { bhakti: +5, tejas: -4 } },
    right: { label: 'Join the chorus', fx: { bhakti: -8, tejas: +7, karma: -3 } },
  }),

  c('apsara_dance', {
    realmMin: 2, realmMax: 5, weight: 1,
    art: '💃', speaker: 'An apsara of Indra\'s court',
    text: '"My anklets ring for whoever lifts his eyes. Will you?"',
    left:  { label: 'Look away',     fx: { karma: +3, bhakti: +3, tejas: -3 } },
    right: { label: 'Watch, transfixed', fx: { karma: -8, prana: +6, tejas: +4, bhakti: -6 } },
  }),

  c('vayu_gust', {
    realmMin: 2, realmMax: 3, weight: 1,
    art: '🌬', speaker: 'Vāyu, the wind',
    text: '"I will lift you to the next world — but the climb costs breath. Still willing?"',
    left:  { label: 'Refuse the gust', fx: { prana: +4, tejas: -4 } },
    right: { label: 'Be lifted',       fx: { prana: -7, tejas: +6, bhakti: +3 } },
  }),

  c('storm_vow', {
    realmMin: 2, realmMax: 3, weight: 1,
    art: '⛈', speaker: 'A wandering ascetic in the rain',
    text: '"Vow to fast for seven days, and I will teach you the wind\'s name."',
    left:  { label: 'Take the vow',  fx: { prana: -9, tejas: +7, bhakti: +3 } },
    right: { label: 'Decline politely', fx: { prana: +2, tejas: -4 } },
  }),

  c('garuda_offer', {
    realmMin: 2, realmMax: 5, weight: 1, tag: 'god',
    art: '🦅', speaker: 'Garuḍa, mount of Viṣṇu',
    text: '"Climb my back. But every feather I lend you, you owe in dharma."',
    left:  { label: 'Climb on',     fx: { karma: -6, tejas: +7, bhakti: +3 } },
    right: { label: 'Walk on foot', fx: { karma: +2, prana: -3 } },
  }),

  // ---------- Svarloka (3) - Indra's heaven, devas everywhere ----------

  c('indra_test', {
    realmMin: 3, realmMax: 4, weight: 2, tag: 'god',
    art: '⚡', speaker: 'Indra, lord of thunder',
    text: '"A mortal climbs my hall? Drink with me — soma loosens cowardice and courage alike."',
    left:  { label: 'Refuse, eyes lowered', fx: { karma: +3, bhakti: +3, tejas: -4 } },
    right: { label: 'Drain the cup',        fx: { prana: -5, tejas: +8, karma: -6 } },
  }),

  c('agni_fire', {
    realmMin: 1, realmMax: 5, weight: 2, tag: 'god',
    art: '🔥', speaker: 'Agni, the fire',
    text: '"Cast something into me. Anything you would not miss, and I will return it sevenfold in heat."',
    left:  { label: 'Cast a memory', fx: { tejas: +7, bhakti: -6, karma: -2 } },
    right: { label: 'Cast a sin',    fx: { karma: +7, tejas: +2, bhakti: +3 } },
  }),

  c('varuna_oath', {
    realmMin: 2, realmMax: 6, weight: 1, tag: 'god',
    art: '🌊', speaker: 'Varuṇa, keeper of ṛta',
    text: '"Swear an oath you will keep. The cosmic order tightens around you either way."',
    left:  { label: 'Swear truth',     fx: { karma: +6, prana: -5, tejas: -2 } },
    right: { label: 'Swear vengeance', fx: { tejas: +7, karma: -10, prana: +2 } },
  }),

  c('surya_chariot', {
    realmMin: 3, realmMax: 5, weight: 1, tag: 'god',
    art: '☀', speaker: 'Sūrya, the sun',
    text: '"Stand in my chariot for one heartbeat. Most are blinded. A few are burnt. The luckiest, neither."',
    left:  { label: 'Decline the seat', fx: { tejas: -4, karma: +2 } },
    right: { label: 'Step aboard',      fx: { prana: -7, tejas: +10, bhakti: +3 } },
  }),

  c('saraswati_book', {
    realmMin: 2, realmMax: 6, weight: 1, tag: 'god',
    art: '📜', speaker: 'Sarasvatī, the white-clad',
    text: '"Read this verse aloud. The line is true; only the reader misspeaks."',
    left:  { label: 'Read carefully', fx: { tejas: +4, bhakti: +5, prana: -2 } },
    right: { label: 'Mistranslate boldly', fx: { tejas: +6, karma: -8 } },
  }),

  c('lakshmi_offer', {
    realmMin: 2, realmMax: 6, weight: 1, tag: 'god',
    art: '🪙', speaker: 'Lakṣmī, lotus-throned',
    text: '"Stretch out your hand. I fill it once. Greed empties it, devotion keeps it."',
    left:  { label: 'A small handful', fx: { tejas: +4, bhakti: +3, karma: +1 } },
    right: { label: 'Both hands wide', fx: { tejas: +8, bhakti: -8, karma: -4 } },
  }),

  c('hanuman_blessing', {
    realmMin: 1, realmMax: 6, weight: 1, tag: 'god',
    art: '🐒', speaker: 'Hanumān, son of the wind',
    text: '"Lift this boulder, even an inch. Whatever I see in you, I lend you."',
    left:  { label: 'Strain with all you have', fx: { prana: -5, tejas: +4, bhakti: +8 } },
    right: { label: 'Admit you cannot',         fx: { karma: +4, bhakti: +3 } },
  }),

  c('ganesha_path', {
    realmMin: 1, realmMax: 7, weight: 1, tag: 'god',
    art: '🐘', speaker: 'Gaṇeśa, remover of obstacles',
    text: '"Two paths from here. One short, with thorns. One long, with truth. Choose."',
    left:  { label: 'The thorned path', fx: { prana: -9, tejas: +4, karma: +2 } },
    right: { label: 'The long path',    fx: { prana: +4, tejas: -2, bhakti: +5, karma: +2 } },
  }),

  c('narada_gossip', {
    realmMin: 2, realmMax: 6, weight: 1,
    art: '🪕', speaker: 'Nārada the wanderer',
    text: '"A juicy thing — Indra fears you. Spread it. Or bury it. Either tells me who you are."',
    left:  { label: 'Spread the rumor', fx: { tejas: +5, karma: -8, bhakti: -2 } },
    right: { label: 'Bury it',          fx: { tejas: -2, karma: +5, bhakti: +3 } },
  }),

  c('durvasa_temper', {
    realmMin: 2, realmMax: 6, weight: 1,
    art: '🪨', speaker: 'Sage Durvāsa',
    text: 'His glare is famous. "I am hungry. Cook for me, NOW. Burn the rice and I curse your line."',
    left:  { label: 'Cook with care', fx: { prana: -5, tejas: -2, karma: +4, bhakti: +3 } },
    right: { label: 'Refuse to serve', fx: { prana: -12, karma: +1, tejas: +4 } },
  }),

  // ---------- Maharloka (4) - the great sages ----------

  c('vishvamitra_test', {
    realmMin: 4, realmMax: 5, weight: 1,
    art: '🪶', speaker: 'Sage Viśvāmitra',
    text: '"You have power. Use it now to save a king\'s son who deserves death."',
    left:  { label: 'Refuse — let dharma stand', fx: { karma: +6, bhakti: -2, tejas: -4 } },
    right: { label: 'Save him anyway',           fx: { karma: -8, bhakti: +5, tejas: +4 } },
  }),

  c('vasishtha_calm', {
    realmMin: 4, realmMax: 6, weight: 1,
    art: '🧘', speaker: 'Sage Vasiṣṭha',
    text: '"Sit. Say nothing for a hundred breaths. The world will offer everything to break you."',
    left:  { label: 'Sit silent',     fx: { tejas: -6, karma: +5, bhakti: +5, prana: -2 } },
    right: { label: 'Stand and walk', fx: { tejas: +4, karma: -4 } },
  }),

  c('agastya_ocean', {
    realmMin: 4, realmMax: 6, weight: 1,
    art: '🌊', speaker: 'Sage Agastya',
    text: '"I once drank the sea. To pass, hand me one thing larger than yourself."',
    left:  { label: 'Your sorrow',  fx: { karma: +5, bhakti: +5, tejas: -2 } },
    right: { label: 'Your pride',   fx: { karma: +2, tejas: -10, bhakti: +3 } },
  }),

  c('rishi_curse', {
    realmMin: 3, realmMax: 6, weight: 1,
    art: '🌑', speaker: 'A wronged ṛṣi',
    text: '"You stepped on my deer\'s shadow. Apologize at my feet, or be reborn as a worm."',
    left:  { label: 'Kneel and apologize', fx: { tejas: -8, karma: +4, bhakti: +3 } },
    right: { label: 'Stand your ground',   fx: { prana: -14, tejas: +5 } },
  }),

  // ---------- Tempters (asuras) - any realm ----------

  c('asura_temptation', {
    realmMin: 2, realmMax: 6, weight: 2,
    art: '🦂', speaker: 'A silken-voiced asura',
    text: '"The gods test you. Drop the test. Take this dagger — every wound it gives, returns to you as strength."',
    left:  { label: 'Refuse the dagger', fx: { karma: +4, bhakti: +2, tejas: -4 } },
    right: { label: 'Take it',           fx: { karma: -10, tejas: +7, prana: -2 } },
  }),

  c('rakshasa_market', {
    realmMin: 2, realmMax: 5, weight: 1,
    art: '🏮', speaker: 'A rākṣasa merchant',
    text: '"Trade. Five years of your life for this jewel that shines in any darkness."',
    left:  { label: 'Walk away',  fx: { prana: +4, tejas: -2 } },
    right: { label: 'Trade',      fx: { prana: -12, tejas: +8, karma: -4 } },
  }),

  c('pisacha_haunt', {
    realmMin: 1, realmMax: 4, weight: 1,
    art: '👻', speaker: 'A piśāca in the cremation ground',
    text: '"Eat with me. The dead will not mind. The living, perhaps."',
    left:  { label: 'Refuse',       fx: { karma: +2, bhakti: +3 } },
    right: { label: 'Share its meal', fx: { prana: +10, karma: -12, bhakti: -6 } },
  }),

  c('mara_doubt', {
    realmMin: 3, realmMax: 7, weight: 1,
    art: '🕷', speaker: 'A whisper from your own mind',
    text: '"None of this is real. The gods, the demons, the wheel. Why obey rules in a dream?"',
    left:  { label: 'Reject the doubt', fx: { karma: +4, bhakti: +5, tejas: -4 } },
    right: { label: 'Embrace it',       fx: { tejas: +8, karma: -10, bhakti: -6 } },
  }),

  // ---------- Higher realms (5-6) - cosmic stakes ----------

  c('brahma_spark', {
    realmMin: 5, realmMax: 7, weight: 1, tag: 'god',
    art: '🌌', speaker: 'A spark from Brahmā\'s mouth',
    text: '"Speak the syllable that began the universe. Mispronounce it, and a galaxy ages."',
    left:  { label: 'Whisper "OṂ"',   fx: { tejas: +6, bhakti: +6, prana: -3 } },
    right: { label: 'Stay silent',    fx: { karma: +4, tejas: -4 } },
  }),

  c('shiva_dance', {
    realmMin: 5, realmMax: 7, weight: 1, tag: 'god',
    art: '🕉', speaker: 'Śiva at the cremation ground',
    text: '"I am dancing the universe to ash. Dance with me, or carry the urn."',
    left:  { label: 'Dance',         fx: { prana: -9, tejas: +11, bhakti: +3 } },
    right: { label: 'Carry the urn', fx: { tejas: -4, karma: +6, bhakti: +6 } },
  }),

  c('parvati_compassion', {
    realmMin: 4, realmMax: 7, weight: 1, tag: 'god',
    art: '🌸', speaker: 'Pārvatī',
    text: '"A demon hides in this child. Slay it, and the child dies. Spare it, and the world bleeds slower for years."',
    left:  { label: 'Slay swiftly', fx: { karma: -8, tejas: +4 } },
    right: { label: 'Spare the child', fx: { karma: +6, bhakti: +5, prana: -5 } },
  }),

  c('kali_fury', {
    realmMin: 4, realmMax: 7, weight: 1, tag: 'god',
    art: '🩸', speaker: 'Kālī, garlanded in heads',
    text: '"My foot hovers over the world. Lend me a sin to crush, or lend me your tongue to laugh."',
    left:  { label: 'Offer a sin',   fx: { karma: +7, prana: -5, bhakti: +3 } },
    right: { label: 'Offer your tongue', fx: { tejas: +8, karma: -6, bhakti: -4 } },
  }),

  c('krishna_riddle', {
    realmMin: 4, realmMax: 7, weight: 1, tag: 'god',
    art: '🪈', speaker: 'Kṛṣṇa with a flute',
    text: '"Action without attachment, or stillness with longing — which carries you further?"',
    left:  { label: '"Action."',  fx: { tejas: +5, karma: +2 } },
    right: { label: '"Stillness."', fx: { bhakti: +8, tejas: -2, karma: +2 } },
  }),

  c('vishnu_sleep', {
    realmMin: 5, realmMax: 7, weight: 1, tag: 'god',
    art: '🐍', speaker: 'Viṣṇu on the cosmic serpent',
    text: 'He half-opens an eye. "Wake me with a true name, or let me dream — and the universe with me."',
    left:  { label: 'Speak a name', fx: { bhakti: +11, prana: -5, tejas: +2 } },
    right: { label: 'Let him sleep', fx: { karma: +5, bhakti: -2 } },
  }),

  c('yama_ledger', {
    realmMin: 5, realmMax: 7, weight: 1, tag: 'god',
    art: '⚖', speaker: 'Yama with his ledger',
    text: '"Two columns. I will erase one entry of your choosing — a great deed, or a great sin."',
    left:  { label: 'Erase a sin',  fx: { karma: +8, bhakti: -2 } },
    right: { label: 'Erase a deed', fx: { tejas: +6, karma: -8 } },
  }),

  c('chitragupta_audit', {
    realmMin: 5, realmMax: 7, weight: 1,
    art: '📓', speaker: 'Chitragupta, scribe of deeds',
    text: '"Read me the worst line in your ledger. Honesty is rewarded — sometimes."',
    left:  { label: 'Confess truly',   fx: { karma: +6, bhakti: +5, tejas: -4 } },
    right: { label: 'Edit on the fly', fx: { karma: -8, tejas: +5 } },
  }),

  // ---------- Travelers / mortals - filler with meaningful tradeoffs ----------

  c('dying_soldier', {
    realmMin: 1, realmMax: 4, weight: 1,
    art: '🗡', speaker: 'A dying soldier',
    text: '"Take my sword. Promise to use it for the side I betrayed."',
    left:  { label: 'Take it',           fx: { tejas: +5, karma: -6 } },
    right: { label: 'Bury it with him',  fx: { karma: +4, bhakti: +3, tejas: -2 } },
  }),

  c('runaway_bride', {
    realmMin: 1, realmMax: 3, weight: 1,
    art: '👰', speaker: 'A bride hiding behind a banyan',
    text: '"They marry me to a man twice my age tomorrow. Hide me a single night."',
    left:  { label: 'Hide her',     fx: { karma: +5, bhakti: +3, prana: -3 } },
    right: { label: 'Send her back', fx: { tejas: +2, karma: -6 } },
  }),

  c('thief_at_temple', {
    realmMin: 1, realmMax: 4, weight: 1,
    art: '💎', speaker: 'A thief in temple shadow',
    text: '"Half the loot if you keep watch. The deity has plenty."',
    left:  { label: 'Refuse and warn priest', fx: { karma: +5, tejas: -2, bhakti: +3 } },
    right: { label: 'Keep watch',             fx: { tejas: +7, karma: -10 } },
  }),

  c('mute_oracle', {
    realmMin: 2, realmMax: 6, weight: 1,
    art: '🔮', speaker: 'A mute oracle',
    text: 'She holds out two stones, one glowing, one cool, and waits.',
    left:  { label: 'The cool stone',   fx: { karma: +4, bhakti: +3 } },
    right: { label: 'The glowing stone', fx: { tejas: +6, karma: -4 } },
  }),

  c('cursed_well', {
    realmMin: 2, realmMax: 5, weight: 1,
    art: '🕳', speaker: 'A whispering well',
    text: '"Drop a virtue down me, and rise with another."',
    left:  { label: 'Drop your tejas',  fx: { tejas: -14, karma: +8 } },
    right: { label: 'Drop your karma', fx: { karma: -14, tejas: +8 } },
  }),

  c('starving_monk', {
    realmMin: 1, realmMax: 5, weight: 1,
    art: '🥣', speaker: 'A starving monk',
    text: '"My vow forbids me to ask for food. But I will not refuse, if offered."',
    left:  { label: 'Ignore the hint', fx: { karma: -6 } },
    right: { label: 'Share your meal', fx: { prana: -3, karma: +5, bhakti: +5 } },
  }),

  c('reflection_pond', {
    realmMin: 2, realmMax: 6, weight: 1,
    art: '🪞', speaker: 'Your own reflection',
    text: '"You\'re not who you pretend to be. Admit it, and one truth becomes a power."',
    left:  { label: 'Admit it',     fx: { karma: +4, tejas: +4, bhakti: +3, prana: -3 } },
    right: { label: 'Walk on',      fx: { tejas: +1, bhakti: -2 } },
  }),

  c('snake_charmer', {
    realmMin: 1, realmMax: 4, weight: 1,
    art: '🐍', speaker: 'A snake-charmer',
    text: '"This nāga blesses one virtue, drains another. He will not say which until he strikes."',
    left:  { label: 'Walk past',  fx: {} },
    right: { label: 'Let him play', fx: () => randomNagaEffect() },
  }),

  c('cremation_offering', {
    realmMin: 3, realmMax: 6, weight: 1,
    art: '🪦', speaker: 'A pyre-keeper',
    text: '"Add a name to the fire — yours, or the one you most miss."',
    left:  { label: 'Your name',   fx: { prana: -9, tejas: +5, bhakti: +6 } },
    right: { label: 'Their name',  fx: { karma: +5, bhakti: +5, tejas: -2 } },
  }),

  // ---------- High-realm encounters (5-7) ----------

  c('akashic_record', {
    realmMin: 5, realmMax: 7, weight: 1,
    art: '📚', speaker: 'The Ākāśic record',
    text: 'A book of every life you have lived opens. "Read aloud the worst page, or tear it out unread."',
    left:  { label: 'Read it aloud',  fx: { karma: +7, tejas: -6, bhakti: +3 } },
    right: { label: 'Tear it out',    fx: { tejas: +6, karma: -8, bhakti: -2 } },
  }),

  c('seven_rishis', {
    realmMin: 5, realmMax: 7, weight: 1,
    art: '✨', speaker: 'The Seven Ṛṣis',
    text: 'Stars in the form of sages. "Choose: borrow our wisdom, or our austerity."',
    left:  { label: 'Wisdom',     fx: { tejas: +5, bhakti: +5, prana: -3 } },
    right: { label: 'Austerity',  fx: { karma: +7, prana: -7, tejas: -2 } },
  }),

  c('cosmic_dance_witness', {
    realmMin: 6, realmMax: 7, weight: 1, tag: 'god',
    art: '🌀', speaker: 'A whirling cosmos',
    text: 'You glimpse Brahmā exhale a universe. "Inhale before he does, and you steal a breath of creation."',
    left:  { label: 'Hold your breath', fx: { tejas: +8, prana: -7, bhakti: +3 } },
    right: { label: 'Exhale with him',  fx: { karma: +6, bhakti: +6, tejas: -4 } },
  }),

  c('liberation_test', {
    realmMin: 6, realmMax: 7, weight: 1,
    art: '⚜', speaker: 'A formless voice',
    text: '"Name what you cling to most. Whatever you name, I take. Refuse, and the climb resets a step."',
    left:  { label: 'Name a virtue', fx: { tejas: -10, karma: +5, bhakti: +6 } },
    right: { label: 'Refuse',        fx: { prana: -5, tejas: -2 } },
  }),

  c('boatman_styx', {
    realmMin: 5, realmMax: 7, weight: 1,
    art: '🛶', speaker: 'A boatman on the Vaitaraṇī',
    text: '"Most cross weeping. Pay in tears, or in years of life."',
    left:  { label: 'Pay in tears',  fx: { bhakti: +6, karma: +2, tejas: -4 } },
    right: { label: 'Pay in years',  fx: { prana: -10, tejas: +4 } },
  }),

  // ---------- BOSSES (one per realm) ----------

  c('boss_mahishasura', {
    realm: 1, tag: 'boss',
    art: '🐃', speaker: 'Mahiṣāsura, the buffalo-demon',
    text: '"No man, no god has slain me. You are neither. Step into my horn-shadow, then."',
    left:  { label: 'Strike low (Prana)', fx: { prana: -19, tejas: +4, karma: +5 } },
    right: { label: 'Pray to the Devi (Bhakti)', fx: { prana: -9, bhakti: -8, karma: +7, tejas: +2 } },
  }),

  c('boss_vritra', {
    realm: 2, tag: 'boss',
    art: '🐉', speaker: 'Vṛtra, the drought-serpent',
    text: '"I have swallowed the rivers. Cut me, and a flood drowns the world. Bargain — what do you offer?"',
    left:  { label: 'Cut anyway', fx: { prana: -17, tejas: +8, karma: -6 } },
    right: { label: 'Offer a vow of rain', fx: { prana: -7, bhakti: -10, karma: +8, tejas: +1 } },
  }),

  c('boss_bali', {
    realm: 3, tag: 'boss',
    art: '👑', speaker: 'Bali, the dharmic asura-king',
    text: '"I am no monster. I rule heaven justly. Strike me down, and you uphold a god\'s pride. Spare me, and the gods rage."',
    left:  { label: 'Strike him down', fx: { prana: -14, tejas: +8, karma: -10 } },
    right: { label: 'Bow and pass',    fx: { karma: +8, bhakti: +5, tejas: -8 } },
  }),

  c('boss_hiranyakashipu', {
    realm: 4, tag: 'boss',
    art: '🦁', speaker: 'Hiraṇyakaśipu, deathless tyrant',
    text: '"Not by man nor beast, not by day nor night, not within nor without — what loophole brings you here?"',
    left:  { label: '"At dusk, on a threshold."', fx: { prana: -14, tejas: +7, karma: +4 } },
    right: { label: '"With a half-lion claw."',    fx: { prana: -19, tejas: +11, karma: -4 } },
  }),

  c('boss_taraka', {
    realm: 5, tag: 'boss',
    art: '🪐', speaker: 'Tārakāsura',
    text: '"Only a son of Śiva can end me. You are not. Do you bluff, or kneel?"',
    left:  { label: 'Bluff',  fx: { prana: -20, tejas: +10, karma: -6 } },
    right: { label: 'Kneel', fx: { karma: +8, tejas: -10, bhakti: +6, prana: -3 } },
  }),

  c('boss_ravana', {
    realm: 6, tag: 'boss',
    art: '👹', speaker: 'Rāvaṇa of ten heads',
    text: '"Each head is a Veda. Cut one, two grow. Reason with me — or burn this whole realm to ash."',
    left:  { label: 'Reason with him', fx: { prana: -9, tejas: -6, karma: +10, bhakti: +5 } },
    right: { label: 'Burn it all',     fx: { prana: -22, tejas: +12, karma: -14 } },
  }),

  c('boss_final', {
    realm: 7, tag: 'boss',
    art: '🪷', speaker: 'The Voice within Satyaloka',
    text: '"You stand at the edge of moksha. Surrender what you carried — or claim it."',
    left:  { label: 'Surrender the self', fx: { prana: -12, tejas: -10, bhakti: +12, karma: +8 } },
    right: { label: 'Claim what you earned', fx: { prana: -9, tejas: +10, karma: -6, bhakti: -4 } },
  }),

];

// Random naga effect: gives one stat, drains another.
function randomNagaEffect() {
  const stats = ['prana', 'tejas', 'karma', 'bhakti'];
  const a = stats[Math.floor(Math.random() * stats.length)];
  let b = stats[Math.floor(Math.random() * stats.length)];
  while (b === a) b = stats[Math.floor(Math.random() * stats.length)];
  return { [a]: +12, [b]: -10 };
}

// Expose to game.js
window.SAPTALOKA = { REALMS, CARDS, CUTSCENES, ENDINGS };
