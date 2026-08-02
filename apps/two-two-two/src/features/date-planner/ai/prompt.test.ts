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

  it('asks for the number of ideas requested', () => {
    expect(buildPrompt({ kind: 'trip', locale: 'en', count: 4 }).user).toContain('4');
  });

  /**
   * The discretion invariant, as an assertion rather than a habit. The prompt
   * is the only thing that leaves the device, so it is the only place this can
   * be checked.
   */
  it('sends nothing but the kind, the language, the count and the hint', () => {
    const { system, user } = buildPrompt({
      kind: 'date_night',
      locale: 'en',
      count: 3,
      hint: 'near the river',
    });
    const sent = `${system}\n${user}`.toLowerCase();

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
