/**
 * Invariant 3: nothing intimate reaches a lock screen, a notification payload,
 * or a calendar entry.
 *
 * CLAUDE.md says each invariant is backed by a test listed with it. This one
 * was not — the closest thing was one assertion inside
 * `packages/device/src/sync.test.ts` checking that a calendar entry carries the
 * neutral label, which covers the calendar and says nothing about the lock
 * screen.
 *
 * That is the gap worth closing, because the notification path is the one that
 * fails silently and in public. A calendar entry with too much in it is at
 * least visible to the person who wrote it, on their own phone, in an app they
 * opened deliberately. A reminder body is rendered on a locked screen, face up
 * on a table, to whoever is in the room.
 *
 * The rule this enforces: reminder copy is composed from translation keys on
 * the recipient's own device and never from a plan. `reconcileDevice` is handed
 * `reminder: { leadMinutes, title, body }` already translated, and
 * `plannedReminders` returns only a key, a plan id and an instant — no title,
 * no notes, no kind. Both halves are checked here: the shape of what the pure
 * function returns, and the fact that no caller builds the copy out of a plan.
 *
 * A grep with a reason attached, in the same spirit as `./ai-optional.test.ts`.
 * It needs no device, which matters: the mistake it catches is one you would
 * otherwise only find on a phone, three hours after booking something.
 */
import type { Plan } from '@couple/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { plannedReminders } from '../../packages/cadence/src/sync';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function read(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

/** Everything about a plan that must never be spoken aloud by a phone. */
const PRIVATE_FIELDS = ['title', 'notes', 'location', 'kind'] as const;

function planWith(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    coupleId: 'couple-1',
    domain: 'intimacy',
    kind: 'intimacy',
    title: 'SECRET-TITLE',
    notes: 'SECRET-NOTES',
    location: 'SECRET-LOCATION',
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    endsAt: null,
    status: 'scheduled',
    createdBy: 'profile-1',
    completedAt: null,
    calendarEventIds: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('invariant 3: discretion', () => {
  it('carries nothing from a plan into what a reminder is built from', () => {
    const [planned] = plannedReminders([planWith()], new Date(), 120);

    expect(planned).toBeDefined();
    // An id, an instant and a de-duplication key. Nothing a passer-by could read.
    expect(Object.keys(planned!).sort()).toEqual(['at', 'key', 'planId']);

    const serialised = JSON.stringify(planned);
    for (const secret of ['SECRET-TITLE', 'SECRET-NOTES', 'SECRET-LOCATION']) {
      expect(serialised).not.toContain(secret);
    }
    // Not even the kind, which would say what sort of evening it is.
    expect(serialised).not.toContain('intimacy');
  });

  /**
   * The reminder key is a notification identifier, so it exists on the device
   * outside our process. A plan id is opaque; a kind would not be.
   */
  it('keys a reminder by plan id rather than by anything descriptive', () => {
    const [planned] = plannedReminders([planWith({ kind: 'extended' })], new Date(), 120);
    expect(planned!.key).toBe('plan.plan-1');
  });

  /**
   * The other half: the copy itself. `useDeviceSync` takes an already-translated
   * `reminder` object, and both apps must build it from `t(...)` alone — the
   * moment one interpolates a plan into it, every phone on the couple's table
   * shows it.
   */
  it('composes reminder copy from translation keys, in both apps', () => {
    for (const app of ['intimacy', 'two-two-two']) {
      const layout = read(`apps/${app}/app/(tabs)/_layout.tsx`);

      const reminder = /const reminder = useMemo\(\s*\(\)\s*=>\s*\(\{([\s\S]*?)\}\),/.exec(layout);
      expect(reminder, `${app}: no reminder object found — renamed?`).not.toBeNull();

      const body = reminder![1]!;
      expect(body).toMatch(/title:\s*t\(/);
      expect(body).toMatch(/body:\s*t\(/);

      // No plan in scope at all: not a field, not an interpolation.
      for (const field of PRIVATE_FIELDS) {
        expect(body, `${app}: reminder copy mentions plan.${field}`).not.toContain(`plan.${field}`);
      }
      expect(body).not.toMatch(/\bplan\b/);
    }
  });

  /**
   * `scheduleReminder` is the single door to the OS. If a second one appears,
   * the assertions above stop covering the feature.
   */
  it('schedules through one function, so there is one door to check', () => {
    const sync = read('packages/device/src/sync.ts');
    expect(sync).toContain('scheduleReminder(');
    // Composed from the caller's translated strings, never from the plan.
    expect(sync).toMatch(/title:\s*reminder\.title/);
    expect(sync).toMatch(/body:\s*reminder\.body/);
  });
});
