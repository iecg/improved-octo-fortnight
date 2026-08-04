/**
 * When the couple is occupied — owned by neither app, readable by both.
 *
 * This is the one accessor in the package that deliberately crosses the domain
 * boundary, and the only reason it is allowed to is that there is nothing on
 * the other side to see. It reads `plan_busy_times`, a view of `plans` that
 * selects three columns and leaves the rest in the table: no domain, no title,
 * no notes, no location, no author. A caller learns that Friday evening is
 * taken and cannot learn what is taking it.
 *
 * Note the shape of the factory. It takes no domain — not by convention, but
 * because there is no domain column to pass one to, which is a stronger
 * guarantee than the rule in `./repository` asks for. Nobody can widen this by
 * adding a parameter; they would have to change the view, in a migration, in
 * review.
 *
 * Why it exists at all, when the phone's own calendar already answers most of
 * this question: it answers the two cases the calendar cannot. A partner who
 * never granted calendar access has no busy times otherwise, and a `proposed`
 * plan reaches no calendar by design — so the window most worth protecting from
 * a double-booking is the one the calendar knows nothing about.
 *
 * Reading it is a choice each app makes, not one this module makes for them.
 * The 2-2-2 app puts it behind a setting that is off until someone turns it on.
 */
import type { BusyWindow } from '@couple/core';

import type { AppSupabaseClient } from './client';
import { toBusyWindow } from './mappers';

export interface BusyRepository {
  /**
   * Occupied windows overlapping `[from, to)`, earliest first.
   *
   * Bounded rather than open-ended because every caller is drawing a finite
   * range of choices, and an unbounded read would pull a couple's whole
   * history to decide about next Tuesday.
   */
  listBetween(coupleId: string, from: Date, to: Date): Promise<BusyWindow[]>;
}

export function createBusyRepository(client: AppSupabaseClient): BusyRepository {
  return {
    async listBetween(coupleId, from, to) {
      // Overlap, not containment: a block that started before the window and
      // runs into it is still occupying it. A getaway spanning the whole range
      // has neither endpoint inside it and matters most of all.
      const { data, error } = await client
        .from('plan_busy_times')
        .select('*')
        .eq('couple_id', coupleId)
        .lt('starts_at', to.toISOString())
        .gt('ends_at', from.toISOString())
        .order('starts_at');
      if (error) throw new Error(error.message);
      return (data ?? []).map(toBusyWindow);
    },
  };
}
