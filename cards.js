// Saptaloka — encounter deck.
// Stats: prana (life), tejas (radiance), karma (deeds), bhakti (devotion).
// Each is 0..100. Run ends if any hits 0 or 100.
// Effects are deltas. Cards may set { realmMin, realmMax } to gate by realm,
// or { tag: 'boss' } to be drawn only at realm boundaries.
// Choices may chain via `next: 'cardId'` to build multi-step encounters.

const REALMS = [
  { name: 'Bhūloka',      subtitle: 'the earthly plane',     length: 6 },
  { name: 'Bhuvarloka',   subtitle: 'the atmospheres',       length: 7 },
  { name: 'Svarloka',     subtitle: "Indra's heaven",        length: 7 },
  { name: 'Maharloka',    subtitle: 'realm of the great',    length: 8 },
  { name: 'Janaloka',     subtitle: 'realm of the creators', length: 8 },
  { name: 'Tapoloka',     subtitle: 'realm of austerity',    length: 9 },
  { name: 'Satyaloka',    subtitle: 'realm of truth',        length: 10 },
];

// Helper to keep card definitions terse.
function c(id, def) { return Object.assign({ id }, def); }

const CARDS = [

  // ---------- Bhūloka (1) - mortal realm, gentle introduction ----------

  c('beggar_1', {
    realmMin: 1, realmMax: 2, weight: 2,
    art: '🪔', speaker: 'A blind beggar',
    text: 'A frail man kneels at your feet. "A coin, a kind word, anything for a soul about to ascend."',
    left:  { label: 'Walk past',     fx: { tejas: +4, karma: -8, bhakti: -4 } },
    right: { label: 'Empty your alms', fx: { tejas: -6, karma: +9, bhakti: +6 } },
  }),

  c('village_widow', {
    realmMin: 1, realmMax: 2, weight: 1,
    art: '🕯', speaker: 'A village widow',
    text: '"My husband\'s pyre still smokes. Stay one night, recite the names of the dead."',
    left:  { label: 'Press onward',   fx: { tejas: +6, karma: -5, prana: +3 } },
    right: { label: 'Sit and chant',  fx: { tejas: -4, karma: +6, bhakti: +5, prana: -3 } },
  }),

  c('merchant_caravan', {
    realmMin: 1, realmMax: 3, weight: 1,
    art: '🐪', speaker: 'A jeweled merchant',
    text: '"Bandits stalk the pass. Guard my caravan to Mathura — I pay in gold, or in mantras, your choice."',
    left:  { label: 'Take the gold',  fx: { tejas: +10, karma: -4, bhakti: -2 } },
    right: { label: 'Take the mantras', fx: { tejas: -2, karma: +3, bhakti: +8 } },
  }),

  c('river_crossing', {
    realmMin: 1, realmMax: 3, weight: 1,
    art: '🌊', speaker: 'The Ganga',
    text: 'The river-mother whispers from the foam. "Drink, and remember a former life. Or pass dry-mouthed."',
    left:  { label: 'Drink deeply',   fx: { prana: -6, bhakti: +10, tejas: +4 } },
    right: { label: 'Cross dry-shod', fx: { prana: +4, bhakti: -3 } },
  }),

  c('forest_tiger', {
    realmMin: 1, realmMax: 3, weight: 1,
    art: '🐯', speaker: 'A tiger in the path',
    text: 'Yellow eyes, no growl. The beast simply waits.',
    left:  { label: 'Bare your blade', fx: { prana: -10, tejas: +8, karma: -3 } },
    right: { label: 'Bow and pass',    fx: { prana: -2, bhakti: +6, karma: +3 } },
  }),

  c('child_pleading', {
    realmMin: 1, realmMax: 2, weight: 1,
    art: '🧒', speaker: 'A village child',
    text: '"A demon took my mother into the well. Please. Climb down with me."',
    left:  { label: 'Descend the well', fx: { prana: -10, karma: +10, bhakti: +4 } },
    right: { label: 'Tell her to flee', fx: { prana: +4, karma: -8, tejas: +2 } },
  }),

  // ---------- Bhuvarloka (2) - storms, yakshas, in-between beings ----------

  c('yaksha_riddle', {
    realmMin: 2, realmMax: 4, weight: 2,
    art: '🌀', speaker: 'A yaksha by a pond',
    text: '"What is heavier than the earth, swifter than wind, more numerous than blades of grass?"',
    left:  { label: '"A mother\'s love."', fx: { karma: +8, bhakti: +6, tejas: -2 } },
    right: { label: '"I have no time for games."', fx: { prana: -12, tejas: +6 } },
  }),

  c('gandharva_song', {
    realmMin: 2, realmMax: 4, weight: 1,
    art: '🎶', speaker: 'A gandharva of the clouds',
    text: 'Music wraps your bones. "Sing with us forever, and never feel grief again."',
    left:  { label: 'Cover your ears', fx: { bhakti: +6, tejas: -4 } },
    right: { label: 'Join the chorus', fx: { bhakti: -8, tejas: +12, karma: -3 } },
  }),

  c('apsara_dance', {
    realmMin: 2, realmMax: 5, weight: 1,
    art: '💃', speaker: 'An apsara of Indra\'s court',
    text: '"My anklets ring for whoever lifts his eyes. Will you?"',
    left:  { label: 'Look away',     fx: { karma: +5, bhakti: +4, tejas: -3 } },
    right: { label: 'Watch, transfixed', fx: { karma: -8, prana: +6, tejas: +6, bhakti: -6 } },
  }),

  c('vayu_gust', {
    realmMin: 2, realmMax: 3, weight: 1,
    art: '🌬', speaker: 'Vāyu, the wind',
    text: '"I will lift you to the next world — but the climb costs breath. Still willing?"',
    left:  { label: 'Refuse the gust', fx: { prana: +4, tejas: -4 } },
    right: { label: 'Be lifted',       fx: { prana: -8, tejas: +10, bhakti: +4 } },
  }),

  c('storm_vow', {
    realmMin: 2, realmMax: 3, weight: 1,
    art: '⛈', speaker: 'A wandering ascetic in the rain',
    text: '"Vow to fast for seven days, and I will teach you the wind\'s name."',
    left:  { label: 'Take the vow',  fx: { prana: -10, tejas: +12, bhakti: +4 } },
    right: { label: 'Decline politely', fx: { prana: +2, tejas: -4 } },
  }),

  c('garuda_offer', {
    realmMin: 2, realmMax: 5, weight: 1, tag: 'god',
    art: '🦅', speaker: 'Garuḍa, mount of Viṣṇu',
    text: '"Climb my back. But every feather I lend you, you owe in dharma."',
    left:  { label: 'Climb on',     fx: { karma: -6, tejas: +12, bhakti: +4 } },
    right: { label: 'Walk on foot', fx: { karma: +4, prana: -4 } },
  }),

  // ---------- Svarloka (3) - Indra's heaven, devas everywhere ----------

  c('indra_test', {
    realmMin: 3, realmMax: 4, weight: 2, tag: 'god',
    art: '⚡', speaker: 'Indra, lord of thunder',
    text: '"A mortal climbs my hall? Drink with me — soma loosens cowardice and courage alike."',
    left:  { label: 'Refuse, eyes lowered', fx: { karma: +5, bhakti: +4, tejas: -4 } },
    right: { label: 'Drain the cup',        fx: { prana: -6, tejas: +14, karma: -6 } },
  }),

  c('agni_fire', {
    realmMin: 1, realmMax: 5, weight: 2, tag: 'god',
    art: '🔥', speaker: 'Agni, the fire',
    text: '"Cast something into me. Anything you would not miss, and I will return it sevenfold in heat."',
    left:  { label: 'Cast a memory', fx: { tejas: +12, bhakti: -6, karma: -2 } },
    right: { label: 'Cast a sin',    fx: { karma: +12, tejas: +4, bhakti: +4 } },
  }),

  c('varuna_oath', {
    realmMin: 2, realmMax: 6, weight: 1, tag: 'god',
    art: '🌊', speaker: 'Varuṇa, keeper of ṛta',
    text: '"Swear an oath you will keep. The cosmic order tightens around you either way."',
    left:  { label: 'Swear truth',     fx: { karma: +10, prana: -6, tejas: -2 } },
    right: { label: 'Swear vengeance', fx: { tejas: +12, karma: -10, prana: +2 } },
  }),

  c('surya_chariot', {
    realmMin: 3, realmMax: 5, weight: 1, tag: 'god',
    art: '☀', speaker: 'Sūrya, the sun',
    text: '"Stand in my chariot for one heartbeat. Most are blinded. A few are burnt. The luckiest, neither."',
    left:  { label: 'Decline the seat', fx: { tejas: -4, karma: +3 } },
    right: { label: 'Step aboard',      fx: { prana: -8, tejas: +16, bhakti: +4 } },
  }),

  c('saraswati_book', {
    realmMin: 2, realmMax: 6, weight: 1, tag: 'god',
    art: '📜', speaker: 'Sarasvatī, the white-clad',
    text: '"Read this verse aloud. The line is true; only the reader misspeaks."',
    left:  { label: 'Read carefully', fx: { tejas: +6, bhakti: +6, prana: -2 } },
    right: { label: 'Mistranslate boldly', fx: { tejas: +10, karma: -8 } },
  }),

  c('lakshmi_offer', {
    realmMin: 2, realmMax: 6, weight: 1, tag: 'god',
    art: '🪙', speaker: 'Lakṣmī, lotus-throned',
    text: '"Stretch out your hand. I fill it once. Greed empties it, devotion keeps it."',
    left:  { label: 'A small handful', fx: { tejas: +6, bhakti: +4, karma: +2 } },
    right: { label: 'Both hands wide', fx: { tejas: +14, bhakti: -8, karma: -4 } },
  }),

  c('hanuman_blessing', {
    realmMin: 1, realmMax: 6, weight: 1, tag: 'god',
    art: '🐒', speaker: 'Hanumān, son of the wind',
    text: '"Lift this boulder, even an inch. Whatever I see in you, I lend you."',
    left:  { label: 'Strain with all you have', fx: { prana: -6, tejas: +6, bhakti: +10 } },
    right: { label: 'Admit you cannot',         fx: { karma: +6, bhakti: +4 } },
  }),

  c('ganesha_path', {
    realmMin: 1, realmMax: 7, weight: 1, tag: 'god',
    art: '🐘', speaker: 'Gaṇeśa, remover of obstacles',
    text: '"Two paths from here. One short, with thorns. One long, with truth. Choose."',
    left:  { label: 'The thorned path', fx: { prana: -10, tejas: +6, karma: +4 } },
    right: { label: 'The long path',    fx: { prana: +4, tejas: -2, bhakti: +6, karma: +4 } },
  }),

  c('narada_gossip', {
    realmMin: 2, realmMax: 6, weight: 1,
    art: '🪕', speaker: 'Nārada the wanderer',
    text: '"A juicy thing — Indra fears you. Spread it. Or bury it. Either tells me who you are."',
    left:  { label: 'Spread the rumor', fx: { tejas: +8, karma: -8, bhakti: -2 } },
    right: { label: 'Bury it',          fx: { tejas: -2, karma: +8, bhakti: +4 } },
  }),

  c('durvasa_temper', {
    realmMin: 2, realmMax: 6, weight: 1,
    art: '🪨', speaker: 'Sage Durvāsa',
    text: 'His glare is famous. "I am hungry. Cook for me, NOW. Burn the rice and I curse your line."',
    left:  { label: 'Cook with care', fx: { prana: -6, tejas: -2, karma: +6, bhakti: +4 } },
    right: { label: 'Refuse to serve', fx: { prana: -14, karma: +2, tejas: +6 } },
  }),

  // ---------- Maharloka (4) - the great sages ----------

  c('vishvamitra_test', {
    realmMin: 4, realmMax: 5, weight: 1,
    art: '🪶', speaker: 'Sage Viśvāmitra',
    text: '"You have power. Use it now to save a king\'s son who deserves death."',
    left:  { label: 'Refuse — let dharma stand', fx: { karma: +10, bhakti: -2, tejas: -4 } },
    right: { label: 'Save him anyway',           fx: { karma: -8, bhakti: +6, tejas: +6 } },
  }),

  c('vasishtha_calm', {
    realmMin: 4, realmMax: 6, weight: 1,
    art: '🧘', speaker: 'Sage Vasiṣṭha',
    text: '"Sit. Say nothing for a hundred breaths. The world will offer everything to break you."',
    left:  { label: 'Sit silent',     fx: { tejas: -6, karma: +8, bhakti: +6, prana: -2 } },
    right: { label: 'Stand and walk', fx: { tejas: +6, karma: -4 } },
  }),

  c('agastya_ocean', {
    realmMin: 4, realmMax: 6, weight: 1,
    art: '🌊', speaker: 'Sage Agastya',
    text: '"I once drank the sea. To pass, hand me one thing larger than yourself."',
    left:  { label: 'Your sorrow',  fx: { karma: +8, bhakti: +6, tejas: -2 } },
    right: { label: 'Your pride',   fx: { karma: +4, tejas: -10, bhakti: +4 } },
  }),

  c('rishi_curse', {
    realmMin: 3, realmMax: 6, weight: 1,
    art: '🌑', speaker: 'A wronged ṛṣi',
    text: '"You stepped on my deer\'s shadow. Apologize at my feet, or be reborn as a worm."',
    left:  { label: 'Kneel and apologize', fx: { tejas: -8, karma: +6, bhakti: +4 } },
    right: { label: 'Stand your ground',   fx: { prana: -16, tejas: +8 } },
  }),

  // ---------- Tempters (asuras) - any realm ----------

  c('asura_temptation', {
    realmMin: 2, realmMax: 6, weight: 2,
    art: '🦂', speaker: 'A silken-voiced asura',
    text: '"The gods test you. Drop the test. Take this dagger — every wound it gives, returns to you as strength."',
    left:  { label: 'Refuse the dagger', fx: { karma: +6, bhakti: +2, tejas: -4 } },
    right: { label: 'Take it',           fx: { karma: -10, tejas: +12, prana: -2 } },
  }),

  c('rakshasa_market', {
    realmMin: 2, realmMax: 5, weight: 1,
    art: '🏮', speaker: 'A rākṣasa merchant',
    text: '"Trade. Five years of your life for this jewel that shines in any darkness."',
    left:  { label: 'Walk away',  fx: { prana: +4, tejas: -2 } },
    right: { label: 'Trade',      fx: { prana: -14, tejas: +14, karma: -4 } },
  }),

  c('pisacha_haunt', {
    realmMin: 1, realmMax: 4, weight: 1,
    art: '👻', speaker: 'A piśāca in the cremation ground',
    text: '"Eat with me. The dead will not mind. The living, perhaps."',
    left:  { label: 'Refuse',       fx: { karma: +4, bhakti: +4 } },
    right: { label: 'Share its meal', fx: { prana: +10, karma: -12, bhakti: -6 } },
  }),

  c('mara_doubt', {
    realmMin: 3, realmMax: 7, weight: 1,
    art: '🕷', speaker: 'A whisper from your own mind',
    text: '"None of this is real. The gods, the demons, the wheel. Why obey rules in a dream?"',
    left:  { label: 'Reject the doubt', fx: { karma: +6, bhakti: +6, tejas: -4 } },
    right: { label: 'Embrace it',       fx: { tejas: +14, karma: -10, bhakti: -6 } },
  }),

  // ---------- Higher realms (5-6) - cosmic stakes ----------

  c('brahma_spark', {
    realmMin: 5, realmMax: 7, weight: 1, tag: 'god',
    art: '🌌', speaker: 'A spark from Brahmā\'s mouth',
    text: '"Speak the syllable that began the universe. Mispronounce it, and a galaxy ages."',
    left:  { label: 'Whisper "OṂ"',   fx: { tejas: +10, bhakti: +8, prana: -4 } },
    right: { label: 'Stay silent',    fx: { karma: +6, tejas: -4 } },
  }),

  c('shiva_dance', {
    realmMin: 5, realmMax: 7, weight: 1, tag: 'god',
    art: '🕉', speaker: 'Śiva at the cremation ground',
    text: '"I am dancing the universe to ash. Dance with me, or carry the urn."',
    left:  { label: 'Dance',         fx: { prana: -10, tejas: +18, bhakti: +4 } },
    right: { label: 'Carry the urn', fx: { tejas: -4, karma: +10, bhakti: +8 } },
  }),

  c('parvati_compassion', {
    realmMin: 4, realmMax: 7, weight: 1, tag: 'god',
    art: '🌸', speaker: 'Pārvatī',
    text: '"A demon hides in this child. Slay it, and the child dies. Spare it, and the world bleeds slower for years."',
    left:  { label: 'Slay swiftly', fx: { karma: -8, tejas: +6 } },
    right: { label: 'Spare the child', fx: { karma: +10, bhakti: +6, prana: -6 } },
  }),

  c('kali_fury', {
    realmMin: 4, realmMax: 7, weight: 1, tag: 'god',
    art: '🩸', speaker: 'Kālī, garlanded in heads',
    text: '"My foot hovers over the world. Lend me a sin to crush, or lend me your tongue to laugh."',
    left:  { label: 'Offer a sin',   fx: { karma: +12, prana: -6, bhakti: +4 } },
    right: { label: 'Offer your tongue', fx: { tejas: +14, karma: -6, bhakti: -4 } },
  }),

  c('krishna_riddle', {
    realmMin: 4, realmMax: 7, weight: 1, tag: 'god',
    art: '🪈', speaker: 'Kṛṣṇa with a flute',
    text: '"Action without attachment, or stillness with longing — which carries you further?"',
    left:  { label: '"Action."',  fx: { tejas: +8, karma: +4 } },
    right: { label: '"Stillness."', fx: { bhakti: +10, tejas: -2, karma: +4 } },
  }),

  c('vishnu_sleep', {
    realmMin: 5, realmMax: 7, weight: 1, tag: 'god',
    art: '🐍', speaker: 'Viṣṇu on the cosmic serpent',
    text: 'He half-opens an eye. "Wake me with a true name, or let me dream — and the universe with me."',
    left:  { label: 'Speak a name', fx: { bhakti: +14, prana: -6, tejas: +4 } },
    right: { label: 'Let him sleep', fx: { karma: +8, bhakti: -2 } },
  }),

  c('yama_ledger', {
    realmMin: 5, realmMax: 7, weight: 1, tag: 'god',
    art: '⚖', speaker: 'Yama with his ledger',
    text: '"Two columns. I will erase one entry of your choosing — a great deed, or a great sin."',
    left:  { label: 'Erase a sin',  fx: { karma: +14, bhakti: -2 } },
    right: { label: 'Erase a deed', fx: { tejas: +10, karma: -8 } },
  }),

  c('chitragupta_audit', {
    realmMin: 5, realmMax: 7, weight: 1,
    art: '📓', speaker: 'Chitragupta, scribe of deeds',
    text: '"Read me the worst line in your ledger. Honesty is rewarded — sometimes."',
    left:  { label: 'Confess truly',   fx: { karma: +10, bhakti: +6, tejas: -4 } },
    right: { label: 'Edit on the fly', fx: { karma: -8, tejas: +8 } },
  }),

  // ---------- Travelers / mortals - filler with meaningful tradeoffs ----------

  c('dying_soldier', {
    realmMin: 1, realmMax: 4, weight: 1,
    art: '🗡', speaker: 'A dying soldier',
    text: '"Take my sword. Promise to use it for the side I betrayed."',
    left:  { label: 'Take it',           fx: { tejas: +8, karma: -6 } },
    right: { label: 'Bury it with him',  fx: { karma: +6, bhakti: +4, tejas: -2 } },
  }),

  c('runaway_bride', {
    realmMin: 1, realmMax: 3, weight: 1,
    art: '👰', speaker: 'A bride hiding behind a banyan',
    text: '"They marry me to a man twice my age tomorrow. Hide me a single night."',
    left:  { label: 'Hide her',     fx: { karma: +8, bhakti: +4, prana: -4 } },
    right: { label: 'Send her back', fx: { tejas: +4, karma: -6 } },
  }),

  c('thief_at_temple', {
    realmMin: 1, realmMax: 4, weight: 1,
    art: '💎', speaker: 'A thief in temple shadow',
    text: '"Half the loot if you keep watch. The deity has plenty."',
    left:  { label: 'Refuse and warn priest', fx: { karma: +8, tejas: -2, bhakti: +4 } },
    right: { label: 'Keep watch',             fx: { tejas: +12, karma: -10 } },
  }),

  c('mute_oracle', {
    realmMin: 2, realmMax: 6, weight: 1,
    art: '🔮', speaker: 'A mute oracle',
    text: 'She holds out two stones, one glowing, one cool, and waits.',
    left:  { label: 'The cool stone',   fx: { karma: +6, bhakti: +4 } },
    right: { label: 'The glowing stone', fx: { tejas: +10, karma: -4 } },
  }),

  c('cursed_well', {
    realmMin: 2, realmMax: 5, weight: 1,
    art: '🕳', speaker: 'A whispering well',
    text: '"Drop a virtue down me, and rise with another."',
    left:  { label: 'Drop your tejas',  fx: { tejas: -14, karma: +14 } },
    right: { label: 'Drop your karma', fx: { karma: -14, tejas: +14 } },
  }),

  c('starving_monk', {
    realmMin: 1, realmMax: 5, weight: 1,
    art: '🥣', speaker: 'A starving monk',
    text: '"My vow forbids me to ask for food. But I will not refuse, if offered."',
    left:  { label: 'Ignore the hint', fx: { karma: -6 } },
    right: { label: 'Share your meal', fx: { prana: -4, karma: +8, bhakti: +6 } },
  }),

  c('reflection_pond', {
    realmMin: 2, realmMax: 6, weight: 1,
    art: '🪞', speaker: 'Your own reflection',
    text: '"You\'re not who you pretend to be. Admit it, and one truth becomes a power."',
    left:  { label: 'Admit it',     fx: { karma: +6, tejas: +6, bhakti: +4, prana: -4 } },
    right: { label: 'Walk on',      fx: { tejas: +2, bhakti: -2 } },
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
    left:  { label: 'Your name',   fx: { prana: -10, tejas: +8, bhakti: +8 } },
    right: { label: 'Their name',  fx: { karma: +8, bhakti: +6, tejas: -2 } },
  }),

  // ---------- High-realm encounters (5-7) ----------

  c('akashic_record', {
    realmMin: 5, realmMax: 7, weight: 1,
    art: '📚', speaker: 'The Ākāśic record',
    text: 'A book of every life you have lived opens. "Read aloud the worst page, or tear it out unread."',
    left:  { label: 'Read it aloud',  fx: { karma: +12, tejas: -6, bhakti: +4 } },
    right: { label: 'Tear it out',    fx: { tejas: +10, karma: -8, bhakti: -2 } },
  }),

  c('seven_rishis', {
    realmMin: 5, realmMax: 7, weight: 1,
    art: '✨', speaker: 'The Seven Ṛṣis',
    text: 'Stars in the form of sages. "Choose: borrow our wisdom, or our austerity."',
    left:  { label: 'Wisdom',     fx: { tejas: +8, bhakti: +6, prana: -4 } },
    right: { label: 'Austerity',  fx: { karma: +12, prana: -8, tejas: -2 } },
  }),

  c('cosmic_dance_witness', {
    realmMin: 6, realmMax: 7, weight: 1, tag: 'god',
    art: '🌀', speaker: 'A whirling cosmos',
    text: 'You glimpse Brahmā exhale a universe. "Inhale before he does, and you steal a breath of creation."',
    left:  { label: 'Hold your breath', fx: { tejas: +14, prana: -8, bhakti: +4 } },
    right: { label: 'Exhale with him',  fx: { karma: +10, bhakti: +8, tejas: -4 } },
  }),

  c('liberation_test', {
    realmMin: 6, realmMax: 7, weight: 1,
    art: '⚜', speaker: 'A formless voice',
    text: '"Name what you cling to most. Whatever you name, I take. Refuse, and the climb resets a step."',
    left:  { label: 'Name a virtue', fx: { tejas: -10, karma: +8, bhakti: +8 } },
    right: { label: 'Refuse',        fx: { prana: -6, tejas: -2 } },
  }),

  c('boatman_styx', {
    realmMin: 5, realmMax: 7, weight: 1,
    art: '🛶', speaker: 'A boatman on the Vaitaraṇī',
    text: '"Most cross weeping. Pay in tears, or in years of life."',
    left:  { label: 'Pay in tears',  fx: { bhakti: +8, karma: +4, tejas: -4 } },
    right: { label: 'Pay in years',  fx: { prana: -12, tejas: +6 } },
  }),

  // ---------- BOSSES (one per realm) ----------

  c('boss_mahishasura', {
    realm: 1, tag: 'boss',
    art: '🐃', speaker: 'Mahiṣāsura, the buffalo-demon',
    text: '"No man, no god has slain me. You are neither. Step into my horn-shadow, then."',
    left:  { label: 'Strike low (Prana)', fx: { prana: -22, tejas: +6, karma: +8 } },
    right: { label: 'Pray to the Devi (Bhakti)', fx: { prana: -10, bhakti: -8, karma: +12, tejas: +4 } },
  }),

  c('boss_vritra', {
    realm: 2, tag: 'boss',
    art: '🐉', speaker: 'Vṛtra, the drought-serpent',
    text: '"I have swallowed the rivers. Cut me, and a flood drowns the world. Bargain — what do you offer?"',
    left:  { label: 'Cut anyway', fx: { prana: -20, tejas: +14, karma: -6 } },
    right: { label: 'Offer a vow of rain', fx: { prana: -8, bhakti: -10, karma: +14, tejas: +2 } },
  }),

  c('boss_bali', {
    realm: 3, tag: 'boss',
    art: '👑', speaker: 'Bali, the dharmic asura-king',
    text: '"I am no monster. I rule heaven justly. Strike me down, and you uphold a god\'s pride. Spare me, and the gods rage."',
    left:  { label: 'Strike him down', fx: { prana: -16, tejas: +14, karma: -10 } },
    right: { label: 'Bow and pass',    fx: { karma: +14, bhakti: +6, tejas: -8 } },
  }),

  c('boss_hiranyakashipu', {
    realm: 4, tag: 'boss',
    art: '🦁', speaker: 'Hiraṇyakaśipu, deathless tyrant',
    text: '"Not by man nor beast, not by day nor night, not within nor without — what loophole brings you here?"',
    left:  { label: '"At dusk, on a threshold."', fx: { prana: -16, tejas: +12, karma: +6 } },
    right: { label: '"With a half-lion claw."',    fx: { prana: -22, tejas: +18, karma: -4 } },
  }),

  c('boss_taraka', {
    realm: 5, tag: 'boss',
    art: '🪐', speaker: 'Tārakāsura',
    text: '"Only a son of Śiva can end me. You are not. Do you bluff, or kneel?"',
    left:  { label: 'Bluff',  fx: { prana: -24, tejas: +16, karma: -6 } },
    right: { label: 'Kneel', fx: { karma: +14, tejas: -10, bhakti: +8, prana: -4 } },
  }),

  c('boss_ravana', {
    realm: 6, tag: 'boss',
    art: '👹', speaker: 'Rāvaṇa of ten heads',
    text: '"Each head is a Veda. Cut one, two grow. Reason with me — or burn this whole realm to ash."',
    left:  { label: 'Reason with him', fx: { prana: -10, tejas: -6, karma: +16, bhakti: +6 } },
    right: { label: 'Burn it all',     fx: { prana: -26, tejas: +20, karma: -14 } },
  }),

  c('boss_final', {
    realm: 7, tag: 'boss',
    art: '🪷', speaker: 'The Voice within Satyaloka',
    text: '"You stand at the edge of moksha. Surrender what you carried — or claim it."',
    left:  { label: 'Surrender the self', fx: { prana: -14, tejas: -10, bhakti: +16, karma: +14 } },
    right: { label: 'Claim what you earned', fx: { prana: -10, tejas: +16, karma: -6, bhakti: -4 } },
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
window.SAPTALOKA = { REALMS, CARDS };
