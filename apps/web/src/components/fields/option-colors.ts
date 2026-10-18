import type { OptionColor } from '@crm-replica/shared';

/** Chip colors for select options (full class names so Tailwind can see them). */
export const OPTION_COLOR_CLASSES: Record<OptionColor, string> = {
  gray: 'bg-gray-500/15 text-gray-700 dark:text-gray-300',
  red: 'bg-red-500/15 text-red-700 dark:text-red-300',
  orange: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  yellow: 'bg-yellow-500/20 text-yellow-800 dark:text-yellow-200',
  green: 'bg-green-500/15 text-green-700 dark:text-green-300',
  teal: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  blue: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  purple: 'bg-purple-500/15 text-purple-700 dark:text-purple-300',
  pink: 'bg-pink-500/15 text-pink-700 dark:text-pink-300',
};
