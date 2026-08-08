import { Avatar } from 'react-native-paper';

function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

export function MemberAvatar({ name, size = 32 }: { name: string | null | undefined; size?: number }) {
  return <Avatar.Text size={size} label={initials(name)} />;
}
