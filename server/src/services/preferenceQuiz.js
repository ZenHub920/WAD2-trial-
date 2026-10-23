/**
 * The fill-in-the-blank questionnaire.
 *
 * WHY BLANKS RATHER THAN QUESTIONS
 * --------------------------------
 * Everything the old questionnaire asked was about the concert: queue early or
 * arrive at doors, sing along or listen quietly. None of it asked WHY the
 * person is looking for company, or what they are like to spend an evening
 * with, which is where the real mismatches come from — two people can agree on
 * every concert answer and still have a bad night if one wanted a friend and
 * the other wanted somebody to stand next to.
 *
 * Asking those things directly does not work. "How extraverted are you?" is
 * answered by the person you wish you were, and "are you easy to get along
 * with?" has one socially acceptable answer. So each card finishes a sentence
 * instead, and every option quietly carries what it implies. The person picks
 * the sentence that sounds like them; the dimensions are derived here, on the
 * server, and never shown back to them as a label or a score.
 *
 * WHAT EACH CARD MEASURES
 * -----------------------
 * `looking` and `horizon` are asked almost openly, because the person's own
 * intent is theirs to state and getting it wrong is the costliest mistake.
 * `fandom`, `energy` and `crowd` come from how they describe the night.
 * `extraversion` and `agreeableness` are inferred from two situations rather
 * than asked: a stranger in the queue, and a plan that changes late.
 *
 * Only these two personality dimensions are collected. They are the two of the
 * five with evidence behind them for how well two people get along, and asking
 * a full inventory to find somebody to stand with at a concert is a good way to
 * have nobody finish the form.
 *
 * ONE SOURCE OF TRUTH
 * -------------------
 * The deck lives here and is served to the client, like the concept list, so
 * the interface cannot drift from what the scoring understands. Derivation also
 * happens here: the client sends which option was picked, never a trait value,
 * so a crafted request cannot hand itself a flattering personality.
 */

/** Numeric dimensions run 1–5; the midpoint is "no strong lean". */
export const TRAIT_SCALE = { min: 1, max: 5 };

/** Where a person wants to stand, as an ordinal: next to each other is fine. */
export const CROWD_ORDER = ['barricade', 'middle', 'back'];

export const LOOKING_OPTIONS = ['stand_with', 'friend', 'group', 'logistics'];
export const HORIZON_OPTIONS = ['one_night', 'ongoing'];

/**
 * The deck, in the order it is shown.
 *
 * `effects` are the dimensions an option implies. Numeric dimensions are
 * averaged across every card that mentions them, so one card can nudge and
 * another can confirm; categorical ones are taken from the card that asks.
 */
