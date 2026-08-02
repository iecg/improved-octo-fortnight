import { describe, expect, it } from 'vitest';

import { buildPrompt, briefFor } from './prompt';

describe('buildPrompt', () => {
  it('asks for the requesting partner’s language, not the couple’s', () => {
    expect(buildPrompt({ kind: 'date_night', locale: 'es', count: 3 }).system).toContain('Spanish');
    expect(buildPrompt({ kind: 'date_night', locale: 'en', count: 3 }).system).toContain('English');
  });

  it('describes each of the three commitments differently', () => {
    const briefs = ['date_night', 'getaway', 'trip'].map(briefFor);
    expect(new Set(briefs).size).toBe(3);
  });

  it('falls back rather than throwing for a kind it has never seen', () => {
    // Adding a ritual is a constant plus two translation keys, never a
    // migration — so a new kind must degrade, not break.
    expect(() => buildPrompt({ kind: 'stargazing', locale: 'en', count: 2 })).not.toThrow();
    expect(briefFor('stargazing')).toBe(briefFor('anything_else_unknown'));
  });

  it('passes the user’s hint through verbatim', () => {
    const { user } = buildPrompt({
      kind: 'getaway',
      locale: 'en',
      count: 3,
      hint: 'somewhere walkable, under €50',
    });
    expect(user).toContain('somewhere walkable, under €50');
  });

  it('omits the hint line entirely when there is no hint', () => {
    const bare = buildPrompt({ kind: 'trip', locale: 'en', count: 3 });
    const blank = buildPrompt({ kind: 'trip', locale: 'en', count: 3, hint: '   ' });
    expect(bare.user).not.toContain('into account');
    expect(blank.user).toBe(bare.user);
  });

  it('passes location and budget through verbatim', () => {
    const { user } = buildPrompt({
      kind: 'getaway',
      locale: 'en',
      count: 3,
      location: 'Lisbon',
      budget: 'under €300 all in',
    });
    expect(user).toContain('Lisbon');
    expect(user).toContain('under €300 all in');
  });

  /**
   * An empty label is worse than no label: "Budget:" with nothing after it
   * reads to a model as a constraint rather than an absence.
   */
  it('omits location and budget when they are blank', () => {
    const bare = buildPrompt({ kind: 'getaway', locale: 'en', count: 3 });
    const blank = buildPrompt({
      kind: 'getaway',
      locale: 'en',
      count: 3,
      location: '  ',
      budget: '',
    });
    expect(bare.user).not.toContain('Near:');
    expect(bare.user).not.toContain('Budget:');
    expect(blank.user).toBe(bare.user);
  });

  it('keeps each field on its own line so none can run into the next', () => {
    const { user } = buildPrompt({
      kind: 'date_night',
      locale: 'en',
      count: 3,
      location: 'Lisbon',
      budget: 'cheap',
      hint: 'no restaurants',
    });
    expect(user.split('\n')).toHaveLength(4);
  });

  it('takes the fields independently, so one filled field is enough', () => {
    const onlyBudget = buildPrompt({ kind: 'trip', locale: 'en', count: 3, budget: 'no limit' });
    expect(onlyBudget.user).toContain('no limit');
    expect(onlyBudget.user).not.toContain('Near:');
  });

  it('asks for the number of ideas requested', () => {
    expect(buildPrompt({ kind: 'trip', locale: 'en', count: 4 }).user).toContain('4');
  });

  /**
   * The discretion invariant, as an assertion rather than a habit. The prompt
   * is the only thing that leaves the device, so it is the only place this can
   * be checked.
   */
  it('sends nothing beyond the kind, the language, the count and the three fields', () => {
    const { system, user } = buildPrompt({
      kind: 'date_night',
      locale: 'en',
      count: 3,
      location: 'Lisbon',
      budget: 'under €50',
      hint: 'near the river',
    });
    const sent = `${system}\n${user}`.toLowerCase();

    // What the user filled in does go — all three of them, verbatim.
    expect(sent).toContain('lisbon');
    expect(sent).toContain('under €50');
    expect(sent).toContain('near the river');

    // And nothing else does, with every field populated. `timezone` stays on
    // this list even though a location now leaves: a city the user typed is
    // not the same as one inferred from a device setting.
    for (const forbidden of [
      'couple_id',
      'profile_id',
      'timezone',
      'anniversary',
      'invite',
      'check-in',
      'checkin',
      'partner',
      'supabase',
      'token',
    ]) {
      expect(sent, `the prompt mentions ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('tells the model the bounds the database will enforce', () => {
    const { system } = buildPrompt({ kind: 'date_night', locale: 'en', count: 3 });
    expect(system).toContain('200');
    expect(system).toContain('2000');
  });
});
