import { Avatar } from '@couple/ui';

/**
 * First and last initial. Kept here rather than in `@couple/ui` because which
 * characters stand for a name is a language question, not a layout one.
 */
function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

export function MemberAvatar({ name }: { name: string | null | undefined }) {
  return <Avatar initials={initials(name)} />;
}