export const QUIZ_CARDS = [
  {
    id: 'looking',
    prompt: "I'm mainly here to ____",
    hint: 'The one thing worth getting right.',
    options: [
      {
        id: 'stand_with',
        text: 'find someone to stand with for the night',
        effects: { looking: 'stand_with', horizon: 'one_night' },
      },
      {
        id: 'friend',
        text: "meet someone I'd go to more concerts with",
        effects: { looking: 'friend', horizon: 'ongoing' },
      },
      {
        id: 'group',
        text: "join a group so there's a crowd of us",
        effects: { looking: 'group', horizon: 'ongoing', extraversion: 4 },
      },
      {
        id: 'logistics',
        text: 'split the costs and the ride home',
        effects: { looking: 'logistics', horizon: 'one_night' },
      },
    ],
  },
  {
    id: 'love_it_when',
    prompt: 'I love it when ____',
    hint: 'Pick the one you can already picture.',
    options: [
      {
        id: 'whole_section_screaming',
        text: 'the whole section is screaming the bridge',
        effects: { energy: 5, extraversion: 4 },
      },
      {
        id: 'deep_cut',
        text: 'they play the song nobody expected',
        effects: { fandom: 5, energy: 3 },
      },
      {
        id: 'hear_the_vocals',
        text: 'I can actually hear the vocals',
        effects: { energy: 2, fandom: 3 },
      },
      {
        id: 'crowd_looks_out',
        text: 'the people around me look out for each other',
        effects: { agreeableness: 5, energy: 3 },
      },
    ],
  },
  {
    id: 'doors_open',
    prompt: 'When the doors open, I head ____',
    hint: 'Where you actually want to spend the show.',
    options: [
      {
        id: 'barricade',
        text: 'straight for the barricade',
        effects: { crowd: 'barricade', energy: 5, fandom: 4 },
      },
      {
        id: 'middle',
        text: 'for the middle, where I can still see',
        effects: { crowd: 'middle', energy: 4 },
      },
      {
        id: 'back',
        text: 'to the back, where there is room to breathe',
        effects: { crowd: 'back', energy: 2 },
      },
      {
        id: 'wherever_they_are',
        text: 'wherever the person I came with wants to be',
        effects: { crowd: 'middle', agreeableness: 5 },
      },
    ],
  },
  {
    id: 'artist_means',
    prompt: 'This artist is ____ to me',
    hint: 'How deep it goes.',
    options: [
      {
        id: 'waited_years',
        text: "the one I've waited years to see",
        effects: { fandom: 5, energy: 4 },
      },
      {
        id: 'long_loved',
        text: "someone I've loved for a long time",
        effects: { fandom: 4 },
      },
      {
        id: 'few_songs',
        text: 'a few songs I really like',
        effects: { fandom: 2 },
      },
      {
        id: 'here_for_the_night',
        text: "new to me — I'm here for the night out",
        effects: { fandom: 1, extraversion: 4 },
      },
    ],
  },
  {
    id: 'stranger_in_queue',
    prompt: "Put me next to a stranger in the queue and I'll ____",
    hint: 'Be honest rather than impressive.',
    options: [
      {
        id: 'life_story',
        text: "have their whole life story by the time we're inside",
        effects: { extraversion: 5, agreeableness: 4 },
      },
      {
        id: 'chat_if_started',
        text: 'happily chat if they start it',
        effects: { extraversion: 3, agreeableness: 4 },
      },
      {
        id: 'nod_and_earplugs',
        text: 'offer a nod and a spare pair of earplugs',
        effects: { extraversion: 2, agreeableness: 5 },
      },
      {
        id: 'headphones',
        text: 'put my headphones on until the doors move',
        effects: { extraversion: 1 },
      },
    ],
  },
  {
    id: 'plan_changes',
    prompt: 'If the plan changes an hour before, I ____',
    hint: 'What you would really do.',
    options: [
      {
        id: 'roll_with_it',
        text: 'roll with whatever works for everyone',
        effects: { agreeableness: 5 },
      },
      {
        id: 'say_then_follow',
        text: "say what I'd prefer, then go with the group",
        effects: { agreeableness: 4, extraversion: 3 },
      },
      {
        id: 'need_warning',
        text: 'need a bit of warning, but I manage',
        effects: { agreeableness: 3 },
      },
      {
        id: 'stick_to_agreed',
        text: "would rather stick to what we'd agreed",
        effects: { agreeableness: 2 },
      },
    ],
  },
  {
    id: 'after_encore',
    prompt: 'After the encore, the night ____',
    hint: 'How you like it to end.',
    options: [
      {
        id: 'carries_on',
        text: 'carries on over supper somewhere',
        effects: { horizon: 'ongoing', extraversion: 4, energy: 4 },
      },
      {
        id: 'ends_at_mrt',
        text: 'ends at the MRT with a good story',
        effects: { horizon: 'one_night', extraversion: 3 },
      },
      {
        id: 'depends_on_everyone',
        text: "depends how everyone's feeling",
        effects: { agreeableness: 5, extraversion: 3 },
      },
      {
        id: 'straight_home',
        text: 'ends quietly — I go straight home',
        effects: { horizon: 'one_night', extraversion: 1, energy: 2 },
      },
    ],
  },
];

