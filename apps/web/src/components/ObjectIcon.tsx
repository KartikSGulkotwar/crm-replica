import {
  Box,
  Briefcase,
  Building2,
  Calendar,
  CheckSquare,
  CircleUser,
  FileText,
  Flag,
  Folder,
  Handshake,
  Heart,
  LucideIcon,
  Package,
  ShoppingCart,
  Star,
  StickyNote,
  Tag,
  Target,
  Ticket,
  Truck,
  User,
  Users,
} from 'lucide-react';

/** Icon names an object can use (stored as plain words in its metadata). */
export const OBJECT_ICONS: Record<string, LucideIcon> = {
  building: Building2,
  user: User,
  users: Users,
  'user-circle': CircleUser,
  target: Target,
  note: StickyNote,
  check: CheckSquare,
  handshake: Handshake,
  briefcase: Briefcase,
  box: Box,
  calendar: Calendar,
  file: FileText,
  flag: Flag,
  folder: Folder,
  heart: Heart,
  package: Package,
  cart: ShoppingCart,
  star: Star,
  tag: Tag,
  ticket: Ticket,
  truck: Truck,
};

export function ObjectIcon({
  name,
  className = 'size-4',
}: {
  name: string | null | undefined;
  className?: string;
}) {
  const Icon = (name && OBJECT_ICONS[name]) || Box;
  return <Icon aria-hidden className={className} strokeWidth={1.75} />;
}
