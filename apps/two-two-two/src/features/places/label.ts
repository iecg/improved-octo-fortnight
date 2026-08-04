/**
 * Turning a place into the one line a plan carries.
 *
 * Pure, and deliberately outside `maps/`: none of this needs a mapping
 * provider, and it is what the feature falls back to when none is configured —
 * the same role the bundled idea library plays for the AI feature.
 *
 * `plans.location` is what can reach a device calendar entry, so everything
 * here is about producing a short, human, honest label for it. It is capped at
 * the column's own limit rather than trusted to be short: a provider's
 * formatted address for a rural venue runs well past 200 characters.
 */

/** `plans.location` is `text check (length(location) <= 200)`. */
export const PLAN_LOCATION_MAX = 200;

/** A venue name on its own is capped by the same column. */
export const PLACE_NAME_MAX = 200;

/**
 * Collapse the whitespace a soft keyboard leaves behind, and treat a field
 * holding only spaces as empty rather than as a place called " ".
 */
export function normalizeManualPlace(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return null;
  return collapsed.slice(0, PLACE_NAME_MAX);
}

/**
 * `name — address`, or just the name when there is no address to add.
 *
 * An em dash rather than a comma because a formatted address usually contains
 * commas already, and the join is easier to read against them. Truncation drops
 * the address first and only then bites into the name: a partner looking at a
 * calendar entry needs to recognise the venue more than to navigate to it.
 */
export function placeLabel(name: string, address?: string | null): string {
  const cleanName = normalizeManualPlace(name) ?? '';
  const cleanAddress = address ? normalizeManualPlace(address) : null;

  if (!cleanAddress) return cleanName.slice(0, PLAN_LOCATION_MAX);

  const joined = `${cleanName} — ${cleanAddress}`;
  if (joined.length <= PLAN_LOCATION_MAX) return joined;

  // Keep the whole name and as much of the address as still fits; if even the
  // name is over the limit, the name alone wins.
  const room = PLAN_LOCATION_MAX - cleanName.length - 3;
  if (room <= 0) return cleanName.slice(0, PLAN_LOCATION_MAX);
  return `${cleanName} — ${cleanAddress.slice(0, room)}`;
}