const CARDS = new Map(QUIZ_CARDS.map((card) => [card.id, card]));

const NUMERIC = ['fandom', 'energy', 'extraversion', 'agreeableness'];
const CATEGORICAL = { looking: LOOKING_OPTIONS, horizon: HORIZON_OPTIONS, crowd: CROWD_ORDER };

/** The deck as the client needs it: prompts and option text, no effects. */
export const publicQuiz = () =>
  QUIZ_CARDS.map(({ id, prompt, hint, options }) => ({
    id,
    prompt,
    hint,
    options: options.map(({ id: optionId, text }) => ({ id: optionId, text })),
  }));

/**
 * Validate `[{ card, option }]`.
 *
 * Skipping is allowed — a deck nobody finishes is worse than a partial one —
 * so an empty list is valid. An unknown card or option is not: it would mean
 * the client is out of step with this deck, and silently dropping it would
 * leave somebody wondering why their answer did nothing.
 */
export function validateQuiz(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > QUIZ_CARDS.length)
    throw Object.assign(new Error('invalid_quiz'), { status: 400 });

  const picked = new Map();
  for (const entry of input) {
    const cardId = typeof entry === 'object' && entry ? entry.card : null;
    const optionId = typeof entry === 'object' && entry ? entry.option : null;
    const card = CARDS.get(cardId);
    if (!card) throw Object.assign(new Error('unknown_quiz_card'), { status: 400 });
    if (!card.options.some((option) => option.id === optionId))
      throw Object.assign(new Error('unknown_quiz_option'), { status: 400 });
    // A later answer to the same card replaces the earlier one rather than
    // being counted twice, which would skew every average it feeds.
    picked.set(cardId, optionId);
  }
  // Deck order, not the order they arrived, so stored answers compare equal.
  return QUIZ_CARDS.filter((card) => picked.has(card.id)).map((card) => ({
    card: card.id,
    option: picked.get(card.id),
  }));
}

/**
 * Turn picked options into dimensions.
 *
 * Numeric dimensions are the mean of every option that mentions them, rounded
 * to two places; categorical ones come from the last card that sets them, which
 * in deck order means the most specific card wins. A dimension nothing touched
 * is absent rather than defaulted, so the scoring can tell "no lean" from
 * "never asked" and decline to score on it.
 */
export function deriveTraits(selections) {
  const sums = {};
  const traits = {};
  for (const { card, option } of selections) {
    const effects = CARDS.get(card)?.options.find((o) => o.id === option)?.effects ?? {};
    for (const [key, value] of Object.entries(effects)) {
      if (NUMERIC.includes(key)) {
        sums[key] ??= [];
        sums[key].push(value);
      } else if (CATEGORICAL[key]?.includes(value)) {
        traits[key] = value;
      }
    }
  }
  for (const [key, values] of Object.entries(sums))
    traits[key] = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
  return traits;
}

/** Mean of each dimension across several people, for a group's shared profile. */
export function averageTraits(list) {
  const present = list.filter((traits) => traits && Object.keys(traits).length);
  if (!present.length) return {};
  const out = {};
  for (const key of NUMERIC) {
    const values = present.map((t) => t[key]).filter((v) => typeof v === 'number');
    if (values.length)
      out[key] = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
  }
  for (const key of Object.keys(CATEGORICAL)) {
    // A group has no single intent, so the most common answer stands in, with
    // the deck's own order breaking ties rather than row order.
    const counts = new Map();
    for (const traits of present)
      if (traits[key]) counts.set(traits[key], (counts.get(traits[key]) ?? 0) + 1);
    if (counts.size) {
      const order = CATEGORICAL[key];
      out[key] = [...counts.entries()].sort(
        (a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]),
      )[0][0];
    }
  }
  return out;
}
