import { FieldType } from '@crm-replica/shared';
import {
  ArrowRightLeft,
  Calendar,
  CalendarClock,
  CheckSquare,
  CircleDot,
  DollarSign,
  Hash,
  Link,
  LucideIcon,
  Mail,
  Phone,
  Star,
  Tags,
  Type,
} from 'lucide-react';

const ICONS: Record<FieldType, LucideIcon> = {
  [FieldType.TEXT]: Type,
  [FieldType.NUMBER]: Hash,
  [FieldType.CURRENCY]: DollarSign,
  [FieldType.BOOLEAN]: CheckSquare,
  [FieldType.DATE]: Calendar,
  [FieldType.DATE_TIME]: CalendarClock,
  [FieldType.SELECT]: CircleDot,
  [FieldType.MULTI_SELECT]: Tags,
  [FieldType.EMAIL]: Mail,
  [FieldType.PHONE]: Phone,
  [FieldType.LINK]: Link,
  [FieldType.RATING]: Star,
  [FieldType.RELATION]: ArrowRightLeft,
};

export function FieldTypeIcon({
  type,
  className = 'size-4',
}: {
  type: FieldType;
  className?: string;
}) {
  const Icon = ICONS[type];
  return <Icon aria-hidden className={className} strokeWidth={1.75} />;
}
