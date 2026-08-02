/**
 * Somewhere to stay, for the two commitments that need one.
 *
 * **There is no Airbnb integration to build.** Airbnb's public API was retired
 * years ago and the partner programme at `developer.withairbnb.com` is closed
 * to unsolicited applicants — vetted property-management systems and channel
 * managers only, approached by Airbnb rather than applying. No key exists that
 * this app could hold, so there is no search to proxy and no listing data to
 * show. Third-party scrapers sell the data; they are somebody else reselling a
 * site's contents, and pointing a couple's private planner at one would add a
 * paid dependency, a legal question, and a second thing to break.
 *
 * What is left is also the honest thing: a deep link. The couple has already
 * told this app the two facts an accommodation search needs — the nights, and
 * roughly where — so the link arrives with both filled in and they finish the
 * search on Airbnb's own site, logged in as themselves. No key, no account, no
 * request from us to anyone, and nothing sent anywhere until somebody taps. It
 * is exactly what `link.ts` does for maps, for the same reasons.
 *
 * **No affiliate or referral tagging.** A link from a private app two people
 * use to plan time together is not an advertising slot, and quietly earning on
 * their weekend away is not a thing to do without asking. If it is ever wanted,
 * it is a deliberate product decision with a conversation attached, not a query
 * parameter someone adds on a slow afternoon.
 */
import { calendarDateIn } from '@couple/i18n';

/**
 * The kinds that involve sleeping somewhere.
 *
 * A date night ends at home, so offering it a booking search would be noise on
 * the screen. Getaways and trips are measured in nights — see `DURATIONS` in
 * the booking screen — which is the same distinction, arrived at from the other
 * direction.
 */
export const STAY_KINDS = ['getaway', 'trip'] as const;

export function needsSomewhereToStay(kind: string): boolean {
  return (STAY_KINDS as readonly string[]).includes(kind);
}

export interface StaySearch {
  /** Where, as the couple would have typed it into the site themselves. */
  where: string;
  startsAt: Date;
  endsAt: Date;
  /** The couple's zone. A night is a calendar date, not a UTC instant. */
  timeZone: string;
  /** Two people. Named rather than hard-coded so it reads as a choice. */
  adults?: number;
}

/**
 * An Airbnb search with the dates and the place already in it.
 *
 * Returns null rather than a half-built link whenever there is nothing useful
 * to ask: no place, or a window that is not at least one night. A link that
 * lands on an error page is worse than no button.
 *
 * Dates go through `calendarDateIn` in the couple's timezone rather than
 * `toISOString()`. A getaway starting 9am on the 4th in Madrid is `2026-09-04`;
 * naive UTC slicing turns an evening start into the day before and books the
 * wrong night — the exact class of bug invariant 5 exists to prevent.
 */
export function airbnbSearchUrl(search: StaySearch): string | null {
  const where = search.where.replace(/\s+/g, ' ').trim();
  if (where.length === 0) return null;

  const checkIn = calendarDateIn(search.startsAt, search.timeZone);
  const checkOut = calendarDateIn(search.endsAt, search.timeZone);
  // Airbnb rejects a stay that does not span a night, and so should we.
  if (checkOut <= checkIn) return null;

  const params = new URLSearchParams({
    checkin: checkIn,
    checkout: checkOut,
    adults: String(search.adults ?? 2),
  });

  // `/s/<where>/homes` is the site's own search path; the place is a path
  // segment there rather than a query parameter.
  return `https://www.airbnb.com/s/${encodeURIComponent(where)}/homes?${params.toString()}`;
}
