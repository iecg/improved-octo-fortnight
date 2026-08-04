import { describe, expect, it } from 'vitest';

import { AiError, isAiError } from './errors';
import { extractIdeas } from './parse';

const ONE = JSON.stringify({ ideas: [{ title: 'Night market', summary: 'Eat standing up.' }] });

describe('extractIdeas', () => {
  it('reads the shape we asked for', () => {
    expect(extractIdeas(ONE, 5)).toEqual([
      { title: 'Night market', summary: 'Eat standing up.', estCostBand: null },
    ]);
  });

  it('reads a bare array, which models return when asked for an object', () => {
    expect(extractIdeas('[{"title":"A walk"}]', 5)).toEqual([
      { title: 'A walk', summary: null, estCostBand: null },
    ]);
  });

  it('reads through a code fence', () => {
    expect(extractIdeas('```json\n' + ONE + '\n```', 5)).toHaveLength(1);
  });

  it('reads through surrounding prose', () => {
    expect(extractIdeas(`Here are some ideas:\n${ONE}\nHope that helps!`, 5)).toHaveLength(1);
  });

  it('is not fooled by a brace inside a summary', () => {
    const tricky = JSON.stringify({
      ideas: [{ title: 'Set menu', summary: 'The board says {soup, fish, tart} nightly.' }],
    });
    const [idea] = extractIdeas(`Sure!\n${tricky}`, 5);
    expect(idea?.summary).toBe('The board says {soup, fish, tart} nightly.');
  });

  /**
   * `plan_ideas` enforces these bounds, and `createIdeaRepository.save`
   * rethrows the raw Postgres message — untranslated English in front of
   * whichever partner does not read it. Nothing that would fail the insert may
   * escape this function.
   */
  it('clamps a title to the length the column accepts', () => {
    const long = JSON.stringify({ ideas: [{ title: 'x'.repeat(400) }] });
    const [idea] = extractIdeas(long, 5);
    expect(idea?.title.length).toBeLessThanOrEqual(200);
    expect(idea?.title.length).toBeGreaterThan(0);
  });

  it('clamps a summary to the length the column accepts', () => {
    const long = JSON.stringify({ ideas: [{ title: 'Fine', summary: 'y'.repeat(4000) }] });
    const [idea] = extractIdeas(long, 5);
    expect(idea?.summary?.length).toBeLessThanOrEqual(2000);
  });

  it('prefers a word boundary when clamping', () => {
    const words = `${'word '.repeat(60)}end`;
    const [idea] = extractIdeas(JSON.stringify({ ideas: [{ title: words }] }), 5);
    expect(idea?.title.endsWith(' ')).toBe(false);
    expect(idea?.title.length).toBeLessThanOrEqual(200);
  });

  it('accepts only the four cost bands the constraint allows', () => {
    const bands = JSON.stringify({
      ideas: [
        { title: 'A', estCostBand: 'low' },
        { title: 'B', estCostBand: 'MEDIUM' },
        { title: 'C', estCostBand: 'cheapish' },
        { title: 'D', estCostBand: 7 },
      ],
    });
    expect(extractIdeas(bands, 5).map((idea) => idea.estCostBand)).toEqual([
      'low',
      'medium',
      null,
      null,
    ]);
  });

  it('also accepts the snake_case spelling of the cost band', () => {
    const snake = JSON.stringify({ ideas: [{ title: 'A', est_cost_band: 'high' }] });
    expect(extractIdeas(snake, 5)[0]?.estCostBand).toBe('high');
  });

  it('drops entries with no usable title', () => {
    const mixed = JSON.stringify({
      ideas: [{ title: '   ' }, { summary: 'orphan' }, { title: 'Kept' }, null, 'nope'],
    });
    expect(extractIdeas(mixed, 5)).toEqual([{ title: 'Kept', summary: null, estCostBand: null }]);
  });

  it('drops duplicate titles regardless of case', () => {
    const dupes = JSON.stringify({
      ideas: [{ title: 'Night market' }, { title: 'NIGHT MARKET' }, { title: 'Other' }],
    });
    expect(extractIdeas(dupes, 5).map((idea) => idea.title)).toEqual(['Night market', 'Other']);
  });

  it('caps the number returned however many arrive', () => {
    const many = JSON.stringify({
      ideas: Array.from({ length: 20 }, (_unused, index) => ({ title: `Idea ${index}` })),
    });
    expect(extractIdeas(many, 3)).toHaveLength(3);
  });

  it('returns empty rather than throwing when the reply is valid but useless', () => {
    // The caller says "empty" here and "malformed" below — different sentences.
    expect(extractIdeas('{"ideas":[]}', 5)).toEqual([]);
  });

  it('throws malformed when there is no JSON at all', () => {
    expect(() => extractIdeas('I cannot help with that.', 5)).toThrow(AiError);
  });

  it('throws malformed when the JSON is not a list of ideas', () => {
    expect(() => extractIdeas('{"error":"nope"}', 5)).toThrow(AiError);
  });

  it('throws malformed, branded, on truncated JSON', () => {
    try {
      extractIdeas('{"ideas":[{"title":"Half', 5);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(isAiError(error)).toBe(true);
      expect(isAiError(error) && error.code).toBe('malformed');
    }
  });
});
