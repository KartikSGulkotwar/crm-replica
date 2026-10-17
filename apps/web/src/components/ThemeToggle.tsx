import { ThemeChoice, useTheme } from '../lib/theme';

const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Auto' },
];

export function ThemeToggle() {
  const { choice, setChoice } = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className="flex rounded-lg bg-raised p-0.5 text-xs">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={choice === option.value}
          onClick={() => setChoice(option.value)}
          className={`flex-1 rounded-md px-2 py-1 transition-colors ${
            choice === option.value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
