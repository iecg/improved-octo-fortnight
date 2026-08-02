/**
 * The curated idea library.
 *
 * Ids here, text in `locales/{en,es}/ideas.json`. Same split as the kind
 * catalogs: this file names things, the translation bundles say them, and no
 * display string is built in TypeScript. Because the text lives in a `locales/`
 * directory, the i18n parity test picks it up automatically — an idea added in
 * English but not Spanish fails the suite with nothing to register.
 *
 * These are ours rather than a partner's, so unlike a manual or AI idea they
 * are shown to each partner in their own language rather than labelled with
 * the language they were written in.
 *
 * This is also the half of the feature that makes the AI-optional rule true:
 * the library ships in the bundle, so the ideas screen is useful before any
 * model is configured and stays useful if none ever is.
 */

export const IDEA_LIBRARY: Record<string, readonly string[]> = {
  date_night: [
    'cook_something_new',
    'early_dinner_late_walk',
    'live_music_small_room',
    'revisit_first_date',
    'market_then_breakfast',
    'trivia_or_quiz',
    'drive_no_destination',
    'cinema_you_would_not_pick',
  ],
  getaway: [
    'one_train_away',
    'cabin_no_signal',
    'city_you_both_dismissed',
    'spa_or_hot_springs',
    'coast_out_of_season',
    'walk_between_two_towns',
  ],
  trip: [
    'language_neither_speaks',
    'long_rail_journey',
    'island_off_season',
    'revisit_ten_years_on',
    'walk_a_long_route',
    'somewhere_cold',
  ],
};

export function libraryFor(kind: string): readonly string[] {
  return IDEA_LIBRARY[kind] ?? [];
}

export function ideaTitleKey(kind: string, id: string): string {
  return `ideas:${kind}.${id}.title`;
}

export function ideaSummaryKey(kind: string, id: string): string {
  return `ideas:${kind}.${id}.summary`;
}
