import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  choice: ThemeChoice;
  setChoice: (choice: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readSaved(): ThemeChoice {
  try {
    const saved = localStorage.getItem('theme');
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

function apply(choice: ThemeChoice) {
  const dark =
    choice === 'dark' ||
    (choice === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(readSaved);

  useEffect(() => {
    apply(choice);
    if (choice !== 'system' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      // Storage can be unavailable (private mode); the choice still applies for this visit.
    }
  }, []);

  return <ThemeContext.Provider value={{ choice, setChoice }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
